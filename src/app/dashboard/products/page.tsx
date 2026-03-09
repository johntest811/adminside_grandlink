"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import { v4 as uuidv4 } from 'uuid';
import { logActivity } from "@/app/lib/activity";
import { createNotification } from "@/app/lib/notifications";
import ThreeDModelViewer from "@/components/ThreeDModelViewer";
import RichTextEditor from "@/components/RichTextEditor";
import ToastPopup, { type ToastPopupState } from "@/components/ToastPopup";
import {
  createEmptyGlobalSkyboxDefaults,
  mergeEffectiveSkyboxes,
  WEATHER_KEYS,
  type GlobalSkyboxDefaults,
  type WeatherKey,
} from "@/app/lib/skyboxDefaults";
import {
  buildAdditionalFeaturesHtml,
  createFeatureOptionsByCategory,
  getCategoryFeatureOptions,
  mergeFeatureOptions,
  PRODUCT_CATEGORY_OPTIONS,
  PRODUCT_FORM_TABS,
  type ProductFormTabKey,
  stripRichText,
} from "./productFormConfig";

const ALLOWED_3D_EXTENSIONS = ["fbx", "glb", "gltf"] as const;

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

const uploadFile = async (file: File, folder: string) => {
  const fileExt = file.name.split('.').pop();
  const fileName = `${uuidv4()}.${fileExt}`;
  const { error } = await supabase.storage
    .from('products')
    .upload(`${folder}/${fileName}`, file);

  if (error) throw error;
  return supabase.storage.from('products').getPublicUrl(`${folder}/${fileName}`).data.publicUrl;
};

const uploadFilesSettled = async (files: File[], folder: string) => {
  const settled = await Promise.allSettled(files.map((file) => uploadFile(file, folder)));
  const urls: string[] = [];
  const failedFiles: string[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      urls.push(result.value);
      return;
    }
    failedFiles.push(files[index]?.name || `file-${index + 1}`);
  });

  return { urls, failedFiles };
};

export default function ProductsAdminPage() {
  const explicitSubmitRef = useRef(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fullProductName, setFullProductName] = useState("");
  const [additionalFeatures, setAdditionalFeatures] = useState("");
  const [price, setPrice] = useState("");
  const [inventory, setInventory] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);
  const [fbxFiles, setFbxFiles] = useState<File[]>([]);
  const [modelPreviewUrls, setModelPreviewUrls] = useState<string[]>([]);
  const [skyboxFiles, setSkyboxFiles] = useState<Partial<Record<WeatherKey, File | null>>>({});
  const [skyboxPreviewUrls, setSkyboxPreviewUrls] = useState<Partial<Record<WeatherKey, string>>>({});
  const [globalSkyboxDefaults, setGlobalSkyboxDefaults] = useState<GlobalSkyboxDefaults>(() => createEmptyGlobalSkyboxDefaults());
  const [savingGlobalSkybox, setSavingGlobalSkybox] = useState<WeatherKey | null>(null);
  const [previewWeather, setPreviewWeather] = useState<WeatherKey>("sunny");
  const skyboxPreviewUrlsRef = useRef<Partial<Record<WeatherKey, string>>>({});
  const [show3DViewer, setShow3DViewer] = useState(false);
  const [currentFbxIndex, setCurrentFbxIndex] = useState(0);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [category, setCategory] = useState("");
  const [height, setHeight] = useState("");
  const [width, setWidth] = useState("");
  const [thickness, setThickness] = useState("");
  const [activeTab, setActiveTab] = useState<ProductFormTabKey>("identity");
  const [furthestTabIndex, setFurthestTabIndex] = useState(0);
  const [selectedFeatureOptions, setSelectedFeatureOptions] = useState<string[]>([]);
  const [featureOptionsByCategory, setFeatureOptionsByCategory] = useState<Record<string, string[]>>(() => createFeatureOptionsByCategory());
  const [newFeatureOption, setNewFeatureOption] = useState("");
  const [toast, setToast] = useState<ToastPopupState>({
    open: false,
    type: "info",
    title: "",
    message: "",
  });
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);

  const showToast = (next: Omit<ToastPopupState, "open">) => {
    setToast({ open: true, ...next });
  };

  useEffect(() => {
    skyboxPreviewUrlsRef.current = skyboxPreviewUrls;
  }, [skyboxPreviewUrls]);

  useEffect(() => {
    return () => {
      try {
        Object.values(skyboxPreviewUrlsRef.current).forEach((u) => u && URL.revokeObjectURL(u));
      } catch {}
    };
  }, []);

  useEffect(() => {
    const urls = fbxFiles.map((f) => URL.createObjectURL(f));
    setModelPreviewUrls(urls);

    return () => {
      try {
        urls.forEach((u) => URL.revokeObjectURL(u));
      } catch {}
    };
  }, [fbxFiles]);

  useEffect(() => {
    const urls = images.map((f) => URL.createObjectURL(f));
    setImagePreviewUrls(urls);

    return () => {
      try {
        urls.forEach((u) => URL.revokeObjectURL(u));
      } catch {}
    };
  }, [images]);

  // Convert message updates into unified toasts
  useEffect(() => {
    if (!message) return;
    const lower = message.toLowerCase();
    if (lower.includes("error") || lower.includes("failed")) {
      showToast({ type: "error", title: "Error", message });
      return;
    }
    if (lower.includes("success")) {
      showToast({ type: "success", title: "Saved", message });
      return;
    }
    showToast({ type: "info", title: "Notice", message });
  }, [message]);

  // Load current admin
  useEffect(() => {
    const loadAdmin = async () => {
      try {
        console.log("🔍 Loading current admin...");
        
        const sessionData = localStorage.getItem('adminSession');
        if (sessionData) {
          const admin = JSON.parse(sessionData);
          setCurrentAdmin(admin);
          console.log("✅ Admin loaded:", admin);
          
          try {
            await logActivity({
              admin_id: admin.id,
              admin_name: admin.username,
              action: 'view',
              entity_type: 'page',
              details: `Accessed Add Products page`,
              page: 'products',
              metadata: {
                pageAccess: true,
                adminAccount: admin.username,
                timestamp: new Date().toISOString()
              }
            });
          } catch (activityError) {
            console.error("Failed to log activity:", activityError);
          }
          return;
        }
        
        const { data: sessionUser } = await supabase.auth.getUser();
        if (!sessionUser?.user?.id) {
          console.warn("⚠️ No user session found");
          const defaultAdmin = {
            id: 'admin-default',
            username: 'Admin User',
            role: 'admin'
          };
          setCurrentAdmin(defaultAdmin);
          localStorage.setItem('adminSession', JSON.stringify(defaultAdmin));
          return;
        }
        
        const userId = sessionUser.user.id;
        const { data: adminRows } = await supabase
          .from("admins")
          .select("*")
          .eq("id", userId);
        
        if (!adminRows || adminRows.length === 0) {
          const { data: newAdmin, error: createError } = await supabase
            .from("admins")
            .insert({
              id: userId,
              username: sessionUser.user.email?.split('@')[0] || 'Admin',
              role: 'admin',
              position: 'Admin',
              created_at: new Date().toISOString()
            })
            .select()
            .single();
          
          if (!createError && newAdmin) {
            setCurrentAdmin(newAdmin);
            console.log("✅ Created and loaded new admin:", newAdmin);
          }
        } else {
          const admin = adminRows[0];
          setCurrentAdmin(admin);
          console.log("✅ Admin loaded from database:", admin);
        }
        
      } catch (e) {
        console.error("💥 Load admin exception:", e);
        const fallbackAdmin = {
          id: 'admin-fallback',
          username: 'Admin User',
          role: 'admin'
        };
        setCurrentAdmin(fallbackAdmin);
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

  const handleSingleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    // Allow unlimited images by appending without slicing
    const newImages = [...images, ...files];
    setImages(newImages);
    setCarouselIndex(0);
    
    if (currentAdmin) {
      try {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'upload',
          entity_type: 'product_images',
          details: `Added ${files.length} product image(s). Total: ${newImages.length}`,
          page: 'products',
          metadata: {
            addedCount: files.length,
            totalCount: newImages.length,
            fileNames: files.map(f => f.name),
            totalSize: files.reduce((sum, f) => sum + f.size, 0),
            adminAccount: currentAdmin.username
          }
        });
      } catch (error) {
        console.error("Failed to log image upload:", error);
      }
    }
  };

  const removeImage = async (index: number) => {
    const removedImage = images[index];
    const newImages = images.filter((_, i) => i !== index);
    setImages(newImages);
    
    if (carouselIndex >= newImages.length && newImages.length > 0) {
      setCarouselIndex(Math.max(0, newImages.length - 3));
    }
    
    if (currentAdmin) {
      try {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'delete',
          entity_type: 'product_image',
          details: `Removed product image: ${removedImage.name}`,
          page: 'products',
          metadata: {
            fileName: removedImage.name,
            removedIndex: index + 1,
            remainingCount: newImages.length,
            adminAccount: currentAdmin.username
          }
        });
      } catch (error) {
        console.error("Failed to log image removal:", error);
      }
    }
  };

  const handleSingleFbxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const accepted = files.filter(isAllowed3DFile);
    const rejected = files.filter((f) => !isAllowed3DFile(f));
    if (rejected.length > 0) {
      setMessage(
        `Ignored ${rejected.length} unsupported file(s). Allowed: ${ALLOWED_3D_EXTENSIONS.map((x) => `.${x}`).join(", ")}`
      );
    }
    if (accepted.length === 0) return;

    const newFbxFiles = [...fbxFiles, ...accepted];
    setFbxFiles(newFbxFiles);

    if (currentAdmin) {
      try {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'upload',
          entity_type: '3d_model_files',
          details: `Added ${accepted.length} 3D model file(s). Total: ${newFbxFiles.length}`,
          page: 'products',
          metadata: {
            addedCount: accepted.length,
            totalCount: newFbxFiles.length,
            fileNames: accepted.map(f => f.name),
            rejectedFileNames: rejected.map(f => f.name),
            adminAccount: currentAdmin.username
          }
        });
      } catch (error) {
        console.error("Failed to log 3D upload:", error);
      }
    }
  };

  const handleSkyboxSelect = async (skyboxKey: WeatherKey, file: File | null) => {
    setSkyboxFiles((prev) => ({ ...prev, [skyboxKey]: file }));

    setSkyboxPreviewUrls((prev) => {
      const next = { ...prev };
      const prevUrl = next[skyboxKey];
      if (prevUrl) {
        try { URL.revokeObjectURL(prevUrl); } catch {}
      }
      if (file) {
        try {
          next[skyboxKey] = URL.createObjectURL(file);
        } catch {
          delete next[skyboxKey];
        }
      } else {
        delete next[skyboxKey];
      }
      return next;
    });

    if (currentAdmin) {
      try {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: file ? 'upload' : 'delete',
          entity_type: 'product_skybox',
          details: file
            ? `Selected ${skyboxKey} skybox file: ${file.name}`
            : `Cleared ${skyboxKey} skybox selection`,
          page: 'products',
          metadata: {
            skyboxKey,
            fileName: file?.name || null,
            fileSize: file?.size || null,
            adminAccount: currentAdmin.username
          }
        });
      } catch (error) {
        console.error("Failed to log skybox selection:", error);
      }
    }
  };

  const persistGlobalSkyboxDefaults = async (nextDefaults: GlobalSkyboxDefaults) => {
    const res = await fetch("/api/product-skybox-defaults", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaults: nextDefaults }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Failed to save global skybox defaults");
    setGlobalSkyboxDefaults(json?.defaults || nextDefaults);
  };

  const handleGlobalSkyboxUpload = async (weatherKey: WeatherKey, file: File | null) => {
    setSavingGlobalSkybox(weatherKey);
    try {
      const nextDefaults = { ...globalSkyboxDefaults };
      if (file) {
        nextDefaults[weatherKey] = await uploadFile(file, `skyboxes/defaults/${weatherKey}`);
      } else {
        nextDefaults[weatherKey] = null;
      }

      await persistGlobalSkyboxDefaults(nextDefaults);
      setMessage(file ? `${weatherKey} default skybox saved successfully.` : `${weatherKey} default skybox removed successfully.`);
    } catch (error) {
      console.error("Failed to save global skybox default", error);
      setMessage(error instanceof Error ? `Error: ${error.message}` : "Error saving global skybox default");
    } finally {
      setSavingGlobalSkybox(null);
    }
  };

  const removeFbxFile = async (index: number) => {
    const removedFile = fbxFiles[index];
    setFbxFiles(prev => prev.filter((_, i) => i !== index));
    
    if (currentAdmin) {
      try {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'delete',
          entity_type: '3d_model_file',
          details: `Removed 3D model file: ${removedFile.name}`,
          page: 'products',
          metadata: {
            fileName: removedFile.name,
            fileType: getFileExtension(removedFile.name),
            removedIndex: index + 1,
            remainingCount: fbxFiles.length - 1,
            adminAccount: currentAdmin.username
          }
        });
      } catch (error) {
        console.error("Failed to log 3D removal:", error);
      }
    }
  };

  const handleOpen3DViewer = async (index: number = 0) => {
    if (fbxFiles.length > 0 && index < fbxFiles.length) {
      setCurrentFbxIndex(index);
      setShow3DViewer(true);
      
      if (currentAdmin) {
        try {
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: 'view',
            entity_type: '3d_model',
            details: `Opened 3D viewer for file: ${fbxFiles[index].name} (${index + 1}/${fbxFiles.length})`,
            page: 'products',
            metadata: {
              fileName: fbxFiles[index].name,
              fileSize: fbxFiles[index].size,
              fileType: getFileExtension(fbxFiles[index].name),
              fileIndex: index + 1,
              totalFiles: fbxFiles.length,
              adminAccount: currentAdmin.username
            }
          });
        } catch (error) {
          console.error("Failed to log 3D viewer usage:", error);
        }
      }
    }
  };

  const selectedCategoryFeatures = category
    ? featureOptionsByCategory[category] ?? getCategoryFeatureOptions(category)
    : [];
  const activeTabIndex = PRODUCT_FORM_TABS.findIndex((tab) => tab.key === activeTab);

  const syncAdditionalFeatures = (nextSelected: string[]) => {
    setSelectedFeatureOptions(nextSelected);
    setAdditionalFeatures(buildAdditionalFeaturesHtml(nextSelected));
  };

  const handleCategoryChange = (nextCategory: string) => {
    setCategory(nextCategory);
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
    const nextFeature = newFeatureOption.trim();
    if (!category || !nextFeature) return;

    const nextOptions = mergeFeatureOptions(selectedCategoryFeatures, [nextFeature]);
    setFeatureOptionsByCategory((prev) => ({
      ...prev,
      [category]: nextOptions,
    }));
    setNewFeatureOption("");

    if (!selectedFeatureOptions.includes(nextFeature)) {
      syncAdditionalFeatures([...selectedFeatureOptions, nextFeature]);
    }
  };

  const handleRemoveFeatureOption = (feature: string) => {
    if (!category) return;
    setFeatureOptionsByCategory((prev) => ({
      ...prev,
      [category]: (prev[category] ?? []).filter((item) => item !== feature),
    }));
    syncAdditionalFeatures(selectedFeatureOptions.filter((item) => item !== feature));
  };

  const getCreateStepValidationMessage = (tab: ProductFormTabKey): string | null => {
    if (tab === "identity") {
      if (!name.trim()) return "Product code is required before moving to the next tab.";
      if (!fullProductName.trim()) return "Product name is required before moving to the next tab.";
      if (!stripRichText(description).trim()) return "Product description is required before moving to the next tab.";
    }

    if (tab === "classification") {
      if (!category.trim()) return "Product category is required before moving to the next tab.";
    }

    if (tab === "details") {
      if (price === "" || Number.isNaN(Number(price))) {
        return "Price (PHP) is required before moving to the next tab.";
      }
      if (inventory === "" || Number.isNaN(Number(inventory))) {
        return "Inventory is required before moving to the next tab.";
      }
    }

    return null;
  };

  const handleNextTab = () => {
    const validationMessage = getCreateStepValidationMessage(activeTab);
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    const nextIndex = Math.min(activeTabIndex + 1, PRODUCT_FORM_TABS.length - 1);
    setFurthestTabIndex((prev) => Math.max(prev, nextIndex));
    setActiveTab(PRODUCT_FORM_TABS[nextIndex].key);
  };

  const handleBackTab = () => {
    const nextIndex = Math.max(activeTabIndex - 1, 0);
    setActiveTab(PRODUCT_FORM_TABS[nextIndex].key);
  };

  const openUnlockedTab = (tabKey: ProductFormTabKey) => {
    const nextIndex = PRODUCT_FORM_TABS.findIndex((tab) => tab.key === tabKey);
    if (nextIndex <= furthestTabIndex) {
      setActiveTab(tabKey);
    }
  };

  // Enhanced product creation with API call for notifications
  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!explicitSubmitRef.current) {
      setMessage("Review the final step, then click Add Product to create the product.");
      return;
    }

    explicitSubmitRef.current = false;
    setMessage("");
    setLoading(true);
    
    try {
      console.log("🚀 Starting product creation...");
      
      if (!currentAdmin) {
        throw new Error("Admin information not available. Please refresh the page.");
      }
      
      try {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'create',
          entity_type: 'product_form_submission',
          details: `Initiated product creation for "${name}" in category "${category}"`,
          page: 'products',
          metadata: {
            productName: name,
            category,
            price: Number(price) || 0,
            inventory: Number(inventory) || 0,
            hasImages: images.length > 0,
            hasFbx: fbxFiles.length > 0,
            hasSkyboxes: WEATHER_KEYS.some((k) => !!skyboxFiles[k]),
            fbxCount: fbxFiles.length,
            adminAccount: currentAdmin.username
          }
        });
      } catch (error) {
        console.error("Failed to log form submission:", error);
      }

      for (const tab of ["identity", "classification", "details"] as ProductFormTabKey[]) {
        const validationMessage = getCreateStepValidationMessage(tab);
        if (validationMessage) {
          setActiveTab(tab);
          setFurthestTabIndex((prev) => Math.max(prev, PRODUCT_FORM_TABS.findIndex((item) => item.key === tab)));
          throw new Error(validationMessage);
        }
      }
      
      // Upload assets in parallel to reduce submission time
      const [imagesUpload, modelsUpload, ...skyboxUploads] = await Promise.all([
        uploadFilesSettled(images, 'images'),
        uploadFilesSettled(fbxFiles, 'models'),
        ...WEATHER_KEYS.map((k) => {
          const f = skyboxFiles[k];
          return f ? uploadFile(f, `skyboxes/${k}`) : Promise.resolve(null);
        }),
      ]);

      const imageUrls = imagesUpload.urls;
      const fbxUploadedUrls = modelsUpload.urls;

      const skyboxes: Partial<Record<WeatherKey, string>> = {};
      WEATHER_KEYS.forEach((k, index) => {
        const url = skyboxUploads[index];
        if (url) skyboxes[k] = url;
      });

      if (imagesUpload.failedFiles.length || modelsUpload.failedFiles.length) {
        const totalFailed = imagesUpload.failedFiles.length + modelsUpload.failedFiles.length;
        setMessage(`Uploaded with ${totalFailed} failed file(s). Product creation continues.`);
      }

      console.log("📦 Creating product in database...");

      // Prepare the product data
      const productData: any = {
        name: name.trim(),
        fullproductname: fullProductName.trim() || null,
        additionalfeatures: additionalFeatures.trim() || null,
        description: description.trim() || null,
        price: Number(price) || 0,
        inventory: Number(inventory) || 0,
        category: category.trim(),
        height: height ? Number(height) : null,
        width: width ? Number(width) : null,
        thickness: thickness ? Number(thickness) : null,
        images: imageUrls,
        fbx_url: fbxUploadedUrls.length > 0 ? fbxUploadedUrls[0] : null,
        fbx_urls: fbxUploadedUrls.length > 0 ? fbxUploadedUrls : null,
        skyboxes: Object.keys(skyboxes).length ? skyboxes : null
      };

      // Backward-compat: keep legacy image1..image5 fields populated
      productData.image1 = imageUrls[0] || null;
      productData.image2 = imageUrls[1] || null;
      productData.image3 = imageUrls[2] || null;
      productData.image4 = imageUrls[3] || null;
      productData.image5 = imageUrls[4] || null;

      // OLD (remove):
      // const { data: insertedProduct, error: insertError } = await supabase
      //   .from('products')
      //   .insert(productData)
      //   .select()
      //   .single();
      // if (insertError) throw new Error(insertError.message);

      // NEW: call server API (uses service role)
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // pass admin info for logging (your API already reads this)
          authorization: JSON.stringify(currentAdmin || {})
        },
        body: JSON.stringify(productData),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to create product');
      const insertedProduct = json.product;

      console.log("✅ Product created successfully:", insertedProduct);

      // Create admin notification
      try {
        await createNotification({
          title: "New Product Added",
          message: `Product "${insertedProduct.name}" has been successfully added to the inventory.`,
          type: "stock",
          priority: "medium",
          recipient_role: "admin"
        });
        console.log("✅ Admin notification created");
      } catch (notifError) {
        console.error("⚠️ Failed to create admin notification:", notifError);
      }

      setMessage(`Product "${insertedProduct.name}" added successfully!`);
      
      // Reset form
      setName("");
      setFullProductName("");
      setDescription("");
      setAdditionalFeatures("");
      setPrice("");
      setInventory("0");
      setImages([]);
      setFbxFiles([]);
      setSkyboxFiles({});
      setSkyboxPreviewUrls({});
      setHeight("");
      setWidth("");
      setThickness("");
      setCategory("");
      setSelectedFeatureOptions([]);
      setFeatureOptionsByCategory(createFeatureOptionsByCategory());
      setNewFeatureOption("");
      setActiveTab("identity");
      setFurthestTabIndex(0);
      setCarouselIndex(0);
      
    } catch (err: any) {
      console.error("💥 Product creation failed:", err);
      setMessage(`Error: ${err.message}`);
    } finally {
      explicitSubmitRef.current = false;
      setLoading(false);
    }
  };

  const getCarouselImages = () => {
    if (images.length <= 3) return images;
    if (carouselIndex + 3 <= images.length) {
      return images.slice(carouselIndex, carouselIndex + 3);
    }
    return [
      ...images.slice(carouselIndex),
      ...images.slice(0, 3 - (images.length - carouselIndex))
    ];
  };

  const handlePrev = () =>
    setCarouselIndex((i) =>
      i === 0 ? Math.max(images.length - 3, 0) : i - 1
    );
  const handleNext = () =>
    setCarouselIndex((i) =>
      i + 3 >= images.length ? 0 : i + 1
    );

  const effectivePreviewSkyboxes = mergeEffectiveSkyboxes(skyboxPreviewUrls, globalSkyboxDefaults);
  const previewSkyboxSource = skyboxPreviewUrls[previewWeather]
    ? `${previewWeather} custom skybox`
    : globalSkyboxDefaults[previewWeather]
    ? `${previewWeather} default skybox`
    : null;

  return (
    <div className="min-h-screen bg-[#e7eaef] flex items-center justify-center">
      <div className="max-w-5xl w-full p-8 rounded-lg shadow-lg bg-white/80 flex flex-col space-y-6">
        {/* Title */}
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold text-[#505A89] mb-2 tracking-tight">ADD PRODUCTS</h1>
          <div className="text-sm text-gray-600">
            {currentAdmin ? (
              <span className="text-green-600">✅ Admin: {currentAdmin.username || currentAdmin.id}</span>
            ) : (
              <span className="text-yellow-600">⏳ Loading admin...</span>
            )}
          </div>
        </div>

        {/* Success Popup */}
        <ToastPopup state={toast} onClose={() => setToast((prev) => ({ ...prev, open: false }))} />

        {/* 3D Viewer Modal */}
        {show3DViewer && modelPreviewUrls.length > 0 && (
          <div className="fixed inset-0 flex items-center justify-center z-50 bg-transparent">
            <div className="bg-white/95 backdrop-blur-md rounded-xl p-6 shadow-2xl relative w-[98vw] max-w-[1600px] h-[90vh] mx-2 flex flex-col">
              <button
                onClick={() => setShow3DViewer(false)}
                className="absolute top-3 right-3 text-gray-700 hover:text-black text-2xl font-bold z-10 bg-white rounded-full w-10 h-10 flex items-center justify-center shadow-md"
              >
                ×
              </button>
              
              <div className="mb-4 flex-none">
                <h2 className="text-lg font-bold text-[#233a5e] mb-2">3D Model Viewer</h2>
                <div className="text-sm text-gray-600 mb-2">Models: {modelPreviewUrls.length}</div>

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
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      {k.charAt(0).toUpperCase() + k.slice(1)}
                    </button>
                  ))}
                  <span className="text-[11px] text-gray-500">
                    {previewSkyboxSource ? `Using ${previewSkyboxSource}.` : "No skybox selected for this weather."}
                  </span>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <ThreeDModelViewer
                  modelUrls={modelPreviewUrls}
                  modelFileNames={fbxFiles.map((file) => file.name)}
                  initialIndex={currentFbxIndex}
                  weather={previewWeather}
                  frameFinish="matteBlack"
                  productCategory={category || null}
                  skyboxes={effectivePreviewSkyboxes}
                  productDimensions={{
                    width: width || null,
                    height: height || null,
                    thickness: thickness || null,
                    units: "cm",
                  }}
                />
              </div>
            </div>
          </div>
        )}
        
        <form onSubmit={handleAddProduct} className="space-y-6">
          <div className="grid gap-3 md:grid-cols-4">
            {PRODUCT_FORM_TABS.map((tab, index) => {
              const isActive = tab.key === activeTab;
              const isUnlocked = index <= furthestTabIndex;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => openUnlockedTab(tab.key)}
                  disabled={!isUnlocked}
                  className={`rounded-xl border px-4 py-3 text-left transition-all ${
                    isActive
                      ? "border-[#233a5e] bg-[#233a5e] text-white shadow-md"
                      : isUnlocked
                      ? "border-gray-200 bg-white text-[#233a5e] hover:border-[#233a5e]/40"
                      : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400"
                  }`}
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.2em]">Step {index + 1}</div>
                  <div className="mt-1 text-base font-bold">{tab.label}</div>
                  <div className={`mt-1 text-xs ${isActive ? "text-blue-100" : "text-gray-500"}`}>
                    {tab.description}
                  </div>
                </button>
              );
            })}
          </div>

          {activeTab === "identity" && (
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-[#233a5e]">Product Code, Name, and Description</h2>
                <p className="mt-2 text-sm text-gray-600">
                  Complete the required product identity fields before proceeding to the next tab.
                </p>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <label className="mb-1 block font-semibold text-[#233a5e]">Product Code <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    placeholder="Enter product code"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white p-3 text-black outline-none transition focus:border-[#233a5e] focus:ring-2 focus:ring-[#233a5e]/20"
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-[#233a5e]">Product Name <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    placeholder="Enter full product name"
                    value={fullProductName}
                    onChange={(e) => setFullProductName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white p-3 text-black outline-none transition focus:border-[#233a5e] focus:ring-2 focus:ring-[#233a5e]/20"
                  />
                </div>
              </div>

              <div className="mt-6">
                <label className="mb-2 block font-semibold text-[#233a5e]">Product Description <span className="text-red-500">*</span></label>
                <RichTextEditor value={description} onChange={setDescription} />
              </div>
            </div>
          )}

          {activeTab === "classification" && (
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-[#233a5e]">Product Category and Additional Features</h2>
                <p className="mt-2 text-sm text-gray-600">
                  Pick the product category, then select the preloaded feature bullets you want shown on the website.
                </p>
              </div>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <div className="rounded-xl border border-gray-200 bg-[#f8fafc] p-5">
                  <label className="mb-2 block font-semibold text-[#233a5e]">Product Category <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <select
                      className="w-full appearance-none rounded-lg border border-gray-300 bg-white p-3 pr-10 text-black outline-none transition focus:border-[#233a5e] focus:ring-2 focus:ring-[#233a5e]/20"
                      value={category}
                      onChange={(e) => handleCategoryChange(e.target.value)}
                    >
                      <option value="">Select Category</option>
                      {PRODUCT_CATEGORY_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">▼</span>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-[#f8fafc] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-[#233a5e]">Preloaded Additional Features</h3>
                      <p className="mt-1 text-xs text-gray-500">Checked items will be rendered as bullet points on the website product page.</p>
                    </div>
                    <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#233a5e] ring-1 ring-gray-200">
                      {selectedFeatureOptions.length} selected
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                    <input
                      type="text"
                      value={newFeatureOption}
                      onChange={(e) => setNewFeatureOption(e.target.value)}
                      placeholder={category ? "Create a new feature checkbox for this category" : "Select a category first"}
                      disabled={!category}
                      className="flex-1 rounded-lg border border-gray-300 bg-white p-3 text-sm text-black outline-none transition focus:border-[#233a5e] focus:ring-2 focus:ring-[#233a5e]/20 disabled:bg-gray-100 disabled:text-gray-400"
                    />
                    <button
                      type="button"
                      onClick={handleAddFeatureOption}
                      disabled={!category || !newFeatureOption.trim()}
                      className="rounded-lg bg-[#233a5e] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#1b2d49] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Add Feature
                    </button>
                  </div>

                  {category ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {selectedCategoryFeatures.map((feature) => {
                        const checked = selectedFeatureOptions.includes(feature);
                        return (
                          <div
                            key={feature}
                            className={`flex items-start gap-3 rounded-lg border p-3 text-sm transition ${
                              checked
                                ? "border-[#233a5e] bg-[#233a5e]/5"
                                : "border-gray-200 bg-white hover:border-[#233a5e]/30"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleFeatureToggle(feature)}
                              className="mt-1 h-4 w-4 rounded border-gray-300 text-[#233a5e] focus:ring-[#233a5e]"
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
                    <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-sm text-gray-500">
                      Select a category first to load the matching feature checkboxes.
                    </div>
                  )}

                  <div className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
                    <div className="mb-2 text-sm font-semibold text-[#233a5e]">Website Preview</div>
                    {additionalFeatures ? (
                      <div
                        className="blog-content text-sm text-gray-700"
                        dangerouslySetInnerHTML={{ __html: additionalFeatures }}
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
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-[#233a5e]">Product Details</h2>
                <p className="mt-2 text-sm text-gray-600">
                  Price and inventory are required. Height, width, and thickness are optional dimension references.
                </p>
              </div>

              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
                <div className="xl:col-span-2">
                  <label className="mb-1 block font-semibold text-[#233a5e]">Price (PHP) <span className="text-red-500">*</span></label>
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white p-3 text-black outline-none transition focus:border-[#233a5e] focus:ring-2 focus:ring-[#233a5e]/20"
                    placeholder="0.00"
                    min="0"
                  />
                </div>

                <div className="xl:col-span-2">
                  <label className="mb-1 block font-semibold text-[#233a5e]">Inventory <span className="text-red-500">*</span></label>
                  <input
                    type="number"
                    value={inventory}
                    onChange={(e) => setInventory(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white p-3 text-black outline-none transition focus:border-[#233a5e] focus:ring-2 focus:ring-[#233a5e]/20"
                    placeholder="Enter inventory quantity"
                    min="0"
                  />
                </div>

                <div className="rounded-xl border border-dashed border-gray-300 bg-[#f8fafc] px-4 py-3 text-sm text-gray-500 xl:col-span-1">
                  Optional dimensions help the 3D viewers scale the product more accurately.
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold text-[#233a5e]">Height</label>
                  <input
                    type="number"
                    value={height}
                    onChange={(e) => setHeight(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white p-3 text-black outline-none transition focus:border-[#233a5e] focus:ring-2 focus:ring-[#233a5e]/20"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#233a5e]">Width</label>
                  <input
                    type="number"
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white p-3 text-black outline-none transition focus:border-[#233a5e] focus:ring-2 focus:ring-[#233a5e]/20"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[#233a5e]">Thickness</label>
                  <input
                    type="number"
                    value={thickness}
                    onChange={(e) => setThickness(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white p-3 text-black outline-none transition focus:border-[#233a5e] focus:ring-2 focus:ring-[#233a5e]/20"
                    placeholder="Optional"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === "files" && (
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-[#233a5e]">Product Files</h2>
                <p className="mt-2 text-sm text-gray-600">
                  Upload optional product images, 3D models, and default or custom skyboxes. You can submit without these files.
                </p>
              </div>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                <div className="space-y-6">
                  <div className="rounded-xl border border-gray-200 bg-[#f8fafc] p-5">
                    <h3 className="text-md font-semibold text-[#233a5e] mb-2">
                      Product Images ({images.length})
                    </h3>

                    <div className="flex items-center space-x-2 mb-4">
                      <label
                        htmlFor="images-upload"
                        className="flex h-28 w-28 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-400 bg-white transition-colors hover:bg-gray-50"
                      >
                        <span className="text-2xl">+</span>
                        <span className="text-xs text-[#233a5e]">Add Image</span>
                        <span className="mt-1 text-[10px] text-gray-500">Unlimited</span>
                      </label>
                      <input
                        id="images-upload"
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleSingleImageUpload}
                        className="hidden"
                      />

                      {images.length > 0 && (
                        <div className="flex flex-wrap items-center space-x-2">
                          {getCarouselImages().map((_, idx) => {
                            const actualIndex = images.length
                              ? (carouselIndex + idx) % images.length
                              : carouselIndex + idx;
                            return (
                              <div key={actualIndex} className="relative">
                                <img
                                  src={imagePreviewUrls[actualIndex]}
                                  alt={`Product Image ${actualIndex + 1}`}
                                  className="h-20 w-20 rounded-lg border border-gray-300 object-cover"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeImage(actualIndex)}
                                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs text-white hover:bg-red-600"
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {images.length > 3 && (
                      <div className="flex justify-center space-x-2 mb-2">
                        <button
                          type="button"
                          onClick={handlePrev}
                          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
                        >
                          ←
                        </button>
                        <span className="px-2 py-1 text-sm text-gray-600">
                          {Math.floor(carouselIndex / 3) + 1} / {Math.ceil(images.length / 3)}
                        </span>
                        <button
                          type="button"
                          onClick={handleNext}
                          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700"
                        >
                          →
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-gray-200 bg-[#f8fafc] p-5">
                    <h3 className="text-md font-semibold text-[#233a5e] mb-2">
                      3D Models (.fbx, .glb, .gltf) ({fbxFiles.length} files)
                    </h3>

                    <label
                      htmlFor="fbx-upload"
                      className="mb-3 flex h-16 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-400 bg-white hover:bg-gray-50"
                    >
                      <span className="text-sm text-[#233a5e]">+ Add 3D Model Files</span>
                    </label>
                    <input
                      id="fbx-upload"
                      type="file"
                      accept=".fbx,.glb,.gltf"
                      multiple
                      onChange={handleSingleFbxUpload}
                      className="hidden"
                    />

                    {fbxFiles.length > 0 && (
                      <div className="max-h-40 space-y-2 overflow-y-auto">
                        {fbxFiles.map((file, index) => (
                          <div key={index} className="flex items-center justify-between rounded border bg-white p-2 text-xs">
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium text-[#233a5e]" title={file.name}>
                                {file.name}
                              </div>
                              <div className="text-gray-500">{(file.size / (1024 * 1024)).toFixed(2)} MB</div>
                            </div>
                            <div className="ml-2 flex items-center space-x-1">
                              <button
                                type="button"
                                onClick={() => handleOpen3DViewer(index)}
                                className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                              >
                                View 3D
                              </button>
                              <button
                                type="button"
                                onClick={() => removeFbxFile(index)}
                                className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      type="button"
                      className={`mt-4 w-full rounded px-4 py-2 font-semibold transition-colors ${
                        fbxFiles.length > 0
                          ? "cursor-pointer bg-blue-600 text-white hover:bg-blue-700"
                          : "cursor-not-allowed bg-gray-300 text-gray-500"
                      }`}
                      disabled={fbxFiles.length === 0}
                      onClick={() => handleOpen3DViewer(0)}
                    >
                      {fbxFiles.length === 0
                        ? "No 3D Model Files"
                        : `Open 3D Viewer (${fbxFiles.length} ${fbxFiles.length === 1 ? "model" : "models"})`}
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-[#f8fafc] p-5">
                  <h3 className="text-md font-semibold text-[#233a5e] mb-2">Default & Custom Skyboxes</h3>
                  <div className="mb-3 text-xs text-gray-500">
                    Set shared weather defaults for every product, then optionally add product-specific skyboxes that override those defaults for this item only.
                  </div>

                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Global Default Skyboxes</div>
                  <div className="grid grid-cols-1 gap-3 mb-5">
                    {WEATHER_KEYS.map((k) => (
                      <div key={`global-${k}`} className="flex items-center justify-between gap-3 rounded border bg-white p-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-16 items-center justify-center overflow-hidden rounded border bg-gray-50">
                            {globalSkyboxDefaults[k] ? (
                              <img src={globalSkyboxDefaults[k] || undefined} alt={`${k} default skybox`} className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-[10px] text-gray-400">No file</span>
                            )}
                          </div>
                          <div>
                            <div className="text-sm font-semibold capitalize text-[#233a5e]">{k} default</div>
                            <div className="text-[11px] text-gray-600">{globalSkyboxDefaults[k] ? "Used by every product without a custom override." : "Upload a shared default for this weather."}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <label className="cursor-pointer rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700">
                            {globalSkyboxDefaults[k] ? "Replace" : "Upload"}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0] || null;
                                void handleGlobalSkyboxUpload(k, f);
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                            disabled={!globalSkyboxDefaults[k] || savingGlobalSkybox === k}
                            onClick={() => void handleGlobalSkyboxUpload(k, null)}
                          >
                            {savingGlobalSkybox === k ? "Saving…" : "Remove"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Custom Product Skyboxes by Weather</div>
                  <div className="grid grid-cols-1 gap-3">
                    {WEATHER_KEYS.map((k) => (
                      <div key={k} className="flex items-center justify-between gap-3 rounded border bg-white p-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-16 items-center justify-center overflow-hidden rounded border bg-gray-50">
                            {skyboxPreviewUrls[k] ? (
                              <img src={skyboxPreviewUrls[k]} alt={`${k} skybox`} className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-[10px] text-gray-400">No file</span>
                            )}
                          </div>
                          <div>
                            <div className="text-sm font-semibold capitalize text-[#233a5e]">{k}</div>
                            <div className="text-[11px] text-gray-600">{skyboxFiles[k]?.name || "Falls back to the shared weather default"}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <label className="cursor-pointer rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700">
                            {skyboxFiles[k] ? "Replace" : "Upload"}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0] || null;
                                handleSkyboxSelect(k, f);
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                            disabled={!skyboxFiles[k]}
                            onClick={() => handleSkyboxSelect(k, null)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-gray-500">
              {activeTab === "files"
                ? "Review the optional uploads, then create the product from the final tab."
                : "Use Next to continue through each required step before submitting."}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3">
              {activeTabIndex > 0 && (
                <button
                  type="button"
                  onClick={handleBackTab}
                  className="rounded-lg border border-gray-300 px-5 py-2 font-semibold text-gray-700 transition hover:bg-gray-50"
                >
                  Back
                </button>
              )}

              {activeTab !== "files" ? (
                <button
                  type="button"
                  onClick={handleNextTab}
                  className="rounded-lg bg-blue-600 px-6 py-2 font-semibold text-white transition hover:bg-blue-700"
                >
                  Next
                </button>
              ) : (
                <button
                  type="submit"
                  onClick={() => {
                    explicitSubmitRef.current = true;
                  }}
                  disabled={loading}
                  className={`flex items-center justify-center gap-2 rounded-lg px-6 py-2 font-semibold text-white transition-colors duration-200 ${
                    loading ? "cursor-not-allowed bg-blue-600 opacity-70" : "bg-blue-600 hover:bg-blue-800"
                  }`}
                >
                  {loading ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
                      Adding Product...
                    </>
                  ) : (
                    "Add Product & Notify Users"
                  )}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}