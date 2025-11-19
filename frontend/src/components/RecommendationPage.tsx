import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "react-oidc-context";
import MenuVisualizationDialog from "./MenuVisualizationDialog";
import OcrProgressIndicator from "./OcrProgressIndicator";

interface FileWithPreview {
  file: File;
  preview: string;
}

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
  upload_id: string;
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

interface Preferences {
  budget?: { min: number | undefined; max: number | undefined };
  people?: number | undefined;
  dietaryRestrictions?: string[];
  spicyLevel?: string;
}

interface RecommendationPageProps {
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

const RecommendationPage: React.FC<RecommendationPageProps> = ({ onBackToHome }) => {
  const auth = useAuth();

  // Step 1: Upload
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadIds, setUploadIds] = useState<string[]>([]);

  // Step 2: OCR
  const { uploads, allItems } = useMultipleUploadsPolling(uploadIds);
  const [uploadStartTimes, setUploadStartTimes] = useState<Map<string, Date>>(new Map());

  // Track start time when upload begins processing
  useEffect(() => {
    uploads.forEach(upload => {
      if ((upload.ocr_status === 'processing' || upload.ocr_status === 'pending') &&
          !uploadStartTimes.has(upload.uploadId)) {
        setUploadStartTimes(prev => new Map(prev).set(upload.uploadId, new Date()));
      }
    });
  }, [uploads]);

  // Step 3: Preferences
  const [preferences, setPreferences] = useState<Preferences>({
    people: 1,
    budget: { min: 0, max: 100 },
    dietaryRestrictions: [],
    spicyLevel: 'any'
  });
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);

  // Step 4: Recommendations
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);

  // Visualization dialog
  const [visualizationOpen, setVisualizationOpen] = useState(false);
  const [selectedRecommendation, setSelectedRecommendation] = useState<Recommendation | null>(null);

  const allUploadsCompleted = uploads.length > 0 && uploads.every(u => u.ocr_status === 'completed');

  // Load preferences on mount and when Step 3 appears
  useEffect(() => {
    if (!auth.user?.access_token) return;

    const loadPreferences = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE}/preferences`, {
          headers: {
            'Authorization': `Bearer ${auth.user?.access_token}`
          }
        });

        if (res.ok) {
          const data = await res.json();
          setPreferences(data.preferences);
        }
      } catch (error) {
        console.error('Failed to load preferences:', error);
      } finally {
        setPreferencesLoaded(true);
      }
    };

    loadPreferences();
  }, [auth.user?.access_token]);

  // Reload preferences when Step 3 (preferences section) becomes visible
  useEffect(() => {
    if (!allUploadsCompleted || !auth.user?.access_token) return;

    const reloadPreferences = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE}/preferences`, {
          headers: {
            'Authorization': `Bearer ${auth.user?.access_token}`
          }
        });

        if (res.ok) {
          const data = await res.json();
          setPreferences(data.preferences);
          setPreferencesLoaded(true);
        }
      } catch (error) {
        console.error('Failed to reload preferences:', error);
      }
    };

    reloadPreferences();
  }, [allUploadsCompleted, auth.user?.access_token]);

  // Auto-save preferences when they change (debounced)
  useEffect(() => {
    if (!preferencesLoaded || !auth.user?.access_token) return;

    const savePreferences = async () => {
      // Only save if all required fields have values
      if (
        preferences.people === undefined ||
        preferences.budget?.min === undefined ||
        preferences.budget?.max === undefined
      ) {
        return;
      }

      setSavingPreferences(true);
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE}/preferences`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${auth.user?.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            people: preferences.people,
            budget: {
              min: preferences.budget.min,
              max: preferences.budget.max
            },
            dietaryRestrictions: preferences.dietaryRestrictions,
            spicyLevel: preferences.spicyLevel
          })
        });

        if (res.ok) {
        }
      } catch (error) {
        console.error('Failed to save preferences:', error);
      } finally {
        setSavingPreferences(false);
      }
    };

    // Debounce saving
    const timeoutId = setTimeout(savePreferences, 1000);
    return () => clearTimeout(timeoutId);
  }, [preferences, preferencesLoaded, auth.user?.access_token]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);

    if (selectedFiles.length > 5) {
      alert("Maximum 5 images allowed!");
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
      URL.revokeObjectURL(newFiles[index].preview);
      newFiles.splice(index, 1);
      return newFiles;
    });
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      alert("Please select images first!");
      return;
    }

    if (!auth.isAuthenticated || !auth.user?.access_token) {
      alert("Please sign in first!");
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

      if (data.uploads && data.uploads.length > 0) {
        const ids = data.uploads.map((u: any) => u.uploadId);
        setUploadIds(ids);
      }

      files.forEach((f) => URL.revokeObjectURL(f.preview));
      setFiles([]);
    } catch (err) {
      console.error(err);
      alert(`Upload failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUploading(false);
    }
  };

  const handleGetRecommendations = async () => {

    if (!uploadIds || uploadIds.length === 0) {
      alert("Please upload menu first!");
      return;
    }

    if (!auth.user?.access_token) {
      alert("Please sign in first!");
      return;
    }

    // Validate preferences
    const errors: string[] = [];

    if (preferences.people === undefined || preferences.people === null) {
      errors.push("Please enter the number of people");
    }

    if (preferences.budget?.min === undefined || preferences.budget?.min === null) {
      errors.push("Please enter minimum budget");
    }

    if (preferences.budget?.max === undefined || preferences.budget?.max === null) {
      errors.push("Please enter maximum budget");
    }

    if (errors.length > 0) {
      alert(errors.join('\n'));
      return;
    }

    setLoadingRecommendations(true);

    try {
      const requestBody = {
        uploadIds: uploadIds,
        preferences: {
          people: preferences.people,
          budget: {
            min: preferences.budget?.min ?? 0,
            max: preferences.budget?.max ?? 100
          },
          dietaryRestrictions: preferences.dietaryRestrictions,
          spicyLevel: preferences.spicyLevel
        }
      };


      const res = await fetch(`${import.meta.env.VITE_API_BASE}/recommend`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${auth.user.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Recommendation failed" }));
        throw new Error(errorData.error || "Recommendation failed");
      }

      const data = await res.json();
      setRecommendations(data.recommendations);
    } catch (err) {
      console.error(err);
      alert(`Recommendation failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setLoadingRecommendations(false);
    }
  };

  const toggleDietaryRestriction = (restriction: string) => {
    setPreferences(prev => ({
      ...prev,
      dietaryRestrictions: prev.dietaryRestrictions?.includes(restriction)
        ? prev.dietaryRestrictions.filter(r => r !== restriction)
        : [...(prev.dietaryRestrictions || []), restriction]
    }));
  };

  const handleRecommendationClick = (rec: Recommendation) => {
    setSelectedRecommendation(rec);
    setVisualizationOpen(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Back Button */}
        {onBackToHome && (
          <Button
            onClick={onBackToHome}
            variant="outline"
            className="mb-6"
          >
            ← Back to Home
          </Button>
        )}

        {/* Header */}
        <div className="text-center mb-8">
          <Badge variant="secondary" className="mb-3">
            AI-Powered Recommendations
          </Badge>
          <h1 className="text-4xl font-bold mb-3 text-gray-900">🍽️ Menu Combo AI</h1>
          <p className="text-lg text-gray-600">Upload menu photos and get personalized meal combo suggestions</p>
        </div>

        {/* Step 1: Upload Menu */}
        <Card className="mb-8 hover:shadow-lg transition-shadow">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-2xl flex items-center gap-2">
                  <span className="bg-blue-100 text-blue-600 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold">1</span>
                  Upload Menu Photos
                </CardTitle>
                <CardDescription className="mt-2">
                  Select up to 5 menu images (JPG, PNG)
                </CardDescription>
              </div>
              <span className="text-4xl">📸</span>
            </div>
          </CardHeader>
          <CardContent>
            <Input
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileChange}
              className="mb-4"
            />

            {files.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="outline">{files.length} image(s) selected</Badge>
                  <Badge variant="secondary">Max 5</Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {files.map((fileWithPreview, index) => (
                    <div key={index} className="relative group">
                      <img
                        src={fileWithPreview.preview}
                        alt={`preview-${index}`}
                        className="w-full h-40 object-cover rounded-lg border-2 border-gray-200 shadow-sm"
                      />
                      <div className="absolute top-2 right-2">
                        <Button
                          onClick={() => removeFile(index)}
                          className="bg-red-500 hover:bg-red-600 text-white rounded-full w-8 h-8 p-0 shadow-lg"
                          size="sm"
                        >
                          ✕
                        </Button>
                      </div>
                      <p className="text-xs text-gray-600 mt-2 truncate font-medium">
                        {fileWithPreview.file.name}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Separator className="my-4" />

            <Button
              onClick={handleUpload}
              disabled={files.length === 0 || uploading}
              className="w-full bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400 py-6 text-lg"
              size="lg"
            >
              {uploading ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  Uploading...
                </>
              ) : (
                `📤 Upload ${files.length || 0} Image(s)`
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Step 2: OCR Processing */}
        {uploads.length > 0 && (
          <Card className="mb-8 hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-2xl flex items-center gap-2">
                    <span className="bg-purple-100 text-purple-600 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold">2</span>
                    Menu Recognition
                  </CardTitle>
                  <CardDescription className="mt-2">
                    AI extracts menu items and prices from your photos
                  </CardDescription>
                </div>
                <span className="text-4xl">🔍</span>
              </div>
            </CardHeader>
            <CardContent>
              {/* Progress indicators for each upload */}
              {uploads.length > 0 && (
                <div className="space-y-4 mb-6">
                  {uploads.map((upload) => (
                    <div key={upload.uploadId}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-medium text-gray-700 truncate">
                          {upload.file_name}
                        </span>
                      </div>
                      <OcrProgressIndicator
                        status={upload.ocr_status}
                        startTime={uploadStartTimes.get(upload.uploadId)}
                        itemsCount={upload.items_count}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Overall completion message */}
              {allUploadsCompleted && (
                <Card className="bg-green-50 border-green-200 mb-4">
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">✅</span>
                      <div>
                        <p className="text-green-700 font-semibold">Recognition complete!</p>
                        <Badge variant="secondary" className="mt-1">
                          Found {allItems.length} menu items
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Show extracted items */}
              {allItems.length > 0 && (
                <div className="mt-4">
                  <Separator className="mb-4" />
                  <div className="flex items-center gap-2 mb-3">
                    <h3 className="text-sm font-semibold text-gray-700">Extracted Items</h3>
                    <Badge>{allItems.length} items</Badge>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-64 overflow-y-auto p-2 bg-gray-50 rounded-lg">
                    {allItems.map((item) => (
                      <Card key={item.item_id} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-3">
                          <p className="font-semibold text-sm text-gray-900">{item.item_name}</p>
                          <Badge variant="outline" className="mt-1 text-green-600 border-green-600">
                            ${item.price !== null ? Number(item.price).toFixed(2) : 'N/A'}
                          </Badge>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 3: Set Preferences */}
        {allUploadsCompleted && (
          <Card className="mb-8 hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-2xl flex items-center gap-2">
                    <span className="bg-green-100 text-green-600 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold">3</span>
                    Set Your Preferences
                  </CardTitle>
                  <CardDescription className="mt-2">
                    Customize your dining experience
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {!preferencesLoaded && (
                    <Badge variant="secondary" className="animate-pulse">
                      Loading...
                    </Badge>
                  )}
                  <span className="text-4xl">⚙️</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-6">
                {/* People */}
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-700">👥 Number of People</label>
                  <Input
                    type="number"
                    min="1"
                    max="10"
                    value={preferences.people ?? ''}
                    onChange={(e) => {
                      const val = e.target.value === '' ? undefined : parseInt(e.target.value);
                      setPreferences({ ...preferences, people: val });
                    }}
                    className="w-full"
                    placeholder="e.g., 2"
                  />
                </div>

                {/* Budget */}
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-700">💰 Budget Range ($)</label>
                  <div className="flex gap-2 items-center">
                    <Input
                      type="number"
                      min="0"
                      placeholder="Min"
                      value={preferences.budget?.min ?? ''}
                      onChange={(e) => {
                        const val = e.target.value === '' ? undefined : parseInt(e.target.value);
                        setPreferences({
                          ...preferences,
                          budget: { min: val, max: preferences.budget?.max }
                        });
                      }}
                    />
                    <span className="text-gray-500">—</span>
                    <Input
                      type="number"
                      min="0"
                      placeholder="Max"
                      value={preferences.budget?.max ?? ''}
                      onChange={(e) => {
                        const val = e.target.value === '' ? undefined : parseInt(e.target.value);
                        setPreferences({
                          ...preferences,
                          budget: { min: preferences.budget?.min, max: val }
                        });
                      }}
                    />
                  </div>
                </div>

                {/* Dietary Restrictions */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold mb-3 text-gray-700">🥗 Dietary Restrictions</label>
                  <div className="flex flex-wrap gap-2">
                    {['vegetarian', 'no-seafood', 'no-pork', 'halal'].map(restriction => (
                      <Button
                        key={restriction}
                        size="sm"
                        variant={preferences.dietaryRestrictions?.includes(restriction) ? "default" : "outline"}
                        onClick={() => toggleDietaryRestriction(restriction)}
                        className="transition-all"
                      >
                        {restriction === 'vegetarian' && '🥬 Vegetarian'}
                        {restriction === 'no-seafood' && '🚫🦐 No Seafood'}
                        {restriction === 'no-pork' && '🚫🐷 No Pork'}
                        {restriction === 'halal' && '☪️ Halal'}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Spicy Level */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold mb-3 text-gray-700">🌶️ Spice Preference</label>
                  <div className="flex flex-wrap gap-2">
                    {['any', 'none', 'mild', 'medium', 'hot'].map(level => (
                      <Button
                        key={level}
                        size="sm"
                        variant={preferences.spicyLevel === level ? "default" : "outline"}
                        onClick={() => setPreferences({ ...preferences, spicyLevel: level })}
                        className="transition-all"
                      >
                        {level === 'any' && '🌟 Any'}
                        {level === 'none' && '❌ None'}
                        {level === 'mild' && '🟢 Mild'}
                        {level === 'medium' && '🟡 Medium'}
                        {level === 'hot' && '🔥 Hot'}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              <Separator className="my-6" />

              {/* Save indicator and Reset button */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  {savingPreferences && (
                    <Badge variant="secondary" className="animate-pulse">
                      💾 Saving...
                    </Badge>
                  )}
                  {!savingPreferences && preferencesLoaded && (
                    <Badge variant="outline" className="text-green-600 border-green-600">
                      ✅ Auto-saved
                    </Badge>
                  )}
                </div>
                <Button
                  onClick={() => {
                    setPreferences({
                      people: 1,
                      budget: { min: 0, max: 100 },
                      dietaryRestrictions: [],
                      spicyLevel: 'any'
                    });
                  }}
                  variant="outline"
                  size="sm"
                >
                  🔄 Reset to Default
                </Button>
              </div>

              <Button
                onClick={handleGetRecommendations}
                disabled={loadingRecommendations || !uploadIds || uploadIds.length === 0 || allItems.length === 0}
                className="w-full bg-gradient-to-r from-green-500 to-green-600 text-white hover:from-green-600 hover:to-green-700 disabled:bg-gray-400 text-lg py-6 shadow-lg"
                size="lg"
              >
                {loadingRecommendations ? (
                  <>
                    <span className="animate-spin mr-2">⚙️</span>
                    AI Generating...
                  </>
                ) : (
                  "🤖 Get AI Recommendations"
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Recommendations */}
        {recommendations.length > 0 && (
          <Card className="mb-8 hover:shadow-lg transition-shadow border-2 border-yellow-200">
            <CardHeader className="bg-gradient-to-r from-yellow-50 to-orange-50">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-2xl flex items-center gap-2">
                    <span className="bg-yellow-100 text-yellow-600 rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold">4</span>
                    AI Recommended Combos
                  </CardTitle>
                  <CardDescription className="mt-2">
                    Click on any combo to see items highlighted on the menu
                  </CardDescription>
                </div>
                <span className="text-4xl">✨</span>
              </div>
              <div className="mt-3">
                <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                  {recommendations.length} combos found
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid md:grid-cols-3 gap-6">
                {recommendations.map((rec, idx) => (
                  <Card
                    key={idx}
                    onClick={() => handleRecommendationClick(rec)}
                    className="cursor-pointer hover:shadow-2xl hover:border-blue-400 transition-all bg-gradient-to-br from-white to-blue-50 border-2"
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between mb-2">
                        <Badge variant="outline" className="text-xs">
                          Combo #{idx + 1}
                        </Badge>
                        <Badge className="text-lg font-bold bg-green-500">
                          ${rec.totalPrice.toFixed(2)}
                        </Badge>
                      </div>
                      <CardTitle className="text-xl text-blue-700">
                        {rec.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Separator className="mb-4" />

                      <div className="space-y-2 mb-4">
                        {rec.items.map((item, itemIdx) => (
                          <div key={itemIdx} className="flex justify-between text-sm bg-white p-2 rounded-md border">
                            <span className="font-medium text-gray-900">
                              {item.quantity > 1 && (
                                <Badge variant="secondary" className="mr-1 text-xs">
                                  {item.quantity}x
                                </Badge>
                              )}
                              {item.item_name}
                            </span>
                            <span className="text-green-600 font-semibold">
                              ${(item.price * item.quantity).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>

                      <Separator className="mb-3" />

                      <p className="text-sm text-gray-700 mb-3 italic">
                        💡 {rec.reason}
                      </p>

                      {rec.tags && rec.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-2">
                          {rec.tags.map((tag, tagIdx) => (
                            <Badge key={tagIdx} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}

                      <div className="mt-4 pt-3 border-t border-gray-200">
                        <p className="text-xs text-center text-gray-500">
                          👆 Click to visualize on menu
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Menu Visualization Dialog */}
        {selectedRecommendation && (
          <MenuVisualizationDialog
            open={visualizationOpen}
            onOpenChange={setVisualizationOpen}
            recommendation={selectedRecommendation}
            allItems={allItems}
            uploads={uploads}
          />
        )}
      </div>
    </div>
  );
};

export default RecommendationPage;
