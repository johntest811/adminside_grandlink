"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

type Announcement = {
  id: number;
  title: string;
  message: string;
  priority: "low" | "medium" | "high";
  recipient_role: "admin" | "employee" | "manager" | "all";
  type: string;
  is_read: boolean;
  created_at: string;
  expires_at: string | null;
  metadata: any;
};

export default function AnnouncementPage() {
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem("adminSession");
      if (raw) setCurrentAdmin(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    fetchAnnouncements();
    const channel = supabase
      .channel("announcement_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        fetchAnnouncements();
      })
      .subscribe();
    return () => {
      try { supabase.removeChannel(channel); } catch {}
    };
  }, []);

  const fetchAnnouncements = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .contains("metadata", { kind: "announcement" })
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      setAnnouncements((data as any) || []);
    } catch (e) {
      console.error("Load announcements error:", e);
      setAnnouncements([]);
    } finally {
      setLoading(false);
    }
  };

  const createAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      alert("Title and message are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        message: message.trim(),
        type: "general",
        recipient_role: "admin",
        priority,
        is_read: false,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        metadata: {
          kind: "announcement",
          created_by: currentAdmin?.username || "admin",
          created_by_id: currentAdmin?.id || null,
        },
      };
      const { error } = await supabase.from("notifications").insert(payload);
      if (error) throw error;
      setTitle("");
      setMessage("");
      setPriority("medium");
      setExpiresAt("");
      await fetchAnnouncements();
      alert("Announcement published.");
    } catch (e: any) {
      alert(`Failed to publish announcement: ${e.message || e}`);
    } finally {
      setSaving(false);
    }
  };

  const removeAnnouncement = async (id: number) => {
    if (!confirm("Delete this announcement?")) return;
    try {
      const { error } = await supabase.from("notifications").delete().eq("id", id);
      if (error) throw error;
      await fetchAnnouncements();
    } catch (e: any) {
      alert(`Delete failed: ${e.message || e}`);
    }
  };

  const nowIso = new Date().toISOString();
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return announcements.filter((a) => {
      const notExpired = !a.expires_at || a.expires_at > nowIso;
      const matches =
        !term ||
        a.title?.toLowerCase().includes(term) ||
        a.message?.toLowerCase().includes(term) ||
        a.priority?.toLowerCase().includes(term);
      return notExpired && matches;
    });
  }, [announcements, q, nowIso]);

  const priorityClass = (p: Announcement["priority"]) =>
    p === "high" ? "bg-red-100 text-red-700"
    : p === "low" ? "bg-emerald-100 text-emerald-700"
    : "bg-amber-100 text-amber-700";

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-black">Announcements</h1>
        <div className="text-sm text-black">
          Signed in as: <span className="font-medium">{currentAdmin?.username || "Admin"}</span>
        </div>
      </div>

      {/* Create form */}
      <form onSubmit={createAnnouncement} className="bg-white p-6 rounded-lg shadow space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-black mb-1">Title</label>
            <input
              className="w-full p-2 border rounded text-black"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Announcement title"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-black mb-1">Priority</label>
            <select
              className="w-full p-2 border rounded text-black"
              value={priority}
              onChange={(e) => setPriority(e.target.value as any)}
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-black mb-1">Expires at (optional)</label>
            <input
              type="datetime-local"
              className="w-full p-2 border rounded text-black"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-black mb-1">Message</label>
          <textarea
            className="w-full p-3 border rounded text-black"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write the announcement details..."
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-black text-white rounded disabled:opacity-60"
          >
            {saving ? "Publishing..." : "Publish Announcement"}
          </button>
          <input
            placeholder="Search announcements"
            className="flex-1 p-2 border rounded text-black"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </form>

      {/* List */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-3 border-b">
          <h2 className="text-lg font-semibold text-black">Active Announcements</h2>
        </div>
        {loading ? (
          <div className="p-6 text-black">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-black">No active announcements</div>
        ) : (
          <ul className="divide-y">
            {filtered.map((a) => (
              <li key={a.id} className="p-4">
                <div className="flex items-start gap-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${priorityClass(a.priority)}`}>
                    {a.priority}
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-black">{a.title}</h3>
                      <span className="text-xs text-black/70">
                        {new Date(a.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-black mt-1">{a.message}</p>
                    <div className="mt-2 text-xs text-black/80">
                      Created by: {a.metadata?.created_by || "Admin"}
                      {a.expires_at && (
                        <span className="ml-2">
                          • Expires: {new Date(a.expires_at).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => removeAnnouncement(a.id as number)}
                    className="px-2 py-1 bg-black text-white rounded text-sm"
                    title="Delete announcement"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}