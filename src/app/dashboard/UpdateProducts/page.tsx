"use client";
import { useCallback, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import { logActivity } from "@/app/lib/activity";
import { notifyProductDeleted } from "@/app/lib/notifications";
import ToastPopup, { type ToastPopupState } from "@/components/ToastPopup";
import {
  mergeCategoryOptions,
  normalizeCategoryLabel,
  parseCategorySelection,
} from "../products/productFormConfig";

type Product = {
  id: string;
  name: string;
  price: number;
  category: string;
  type?: string;
  inventory?: number;
  image1?: string;
  created_at: string;
};

export default function UpdateProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedCategoryFilters, setSelectedCategoryFilters] = useState<string[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [newCategoryOption, setNewCategoryOption] = useState("");
  const [savingCategories, setSavingCategories] = useState(false);
  const [showCategoryManagerPopup, setShowCategoryManagerPopup] = useState(false);
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [toast, setToast] = useState<ToastPopupState>({ open: false, type: "info", title: "", message: "" });

  const showToast = (next: Omit<ToastPopupState, "open">) => setToast({ open: true, ...next });

  // Load current admin and log page access
  useEffect(() => {
    const loadAdmin = async () => {
      try {
        const sessionData = localStorage.getItem('adminSession');
        if (sessionData) {
          const admin = JSON.parse(sessionData);
          setCurrentAdmin(admin);
          
          // Log detailed page access
          await logActivity({
            admin_id: admin.id,
            admin_name: admin.username,
            action: 'view',
            entity_type: 'page',
            details: `Admin ${admin.username} accessed Update Products management page`,
            page: 'UpdateProducts',
            metadata: {
              pageAccess: true,
              adminAccount: admin.username,
              adminId: admin.id,
              timestamp: new Date().toISOString(),
              userAgent: navigator.userAgent,
              referrer: document.referrer || 'direct'
            }
          });
        }
      } catch (error) {
        console.error("Error loading admin:", error);
      }
    };

    loadAdmin();

    // Check for success message from localStorage
    const successData = localStorage.getItem("productUpdateSuccess");
    if (successData) {
      try {
        const { productName, changesCount } = JSON.parse(successData);
        showToast({
          type: "success",
          title: "Saved",
          message: `Product "${productName}" updated successfully (${changesCount} changes made).`,
        });
        localStorage.removeItem("productUpdateSuccess");
      } catch (error) {
        console.error("Error parsing success message:", error);
      }
    }
  }, []);

  useEffect(() => {
    if (!currentAdmin) return;
    void loadCategoryOptions();
  }, [currentAdmin]);

  const normalizeCategoryKey = (value: string | null | undefined) =>
    normalizeCategoryLabel(value).toLowerCase();

  const productMatchesCategory = (product: Product, category: string) => {
    const expected = normalizeCategoryKey(category);
    if (!expected) return true;

    return parseCategorySelection(product.category).some(
      (entry) => normalizeCategoryKey(entry) === expected
    );
  };

  const loadCategoryOptions = async () => {
    try {
      const res = await fetch("/api/product-categories", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));

      if (res.ok && Array.isArray(json.categories)) {
        setCategoryOptions(mergeCategoryOptions(json.categories));
      }
    } catch (error) {
      console.error("Error loading category options:", error);
    }
  };

  const persistCategoryOptions = async (nextCategories: string[]) => {
    setSavingCategories(true);
    try {
      const res = await fetch("/api/product-categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: nextCategories }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json.error || "Failed to save categories");
      }

      const merged = mergeCategoryOptions(
        Array.isArray(json.categories) ? json.categories : nextCategories
      );
      setCategoryOptions(merged);
      return merged;
    } finally {
      setSavingCategories(false);
    }
  };

  const fetchProducts = useCallback(async () => {
    if (!currentAdmin) return;

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("products")
        .select("id, name, price, category, type, inventory, image1, images, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching products:", error);

        // Log error
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'view',
          entity_type: 'products_list_error',
          details: `Failed to load products list: ${error.message}`,
          page: 'UpdateProducts',
          metadata: {
            error: error.message,
            adminAccount: currentAdmin.username,
            timestamp: new Date().toISOString()
          }
        });
        return;
      }

      setProducts(data || []);

      // Log successful products load with details
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'products_list',
        details: `Admin ${currentAdmin.username} loaded ${data?.length || 0} products for management`,
        page: 'UpdateProducts',
        metadata: {
          productsCount: data?.length || 0,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString(),
          productCategories: [...new Set(data?.map(p => p.category))],
          averagePrice: data?.length ? (data.reduce((sum, p) => sum + (p.price || 0), 0) / data.length).toFixed(2) : 0
        }
      });

    } catch (error) {
      console.error("Error in fetchProducts:", error);
    } finally {
      setLoading(false);
    }
  }, [currentAdmin]);

  // Fetch products with enhanced logging
  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  const handleEdit = async (productId: string, productName: string) => {
    if (currentAdmin) {
      // Get product details for logging
      const product = products.find(p => p.id === productId);
      
      // Log detailed edit initiation
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'product',
        entity_id: productId,
        details: `Admin ${currentAdmin.username} started editing product "${productName}"`,
        page: 'UpdateProducts',
        metadata: {
          productName,
          productId,
          action: 'edit_initiated',
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          productDetails: {
            category: product?.category,
            price: product?.price,
            inventory: product?.inventory,
            type: product?.type
          },
          timestamp: new Date().toISOString()
        }
      });
    }
    
    router.push(`/dashboard/UpdateProducts/${productId}`);
  };

  const handleDelete = async (productId: string, productName: string) => {
    if (!currentAdmin) {
      showToast({ type: "error", title: "Error", message: "Admin not loaded." });
      return;
    }

    if (!confirm(`Move "${productName}" to Archive/Trashcan? You can permanently delete it from the Trashcan later.`)) {
      // Log deletion cancelled
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'product_delete_cancelled',
        entity_id: productId,
        details: `Admin ${currentAdmin.username} cancelled deletion of product "${productName}"`,
        page: 'UpdateProducts',
        metadata: {
          productName,
          productId,
          action: 'delete_cancelled',
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });
      return;
    }

    setDeleteLoading(productId);

    try {
      // Get full product details before deletion for comprehensive logging
      const productToDelete = products.find(p => p.id === productId);

      // Use secure server-side API to permanently delete (bypasses RLS)
      const res = await fetch(`/api/products/${productId}`, {
        method: "DELETE",
        headers: {
          // API expects JSON-serialized admin in Authorization header for audit logs
          Authorization: JSON.stringify({ id: currentAdmin.id, username: currentAdmin.username })
        }
      });

      if (!res.ok) {
        const { error: apiError } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(apiError || `Failed to delete product (${res.status})`);
      }

      // Remove from local state
      setProducts(prev => prev.filter(p => p.id !== productId));

      // Enhanced activity logging for product deletion
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: "delete",
        entity_type: "product",
        entity_id: productId,
        details: `Admin ${currentAdmin.username} deleted product "${productName}" from ${productToDelete?.category} category (₱${productToDelete?.price})`,
        page: "UpdateProducts",
        metadata: {
          productName,
          productId,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          deletedProduct: {
            name: productName,
            category: productToDelete?.category,
            price: productToDelete?.price,
            inventory: productToDelete?.inventory,
            type: productToDelete?.type,
            image1: productToDelete?.image1,
            created_at: productToDelete?.created_at
          },
          deletionTime: new Date().toISOString(),
          remainingProductsCount: products.length - 1
        }
      });

      // Create notification for product deletion (handle error silently)
      try {
        await notifyProductDeleted(productName, currentAdmin.username);
      } catch (notifyError) {
        console.warn("Notification creation failed (non-critical):", notifyError);
      }

      showToast({
        type: "success",
        title: "Archived",
        message: `Product "${productName}" moved to Archive/Trashcan.`,
      });

    } catch (error: any) {
      console.error("Error deleting product:", error);
      showToast({
        type: "error",
        title: "Archive Failed",
        message: `Error deleting product: ${error.message}`,
      });
      
      // Log deletion error with full context
      if (currentAdmin) {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "delete",
          entity_type: "product_error",
          entity_id: productId,
          details: `Admin ${currentAdmin.username} failed to delete product "${productName}": ${error.message}`,
          page: "UpdateProducts",
          metadata: {
            productName,
            productId,
            error: error.message,
            errorDetails: error,
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            timestamp: new Date().toISOString()
          }
        });
      }
    } finally {
      setDeleteLoading(null);
    }
  };

  // Enhanced filter logging with debouncing
  const handleFilterChange = async (newFilter: string) => {
    const oldFilter = filter;
    setFilter(newFilter);
    
    if (currentAdmin && oldFilter !== newFilter && newFilter.length > 2) {
      // Debounce logging for search
      setTimeout(async () => {
        if (filter === newFilter) { // Only log if filter hasn't changed again
          const filteredCount = products.filter(product => 
            product.name.toLowerCase().includes(newFilter.toLowerCase())
          ).length;
          
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: 'view',
            entity_type: 'search_filter',
            details: `Admin ${currentAdmin.username} searched products: "${newFilter}" (${filteredCount} results)`,
            page: 'UpdateProducts',
            metadata: {
              searchTerm: newFilter,
              previousTerm: oldFilter,
              resultsCount: filteredCount,
              adminAccount: currentAdmin.username,
              adminId: currentAdmin.id,
              timestamp: new Date().toISOString()
            }
          });
        }
      }, 1000); // 1 second debounce
    }
  };

  const handleToggleCategoryFilter = async (category: string) => {
    const normalized = normalizeCategoryLabel(category);
    if (!normalized) return;

    const existed = selectedCategoryFilters.some(
      (entry) => normalizeCategoryKey(entry) === normalizeCategoryKey(normalized)
    );

    const nextSelected = existed
      ? selectedCategoryFilters.filter(
          (entry) => normalizeCategoryKey(entry) !== normalizeCategoryKey(normalized)
        )
      : [...selectedCategoryFilters, normalized];

    setSelectedCategoryFilters(nextSelected);

    if (currentAdmin) {
      const filteredCount = products.filter((product) =>
        nextSelected.length === 0 ||
        nextSelected.some((selected) => productMatchesCategory(product, selected))
      ).length;

      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'update',
        entity_type: 'category_filter',
        details: `Admin ${currentAdmin.username} updated side category filters (${nextSelected.length || 'All'} selected, ${filteredCount} products)`,
        page: 'UpdateProducts',
        metadata: {
          oldCategories: selectedCategoryFilters,
          newCategories: nextSelected,
          toggledCategory: normalized,
          isSelected: !existed,
          resultsCount: filteredCount,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const handleClearCategoryFilters = async () => {
    const oldCategories = [...selectedCategoryFilters];
    setSelectedCategoryFilters([]);

    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'update',
        entity_type: 'category_filter',
        details: `Admin ${currentAdmin.username} cleared side category filters`,
        page: 'UpdateProducts',
        metadata: {
          oldCategories,
          newCategories: [],
          resultsCount: products.length,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const handleAddCategoryOption = async () => {
    const normalized = normalizeCategoryLabel(newCategoryOption);
    if (!normalized) return;

    const exists = categoryOptions.some(
      (option) => normalizeCategoryKey(option) === normalizeCategoryKey(normalized)
    );
    if (exists) {
      setNewCategoryOption("");
      return;
    }

    const nextCategories = mergeCategoryOptions([...categoryOptions, normalized]);

    try {
      await persistCategoryOptions(nextCategories);
      setNewCategoryOption("");

      if (currentAdmin) {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "create",
          entity_type: "product_category",
          details: `Admin ${currentAdmin.username} added product category "${normalized}"`,
          page: "UpdateProducts",
          metadata: {
            category: normalized,
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add category";
      showToast({ type: "error", title: "Category Save Failed", message });
    }
  };

  const handleRemoveCategoryOption = async (categoryToRemove: string) => {
    const normalizedToRemove = normalizeCategoryLabel(categoryToRemove);
    if (!normalizedToRemove) return;

    const hasProductsUsingCategory = products.some((product) =>
      productMatchesCategory(product, normalizedToRemove)
    );

    const nextCategories = categoryOptions.filter(
      (option) => normalizeCategoryKey(option) !== normalizeCategoryKey(normalizedToRemove)
    );

    try {
      await persistCategoryOptions(nextCategories);

      setSelectedCategoryFilters((prev) =>
        prev.filter((option) => normalizeCategoryKey(option) !== normalizeCategoryKey(normalizedToRemove))
      );

      if (currentAdmin) {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "delete",
          entity_type: "product_category",
          details: `Admin ${currentAdmin.username} removed product category option "${normalizedToRemove}"`,
          page: "UpdateProducts",
          metadata: {
            category: normalizedToRemove,
            hadAssignedProducts: hasProductsUsingCategory,
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to remove category";
      showToast({ type: "error", title: "Category Save Failed", message });
    }
  };

  // Filter products
  const filteredProducts = products.filter(product => {
    const matchesName = (product.name || "").toLowerCase().includes((filter || "").toLowerCase());
    const matchesCategory =
      selectedCategoryFilters.length === 0 ||
      selectedCategoryFilters.some((selected) => productMatchesCategory(product, selected));
    return matchesName && matchesCategory;
  });

  const categories = mergeCategoryOptions([
    ...categoryOptions,
    ...products.flatMap((product) => parseCategorySelection(product.category)),
  ]);

  return (
    <div className="space-y-6">
      <ToastPopup state={toast} onClose={() => setToast((prev) => ({ ...prev, open: false }))} />
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Update Products</h1>
        <button
          onClick={async () => {
            // Log navigation to add products
            if (currentAdmin) {
              await logActivity({
                admin_id: currentAdmin.id,
                admin_name: currentAdmin.username,
                action: 'view',
                entity_type: 'navigation',
                details: `Admin ${currentAdmin.username} navigated to Add New Product page from Update Products`,
                page: 'UpdateProducts',
                metadata: {
                  destination: 'Add Products',
                  adminAccount: currentAdmin.username,
                  adminId: currentAdmin.id,
                  timestamp: new Date().toISOString()
                }
              });
            }
            router.push("/dashboard/products");
          }}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
        >
          Add New Product
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 xl:grid-cols-[250px_1fr] gap-4">
        <aside className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 h-fit xl:sticky xl:top-24 self-start">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Side Category Filters</h2>
            <button
              type="button"
              onClick={() => setShowCategoryManagerPopup(true)}
              className="px-2 py-1 rounded text-xs font-medium border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100"
            >
              Manage
            </button>
          </div>

          <p className="mb-3 text-xs text-gray-500">
            Select multiple categories to narrow products.
          </p>

          <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
            {categories.map((category) => {
              const checked = selectedCategoryFilters.some(
                (entry) => normalizeCategoryKey(entry) === normalizeCategoryKey(category)
              );

              return (
                <label
                  key={`side-${category}`}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${
                    checked
                      ? "bg-indigo-50 border-indigo-200 text-indigo-700"
                      : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => void handleToggleCategoryFilter(category)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="truncate">{category}</span>
                </label>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-gray-600">
            <span>{selectedCategoryFilters.length} selected</span>
            <button
              type="button"
              onClick={() => void handleClearCategoryFilters()}
              disabled={selectedCategoryFilters.length === 0}
              className="text-indigo-700 hover:text-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Clear
            </button>
          </div>
        </aside>

        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-64">
              <input
                type="text"
                placeholder="Search products..."
                value={filter}
                onChange={(e) => handleFilterChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-black"
              />
            </div>
          </div>

          {(filter || selectedCategoryFilters.length > 0) && (
            <div className="text-sm text-gray-600">
              Showing {filteredProducts.length} of {products.length} products
            </div>
          )}
        </div>
      </div>

      {showCategoryManagerPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-xl bg-white shadow-2xl border border-gray-200">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h3 className="text-lg font-semibold text-gray-900">Manage Product Categories</h3>
              <button
                type="button"
                onClick={() => setShowCategoryManagerPopup(false)}
                className="text-gray-500 hover:text-gray-700"
                aria-label="Close category manager"
              >
                Close
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Add Category</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCategoryOption}
                    onChange={(e) => setNewCategoryOption(e.target.value)}
                    placeholder="Enter new category"
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddCategoryOption()}
                    disabled={savingCategories || !newCategoryOption.trim()}
                    className="rounded-lg px-3 py-2 text-sm font-medium border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {savingCategories ? "Saving..." : "Add"}
                  </button>
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-gray-700">Remove Category</div>
                <div className="max-h-64 overflow-auto space-y-2 pr-1">
                  {categories.length > 0 ? (
                    categories.map((category) => {
                      const hasProductsUsingCategory = products.some((product) =>
                        productMatchesCategory(product, category)
                      );

                      return (
                        <div
                          key={`popup-remove-${category}`}
                          className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2"
                        >
                          <div>
                            <div className="text-sm text-gray-800">{category}</div>
                            {hasProductsUsingCategory && (
                              <div className="text-xs text-amber-700">Used by one or more products</div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleRemoveCategoryOption(category)}
                            disabled={savingCategories}
                            className="rounded px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                          >
                            Remove
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-sm text-gray-500">No category options available.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Products Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {loading ? (
          Array(8).fill(0).map((_, i) => (
            <div key={i} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 animate-pulse">
              <div className="h-32 bg-gray-200 rounded mb-4"></div>
              <div className="h-4 bg-gray-200 rounded mb-2"></div>
              <div className="h-8 bg-gray-200 rounded"></div>
            </div>
          ))
        ) : (
          filteredProducts.map((product) => (
            <div key={product.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
              {/* Product Image */}
              <div className="h-48 bg-gray-200 relative">
                {product.image1 || (product as any).images?.[0] ? (
                  <img
                    src={product.image1 || (product as any).images?.[0]}
                    alt={product.name}
                    className="w-full h-full object-cover"
                    onError={() => {
                      // Log broken image
                      if (currentAdmin) {
                        logActivity({
                          admin_id: currentAdmin.id,
                          admin_name: currentAdmin.username,
                          action: 'view',
                          entity_type: 'image_error',
                          entity_id: product.id,
                          details: `Broken image detected for product "${product.name}"`,
                          page: 'UpdateProducts',
                          metadata: {
                            productName: product.name,
                            productId: product.id,
                            imageUrl: product.image1 || (product as any).images?.[0],
                            adminAccount: currentAdmin.username
                          }
                        });
                      }
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400">
                    No Image
                  </div>
                )}
              </div>

              {/* Product Info */}
              <div className="p-4 space-y-3">
                <div>
                  <h3 className="font-semibold text-gray-900 truncate" title={product.name}>
                    {product.name}
                  </h3>
                  <div className="flex justify-between text-sm text-gray-600 mt-1">
                    <span>{product.category}</span>
                    <span>{product.type}</span>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-lg font-semibold text-green-600">
                    ₱{product.price?.toLocaleString()}
                  </span>
                  {product.inventory !== undefined && (
                    <span className={`text-sm px-2 py-1 rounded-full ${
                      product.inventory === 0
                        ? 'bg-red-100 text-red-800'
                        : product.inventory <= 5
                        ? 'bg-orange-100 text-orange-800'
                        : 'bg-green-100 text-green-800'
                    }`}>
                      {product.inventory} in stock
                    </span>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleEdit(product.id, product.name)}
                    className="flex-1 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(product.id, product.name)}
                    disabled={deleteLoading === product.id}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      deleteLoading === product.id
                        ? 'bg-gray-400 text-white cursor-not-allowed'
                        : 'bg-red-600 text-white hover:bg-red-700'
                    }`}
                  >
                    {deleteLoading === product.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {filteredProducts.length === 0 && !loading && (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">📦</div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No products found</h3>
          <p className="text-gray-500 mb-4">
            {filter || selectedCategoryFilters.length > 0
              ? "No products match your current filters."
              : "No products available. Add your first product to get started!"
            }
          </p>
          <button
            onClick={async () => {
              // Log navigation from empty state
              if (currentAdmin) {
                await logActivity({
                  admin_id: currentAdmin.id,
                  admin_name: currentAdmin.username,
                  action: 'view',
                  entity_type: 'navigation',
                  details: `Admin ${currentAdmin.username} navigated to Add Product from empty products state`,
                  page: 'UpdateProducts',
                  metadata: {
                    context: 'empty_products_state',
                    hasFilters: !!(filter || selectedCategoryFilters.length > 0),
                    adminAccount: currentAdmin.username
                  }
                });
              }
              router.push("/dashboard/products");
            }}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors"
          >
            Add New Product
          </button>
        </div>
      )}
    </div>
  );
}