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

type ProductRow = {
  id: string;
  name: string;
  category?: string | null;
};

function shortUserLabel(userId: string): string {
  const raw = String(userId || "");
  if (raw.length <= 10) return raw;
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function normalizeText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function getAverageRating(rows: ReviewRow[]): number {
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => sum + Number(row.rating || 0), 0) / rows.length;
}

export default function ProductReviewsPage() {
  const [currentAdmin, setCurrentAdmin] = useState<AdminSession | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [activeProductId, setActiveProductId] = useState<string>("");
  const [productSearch, setProductSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  const [newReviewUserId, setNewReviewUserId] = useState("");
  const [newReviewRating, setNewReviewRating] = useState<number>(5);
  const [newReviewComment, setNewReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("adminSession");
      if (!raw) return;
      setCurrentAdmin(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (currentAdmin?.id && !newReviewUserId) {
      setNewReviewUserId(String(currentAdmin.id));
    }
  }, [currentAdmin?.id, newReviewUserId]);

  const loadProducts = async () => {
    try {
      const res = await fetch("/api/products", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed to load products (${res.status})`);
      setProducts((json?.products || []) as ProductRow[]);
    } catch (loadErr) {
      console.warn("Failed to load products", loadErr);
      setProducts([]);
    }
  };

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
    } catch (loadErr: any) {
      setReviews([]);
      setError(loadErr?.message || "Failed to load reviews");
    } finally {
      setLoading(false);
    }
  };

  const refreshAll = async () => {
    await Promise.allSettled([loadProducts(), loadReviews()]);
  };

  useEffect(() => {
    void loadProducts();
  }, []);

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
      setReviews((prev) => prev.filter((row) => row.id !== reviewId));
    } catch (deleteErr: any) {
      alert(deleteErr?.message || "Failed to delete review");
    } finally {
      setDeletingId(null);
    }
  };

  const productMap = useMemo(() => {
    const map = new Map<string, ProductRow>();
    products.forEach((product) => {
      map.set(product.id, product);
    });
    return map;
  }, [products]);

  const productOptions = useMemo(() => {
    const merged = new Map<string, ProductRow>();

    products.forEach((product) => {
      merged.set(product.id, product);
    });

    reviews.forEach((review) => {
      if (!merged.has(review.product_id)) {
        merged.set(review.product_id, { id: review.product_id, name: review.product_id });
      }
    });

    return Array.from(merged.values()).sort((left, right) => {
      const leftName = String(left.name || left.id || "");
      const rightName = String(right.name || right.id || "");
      return leftName.localeCompare(rightName);
    });
  }, [products, reviews]);

  useEffect(() => {
    if (!productOptions.length) {
      setActiveProductId("");
      return;
    }

    if (!activeProductId || !productOptions.some((item) => item.id === activeProductId)) {
      setActiveProductId(productOptions[0].id);
    }
  }, [activeProductId, productOptions]);

  const filteredProductOptions = useMemo(() => {
    const query = normalizeText(productSearch);
    if (!query) return productOptions;

    return productOptions.filter((product) => {
      const searchable = [product.name, product.category, product.id]
        .filter(Boolean)
        .map((value) => normalizeText(value));
      return searchable.some((value) => value.includes(query));
    });
  }, [productOptions, productSearch]);

  const activeProduct = useMemo(() => {
    if (!activeProductId) return null;
    return productMap.get(activeProductId) || { id: activeProductId, name: activeProductId };
  }, [activeProductId, productMap]);

  const activeProductReviews = useMemo(() => {
    if (!activeProductId) return [];

    const rows = reviews.filter((review) => review.product_id === activeProductId);
    rows.sort((left, right) => {
      const leftTime = new Date(left.created_at).getTime();
      const rightTime = new Date(right.created_at).getTime();
      return sortOrder === "newest" ? rightTime - leftTime : leftTime - rightTime;
    });
    return rows;
  }, [activeProductId, reviews, sortOrder]);

  const activeAverageRating = useMemo(() => getAverageRating(activeProductReviews), [activeProductReviews]);

  const productReviewSummary = useMemo(() => {
    const summary = new Map<string, { count: number; averageRating: number }>();
    for (const product of productOptions) {
      const rows = reviews.filter((review) => review.product_id === product.id);
      summary.set(product.id, {
        count: rows.length,
        averageRating: getAverageRating(rows),
      });
    }
    return summary;
  }, [productOptions, reviews]);

  const productsWithReviews = useMemo(() => {
    return productOptions.filter((product) => {
      const info = productReviewSummary.get(product.id);
      return Boolean(info && info.count > 0);
    }).length;
  }, [productOptions, productReviewSummary]);

  const overallAverageRating = useMemo(() => getAverageRating(reviews), [reviews]);

  const getProductLabel = (productId: string) => {
    const product = productMap.get(productId);
    if (!product) return productId;

    const category = String(product.category || "").trim();
    return category ? `${product.name} (${category})` : product.name;
  };

  const createReview = async () => {
    if (!currentAdmin) {
      alert("Admin session is required.");
      return;
    }

    if (!activeProductId) {
      alert("Select a product first.");
      return;
    }

    const userId = String(newReviewUserId || currentAdmin.id || "").trim();
    const comment = String(newReviewComment || "").trim();

    if (!userId) {
      alert("User ID is required to create a review.");
      return;
    }

    if (!comment) {
      alert("Please enter a review comment.");
      return;
    }

    setSubmittingReview(true);
    setError(null);
    try {
      const res = await fetch("/api/product-reviews", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: JSON.stringify(currentAdmin || {}),
        },
        body: JSON.stringify({
          productId: activeProductId,
          userId,
          rating: newReviewRating,
          comment,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed to create review (${res.status})`);

      const created = json?.review as ReviewRow | undefined;
      if (created) {
        setReviews((prev) => [created, ...prev]);
      } else {
        await loadReviews();
      }

      setNewReviewComment("");
      setNewReviewRating(5);
    } catch (createErr: any) {
      const message = createErr?.message || "Failed to create review";
      setError(message);
      alert(message);
    } finally {
      setSubmittingReview(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8 space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Product Reviews</h1>
            <p className="mt-1 text-sm text-gray-600">Click a product to view reviews and manage add/delete actions.</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
              <span>Products: {productOptions.length}</span>
              <span>With reviews: {productsWithReviews}</span>
              <span>Total reviews: {reviews.length}</span>
              <span>Average rating: {reviews.length ? `${overallAverageRating.toFixed(1)} / 5` : "N/A"}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={loading || !currentAdmin}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {error ? (
          <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
        <aside className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Search products</label>
              <input
                type="text"
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="Search by product name"
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Sort reviews</label>
              <select
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value as "newest" | "oldest")}
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
          </div>

          <div className="mt-4 max-h-[620px] space-y-2 overflow-y-auto pr-1">
            {filteredProductOptions.length === 0 ? (
              <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                No products match your search.
              </div>
            ) : (
              filteredProductOptions.map((product) => {
                const summary = productReviewSummary.get(product.id) || { count: 0, averageRating: 0 };
                const isActive = product.id === activeProductId;
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => setActiveProductId(product.id)}
                    className={`w-full rounded border px-3 py-3 text-left transition ${
                      isActive
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/50"
                    }`}
                  >
                    <div className="text-sm font-semibold text-gray-900">{getProductLabel(product.id)}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {summary.count} review{summary.count === 1 ? "" : "s"}
                      {summary.count > 0 ? ` • ${summary.averageRating.toFixed(1)} / 5` : ""}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          {!activeProduct ? (
            <div className="rounded border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
              Select a product to view and manage reviews.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 pb-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">{getProductLabel(activeProduct.id)}</h2>
                  <p className="mt-1 text-xs text-gray-500">Product ID: {activeProduct.id}</p>
                </div>
                <div className="text-right text-xs text-gray-500">
                  <div>Reviews: {activeProductReviews.length}</div>
                  <div>Average rating: {activeProductReviews.length ? `${activeAverageRating.toFixed(1)} / 5` : "N/A"}</div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Add Review</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">User ID</span>
                    <input
                      type="text"
                      value={newReviewUserId}
                      onChange={(event) => setNewReviewUserId(event.target.value)}
                      className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                    />
                  </label>

                  <label className="text-sm text-gray-700">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Rating</span>
                    <select
                      value={newReviewRating}
                      onChange={(event) => setNewReviewRating(Number(event.target.value || 5))}
                      className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                    >
                      <option value={5}>5 stars</option>
                      <option value={4}>4 stars</option>
                      <option value={3}>3 stars</option>
                      <option value={2}>2 stars</option>
                      <option value={1}>1 star</option>
                    </select>
                  </label>
                </div>

                <label className="mt-3 block text-sm text-gray-700">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Comment</span>
                  <textarea
                    rows={4}
                    value={newReviewComment}
                    onChange={(event) => setNewReviewComment(event.target.value)}
                    placeholder="Write review comment..."
                    className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  />
                </label>

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void createReview()}
                    disabled={submittingReview || !currentAdmin}
                    className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {submittingReview ? "Adding..." : "Add Review"}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Existing Reviews</h3>

                {activeProductReviews.length === 0 ? (
                  <div className="rounded border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
                    No reviews for this product yet.
                  </div>
                ) : (
                  activeProductReviews.map((review) => (
                    <article key={review.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="text-sm text-gray-700">
                          <div>
                            <span className="font-semibold text-gray-900">User:</span> {shortUserLabel(review.user_id)}
                          </div>
                          <div>
                            <span className="font-semibold text-gray-900">Rating:</span> {Number(review.rating || 0)} / 5
                          </div>
                          <div className="text-xs text-gray-500">{new Date(review.created_at).toLocaleString()}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void deleteReview(review.id)}
                          disabled={deletingId === review.id}
                          className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingId === review.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>

                      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-gray-800">
                        {review.comment || "No comment provided."}
                      </p>
                    </article>
                  ))
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
