"use client";

import { useEffect } from "react";

export type ToastType = "error" | "success" | "info";

export type ToastPopupState = {
  open: boolean;
  type: ToastType;
  title?: string;
  message: string;
};

export default function ToastPopup({
  state,
  onClose,
  autoCloseMs = 4500,
}: {
  state: ToastPopupState;
  onClose: () => void;
  autoCloseMs?: number;
}) {
  useEffect(() => {
    if (!state.open) return;
    const t = setTimeout(onClose, autoCloseMs);
    return () => clearTimeout(t);
  }, [state.open, autoCloseMs, onClose]);

  if (!state.open) return null;

  const palette =
    state.type === "success"
      ? { ring: "ring-green-200", bg: "bg-green-50", border: "border-green-200", title: "text-green-800", msg: "text-green-700" }
      : state.type === "info"
      ? { ring: "ring-blue-200", bg: "bg-blue-50", border: "border-blue-200", title: "text-blue-800", msg: "text-blue-700" }
      : { ring: "ring-red-200", bg: "bg-red-50", border: "border-red-200", title: "text-red-800", msg: "text-red-700" };

  return (
    <div className="fixed inset-0 z-[1000] pointer-events-none">
      <div className="absolute top-4 right-4 w-[92vw] max-w-md pointer-events-auto">
        <div className={`rounded-lg border ${palette.border} ${palette.bg} shadow-lg ring-1 ${palette.ring}`}>
          <div className="p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                {state.type === "success" ? (
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-700">✓</span>
                ) : state.type === "info" ? (
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700">i</span>
                ) : (
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-100 text-red-700">!</span>
                )}
              </div>
              <div className="flex-1">
                {state.title ? (
                  <div className={`font-semibold ${palette.title}`}>{state.title}</div>
                ) : null}
                <div className={`text-sm ${palette.msg}`}>{state.message}</div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="ml-2 text-black/60 hover:text-black"
                aria-label="Close notification"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
