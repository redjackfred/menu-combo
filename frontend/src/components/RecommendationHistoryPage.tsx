import React, { useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const API_BASE = import.meta.env.VITE_API_BASE || 'https://hymek82qkl.execute-api.us-east-1.amazonaws.com';

interface RecommendationItem {
  item_name: string;
  price: number;
  quantity: number;
}

interface RecommendationCombo {
  name: string;
  items: RecommendationItem[];
  totalPrice: number;
  reason: string;
  tags: string[];
}

interface Recommendation {
  recommendation_id: string;
  user_id: string;
  upload_ids: string[];
  recommended_items: RecommendationCombo[];
  preferences: {
    people?: number;
    budget?: { min: number; max: number };
    dietaryRestrictions?: string[];
    spicyLevel?: string;
  };
  created_at: string;
}

interface RecommendationHistoryPageProps {
  onBackToHome?: () => void;
}

const RecommendationHistoryPage: React.FC<RecommendationHistoryPageProps> = ({ onBackToHome }) => {
  const auth = useAuth();
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRecommendation, setSelectedRecommendation] = useState<Recommendation | null>(null);

  useEffect(() => {
    fetchRecommendations();
  }, []);

  const fetchRecommendations = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE}/recommendations`, {
        headers: {
          'Authorization': `Bearer ${auth.user?.access_token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch recommendations');
      }

      const data = await response.json();
      setRecommendations(data.recommendations);
    } catch (err) {
      console.error('Error fetching recommendations:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getBadgeColor = (tag: string) => {
    const colorMap: Record<string, string> = {
      'balanced': 'bg-green-100 text-green-700',
      'budget-friendly': 'bg-blue-100 text-blue-700',
      'spicy': 'bg-red-100 text-red-700',
      'vegetarian': 'bg-green-200 text-green-800',
      'healthy': 'bg-emerald-100 text-emerald-700',
      'value': 'bg-yellow-100 text-yellow-700'
    };
    return colorMap[tag.toLowerCase()] || 'bg-gray-100 text-gray-700';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4 sm:p-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading recommendation history...</p>
          </div>
        </div>
      </div>
    );
  }

  if (selectedRecommendation) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4 sm:p-8">
        <div className="max-w-6xl mx-auto">
          <Button onClick={() => setSelectedRecommendation(null)} variant="outline" className="mb-6">
            ← Back to History
          </Button>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-2xl">Recommendation Details</CardTitle>
              <CardDescription>
                Created: {formatDate(selectedRecommendation.created_at)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <div>
                  <p className="text-sm text-gray-600">People</p>
                  <p className="text-lg font-semibold">{selectedRecommendation.preferences?.people || 1}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Budget Range</p>
                  <p className="text-lg font-semibold">
                    ${selectedRecommendation.preferences?.budget?.min || 0} - ${selectedRecommendation.preferences?.budget?.max || 100}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Dietary Restrictions</p>
                  <p className="text-lg font-semibold">
                    {selectedRecommendation.preferences?.dietaryRestrictions?.length || 0} items
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Spice Level</p>
                  <p className="text-lg font-semibold capitalize">
                    {selectedRecommendation.preferences?.spicyLevel || 'any'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            {selectedRecommendation.recommended_items.map((combo, idx) => (
              <Card key={idx} className="hover:shadow-lg transition-shadow">
                <CardHeader className="bg-gradient-to-r from-yellow-50 to-orange-50">
                  <CardTitle className="text-xl flex items-center gap-2">
                    <span className="bg-yellow-500 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold">
                      {idx + 1}
                    </span>
                    {combo.name}
                  </CardTitle>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {combo.tags.map((tag, tagIdx) => (
                      <Badge key={tagIdx} className={getBadgeColor(tag)}>
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-semibold mb-2 text-gray-700">Items:</h4>
                      <div className="space-y-2">
                        {combo.items.map((item, itemIdx) => (
                          <div key={itemIdx} className="flex justify-between items-center py-2 border-b last:border-0">
                            <div className="flex-1">
                              <span className="font-medium">{item.item_name}</span>
                              <span className="text-gray-500 ml-2">x{item.quantity}</span>
                            </div>
                            <span className="font-semibold text-blue-600">
                              ${(item.price * item.quantity).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <Separator className="my-4" />
                      <div className="flex justify-between items-center text-lg font-bold">
                        <span>Total:</span>
                        <span className="text-green-600">${combo.totalPrice.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="bg-blue-50 p-4 rounded-lg">
                      <h4 className="font-semibold mb-2 text-blue-900">Why this combo:</h4>
                      <p className="text-blue-800">{combo.reason}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        {onBackToHome && (
          <Button onClick={onBackToHome} variant="outline" className="mb-6">
            ← Back to Home
          </Button>
        )}

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-3xl flex items-center gap-3">
              📚 Recommendation History
            </CardTitle>
            <CardDescription>
              View all your past AI-powered meal recommendations
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

        {recommendations.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center py-12">
              <p className="text-gray-500 text-lg mb-4">No recommendations yet</p>
              <p className="text-gray-400">Upload menu photos and generate recommendations to see them here</p>
              {onBackToHome && (
                <Button onClick={onBackToHome} className="mt-6">
                  Get Started
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {recommendations.map((rec) => (
              <Card
                key={rec.recommendation_id}
                className="hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => setSelectedRecommendation(rec)}
              >
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-xl">
                        {formatDate(rec.created_at)}
                      </CardTitle>
                      <CardDescription className="mt-2">
                        {rec.recommended_items.length} combos ·
                        {rec.upload_ids.length} menus ·
                        {rec.preferences?.people || 1} people
                      </CardDescription>
                    </div>
                    <Badge className="bg-blue-100 text-blue-700">
                      From ${rec.recommended_items[0]?.totalPrice.toFixed(2)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {rec.preferences?.dietaryRestrictions?.map((restriction, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs">
                        {restriction}
                      </Badge>
                    ))}
                    {rec.preferences?.spicyLevel && rec.preferences.spicyLevel !== 'any' && (
                      <Badge variant="outline" className="text-xs">
                        {rec.preferences.spicyLevel} spice
                      </Badge>
                    )}
                  </div>
                  <div className="mt-4 pt-4 border-t text-sm text-gray-600">
                    Click to view details →
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default RecommendationHistoryPage;
