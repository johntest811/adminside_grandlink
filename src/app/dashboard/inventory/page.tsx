"use client";
// Add this import
import { adminNotificationService } from "@/utils/notificationHelper";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import { createNotification, checkLowStockAlerts } from "@/app/lib/notifications";
import { logActivity } from "@/app/lib/activity";

type ProductInventory = {
  id: string;
  name: string;
  price?: number;
  inventory?: number | null;
  image1?: string;
  type?: string;
  category?: string;
  description?: string;
};

export default function InventoryAdminPage() {
  const [items, setItems] = useState<ProductInventory[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showOnlyLow, setShowOnlyLow] = useState(true);

  const CATEGORIES = ["Doors", "Windows", "Enclosures", "Sliding", "Canopy", "Railings", "Casement"];
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);

  const [originalInventories, setOriginalInventories] = useState<Record<string, number>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);

  // Load current admin and log page access
  useEffect(() => {
    const loadAdmin = async () => {
      try {
        const sessionData = localStorage.getItem('adminSession');
        if (sessionData) {
          const admin = JSON.parse(sessionData);
          setCurrentAdmin(admin);
          
          // Log page access
          await logActivity({
            admin_id: admin.id,
            admin_name: admin.username,
            action: 'view',
            entity_type: 'page',
            details: `Accessed Inventory Management page`,
            page: 'inventory',
            metadata: {
              pageAccess: true,
              adminAccount: admin.username,
              timestamp: new Date().toISOString()
            }
          });
        }
      } catch (error) {
        console.error("Error loading admin:", error);
      }
    };

    loadAdmin();
  }, []);

  const fetchItems = async (lowOnly: boolean = showOnlyLow) => {
    setLoading(true);
    try {
      let query = supabase
        .from("products")
        .select("id, name, price, inventory, image1, type, category")
        .order("created_at", { ascending: false });

      if (lowOnly) {
        query = query.or("inventory.is.null,inventory.lte.5");
      }

      const { data, error } = await query;
      if (error) {
        console.error("fetch inventory error", error);
        setItems([]);
        setOriginalInventories({});
      } else {
        const list = (data || []) as ProductInventory[];
        setItems(list);
        const map: Record<string, number> = {};
        list.forEach((p) => (map[p.id] = p.inventory ?? 0));
        setOriginalInventories(map);
        
        // Log inventory data fetch
        if (currentAdmin) {
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: 'view',
            entity_type: 'inventory_data',
            details: `Loaded inventory data for ${list.length} products (${lowOnly ? 'low stock only' : 'all products'})`,
            page: 'inventory',
            metadata: {
              productsLoaded: list.length,
              lowStockOnly: lowOnly,
              lowStockItems: list.filter(p => (p.inventory ?? 0) <= 5).length,
              outOfStockItems: list.filter(p => (p.inventory ?? 0) === 0).length,
              adminAccount: currentAdmin.username
            }
          });
        }
      }
    } catch (e) {
      console.error("fetchItems exception", e);
      setItems([]);
      setOriginalInventories({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (currentAdmin) {
      fetchItems(showOnlyLow);
    }
  }, [currentAdmin]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Log filter changes
  const handleFilterChange = async (newFilter: string) => {
    const oldFilter = filter;
    setFilter(newFilter);
    
    if (currentAdmin && oldFilter !== newFilter && newFilter.length > 0) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'update',
        entity_type: 'search_filter',
        details: `Applied search filter: "${newFilter}"`,
        page: 'inventory',
        metadata: {
          searchTerm: newFilter,
          previousTerm: oldFilter,
          adminAccount: currentAdmin.username
        }
      });
    }
  };

  const handleCategoryFilterChange = async (newCategory: string | null) => {
    const oldCategory = selectedCategory;
    setSelectedCategory(newCategory);
    setFilterOpen(false);
    
    if (currentAdmin && oldCategory !== newCategory) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'update',
        entity_type: 'category_filter',
        details: `Changed category filter from "${oldCategory || 'All Categories'}" to "${newCategory || 'All Categories'}"`,
        page: 'inventory',
        metadata: {
          oldCategory: oldCategory || 'All Categories',
          newCategory: newCategory || 'All Categories',
          adminAccount: currentAdmin.username
        }
      });
    }
  };

  const handleLowStockToggle = async (newValue: boolean) => {
    const oldValue = showOnlyLow;
    setShowOnlyLow(newValue);
    
    if (currentAdmin && oldValue !== newValue) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'update',
        entity_type: 'view_filter',
        details: `${newValue ? 'Enabled' : 'Disabled'} low stock only filter`,
        page: 'inventory',
        metadata: {
          lowStockOnly: newValue,
          previousValue: oldValue,
          adminAccount: currentAdmin.username
        }
      });
    }
    
    fetchItems(newValue);
  };

  const updateInventory = async (id: string, value: number) => {
    setSavingId(id);
    const productBefore = items.find(p => p.id === id);
    const oldInventory = productBefore?.inventory ?? 0;
    
    const { error } = await supabase.from("products").update({ inventory: value }).eq("id", id);
    
    if (error) {
      console.error("update inventory error", error);
      
      // Log error
      if (currentAdmin) {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'update',
          entity_type: 'inventory_error',
          entity_id: id,
          details: `Failed to update inventory for "${productBefore?.name || id}": ${error.message}`,
          page: 'inventory',
          metadata: {
            productName: productBefore?.name || id,
            productId: id,
            oldInventory,
            newInventory: value,
            inventoryChange: value - oldInventory,
            changeType: value - oldInventory > 0 ? "increased" : value - oldInventory < 0 ? "decreased" : "updated",
            adminAccount: currentAdmin.username,
            timestamp: new Date().toISOString()
          }
        });
      }
    } else {
      setItems((prev) => prev.map((p) => (p.id === id ? { ...p, inventory: value } : p)));
      setOriginalInventories((prev) => ({ ...prev, [id]: value }));

      // Enhanced activity logging
      if (currentAdmin) {
        const inventoryChange = value - oldInventory;
        const changeType = inventoryChange > 0 ? "increased" : inventoryChange < 0 ? "decreased" : "updated";
        
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "update",
          entity_type: "inventory",
          entity_id: id,
          details: `${changeType.charAt(0).toUpperCase() + changeType.slice(1)} inventory for "${productBefore?.name || id}" from ${oldInventory} to ${value} (${inventoryChange > 0 ? '+' : ''}${inventoryChange})`,
          page: "inventory",
          metadata: {
            productName: productBefore?.name || id,
            productId: id,
            oldInventory,
            newInventory: value,
            inventoryChange,
            changeType,
            adminAccount: currentAdmin.username,
            category: productBefore?.category,
            price: productBefore?.price
          }
        });
      }

      // Create notifications for stock levels
      if (value <= 0) {
        await createNotification({
          title: "Out of Stock Alert",
          message: `Product "${productBefore?.name || id}" is out of stock! - Updated by ${currentAdmin?.username || 'Admin'}`,
          recipient_role: "Admin",
          type: "stock",
          priority: "high",
        });
      } else if (value <= 2) {
        await createNotification({
          title: "Critical Stock Alert",
          message: `Product "${productBefore?.name || id}" is critically low (${value} remaining) - Updated by ${currentAdmin?.username || 'Admin'}`,
          recipient_role: "Admin",
          type: "stock",
          priority: "high",
        });
      } else if (value <= 5) {
        await createNotification({
          title: "Low Stock Alert", 
          message: `Product "${productBefore?.name || id}" is running low (${value} remaining) - Updated by ${currentAdmin?.username || 'Admin'}`,
          recipient_role: "Admin",
          type: "stock",
          priority: "medium",
        });
      }

      // NEW: Notify website users when inventory increased (restock)
      try {
        const inventoryChange = value - oldInventory;
        const adminName = currentAdmin?.username || "Admin";
        const productName = productBefore?.name || id;

        // Notify when stock increased OR changed (you can switch to inventoryChange > 0 if you only want restock)
        if (inventoryChange !== 0) {
          await adminNotificationService.notifyStockUpdate(productName, id, value, adminName);
          console.log(`📣 Sent stock update notification for "${productName}" (new stock: ${value})`);
        }
      } catch (notifyErr) {
        console.warn("Stock-update notify failed:", notifyErr);
      }
    }
    setSavingId(null);
  };

  const saveAll = async () => {
    const changed = items.filter((it) => (originalInventories[it.id] ?? 0) !== (it.inventory ?? 0));
    if (changed.length === 0) {
      alert("No inventory changes to save.");
      return;
    }
    
    setSavingAll(true);
    try {
      const results = await Promise.all(
        changed.map((it) =>
          supabase.from("products").update({ inventory: it.inventory ?? 0 }).eq("id", it.id)
        )
      );
      
      const errors = results.map((r) => (r as any).error).filter(Boolean);
      if (errors.length) {
        console.error("saveAll errors", errors);
        alert("Some updates failed. Check console.");
      } else {
        const summary = changed.map(c => `${c.name || c.id}: ${originalInventories[c.id] ?? 0} → ${c.inventory ?? 0}`).join("; ");
        const totalItems = changed.length;
        
        // Log bulk activity
        if (currentAdmin) {
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: "update",
            entity_type: "inventory",
            details: `Bulk updated inventory for ${totalItems} products: ${summary}`,
            page: "inventory",
            metadata: {
              bulkUpdate: true,
              totalItems,
              changes: changed.map(c => ({
                id: c.id,
                name: c.name,
                oldInventory: originalInventories[c.id] ?? 0,
                newInventory: c.inventory ?? 0
              })),
              adminAccount: currentAdmin.username
            }
          });
        }

        // NEW: Send notifications for any product whose inventory increased or changed
        try {
          const adminName = currentAdmin?.username || "Admin";
          for (const c of changed) {
            const oldInv = originalInventories[c.id] ?? 0;
            const newInv = c.inventory ?? 0;
            if (newInv !== oldInv) {
              const productName = c.name || c.id;
              // fire-and-forget; do not block UI
              adminNotificationService
                .notifyStockUpdate(productName, c.id, newInv, adminName)
                .catch((e) => console.warn("notifyStockUpdate error:", e));
            }
          }
        } catch (e) {
          console.warn("bulk notify error:", e);
        }

        // Update original inventories
        const newOriginals = { ...originalInventories };
        changed.forEach(c => {
          newOriginals[c.id] = c.inventory ?? 0;
        });
        setOriginalInventories(newOriginals);
        
        alert(`✅ Updated ${totalItems} products successfully!`);
        
        // Check for low stock alerts
        await checkLowStockAlerts();
      }
    } catch (e) {
      console.error("saveAll exception", e);
      alert("Failed to save changes. Check console.");
    } finally {
      setSavingAll(false);
    }
  };

  // Run periodic stock check
  useEffect(() => {
    const interval = setInterval(() => {
      checkLowStockAlerts();
    }, 300000); // Check every 5 minutes

    return () => clearInterval(interval);
  }, []);

  const filtered = items.filter((it) => {
    const inv = it.inventory ?? 0;
    if (showOnlyLow && inv > 5) return false;
    if (selectedCategory && selectedCategory !== "All Categories") {
      if (it.category !== selectedCategory) return false;
    }
    if (!filter) return true;
    return it.name?.toLowerCase().includes(filter.toLowerCase());
  });

  const unsavedCount = items.reduce((acc, it) => acc + ((originalInventories[it.id] ?? 0) !== (it.inventory ?? 0) ? 1 : 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Inventory Management</h1>
        <div className="flex items-center space-x-4">
          {unsavedCount > 0 && (
            <button
              onClick={saveAll}
              disabled={savingAll}
              className={`px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors ${
                savingAll ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {savingAll ? 'Saving...' : `Save All Changes (${unsavedCount})`}
            </button>
          )}
        </div>
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
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className="px-4 py-2 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 focus:ring-2 focus:ring-indigo-500"
            >
              {selectedCategory || "All Categories"} ▼
            </button>
            
            {filterOpen && (
              <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                <button
                  onClick={() => {
                    handleCategoryFilterChange(null);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-100"
                >
                  All Categories
                </button>
                {CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    onClick={() => {
                      handleCategoryFilterChange(cat);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-100"
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center">
            <input
              type="checkbox"
              checked={showOnlyLow}
              onChange={(e) => {
                handleLowStockToggle(e.target.checked);
              }}
              className="mr-2"
            />
            Low Stock Only (≤5)
          </label>
        </div>
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
          filtered.map((item) => {
            const isUnsaved = (originalInventories[item.id] ?? 0) !== (item.inventory ?? 0);
            const inventory = item.inventory ?? 0;
            const isOutOfStock = inventory === 0;
            const isLowStock = inventory > 0 && inventory <= 5;
            
            return (
              <div 
                key={item.id} 
                className={`bg-white rounded-lg shadow-sm border-2 p-4 transition-all ${
                  isUnsaved 
                    ? 'border-yellow-400 bg-yellow-50' 
                    : isOutOfStock
                    ? 'border-red-400 bg-red-50'
                    : isLowStock
                    ? 'border-orange-400 bg-orange-50'
                    : 'border-gray-200'
                }`}
              >
                {/* Product Image */}
                <div className="relative mb-4">
                  {item.image1 ? (
                    <img
                      src={item.image1}
                      alt={item.name}
                      className="w-full h-32 object-cover rounded-lg"
                    />
                  ) : (
                    <div className="w-full h-32 bg-gray-200 rounded-lg flex items-center justify-center">
                      <span className="text-gray-400">No Image</span>
                    </div>
                  )}
                  
                  {/* Stock Status Badge */}
                  <div className="absolute top-2 right-2">
                    {isOutOfStock && (
                      <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full font-medium">
                        OUT OF STOCK
                      </span>
                    )}
                    {isLowStock && (
                      <span className="bg-orange-500 text-white text-xs px-2 py-1 rounded-full font-medium">
                        LOW STOCK
                      </span>
                    )}
                  </div>
                </div>

                {/* Product Info */}
                <div className="space-y-2">
                  <h3 className="font-medium text-gray-900 truncate">{item.name}</h3>
                  
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>{item.category}</span>
                    <span>{item.type}</span>
                  </div>
                  
                  {item.price && (
                    <p className="text-lg font-semibold text-green-600">
                      ₱{item.price.toLocaleString()}
                    </p>
                  )}

                  {/* Inventory Input */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Inventory Count
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        min="0"
                        value={item.inventory ?? 0}
                        onChange={(e) => {
                          const newValue = parseInt(e.target.value) || 0;
                          setItems(prev => 
                            prev.map(p => 
                              p.id === item.id ? { ...p, inventory: newValue } : p
                            )
                          );
                        }}
                        className={`flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${
                          isUnsaved ? 'border-yellow-400' : 'border-gray-300'
                        }`}
                      />
                      <button
                        onClick={() => updateInventory(item.id, item.inventory ?? 0)}
                        disabled={savingId === item.id || !isUnsaved}
                        className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isUnsaved
                            ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        {savingId === item.id ? '⏳' : '💾'}
                      </button>
                    </div>
                  </div>

                  {isUnsaved && (
                    <p className="text-xs text-yellow-700 bg-yellow-100 px-2 py-1 rounded">
                      Unsaved changes: {originalInventories[item.id] ?? 0} → {item.inventory ?? 0}
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {filtered.length === 0 && !loading && (
        <div className="text-center py-12">
          <div className="text-6xl mb-4">📦</div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No products found</h3>
          <p className="text-gray-500">
            {showOnlyLow 
              ? "No low stock items found. Great job keeping inventory levels up!"
              : "No products match your current filters."
            }
          </p>
        </div>
      )}
    </div>
  );
}
