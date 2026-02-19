"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import { logActivity } from "@/app/lib/activity";
import { notifyProductDeleted } from "@/app/lib/notifications";
import ToastPopup, { type ToastPopupState } from "@/components/ToastPopup";

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
  const [categoryFilter, setCategoryFilter] = useState("");
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

  // Fetch products with enhanced logging
  useEffect(() => {
    fetchProducts();
  }, [currentAdmin]);

  const fetchProducts = async () => {
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
  };

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

  const handleCategoryFilterChange = async (newCategory: string) => {
    const oldCategory = categoryFilter;
    setCategoryFilter(newCategory);
    
    if (currentAdmin) {
      const filteredCount = products.filter(product => 
        !newCategory || product.category === newCategory
      ).length;
      
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'update',
        entity_type: 'category_filter',
        details: `Admin ${currentAdmin.username} changed category filter from "${oldCategory || 'All Categories'}" to "${newCategory || 'All Categories'}" (${filteredCount} products)`,
        page: 'UpdateProducts',
        metadata: {
          oldCategory: oldCategory || 'All Categories',
          newCategory: newCategory || 'All Categories',
          resultsCount: filteredCount,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  // Filter products
  const filteredProducts = products.filter(product => {
    const normalize = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const keyFor = (s: string | null | undefined) => {
      const k = normalize(s);
      if (k.includes("curtain") && k.includes("wall")) return "curtainwall";
      if (k.includes("enclosure")) return "enclosure";
      return k;
    };

    const matchesName = (product.name || "").toLowerCase().includes((filter || "").toLowerCase());
    const matchesCategory = !categoryFilter || keyFor(product.category) === keyFor(categoryFilter);
    return matchesName && matchesCategory;
  });

  // Build categories list and ensure "Curtain Walls" option is available
  const existingCategories = (products.map(p => p.category).filter(Boolean) as string[]);
  const hasCurtainWalls = existingCategories.some(c => {
    const k = (c || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return k.includes("curtain") && k.includes("wall");
  });
  const categories = Array.from(new Set([...
    existingCategories,
    ...(hasCurtainWalls ? [] as string[] : ["Curtain Walls"]) 
  ]));

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
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-64">
            <input
              type="text"
              placeholder="Search products..."
              value={filter}
              onChange={(e) => handleFilterChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-black"
            />
          </div>
          
          <div>
            <select
              value={categoryFilter}
              onChange={(e) => handleCategoryFilterChange(e.target.value)}
              className="px-4 py-2 border border-gray-600 rounded-lg bg-white hover:bg-gray-50 focus:ring-2 focus:ring-indigo-500 text-black"
            >
              <option value="">All Categories</option>
              {categories.map(category => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
        </div>
        
        {/* Filter Results Info */}
        {(filter || categoryFilter) && (
          <div className="mt-2 text-sm text-gray-600">
            Showing {filteredProducts.length} of {products.length} products
          </div>
        )}
      </div>

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
                    onError={(e) => {
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
            {filter || categoryFilter
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
                    hasFilters: !!(filter || categoryFilter),
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