import { useState } from "react";
import axios from "axios";

export default function AdminUpload({ onUploaded }) {
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState("");

  const upload = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await axios.post("http://localhost:4000/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setMsg(`✅ ${res.data.rows} rows uploaded`);
      onUploaded?.();
    } catch (e) {
      setMsg("❌ Upload failed");
    }
  };

  return (
    <div style={{ padding: "1rem", border: "1px solid #ccc", marginBottom: "1rem" }}>
      <h3>📂 Admin Upload</h3>
      <input type="file" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files[0])} />
      <button onClick={upload}>Upload</button>
      {msg && <p>{msg}</p>}
    </div>
  );
}

