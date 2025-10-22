"use client";
import { useState, useEffect } from "react";
import { Plus, Trash2, Edit3, Save, Upload, Image as ImageIcon } from "lucide-react";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import { logActivity, autoLogActivity } from "@/app/lib/activity";

type Product = {
  id?: string;
  image: string;
  name: string;
  description?: string;
};

type ProductCategory = {
  id?: string;
  name: string;
  products: Product[];
};

const initialData: ProductCategory[] = [
  {
    id: "doors",
    name: "Doors",
    products: [
      {
        id: "door-1",
        image: "https://your-image-url.com/door1.jpg",
        name: "GE 105",
        description: "Premium aluminum door with modern design",
      },
      {
        id: "door-2",
        image: "https://your-image-url.com/door2.jpg",
        name: "GE 157",
        description: "Heavy-duty commercial door solution",
      },
    ],
  },
  {
    id: "windows",
    name: "Windows",
    products: [
      {
        id: "window-1",
        image: "https://your-image-url.com/window1.jpg",
        name: "GE 110",
        description: "Energy-efficient sliding window",
      },
    ],
  },
  {
    id: "enclosure",
    name: "Enclosure",
    products: [
      {
        id: "enclosure-1",
        image: "https://your-image-url.com/enclosure1.jpg",
        name: "Shower Enclosure",
        description: "Tempered glass shower enclosure",
      },
    ],
  },
];

export default function AdminProductsPage() {
  const [categories, setCategories] = useState<ProductCategory[]>(initialData);
  const [originalCategories, setOriginalCategories] = useState<ProductCategory[]>([]);
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<{catIdx: number, prodIdx: number} | null>(null);

  useEffect(() => {
    // Load current admin and log page access
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
            details: `Admin ${admin.username} accessed Products management page`,
            page: 'Products',
            metadata: {
              pageAccess: true,
              adminAccount: admin.username,
              adminId: admin.id,
              timestamp: new Date().toISOString(),
              userAgent: navigator.userAgent
            }
          });
        }
      } catch (error) {
        console.error("Error loading admin:", error);
      }
    };

    loadAdmin();
    setOriginalCategories(JSON.parse(JSON.stringify(initialData)));
  }, []);

  useEffect(() => {
    if (currentAdmin && categories.length > 0) {
      logProductsLoad();
    }
  }, [currentAdmin]);

  // ADD: page view activity
  useEffect(() => {
    if (currentAdmin) {
      autoLogActivity('view', 'page', `Accessed Products page`, {
        page: 'Products',
        metadata: { section: 'Products', timestamp: new Date().toISOString() }
      });
    }
  }, [currentAdmin]);

  const logProductsLoad = async () => {
    if (!currentAdmin) return;

    const totalProducts = categories.reduce((sum, cat) => sum + cat.products.length, 0);
    
    await logActivity({
      admin_id: currentAdmin.id,
      admin_name: currentAdmin.username,
      action: 'view',
      entity_type: 'products_catalog',
      details: `Admin ${currentAdmin.username} loaded ${categories.length} product categories with ${totalProducts} total products`,
      page: 'Products',
      metadata: {
        categoriesCount: categories.length,
        totalProducts: totalProducts,
        categories: categories.map(cat => ({
          name: cat.name,
          productsCount: cat.products.length
        })),
        adminAccount: currentAdmin.username,
        adminId: currentAdmin.id,
        timestamp: new Date().toISOString()
      }
    });
  };

  // Category name change with activity logging
  const handleCategoryNameChange = async (idx: number, value: string) => {
    const oldName = categories[idx].name;
    
    setCategories((prev) =>
      prev.map((cat, i) => (i === idx ? { ...cat, name: value } : cat))
    );

    // Log category name change
    if (currentAdmin && oldName !== value) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'update',
        entity_type: 'product_category',
        entity_id: categories[idx].id || `category-${idx}`,
        details: `Admin ${currentAdmin.username} changed category name from "${oldName}" to "${value}"`,
        page: 'Products',
        metadata: {
          categoryIndex: idx,
          oldName: oldName,
          newName: value,
          categoryId: categories[idx].id,
          productsInCategory: categories[idx].products.length,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  // Product field change with activity logging
  const handleProductChange = async (
    catIdx: number,
    prodIdx: number,
    field: keyof Product,
    value: string
  ) => {
    const oldValue = categories[catIdx].products[prodIdx][field];
    const categoryName = categories[catIdx].name;
    const productName = categories[catIdx].products[prodIdx].name;

    setCategories((prev) =>
      prev.map((cat, i) =>
        i === catIdx
          ? {
              ...cat,
              products: cat.products.map((prod, j) =>
                j === prodIdx ? { ...prod, [field]: value } : prod
              ),
            }
          : cat
      )
    );

    // Log product field change
    if (currentAdmin && oldValue !== value) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'update',
        entity_type: `product_${field}`,
        entity_id: categories[catIdx].products[prodIdx].id || `product-${catIdx}-${prodIdx}`,
        details: `Admin ${currentAdmin.username} updated product "${productName}" ${field} in category "${categoryName}": "${oldValue || ''}" → "${value || ''}"`,
        page: 'Products',
        metadata: {
          categoryIndex: catIdx,
          productIndex: prodIdx,
          categoryName: categoryName,
          productName: productName,
          fieldName: field,
          oldValue: oldValue,
          newValue: value,
          productId: categories[catIdx].products[prodIdx].id,
          categoryId: categories[catIdx].id,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  // Add product with activity logging
  const handleAddProduct = async (catIdx: number) => {
    const categoryName = categories[catIdx].name;
    const newProductId = `product-${Date.now()}`;
    
    setCategories((prev) =>
      prev.map((cat, i) =>
        i === catIdx
          ? {
              ...cat,
              products: [
                ...cat.products,
                { id: newProductId, image: "", name: "New Product", description: "" },
              ],
            }
          : cat
      )
    );

    // Log product addition
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'create',
        entity_type: 'product',
        entity_id: newProductId,
        details: `Admin ${currentAdmin.username} added new product to category "${categoryName}"`,
        page: 'Products',
        metadata: {
          categoryIndex: catIdx,
          categoryName: categoryName,
          productId: newProductId,
          newProductIndex: categories[catIdx].products.length,
          categoryId: categories[catIdx].id,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  // Remove product with activity logging
  const handleRemoveProduct = async (catIdx: number, prodIdx: number) => {
    const categoryName = categories[catIdx].name;
    const productToDelete = categories[catIdx].products[prodIdx];
    
    if (!confirm(`Are you sure you want to remove "${productToDelete.name}" from ${categoryName}?`)) {
      // Log deletion cancelled
      if (currentAdmin) {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'view',
          entity_type: 'product_delete_cancelled',
          entity_id: productToDelete.id || `product-${catIdx}-${prodIdx}`,
          details: `Admin ${currentAdmin.username} cancelled deletion of product "${productToDelete.name}" from category "${categoryName}"`,
          page: 'Products',
          metadata: {
            categoryName: categoryName,
            productName: productToDelete.name,
            action: 'delete_cancelled',
            adminAccount: currentAdmin.username,
            timestamp: new Date().toISOString()
          }
        });
      }
      return;
    }

    setCategories((prev) =>
      prev.map((cat, i) =>
        i === catIdx
          ? {
              ...cat,
              products: cat.products.filter((_, j) => j !== prodIdx),
            }
          : cat
      )
    );

    // Log product removal
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'delete',
        entity_type: 'product',
        entity_id: productToDelete.id || `product-${catIdx}-${prodIdx}`,
        details: `Admin ${currentAdmin.username} removed product "${productToDelete.name}" from category "${categoryName}"`,
        page: 'Products',
        metadata: {
          categoryIndex: catIdx,
          productIndex: prodIdx,
          categoryName: categoryName,
          deletedProduct: {
            name: productToDelete.name,
            description: productToDelete.description,
            image: productToDelete.image
          },
          remainingProductsInCategory: categories[catIdx].products.length - 1,
          categoryId: categories[catIdx].id,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  // Add category with activity logging
  const handleAddCategory = async () => {
    const newCategoryId = `category-${Date.now()}`;
    const newCategoryName = `New Category ${categories.length + 1}`;
    
    setCategories((prev) => [
      ...prev,
      { id: newCategoryId, name: newCategoryName, products: [] },
    ]);

    // Log category addition
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'create',
        entity_type: 'product_category',
        entity_id: newCategoryId,
        details: `Admin ${currentAdmin.username} added new product category "${newCategoryName}"`,
        page: 'Products',
        metadata: {
          categoryId: newCategoryId,
          categoryName: newCategoryName,
          categoryIndex: categories.length,
          totalCategoriesAfter: categories.length + 1,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  // Remove category with activity logging
  const handleRemoveCategory = async (catIdx: number) => {
    const categoryToDelete = categories[catIdx];
    
    if (!confirm(`Are you sure you want to remove the entire "${categoryToDelete.name}" category? This will delete ${categoryToDelete.products.length} products.`)) {
      // Log deletion cancelled
      if (currentAdmin) {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'view',
          entity_type: 'product_category_delete_cancelled',
          entity_id: categoryToDelete.id || `category-${catIdx}`,
          details: `Admin ${currentAdmin.username} cancelled deletion of category "${categoryToDelete.name}" with ${categoryToDelete.products.length} products`,
          page: 'Products',
          metadata: {
            categoryName: categoryToDelete.name,
            productsCount: categoryToDelete.products.length,
            action: 'delete_cancelled',
            adminAccount: currentAdmin.username,
            timestamp: new Date().toISOString()
          }
        });
      }
      return;
    }

    setCategories((prev) => prev.filter((_, i) => i !== catIdx));

    // Log category removal
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'delete',
        entity_type: 'product_category',
        entity_id: categoryToDelete.id || `category-${catIdx}`,
        details: `Admin ${currentAdmin.username} removed category "${categoryToDelete.name}" with ${categoryToDelete.products.length} products`,
        page: 'Products',
        metadata: {
          categoryIndex: catIdx,
          deletedCategory: {
            name: categoryToDelete.name,
            productsCount: categoryToDelete.products.length,
            products: categoryToDelete.products.map(p => ({ name: p.name, description: p.description }))
          },
          remainingCategoriesCount: categories.length - 1,
          categoryId: categoryToDelete.id,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  // Image upload handler
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, catIdx: number, prodIdx: number) => {
    const file = e.target.files?.[0];
    if (!file || !currentAdmin) return;
    
    setUploading(true);
    
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `products/${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
      
      const { data, error } = await supabase.storage
        .from("product-images")
        .upload(fileName, file);

      if (error) {
        alert("Image upload failed.");
        setUploading(false);
        return;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from("product-images")
        .getPublicUrl(data.path);

      const url = urlData?.publicUrl || "";
      
      // Update product image
      await handleProductChange(catIdx, prodIdx, 'image', url);

      // Log image upload
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: "upload",
        entity_type: "product_image",
        entity_id: categories[catIdx].products[prodIdx].id || `product-${catIdx}-${prodIdx}`,
        details: `Admin ${currentAdmin.username} uploaded image for product "${categories[catIdx].products[prodIdx].name}" in category "${categories[catIdx].name}": ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`,
        page: "Products",
        metadata: {
          categoryName: categories[catIdx].name,
          productName: categories[catIdx].products[prodIdx].name,
          fileName: file.name,
          fileSize: file.size,
          fileSizeMB: (file.size / 1024 / 1024).toFixed(2),
          fileType: file.type,
          uploadPath: data.path,
          imageUrl: url,
          categoryIndex: catIdx,
          productIndex: prodIdx,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
      
      setUploading(false);
    } catch (err: any) {
      console.error("upload threw", err);
      alert("Error uploading file: " + (err?.message || String(err)));
      setUploading(false);
    }
  };

  // Save handler with comprehensive logging
  const handleSave = async () => {
    if (!currentAdmin) return;
    
    setSaving(true);
    setError(null);
    
    try {
      // Calculate comprehensive changes
      const changes = {
        categoriesAdded: categories.length - originalCategories.length,
        categoriesRemoved: Math.max(0, originalCategories.length - categories.length),
        categoriesModified: 0,
        productsAdded: 0,
        productsRemoved: 0,
        productsModified: 0
      };

      // Count changes (simplified version)
      categories.forEach((cat, catIdx) => {
        const originalCat = originalCategories[catIdx];
        if (originalCat) {
          if (cat.name !== originalCat.name) changes.categoriesModified++;
          
          changes.productsAdded += Math.max(0, cat.products.length - originalCat.products.length);
          changes.productsRemoved += Math.max(0, originalCat.products.length - cat.products.length);
        }
      });

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Log comprehensive save action
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: "update",
        entity_type: "products_catalog",
        details: `Admin ${currentAdmin.username} saved products catalog with ${changes.categoriesAdded} categories added, ${changes.categoriesRemoved} removed, ${changes.productsAdded} products added, ${changes.productsRemoved} removed`,
        page: "Products",
        metadata: {
          totalCategories: categories.length,
          totalProducts: categories.reduce((sum, cat) => sum + cat.products.length, 0),
          changes: changes,
          categoriesDetails: categories.map(cat => ({
            name: cat.name,
            productsCount: cat.products.length
          })),
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });

      setOriginalCategories(JSON.parse(JSON.stringify(categories)));
      alert("Products saved successfully!");
      
    } catch (e: any) {
      setError("Failed to save products");
      
      // Log save error
      if (currentAdmin) {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "update",
          entity_type: "products_catalog_error",
          details: `Admin ${currentAdmin.username} failed to save products catalog: ${e.message}`,
          page: "Products",
          metadata: {
            error: e.message,
            adminAccount: currentAdmin.username,
            timestamp: new Date().toISOString()
          }
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Products Management</h1>
              <p className="text-gray-600 mt-1">Manage your product catalog and categories</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-600">
                Editing as: {currentAdmin?.username || 'Unknown Admin'}
              </div>
              <button
                onClick={handleAddCategory}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg shadow-sm transition-colors"
              >
                <Plus size={20} />
                Add Category
              </button>
            </div>
          </div>
        </div>

        {/* Categories */}
        <div className="space-y-8">
          {categories.map((cat, catIdx) => (
            <div key={catIdx} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              {/* Category Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4 flex-1">
                  <input
                    type="text"
                    value={cat.name}
                    onChange={(e) => handleCategoryNameChange(catIdx, e.target.value)}
                    className="text-2xl font-bold text-gray-900 bg-transparent border-b-2 border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none transition-colors px-2 py-1"
                  />
                  <span className="bg-blue-100 text-blue-800 text-sm font-medium px-3 py-1 rounded-full">
                    {cat.products.length} products
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleAddProduct(catIdx)}
                    className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Plus size={16} />
                    Add Product
                  </button>
                  <button
                    className="flex items-center gap-2 text-red-600 hover:text-red-800 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors"
                    onClick={() => handleRemoveCategory(catIdx)}
                    disabled={categories.length === 1}
                    title="Remove Category"
                  >
                    <Trash2 size={16} />
                    Remove
                  </button>
                </div>
              </div>

              {/* Products Grid */}
              {cat.products.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {cat.products.map((prod, prodIdx) => (
                    <div key={prodIdx} className="bg-gray-50 rounded-lg p-4 border border-gray-200 hover:border-gray-300 transition-colors">
                      {/* Product Image */}
                      <div className="relative mb-4">
                        <div className="h-48 bg-gray-100 rounded-lg overflow-hidden border-2 border-dashed border-gray-300">
                          {prod.image ? (
                            <img
                              src={prod.image}
                              alt={prod.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400">
                              <ImageIcon size={48} />
                            </div>
                          )}
                        </div>
                        <div className="absolute top-2 right-2">
                          <label className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-lg cursor-pointer shadow-sm transition-colors">
                            <Upload size={16} />
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleImageUpload(e, catIdx, prodIdx)}
                              disabled={uploading}
                              className="hidden"
                            />
                          </label>
                        </div>
                      </div>

                      {/* Product Details */}
                      <div className="space-y-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                          <input
                            type="text"
                            value={prod.name}
                            onChange={(e) => handleProductChange(catIdx, prodIdx, "name", e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                            placeholder="Enter product name"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Image URL</label>
                          <input
                            type="text"
                            value={prod.image}
                            onChange={(e) => handleProductChange(catIdx, prodIdx, "image", e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 text-sm"
                            placeholder="Enter image URL or upload above"
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                          <textarea
                            value={prod.description || ""}
                            onChange={(e) => handleProductChange(catIdx, prodIdx, "description", e.target.value)}
                            rows={3}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                            placeholder="Enter product description"
                          />
                        </div>

                        <button
                          className="w-full flex items-center justify-center gap-2 text-red-600 hover:text-red-800 hover:bg-red-50 py-2 rounded-lg transition-colors text-sm font-medium border border-red-200"
                          onClick={() => handleRemoveProduct(catIdx, prodIdx)}
                        >
                          <Trash2 size={16} />
                          Remove Product
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg">
                  <div className="text-4xl mb-4">📦</div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No products yet</h3>
                  <p className="text-gray-500 mb-4">Add your first product to this category</p>
                  <button
                    onClick={() => handleAddProduct(catIdx)}
                    className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg shadow-sm transition-colors"
                  >
                    <Plus size={20} />
                    Add First Product
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {categories.length === 0 && (
          <div className="text-center py-16 bg-white rounded-xl border-2 border-dashed border-gray-300">
            <div className="text-6xl mb-4">🏪</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No product categories yet</h3>
            <p className="text-gray-500 mb-6">Create your first product category to get started!</p>
            <button
              onClick={handleAddCategory}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg shadow-sm transition-colors"
            >
              <Plus size={20} />
              Add Your First Category
            </button>
          </div>
        )}

        {/* Save Button */}
        <div className="mt-8 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Save Changes</h3>
              <p className="text-gray-600 text-sm">Save all your product and category changes</p>
            </div>
            <button
              onClick={handleSave}
              disabled={saving || uploading}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white px-8 py-3 rounded-lg font-semibold shadow-sm transition-colors disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  Saving...
                </>
              ) : (
                <>
                  <Save size={20} />
                  Save All Changes
                </>
              )}
            </button>
          </div>
          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}