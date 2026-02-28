"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import { v4 as uuidv4 } from 'uuid';
import { logActivity } from "@/app/lib/activity";
import { createNotification } from "@/app/lib/notifications";
import ThreeDModelViewer from "@/components/ThreeDModelViewer";
import RichTextEditor from "@/components/RichTextEditor";
import ToastPopup, { type ToastPopupState } from "@/components/ToastPopup";

const ALLOWED_3D_EXTENSIONS = ["fbx", "glb", "gltf"] as const;

type WeatherKey = "sunny" | "rainy" | "night" | "foggy";
const WEATHER_KEYS: WeatherKey[] = ["sunny", "rainy", "night", "foggy"];

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

export default function ProductsAdminPage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fullProductName, setFullProductName] = useState("");
  const [additionalFeatures, setAdditionalFeatures] = useState("");
  const [price, setPrice] = useState("");
  const [inventory, setInventory] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [fbxFiles, setFbxFiles] = useState<File[]>([]);
  const [houseModelFile, setHouseModelFile] = useState<File | null>(null);
  const [houseModelPreviewUrl, setHouseModelPreviewUrl] = useState<string | null>(null);
  const [modelPreviewUrls, setModelPreviewUrls] = useState<string[]>([]);
  const [skyboxFiles, setSkyboxFiles] = useState<Partial<Record<WeatherKey, File | null>>>({});
  const [skyboxPreviewUrls, setSkyboxPreviewUrls] = useState<Partial<Record<WeatherKey, string>>>({});
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
      try {
        if (houseModelPreviewUrl) URL.revokeObjectURL(houseModelPreviewUrl);
      } catch {}
    };
  }, [houseModelPreviewUrl]);

  useEffect(() => {
    const urls = fbxFiles.map((f) => URL.createObjectURL(f));
    setModelPreviewUrls(urls);

    return () => {
      try {
        urls.forEach((u) => URL.revokeObjectURL(u));
      } catch {}
    };
  }, [fbxFiles]);

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

  const handleHouseModelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (!file) return;

    if (!isAllowed3DFile(file)) {
      setMessage(
        `Unsupported house model file. Allowed: ${ALLOWED_3D_EXTENSIONS.map((x) => `.${x}`).join(", ")}`
      );
      return;
    }

    setHouseModelFile(file);
    setHouseModelPreviewUrl((prev) => {
      if (prev) {
        try {
          URL.revokeObjectURL(prev);
        } catch {}
      }
      try {
        return URL.createObjectURL(file);
      } catch {
        return null;
      }
    });

    if (currentAdmin) {
      try {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'upload',
          entity_type: 'house_3d_model_file',
          details: `Selected house model file: ${file.name}`,
          page: 'products',
          metadata: {
            fileName: file.name,
            fileSize: file.size,
            fileType: getFileExtension(file.name),
            adminAccount: currentAdmin.username
          }
        });
      } catch (error) {
        console.error("Failed to log house model upload:", error);
      }
    }
  };

  const removeHouseModel = async () => {
    const previous = houseModelFile;
    setHouseModelFile(null);
    setHouseModelPreviewUrl((prev) => {
      if (prev) {
        try {
          URL.revokeObjectURL(prev);
        } catch {}
      }
      return null;
    });

    if (currentAdmin && previous) {
      try {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'delete',
          entity_type: 'house_3d_model_file',
          details: `Removed house model file: ${previous.name}`,
          page: 'products',
          metadata: {
            fileName: previous.name,
            adminAccount: currentAdmin.username
          }
        });
      } catch (error) {
        console.error("Failed to log house model removal:", error);
      }
    }
  };

  const handleSkyboxSelect = async (weather: WeatherKey, file: File | null) => {
    setSkyboxFiles((prev) => ({ ...prev, [weather]: file }));

    setSkyboxPreviewUrls((prev) => {
      const next = { ...prev };
      const prevUrl = next[weather];
      if (prevUrl) {
        try { URL.revokeObjectURL(prevUrl); } catch {}
      }
      if (file) {
        try {
          next[weather] = URL.createObjectURL(file);
        } catch {
          delete next[weather];
        }
      } else {
        delete next[weather];
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
            ? `Selected ${weather} skybox file: ${file.name}`
            : `Cleared ${weather} skybox selection`,
          page: 'products',
          metadata: {
            weather,
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

  // Enhanced product creation with API call for notifications
  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
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
            hasHouseModel: !!houseModelFile,
            adminAccount: currentAdmin.username
          }
        });
      } catch (error) {
        console.error("Failed to log form submission:", error);
      }
      
      // Upload images (unlimited)
      const imageUrls: string[] = [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        try {
          const url = await uploadFile(img, 'images');
          imageUrls.push(url);
          console.log(`✅ Image ${i + 1} uploaded:`, url);
        } catch (uploadError) {
          console.error(`Failed to upload image ${i + 1}:`, uploadError);
        }
      }

      // Upload 3D model files (FBX/GLB/GLTF)
      const fbxUploadedUrls: string[] = [];
      for (let i = 0; i < fbxFiles.length; i++) {
        const file = fbxFiles[i];
        try {
          const url = await uploadFile(file, 'models');
          fbxUploadedUrls.push(url);
          console.log(`✅ 3D model ${i + 1} uploaded:`, url);
        } catch (uploadError) {
          console.error(`Failed to upload 3D model ${i + 1}:`, uploadError);
        }
      }

      let houseModelUrl: string | null = null;
      if (houseModelFile) {
        try {
          houseModelUrl = await uploadFile(houseModelFile, 'house-models');
          console.log("✅ House model uploaded:", houseModelUrl);
        } catch (uploadError) {
          console.error("Failed to upload house model:", uploadError);
        }
      }

      // Upload skyboxes (per weather)
      const skyboxes: Partial<Record<WeatherKey, string>> = {};
      for (const k of WEATHER_KEYS) {
        const f = skyboxFiles[k];
        if (!f) continue;
        try {
          const url = await uploadFile(f, `skyboxes/${k}`);
          skyboxes[k] = url;
          console.log(`✅ Skybox (${k}) uploaded:`, url);
        } catch (uploadError) {
          console.error(`Failed to upload skybox (${k}):`, uploadError);
        }
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
        house_model_url: houseModelUrl,
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

      // Send notifications to users via API route
      console.log("📢 Sending user notifications via API...");
      
      try {
        const notificationResponse = await fetch('/api/notify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'new_product',
            productName: insertedProduct.name,
            productId: insertedProduct.id,
            adminName: currentAdmin.username
          }),
        });

        const notificationResult = await notificationResponse.json();

        if (notificationResponse.ok && notificationResult.success) {
          console.log("✅ User notifications sent:", notificationResult.message);
          setMessage(`Product "${insertedProduct.name}" added successfully! ${notificationResult.message}`);
        } else {
          console.error("❌ User notification error:", notificationResult.error);
          setMessage(`Product "${insertedProduct.name}" added successfully! (Note: User notifications may have failed)`);
        }
      } catch (notificationError) {
        console.error("❌ Failed to send notifications:", notificationError);
        setMessage(`Product "${insertedProduct.name}" added successfully! (Note: User notifications failed)`);
      }
      
      // Reset form
      setName("");
      setFullProductName("");
      setDescription("");
      setAdditionalFeatures("");
      setPrice("");
      setInventory("0");
      setImages([]);
      setFbxFiles([]);
      setHouseModelFile(null);
      setHouseModelPreviewUrl(null);
      setSkyboxFiles({});
      setSkyboxPreviewUrls({});
      setHeight("");
      setWidth("");
      setThickness("");
      setCategory("");
      setCarouselIndex(0);
      
    } catch (err: any) {
      console.error("💥 Product creation failed:", err);
      setMessage(`Error: ${err.message}`);
    } finally {
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
                  {!skyboxPreviewUrls[previewWeather] && (
                    <span className="text-[11px] text-gray-500">No skybox selected for this weather.</span>
                  )}
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <ThreeDModelViewer
                  modelUrls={modelPreviewUrls}
                  initialIndex={currentFbxIndex}
                  weather={previewWeather}
                  frameFinish="matteBlack"
                  houseModelUrl={houseModelPreviewUrl || undefined}
                  productCategory={category || null}
                  skyboxes={skyboxPreviewUrls}
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
        
        <form onSubmit={handleAddProduct}>
          <div className="grid grid-cols-2 gap-6">
            {/* Product Name and Description */}
            <div className="bg-white/80 rounded-lg p-6">
              <h2 className="text-lg font-bold text-[#233a5e] mb-4">Product Name and Description</h2>
              <label className="block text-[#233a5e] font-semibold mb-1">Product Name</label>
              <input
                type="text"
                placeholder="Product Name"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full border border-gray-300 p-2 rounded bg-white text-black mb-4"
                required
              />

              <div className="mt-2">
                <label className="block text-[#233a5e] font-semibold mb-1">Full Product Name</label>
                <input
                  type="text"
                  placeholder="Full Product Name"
                  value={fullProductName}
                  onChange={e => setFullProductName(e.target.value)}
                  className="w-full border border-gray-300 p-2 rounded bg-white text-black mb-4"
                />
              </div>

              <label className="block text-[#233a5e] font-semibold mb-1">Product Description</label>
              <RichTextEditor value={description} onChange={setDescription} />

              <div className="mt-4">
                <label className="block text-[#233a5e] font-semibold mb-1">Additional Features</label>
                <RichTextEditor value={additionalFeatures} onChange={setAdditionalFeatures} />
              </div>
            </div>

            {/* Product Details */}
            <div className="bg-white/80 rounded-lg p-6">
              <h2 className="text-lg font-bold text-[#233a5e] mb-4">Product Details</h2>
              <label className="block text-[#233a5e] font-semibold mb-1">Price (PHP)</label>
              <input
                type="number"
                value={price}
                onChange={e => setPrice(e.target.value)}
                className="w-full border border-gray-300 p-2 rounded bg-white text-black mb-4"
                placeholder="0.00"
                required
                min="0"
              />
              <label className="block text-[#233a5e] font-semibold mb-1">Inventory</label>
              <input
                type="number"
                value={inventory}
                onChange={e => setInventory(e.target.value)}
                className="w-full border border-gray-300 p-2 rounded bg-white text-black mb-4"
                placeholder="Enter inventory quantity"
                required
                min="0"
              />
              <div className="flex space-x-4 mb-4">
                <div>
                  <label className="block text-[#233a5e] font-semibold mb-1">Height:</label>
                  <input
                    type="number"
                    value={height}
                    onChange={e => setHeight(e.target.value)}
                    className="w-20 border border-gray-300 p-1 rounded bg-white text-black"
                  />
                </div>
                <div>
                  <label className="block text-[#233a5e] font-semibold mb-1">Width:</label>
                  <input
                    type="number"
                    value={width}
                    onChange={e => setWidth(e.target.value)}
                    className="w-20 border border-gray-300 p-1 rounded bg-white text-black"
                  />
                </div>
                <div>
                  <label className="block text-[#233a5e] font-semibold mb-1">Thickness:</label>
                  <input
                    type="number"
                    value={thickness}
                    onChange={e => setThickness(e.target.value)}
                    className="w-20 border border-gray-300 p-1 rounded bg-white text-black"
                  />
                </div>
              </div>
              <div className="text-xs text-gray-600">
                Material and type are now managed in product updates when needed.
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Category */}
            <div className="bg-white/80 rounded-lg p-6">
              <h2 className="text-lg font-bold text-[#233a5e] mb-4">Category</h2>
              <label className="block text-[#233a5e] font-semibold mb-1">Product Category</label>
              <div className="relative">
                <select
                  className="w-full border border-gray-300 p-2 rounded bg-white text-black mb-4 appearance-none"
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  required
                  style={{ position: "relative", zIndex: 10 }}
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
                <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                  ▼
                </span>
              </div>
            </div>

            {/* Product Files Section */}
            <div className="bg-white/80 rounded-lg p-6">
              <h2 className="text-lg font-bold text-[#233a5e] mb-4">Product Files</h2>
              
              {/* Images Upload (Unlimited) */}
              <div className="mb-6">
                <h3 className="text-md font-semibold text-[#233a5e] mb-2">
                  Product Images ({images.length})
                </h3>
                
                <div className="flex items-center space-x-2 mb-4">
                  <label
                    htmlFor="images-upload"
                    className={
                      'flex flex-col items-center justify-center w-28 h-28 border-2 border-dashed rounded-lg cursor-pointer transition-colors border-gray-400 bg-[#e7eaef] hover:bg-gray-200'
                    }
                  >
                    <span className="text-2xl">+</span>
                    <span className="text-xs text-[#233a5e]">Add Image</span>
                    <span className="text-[10px] text-gray-500 mt-1">Unlimited</span>
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
                    <div className="flex items-center space-x-2 flex-wrap">
                      {getCarouselImages().map((img, idx) => {
                        const actualIndex = carouselIndex + idx;
                        return (
                          <div key={actualIndex} className="relative">
                            <img
                              src={URL.createObjectURL(img)}
                              alt={`Product Image ${actualIndex + 1}`}
                              className="w-20 h-20 object-cover rounded-lg border border-gray-300"
                            />
                            <button
                              type="button"
                              onClick={() => removeImage(actualIndex)}
                              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600"
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
                      className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                    >
                      ←
                    </button>
                    <span className="text-sm text-gray-600 px-2 py-1">
                      {Math.floor(carouselIndex / 3) + 1} / {Math.ceil(images.length / 3)}
                    </span>
                    <button
                      type="button"
                      onClick={handleNext}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                    >
                      →
                    </button>
                  </div>
                )}
              </div>

              {/* 3D Model Files Upload */}
              <div className="mb-4">
                <h3 className="text-md font-semibold text-[#233a5e] mb-2">
                  3D Models (.fbx, .glb, .gltf) ({fbxFiles.length} files)
                </h3>
                
                <label
                  htmlFor="fbx-upload"
                  className="flex flex-col items-center justify-center w-full h-16 border-2 border-dashed border-gray-400 rounded-lg cursor-pointer bg-[#e7eaef] hover:bg-gray-200 mb-2"
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
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {fbxFiles.map((file, index) => (
                      <div key={index} className="flex items-center justify-between p-2 bg-gray-100 rounded text-xs border">
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium text-[#233a5e]" title={file.name}>
                            {file.name}
                          </div>
                          <div className="text-gray-500">
                            {(file.size / (1024 * 1024)).toFixed(2)} MB
                          </div>
                        </div>
                        <div className="flex items-center space-x-1 ml-2">
                          <button
                            type="button"
                            onClick={() => handleOpen3DViewer(index)}
                            className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                          >
                            View 3D
                          </button>
                          <button
                            type="button"
                            onClick={() => removeFbxFile(index)}
                            className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                className={`w-full px-4 py-2 rounded font-semibold transition-colors ${
                  fbxFiles.length > 0 
                    ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer' 
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
                disabled={fbxFiles.length === 0}
                onClick={() => handleOpen3DViewer(0)}
              >
                {fbxFiles.length === 0 
                  ? 'No 3D Model Files' 
                  : `Open 3D Viewer (${fbxFiles.length} ${fbxFiles.length === 1 ? 'model' : 'models'})`
                }
              </button>

              <div className="mt-6 border-t border-gray-200 pt-4">
                <h3 className="text-md font-semibold text-[#233a5e] mb-2">
                  House Context Model (.fbx, .glb, .gltf)
                </h3>
                <div className="text-xs text-gray-600 mb-2">
                  Optional: upload one 3D house model where this product should be previewed on the website.
                </div>

                <label
                  htmlFor="house-model-upload"
                  className="flex flex-col items-center justify-center w-full h-16 border-2 border-dashed border-gray-400 rounded-lg cursor-pointer bg-[#e7eaef] hover:bg-gray-200 mb-2"
                >
                  <span className="text-sm text-[#233a5e]">
                    {houseModelFile ? "Replace House Model" : "+ Add House Model"}
                  </span>
                </label>
                <input
                  id="house-model-upload"
                  type="file"
                  accept=".fbx,.glb,.gltf"
                  onChange={handleHouseModelUpload}
                  className="hidden"
                />

                {houseModelFile && (
                  <div className="flex items-center justify-between p-2 bg-gray-100 rounded text-xs border">
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium text-[#233a5e]" title={houseModelFile.name}>
                        {houseModelFile.name}
                      </div>
                      <div className="text-gray-500">
                        {(houseModelFile.size / (1024 * 1024)).toFixed(2)} MB
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={removeHouseModel}
                      className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 ml-2"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              {/* Skyboxes (per weather) */}
              <div className="mt-6">
                <h3 className="text-md font-semibold text-[#233a5e] mb-2">Skyboxes by Weather</h3>
                <div className="text-xs text-gray-500 mb-3">
                  Upload one equirectangular image (JPG/PNG) per weather. This will show as the 3D background on the website and in the admin preview.
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {WEATHER_KEYS.map((k) => (
                    <div key={k} className="flex items-center justify-between gap-3 p-3 bg-gray-100 rounded border">
                      <div className="flex items-center gap-3">
                        <div className="w-16 h-12 rounded overflow-hidden bg-white border flex items-center justify-center">
                          {skyboxPreviewUrls[k] ? (
                            <img src={skyboxPreviewUrls[k]} alt={`${k} skybox`} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-[10px] text-gray-400">No file</span>
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-[#233a5e] capitalize">{k}</div>
                          <div className="text-[11px] text-gray-600">{skyboxFiles[k]?.name || "—"}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 cursor-pointer">
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
                          className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 disabled:opacity-50"
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

          {/* Submit Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className={`flex items-center justify-center gap-2 px-6 py-2 rounded font-semibold transition-colors duration-200 ${
                loading ? "bg-blue-600 opacity-70 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-800"
              } text-white`}
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Adding Product...
                </>
              ) : (
                "Add Product & Notify Users"
              )}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}