"use client";

import React from "react";

type AdminLayoutProps = {
  children: React.ReactNode;
  className?: string;
};

// Minimal, safe AdminLayout to wrap admin pages without build errors
export default function AdminLayout({ children, className }: AdminLayoutProps) {
  return (
    <div className={className ?? "min-h-screen bg-gray-50"}>
      {children}
    </div>
  );
}