"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import { logActivity } from "@/app/lib/activity";
import { notifyProductUpdated, notifyProductFileUploaded } from "@/app/lib/notifications";
import ThreeDModelViewer from "@/components/ThreeDModelViewer";
import RichTextEditor from "@/components/RichTextEditor";
import ToastPopup, { type ToastPopupState } from "@/components/ToastPopup";

const ALLOWED_3D_EXTENSIONS = ["fbx", "glb", "gltf"] as const;

type WeatherKey = "sunny" | "rainy" | "night" | "foggy";
const WEATHER_KEYS: WeatherKey[] = ["sunny", "rainy", "night", "foggy"];
type FrameFinish = "default" | "matteBlack" | "matteGray" | "narra" | "walnut";

function materialToFrameFinish(material?: string | null): FrameFinish {
  const key = String(material || "").toLowerCase();
  if (key.includes("walnut")) return "walnut";
  if (key.includes("narra") || key.includes("wood")) return "narra";
  if (key.includes("aluminum") || key.includes("steel") || key.includes("metal")) return "matteGray";
  if (key.includes("black")) return "matteBlack";
  return "default";
}

function getFileExtension(name: string): string {
  const clean = (name || "").split("?")[0].split("#")[0];
  const lastDot = clean.lastIndexOf(".");
  if (lastDot === -1) return "";
  return clean.slice(lastDot + 1).toLowerCase();
}

function isAllowed3DFile(file: File): boolean {
  const ext = getFileExtension(file.name);
  return (ALLOWED_3D_EXTENSIONS as readonly string[]).includes(ext);
}

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
  house_model_url?: string | null;
  skyboxes?: Partial<Record<WeatherKey, string | null>>;
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
  const [toast, setToast] = useState<ToastPopupState>({ open: false, type: "info", title: "", message: "" });
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [show3DViewer, setShow3DViewer] = useState(false);
  const [currentFbxIndex, setCurrentFbxIndex] = useState(0);
  const [uploadingFbx, setUploadingFbx] = useState(false);
  const [uploadingHouseModel, setUploadingHouseModel] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingSkyboxes, setUploadingSkyboxes] = useState(false);
  const [previewWeather, setPreviewWeather] = useState<WeatherKey>("sunny");

  useEffect(() => {
    if (!message) return;
    const lower = message.toLowerCase();
    if (lower.includes("error") || lower.includes("failed")) {
      setToast({ open: true, type: "error", title: "Error", message });
      return;
    }
    if (lower.includes("success") || lower.includes("saved") || lower.includes("updated")) {
      setToast({ open: true, type: "success", title: "Saved", message });
      return;
    }
    setToast({ open: true, type: "info", title: "Notice", message });
  }, [message]);

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

  const persistSkyboxes = async (skyboxes: Partial<Record<WeatherKey, string | null>> | null) => {
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: JSON.stringify(currentAdmin || {})
        },
        body: JSON.stringify({ skyboxes: skyboxes || null }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed to persist skyboxes (${res.status})`);
      }

      const j = await res.json().catch(() => null);
      if (j?.product) {
        setOriginalProduct((prev) => ({ ...(prev || {} as any), ...j.product } as Product));
        setProduct((prev) => ({ ...(prev || {} as any), ...j.product } as Product));
      }
    } catch (err) {
      console.error('persistSkyboxes error:', err);
      setMessage(`Warning: skyboxes saved locally but failed to persist: ${String((err as any)?.message || err)}`);
    }
  };

  const persistHouseModel = async (houseModelUrl: string | null) => {
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: JSON.stringify(currentAdmin || {})
        },
        body: JSON.stringify({ house_model_url: houseModelUrl || null }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed to persist house model (${res.status})`);
      }

      const j = await res.json().catch(() => null);
      if (j?.product) {
        setOriginalProduct((prev) => ({ ...(prev || {} as any), ...j.product } as Product));
        setProduct((prev) => ({ ...(prev || {} as any), ...j.product } as Product));
      }
    } catch (err) {
      console.error('persistHouseModel error:', err);
      setMessage(`Warning: house model saved locally but failed to persist: ${String((err as any)?.message || err)}`);
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

  const getCurrentSkyboxes = (): Partial<Record<WeatherKey, string | null>> => {
    const raw = (product as any)?.skyboxes;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as any;
    return {};
  };

  const handleUploadSkybox = async (weather: WeatherKey, file: File) => {
    if (!currentAdmin || !product) return;
    setUploadingSkyboxes(true);
    setMessage(`Uploading ${weather} skybox...`);

    try {
      const url = await uploadFile(file, `skyboxes/${weather}`, productId);
      const current = getCurrentSkyboxes();
      const next = { ...current, [weather]: url };

      await handleChange('skyboxes', next);
      await persistSkyboxes(next);

      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'upload',
        entity_type: 'product_skybox',
        entity_id: product.id,
        page: 'UpdateProducts',
        details: `Uploaded ${weather} skybox for "${product.name}": ${file.name}`,
        metadata: {
          weather,
          fileName: file.name,
          fileSize: file.size,
          skyboxUrl: url,
          productName: product.name,
          productId: product.id,
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });

      setMessage('Skybox uploaded successfully');
      setTimeout(() => setMessage(''), 2500);
    } catch (error) {
      console.error('Skybox upload error:', error);
      setMessage('Error uploading skybox');
    } finally {
      setUploadingSkyboxes(false);
    }
  };

  const handleRemoveSkybox = async (weather: WeatherKey) => {
    if (!currentAdmin || !product) return;
    const current = getCurrentSkyboxes();
    if (!current[weather]) return;

    const next = { ...current, [weather]: null };
    await handleChange('skyboxes', next);
    await persistSkyboxes(next);

    await logActivity({
      admin_id: currentAdmin.id,
      admin_name: currentAdmin.username,
      action: 'delete',
      entity_type: 'product_skybox',
      entity_id: product.id,
      page: 'UpdateProducts',
      details: `Removed ${weather} skybox from "${product.name}"`,
      metadata: {
        weather,
        removedUrl: current[weather],
        productName: product.name,
        productId: product.id,
        adminAccount: currentAdmin.username,
        timestamp: new Date().toISOString()
      }
    });
  };

  const handleHouseModelUpload = async (file: File) => {
    if (!currentAdmin || !product) return;

    if (!isAllowed3DFile(file)) {
      setMessage(
        `Unsupported house model file. Allowed: ${ALLOWED_3D_EXTENSIONS.map((x) => `.${x}`).join(", ")}`
      );
      return;
    }

    setUploadingHouseModel(true);
    setMessage('Uploading house model...');

    try {
      const url = await uploadFile(file, 'house-models', productId);
      await handleChange('house_model_url', url);
      await persistHouseModel(url);

      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'upload',
        entity_type: 'house_3d_model_file',
        entity_id: product.id,
        page: 'UpdateProducts',
        details: `Uploaded house model for "${product.name}": ${file.name}`,
        metadata: {
          fileName: file.name,
          fileSize: file.size,
          houseModelUrl: url,
          productName: product.name,
          productId: product.id,
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });

      setMessage('House model uploaded successfully');
      setTimeout(() => setMessage(''), 2500);
    } catch (error) {
      console.error('House model upload error:', error);
      setMessage('Error uploading house model');
    } finally {
      setUploadingHouseModel(false);
    }
  };

  const handleRemoveHouseModel = async () => {
    if (!currentAdmin || !product || !product.house_model_url) return;

    const removed = product.house_model_url;
    await handleChange('house_model_url', null);
    await persistHouseModel(null);

    await logActivity({
      admin_id: currentAdmin.id,
      admin_name: currentAdmin.username,
      action: 'delete',
      entity_type: 'house_3d_model_file',
      entity_id: product.id,
      page: 'UpdateProducts',
      details: `Removed house model from "${product.name}"`,
      metadata: {
        removedUrl: removed,
        productName: product.name,
        productId: product.id,
        adminAccount: currentAdmin.username,
        timestamp: new Date().toISOString()
      }
    });
  };

  // Enhanced FBX file upload handler
  const handleFbxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !currentAdmin || !product) return;

    const accepted = files.filter(isAllowed3DFile);
    const rejected = files.filter((f) => !isAllowed3DFile(f));
    if (rejected.length > 0) {
      setMessage(
        `Ignored ${rejected.length} unsupported file(s). Allowed: ${ALLOWED_3D_EXTENSIONS.map((x) => `.${x}`).join(", ")}`
      );
    }
    if (accepted.length === 0) return;

    setUploadingFbx(true);
    setMessage("Uploading 3D model files...");

    try {
      const uploadedUrls: string[] = [];
      
      for (const file of accepted) {
        const url = await uploadFile(file, "models", productId);
        uploadedUrls.push(url);

        const fileType = getFileExtension(file.name) || "file";
        
        // Log individual file upload
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "upload",
          entity_type: "3d_model_file",
          entity_id: product.id,
          page: "UpdateProducts",
          details: `Admin ${currentAdmin.username} uploaded 3D model file: ${file.name} for product "${product.name}"`,
          metadata: {
            fileName: file.name,
            fileSize: file.size,
            fileType,
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
            fileType, 
            file.name
          );
        } catch (notifyError) {
          console.warn("Failed to create 3D model upload notification:", notifyError);
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
      
      setMessage(`${accepted.length} 3D model file(s) uploaded successfully!`);
      setTimeout(() => setMessage(""), 3000);
      
    } catch (error) {
      console.error("FBX upload error:", error);
      setMessage("Error uploading 3D model files");
      
      // Log upload error
      if (currentAdmin) {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "upload",
          entity_type: "3d_model_upload_error",
          entity_id: product.id,
          page: "UpdateProducts",
          details: `Admin ${currentAdmin.username} failed to upload 3D model files for "${product.name}": ${error}`,
          metadata: {
            error: String(error),
            filesCount: accepted.length,
            rejectedFileNames: rejected.map((f) => f.name),
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
      details: `Admin ${currentAdmin.username} removed 3D model file (${index + 1}) from product "${product.name}"`,
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
  const previewSkyboxUrl = (product?.skyboxes && (product.skyboxes as any)[previewWeather]) ? (product.skyboxes as any)[previewWeather] : null;

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
      <ToastPopup state={toast} onClose={() => setToast((prev) => ({ ...prev, open: false }))} />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-black">Edit Product: {product.name}</h1>
        <div className="text-sm text-gray-600">
          Editing as: {currentAdmin?.username || 'Unknown Admin'}
        </div>
      </div>
      
      {/* 3D Viewer Modal */}
      {show3DViewer && currentFbxUrls.length > 0 && (
        <div className="fixed inset-0 flex items-center justify-center z-50 bg-transparent">
          <div className="bg-white/95 backdrop-blur-md rounded-xl p-6 shadow-2xl relative w-[98vw] max-w-[1600px] h-[90vh] mx-2 flex flex-col">
            <button
              onClick={() => setShow3DViewer(false)}
              className="absolute top-3 right-3 text-gray-700 hover:text-black text-2xl font-bold z-10 bg-white rounded-full w-10 h-10 flex items-center justify-center shadow-md"
            >
              ×
            </button>

            <div className="mb-4 flex-none">
              <h2 className="text-lg font-bold text-gray-900 mb-2">3D Model Viewer</h2>
              <div className="text-sm text-gray-600 mb-2">
                Viewing {currentFbxIndex + 1} of {currentFbxUrls.length}
              </div>


              <div className="text-xs text-gray-500 mb-2">Use mouse to rotate, zoom, and pan.</div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-gray-700">Weather:</span>
                {WEATHER_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setPreviewWeather(k)}
                    className={`px-3 py-1 rounded text-xs border transition-colors ${
                      previewWeather === k
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {k.charAt(0).toUpperCase() + k.slice(1)}
                  </button>
                ))}
                {!previewSkyboxUrl && (
                  <span className="text-[11px] text-gray-500">No skybox set for this weather.</span>
                )}
              </div>
            </div>

            <div className="flex-1 min-h-0 w-full">
              <ThreeDModelViewer
                modelUrls={currentFbxUrls}
                initialIndex={currentFbxIndex}
                weather={previewWeather}
                frameFinish={materialToFrameFinish(product.material)}
                houseModelUrl={product.house_model_url || undefined}
                skyboxes={product.skyboxes || null}
                productDimensions={{
                  width: product.width ?? null,
                  height: product.height ?? null,
                  thickness: product.thickness ?? null,
                  units: "cm",
                }}
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
          </div>

          <div className="mt-4">
            <label className="block font-medium mb-1 text-black">Description</label>
            <RichTextEditor
              value={String(product.description || "")}
              onChange={(next) => handleChange("description", next)}
            />
          </div>

          <div className="mt-4">
            <label className="block font-medium mb-1 text-black">Additional Features</label>
            <RichTextEditor
              value={String(product.additionalfeatures || "")}
              onChange={(next) => handleChange("additionalfeatures", next)}
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

          <div className="mb-6 p-4 bg-gray-50 border rounded-lg">
            <h3 className="text-md font-semibold text-gray-900 mb-2">House Context Model</h3>
            <div className="text-sm text-gray-500 mb-3">
              Optional: this model is shown on the website 3D viewer as the house context for the product.
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <label className="px-3 py-2 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 cursor-pointer transition-colors">
                {product.house_model_url ? 'Replace House Model' : 'Upload House Model'}
                <input
                  type="file"
                  accept=".fbx,.glb,.gltf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleHouseModelUpload(f);
                  }}
                />
              </label>

              <button
                type="button"
                onClick={handleRemoveHouseModel}
                disabled={!product.house_model_url || uploadingHouseModel}
                className="px-3 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                Remove
              </button>
            </div>

            {uploadingHouseModel && (
              <div className="mb-3 p-2 bg-blue-50 border border-blue-200 rounded text-blue-800 text-sm">
                Uploading house model...
              </div>
            )}

            {product.house_model_url ? (
              <a
                href={product.house_model_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline text-xs break-all"
              >
                {product.house_model_url.split('/').pop() || product.house_model_url}
              </a>
            ) : (
              <div className="text-xs text-gray-500">No house model uploaded.</div>
            )}
          </div>
          
          <div className="mb-4">
            <label className="block font-medium mb-1 text-black">Upload New 3D Model Files (.fbx, .glb, .gltf)</label>
            <input
              type="file"
              accept=".fbx,.glb,.gltf"
              multiple
              onChange={handleFbxUpload}
              disabled={uploadingFbx}
              className="border px-3 py-2 rounded w-full text-black bg-white focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            />
            <div className="text-sm text-gray-500 mt-1">
              Select multiple 3D model files to upload. Files will be automatically saved to the product.
            </div>
          </div>

          {uploadingFbx && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800">
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                Uploading 3D model files...
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

        {/* Skyboxes Management */}
        <div className="border-b border-gray-200 pb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Skyboxes by Weather</h2>
          <div className="text-sm text-gray-500 mb-4">
            Upload one equirectangular image (JPG/PNG) per weather. This will be used as the 3D background on the website and in the admin preview.
          </div>

          {uploadingSkyboxes && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800">
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                Uploading skybox...
              </div>
            </div>
          )}

          <div className="space-y-2">
            {WEATHER_KEYS.map((weatherKey) => {
              const sky = getCurrentSkyboxes();
              const url = sky?.[weatherKey] || null;
              return (
                <div key={weatherKey} className="flex items-center justify-between p-3 bg-gray-100 rounded-lg border">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-28 h-16 bg-white border rounded overflow-hidden flex items-center justify-center">
                      {url ? (
                        <img src={url} alt={`${weatherKey} skybox`} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs text-gray-400">No skybox</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-sm capitalize">{weatherKey}</div>
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 underline text-xs break-all"
                        >
                          {url.split('/').pop() || url}
                        </a>
                      ) : (
                        <div className="text-xs text-gray-500">Upload an image to enable this weather skybox.</div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 ml-4">
                    <label className="px-3 py-1 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 transition-colors cursor-pointer">
                      {url ? 'Replace' : 'Upload'}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleUploadSkybox(weatherKey, f);
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => handleRemoveSkybox(weatherKey)}
                      disabled={!url}
                      className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
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
