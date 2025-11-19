import { useState, useEffect } from "react";
import { useAuth } from "react-oidc-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  upload_id: string;
}

interface Upload {
  uploadId: string;
  file_url: string;
  file_name: string;
}

interface RecommendationItem {
  item_name: string;
  price: number;
  quantity: number;
}

interface Recommendation {
  name: string;
  items: RecommendationItem[];
  totalPrice: number;
  reason: string;
  tags?: string[];
}

interface MenuVisualizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recommendation: Recommendation;
  allItems: MenuItem[];
  uploads: Upload[];
}

const MenuVisualizationDialog: React.FC<MenuVisualizationDialogProps> = ({
  open,
  onOpenChange,
  recommendation,
  allItems,
  uploads,
}) => {
  const auth = useAuth();
  const [annotatedImages, setAnnotatedImages] = useState<Record<string, string>>({});
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Find menu items that match the recommendation
  const selectedItems = allItems.filter((item) =>
    recommendation.items.some((recItem) => recItem.item_name === item.item_name)
  );

  // Group items by upload_id
  const itemsByUpload = selectedItems.reduce((acc, item) => {
    if (!acc[item.upload_id]) {
      acc[item.upload_id] = [];
    }
    acc[item.upload_id].push(item);
    return acc;
  }, {} as Record<string, MenuItem[]>);

  const relevantUploadIds = Object.keys(itemsByUpload);
  const relevantUploads = uploads.filter((u) => relevantUploadIds.includes(u.uploadId));

  // Clear cache when dialog opens with a new recommendation
  useEffect(() => {
    if (open) {
      setAnnotatedImages({});
      setSelectedUploadId(null);
    }
  }, [open, recommendation.name]);

  // Set initial selected upload
  useEffect(() => {
    if (relevantUploads.length > 0 && !selectedUploadId) {
      setSelectedUploadId(relevantUploads[0].uploadId);
    }
  }, [relevantUploads, selectedUploadId]);

  // Fetch annotated image when upload is selected
  useEffect(() => {
    if (!selectedUploadId || !open || !auth.user?.access_token) return;

    // If already fetched, don't fetch again
    if (annotatedImages[selectedUploadId]) return;

    const fetchAnnotatedImage = async () => {
      setLoading(true);
      try {
        const itemIds = itemsByUpload[selectedUploadId].map((item) => item.item_id);

        const res = await fetch(
          `${import.meta.env.VITE_API_BASE}/uploads/${selectedUploadId}/annotate`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${auth.user?.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ item_ids: itemIds }),
          }
        );

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          console.error('Failed to fetch annotated image:', errorData);
          throw new Error(errorData.error || "Failed to fetch annotated image");
        }

        const data = await res.json();

        setAnnotatedImages((prev) => ({
          ...prev,
          [selectedUploadId]: data.annotatedImage,
        }));
      } catch (error) {
        console.error("❌ Failed to fetch annotated image:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAnnotatedImage();
  }, [selectedUploadId, open, auth.user?.access_token, annotatedImages, itemsByUpload]);

  const currentUpload = relevantUploads.find((u) => u.uploadId === selectedUploadId);
  const currentAnnotatedImage = selectedUploadId ? annotatedImages[selectedUploadId] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-full max-h-[95vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">{recommendation.name}</DialogTitle>
          <DialogDescription>
            Total: ${recommendation.totalPrice.toFixed(2)}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {/* Recommendation Items List */}
          <div className="mb-4 p-4 bg-blue-50 rounded-lg">
            <h3 className="font-semibold mb-2">Selected Items:</h3>
            <ul className="space-y-1">
              {recommendation.items.map((item, idx) => (
                <li key={idx} className="text-sm">
                  <span className="font-medium">
                    {item.quantity > 1 && `${item.quantity}x `}
                    {item.item_name}
                  </span>
                  <span className="text-gray-600 ml-2">
                    ${(item.price * item.quantity).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Upload selector if multiple uploads */}
          {relevantUploads.length > 1 && (
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">Items from multiple menus:</p>
              <div className="flex gap-2">
                {relevantUploads.map((upload) => (
                  <button
                    key={upload.uploadId}
                    onClick={() => setSelectedUploadId(upload.uploadId)}
                    className={`px-4 py-2 rounded text-sm ${
                      selectedUploadId === upload.uploadId
                        ? "bg-blue-500 text-white"
                        : "bg-gray-200 hover:bg-gray-300"
                    }`}
                  >
                    {upload.file_name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Annotated Menu Image */}
          {loading && (
            <div className="flex items-center justify-center p-8">
              <p className="text-gray-600">Loading annotated menu...</p>
            </div>
          )}

          {!loading && currentAnnotatedImage && (
            <div className="relative inline-block">
              <img
                src={currentAnnotatedImage}
                alt={`Annotated menu - ${currentUpload?.file_name}`}
                className="max-w-full h-auto rounded-lg shadow-lg"
              />
            </div>
          )}

          {!loading && selectedUploadId && !currentAnnotatedImage && (
            <p className="text-sm text-gray-500 mt-4">
              Failed to load annotated menu image.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MenuVisualizationDialog;
