"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import { logActivity } from "@/app/lib/activity";
import { notifyProductUpdated, notifyProductFileUploaded } from "@/app/lib/notifications";
import {
  createEmptyGlobalSkyboxDefaults,
  mergeEffectiveSkyboxes,
  WEATHER_KEYS,
  type GlobalSkyboxDefaults,
  type SkyboxKey,
  type WeatherKey,
} from "@/app/lib/skyboxDefaults";
import ThreeDModelViewer from "@/components/ThreeDModelViewer";
import RichTextEditor from "@/components/RichTextEditor";
import ToastPopup, { type ToastPopupState } from "@/components/ToastPopup";
import {
  buildAdditionalFeaturesHtml,
  createFeatureOptionsByCategory,
  getCategoryFeatureOptions,
  mergeFeatureOptions,
  parseFeatureItems,
  PRODUCT_CATEGORY_OPTIONS,
  PRODUCT_FORM_TABS,
  type ProductFormTabKey,
  stripRichText,
} from "../../products/productFormConfig";

const ALLOWED_3D_EXTENSIONS = ["fbx", "glb", "gltf"] as const;
const IMAGE_MAX_FILE_SIZE_BYTES = 6 * 1024 * 1024;
const MODEL_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
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
  skyboxes?: Partial<Record<SkyboxKey, string | null>>;
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
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingSkyboxes, setUploadingSkyboxes] = useState(false);
  const [savingGlobalSkybox, setSavingGlobalSkybox] = useState<WeatherKey | null>(null);
  const [previewWeather, setPreviewWeather] = useState<WeatherKey>("sunny");
  const [globalSkyboxDefaults, setGlobalSkyboxDefaults] = useState<GlobalSkyboxDefaults>(() => createEmptyGlobalSkyboxDefaults());
  const [activeTab, setActiveTab] = useState<ProductFormTabKey>("identity");
  const [selectedFeatureOptions, setSelectedFeatureOptions] = useState<string[]>([]);
  const [featureOptionsByCategory, setFeatureOptionsByCategory] = useState<Record<string, string[]>>(() => createFeatureOptionsByCategory());
  const [newFeatureOption, setNewFeatureOption] = useState("");

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

  const persistSkyboxes = async (skyboxes: Partial<Record<SkyboxKey, string | null>> | null) => {
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
    const loadGlobalSkyboxDefaults = async () => {
      try {
        const res = await fetch("/api/product-skybox-defaults", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Failed to load default skyboxes");
        setGlobalSkyboxDefaults(json?.defaults || createEmptyGlobalSkyboxDefaults());
      } catch (error) {
        console.error("Failed to load global skybox defaults", error);
      }
    };

    void loadGlobalSkyboxDefaults();
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

  useEffect(() => {
    if (!originalProduct) return;
    const existingFeatures = parseFeatureItems(originalProduct.additionalfeatures || "");
    const nextMap = createFeatureOptionsByCategory();
    if (originalProduct.category) {
      nextMap[originalProduct.category] = mergeFeatureOptions(nextMap[originalProduct.category], existingFeatures);
    }
    setFeatureOptionsByCategory(nextMap);
    setSelectedFeatureOptions(existingFeatures);
    setNewFeatureOption("");
  }, [originalProduct]);

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

  const selectedCategoryFeatures = product?.category
    ? featureOptionsByCategory[product.category] ?? getCategoryFeatureOptions(product.category)
    : [];

  const syncAdditionalFeatures = (nextSelected: string[]) => {
    setSelectedFeatureOptions(nextSelected);
    const nextHtml = buildAdditionalFeaturesHtml(nextSelected);
    setProduct((prev) => (prev ? { ...prev, additionalfeatures: nextHtml } : prev));
  };

  const handleCategorySelection = async (nextCategory: string) => {
    if (!product) return;
    await handleChange("category", nextCategory);
    setNewFeatureOption("");
    const nextOptions = featureOptionsByCategory[nextCategory] ?? getCategoryFeatureOptions(nextCategory);
    const filteredSelected = selectedFeatureOptions.filter((item) => nextOptions.includes(item));
    syncAdditionalFeatures(filteredSelected);
  };

  const handleFeatureToggle = (feature: string) => {
    const exists = selectedFeatureOptions.includes(feature);
    const nextSelected = exists
      ? selectedFeatureOptions.filter((item) => item !== feature)
      : [...selectedFeatureOptions, feature];
    syncAdditionalFeatures(nextSelected);
  };

  const handleAddFeatureOption = () => {
    if (!product?.category) return;
    const nextFeature = newFeatureOption.trim();
    if (!nextFeature) return;

    const nextOptions = mergeFeatureOptions(selectedCategoryFeatures, [nextFeature]);
    setFeatureOptionsByCategory((prev) => ({
      ...prev,
      [product.category!]: nextOptions,
    }));
    setNewFeatureOption("");

    if (!selectedFeatureOptions.includes(nextFeature)) {
      syncAdditionalFeatures([...selectedFeatureOptions, nextFeature]);
    }
  };

  const handleRemoveFeatureOption = (feature: string) => {
    if (!product?.category) return;
    setFeatureOptionsByCategory((prev) => ({
      ...prev,
      [product.category!]: (prev[product.category!] ?? []).filter((item) => item !== feature),
    }));
    syncAdditionalFeatures(selectedFeatureOptions.filter((item) => item !== feature));
  };

  const getUpdateValidation = (): { tab: ProductFormTabKey; message: string } | null => {
    if (!product) return { tab: "identity", message: "Product data not loaded. Please try again." };
    if (!String(product.name || "").trim()) {
      return { tab: "identity", message: "Product code is required before saving the product." };
    }
    if (!String(product.fullproductname || "").trim()) {
      return { tab: "identity", message: "Product name is required before saving the product." };
    }
    if (!stripRichText(product.description || "").trim()) {
      return { tab: "identity", message: "Product description is required before saving the product." };
    }
    if (!String(product.category || "").trim()) {
      return { tab: "classification", message: "Product category is required before saving the product." };
    }
    if (product.price === undefined || product.price === null || Number.isNaN(Number(product.price))) {
      return { tab: "details", message: "Price (PHP) is required before saving the product." };
    }
    if (product.inventory === undefined || product.inventory === null || Number.isNaN(Number(product.inventory))) {
      return { tab: "details", message: "Inventory is required before saving the product." };
    }
    return null;
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product || !originalProduct || !currentAdmin) {
      setMessage("Product data not loaded. Please try again.");
      return;
    }

    const validation = getUpdateValidation();
    if (validation) {
      setActiveTab(validation.tab);
      setMessage(validation.message);
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

    const oversizedFiles = files.filter((file) => file.size > IMAGE_MAX_FILE_SIZE_BYTES);
    const acceptedFiles = files.filter((file) => file.size <= IMAGE_MAX_FILE_SIZE_BYTES);

    if (oversizedFiles.length > 0) {
      setMessage(`Skipped ${oversizedFiles.length} image(s) above 6MB. Max image size is 6MB per file.`);
    }

    if (acceptedFiles.length === 0) return;

    setUploadingImages(true);
    setMessage("Uploading images...");

    try {
      const uploadedUrls: string[] = [];
      for (const file of acceptedFiles) {
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

      setMessage(`${acceptedFiles.length} image(s) uploaded successfully!`);
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
    if (file.size > IMAGE_MAX_FILE_SIZE_BYTES) {
      setMessage(`"${file.name}" exceeds 6MB. Max image size is 6MB per file.`);
      return;
    }

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

  const getCurrentSkyboxes = (): Partial<Record<SkyboxKey, string | null>> => {
    const raw = (product as any)?.skyboxes;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as any;
    return {};
  };

  const handleUploadSkybox = async (skyboxKey: WeatherKey, file: File) => {
    if (!currentAdmin || !product) return;
    setUploadingSkyboxes(true);
    setMessage(`Uploading ${skyboxKey} skybox...`);

    try {
      const url = await uploadFile(file, `skyboxes/${skyboxKey}`, productId);
      const current = getCurrentSkyboxes();
      const next = { ...current, [skyboxKey]: url };

      await handleChange('skyboxes', next);
      await persistSkyboxes(next);

      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'upload',
        entity_type: 'product_skybox',
        entity_id: product.id,
        page: 'UpdateProducts',
        details: `Uploaded ${skyboxKey} skybox for "${product.name}": ${file.name}`,
        metadata: {
          skyboxKey,
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

  const handleRemoveSkybox = async (skyboxKey: WeatherKey) => {
    if (!currentAdmin || !product) return;
    const current = getCurrentSkyboxes();
    if (!current[skyboxKey]) return;

    const next = { ...current, [skyboxKey]: null };
    await handleChange('skyboxes', next);
    await persistSkyboxes(next);

    await logActivity({
      admin_id: currentAdmin.id,
      admin_name: currentAdmin.username,
      action: 'delete',
      entity_type: 'product_skybox',
      entity_id: product.id,
      page: 'UpdateProducts',
      details: `Removed ${skyboxKey} skybox from "${product.name}"`,
      metadata: {
        skyboxKey,
        removedUrl: current[skyboxKey],
        productName: product.name,
        productId: product.id,
        adminAccount: currentAdmin.username,
        timestamp: new Date().toISOString()
      }
    });
  };

  const persistGlobalSkyboxDefaults = async (nextDefaults: GlobalSkyboxDefaults) => {
    const res = await fetch("/api/product-skybox-defaults", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaults: nextDefaults }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json?.error || "Failed to save global skybox defaults");
    }
    setGlobalSkyboxDefaults(json?.defaults || nextDefaults);
  };

  const handleGlobalSkyboxUpload = async (weatherKey: WeatherKey, file: File | null) => {
    setSavingGlobalSkybox(weatherKey);
    try {
      const nextDefaults = { ...globalSkyboxDefaults };
      if (file) {
        nextDefaults[weatherKey] = await uploadGlobalSkyboxFile(file, weatherKey);
      } else {
        nextDefaults[weatherKey] = null;
      }

      await persistGlobalSkyboxDefaults(nextDefaults);
      setMessage(file ? `${weatherKey} default skybox saved successfully.` : `${weatherKey} default skybox removed successfully.`);
    } catch (error) {
      console.error('Global skybox upload error:', error);
      setMessage(error instanceof Error ? error.message : 'Error saving global skybox default');
    } finally {
      setSavingGlobalSkybox(null);
    }
  };

  // Enhanced FBX file upload handler
  const handleFbxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !currentAdmin || !product) return;

    const rejectedType = files.filter((f) => !isAllowed3DFile(f));
    const oversizedFiles = files.filter(
      (f) => isAllowed3DFile(f) && f.size > MODEL_MAX_FILE_SIZE_BYTES
    );
    const accepted = files.filter(
      (f) => isAllowed3DFile(f) && f.size <= MODEL_MAX_FILE_SIZE_BYTES
    );

    const notices: string[] = [];
    if (rejectedType.length > 0) {
      notices.push(
        `Ignored ${rejectedType.length} unsupported file(s). Allowed: ${ALLOWED_3D_EXTENSIONS.map((x) => `.${x}`).join(", ")}`
      );
    }
    if (oversizedFiles.length > 0) {
      notices.push(`Skipped ${oversizedFiles.length} 3D file(s) above 10MB. Max 3D file size is 10MB per file.`);
    }
    if (notices.length > 0) {
      setMessage(notices.join(" "));
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
            rejectedFileNames: [...rejectedType, ...oversizedFiles].map((f) => f.name),
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
  const currentSkyboxes = getCurrentSkyboxes();
  const effectiveCurrentSkyboxes = mergeEffectiveSkyboxes(currentSkyboxes, globalSkyboxDefaults);
  const previewSkyboxSource = currentSkyboxes[previewWeather]
    ? `${previewWeather} custom skybox`
    : globalSkyboxDefaults[previewWeather]
    ? `${previewWeather} default skybox`
    : null;

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
                <span className="text-[11px] text-gray-500">
                  {previewSkyboxSource ? `Using ${previewSkyboxSource}.` : "No skybox set for this weather."}
                </span>
              </div>
            </div>

            <div className="flex-1 min-h-0 w-full">
              <ThreeDModelViewer
                modelUrls={currentFbxUrls}
                initialIndex={currentFbxIndex}
                weather={previewWeather}
                frameFinish={materialToFrameFinish(product.material)}
                productCategory={product?.category ?? product?.type ?? null}
                skyboxes={effectiveCurrentSkyboxes}
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
      
      <form onSubmit={handleUpdate} className="bg-white shadow rounded-lg p-6 space-y-6 max-w-5xl mx-auto text-black">
        <div className="grid gap-3 md:grid-cols-4">
          {PRODUCT_FORM_TABS.map((tab, index) => {
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-xl border px-4 py-3 text-left transition-all ${
                  isActive
                    ? "border-indigo-600 bg-indigo-600 text-white shadow-md"
                    : "border-gray-200 bg-white text-gray-800 hover:border-indigo-300"
                }`}
              >
                <div className="text-xs font-semibold uppercase tracking-[0.2em]">Step {index + 1}</div>
                <div className="mt-1 text-base font-bold">{tab.label}</div>
                <div className={`mt-1 text-xs ${isActive ? "text-indigo-100" : "text-gray-500"}`}>
                  {tab.description}
                </div>
              </button>
            );
          })}
        </div>

        {activeTab === "identity" && (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6">
            <h2 className="mb-4 text-xl font-semibold text-gray-900">Product Code, Name, and Description</h2>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block font-medium text-black">Product Code *</label>
                <input
                  type="text"
                  value={product.name}
                  onChange={(e) => handleChange("name", e.target.value)}
                  className="w-full rounded border px-3 py-2 text-black bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="mb-1 block font-medium text-black">Product Name *</label>
                <input
                  type="text"
                  value={product.fullproductname || ""}
                  onChange={(e) => handleChange("fullproductname", e.target.value)}
                  className="w-full rounded border px-3 py-2 text-black bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1 block font-medium text-black">Product Description *</label>
              <RichTextEditor
                value={String(product.description || "")}
                onChange={(next) => handleChange("description", next)}
              />
            </div>
          </div>
        )}

        {activeTab === "classification" && (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6">
            <h2 className="mb-4 text-xl font-semibold text-gray-900">Product Category and Additional Features</h2>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)]">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <label className="mb-2 block font-medium text-black">Product Category *</label>
                <select
                  value={product.category ?? ""}
                  onChange={(e) => handleCategorySelection(e.target.value)}
                  className="w-full rounded border px-3 py-2 text-black bg-white focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select Category</option>
                  {PRODUCT_CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Preloaded Additional Features</h3>
                    <p className="mt-1 text-xs text-gray-500">Checked items will appear as bullet points on the website product page.</p>
                  </div>
                  <div className="rounded-full bg-gray-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-gray-200">
                    {selectedFeatureOptions.length} selected
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input
                    type="text"
                    value={newFeatureOption}
                    onChange={(e) => setNewFeatureOption(e.target.value)}
                    placeholder={product.category ? "Create a new feature checkbox for this category" : "Select a category first"}
                    disabled={!product.category}
                    className="flex-1 rounded border px-3 py-2 text-sm text-black bg-white focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100 disabled:text-gray-400"
                  />
                  <button
                    type="button"
                    onClick={handleAddFeatureOption}
                    disabled={!product.category || !newFeatureOption.trim()}
                    className="rounded bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Add Feature
                  </button>
                </div>

                {product.category ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {selectedCategoryFeatures.map((feature) => {
                      const checked = selectedFeatureOptions.includes(feature);
                      return (
                        <div
                          key={feature}
                          className={`flex items-start gap-3 rounded-lg border p-3 text-sm transition ${
                            checked
                              ? "border-indigo-600 bg-indigo-50"
                              : "border-gray-200 bg-gray-50 hover:border-indigo-300"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleFeatureToggle(feature)}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                            <span className="text-gray-700">{feature}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveFeatureOption(feature)}
                              className="shrink-0 rounded px-2 py-1 text-[11px] font-semibold text-red-600 transition hover:bg-red-50"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-500">
                    Select a category first to load the matching feature checkboxes.
                  </div>
                )}

                <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-2 text-sm font-semibold text-gray-900">Website Preview</div>
                  {product.additionalfeatures ? (
                    <div
                      className="blog-content text-sm text-gray-700"
                      dangerouslySetInnerHTML={{ __html: product.additionalfeatures }}
                    />
                  ) : (
                    <div className="text-sm text-gray-500">No additional features selected yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "details" && (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6">
            <h2 className="mb-4 text-xl font-semibold text-gray-900">Product Details</h2>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
              <div className="xl:col-span-2">
                <label className="mb-1 block font-medium text-black">Price (PHP) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={product.price}
                  onChange={(e) => handleChange("price", Number(e.target.value))}
                  className="w-full rounded border px-3 py-2 text-black bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="xl:col-span-2">
                <label className="mb-1 block font-medium text-black">Inventory *</label>
                <input
                  type="number"
                  value={product.inventory ?? ""}
                  onChange={(e) => handleChange("inventory", Number(e.target.value))}
                  className="w-full rounded border px-3 py-2 text-black bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-500 xl:col-span-1">
                Height, width, and thickness are optional but useful for 3D scaling.
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block font-medium text-black">Height</label>
                <input
                  type="number"
                  step="0.01"
                  value={product.height || ""}
                  onChange={(e) => handleChange("height", Number(e.target.value) || undefined)}
                  className="w-full rounded border px-3 py-2 text-black bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block font-medium text-black">Width</label>
                <input
                  type="number"
                  step="0.01"
                  value={product.width || ""}
                  onChange={(e) => handleChange("width", Number(e.target.value) || undefined)}
                  className="w-full rounded border px-3 py-2 text-black bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block font-medium text-black">Thickness</label>
                <input
                  type="number"
                  step="0.01"
                  value={product.thickness || ""}
                  onChange={(e) => handleChange("thickness", Number(e.target.value) || undefined)}
                  className="w-full rounded border px-3 py-2 text-black bg-white focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === "files" && (
          <div className="space-y-6 rounded-2xl border border-gray-200 bg-gray-50 p-6">
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="mb-4 text-xl font-semibold text-gray-900">
                3D Models Management ({currentFbxUrls.length} files)
              </h2>

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
                  Select multiple 3D model files to upload. Maximum 10MB per file.
                </div>
              </div>

              {uploadingFbx && (
                <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-800">
                  <div className="flex items-center">
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-blue-600"></div>
                    Uploading 3D model files...
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {currentFbxUrls.map((url, index) => (
                  <div key={index} className="flex items-center justify-between rounded-lg border bg-gray-50 p-3">
                    <div className="flex-1">
                      <div className="text-sm font-medium">3D Model {index + 1}</div>
                      <a 
                        href={url} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-xs break-all text-blue-600 underline"
                      >
                        {url.split('/').pop() || url}
                      </a>
                    </div>
                    <div className="ml-4 flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => handleOpen3DViewer(index)}
                        className="rounded bg-blue-600 px-3 py-1 text-sm text-white transition-colors hover:bg-blue-700"
                      >
                        View 3D
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveFbx(url, index)}
                        className="rounded bg-red-600 px-3 py-1 text-sm text-white transition-colors hover:bg-red-700"
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
                    className="rounded-lg bg-blue-600 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-700"
                  >
                    View All 3D Models ({currentFbxUrls.length})
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="mb-4 text-xl font-semibold text-gray-900">
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
                  You can upload any number of images. Maximum 6MB per file.
                </div>
              </div>

              {uploadingImages && (
                <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-800">
                  <div className="flex items-center">
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-blue-600"></div>
                    Uploading images...
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {getCurrentImages().map((url, index) => (
                  <div key={index} className="flex items-center justify-between rounded-lg border bg-gray-50 p-3">
                    <div className="flex flex-1 items-center gap-3">
                      <img src={url} alt={`Image ${index + 1}`} className="h-20 w-20 rounded border object-cover" />
                      <div className="flex-1">
                        <div className="text-sm font-medium">Image {index + 1}</div>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs break-all text-blue-600 underline"
                        >
                          {url.split('/').pop() || url}
                        </a>
                      </div>
                    </div>
                    <div className="ml-4 flex items-center space-x-2">
                      <label className="cursor-pointer rounded bg-indigo-600 px-3 py-1 text-sm text-white transition-colors hover:bg-indigo-700">
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
                        className="rounded bg-red-600 px-3 py-1 text-sm text-white transition-colors hover:bg-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="mb-2 text-xl font-semibold text-gray-900">Default & Custom Skyboxes</h2>
              <div className="mb-4 text-sm text-gray-500">
                Manage shared weather defaults for every product, then add product-specific overrides only when this item needs a custom skybox. Product custom skyboxes always take priority.
              </div>

              {uploadingSkyboxes && (
                <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-800">
                  <div className="flex items-center">
                    <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-blue-600"></div>
                    Uploading skybox...
                  </div>
                </div>
              )}

              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Global Default Skyboxes</div>
              <div className="space-y-2 mb-5">
                {WEATHER_KEYS.map((weatherKey) => {
                  const url = globalSkyboxDefaults[weatherKey] || null;
                  return (
                    <div key={`global-${weatherKey}`} className="flex items-center justify-between rounded-lg border bg-gray-50 p-3">
                      <div className="flex flex-1 items-center gap-3">
                        <div className="flex h-16 w-28 items-center justify-center overflow-hidden rounded border bg-white">
                          {url ? (
                            <img src={url} alt={`${weatherKey} default skybox`} className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-xs text-gray-400">No skybox</span>
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-medium capitalize">{weatherKey} default</div>
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs break-all text-blue-600 underline"
                            >
                              {url.split('/').pop() || url}
                            </a>
                          ) : (
                            <div className="text-xs text-gray-500">Used by every product that does not have a custom {weatherKey} skybox.</div>
                          )}
                        </div>
                      </div>

                      <div className="ml-4 flex items-center space-x-2">
                        <label className="cursor-pointer rounded bg-indigo-600 px-3 py-1 text-sm text-white transition-colors hover:bg-indigo-700">
                          {url ? 'Replace' : 'Upload'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0] || null;
                              void handleGlobalSkyboxUpload(weatherKey, f);
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => void handleGlobalSkyboxUpload(weatherKey, null)}
                          disabled={!url || savingGlobalSkybox === weatherKey}
                          className="rounded bg-red-600 px-3 py-1 text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                        >
                          {savingGlobalSkybox === weatherKey ? 'Saving…' : 'Remove'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Custom Product Skyboxes by Weather</div>
              <div className="space-y-2">
                {WEATHER_KEYS.map((weatherKey) => {
                  const url = currentSkyboxes?.[weatherKey] || null;
                  return (
                    <div key={weatherKey} className="flex items-center justify-between rounded-lg border bg-gray-50 p-3">
                      <div className="flex flex-1 items-center gap-3">
                        <div className="flex h-16 w-28 items-center justify-center overflow-hidden rounded border bg-white">
                          {url ? (
                            <img src={url} alt={`${weatherKey} skybox`} className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-xs text-gray-400">No skybox</span>
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm font-medium capitalize">{weatherKey}</div>
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs break-all text-blue-600 underline"
                            >
                              {url.split('/').pop() || url}
                            </a>
                          ) : (
                            <div className="text-xs text-gray-500">Upload an image to override the shared {weatherKey} default for this product.</div>
                          )}
                        </div>
                      </div>

                      <div className="ml-4 flex items-center space-x-2">
                        <label className="cursor-pointer rounded bg-indigo-600 px-3 py-1 text-sm text-white transition-colors hover:bg-indigo-700">
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
                          className="rounded bg-red-600 px-3 py-1 text-sm text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

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

async function uploadGlobalSkyboxFile(file: File, weatherKey: WeatherKey): Promise<string> {
  const safeFileName = file.name.replace(/[^a-z0-9.\-_]/gi, "_");
  const objectPath = `skyboxes/defaults/${weatherKey}_${Date.now()}_${safeFileName}`;

  const { data, error } = await supabase.storage
    .from("products")
    .upload(objectPath, file, { upsert: true });

  if (error) throw error;

  const { data: urlData } = await supabase.storage
    .from("products")
    .getPublicUrl(data.path);

  return urlData.publicUrl;
}
