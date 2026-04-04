"use client";

import { useEffect, useMemo, useState } from "react";

type AdminSession = {
  id: string;
  username: string;
  role?: string | null;
  position?: string | null;
};

type ReviewRow = {
  id: string;
  product_id: string;
  user_id: string;
  rating: number;
  comment: string;
  created_at: string;
};

function shortUserLabel(userId: string): string {
  const raw = String(userId || "");
  if (raw.length <= 10) return raw;
  return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
}

export default function ProductReviewsPage() {
  const [currentAdmin, setCurrentAdmin] = useState<AdminSession | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("adminSession");
      if (!raw) return;
      setCurrentAdmin(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  const loadReviews = async () => {
    if (!currentAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/product-reviews", {
        headers: { Authorization: JSON.stringify(currentAdmin || {}) },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed to load reviews (${res.status})`);
      setReviews((json?.reviews || []) as ReviewRow[]);
    } catch (e: any) {
      setReviews([]);
      setError(e?.message || "Failed to load reviews");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!currentAdmin?.id) return;
    void loadReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAdmin?.id]);

  const deleteReview = async (reviewId: string) => {
    if (!currentAdmin) return;
    if (!window.confirm("Delete this review?")) return;

    setDeletingId(reviewId);
    try {
      const res = await fetch("/api/product-reviews", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: JSON.stringify(currentAdmin || {}),
        },
        body: JSON.stringify({ reviewId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed to delete review (${res.status})`);
      setReviews((prev) => prev.filter((r) => r.id !== reviewId));
    } catch (e: any) {
      alert(e?.message || "Failed to delete review");
    } finally {
      setDeletingId(null);
    }
  };

  const averageRating = useMemo(() => {
    if (!reviews.length) return 0;
    return reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / reviews.length;
  }, [reviews]);

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8 space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Product Reviews</h1>
            <p className="mt-1 text-sm text-gray-600">Moderate reviews left by completed buyers.</p>
            <div className="mt-2 text-xs text-gray-500">
              {reviews.length ? `Average rating: ${averageRating.toFixed(1)} / 5 • ${reviews.length} review(s)` : "No reviews loaded yet."}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadReviews()}
            disabled={loading || !currentAdmin}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        )}

        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Product</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">User</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Rating</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Comment</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-700">Created</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {reviews.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-500">
                    {loading ? "Loading…" : "No reviews."}
                  </td>
                </tr>
              ) : (
                reviews.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-800 whitespace-nowrap">{r.product_id}</td>
                    <td className="px-4 py-3 text-sm text-gray-800 whitespace-nowrap">{shortUserLabel(r.user_id)}</td>
                    <td className="px-4 py-3 text-sm text-gray-800 whitespace-nowrap">{Number(r.rating || 0)} / 5</td>
                    <td className="px-4 py-3 text-sm text-gray-800 max-w-[40rem]">
                      <div className="whitespace-pre-wrap break-words">{r.comment}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void deleteReview(r.id)}
                        disabled={deletingId === r.id}
                        className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {deletingId === r.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
