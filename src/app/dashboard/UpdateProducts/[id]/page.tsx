"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import { logActivity } from "@/app/lib/activity";
import { notifyProductUpdated, notifyProductFileUploaded } from "@/app/lib/notifications";
import * as THREE from "three";
import { FBXLoader, OrbitControls } from "three-stdlib";

type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  type?: string;
  images?: string[]; // unlimited images
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
  const [uploadingImages, setUploadingImages] = useState(false);

  // Persist images (already exists)
  const persistImages = async (imgs: string[]) => {
    try {
      const res = await fetch(`/api/products/${productId}` , {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          // Pass admin as JSON for activity logs on server
          Authorization: JSON.stringify(currentAdmin || {})
        },
        body: JSON.stringify({ images: imgs }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed to persist images (${res.status})`);
      }
      const j = await res.json().catch(() => null);
      if (j?.product) {
        setOriginalProduct((prev) => ({ ...(prev || {} as any), ...j.product } as Product));
        setProduct((prev) => ({ ...(prev || {} as any), ...j.product } as Product));
      }
    } catch (err) {
      console.error('persistImages error:', err);
      setMessage(`Warning: images saved locally but failed to persist: ${String((err as any)?.message || err)}`);
    }
  };

  // Persist FBX URLs (keeps legacy fbx_url in sync)
  const persistFbx = async (fbxUrls: string[] | null) => {
    try {
      const payload: any = { fbx_urls: fbxUrls || [] };
      payload.fbx_url = (fbxUrls && fbxUrls.length > 0) ? fbxUrls[0] : null;

      const res = await fetch(`/api/products/${productId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: JSON.stringify(currentAdmin || {})
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed to persist FBX (${res.status})`);
      }

      // Always reload product after update to sync state
      const reload = await fetch(`/api/products/${productId}`);
      if (reload.ok) {
        const result = await reload.json();
        if (result?.product) {
          setOriginalProduct(result.product);
          setProduct(result.product);
        }
      }
    } catch (err) {
      console.error('persistFbx error:', err);
      setMessage(`Warning: FBX update saved locally but failed to persist: ${String((err as any)?.message || err)}`);
    }
  };

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

  // Images management (unlimited)
  const syncLegacyImages = async (imgs: string[]) => {
    // Keep legacy fields in sync for backward compatibility
    await handleChange('image1', imgs[0] || null);
    await handleChange('image2', imgs[1] || null);
    await handleChange('image3', imgs[2] || null);
    await handleChange('image4', imgs[3] || null);
    await handleChange('image5', imgs[4] || null);
  };

  const getCurrentImages = (): string[] => {
    if (product?.images && Array.isArray(product.images)) return product.images;
    // Build array from legacy fields as fallback
    const legacy = [product?.image1, product?.image2, product?.image3, product?.image4, product?.image5]
      .filter(Boolean) as string[];
    return legacy;
  };

  const handleImagesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !currentAdmin || !product) return;

    setUploadingImages(true);
    setMessage("Uploading images...");

    try {
      const uploadedUrls: string[] = [];
      for (const file of files) {
        const url = await uploadFile(file, 'images', productId);
        uploadedUrls.push(url);

        // Log individual image upload
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'upload',
          entity_type: 'product_image',
          entity_id: product.id,
          page: 'UpdateProducts',
          details: `Uploaded product image: ${file.name} for "${product.name}"`,
          metadata: {
            fileName: file.name,
            fileSize: file.size,
            productName: product.name,
            productId: product.id,
            adminAccount: currentAdmin.username,
            timestamp: new Date().toISOString()
          }
        });
      }

      const current = getCurrentImages();
      const next = [...current, ...uploadedUrls];

  await handleChange('images', next);
  await syncLegacyImages(next);
  // Persist immediately so images don't disappear on re-fetch
  await persistImages(next);

      setMessage(`${files.length} image(s) uploaded successfully!`);
      setTimeout(() => setMessage(""), 3000);
    } catch (error) {
      console.error('Images upload error:', error);
      setMessage('Error uploading images');
    } finally {
      setUploadingImages(false);
    }
  };

  const handleRemoveImage = async (url: string, index: number) => {
    if (!currentAdmin || !product) return;
    const current = getCurrentImages();
    const next = current.filter((u) => u !== url);
    await handleChange('images', next);
    await syncLegacyImages(next);
    await persistImages(next);

    await logActivity({
      admin_id: currentAdmin.id,
      admin_name: currentAdmin.username,
      action: 'delete',
      entity_type: 'product_image',
      entity_id: product.id,
      page: 'UpdateProducts',
      details: `Removed product image (${index + 1}) from "${product.name}"`,
      metadata: {
        removedUrl: url,
        imageIndex: index + 1,
        remaining: next.length,
        productName: product.name,
        productId: product.id,
        adminAccount: currentAdmin.username,
        timestamp: new Date().toISOString()
      }
    });
  };

  const handleReplaceImage = async (idx: number, file: File) => {
    if (!currentAdmin || !product) return;
    setUploadingImages(true);
    setMessage('Replacing image...');
    try {
      const url = await uploadFile(file, 'images', productId);
        const current = getCurrentImages();
        const next = current.slice();
      next[idx] = url;
      await handleChange('images', next);
      await syncLegacyImages(next);
      await persistImages(next);

      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'update',
        entity_type: 'product_image',
        entity_id: product.id,
        page: 'UpdateProducts',
        details: `Replaced product image ${idx + 1} for "${product.name}" with ${file.name}`,
        metadata: {
          fileName: file.name,
          imageIndex: idx + 1,
          productName: product.name,
          productId: product.id,
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });

      setMessage('Image replaced successfully');
      setTimeout(() => setMessage(''), 2500);
    } catch (error) {
      console.error('Replace image error:', error);
      setMessage('Error replacing image');
    } finally {
      setUploadingImages(false);
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
      
      // Merge with current FBX list (handle legacy fbx_url)
      const currentFbxUrls = getCurrentFbxUrls();
      const newFbxUrls = [...currentFbxUrls, ...uploadedUrls];

      // Update UI state immediately
      await handleChange('fbx_urls', newFbxUrls);
      await handleChange('fbx_url', newFbxUrls.length > 0 ? newFbxUrls[0] : null);

      // Persist immediately so files don't disappear on refresh
      await persistFbx(newFbxUrls);
      
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
    
    const currentFbxUrls = getCurrentFbxUrls();
    const newFbxUrls = currentFbxUrls.filter((u) => u !== url);

    // Update UI state
    await handleChange('fbx_urls', newFbxUrls);
    await handleChange('fbx_url', newFbxUrls.length > 0 ? newFbxUrls[0] : null);

    // Persist and reload product to sync state
    await persistFbx(newFbxUrls);
    
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
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.8)" }}>
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

              {currentFbxUrls.length > 1 && (
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => setCurrentFbxIndex((i) => (i > 0 ? i - 1 : currentFbxUrls.length - 1))}
                    className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentFbxIndex((i) => (i < currentFbxUrls.length - 1 ? i + 1 : 0))}
                    className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                  >
                    Next
                  </button>
                </div>
              )}

              <div className="text-xs text-gray-500 mb-2">
                Use mouse to rotate, zoom, and pan. Background is transparent for clean previews.
              </div>
            </div>

            <div className="h-96 w-full">
              <FBXViewer fbxUrl={currentFbxUrls[currentFbxIndex]} />
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

        {/* Images Management (unlimited) */}
        <div className="border-b border-gray-200 pb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Images Management ({getCurrentImages().length} files)
          </h2>

          <div className="mb-4">
            <label className="block font-medium mb-1 text-black">Upload Images</label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleImagesUpload}
              disabled={uploadingImages}
              className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            />
            <div className="text-sm text-gray-500 mt-1">
              You can upload any number of images. They will be added to this product.
            </div>
          </div>

          {uploadingImages && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800">
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                Uploading images...
              </div>
            </div>
          )}

          <div className="space-y-2">
            {getCurrentImages().map((url, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-100 rounded-lg border">
                <div className="flex items-center gap-3 flex-1">
                  <img src={url} alt={`Image ${index + 1}`} className="w-20 h-20 object-cover rounded border" />
                  <div className="flex-1">
                    <div className="font-medium text-sm">Image {index + 1}</div>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 underline text-xs break-all"
                    >
                      {url.split('/').pop() || url}
                    </a>
                  </div>
                </div>
                <div className="flex items-center space-x-2 ml-4">
                  <label className="px-3 py-1 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 transition-colors cursor-pointer">
                    Replace
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleReplaceImage(index, f);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(url, index)}
                    className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors"
                  >
                    Remove
                  </button>
                </div>
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

// FBX Viewer Component (adapted from products page for consistency)
function FBXViewer({ fbxUrl }: { fbxUrl: string }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container || !fbxUrl) return;

    setIsLoading(true);
    setLoadError(null);

    let disposed = false;
    let frameId = 0;
    let objectURLToRevoke: string | null = null;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      (container.clientWidth || 800) / (container.clientHeight || 480),
      0.1,
      4000
    );
    camera.position.set(0, 160, 260);

    // Color management (r152+ and <=r151)
    const setOutputCS = (r: any) => {
      const anyTHREE: any = THREE;
      if ("outputColorSpace" in r && anyTHREE.SRGBColorSpace !== undefined) {
        r.outputColorSpace = anyTHREE.SRGBColorSpace;
      } else if ("outputEncoding" in r && anyTHREE.sRGBEncoding !== undefined) {
        r.outputEncoding = anyTHREE.sRGBEncoding;
      }
    };
    setOutputCS(renderer);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth || 800, container.clientHeight || 480);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

  // Mount canvas safely without disturbing React's DOM tracking
  const canvasEl = renderer.domElement;
  container.appendChild(canvasEl);

  // Lights (no platform/grid); keep transparent background to focus on model
  scene.background = null;
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.15);
    hemi.position.set(0, 400, 0);
    scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(180, 240, 200);
    dir.castShadow = true;
    scene.add(dir);

    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-160, 160, -180);
    scene.add(fill);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 20;
    controls.maxDistance = 800;
    controls.target.set(0, 0, 0);
    controls.update();

    const manager = new THREE.LoadingManager();
    manager.onError = (url) => !disposed && setLoadError(`Failed to load: ${url}`);
    const loader = new FBXLoader(manager);
    loader.setCrossOrigin("anonymous");

    // Try to fetch the file as a Blob first to avoid any CORS/content-type hiccups,
    // then fall back to direct URL if needed.
    const tryLoad = async () => {
      const tryUrls: string[] = [fbxUrl];
      // If the URL might contain spaces, also try an encoded version
      if (fbxUrl.includes(" ")) tryUrls.push(encodeURI(fbxUrl));

      for (const url of tryUrls) {
        try {
          const res = await fetch(url, { mode: "cors" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          objectURLToRevoke = URL.createObjectURL(blob);

          return new Promise<void>((resolve, reject) => {
            loader.load(
              objectURLToRevoke as string,
              (object) => {
                if (disposed) return;
                // attach object to scene with centering, scaling, and camera fit
                object.traverse((child: any) => {
                  if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    if (Array.isArray(child.material)) {
                      child.material.forEach((m: any) => {
                        m.side = THREE.DoubleSide;
                        m.needsUpdate = true;
                      });
                    } else if (child.material) {
                      child.material.side = THREE.DoubleSide;
                      child.material.needsUpdate = true;
                    }
                  }
                });

                // Center and scale
                const box1 = new THREE.Box3().setFromObject(object);
                const center1 = box1.getCenter(new THREE.Vector3());
                object.position.sub(center1);
                const size1 = box1.getSize(new THREE.Vector3());
                const maxAxis1 = Math.max(size1.x, size1.y, size1.z) || 1;
                const targetSize = 200;
                object.scale.setScalar(targetSize / maxAxis1);

                // Fit camera
                const box2 = new THREE.Box3().setFromObject(object);
                const size2 = box2.getSize(new THREE.Vector3());
                const maxDim = Math.max(size2.x, size2.y, size2.z) || 1;
                const center2 = box2.getCenter(new THREE.Vector3());
                const fov = THREE.MathUtils.degToRad(camera.fov);
                const fitHeightDistance = maxDim / (2 * Math.tan(fov / 2));
                const fitWidthDistance = fitHeightDistance / camera.aspect;
                const distance = 1.15 * Math.max(fitHeightDistance, fitWidthDistance);

                camera.near = Math.max(0.1, maxDim / 100);
                camera.far = Math.max(1000, maxDim * 100);
                camera.updateProjectionMatrix();
                camera.position.set(center2.x + distance, center2.y + distance * 0.2, center2.z + distance);
                controls.target.copy(center2);
                controls.minDistance = distance * 0.1;
                controls.maxDistance = distance * 8;
                controls.update();

                scene.add(object);
                setIsLoading(false);
                resolve();
              },
              undefined,
              (err) => {
                reject(err);
              }
            );
          });
        } catch (e) {
          // Try next variant
          continue;
        }
      }
      // If all blob attempts failed, try direct URL once
      return new Promise<void>((resolve, reject) => {
        loader.load(
          fbxUrl,
          (object) => {
        if (disposed) return;
            object.traverse((child: any) => {
              if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (Array.isArray(child.material)) {
                  child.material.forEach((m: any) => {
                    m.side = THREE.DoubleSide;
                    m.needsUpdate = true;
                  });
                } else if (child.material) {
                  child.material.side = THREE.DoubleSide;
                  child.material.needsUpdate = true;
                }
              }
            });

            const box1 = new THREE.Box3().setFromObject(object);
            const center1 = box1.getCenter(new THREE.Vector3());
            object.position.sub(center1);
            const size1 = box1.getSize(new THREE.Vector3());
            const maxAxis1 = Math.max(size1.x, size1.y, size1.z) || 1;
            const targetSize = 200;
            object.scale.setScalar(targetSize / maxAxis1);

            const box2 = new THREE.Box3().setFromObject(object);
            const size2 = box2.getSize(new THREE.Vector3());
            const maxDim = Math.max(size2.x, size2.y, size2.z) || 1;
            const center2 = box2.getCenter(new THREE.Vector3());
            const fov = THREE.MathUtils.degToRad(camera.fov);
            const fitHeightDistance = maxDim / (2 * Math.tan(fov / 2));
            const fitWidthDistance = fitHeightDistance / camera.aspect;
            const distance = 1.15 * Math.max(fitHeightDistance, fitWidthDistance);

            camera.near = Math.max(0.1, maxDim / 100);
            camera.far = Math.max(1000, maxDim * 100);
            camera.updateProjectionMatrix();
            camera.position.set(center2.x + distance, center2.y + distance * 0.2, center2.z + distance);
            controls.target.copy(center2);
            controls.minDistance = distance * 0.1;
            controls.maxDistance = distance * 8;
            controls.update();

            scene.add(object);
            setIsLoading(false);
            resolve();
          },
          undefined,
          (err) => reject(err)
        );
      });
    };

    tryLoad().catch((err) => {
      if (disposed) return;
      console.error("FBX load error:", err);
      setLoadError("Unable to render 3D model. Re-upload the FBX if the issue persists.");
      setIsLoading(false);
    });

    const handleResize = () => {
      if (disposed) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 480;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(container);

    const animate = () => {
      if (disposed) return;
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      ro.disconnect();
      controls.dispose();

      // Safe DOM removal (no NotFoundError)
      try {
        if (canvasEl?.parentNode === container) container.removeChild(canvasEl);
      } catch {}

      if (objectURLToRevoke) {
        try { URL.revokeObjectURL(objectURLToRevoke); } catch {}
        objectURLToRevoke = null;
      }

      // Dispose WebGL resources
      scene.traverse((child) => {
        const m = child as any;
        if (m.isMesh) {
          m.geometry?.dispose();
          const mat = m.material;
          if (Array.isArray(mat)) mat.forEach((mm: any) => mm?.dispose?.());
          else mat?.dispose?.();
        }
      });
      renderer.dispose();
      (renderer as any).forceContextLoss?.();
    };
  }, [fbxUrl]);

  return (
    <div ref={mountRef} className="relative h-full w-full rounded-lg bg-transparent">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/80 text-sm text-gray-600">
          Loading 3D model…
        </div>
      )}
      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/90 px-4 text-center text-sm text-red-600">
          {loadError}
        </div>
      )}
    </div>
  );
}
