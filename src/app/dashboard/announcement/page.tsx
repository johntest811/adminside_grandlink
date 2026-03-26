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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [publishAt, setPublishAt] = useState<string>(new Date().toISOString().slice(0, 16));
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
      const createdAtIso = publishAt ? new Date(publishAt).toISOString() : new Date().toISOString();
      const payload = {
        title: title.trim(),
        message: message.trim(),
        type: "general",
        recipient_role: "admin",
        priority,
        is_read: false,
        created_at: createdAtIso,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        metadata: {
          kind: "announcement",
          created_by: currentAdmin?.username || "admin",
          created_by_id: currentAdmin?.id || null,
          publish_at: createdAtIso,
        },
      };

      let { error } = await supabase.from("notifications").insert(payload);

      if (error) {
        // Fallback when created_at is restricted by DB policy/default behavior.
        const fallbackPayload = {
          ...payload,
          metadata: {
            ...payload.metadata,
            requested_publish_at: createdAtIso,
          },
        } as any;
        delete fallbackPayload.created_at;
        const retry = await supabase.from("notifications").insert(fallbackPayload);
        error = retry.error;
      }

      if (error) throw error;

      setTitle("");
      setMessage("");
      setPriority("medium");
      setExpiresAt("");
      setPublishAt(new Date().toISOString().slice(0, 16));
      setShowCreateModal(false);
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
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-black/90"
          >
            Add Announcement
          </button>
          <div className="text-sm text-black">
            Signed in as: <span className="font-medium">{currentAdmin?.username || "Admin"}</span>
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <input
          placeholder="Search announcements"
          className="w-full rounded-lg border border-slate-300 p-2 text-black"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </section>

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

      {showCreateModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !saving && setShowCreateModal(false)}
          role="presentation"
        >
          <form
            onSubmit={createAnnouncement}
            className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-black">Add Announcement</h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
                disabled={saving}
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-black">Title</label>
                <input
                  className="w-full rounded border p-2 text-black"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Announcement title"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-black">Priority</label>
                <select
                  className="w-full rounded border p-2 text-black"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-black">Publish date & time</label>
                <input
                  type="datetime-local"
                  className="w-full rounded border p-2 text-black"
                  value={publishAt}
                  onChange={(e) => setPublishAt(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-black">Message</label>
              <textarea
                className="w-full rounded border p-3 text-black"
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Write the announcement details..."
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-black">Expires at (optional)</label>
                <input
                  type="datetime-local"
                  className="w-full rounded border p-2 text-black"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded bg-black px-4 py-2 text-white disabled:opacity-60"
              >
                {saving ? "Publishing..." : "Publish Announcement"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-50"
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}