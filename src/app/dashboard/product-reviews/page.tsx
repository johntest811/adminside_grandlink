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

  const [selectedProductId, setSelectedProductId] = useState<string>("all");
  const [minRating, setMinRating] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showProductsWithoutReviews, setShowProductsWithoutReviews] = useState(true);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  useEffect(() => {
    try {
      const raw = localStorage.getItem("adminSession");
      if (!raw) return;
      setCurrentAdmin(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  const loadProducts = async () => {
    try {
      const res = await fetch("/api/products", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed to load products (${res.status})`);
      setProducts((json?.products || []) as ProductRow[]);
    } catch (loadErr) {
      console.warn("Failed to load products", loadErr);
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

  const filteredReviews = useMemo(() => {
    const query = normalizeText(searchQuery);
    const minimumRating = minRating === "all" ? null : Number(minRating);

    return reviews.filter((review) => {
      if (selectedProductId !== "all" && review.product_id !== selectedProductId) {
        return false;
      }

      if (minimumRating !== null && Number(review.rating || 0) < minimumRating) {
        return false;
      }

      if (!query) return true;

      const product = productMap.get(review.product_id);
      const searchable = [review.comment, review.user_id, review.product_id, product?.name]
        .filter(Boolean)
        .map((value) => normalizeText(value));

      return searchable.some((entry) => entry.includes(query));
    });
  }, [minRating, productMap, reviews, searchQuery, selectedProductId]);

  const reviewsByProduct = useMemo(() => {
    const grouped = new Map<string, ReviewRow[]>();

    filteredReviews.forEach((review) => {
      if (!grouped.has(review.product_id)) {
        grouped.set(review.product_id, []);
      }
      grouped.get(review.product_id)!.push(review);
    });

    grouped.forEach((list) => {
      list.sort((left, right) => {
        const leftTime = new Date(left.created_at).getTime();
        const rightTime = new Date(right.created_at).getTime();
        return sortOrder === "newest" ? rightTime - leftTime : leftTime - rightTime;
      });
    });

    return grouped;
  }, [filteredReviews, sortOrder]);

  const visibleProductIds = useMemo(() => {
    if (selectedProductId !== "all") return [selectedProductId];

    if (showProductsWithoutReviews) {
      return productOptions.map((product) => product.id);
    }

    return productOptions
      .map((product) => product.id)
      .filter((productId) => (reviewsByProduct.get(productId) || []).length > 0);
  }, [productOptions, reviewsByProduct, selectedProductId, showProductsWithoutReviews]);

  const hasVisibleSections = useMemo(() => {
    if (!visibleProductIds.length) return false;
    if (showProductsWithoutReviews) return true;
    return visibleProductIds.some((productId) => (reviewsByProduct.get(productId) || []).length > 0);
  }, [reviewsByProduct, showProductsWithoutReviews, visibleProductIds]);

  const averageRating = useMemo(() => getAverageRating(filteredReviews), [filteredReviews]);

  const productsWithReviews = useMemo(() => {
    return productOptions.filter((product) => (reviewsByProduct.get(product.id) || []).length > 0).length;
  }, [productOptions, reviewsByProduct]);

  const getProductLabel = (productId: string) => {
    const product = productMap.get(productId);
    if (!product) return productId;

    const category = String(product.category || "").trim();
    return category ? `${product.name} (${category})` : product.name;
  };

  const isAnyFilterApplied =
    selectedProductId !== "all" ||
    minRating !== "all" ||
    searchQuery.trim().length > 0 ||
    !showProductsWithoutReviews;

  const clearFilters = () => {
    setSelectedProductId("all");
    setMinRating("all");
    setSearchQuery("");
    setShowProductsWithoutReviews(true);
    setSortOrder("newest");
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8 space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Product Reviews</h1>
            <p className="mt-1 text-sm text-gray-600">Comments are grouped by product for easier moderation.</p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
              <span>Products: {productOptions.length}</span>
              <span>With reviews: {productsWithReviews}</span>
              <span>Visible reviews: {filteredReviews.length}</span>
              <span>Average rating: {filteredReviews.length ? `${averageRating.toFixed(1)} / 5` : "N/A"}</span>
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

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-sm text-gray-700">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Product</span>
            <select
              value={selectedProductId}
              onChange={(event) => setSelectedProductId(event.target.value)}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="all">All products</option>
              {productOptions.map((product) => (
                <option key={product.id} value={product.id}>
                  {getProductLabel(product.id)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-gray-700">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Minimum rating</span>
            <select
              value={minRating}
              onChange={(event) => setMinRating(event.target.value)}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="all">All ratings</option>
              <option value="5">5 stars</option>
              <option value="4">4 stars and up</option>
              <option value="3">3 stars and up</option>
              <option value="2">2 stars and up</option>
              <option value="1">1 star and up</option>
            </select>
          </label>

          <label className="text-sm text-gray-700 md:col-span-2 xl:col-span-1">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search comment, product, or user"
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            />
          </label>

          <label className="text-sm text-gray-700">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Sort comments</span>
            <select
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value as "newest" | "oldest")}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>

          <label className="flex items-center gap-2 rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={showProductsWithoutReviews}
              onChange={(event) => setShowProductsWithoutReviews(event.target.checked)}
            />
            Show products with no reviews
          </label>
        </div>

        {isAnyFilterApplied && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={clearFilters}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Clear filters
            </button>
          </div>
        )}

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        )}
      </div>

      {!hasVisibleSections ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500 shadow-sm">
          No products or comments match the current filters.
        </div>
      ) : (
        visibleProductIds.map((productId) => {
          const productReviews = reviewsByProduct.get(productId) || [];
          const avgRating = getAverageRating(productReviews);

          if (!showProductsWithoutReviews && productReviews.length === 0) {
            return null;
          }

          return (
            <section key={productId} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{getProductLabel(productId)}</h2>
                  <p className="mt-1 text-xs text-gray-500">Product ID: {productId}</p>
                </div>
                <div className="text-right text-xs text-gray-500">
                  <div>Comments: {productReviews.length}</div>
                  <div>Average rating: {productReviews.length ? `${avgRating.toFixed(1)} / 5` : "N/A"}</div>
                </div>
              </div>

              {productReviews.length === 0 ? (
                <div className="pt-4 text-sm text-gray-500">No reviews for this product yet.</div>
              ) : (
                <div className="mt-4 space-y-3">
                  {productReviews.map((review) => (
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
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
