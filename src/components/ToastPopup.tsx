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
      ? {
          accent: "bg-emerald-600",
          bg: "bg-emerald-50",
          border: "border-emerald-200",
          title: "text-emerald-900",
          msg: "text-emerald-800",
          iconBg: "bg-emerald-100",
          iconFg: "text-emerald-700",
          icon: "✓",
        }
      : state.type === "info"
      ? {
          accent: "bg-blue-600",
          bg: "bg-blue-50",
          border: "border-blue-200",
          title: "text-blue-900",
          msg: "text-blue-800",
          iconBg: "bg-blue-100",
          iconFg: "text-blue-700",
          icon: "i",
        }
      : {
          accent: "bg-red-600",
          bg: "bg-red-50",
          border: "border-red-200",
          title: "text-red-900",
          msg: "text-red-800",
          iconBg: "bg-red-100",
          iconFg: "text-red-700",
          icon: "✕",
        };

  return (
    <div className="fixed top-4 right-4 z-[1000] pointer-events-none w-[92vw] max-w-md">
      <div className="pointer-events-auto">
        <div className={`relative overflow-hidden rounded-lg border ${palette.border} ${palette.bg} shadow-xl`}>
          <div className={`absolute left-0 top-0 h-full w-1 ${palette.accent}`} />
          <div className="p-4 pl-5">
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${palette.iconBg} ${palette.iconFg}`}>
                {palette.icon}
              </span>
              <div className="flex-1 pr-6">
                <div className={`font-semibold leading-5 ${palette.title}`}>{state.title || (state.type === "success" ? "Success" : state.type === "error" ? "Error" : "Information")}</div>
                <div className={`mt-1 text-sm leading-5 ${palette.msg}`}>{state.message}</div>
              </div>
              <button type="button" onClick={onClose} className="absolute right-3 top-2 text-black/55 hover:text-black" aria-label="Close notification">
                ×
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
