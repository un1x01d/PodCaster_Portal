import { useState } from "react";

export default function Login({ onLogin }) {
  const [user, setUser] = useState("");

  const submit = (e) => {
    e.preventDefault();
    if (!user.trim()) return;
    onLogin(user.trim());
  };

  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      <h2>🔑 Login</h2>
      <form onSubmit={submit}>
        <input
          type="text"
          placeholder="Enter 'admin' or clientId"
          value={user}
          onChange={(e) => setUser(e.target.value)}
        />
        <button type="submit">Login</button>
      </form>
    </div>
  );
}

