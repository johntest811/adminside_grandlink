"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Thread = {
  id: string;
  status: "pending" | "active" | "resolved";
  created_at: string;
  last_message_at: string;
  visitor_name?: string | null;
  visitor_email?: string | null;
  user_id?: string | null;
  accepted_at?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
};

type Message = {
  id: string;
  created_at: string;
  sender_type: "visitor" | "user" | "admin";
  sender_name?: string | null;
  body?: string | null;
  image_url?: string | null;
};

function formatDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function ChatInboxPage() {
  const [tab, setTab] = useState<"pending" | "active" | "resolved">("pending");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [selectedThread, setSelectedThread] = useState<any>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [adminName, setAdminName] = useState("Admin");
  const [adminEmail, setAdminEmail] = useState<string>("");
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const session = JSON.parse(localStorage.getItem("adminSession") || "null");
      if (session?.username) setAdminName(session.username);
      if (typeof session?.email === "string" && session.email.includes("@")) {
        setAdminEmail(session.email);
      } else if (typeof session?.username === "string" && session.username.includes("@")) {
        setAdminEmail(session.username);
      }
    } catch {
      // ignore
    }
  }, []);

  const canReply = useMemo(() => {
    if (!selectedThread) return false;
    return selectedThread.status === "active";
  }, [selectedThread]);

  const loadThreads = async (status: "pending" | "active" | "resolved") => {
    setLoadingThreads(true);
    try {
      const res = await fetch(`/api/chat/threads?status=${encodeURIComponent(status)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load threads");
      setThreads((json.threads || []) as Thread[]);
    } finally {
      setLoadingThreads(false);
    }
  };

  const loadMessages = async (threadId: string) => {
    if (!threadId) return;
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/chat/messages?threadId=${encodeURIComponent(threadId)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load messages");
      setSelectedThread(json.thread);
      setMessages((json.messages || []) as Message[]);
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    loadThreads(tab).catch(() => undefined);
  }, [tab]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadThreads(tab).catch(() => undefined);
      if (selectedId) loadMessages(selectedId).catch(() => undefined);
    }, 2500);
    return () => clearInterval(interval);
  }, [tab, selectedId]);

  const acceptThread = async () => {
    if (!selectedId) return;
    const res = await fetch(`/api/chat/threads/${encodeURIComponent(selectedId)}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminName }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Accept failed");
    await loadMessages(selectedId);
    await loadThreads(tab);
  };

  const resolveThread = async () => {
    if (!selectedId) return;
    const res = await fetch(`/api/chat/threads/${encodeURIComponent(selectedId)}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminName, adminEmail }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Resolve failed");
    await loadMessages(selectedId);
    await loadThreads(tab);
  };

  const deleteThread = async () => {
    if (!selectedId) return;
    if (!confirm("Delete this conversation permanently?")) return;

    const res = await fetch(`/api/chat/threads/${encodeURIComponent(selectedId)}`, { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Delete failed");

    setSelectedId("");
    setSelectedThread(null);
    setMessages([]);
    await loadThreads(tab);
  };

  const sendMessage = async () => {
    if (!selectedId) return;
    const msg = text.trim();
    if (!msg) return;
    setText("");

    const res = await fetch("/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: selectedId, adminName, message: msg }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Send failed");

    await loadMessages(selectedId);
    await loadThreads(tab);
  };

  const uploadImage = async (file: File) => {
    if (!selectedId) return;

    setUploading(true);
    try {
      const form = new FormData();
      form.append("threadId", selectedId);
      form.append("file", file);

      const up = await fetch("/api/chat/upload", { method: "POST", body: form });
      const upJson = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(upJson?.error || "Upload failed");

      const url = String(upJson?.url || "");
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: selectedId, adminName, imageUrl: url }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Send image failed");

      await loadMessages(selectedId);
      await loadThreads(tab);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-black">Chat Inbox</h1>
        <div className="text-sm text-gray-600">Signed in as: {adminName}</div>
      </div>

      <div className="flex gap-2 mb-4">
        {(["pending", "active", "resolved"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setSelectedId("");
              setSelectedThread(null);
              setMessages([]);
            }}
            className={`px-4 py-2 rounded-lg border text-sm ${
              tab === t
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-gray-800 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {t === "pending" ? "Pending" : t === "active" ? "Active" : "Resolved"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Thread list */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <div className="font-semibold text-black">Conversations</div>
            {loadingThreads ? <div className="text-xs text-gray-500">Loading…</div> : null}
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {threads.length === 0 ? (
              <div className="p-4 text-sm text-gray-600">No conversations.</div>
            ) : (
              threads.map((th) => {
                const title = th.visitor_email || th.visitor_name || th.user_id || "User";
                return (
                  <button
                    key={th.id}
                    className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 ${
                      selectedId === th.id ? "bg-indigo-50" : "bg-white"
                    }`}
                    onClick={() => {
                      setSelectedId(th.id);
                      loadMessages(th.id).catch((e) => alert(e?.message || "Failed"));
                    }}
                  >
                    <div className="text-sm font-medium text-black truncate">{title}</div>
                    <div className="text-xs text-gray-500 truncate">
                      Last: {formatDateTime(th.last_message_at)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Chat view */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col min-h-[70vh]">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <div>
              <div className="font-semibold text-black">
                {selectedThread
                  ? selectedThread.visitor_email || selectedThread.visitor_name || selectedThread.user_id || "Conversation"
                  : "Select a conversation"}
              </div>
              {selectedThread ? (
                <div className="text-xs text-gray-600">
                  Status: <span className="font-medium">{selectedThread.status}</span>
                </div>
              ) : null}
            </div>

            {selectedThread ? (
              <div className="flex gap-2">
                {selectedThread.status === "pending" ? (
                  <button
                    onClick={() => acceptThread().catch((e) => alert(e?.message || "Accept failed"))}
                    className="px-3 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700"
                  >
                    Accept
                  </button>
                ) : null}

                {selectedThread.status !== "resolved" ? (
                  <button
                    onClick={() => resolveThread().catch((e) => alert(e?.message || "Resolve failed"))}
                    className="px-3 py-2 text-sm rounded-lg bg-yellow-600 text-white hover:bg-yellow-700"
                  >
                    Mark Resolved
                  </button>
                ) : null}

                {selectedThread.status === "resolved" ? (
                  <button
                    onClick={() => deleteThread().catch((e) => alert(e?.message || "Delete failed"))}
                    className="px-3 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex-1 bg-gray-50 p-3 overflow-y-auto">
            {loadingMessages && !messages.length ? (
              <div className="text-sm text-gray-500">Loading…</div>
            ) : null}

            {selectedThread && messages.length === 0 ? (
              <div className="text-sm text-gray-600">No messages yet.</div>
            ) : null}

            {messages.map((m) => {
              const isAdmin = m.sender_type === "admin";
              return (
                <div key={m.id} className={`mb-2 flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 border shadow-sm ${
                      isAdmin
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-900 border-gray-200"
                    }`}
                  >
                    {m.image_url ? (
                      <img src={m.image_url} alt="Uploaded" className="rounded-xl max-h-72" />
                    ) : null}
                    {m.body ? <div className="text-sm">{m.body}</div> : null}
                    <div className={`text-[10px] mt-1 ${isAdmin ? "text-white/80" : "text-gray-500"}`}>
                      {formatDateTime(m.created_at)}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {selectedThread ? (
            <div className="p-3 border-t border-gray-200 bg-white">
              {selectedThread.status === "pending" ? (
                <div className="text-sm text-gray-700 mb-2">
                  Accept the chat to reply.
                </div>
              ) : null}

              {selectedThread.status === "resolved" ? (
                <div className="text-sm text-gray-700">
                  This conversation is resolved. Use Delete to remove it.
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center justify-center h-10 w-10 rounded-lg border border-gray-300 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={!canReply || uploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        uploadImage(file).catch((err) => alert(err?.message || "Upload failed"));
                      }}
                    />
                    <span className="text-lg">📎</span>
                  </label>

                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    disabled={!canReply}
                    className="flex-1 h-10 px-3 border border-gray-300 rounded-lg text-sm text-black disabled:bg-gray-100"
                    placeholder={canReply ? "Type a reply…" : "Accept to reply"}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        sendMessage().catch((err) => alert(err?.message || "Send failed"));
                      }
                    }}
                  />

                  <button
                    type="button"
                    onClick={() => sendMessage().catch((err) => alert(err?.message || "Send failed"))}
                    disabled={!canReply || !text.trim()}
                    className="h-10 px-4 rounded-lg bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              )}

              {uploading ? <div className="text-xs text-gray-500 mt-2">Uploading…</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
