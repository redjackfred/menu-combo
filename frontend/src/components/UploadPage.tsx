import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "react-oidc-context";

interface FileWithPreview {
  file: File;
  preview: string;
}

interface Upload {
  upload_id: string;
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

function useUploadPolling(uploadId: string | null) {
  const [upload, setUpload] = useState<Upload | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const auth = useAuth();

  useEffect(() => {
    if (!uploadId || !auth.user?.access_token) return;

    const fetchStatus = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_BASE}/uploads/${uploadId}`,
          {
            headers: {
              'Authorization': `Bearer ${auth.user.access_token}`
            }
          }
        );

        if (response.ok) {
          const data = await response.json();
          setUpload(data.upload);
          setItems(data.items || []);
        }
      } catch (error) {
        console.error('Failed to fetch upload status:', error);
      }
    };

    // Initial fetch
    fetchStatus();

    // Poll every 2 seconds if not completed/failed
    const interval = setInterval(() => {
      if (upload?.ocr_status === 'completed' || upload?.ocr_status === 'failed') {
        clearInterval(interval);
        return;
      }
      fetchStatus();
    }, 2000);

    return () => clearInterval(interval);
  }, [uploadId, auth.user?.access_token, upload?.ocr_status]);

  return { upload, items };
}

const UploadPage: React.FC = () => {
  const auth = useAuth();
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const { upload, items } = useUploadPolling(selectedUploadId);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);

    if (selectedFiles.length > 5) {
      alert("最多只能選擇 5 張圖片！");
      return;
    }

    const filesWithPreview = selectedFiles.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));

    setFiles(filesWithPreview);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => {
      const newFiles = [...prev];
      URL.revokeObjectURL(newFiles[index].preview); // Clean up memory
      newFiles.splice(index, 1);
      return newFiles;
    });
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      alert("請先選擇圖片！");
      return;
    }

    // Check if user is authenticated
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
      // Append all files with the same field name "images"
      files.forEach((fileWithPreview) => {
        formData.append("images", fileWithPreview.file);
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
      console.log("✅ Uploaded:", data);

      // If we have successful uploads, track the first one for OCR status
      if (data.uploads && data.uploads.length > 0) {
        setSelectedUploadId(data.uploads[0].upload_id);
      }

      alert(
        `成功上傳 ${data.successCount} 張圖片！\n` +
        `總共: ${data.totalFiles} 張\n` +
        `成功: ${data.successCount} 張\n` +
        (data.errorCount > 0 ? `失敗: ${data.errorCount} 張` : "")
      );

      // Clear files after successful upload
      files.forEach((f) => URL.revokeObjectURL(f.preview));
      setFiles([]);
    } catch (err) {
      console.error(err);
      alert(`上傳失敗: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-8 font-sans max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">上傳菜單圖片</h1>
      <p className="text-gray-600 mb-4">最多可選擇 5 張圖片</p>

      <Input
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        className="mb-4"
      />

      {files.length > 0 && (
        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">已選擇 {files.length} 張圖片：</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {files.map((fileWithPreview, index) => (
              <div key={index} className="relative group">
                <img
                  src={fileWithPreview.preview}
                  alt={`preview-${index}`}
                  className="w-full h-40 object-cover rounded-md border-2 border-gray-200"
                />
                <div className="absolute top-2 right-2">
                  <Button
                    onClick={() => removeFile(index)}
                    className="bg-red-500 hover:bg-red-600 text-white rounded-full w-8 h-8 p-0"
                    size="sm"
                  >
                    ✕
                  </Button>
                </div>
                <p className="text-xs text-gray-600 mt-1 truncate">
                  {fileWithPreview.file.name}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <Button
        onClick={handleUpload}
        disabled={files.length === 0 || uploading}
        className="w-full bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-400"
      >
        {uploading ? "上傳中..." : `上傳 ${files.length} 張圖片`}
      </Button>

      {/* OCR Status display */}
      {upload && (
        <div className="mt-8 p-6 border-2 rounded-lg shadow-sm bg-white">
          <h2 className="text-xl font-semibold mb-4">OCR 處理狀態</h2>

          <div className="mb-4">
            <p className="text-sm text-gray-600">檔案名稱: {upload.file_name}</p>
          </div>

          {upload.ocr_status === 'pending' && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md">
              <p className="text-yellow-700 font-medium">⏳ 等待處理中...</p>
            </div>
          )}

          {upload.ocr_status === 'processing' && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
              <p className="text-blue-700 font-medium">🔄 正在提取菜單項目...</p>
            </div>
          )}

          {upload.ocr_status === 'completed' && (
            <div>
              <div className="p-4 bg-green-50 border border-green-200 rounded-md mb-4">
                <p className="text-green-700 font-medium">✅ 成功提取 {upload.items_count} 個菜單項目</p>
              </div>

              {/* Display menu items */}
              {items.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-lg font-semibold mb-3">提取的菜單項目：</h3>
                  <div className="space-y-3">
                    {items.map((item) => (
                      <div
                        key={item.item_id}
                        className="border rounded-lg p-4 hover:shadow-md transition-shadow bg-gray-50"
                      >
                        <div className="flex justify-between items-start">
                          <h4 className="font-bold text-lg">{item.item_name}</h4>
                          <span className="text-lg font-semibold text-green-600">
                            {item.price !== null ? `$${item.price.toFixed(2)}` : 'N/A'}
                          </span>
                        </div>

                        {item.description && (
                          <p className="text-sm text-gray-700 mt-2">{item.description}</p>
                        )}

                        {item.category && (
                          <span className="inline-block mt-2 px-3 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                            {item.category}
                          </span>
                        )}

                        {item.confidence_score !== null && (
                          <p className="text-xs text-gray-500 mt-2">
                            信心度: {(item.confidence_score * 100).toFixed(0)}%
                          </p>
                        )}

                        {item.notes && (
                          <p className="text-xs text-gray-500 italic mt-2">
                            備註: {item.notes}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {upload.ocr_status === 'failed' && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-700 font-medium">❌ 處理失敗</p>
              {upload.ocr_error && (
                <p className="text-sm text-red-600 mt-2">{upload.ocr_error}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default UploadPage;

