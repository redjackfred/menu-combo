import { useState, useEffect } from "react";
import UploadPage from "./components/UploadPage";
import RecommendationPage from "./components/RecommendationPage";
import RecommendationHistoryPage from "./components/RecommendationHistoryPage";
import UploadHistoryPage from "./components/UploadHistoryPage";
import { Button } from "@/components/ui/button";
import { Button as MovingBorderButton } from "@/components/ui/moving-border";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "react-oidc-context";
import { motion } from "framer-motion";
import { WavyBackground } from "@/components/ui/wavy-background";
import { BackgroundGradient } from "@/components/ui/background-gradient";

function App() {
  const [page, setPage] = useState<"home" | "upload" | "recommend" | "history" | "uploads-history">("home");
  const auth = useAuth();

  const Uri = import.meta.env.PROD
    ? "https://menu-combo.peiwen.dev/" // 👈 確認這是你 Cloudflare 的網址
    : "http://localhost:5173";

  console.log("Logout URI:", Uri);

  // Clean up URL after OAuth callback
  useEffect(() => {
    // Check if URL has OAuth callback parameters
    const params = new URLSearchParams(window.location.search);
    if (params.has('code') || params.has('state')) {
      // Wait for auth to complete, then clean URL
      if (auth.isAuthenticated || auth.error) {
        // Remove query parameters from URL
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }
  }, [auth.isAuthenticated, auth.error]);


  const handleSignOut = async () => {
    try {
      // Option 1: Use react-oidc-context's built-in signout (recommended)
      // await auth.signoutRedirect();

      // Option 2: Manual cleanup + redirect (if Option 1 doesn't work)
      await auth.removeUser();
      const clientId = "2db2nfb6pnt886n0pfq1uhsb6t";
      const logoutUri = Uri;
      const cognitoDomain = "https://us-east-1feaytr2dj.auth.us-east-1.amazoncognito.com";
      window.location.href = `${cognitoDomain}/logout?client_id=${clientId}&logout_uri=${encodeURIComponent(logoutUri)}`;
    } catch (error) {
      console.error("Sign out error:", error);
      // Fallback: force logout
      await auth.removeUser();
      window.location.href = Uri;
    }
  };

  if (auth.isLoading) {
    return <div>Loading...</div>;
  }

  if (auth.error) {
    return <div>Encountering error... {auth.error.message}</div>;
  }

  return (
    <div className="w-full min-h-screen bg-gradient-to-br from-purple-900 via-indigo-900 to-blue-900 overflow-x-hidden relative">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            rotate: [0, 90, 0],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute top-0 left-0 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            scale: [1.2, 1, 1.2],
            rotate: [90, 0, 90],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl"
        />
      </div>

      {page === "home" && (
        <div className="flex flex-col w-full relative z-10">
          {/* Navigation Bar */}
          <motion.nav
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.8 }}
            className="bg-white/10 z-10 backdrop-blur-lg border-b border-white/20 shadow-lg"
          >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
              <motion.div
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.6 }}
                className="flex items-center gap-2"
              >
                <span className="text-3xl">🍽️</span>
                <h1 className="text-xl font-bold text-white">Menu Combo AI</h1>
              </motion.div>
              <motion.div
                initial={{ x: 20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.6 }}
                className="flex gap-2 sm:gap-3"
              >
                {!auth.isAuthenticated ? (
                  <Button onClick={() => auth.signinRedirect()} variant="outline" className="bg-white/10 backdrop-blur-sm border-white/20 text-white hover:bg-white/20">
                    Sign in
                  </Button>
                ) : (
                  <>
                    <Button onClick={() => setPage("uploads-history")} variant="ghost" size="sm" className="text-xs sm:text-sm text-white hover:bg-white/20">
                      📁 Uploads
                    </Button>
                    <Button onClick={() => setPage("history")} variant="ghost" size="sm" className="text-xs sm:text-sm text-white hover:bg-white/20">
                      📚 History
                    </Button>
                    <span className="text-sm text-white/80 self-center hidden md:block">
                      {auth.user?.profile.email || 'Signed in'}
                    </span>
                    <Button onClick={handleSignOut} variant="outline" size="sm" className="text-xs sm:text-sm bg-white/10 backdrop-blur-sm border-white/20 text-white hover:bg-white/20">
                      Sign out
                    </Button>
                  </>
                )}
              </motion.div>
            </div>
          </motion.nav>

          {/* Hero Section */}
          <WavyBackground className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20 text-center">

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.8 }}
            >
              <Badge variant="secondary" className="mb-4 px-3 py-1 text-xs sm:text-sm bg-white/20 backdrop-blur-sm text-white border-white/30">
                ✨ Powered by Advanced AI
              </Badge>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.8 }}
              className="text-4xl sm:text-6xl lg:text-7xl font-bold text-white mb-4 sm:mb-6 leading-tight px-2"
            >
              AI-Powered Menu
              <span className="block bg-gradient-to-r text-pink-700 font-bold bg-clip-text mt-2">
                Recommendations
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.8 }}
              className="text-base sm:text-xl text-purple-100 mb-8 sm:mb-10 max-w-2xl mx-auto leading-relaxed px-4"
            >
              Upload menu photos and get personalized meal combo suggestions powered by AI.
              Save money, eat better, discover perfect combinations.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1, duration: 0.6 }}
              className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-6 sm:mb-8 px-4"
            >
              <MovingBorderButton
                onClick={() => setPage("recommend")}
                containerClassName="w-full sm:w-auto"
                borderRadius="0.75rem"
                className="bg-gradient-to-r from-purple-800 to-pink-600 hover:from-purple-900 hover:to-pink-700 text-white text-base sm:text-lg px-8 py-6"
                duration={3000}
              >
                <span className="flex items-center gap-2">
                  🤖 Try AI Recommendations
                </span>
              </MovingBorderButton>

              {!auth.isAuthenticated && (
                <Button
                  onClick={() => auth.signinRedirect()}
                  variant="outline"
                  className="w-full sm:w-auto px-6 sm:px-8 py-4 sm:py-6 text-base sm:text-lg border-2 bg-white/10 backdrop-blur-sm border-white/20 text-white hover:bg-white/20"
                  size="lg"
                >
                  Get Started Free
                </Button>
              )}
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2, duration: 0.8 }}
              className="flex flex-wrap gap-3 justify-center text-sm"
            >
              <Badge variant="outline" className="bg-white/10 backdrop-blur-sm text-white border-white/20">✓ Free to use</Badge>
              <Badge variant="outline" className="bg-white/10 backdrop-blur-sm text-white border-white/20">✓ No credit card</Badge>
              <Badge variant="outline" className="bg-white/10 backdrop-blur-sm text-white border-white/20">✓ Instant results</Badge>
            </motion.div>
          </WavyBackground>


          {/* Features Section */}
          <section className="w-full bg-white/5 backdrop-blur-sm py-12 sm:py-20">
            <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
                className="text-center mb-12"
              >
                <Badge className="mb-4 bg-white/20 backdrop-blur-sm text-white border-white/20">Features</Badge>
                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                  Why Menu Combo AI?
                </h2>
                <p className="text-purple-100 max-w-2xl mx-auto">
                  Powerful features designed to help you make better dining decisions
                </p>
              </motion.div>
              <div className="grid md:grid-cols-3 gap-8">
                {/* Feature 1 */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                >
                  <BackgroundGradient className="rounded-[22px] p-4 sm:p-10">
                    <Card className="text-center hover:shadow-2xl transition-all border-2 border-white/20 bg-purple-700/10 backdrop-blur-lg hover:border-purple-400 h-full">
                      <CardHeader>
                        <div className="text-5xl mb-4">📸</div>
                        <CardTitle className="text-xl text-white">Smart OCR</CardTitle>
                        <CardDescription className="text-base text-purple-200">
                          Advanced text recognition extracts menu items, prices, and descriptions automatically
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-wrap gap-2 justify-center">
                          <Badge variant="secondary" className="bg-purple-700/30 text-white border-purple-400">Fast</Badge>
                          <Badge variant="secondary" className="bg-purple-700/30 text-white border-purple-400">Accurate</Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </BackgroundGradient>
                </motion.div>

                {/* Feature 2 */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                >
                  <BackgroundGradient className="rounded-[22px] p-4 sm:p-10">

                    <Card className="text-center hover:shadow-2xl transition-all border-2 border-white/20 bg-white/10 backdrop-blur-lg hover:border-pink-400 h-full">
                      <CardHeader>
                        <div className="text-5xl mb-4">🤖</div>
                        <CardTitle className="text-xl text-white">AI Recommendations</CardTitle>
                        <CardDescription className="text-base text-purple-200">
                          Get personalized meal combos based on your budget, dietary needs, and preferences
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-wrap gap-2 justify-center">
                          <Badge variant="secondary" className="bg-pink-500/30 text-white border-pink-400">Personalized</Badge>
                          <Badge variant="secondary" className="bg-pink-500/30 text-white border-pink-400">Smart</Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </BackgroundGradient>
                </motion.div>

                {/* Feature 3 */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: 0.3 }}
                >
                  <BackgroundGradient className="rounded-[22px] p-4 sm:p-10">

                    <Card className="text-center hover:shadow-2xl transition-all border-2 border-white/20 bg-white/10 backdrop-blur-lg hover:border-purple-400 h-full">
                      <CardHeader>
                        <div className="text-5xl mb-4">✨</div>
                        <CardTitle className="text-xl text-white">Visual Highlights</CardTitle>
                        <CardDescription className="text-base text-purple-200">
                          See recommended items highlighted directly on your menu photos
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-wrap gap-2 justify-center">
                          <Badge variant="secondary" className="bg-purple-500/30 text-white border-purple-400">Interactive</Badge>
                          <Badge variant="secondary" className="bg-purple-500/30 text-white border-purple-400">Clear</Badge>
                        </div>
                      </CardContent>
                    </Card>
                  </BackgroundGradient>
                </motion.div>
              </div>
            </div>
          </section>

          {/* How It Works Section */}
          <section className="w-full py-12 sm:py-20 bg-white/5 backdrop-blur-sm">
            <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
                className="text-center mb-12"
              >
                <Badge variant="outline" className="mb-4 bg-white/10 backdrop-blur-sm text-white border-white/20">Simple Process</Badge>
                <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                  How It Works
                </h2>
                <p className="text-purple-100 max-w-2xl mx-auto">
                  Get AI recommendations in 4 easy steps
                </p>
              </motion.div>
              <div className="grid md:grid-cols-4 gap-6">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: 0.1 }}
                >
                  <Card className="text-center hover:shadow-2xl transition-all bg-white/10 backdrop-blur-lg border-white/20 h-full">
                    <CardHeader>
                      <div className="bg-gradient-to-br from-purple-500 to-pink-500 text-white rounded-full w-16 h-16 flex items-center justify-center text-2xl font-bold mx-auto mb-4 shadow-lg">
                        1
                      </div>
                      <CardTitle className="text-lg text-white">Upload Menu</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-purple-200">Take photos of restaurant menus</p>
                      <Separator className="my-3 bg-white/20" />
                      <Badge variant="outline" className="text-xs bg-purple-500/30 text-white border-purple-400">📸 Up to 5 images</Badge>
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                >
                  <Card className="text-center hover:shadow-2xl transition-all bg-white/10 backdrop-blur-lg border-white/20 h-full">
                    <CardHeader>
                      <div className="bg-gradient-to-br from-purple-500 to-pink-500 text-white rounded-full w-16 h-16 flex items-center justify-center text-2xl font-bold mx-auto mb-4 shadow-lg">
                        2
                      </div>
                      <CardTitle className="text-lg text-white">OCR Processing</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-purple-200">AI extracts all menu items</p>
                      <Separator className="my-3 bg-white/20" />
                      <Badge variant="outline" className="text-xs bg-purple-500/30 text-white border-purple-400">⚡ 30-60 seconds</Badge>
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: 0.3 }}
                >
                  <Card className="text-center hover:shadow-2xl transition-all bg-white/10 backdrop-blur-lg border-white/20 h-full">
                    <CardHeader>
                      <div className="bg-gradient-to-br from-purple-500 to-pink-500 text-white rounded-full w-16 h-16 flex items-center justify-center text-2xl font-bold mx-auto mb-4 shadow-lg">
                        3
                      </div>
                      <CardTitle className="text-lg text-white">Set Preferences</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-purple-200">Budget, dietary needs, spice level</p>
                      <Separator className="my-3 bg-white/20" />
                      <Badge variant="outline" className="text-xs bg-purple-500/30 text-white border-purple-400">⚙️ Personalized</Badge>
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: 0.4 }}
                >
                  <Card className="text-center hover:shadow-2xl transition-all bg-white/10 backdrop-blur-lg border-white/20 h-full">
                    <CardHeader>
                      <div className="bg-gradient-to-br from-purple-500 to-pink-500 text-white rounded-full w-16 h-16 flex items-center justify-center text-2xl font-bold mx-auto mb-4 shadow-lg">
                        4
                      </div>
                      <CardTitle className="text-lg text-white">Get Recommendations</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-purple-200">AI suggests perfect combos</p>
                      <Separator className="my-3 bg-white/20" />
                      <Badge variant="outline" className="text-xs bg-purple-500/30 text-white border-purple-400">✨ Instant</Badge>
                    </CardContent>
                  </Card>
                </motion.div>
              </div>
            </div>
          </section>

          {/* CTA Section */}
          <section className="w-full bg-gradient-to-r from-purple-800 to-purple-900 text-white py-12 sm:py-20">
            <div className="w-full max-w-4xl mx-auto px-4">
              <Card className="bg-white/10 backdrop-blur-sm border-white/20 text-white">
                <CardHeader className="text-center pb-4">
                  <CardTitle className="text-3xl md:text-4xl font-bold mb-3">
                    Ready to discover your perfect meal combo?
                  </CardTitle>
                  <CardDescription className="text-xl text-blue-50">
                    Join now and start getting AI-powered recommendations
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-center pt-4">
                  <Button
                    onClick={() => setPage("recommend")}
                    className="bg-white text-purple-800 hover:bg-gray-100 px-8 py-6 text-lg shadow-xl"
                    size="lg"
                  >
                    Start Now - It's Free
                  </Button>
                  <div className="flex flex-wrap gap-3 justify-center mt-6">
                    <Badge variant="outline" className="bg-white/20 text-white border-white/40">
                      No account required
                    </Badge>
                    <Badge variant="outline" className="bg-white/20 text-white border-white/40">
                      Start in 30 seconds
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Footer */}
          <footer className="w-full bg-gray-900 text-gray-400 py-12 sm:py-16">
            <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="grid md:grid-cols-3 gap-8 mb-10">
                <Card className="bg-gray-800/50 border-gray-700 text-gray-300">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <span className="text-2xl">🍽️</span>
                      Menu Combo AI
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-400">
                      AI-powered meal recommendations for smarter dining choices
                    </p>
                    <div className="flex gap-2 mt-4">
                      <Badge variant="secondary" className="text-xs">AI-Powered</Badge>
                      <Badge variant="secondary" className="text-xs">Free</Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gray-800/50 border-gray-700 text-gray-300">
                  <CardHeader>
                    <CardTitle className="text-white">Quick Links</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <button
                        onClick={() => setPage("recommend")}
                        className="block text-sm hover:text-white transition-colors w-full text-left hover:translate-x-1 duration-200"
                      >
                        → Try Now
                      </button>
                      <Separator className="bg-gray-700" />
                      <button
                        onClick={() => setPage("upload")}
                        className="block text-sm hover:text-white transition-colors w-full text-left hover:translate-x-1 duration-200"
                      >
                        → Upload
                      </button>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Separator className="bg-gray-800 mb-8" />

              <div className="text-center">
                <p className="text-sm text-gray-500">
                  &copy; 2025 Menu Combo AI. All rights reserved.
                </p>
                <div className="flex gap-2 justify-center mt-4">
                  <Badge variant="outline" className="border-gray-700 text-gray-500 text-xs">
                    Built with React
                  </Badge>
                  <Badge variant="outline" className="border-gray-700 text-gray-500 text-xs">
                    Powered by AI
                  </Badge>
                </div>
              </div>
            </div>
          </footer>
        </div>
      )}

      {page === "upload" && <UploadPage onBackToHome={() => setPage("home")} />}

      {page === "recommend" && <RecommendationPage onBackToHome={() => setPage("home")} />}

      {page === "history" && <RecommendationHistoryPage onBackToHome={() => setPage("home")} />}

      {page === "uploads-history" && (
        <UploadHistoryPage
          onBackToHome={() => setPage("home")}
          onUseForRecommendation={(uploadId) => {
            // Navigate to recommendation page with pre-selected upload
            console.log('Use upload for recommendation:', uploadId);
            setPage("recommend");
          }}
        />
      )}
    </div>
  );
}

export default App;

