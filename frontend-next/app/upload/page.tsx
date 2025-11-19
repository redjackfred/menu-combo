"use client";
import { useState } from "react";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setPreview(URL.createObjectURL(f));
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("image", file);

    const baseURL = process.env.NEXT_PUBLIC_API_BASE;

    if (!baseURL) {
      alert("API URL not configured!");
      return;
    }

    const res = await fetch(
      baseURL + '/upload',
      { method: "POST", body: formData }
    );

    const data = await res.json();
    console.log("✅ Uploaded:", data);
  };

  return (
    <div className="p-6">
      <h1 className="text-xl mb-4 font-semibold">Upload Test</h1>
      <input type="file" onChange={handleFileChange} />
      {preview && <img src={preview} className="max-w-xs mt-4 rounded" />}
      <button
        onClick={handleUpload}
        className="bg-blue-500 text-white px-4 py-2 rounded mt-4"
      >
        Upload
      </button>
    </div>
  );
}

