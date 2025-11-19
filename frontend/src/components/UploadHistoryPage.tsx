import React, { useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const API_BASE = import.meta.env.VITE_API_BASE || 'https://hymek82qkl.execute-api.us-east-1.amazonaws.com';

interface Upload {
  upload_id: string;
  user_id: string;
  file_url: string;
  file_name: string;
  s3_key: string;
  file_size: number;
  mime_type: string;
  upload_status: string;
  ocr_status: string;
  ocr_started_at: string | null;
  ocr_completed_at: string | null;
  ocr_error: string | null;
  items_count: number;
  created_at: string;
  updated_at: string;
}

interface MenuItem {
  item_id: string;
  item_name: string;
  price: number;
  description: string;
  category: string;
}

interface UploadHistoryPageProps {
  onBackToHome?: () => void;
  onUseForRecommendation?: (uploadId: string) => void;
}

const UploadHistoryPage: React.FC<UploadHistoryPageProps> = ({
  onBackToHome,
  onUseForRecommendation
}) => {
  const auth = useAuth();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUpload, setSelectedUpload] = useState<Upload | null>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchUploads();
  }, []);

  const fetchUploads = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/uploads`, {
        headers: {
          'Authorization': `Bearer ${auth.user?.access_token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch uploads');
      }

      const data = await response.json();
      setUploads(data.uploads);
    } catch (err) {
      console.error('Error fetching uploads:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const fetchMenuItems = async (uploadId: string) => {
    try {
      setLoadingItems(true);
      const response = await fetch(`${API_BASE}/uploads/${uploadId}`, {
        headers: {
          'Authorization': `Bearer ${auth.user?.access_token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch menu items');
      }

      const data = await response.json();
      setMenuItems(data.items || []);
    } catch (err) {
      console.error('Error fetching menu items:', err);
      setMenuItems([]);
    } finally {
      setLoadingItems(false);
    }
  };

  const handleDelete = async (uploadId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!confirm('Are you sure you want to delete this upload? This will also delete all extracted menu items.')) {
      return;
    }

    try {
      setDeletingId(uploadId);
      const response = await fetch(`${API_BASE}/uploads/${uploadId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${auth.user?.access_token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to delete upload');
      }

      // Refresh the list
      await fetchUploads();

      // Close detail view if this upload was selected
      if (selectedUpload?.upload_id === uploadId) {
        setSelectedUpload(null);
      }
    } catch (err) {
      console.error('Error deleting upload:', err);
      alert('Failed to delete upload');
    } finally {
      setDeletingId(null);
    }
  };

  const handleViewDetails = async (upload: Upload) => {
    console.log('Viewing upload details:', upload);
    setSelectedUpload(upload);
    if (upload.ocr_status === 'completed' && upload.items_count > 0) {
      await fetchMenuItems(upload.upload_id);
    }
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Invalid date';
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (err) {
      console.error('Error formatting date:', err);
      return 'N/A';
    }
  };

  const getStatusBadge = (ocrStatus: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      'pending': { color: 'bg-yellow-100 text-yellow-700', text: 'Pending' },
      'processing': { color: 'bg-blue-100 text-blue-700', text: 'Processing...' },
      'completed': { color: 'bg-green-100 text-green-700', text: 'Completed' },
      'failed': { color: 'bg-red-100 text-red-700', text: 'Failed' }
    };
    const status = statusMap[ocrStatus] || statusMap['pending'];
    return <Badge className={status.color}>{status.text}</Badge>;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white p-4 sm:p-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading upload history...</p>
          </div>
        </div>
      </div>
    );
  }

  if (selectedUpload) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white p-4 sm:p-8">
        <div className="max-w-6xl mx-auto">
          <Button onClick={() => setSelectedUpload(null)} variant="outline" className="mb-6">
            ← Back to Uploads
          </Button>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-2xl">Upload Details</CardTitle>
              <CardDescription>
                Uploaded: {formatDate(selectedUpload.created_at)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div>
                  <p className="text-sm text-gray-600">File Name</p>
                  <p className="text-lg font-semibold truncate">{selectedUpload.file_name || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">File Size</p>
                  <p className="text-lg font-semibold">
                    {selectedUpload.file_size ? (selectedUpload.file_size / 1024).toFixed(2) : 'N/A'} KB
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">OCR Status</p>
                  <div className="mt-1">{getStatusBadge(selectedUpload.ocr_status || 'pending')}</div>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Items Found</p>
                  <p className="text-lg font-semibold">{selectedUpload.items_count || 0}</p>
                </div>
              </div>

              {selectedUpload.file_url && (
                <div className="mb-6">
                  <img
                    src={selectedUpload.file_url}
                    alt={selectedUpload.file_name || 'Menu image'}
                    className="w-full max-w-2xl mx-auto rounded-lg shadow-lg"
                    onError={(e) => {
                      e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23ddd" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%23999"%3EImage not available%3C/text%3E%3C/svg%3E';
                    }}
                  />
                </div>
              )}

              {onUseForRecommendation && selectedUpload.ocr_status === 'completed' && (
                <Button
                  onClick={() => onUseForRecommendation(selectedUpload.upload_id)}
                  className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700"
                >
                  Use for Recommendations
                </Button>
              )}
            </CardContent>
          </Card>

          {loadingItems ? (
            <Card>
              <CardContent className="pt-6 text-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading menu items...</p>
              </CardContent>
            </Card>
          ) : menuItems.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Extracted Menu Items ({menuItems.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {menuItems.map((item) => (
                    <div key={item.item_id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-semibold text-lg">{item.item_name}</h3>
                        <span className="font-bold text-green-600">
                          ${item.price != null ? Number(item.price).toFixed(2) : 'N/A'}
                        </span>
                      </div>
                      {item.description && (
                        <p className="text-sm text-gray-600 mb-2">{item.description}</p>
                      )}
                      {item.category && (
                        <Badge variant="outline" className="text-xs">{item.category}</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : selectedUpload.ocr_status === 'completed' ? (
            <Card>
              <CardContent className="pt-6 text-center py-12">
                <p className="text-gray-500">No menu items extracted</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        {onBackToHome && (
          <Button onClick={onBackToHome} variant="outline" className="mb-6">
            ← Back to Home
          </Button>
        )}

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-3xl flex items-center gap-3">
              📁 Upload History
            </CardTitle>
            <CardDescription>
              View and manage all your uploaded menu images
            </CardDescription>
          </CardHeader>
        </Card>

        {error && (
          <Card className="mb-6 border-red-200">
            <CardContent className="pt-6">
              <p className="text-red-600">❌ {error}</p>
            </CardContent>
          </Card>
        )}

        {uploads.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center py-12">
              <p className="text-gray-500 text-lg mb-4">No uploads yet</p>
              <p className="text-gray-400">Upload menu photos to see them here</p>
              {onBackToHome && (
                <Button onClick={onBackToHome} className="mt-6">
                  Upload Menu
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {uploads.map((upload) => (
              <Card
                key={upload.upload_id}
                className="hover:shadow-lg transition-shadow cursor-pointer relative"
                onClick={() => handleViewDetails(upload)}
              >
                <CardHeader className="pb-3">
                  <div className="aspect-video w-full mb-3 overflow-hidden rounded-md bg-gray-100">
                    <img
                      src={upload.file_url}
                      alt={upload.file_name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <CardTitle className="text-lg truncate">{upload.file_name}</CardTitle>
                  <CardDescription>{formatDate(upload.created_at)}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Status:</span>
                      {getStatusBadge(upload.ocr_status)}
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Items:</span>
                      <span className="font-semibold">{upload.items_count}</span>
                    </div>
                  </div>
                  <Button
                    onClick={(e) => handleDelete(upload.upload_id, e)}
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    disabled={deletingId === upload.upload_id}
                  >
                    {deletingId === upload.upload_id ? 'Deleting...' : 'Delete'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default UploadHistoryPage;
