"use client";

import { useEffect, useMemo, useState } from "react";

type DownloadsContent = {
  heroTitle?: string;
  heroDescription?: string;
  cardTitle?: string;
  cardDescription?: string;
  buttonLabel?: string;
  releaseNotes?: string;
  downloadUrl?: string;
  apkUrl?: string;
  apkVersion?: string;
  apkSize?: string;
  apkFileName?: string;
  compressedUrl?: string;
  compressionRatio?: number | null;
  enabled?: boolean;
};

const defaultContent: DownloadsContent = {
  heroTitle: "Download GrandLink Mobile",
  heroDescription: "Install the mobile APK to manage reservations and updates faster from your Android device.",
  cardTitle: "GrandLink Android App",
  cardDescription: "Use our official Google Drive link for the latest Android installer.",
  buttonLabel: "Open Google Drive",
  releaseNotes: "First mobile release",
  downloadUrl: "",
  apkUrl: "",
  apkVersion: "",
  apkSize: "",
  apkFileName: "",
  compressedUrl: "",
  compressionRatio: null,
  enabled: true,
};

export default function DownloadsEditorPage() {
  const [content, setContent] = useState<DownloadsContent>(defaultContent);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const resolvedDownloadUrl = useMemo(
    () => (content.downloadUrl || content.apkUrl || "").trim(),
    [content.downloadUrl, content.apkUrl]
  );

  const previewEnabled = useMemo(() => !!content.enabled && !!resolvedDownloadUrl, [content.enabled, resolvedDownloadUrl]);

  const loadContent = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/downloads", { cache: "no-store" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Failed to load downloads content");
      const next = (payload?.content ?? payload ?? {}) as DownloadsContent;
      setContent({ ...defaultContent, ...next });
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContent();
  }, []);

  const onSave = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/downloads", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Failed to save downloads content");
      setMessage("Downloads page content saved.");
      setContent({ ...defaultContent, ...(payload?.content ?? content) });
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-black">
        <div className="animate-pulse">Loading Downloads editor...</div>
      </div>
    );
  }

  return (
    <section className="p-6 md:p-8 space-y-6 text-black">
      <div className="rounded-2xl border bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold">Downloads Page Editor</h1>
        <p className="text-sm text-gray-600 mt-1">
          Manage the website download page and publish a Google Drive link for Android downloads.
        </p>
      </div>

      {!!error && <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-700">{error}</div>}
      {!!message && <div className="rounded-xl border border-green-300 bg-green-50 p-4 text-green-700">{message}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold">Website Content</h2>

          <label className="block text-sm font-medium">Hero Title</label>
          <input
            className="w-full rounded-lg border px-3 py-2"
            value={content.heroTitle || ""}
            onChange={(e) => setContent((p) => ({ ...p, heroTitle: e.target.value }))}
          />

          <label className="block text-sm font-medium">Hero Description</label>
          <textarea
            className="w-full rounded-lg border px-3 py-2 min-h-20"
            value={content.heroDescription || ""}
            onChange={(e) => setContent((p) => ({ ...p, heroDescription: e.target.value }))}
          />

          <label className="block text-sm font-medium">Card Title</label>
          <input
            className="w-full rounded-lg border px-3 py-2"
            value={content.cardTitle || ""}
            onChange={(e) => setContent((p) => ({ ...p, cardTitle: e.target.value }))}
          />

          <label className="block text-sm font-medium">Card Description</label>
          <textarea
            className="w-full rounded-lg border px-3 py-2 min-h-20"
            value={content.cardDescription || ""}
            onChange={(e) => setContent((p) => ({ ...p, cardDescription: e.target.value }))}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium">Button Label</label>
              <input
                className="w-full rounded-lg border px-3 py-2"
                value={content.buttonLabel || ""}
                onChange={(e) => setContent((p) => ({ ...p, buttonLabel: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium">APK Version</label>
              <input
                className="w-full rounded-lg border px-3 py-2"
                value={content.apkVersion || ""}
                onChange={(e) => setContent((p) => ({ ...p, apkVersion: e.target.value }))}
                placeholder="e.g. 1.0.3"
              />
            </div>
          </div>

          <label className="block text-sm font-medium">Release Notes</label>
          <textarea
            className="w-full rounded-lg border px-3 py-2 min-h-24"
            value={content.releaseNotes || ""}
            onChange={(e) => setContent((p) => ({ ...p, releaseNotes: e.target.value }))}
          />

          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={content.enabled !== false}
              onChange={(e) => setContent((p) => ({ ...p, enabled: e.target.checked }))}
            />
            Enable download page button
          </label>

          <div className="flex justify-end">
            <button
              onClick={onSave}
              disabled={saving}
              className="rounded-lg bg-[#8B1C1C] px-5 py-2.5 font-semibold text-white hover:bg-[#741717] disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Content"}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold">Google Drive Download Link</h2>
          <p className="text-sm text-gray-600">
            Paste the public Google Drive share link for your latest APK. This replaces Supabase APK uploads.
          </p>

          <label className="block text-sm font-medium">Google Drive URL</label>
          <input
            className="w-full rounded-lg border px-3 py-2"
            value={content.downloadUrl || content.apkUrl || ""}
            onChange={(e) =>
              setContent((p) => ({
                ...p,
                downloadUrl: e.target.value,
                apkUrl: e.target.value,
                compressedUrl: "",
                compressionRatio: null,
              }))
            }
            placeholder="https://drive.google.com/file/d/.../view?usp=sharing"
          />

          <div className="rounded-lg border bg-gray-50 p-4 text-sm space-y-1">
            <div><span className="font-medium">Current APK:</span> {content.apkFileName || "None"}</div>
            <div><span className="font-medium">APK Size:</span> {content.apkSize || "Unknown"}</div>
            <div>
              <span className="font-medium">Download URL:</span>{" "}
              {resolvedDownloadUrl ? (
                <a href={resolvedDownloadUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline break-all">
                  {resolvedDownloadUrl}
                </a>
              ) : (
                "Not configured"
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-amber-50 border-amber-200 p-3 text-xs text-amber-900">
            Use a public "Anyone with the link" Google Drive URL so customers can download without authentication.
          </div>

          {/* <div className="rounded-lg border p-4">
            <h3 className="font-semibold mb-2">Website Preview</h3>
            <div className="space-y-2">
              <div className="text-xl font-bold">{content.heroTitle}</div>
              <p className="text-sm text-gray-600">{content.heroDescription}</p>
              <button
                disabled={!previewEnabled}
                className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50"
              >
                {content.buttonLabel || "Open Google Drive"}
              </button>
            </div>
          </div> */}
        </div>
      </div>
    </section>
  );
}
