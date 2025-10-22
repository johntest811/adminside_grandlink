"use client";
import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import { logActivity } from "../../../lib/activity";
import { notifyProductUpdated, notifyProductFileUploaded } from "../../../lib/notifications";

type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  type?: string;
  image1?: string;
  image2?: string;
  image3?: string;
  image4?: string;
  image5?: string;
  material?: string;
  height?: number;
  width?: number;
  thickness?: number;
  fbx_url?: string;
  fbx_urls?: string[];
  fullproductname?: string;
  additionalfeatures?: string;
  inventory?: number;
};

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const productId = params?.id as string;
  const [product, setProduct] = useState<Product | null>(null);
  const [originalProduct, setOriginalProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState("");
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [show3DViewer, setShow3DViewer] = useState(false);
  const [currentFbxIndex, setCurrentFbxIndex] = useState(0);
  const [uploadingFbx, setUploadingFbx] = useState(false);

  useEffect(() => {
    // Load current admin
    const loadAdmin = async () => {
      try {
        const sessionData = localStorage.getItem('adminSession');
        if (sessionData) {
          const admin = JSON.parse(sessionData);
          setCurrentAdmin(admin);
        }
      } catch (e) {
        console.warn("load admin error", e);
      }
    };
    loadAdmin();
  }, []);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const res = await fetch(`/api/products/${productId}`);
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error("Failed to fetch product:", res.status, text);
          setLoading(false);
          return;
        }
        const result = await res.json().catch((e) => {
          console.error("Invalid JSON from /api/products/[id]:", e);
          return null;
        });
        if (result?.product) {
          setProduct(result.product);
          setOriginalProduct(JSON.parse(JSON.stringify(result.product)));
          
          // Log product load for editing
          if (currentAdmin) {
            await logActivity({
              admin_id: currentAdmin.id,
              admin_name: currentAdmin.username,
              action: 'view',
              entity_type: 'product_edit_form',
              entity_id: result.product.id,
              details: `Admin ${currentAdmin.username} loaded product "${result.product.name}" for editing`,
              page: 'UpdateProducts',
              metadata: {
                productName: result.product.name,
                productId: result.product.id,
                fbxFilesCount: result.product.fbx_urls?.length || (result.product.fbx_url ? 1 : 0),
                productDetails: {
                  category: result.product.category,
                  price: result.product.price,
                  type: result.product.type,
                  inventory: result.product.inventory
                },
                adminAccount: currentAdmin.username,
                adminId: currentAdmin.id,
                timestamp: new Date().toISOString()
              }
            });
          }
        }
      } catch (err) {
        console.error("fetchProduct error:", err);
      } finally {
        setLoading(false);
      }
    };
    if (productId && currentAdmin) fetchProduct();
  }, [productId, currentAdmin]);

  // Enhanced change handler with logging
  const handleChange = async (field: keyof Product, value: any) => {
    if (!product || !currentAdmin) return;
    
    const oldValue = product[field];
    const newProduct = { ...product, [field]: value };
    setProduct(newProduct);

    // Log individual field changes for detailed tracking
    if (oldValue !== value && originalProduct) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'update',
        entity_type: 'product_field',
        entity_id: product.id,
        details: `Admin ${currentAdmin.username} changed ${field} from "${String(oldValue ?? '')}" to "${String(value ?? '')}" for product "${product.name}"`,
        page: 'UpdateProducts',
        metadata: {
          productName: product.name,
          productId: product.id,
          fieldChanged: field,
          oldValue: oldValue,
          newValue: value,
          changeType: typeof value,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product || !originalProduct || !currentAdmin) {
      setMessage("Product data not loaded. Please try again.");
      return;
    }

    setUpdating(true);
    setMessage("Updating product...");

    try {
      // Calculate detailed changes for comprehensive logging
      const changes: Array<{field: string, oldValue: any, newValue: any, changeType: string}> = [];
      const changesSummary: string[] = [];
      
      Object.keys(product).forEach((key) => {
        const field = key as keyof Product;
        const oldVal = originalProduct[field];
        const newVal = product[field];
        
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          const changeType = oldVal === undefined ? 'added' : newVal === undefined ? 'removed' : 'modified';
          changes.push({
            field: key,
            oldValue: oldVal,
            newValue: newVal,
            changeType
          });
          changesSummary.push(`${key}: "${String(oldVal ?? "")}" → "${String(newVal ?? "")}"`);
        }
      });

      const res = await fetch(`/api/products/${product.id}`, {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || ""}`
        },
        body: JSON.stringify(product),
      });
      
      const result = await res.json();
      if (res.ok) {
        setMessage("Product updated successfully!");
        
        // Update originalProduct with new values to prevent duplicate logging
        setOriginalProduct(JSON.parse(JSON.stringify(product)));

        // Enhanced comprehensive activity logging
        if (changes.length > 0) {
          // Main update activity
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: "update",
            entity_type: "product",
            entity_id: product.id,
            page: "UpdateProducts",
            details: `Admin ${currentAdmin.username} updated product "${product.name}" with ${changes.length} changes: ${changesSummary.slice(0, 2).join("; ")}${changesSummary.length > 2 ? "..." : ""}`,
            metadata: {
              productName: product.name,
              productId: product.id,
              adminAccount: currentAdmin.username,
              adminId: currentAdmin.id,
              changesCount: changes.length,
              changes: changesSummary,
              detailedChanges: changes,
              updatedAt: new Date().toISOString(),
              fieldsUpdated: changes.map(c => c.field),
              updateSummary: {
                priceChanged: changes.some(c => c.field === 'price'),
                nameChanged: changes.some(c => c.field === 'name'),
                imageChanged: changes.some(c => c.field.startsWith('image')),
                descriptionChanged: changes.some(c => c.field === 'description'),
                categoryChanged: changes.some(c => c.field === 'category'),
                inventoryChanged: changes.some(c => c.field === 'inventory'),
                fbxChanged: changes.some(c => c.field === 'fbx_urls' || c.field === 'fbx_url')
              }
            }
          });

          // CREATE NOTIFICATION FOR PRODUCT UPDATE
          try {
            const changeFields = changes.map(c => c.field);
            await notifyProductUpdated(
              product.name, 
              currentAdmin.username, 
              changes.length, 
              changeFields
            );
          } catch (notifyError) {
            console.warn("Failed to create update notification:", notifyError);
          }

          // Log specific important changes separately for better tracking
          const importantChanges = ['price', 'name', 'category', 'inventory', 'fbx_urls'];
          for (const change of changes) {
            if (importantChanges.includes(change.field)) {
              await logActivity({
                admin_id: currentAdmin.id,
                admin_name: currentAdmin.username,
                action: "update",
                entity_type: `product_${change.field}`,
                entity_id: product.id,
                page: "UpdateProducts",
                details: `Admin ${currentAdmin.username} ${change.changeType} ${change.field} for "${product.name}": "${String(change.oldValue ?? '')}" → "${String(change.newValue ?? '')}"`,
                metadata: {
                  productName: product.name,
                  productId: product.id,
                  fieldName: change.field,
                  oldValue: change.oldValue,
                  newValue: change.newValue,
                  changeType: change.changeType,
                  adminAccount: currentAdmin.username,
                  adminId: currentAdmin.id,
                  timestamp: new Date().toISOString()
                }
              });
            }
          }
        }

        // Store success message in localStorage
        localStorage.setItem("productUpdateSuccess", JSON.stringify({
          productName: product.name,
          timestamp: Date.now(),
          changesCount: changes.length,
          adminName: currentAdmin.username
        }));

        // Navigate back after success
        setTimeout(() => {
          router.push("/dashboard/UpdateProducts");
        }, 800);
      } else {
        setMessage("Error updating product: " + (result.error || "Unknown error"));
        
        // Log update failure
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "update",
          entity_type: "product_error",
          entity_id: product.id,
          page: "UpdateProducts",
          details: `Admin ${currentAdmin.username} failed to update product "${product.name}": ${result.error || "Unknown error"}`,
          metadata: {
            productName: product.name,
            productId: product.id,
            error: result.error,
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            attemptedChanges: changes.length,
            timestamp: new Date().toISOString()
          }
        });
      }
    } catch (error) {
      console.error("Update error:", error);
      setMessage("Error updating product. Please try again.");
      
      // Log update exception
      if (currentAdmin) {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "update",
          entity_type: "product_exception",
          entity_id: product?.id || 'unknown',
          page: "UpdateProducts",
          details: `Admin ${currentAdmin.username} encountered error updating product: ${error}`,
          metadata: {
            productName: product?.name,
            productId: product?.id,
            error: String(error),
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            timestamp: new Date().toISOString()
          }
        });
      }
    } finally {
      setUpdating(false);
    }
  };

  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    field: keyof Product
  ) => {
    if (!e.target.files || !product || !currentAdmin) return;
    const file = e.target.files[0];

    const safeFileName = file.name.replace(/[^a-z0-9.\-_]/gi, "_");
    const objectPath = `${field}/${product.id}_${safeFileName}`;

    try {
      const { data, error } = await supabase.storage
        .from("products")
        .upload(objectPath, file, { upsert: true });

      if (error) {
        console.error("upload error", error);
        setMessage(`Error uploading file: ${error.message}`);
        
        // Log upload error
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "upload",
          entity_type: "file_error",
          entity_id: product.id,
          page: "UpdateProducts",
          details: `Admin ${currentAdmin.username} failed to upload ${field} for "${product.name}": ${error.message}`,
          metadata: {
            productName: product.name,
            productId: product.id,
            fieldType: field,
            fileName: file.name,
            fileSize: file.size,
            error: error.message,
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id
          }
        });
        return;
      }

      const { data: urlData } = await supabase.storage
        .from("products")
        .getPublicUrl(data.path);

      const url = urlData.publicUrl;
      const oldUrl = product[field];
      
      await handleChange(field, url);
      setMessage(`${field} uploaded successfully!`);

      // Log successful file upload
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: "upload",
        entity_type: "product_file",
        entity_id: product.id,
        page: "UpdateProducts",
        details: `Admin ${currentAdmin.username} uploaded ${field} for product "${product.name}": ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`,
        metadata: {
          productName: product.name,
          productId: product.id,
          fieldType: field,
          fileName: file.name,
          fileSize: file.size,
          fileSizeMB: (file.size / 1024 / 1024).toFixed(2),
          fileType: file.type,
          oldUrl: oldUrl,
          newUrl: url,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          uploadPath: data.path,
          timestamp: new Date().toISOString()
        }
      });

      // CREATE NOTIFICATION FOR FILE UPLOAD
      try {
        const fileType = field.toString().includes('image') ? 'image' : field.toString().includes('fbx') ? 'fbx' : 'file';
        await notifyProductFileUploaded(
          product.name, 
          currentAdmin.username, 
          fileType, 
          file.name
        );
      } catch (notifyError) {
        console.warn("Failed to create file upload notification:", notifyError);
      }

      // Clear success message after 3 seconds
      setTimeout(() => setMessage(""), 3000);
    } catch (err: any) {
      console.error("upload threw", err);
      setMessage("Error uploading file: " + (err?.message || String(err)));
      
      // Log upload exception
      if (currentAdmin) {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "upload",
          entity_type: "file_exception",
          entity_id: product.id,
          page: "UpdateProducts",
          details: `Admin ${currentAdmin.username} encountered exception uploading ${field} for "${product.name}": ${err?.message || String(err)}`,
          metadata: {
            productName: product.name,
            productId: product.id,
            fieldType: field,
            fileName: file.name,
            error: err?.message || String(err),
            adminAccount: currentAdmin.username,
            adminId: currentAdmin.id,
            timestamp: new Date().toISOString()
          }
        });
      }
    }
  };

  // Enhanced FBX file upload handler
  const handleFbxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !currentAdmin || !product) return;

    setUploadingFbx(true);
    setMessage("Uploading FBX files...");

    try {
      const uploadedUrls: string[] = [];
      
      for (const file of files) {
        const url = await uploadFile(file, "fbx", productId);
        uploadedUrls.push(url);
        
        // Log individual file upload
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "upload",
          entity_type: "fbx_file",
          entity_id: product.id,
          page: "UpdateProducts",
          details: `Admin ${currentAdmin.username} uploaded FBX file: ${file.name} for product "${product.name}"`,
          metadata: {
            fileName: file.name,
            fileSize: file.size,
            productName: product.name,
            productId: product.id,
            adminAccount: currentAdmin.username,
            timestamp: new Date().toISOString()
          }
        });

        // CREATE NOTIFICATION FOR FBX UPLOAD
        try {
          await notifyProductFileUploaded(
            product.name, 
            currentAdmin.username, 
            'fbx', 
            file.name
          );
        } catch (notifyError) {
          console.warn("Failed to create FBX upload notification:", notifyError);
        }
      }
      
      // Update product state with new FBX URLs
      const currentFbxUrls = product.fbx_urls || [];
      const newFbxUrls = [...currentFbxUrls, ...uploadedUrls];
      
      await handleChange('fbx_urls', newFbxUrls);
      
      // Also update the legacy fbx_url field for backward compatibility
      if (newFbxUrls.length > 0 && !product.fbx_url) {
        await handleChange('fbx_url', newFbxUrls[0]);
      }
      
      setMessage(`${files.length} FBX file(s) uploaded successfully!`);
      setTimeout(() => setMessage(""), 3000);
      
    } catch (error) {
      console.error("FBX upload error:", error);
      setMessage("Error uploading FBX files");
      
      // Log upload error
      if (currentAdmin) {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "upload",
          entity_type: "fbx_upload_error",
          entity_id: product.id,
          page: "UpdateProducts",
          details: `Admin ${currentAdmin.username} failed to upload FBX files for "${product.name}": ${error}`,
          metadata: {
            error: String(error),
            filesCount: files.length,
            productName: product.name,
            productId: product.id,
            adminAccount: currentAdmin.username,
            timestamp: new Date().toISOString()
          }
        });
      }
    } finally {
      setUploadingFbx(false);
    }
  };

  // Remove FBX file
  const handleRemoveFbx = async (url: string, index: number) => {
    if (!currentAdmin || !product) return;
    
    const currentFbxUrls = product.fbx_urls || [];
    const newFbxUrls = currentFbxUrls.filter((u) => u !== url);
    
    await handleChange('fbx_urls', newFbxUrls);
    
    // Update legacy fbx_url field
    if (newFbxUrls.length > 0) {
      await handleChange('fbx_url', newFbxUrls[0]);
    } else {
      await handleChange('fbx_url', null);
    }
    
    await logActivity({
      admin_id: currentAdmin.id,
      admin_name: currentAdmin.username,
      action: "delete",
      entity_type: "fbx_file",
      entity_id: product.id,
      page: "UpdateProducts",
      details: `Admin ${currentAdmin.username} removed FBX file (${index + 1}) from product "${product.name}"`,
      metadata: {
        removedUrl: url,
        fileIndex: index + 1,
        productName: product.name,
        productId: product.id,
        remainingFiles: newFbxUrls.length,
        adminAccount: currentAdmin.username,
        timestamp: new Date().toISOString()
      }
    });
  };

  // Open 3D viewer
  const handleOpen3DViewer = (index: number = 0) => {
    setCurrentFbxIndex(index);
    setShow3DViewer(true);
  };

  // Get current FBX URLs from product state
  const getCurrentFbxUrls = (): string[] => {
    if (product?.fbx_urls && Array.isArray(product.fbx_urls)) {
      return product.fbx_urls;
    }
    if (product?.fbx_url) {
      return [product.fbx_url];
    }
    return [];
  };

  const currentFbxUrls = getCurrentFbxUrls();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-xl text-black">
        Loading product...
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen flex items-center justify-center text-xl text-red-600">
        Product not found.
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 bg-gray-50">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-black">Edit Product: {product.name}</h1>
        <div className="text-sm text-gray-600">
          Editing as: {currentAdmin?.username || 'Unknown Admin'}
        </div>
      </div>
      
      {/* 3D Viewer Modal */}
      {show3DViewer && currentFbxUrls.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg p-6 shadow-lg relative max-w-4xl w-full mx-4">
            <button
              onClick={() => setShow3DViewer(false)}
              className="absolute top-3 right-3 text-gray-600 hover:text-gray-900 text-2xl z-20"
            >
              ×
            </button>

            <div className="mb-4">
              <h2 className="text-lg font-bold text-gray-900 mb-2">3D FBX Viewer</h2>
              <div className="text-sm text-gray-600 mb-2">
                Viewing FBX {currentFbxIndex + 1} of {currentFbxUrls.length}
              </div>
              
              {/* FBX Navigation */}
              {currentFbxUrls.length > 1 && (
                <div className="flex justify-center items-center gap-4 mb-4">
                  <button
                    onClick={() => setCurrentFbxIndex(Math.max(0, currentFbxIndex - 1))}
                    disabled={currentFbxIndex === 0}
                    className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
                  >
                    ← Previous
                  </button>
                  
                  <div className="flex space-x-1">
                    {currentFbxUrls.map((_, index) => (
                      <button
                        key={index}
                        onClick={() => setCurrentFbxIndex(index)}
                        className={`w-8 h-8 rounded-full text-xs font-bold ${
                          index === currentFbxIndex 
                            ? 'bg-blue-600 text-white' 
                            : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                        }`}
                      >
                        {index + 1}
                      </button>
                    ))}
                  </div>
                  
                  <button
                    onClick={() => setCurrentFbxIndex(Math.min(currentFbxUrls.length - 1, currentFbxIndex + 1))}
                    disabled={currentFbxIndex === currentFbxUrls.length - 1}
                    className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
            
            <div className="flex-1 w-full flex items-center justify-center overflow-hidden">
              <iframe
                src={currentFbxUrls[currentFbxIndex]}
                className="w-full h-96 border rounded"
                title={`3D Model ${currentFbxIndex + 1}`}
              />
            </div>
          </div>
        </div>
      )}
      
      <form onSubmit={handleUpdate} className="bg-white shadow rounded-lg p-6 space-y-6 max-w-4xl mx-auto text-black">
        {/* Basic Information */}
        <div className="border-b border-gray-200 pb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium mb-1 text-black">Product Name *</label>
              <input
                type="text"
                value={product.name}
                onChange={e => handleChange("name", e.target.value)}
                className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block font-medium mb-1 text-black">Full Product Name</label>
              <input
                type="text"
                value={product.fullproductname || ""}
                onChange={e => handleChange("fullproductname", e.target.value)}
                className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block font-medium mb-1 text-black">Price (₱) *</label>
              <input
                type="number"
                step="0.01"
                value={product.price}
                onChange={e => handleChange("price", Number(e.target.value))}
                className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block font-medium mb-1 text-black">Inventory Count</label>
              <input
                type="number"
                value={product.inventory || ""}
                onChange={e => handleChange("inventory", Number(e.target.value) || 0)}
                className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="block font-medium mb-1 text-black">Description</label>
            <textarea
              value={product.description}
              onChange={e => handleChange("description", e.target.value)}
              className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500"
              rows={3}
            />
          </div>

          <div className="mt-4">
            <label className="block font-medium mb-1 text-black">Additional Features</label>
            <textarea
              value={product.additionalfeatures || ""}
              onChange={e => handleChange("additionalfeatures", e.target.value)}
              className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500"
              rows={4}
              placeholder="Enter additional features (one per line or free text)"
            />
          </div>
        </div>

        {/* Categories and Types */}
        <div className="border-b border-gray-200 pb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Categories & Specifications</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block font-medium mb-1 text-black">Category *</label>
              <select
                value={product.category ?? ""}
                onChange={e => handleChange("category", e.target.value)}
                className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500"
                required
              >
                <option value="">Select Category</option>
                <option value="Doors">Doors</option>
                <option value="Windows">Windows</option>
                <option value="Enclosures">Enclosures</option>
                <option value="Casement">Casement</option>
                <option value="Sliding">Sliding</option>
                <option value="Railings">Railings</option>
                <option value="Canopy">Canopy</option>
                <option value="Curtain Wall">Curtain Wall</option>
              </select>
            </div>

            <div>
              <label className="block font-medium mb-1 text-black">Type</label>
              <select
                value={product.type || ""}
                onChange={e => handleChange("type", e.target.value)}
                className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select Type</option>
                <option value="Tinted">Tinted</option>
                <option value="Clear">Clear</option>
                <option value="Frosted">Frosted</option>
              </select>
            </div>

            <div>
              <label className="block font-medium mb-1 text-black">Material</label>
              <select
                value={product.material || ""}
                onChange={e => handleChange("material", e.target.value)}
                className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select Material</option>
                <option value="Glass">Glass</option>
                <option value="Wood">Wood</option>
                <option value="Metal">Metal</option>
                <option value="Aluminum">Aluminum</option>
                <option value="Steel">Steel</option>
              </select>
            </div>
          </div>
        </div>

        {/* Dimensions */}
        <div className="border-b border-gray-200 pb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Dimensions</h2>
          
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block font-medium mb-1 text-black">Height (cm)</label>
              <input
                type="number"
                step="0.01"
                value={product.height || ""}
                onChange={e => handleChange("height", Number(e.target.value) || undefined)}
                className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block font-medium mb-1 text-black">Width (cm)</label>
              <input
                type="number"
                step="0.01"
                value={product.width || ""}
                onChange={e => handleChange("width", Number(e.target.value) || undefined)}
                className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block font-medium mb-1 text-black">Thickness (cm)</label>
              <input
                type="number"
                step="0.01"
                value={product.thickness || ""}
                onChange={e => handleChange("thickness", Number(e.target.value) || undefined)}
                className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* 3D Models Management - NOW INSIDE FORM */}
        <div className="border-b border-gray-200 pb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            3D Models Management ({currentFbxUrls.length} files)
          </h2>
          
          <div className="mb-4">
            <label className="block font-medium mb-1 text-black">Upload New FBX Files</label>
            <input
              type="file"
              accept=".fbx"
              multiple
              onChange={handleFbxUpload}
              disabled={uploadingFbx}
              className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            />
            <div className="text-sm text-gray-500 mt-1">
              Select multiple FBX files to upload. Files will be automatically saved to the product.
            </div>
          </div>

          {uploadingFbx && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800">
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                Uploading FBX files...
              </div>
            </div>
          )}

          <div className="space-y-2">
            {currentFbxUrls.map((url, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-100 rounded-lg border">
                <div className="flex-1">
                  <div className="font-medium text-sm">3D Model {index + 1}</div>
                  <a 
                    href={url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-blue-600 underline text-xs break-all"
                  >
                    {url.split('/').pop() || url}
                  </a>
                </div>
                <div className="flex items-center space-x-2 ml-4">
                  <button
                    type="button"
                    onClick={() => handleOpen3DViewer(index)}
                    className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors"
                  >
                    View 3D
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveFbx(url, index)}
                    className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          {currentFbxUrls.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => handleOpen3DViewer(0)}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                View All 3D Models ({currentFbxUrls.length})
              </button>
            </div>
          )}
        </div>

        {/* File Uploads */}
        <div className="border-b border-gray-200 pb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Product Images</h2>
          
          {/* Legacy FBX File Upload (for backward compatibility) */}
          <div className="mb-4">
            <label className="block font-medium mb-1 text-black">Single 3D Model (FBX File) - Legacy</label>
            <input
              type="file"
              accept=".fbx"
              onChange={e => handleFileUpload(e, "fbx_url")}
              className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500"
            />
            <div className="text-sm text-gray-500 mt-1">
              This is for backward compatibility. Use "3D Models Management" section above for multiple files.
            </div>
            {product.fbx_url && (
              <a href={product.fbx_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline text-sm mt-2 block">
                View current legacy FBX file
              </a>
            )}
          </div>

          {/* Image Uploads */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="border border-gray-200 rounded-lg p-4">
                <label className="block font-medium mb-2 text-black">{`Image ${i}`}</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={e => handleFileUpload(e, `image${i}` as keyof Product)}
                  className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500 mb-2"
                />
                {product[`image${i}` as keyof Product] && (
                  <img
                    src={product[`image${i}` as keyof Product] as string}
                    alt={`Image ${i}`}
                    className="w-full h-32 object-cover rounded border"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 pt-4">
          <button
            type="submit"
            disabled={updating || uploadingFbx}
            className="bg-blue-600 text-white px-8 py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed transition-colors"
          >
            {updating ? "Updating Product..." : "Update Product"}
          </button>
          <button
            type="button"
            className="bg-gray-300 text-black px-8 py-3 rounded-lg font-semibold hover:bg-gray-400 transition-colors"
            onClick={async () => {
              // Log form cancellation
              if (currentAdmin) {
                await logActivity({
                  admin_id: currentAdmin.id,
                  admin_name: currentAdmin.username,
                  action: 'view',
                  entity_type: 'form_cancelled',
                  entity_id: product?.id || 'unknown',
                  details: `Admin ${currentAdmin.username} cancelled editing product "${product?.name || 'Unknown'}"`,
                  page: 'UpdateProducts',
                  metadata: {
                    productName: product?.name,
                    productId: product?.id,
                    hadChanges: JSON.stringify(product) !== JSON.stringify(originalProduct),
                    adminAccount: currentAdmin.username,
                    timestamp: new Date().toISOString()
                  }
                });
              }
              router.push("/dashboard/UpdateProducts");
            }}
          >
            Cancel
          </button>
        </div>
        
        {/* Status Message */}
        {message && (
          <div className={`text-center mt-4 p-3 rounded-lg ${
            message.includes("Error") || message.includes("Failed") 
              ? "bg-red-50 text-red-600 border border-red-200" 
              : "bg-green-50 text-green-600 border border-green-200"
          }`}>
            {message}
          </div>
        )}
      </form>
    </div>
  );
}

async function uploadFile(file: File, field: string, productId: string): Promise<string> {
  const safeFileName = file.name.replace(/[^a-z0-9.\-_]/gi, "_");
  const objectPath = `${field}/${productId}_${Date.now()}_${safeFileName}`;
  
  const { data, error } = await supabase.storage
    .from("products")
    .upload(objectPath, file, { upsert: true });

  if (error) throw error;

  const { data: urlData } = await supabase.storage
    .from("products")
    .getPublicUrl(data.path);

  return urlData.publicUrl;
}
