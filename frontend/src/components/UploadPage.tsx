import { useState, useEffect } from "react";
import { Button as MovingBorderButton } from "@/components/ui/moving-border";
import { FileUpload } from "@/components/ui/file-upload";
import { MultiStepLoader } from "@/components/ui/multi-step-loader";
import { FocusCards } from "@/components/ui/focus-cards";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "react-oidc-context";
import { motion } from "framer-motion";

interface Upload {
  uploadId: string;
  file_url: string;
  file_name: string;
  ocr_status: 'pending' | 'processing' | 'completed' | 'failed';
  items_count: number;
  ocr_error?: string;
  created_at: string;
}

interface MenuItem {
  item_id: string;
  item_name: string;
  price: number;
  description: string;
  category: string;
  bbox: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  confidence_score: number;
  notes?: string;
}

interface UploadPageProps {
  onBackToHome?: () => void;
}

function useMultipleUploadsPolling(uploadIds: string[]) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [allItems, setAllItems] = useState<MenuItem[]>([]);
  const auth = useAuth();

  useEffect(() => {
    if (uploadIds.length === 0 || !auth.user?.access_token) return;

    let isStopped = false;

    const fetchAllStatuses = async () => {
      try {
        const promises = uploadIds.map(uploadId =>
          fetch(
            `${import.meta.env.VITE_API_BASE}/uploads/${uploadId}`,
            {
              headers: {
                'Authorization': `Bearer ${auth.user?.access_token}`
              }
            }
          ).then(r => r.ok ? r.json() : null)
        );

        const results = await Promise.all(promises);
        const fetchedUploads: Upload[] = [];
        const fetchedItems: MenuItem[] = [];

        results.forEach(result => {
          if (result) {
            fetchedUploads.push(result.upload);
            if (result.items) {
              fetchedItems.push(...result.items);
            }
          }
        });

        setUploads(fetchedUploads);
        setAllItems(fetchedItems);

        const allDone = fetchedUploads.every(
          u => u.ocr_status === 'completed' || u.ocr_status === 'failed'
        );
        if (allDone) {
          isStopped = true;
        }
      } catch (error) {
        console.error('Failed to fetch upload statuses:', error);
      }
    };

    fetchAllStatuses();

    const interval = setInterval(() => {
      if (isStopped) {
        clearInterval(interval);
        return;
      }
      fetchAllStatuses();
    }, 2000);

    return () => {
      clearInterval(interval);
      isStopped = true;
    };
  }, [JSON.stringify(uploadIds), auth.user?.access_token]);

  return { uploads, allItems };
}

const loadingStates = [
  { text: "📤 上傳圖片中..." },
  { text: "📝 提取文字資訊..." },
  { text: "🤖 AI 分析菜單內容..." },
  { text: "✅ 完成！正在整理結果..." }
];

const UploadPage: React.FC<UploadPageProps> = ({ onBackToHome }) => {
  const auth = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedUploadIds, setSelectedUploadIds] = useState<string[]>([]);
  const { uploads, allItems } = useMultipleUploadsPolling(selectedUploadIds);

  const getCurrentLoadingState = (status: string) => {
    switch (status) {
      case 'pending':
        return 0;
      case 'processing':
        return 2;
      case 'completed':
        return 3;
      case 'failed':
        return -1;
      default:
        return 0;
    }
  };

  const handleFileChange = (newFiles: File[]) => {
    if (newFiles.length > 5) {
      alert("最多只能選擇 5 張圖片！");
      return;
    }
    setFiles(newFiles);
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      alert("請先選擇圖片！");
      return;
    }

    if (!auth.isAuthenticated || !auth.user?.access_token) {
      alert("請先登入！");
      return;
    }

    const baseURL = import.meta.env.VITE_API_BASE;
    if (!baseURL) {
      alert("API URL not configured!");
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append("images", file);
      });

      const res = await fetch(baseURL + "/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.user.access_token}`,
        },
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(errorData.error || "Upload failed");
      }

      const data = await res.json();

      if (data.uploads && data.uploads.length > 0) {
        const uploadIds = data.uploads.map((u: any) => u.uploadId);
        setSelectedUploadIds(uploadIds);
      }

      alert(
        `成功上傳 ${data.successCount} 張圖片！\n` +
        `總共: ${data.totalFiles} 張\n` +
        `成功: ${data.successCount} 張\n` +
        (data.errorCount > 0 ? `失敗: ${data.errorCount} 張` : "")
      );

      setFiles([]);
    } catch (err) {
      console.error(err);
      alert(`上傳失敗: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUploading(false);
    }
  };

  const menuCards = allItems.map(item => ({
    title: item.item_name,
    description: item.description,
    price: item.price,
    category: item.category
  }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Back Button */}
        {onBackToHome && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Button
              onClick={onBackToHome}
              variant="outline"
              className="mb-6 bg-white/10 backdrop-blur-sm border-white/20 text-white hover:bg-white/20"
            >
              ← 返回首頁
            </Button>
          </motion.div>
        )}

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <Badge variant="secondary" className="mb-4 bg-white/20 backdrop-blur-sm text-white border-white/30">
            AI-Powered Menu Upload
          </Badge>
          <h1 className="text-5xl md:text-6xl font-bold mb-4 text-white bg-clip-text bg-gradient-to-r from-white to-purple-200">
            📤 上傳菜單圖片
          </h1>
          <p className="text-lg text-purple-200">AI 將自動識別並提取菜單內容</p>
        </motion.div>

        {/* File Upload Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <Card className="mb-8 bg-white/10 backdrop-blur-lg border-white/20 shadow-2xl">
            <CardContent className="pt-6">
              <FileUpload onChange={handleFileChange} />

              {files.length > 0 && (
                <div className="mt-6 flex justify-center">
                  <MovingBorderButton
                    onClick={handleUpload}
                    disabled={uploading}
                    containerClassName="w-full md:w-auto"
                    className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
                    borderRadius="1rem"
                    duration={3000}
                  >
                    {uploading ? (
                      <span className="flex items-center gap-2">
                        <span className="animate-spin">⏳</span>
                        上傳中...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        📤 上傳 {files.length} 張圖片
                      </span>
                    )}
                  </MovingBorderButton>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* OCR Progress Section */}
        {uploads.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Card className="mb-8 bg-white/10 backdrop-blur-lg border-white/20 shadow-2xl">
              <CardHeader>
                <CardTitle className="text-2xl text-white flex items-center gap-2">
                  <span className="bg-blue-500 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm">🔍</span>
                  OCR 處理狀態
                </CardTitle>
                <CardDescription className="text-purple-200">
                  AI 正在分析您的菜單
                </CardDescription>
              </CardHeader>
              <CardContent>
                {uploads.map((upload) => (
                  <div key={upload.uploadId} className="mb-6 last:mb-0">
                    <p className="text-sm font-medium text-white mb-3">{upload.file_name}</p>
                    <MultiStepLoader
                      loadingStates={loadingStates}
                      loading={upload.ocr_status !== 'completed' && upload.ocr_status !== 'failed'}
                      currentState={getCurrentLoadingState(upload.ocr_status)}
                      duration={2000}
                    />
                    {upload.ocr_status === 'completed' && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="mt-4 p-4 bg-green-500/20 rounded-lg border border-green-500/30"
                      >
                        <p className="text-green-300 font-semibold">
                          ✅ 完成！找到 {upload.items_count} 個菜單項目
                        </p>
                      </motion.div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Menu Items Display */}
        {allItems.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <Card className="bg-white/10 backdrop-blur-lg border-white/20 shadow-2xl">
              <CardHeader>
                <CardTitle className="text-2xl text-white flex items-center gap-2">
                  <span className="text-3xl">🍽️</span>
                  提取的菜單項目
                </CardTitle>
                <CardDescription className="text-purple-200">
                  {allItems.length} 個項目
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FocusCards cards={menuCards} />
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default UploadPage;
