"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { logActivity } from "@/app/lib/activity";
import RichTextEditor from "@/components/RichTextEditor";

type BlogRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_image_url: string | null;
  author_name: string | null;
  content_html?: string | null;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string | null;
};

type ImageSize = "default" | "sm" | "md" | "lg" | "full";

type ImageItem = {
  url: string;
  size: ImageSize;
};

type ContentBlock =
  | { id: string; type: "text"; html: string }
  | { id: string; type: "images"; images: ImageItem[]; newImageSize: ImageSize };

function escapeAttr(v: string) {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function imageStyleForSize(size: ImageSize) {
  // Default matches current behavior: responsive, centered.
  const base = "display:block;margin:0.75rem auto;max-width:100%;height:auto;";
  switch (size) {
    case "sm":
      return base + "width:100%;max-width:320px;";
    case "md":
      return base + "width:100%;max-width:640px;";
    case "lg":
      return base + "width:100%;max-width:960px;";
    case "full":
      return base + "width:100%;max-width:100%;";
    case "default":
    default:
      return base;
  }
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function normalizeForCompare(url: string) {
  return String(url || "")
    .trim()
    .replace(/\s+/g, "")
    .split("?")[0]
    .toLowerCase();
}

function sizeFromImgStyle(style: string): ImageSize {
  const s = String(style || "").toLowerCase().replace(/\s+/g, "");
  if (s.includes("max-width:320px")) return "sm";
  if (s.includes("max-width:640px")) return "md";
  if (s.includes("max-width:960px")) return "lg";
  return "default";
}

function parseContentHtmlToBlocks(html: string, coverImageUrl: string | null | undefined): ContentBlock[] {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return [{ id: `text_${Date.now()}`, type: "text", html: String(html || "") }];
  }

  const coverNorm = coverImageUrl ? normalizeForCompare(coverImageUrl) : "";
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  const nodes = Array.from(doc.body.childNodes);

  const blocks: ContentBlock[] = [];
  let textBuffer = "";
  let imageBuffer: ImageItem[] = [];

  const flushText = () => {
    const trimmed = textBuffer.replace(/\s+/g, " ").trim();
    if (trimmed.length) {
      blocks.push({
        id: `text_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type: "text",
        html: textBuffer,
      });
    }
    textBuffer = "";
  };

  const flushImages = () => {
    if (imageBuffer.length) {
      blocks.push({
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type: "images",
        images: imageBuffer,
        newImageSize: "default",
      });
    }
    imageBuffer = [];
  };

  const pushImage = (img: HTMLImageElement) => {
    const src = img.getAttribute("src") || img.src || "";
    if (!src) return;
    if (coverNorm && normalizeForCompare(src) === coverNorm) return;

    const size = sizeFromImgStyle(img.getAttribute("style") || "");
    imageBuffer.push({ url: src, size });
  };

  const isImgOnlyContainer = (el: Element) => {
    if (el.tagName.toLowerCase() === "img") return true;
    const imgs = el.querySelectorAll("img");
    if (imgs.length === 0) return false;
    const text = (el.textContent || "").trim();
    return text.length === 0;
  };

  for (const node of nodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;

      if (isImgOnlyContainer(el)) {
        flushText();
        if (el.tagName.toLowerCase() === "img") {
          pushImage(el as HTMLImageElement);
        } else {
          const imgs = Array.from(el.querySelectorAll("img"));
          imgs.forEach((img) => pushImage(img));
        }
        continue;
      }

      // Non-image content
      flushImages();
      textBuffer += (el as HTMLElement).outerHTML;
      continue;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent || "";
      if (t.trim().length === 0) continue;
      flushImages();
      textBuffer += escapeAttr(t);
    }
  }

  flushImages();
  flushText();

  return blocks.length ? blocks : [{ id: `text_${Date.now()}`, type: "text", html: "" }];
}

export default function BlogsEditorPage() {
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [blogs, setBlogs] = useState<BlogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [blocks, setBlocks] = useState<ContentBlock[]>([
    { id: `text_${Date.now()}`, type: "text", html: "" },
  ]);

  const coverFileInputRef = useRef<HTMLInputElement | null>(null);

  // Bucket name for blog cover uploads (create this in Supabase Storage)
  const BLOG_COVER_BUCKET = "blog-images";

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<BlogRow>>({
    title: "",
    slug: "",
    excerpt: "",
    cover_image_url: "",
    author_name: "",
    content_html: "",
    is_published: false,
    published_at: null,
  });

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  useEffect(() => {
    try {
      const sessionData = localStorage.getItem("adminSession");
      if (sessionData) {
        const admin = JSON.parse(sessionData);
        setCurrentAdmin(admin);
      }
    } catch (e) {
      console.error("load admin session error", e);
    }
  }, []);

  useEffect(() => {
    const logView = async () => {
      if (!currentAdmin?.id) return;
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: "view",
        entity_type: "page",
        details: `Admin ${currentAdmin.username} accessed Blogs editor`,
        page: "Blogs Editor",
        metadata: { pageAccess: true, timestamp: new Date().toISOString() },
      }).catch(() => {});
    };
    logView();
  }, [currentAdmin?.id, currentAdmin?.username]);

  const authHeaders = useMemo(() => {
    if (!currentAdmin?.id) return {} as Record<string, string>;
    return {
      authorization: JSON.stringify({ id: currentAdmin.id, username: currentAdmin.username }),
    };
  }, [currentAdmin?.id, currentAdmin?.username]);

  const loadBlogs = async () => {
    if (!currentAdmin?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/blogs?includeUnpublished=1", { headers: authHeaders });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to fetch blogs (${res.status})`);
      setBlogs(Array.isArray(j?.blogs) ? j.blogs : []);
    } catch (e: any) {
      setBlogs([]);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadBlogById = async (id: string) => {
    if (!currentAdmin?.id) return;
    setError(null);
    try {
      const res = await fetch(`/api/blogs/${encodeURIComponent(id)}`, { headers: authHeaders });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Failed to fetch blog (${res.status})`);
      const b = j?.blog as BlogRow;
      setForm({
        id: b.id,
        title: b.title,
        slug: b.slug,
        excerpt: b.excerpt || "",
        cover_image_url: b.cover_image_url || "",
        author_name: b.author_name || "",
        content_html: b.content_html || "",
        is_published: !!b.is_published,
        published_at: b.published_at,
      });
      setSelectedId(b.id);

      // Parse existing HTML into the same Text/Image blocks used when creating.
      // Also: never include the cover image inside the content blocks.
      setBlocks(parseContentHtmlToBlocks(String(b.content_html || ""), b.cover_image_url));
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const contentHtml = useMemo(() => {
    return blocks
      .map((b) => {
        if (b.type === "text") return String(b.html || "");
        const imgs = Array.isArray(b.images) ? b.images : [];
        return imgs
          .map((img: any) => {
            const src = typeof img === "string" ? img : String(img?.url || "");
            const size = (typeof img === "string" ? "default" : (img?.size as ImageSize)) || "default";
            return `<p style="text-align:center;"><img src="${escapeAttr(src)}" alt="" style="${imageStyleForSize(
              size
            )}" /></p>`;
          })
          .join("\n");
      })
      .join("\n");
  }, [blocks]);

  useEffect(() => {
    loadBlogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAdmin?.id]);

  const startNew = () => {
    setSelectedId(null);
    setForm({
      title: "",
      slug: "",
      excerpt: "",
      cover_image_url: "",
      author_name: "",
      content_html: "",
      is_published: false,
      published_at: null,
    });
    setBlocks([{ id: `text_${Date.now()}`, type: "text", html: "" }]);
  };

  const save = async () => {
    if (!currentAdmin?.id) return;
    const title = String(form.title || "").trim();
    const slug = String(form.slug || "").trim();
    if (!title || !slug) {
      showToast("Title and slug are required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const isEdit = !!form.id;
      const url = isEdit ? `/api/blogs/${encodeURIComponent(form.id!)}` : "/api/blogs";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "content-type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          title,
          slug,
          excerpt: form.excerpt || null,
          cover_image_url: form.cover_image_url || null,
          author_name: form.author_name || null,
          content_html: contentHtml,
          is_published: !!form.is_published,
          published_at: form.is_published ? form.published_at || new Date().toISOString() : null,
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Save failed (${res.status})`);

      showToast("Saved.");
      await loadBlogs();

      const saved = (j?.blog || null) as BlogRow | null;
      if (saved?.id) {
        await loadBlogById(saved.id);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!form.id || !currentAdmin?.id) return;
    if (!confirm("Delete this blog?")) return;

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/blogs/${encodeURIComponent(form.id)}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Delete failed (${res.status})`);

      showToast("Deleted.");
      await loadBlogs();
      startNew();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const makeSafeFileName = (name: string) => name.replace(/[^a-zA-Z0-9.\-_]/g, "_");

  const uploadCoverImage = async (file: File) => {
    if (!currentAdmin?.id) {
      showToast("Missing admin session.");
      return;
    }

    setUploadingCover(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/blogs/upload", {
        method: "POST",
        headers: authHeaders,
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Upload failed (${res.status})`);

      const publicUrl = String(j?.publicUrl || "");
      if (!publicUrl) {
        throw new Error(
          "Upload succeeded but no public URL was returned. Make sure the bucket is public, or switch to signed URLs."
        );
      }

      setForm((p) => ({ ...p, cover_image_url: publicUrl }));
      showToast("Cover image uploaded.");

      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: "upload",
        entity_type: "blog_cover_image",
        details: `Admin ${currentAdmin.username} uploaded a blog cover image (${(file.size / 1024 / 1024).toFixed(2)}MB)` ,
        page: "Blogs Editor",
        metadata: { bucket: BLOG_COVER_BUCKET, publicUrl, fileName: file.name, fileType: file.type },
      }).catch(() => {});
    } catch (e: any) {
      console.error("cover upload error", e);
      setError(e?.message || String(e));
      showToast("Cover upload failed.");
    } finally {
      setUploadingCover(false);
    }
  };

  if (!currentAdmin) {
    return <div className="p-6 text-black">Loading admin session…</div>;
  }

  const uploadInlineImage = async (file: File) => {
    if (!currentAdmin?.id) throw new Error("Missing admin session.");

    const safeName = makeSafeFileName(file.name);
    const f = new File([file], safeName, { type: file.type });

    const fd = new FormData();
    fd.append("file", f);

    const res = await fetch("/api/blogs/upload", {
      method: "POST",
      headers: authHeaders,
      body: fd,
    });

    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error || `Upload failed (${res.status})`);
    const publicUrl = String(j?.publicUrl || "");
    if (!publicUrl) throw new Error("Upload succeeded but no public URL was returned.");
    return publicUrl;
  };

  const addTextBlock = () =>
    setBlocks((prev) => [
      ...prev,
      { id: `text_${Date.now()}_${Math.random().toString(36).slice(2)}`, type: "text", html: "" },
    ]);

  const addImageBlock = () =>
    setBlocks((prev) => [
      ...prev,
      {
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type: "images",
        images: [],
        newImageSize: "default",
      },
    ]);

  const moveBlock = (id: string, dir: -1 | 1) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const copy = [...prev];
      const tmp = copy[idx];
      copy[idx] = copy[nextIdx];
      copy[nextIdx] = tmp;
      return copy;
    });
  };

  const removeBlock = (id: string) => {
    setBlocks((prev) => {
      const next = prev.filter((b) => b.id !== id);
      return next.length ? next : [{ id: `text_${Date.now()}`, type: "text", html: "" }];
    });
  };

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-black">Blogs Editor</h1>
          <p className="text-gray-600 text-sm mt-1">Create, edit, publish blogs for the website.</p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={startNew}
            className="px-4 py-2 rounded bg-white hover:bg-gray-50 text-black border border-gray-200"
          >
            New blog
          </button>
          <button
            type="button"
            onClick={() => setIsPreviewOpen(true)}
            className="px-4 py-2 rounded bg-white hover:bg-gray-50 text-black border border-gray-200"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {form.id ? (
            <button
              type="button"
              onClick={del}
              disabled={saving}
              className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-60"
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded">{error}</div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* List */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="text-black font-semibold">All blogs</div>
            <button
              type="button"
              onClick={loadBlogs}
              className="text-sm text-gray-600 hover:text-black"
              disabled={loading}
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="mt-4 text-gray-600">Loading…</div>
          ) : blogs.length === 0 ? (
            <div className="mt-4 text-gray-600">No blogs yet.</div>
          ) : (
            <div className="mt-4 space-y-2 max-h-[70vh] overflow-auto pr-1">
              {blogs.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => loadBlogById(b.id)}
                  className={`w-full text-left rounded-lg p-3 border transition-colors ${
                    b.id === selectedId
                      ? "bg-gray-100 border-gray-200"
                      : "bg-white hover:bg-gray-50 border-gray-200"
                  }`}
                >
                  <div className="text-black font-semibold line-clamp-2">{b.title}</div>
                  <div className="text-xs text-gray-600 mt-1">/{b.slug}</div>
                  <div className="mt-2 inline-flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${
                        b.is_published
                          ? "bg-emerald-500/20 border-emerald-500/30 text-black"
                          : "bg-yellow-500/20 border-yellow-500/30 text-black"
                      }`}
                    >
                      {b.is_published ? "Published" : "Draft"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Editor */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-700 mb-1">Title</label>
              <input
                value={String(form.title || "")}
                onChange={(e) => {
                  const nextTitle = e.target.value;
                  setForm((p) => ({ ...p, title: nextTitle, slug: p.slug ? p.slug : slugify(nextTitle) }));
                }}
                className="w-full px-3 py-2 rounded bg-white text-black"
                placeholder="Blog title"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-700 mb-1">Slug</label>
              <input
                value={String(form.slug || "")}
                onChange={(e) => setForm((p) => ({ ...p, slug: slugify(e.target.value) }))}
                className="w-full px-3 py-2 rounded bg-white text-black"
                placeholder="my-blog-post"
              />
              <div className="text-xs text-gray-600 mt-1">Used in URL: /blogs/{String(form.slug || "")}</div>
            </div>

            <div>
              <label className="block text-sm text-gray-700 mb-1">Author name</label>
              <input
                value={String(form.author_name || "")}
                onChange={(e) => setForm((p) => ({ ...p, author_name: e.target.value }))}
                className="w-full px-3 py-2 rounded bg-white text-black"
                placeholder="Grand Link"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-700 mb-1">Cover image</label>
              <div className="flex gap-2">
                <input
                  value={String(form.cover_image_url || "")}
                  onChange={(e) => setForm((p) => ({ ...p, cover_image_url: e.target.value }))}
                  className="w-full px-3 py-2 rounded bg-white text-black"
                  placeholder="https://..."
                />
                <input
                  ref={coverFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) await uploadCoverImage(f);
                  }}
                />
                <button
                  type="button"
                  disabled={uploadingCover}
                  onClick={() => coverFileInputRef.current?.click()}
                  className="px-3 py-2 rounded bg-white hover:bg-gray-50 text-black border border-gray-200 disabled:opacity-60 shrink-0"
                  title={`Uploads to Storage bucket: ${BLOG_COVER_BUCKET}`}
                >
                  {uploadingCover ? "Uploading…" : "Upload"}
                </button>
              </div>
              <div className="text-xs text-gray-600 mt-1">Uploads to Supabase Storage bucket: {BLOG_COVER_BUCKET}</div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm text-gray-700 mb-1">Excerpt</label>
              <textarea
                value={String(form.excerpt || "")}
                onChange={(e) => setForm((p) => ({ ...p, excerpt: e.target.value }))}
                className="w-full px-3 py-2 rounded bg-white text-black min-h-[90px]"
                placeholder="Short summary shown on the blogs list…"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm text-gray-700 mb-2">Content</label>

            <div className="space-y-4">
              {blocks.map((block, idx) => (
                <div key={block.id} className="border border-gray-200 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-sm font-semibold text-black">
                      {block.type === "text" ? `Text section ${idx + 1}` : `Image section ${idx + 1}`}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => moveBlock(block.id, -1)}
                        disabled={idx === 0}
                        className="px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 text-black disabled:opacity-50"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveBlock(block.id, 1)}
                        disabled={idx === blocks.length - 1}
                        className="px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 text-black disabled:opacity-50"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeBlock(block.id)}
                        className="px-2 py-1 rounded border border-red-200 bg-red-50 hover:bg-red-100 text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {block.type === "text" ? (
                    <RichTextEditor
                      value={block.html}
                      onChange={(v) =>
                        setBlocks((prev) =>
                          prev.map((b) => (b.id === block.id && b.type === "text" ? { ...b, html: v } : b))
                        )
                      }
                    />
                  ) : (
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm text-gray-700">New images size:</div>
                        <select
                          className="px-2 py-1 border rounded text-sm bg-white"
                          value={block.newImageSize}
                          onChange={(e) => {
                            const next = e.target.value as ImageSize;
                            setBlocks((prev) =>
                              prev.map((b) =>
                                b.id === block.id && b.type === "images" ? { ...b, newImageSize: next } : b
                              )
                            );
                          }}
                          title="Choose the default size for newly added images"
                        >
                          <option value="default">Default</option>
                          <option value="sm">Small</option>
                          <option value="md">Medium</option>
                          <option value="lg">Large</option>
                          <option value="full">Full</option>
                        </select>

                        <input
                          id={`img_input_${block.id}`}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={async (e) => {
                            const files = Array.from(e.target.files || []);
                            e.target.value = "";
                            if (!files.length) return;

                            try {
                              const items: ImageItem[] = [];
                              for (const f of files) {
                                const url = await uploadInlineImage(f);
                                items.push({ url, size: block.newImageSize || "default" });
                              }

                              setBlocks((prev) =>
                                prev.map((b) =>
                                  b.id === block.id && b.type === "images"
                                    ? { ...b, images: [...b.images, ...items] }
                                    : b
                                )
                              );
                              showToast("Images added.");
                            } catch (err: any) {
                              setError(err?.message || String(err));
                            }
                          }}
                        />

                        <button
                          type="button"
                          onClick={() => {
                            const el = document.getElementById(`img_input_${block.id}`) as HTMLInputElement | null;
                            el?.click();
                          }}
                          className="px-3 py-2 rounded bg-white hover:bg-gray-50 text-black border border-gray-200"
                        >
                          Add images
                        </button>
                      </div>

                      {block.images.length ? (
                        <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-3">
                          {block.images.map((img, i) => (
                            <div key={(img as any)?.url ? (img as any).url + i : String(img) + i} className="relative">
                              <img
                                src={typeof img === "string" ? String(img) : String((img as any).url)}
                                alt=""
                                className="w-full h-32 object-cover rounded-lg border border-gray-200"
                              />

                              <div className="absolute bottom-2 left-2">
                                <select
                                  className="px-2 py-1 text-xs rounded bg-white/90 border border-gray-200 text-black"
                                  value={(typeof img === "string" ? "default" : (img as any).size) || "default"}
                                  onChange={(e) => {
                                    const nextSize = e.target.value as ImageSize;
                                    setBlocks((prev) =>
                                      prev.map((b) => {
                                        if (b.id !== block.id || b.type !== "images") return b;
                                        const nextImages = b.images.map((it: any, idx2: number) => {
                                          if (idx2 !== i) return it;
                                          if (typeof it === "string") return { url: String(it), size: nextSize };
                                          return { ...it, size: nextSize };
                                        });
                                        return { ...b, images: nextImages };
                                      })
                                    );
                                  }}
                                  title="Image size"
                                >
                                  <option value="default">Default</option>
                                  <option value="sm">Small</option>
                                  <option value="md">Medium</option>
                                  <option value="lg">Large</option>
                                  <option value="full">Full</option>
                                </select>
                              </div>

                              <button
                                type="button"
                                onClick={() =>
                                  setBlocks((prev) =>
                                    prev.map((b) =>
                                      b.id === block.id && b.type === "images"
                                        ? { ...b, images: b.images.filter((_, x) => x !== i) }
                                        : b
                                    )
                                  )
                                }
                                className="absolute top-2 right-2 px-2 py-1 text-xs rounded bg-white/90 border border-gray-200 hover:bg-white text-black"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-gray-600">No images yet.</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              <button
                type="button"
                onClick={addTextBlock}
                className="px-3 py-2 rounded bg-white hover:bg-gray-50 text-black border border-gray-200"
              >
                Text Content
              </button>
              <button
                type="button"
                onClick={addImageBlock}
                className="px-3 py-2 rounded bg-white hover:bg-gray-50 text-black border border-gray-200"
              >
                Image Content
              </button>
              <div className="text-xs text-gray-600 self-center">
                Add as many sections as you want.
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-gray-700">
              <input
                type="checkbox"
                checked={!!form.is_published}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    is_published: e.target.checked,
                    published_at: e.target.checked ? p.published_at || new Date().toISOString() : null,
                  }))
                }
              />
              Published
            </label>

            <div className="text-xs text-gray-600">
              {form.is_published ? `Published at: ${form.published_at || "(auto)"}` : "Draft (not visible on website)"}
            </div>
          </div>

          {form.cover_image_url ? (
            <div className="mt-4">
              <div className="text-sm text-gray-700 mb-2">Cover preview</div>
              <img
                src={String(form.cover_image_url)}
                alt="Cover"
                className="w-full max-h-[260px] object-cover rounded-lg border border-gray-200"
              />
            </div>
          ) : null}
        </div>
      </div>

      {isPreviewOpen ? (
        <div className="fixed inset-0 z-50 bg-black/60 p-4 md:p-8" onClick={() => setIsPreviewOpen(false)}>
          <div
            className="mx-auto max-w-3xl w-full h-[80vh] bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
              <div className="font-semibold text-black">Preview</div>
              <button
                type="button"
                className="px-3 py-1.5 rounded bg-white border border-gray-200 hover:bg-gray-50 text-black"
                onClick={() => setIsPreviewOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="p-4 md:p-6 overflow-y-auto">
              <h2 className="text-2xl font-bold text-black">{String(form.title || "(Untitled)")}</h2>
              <div className="text-sm text-gray-600 mt-1">/blogs/{String(form.slug || "")}</div>

              {form.cover_image_url ? (
                <img
                  src={String(form.cover_image_url)}
                  alt="Cover"
                  className="w-full mt-4 max-h-[320px] object-cover rounded-lg border border-gray-200"
                />
              ) : null}

              {form.excerpt ? (
                <p className="mt-4 text-gray-700">{String(form.excerpt)}</p>
              ) : null}

              <div
                className="admin-blog-preview mt-6"
                dangerouslySetInnerHTML={{ __html: contentHtml }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-black text-white px-4 py-2 rounded-full text-sm shadow">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
