"use client";

import React from "react";
import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="bg-white border border-gray-200 rounded-lg p-8 max-w-lg w-full">
        <h1 className="text-2xl font-bold text-gray-900">Access denied</h1>
        <p className="mt-2 text-gray-700">
          You don’t have permission to access this page. If you believe this is a mistake,
          contact a Superadmin to update your position permissions.
        </p>
        <div className="mt-6 flex gap-3">
          <Link className="px-4 py-2 bg-black text-white rounded" href="/dashboard">
            Go to Dashboard
          </Link>
          <Link className="px-4 py-2 border rounded text-black" href="/dashboard/settings">
            Settings
          </Link>
        </div>
      </div>
    </div>
  );
}
