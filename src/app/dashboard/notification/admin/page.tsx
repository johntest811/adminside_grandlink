"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
type Notification = {
  id: number;
  title: string;
  message: string;
  type: string;
  recipient_role: string;
  created_at: string;
};

export default function AdminNotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [form, setForm] = useState({
    title: "",
    message: "",
    type: "general",
    recipient_role: "all",
  });

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setNotifications(data);
  };

  const createNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from("notifications").insert([form]);
    if (!error) {
      setForm({ title: "", message: "", type: "general", recipient_role: "all" });
      fetchNotifications();
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-red-700 mb-6">📢 Admin Notifications</h1>

      {/* Create Notification Form */}
      <form
        onSubmit={createNotification}
        className="bg-white p-6 rounded-lg shadow-md space-y-4 mb-8"
      >
        <h2 className="text-lg font-semibold text-gray-800">Create Notification</h2>
        <input
          type="text"
          placeholder="Title"
          className="w-full border rounded p-2"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          required
        />
        <textarea
          placeholder="Message"
          className="w-full border rounded p-2"
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          required
        />
        <div className="flex gap-4">
          <select
            className="border rounded p-2 flex-1"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            <option value="general">General</option>
            <option value="report">Report</option>
            <option value="stock">Stock</option>
            <option value="task">Task</option>
          </select>
          <select
            className="border rounded p-2 flex-1"
            value={form.recipient_role}
            onChange={(e) => setForm({ ...form, recipient_role: e.target.value })}
          >
            <option value="all">All</option>
            <option value="employee">Employee</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button
          type="submit"
          className="bg-red-700 text-white px-4 py-2 rounded hover:bg-red-800 transition"
        >
          Send Notification
        </button>
      </form>

      {/* Notifications List */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">All Notifications</h2>
        <ul className="space-y-3">
          {notifications.map((n) => (
            <li
              key={n.id}
              className="border rounded p-3 hover:shadow transition bg-gray-50"
            >
              <div className="flex justify-between">
                <h3 className="font-bold text-red-700">{n.title}</h3>
                <span className="text-xs text-gray-500">
                  {new Date(n.created_at).toLocaleString()}
                </span>
              </div>
              <p className="text-gray-700">{n.message}</p>
              <div className="text-xs text-gray-600 mt-1">
                Type: <span className="font-medium">{n.type}</span> | To:{" "}
                <span className="font-medium">{n.recipient_role}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
