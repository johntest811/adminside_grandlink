"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import bcrypt from "bcryptjs";

export default function SuperAdminRegister() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("admin");
  const [message, setMessage] = useState("");
  const router = useRouter();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    if (!username || !password) {
      setMessage("Username and password are required.");
      return;
    }
    const password_hash = bcrypt.hashSync(password, 10);
    const { error } = await supabase.from("admins").insert({
      username,
      password_hash,
      role,
    });
    if (error) {
      setMessage("Error: " + error.message);
    } else {
      setMessage("Admin account created successfully!");
      setUsername("");
      setPassword("");
      setRole("admin");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <h1 className="text-2xl font-bold mb-4">Create Admin Account</h1>
      <form className="flex flex-col gap-4 w-80" onSubmit={handleRegister}>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          className="border px-3 py-2 rounded"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="border px-3 py-2 rounded"
        />
        <select value={role} onChange={e => setRole(e.target.value)} className="border px-3 py-2 rounded">
          <option value="admin">Admin</option>
          <option value="manager">Manager</option>
        </select>
        <button type="submit" className="bg-[#232d3b] text-white py-2 rounded font-semibold">Create Account</button>
        {message && <div className="text-center text-red-600 mt-2">{message}</div>}
      </form>
    </div>
  );
}
