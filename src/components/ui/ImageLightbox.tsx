"use client";

import { useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

type Props = {
  open: boolean;
  urls: string[];
  index: number;
  title?: string;
  onClose: () => void;
  onIndexChange: (next: number) => void;
};

export default function ImageLightbox({
  open,
  urls,
  index,
  title,
  onClose,
  onIndexChange,
}: Props) {
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onIndexChange(Math.max(0, index - 1));
      if (e.key === "ArrowRight") onIndexChange(Math.min(urls.length - 1, index + 1));
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, index, urls.length, onClose, onIndexChange]);

  if (!open) return null;
  const safeUrls = Array.isArray(urls) ? urls : [];
  const hasMany = safeUrls.length > 1;
  const current = safeUrls[index] || safeUrls[0];

  return (
    <div className="fixed inset-0 z-[80]">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="relative w-full max-w-5xl rounded-2xl bg-white shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">
                {title || "Image"}
              </div>
              <div className="text-xs text-gray-500">
                {safeUrls.length ? `${index + 1} / ${safeUrls.length}` : "0 / 0"}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border bg-white text-gray-600 hover:bg-gray-50"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          <div className="relative bg-black">
            <div className="relative flex items-center justify-center">
              {hasMany ? (
                <button
                  type="button"
                  onClick={() => onIndexChange(Math.max(0, index - 1))}
                  disabled={index <= 0}
                  className="absolute left-3 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow hover:bg-white disabled:opacity-40"
                  aria-label="Previous"
                >
                  <ChevronLeft size={20} />
                </button>
              ) : null}

              <div className="max-h-[75vh] w-full flex items-center justify-center p-3">
                {current ? (
                  <img
                    src={current}
                    alt={title || "Image"}
                    className="max-h-[72vh] w-auto max-w-full object-contain select-none"
                    draggable={false}
                  />
                ) : (
                  <div className="p-10 text-sm text-white/80">No image</div>
                )}
              </div>

              {hasMany ? (
                <button
                  type="button"
                  onClick={() => onIndexChange(Math.min(safeUrls.length - 1, index + 1))}
                  disabled={index >= safeUrls.length - 1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-gray-800 shadow hover:bg-white disabled:opacity-40"
                  aria-label="Next"
                >
                  <ChevronRight size={20} />
                </button>
              ) : null}
            </div>
          </div>

          {hasMany ? (
            <div className="border-t bg-white px-4 py-3">
              <div className="flex gap-2 overflow-x-auto">
                {safeUrls.map((u, i) => (
                  <button
                    key={u + i}
                    type="button"
                    onClick={() => onIndexChange(i)}
                    className={`h-14 w-14 rounded border overflow-hidden shrink-0 ${
                      i === index ? "ring-2 ring-green-600" : "hover:bg-gray-50"
                    }`}
                    aria-label={`Open image ${i + 1}`}
                  >
                    <img src={u} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
