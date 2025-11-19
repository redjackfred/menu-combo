import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const TestSecretPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTestSecret = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    const baseURL = import.meta.env.VITE_API_BASE;
    if (!baseURL) {
      setError("API URL not configured!");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(baseURL + "/testsecret");
      if (!res.ok) throw new Error("Failed to fetch secrets");

      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setError(err.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 font-sans max-w-md mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Test Secrets</h1>

      <Button
        onClick={handleTestSecret}
        className="mb-4 w-full bg-blue-500 hover:bg-blue-600 text-white"
      >
        {loading ? "Loading..." : "Fetch Secrets"}
      </Button>

      {error && (
        <Card className="bg-red-100 p-4 mb-4">
          <p className="text-red-700">{error}</p>
        </Card>
      )}

      {result && (
        <Card className="bg-gray-100 p-4 mb-4">
          <pre className="text-sm">{result}</pre>
        </Card>
      )}
    </div>
  );
};

export default TestSecretPage;

