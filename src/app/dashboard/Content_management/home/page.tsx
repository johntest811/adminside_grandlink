"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import { logActivity } from "@/app/lib/activity";

type HomeContent = {
  carousel?: Array<{ image?: string; youtube_url?: string; title?: string; buttonText?: string; buttonLink?: string }>;
  explore?: Array<{ image?: string; title?: string; buttonText?: string; buttonLink?: string }>;
  featured_projects?: Array<{ image?: string; title?: string; description?: string; youtube_url?: string }>;
  featured_long_images?: Array<{ image?: string; title?: string; description?: string }>;
  payment?: { payrex_phone?: string; payrex_number?: string };
  services?: { images?: string[]; title?: string; description?: string; buttonText?: string; buttonLink?: string };
  about?: { logo?: string; title?: string; description?: string; buttonText?: string; buttonLink?: string };
  [k: string]: any;
};

// bucket name - change to your bucket
const BUCKET_NAME = "uploads";

export default function HomeEditor() {
  const [content, setContent] = useState<HomeContent>({});
  const [originalContent, setOriginalContent] = useState<HomeContent>({});
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // image picker state & loaded images
  const [images, setImages] = useState<Array<{ name: string; url: string }>>([]);
  const [picker, setPicker] = useState<{ open: boolean; key: string; index?: number | null } | null>(null);

  // upload state
  const [uploading, setUploading] = useState(false);

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
            details: `Admin ${admin.username} accessed Home Page editor`,
            page: 'Home',
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
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        // Use website API if NEXT_PUBLIC_WEBSITE_URL is set, otherwise call local /api/home
        const siteBase = (process.env.NEXT_PUBLIC_WEBSITE_URL || "").replace(/\/$/, "");
        const apiUrl = siteBase ? `${siteBase}/api/home` : "/api/home";
        const res = await fetch(apiUrl, { credentials: "include" });
        const ct = (res.headers.get("content-type") || "").toLowerCase();

        if (!res.ok) {
          const text = await res.text();
          console.error("Failed to load /api/home:", res.status, text);
          setError(`Failed to load home content: ${res.status} ${res.statusText}`);
          
          // Log load error
          if (currentAdmin) {
            await logActivity({
              admin_id: currentAdmin.id,
              admin_name: currentAdmin.username,
              action: 'view',
              entity_type: 'home_content_error',
              details: `Admin ${currentAdmin.username} failed to load home content: ${res.status} ${res.statusText}`,
              page: 'Home',
              metadata: {
                error: `${res.status} ${res.statusText}`,
                adminAccount: currentAdmin.username,
                timestamp: new Date().toISOString()
              }
            });
          }
          return;
        }

        if (ct.includes("application/json")) {
          const d = await res.json();
          const loadedContent = d?.content ?? d ?? {};
          setContent(loadedContent);
          setOriginalContent(JSON.parse(JSON.stringify(loadedContent))); // Deep copy for comparison
          
          // Log successful content load
          if (currentAdmin) {
            await logActivity({
              admin_id: currentAdmin.id,
              admin_name: currentAdmin.username,
              action: 'view',
              entity_type: 'home_content',
              details: `Admin ${currentAdmin.username} loaded home page content for editing`,
              page: 'Home',
              metadata: {
                sectionsLoaded: Object.keys(loadedContent),
                carouselSlides: loadedContent.carousel?.length || 0,
                exploreItems: loadedContent.explore?.length || 0,
                featuredProjects: loadedContent.featured_projects?.length || 0,
                featuredLongImages: loadedContent.featured_long_images?.length || 0,
                hasServices: !!loadedContent.services,
                hasAbout: !!loadedContent.about,
                payrexPhoneConfigured: !!(loadedContent.payment?.payrex_phone || loadedContent.payment?.payrex_number),
                adminAccount: currentAdmin.username,
                adminId: currentAdmin.id,
                timestamp: new Date().toISOString()
              }
            });
          }
        } else {
          // handle non-json response safely
          const txt = await res.text();
          try {
            const parsed = JSON.parse(txt);
            const loadedContent = parsed?.content ?? parsed ?? {};
            setContent(loadedContent);
            setOriginalContent(JSON.parse(JSON.stringify(loadedContent)));
          } catch {
            console.error("Invalid JSON from /api/home:", txt);
            setError("Invalid JSON response from /api/home");
          }
        }
      } catch (err: any) {
        console.error("Fetch error /api/home:", err);
        setError(String(err));
      }
    };
    
    if (currentAdmin) {
      load();
    }

    // load images from supabase storage (public bucket expected)
    const loadImages = async () => {
      try {
        const { data, error } = await supabase.storage.from(BUCKET_NAME).list("", { limit: 200 });
        if (error) {
          console.error("storage.list error:", error);
          return;
        }

        const makePublicUrl = (fileName: string) => {
          // Build a safe encoded public storage URL directly to avoid StorageApiError
          // (do not call getPublicUrl() on the client - it can throw for some keys)
          const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
          return `${base}/storage/v1/object/public/${BUCKET_NAME}/${encodeURIComponent(fileName)}`;
        };

        const mapped = (data || []).map((f: any) => {
          // sanitize and produce a safe URL
          const url = makePublicUrl(f.name);
          return { name: f.name, url };
        });
        setImages(mapped);
        
        // Log images loaded
        if (currentAdmin && mapped.length > 0) {
          await logActivity({
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: 'view',
            entity_type: 'home_images',
            details: `Admin ${currentAdmin.username} loaded ${mapped.length} images from storage for home page editing`,
            page: 'Home',
            metadata: {
              imagesCount: mapped.length,
              bucketName: BUCKET_NAME,
              adminAccount: currentAdmin.username,
              timestamp: new Date().toISOString()
            }
          });
        }
      } catch (e) {
        console.error("loadImages error:", e);
      }
    };
    loadImages();
  }, [currentAdmin]);

  // Enhanced content change logging
  const logContentChange = async (section: string, field: string, oldValue: any, newValue: any, index?: number) => {
    if (!currentAdmin || oldValue === newValue) return;

    const sectionName = section.charAt(0).toUpperCase() + section.slice(1);
    const indexStr = typeof index === 'number' ? ` (item ${index + 1})` : '';
    
    await logActivity({
      admin_id: currentAdmin.id,
      admin_name: currentAdmin.username,
      action: 'update',
      entity_type: `home_${section}_${field}`,
      details: `Admin ${currentAdmin.username} updated ${sectionName} ${field}${indexStr}: "${String(oldValue || '')}" → "${String(newValue || '')}"`,
      page: 'Home',
      metadata: {
        section: section,
        field: field,
        itemIndex: index,
        oldValue: oldValue,
        newValue: newValue,
        sectionName: sectionName,
        adminAccount: currentAdmin.username,
        adminId: currentAdmin.id,
        timestamp: new Date().toISOString()
      }
    });
  };

  // file upload handler - uploads to storage and refreshes image list
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentAdmin) return;
    setUploading(true);
    setError(null);
    
    try {
      // sanitize filename: remove problematic characters that Storage rejects
      const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const filePath = `${Date.now()}_${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(filePath, file, { upsert: true, contentType: file.type });

      if (uploadError) {
        console.error("upload error:", uploadError);
        setError(uploadError.message || "Upload failed");
        
        // Log upload error
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: 'upload',
          entity_type: 'home_image_error',
          details: `Admin ${currentAdmin.username} failed to upload image for home page: ${uploadError.message}`,
          page: 'Home',
          metadata: {
            fileName: file.name,
            fileSize: file.size,
            error: uploadError.message,
            adminAccount: currentAdmin.username,
            timestamp: new Date().toISOString()
          }
        });
        
        setUploading(false);
        return;
      }

      // build public url safely (encode path)
      const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
      const publicUrl = `${base}/storage/v1/object/public/${BUCKET_NAME}/${encodeURIComponent(filePath)}`;

      // prepend new image to list and automatically select it (optional)
      setImages((prev) => [{ name: filePath, url: publicUrl }, ...prev]);
      if (picker) {
        handleSelectImage(publicUrl);
      }

      // Log successful upload
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'upload',
        entity_type: 'home_image',
        details: `Admin ${currentAdmin.username} uploaded image for home page: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`,
        page: 'Home',
        metadata: {
          fileName: file.name,
          fileSize: file.size,
          fileSizeMB: (file.size / 1024 / 1024).toFixed(2),
          fileType: file.type,
          uploadPath: filePath,
          imageUrl: publicUrl,
          bucketName: BUCKET_NAME,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
      
    } catch (err: any) {
      console.error("handleFileUpload error:", err);
      setError(String(err));
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  };

  const save = async () => {
    if (!currentAdmin) return;
    
    setSaving(true);
    setError(null);
    
    try {
      // Calculate comprehensive changes
      const changes: Array<{section: string, field: string, type: string, details: string}> = [];
      
      // Compare carousel changes
      const originalCarousel = originalContent.carousel || [];
      const currentCarousel = content.carousel || [];
      if (originalCarousel.length !== currentCarousel.length) {
        changes.push({
          section: 'carousel',
          field: 'slides',
          type: 'count_change',
          details: `Carousel slides: ${originalCarousel.length} → ${currentCarousel.length}`
        });
      }
      
      // Compare explore changes
      const originalExplore = originalContent.explore || [];
      const currentExplore = content.explore || [];
      if (originalExplore.length !== currentExplore.length) {
        changes.push({
          section: 'explore',
          field: 'items',
          type: 'count_change',
          details: `Explore items: ${originalExplore.length} → ${currentExplore.length}`
        });
      }
      
      // Compare featured projects changes
      const originalProjects = originalContent.featured_projects || [];
      const currentProjects = content.featured_projects || [];
      if (originalProjects.length !== currentProjects.length) {
        changes.push({
          section: 'featured_projects',
          field: 'projects',
          type: 'count_change', 
          details: `Featured projects: ${originalProjects.length} → ${currentProjects.length}`
        });
      }

      const originalLongImages = originalContent.featured_long_images || [];
      const currentLongImages = content.featured_long_images || [];
      if (originalLongImages.length !== currentLongImages.length) {
        changes.push({
          section: 'featured_long_images',
          field: 'images',
          type: 'count_change',
          details: `Featured long images: ${originalLongImages.length} → ${currentLongImages.length}`
        });
      }

      const res = await fetch("/api/home", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(content),
      });
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      let json: any = null;
      if (ct.includes("application/json")) {
        json = await res.json();
      } else {
        const txt = await res.text();
        try { json = JSON.parse(txt); } catch { json = { message: txt }; }
      }
      if (!res.ok) throw new Error(json?.error || json?.message || "save failed");
      
      // Log successful save with comprehensive details
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: "update",
        entity_type: "home_content",
        details: `Admin ${currentAdmin.username} saved home page content with ${changes.length} section changes`,
        page: "Home",
        metadata: {
          changesCount: changes.length,
          changes: changes,
          sections: {
            carousel: {
              slides: content.carousel?.length || 0,
              changed: originalCarousel.length !== currentCarousel.length
            },
            explore: {
              items: content.explore?.length || 0,
              changed: originalExplore.length !== currentExplore.length
            },
            featured_projects: {
              projects: content.featured_projects?.length || 0,
              changed: originalProjects.length !== currentProjects.length
            },
            featured_long_images: {
              images: content.featured_long_images?.length || 0,
              changed: originalLongImages.length !== currentLongImages.length
            },
            payment: {
              payrex_phone: content.payment?.payrex_phone || content.payment?.payrex_number || ''
            },
            services: {
              configured: !!content.services,
              title: content.services?.title || '',
              imagesCount: content.services?.images?.length || 0
            },
            about: {
              configured: !!content.about,
              title: content.about?.title || '',
              hasLogo: !!content.about?.logo
            }
          },
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });

      // Update original content for future comparisons
      setOriginalContent(JSON.parse(JSON.stringify(content)));
      setError(null);
      
    } catch (e: any) {
      setError(e.message || "Failed");
      
      // Log save error
      if (currentAdmin) {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "update",
          entity_type: "home_content_error",
          details: `Admin ${currentAdmin.username} failed to save home page content: ${e.message}`,
          page: "Home",
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

  // Enhanced array operations with logging
  const addArrayItem = async <K extends keyof HomeContent>(key: K, item: any = {}) => {
    const oldLength = Array.isArray(content[key]) ? (content[key] as any[]).length : 0;
    
    setContent((prev) => {
      const arr = Array.isArray(prev[key]) ? (prev[key] as any[]).slice() : [];
      arr.push(item);
      return { ...prev, [key]: arr } as HomeContent;
    });

    // Log array item addition
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'create',
        entity_type: `home_${String(key)}_item`,
        details: `Admin ${currentAdmin.username} added new item to ${String(key)} section (now ${oldLength + 1} items)`,
        page: 'Home',
        metadata: {
          section: String(key),
          itemIndex: oldLength,
          newItemsCount: oldLength + 1,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  const removeArrayItem = async <K extends keyof HomeContent>(key: K, index: number) => {
    const arr = Array.isArray(content[key]) ? (content[key] as any[]) : [];
    const itemToRemove = arr[index];
    const oldLength = arr.length;
    
    setContent((prev) => {
      const newArr = Array.isArray(prev[key]) ? (prev[key] as any[]).slice() : [];
      newArr.splice(index, 1);
      return { ...prev, [key]: newArr } as HomeContent;
    });

    // Log array item removal
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'delete',
        entity_type: `home_${String(key)}_item`,
        details: `Admin ${currentAdmin.username} removed item from ${String(key)} section at position ${index + 1} (now ${oldLength - 1} items)`,
        page: 'Home',
        metadata: {
          section: String(key),
          removedItemIndex: index,
          removedItem: itemToRemove,
          newItemsCount: oldLength - 1,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  // open image picker for a specific field (key) and optional index (for arrays)
  const openImagePicker = async (key: string, index?: number) => {
    setPicker({ open: true, key, index: typeof index === "number" ? index : null });
    
    // Log image picker opening
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'view',
        entity_type: 'home_image_picker',
        details: `Admin ${currentAdmin.username} opened image picker for ${key}${typeof index === 'number' ? ` item ${index + 1}` : ''}`,
        page: 'Home',
        metadata: {
          pickerKey: key,
          itemIndex: index,
          adminAccount: currentAdmin.username,
          timestamp: new Date().toISOString()
        }
      });
    }
  };

  // Enhanced image selection with logging
  const handleSelectImage = async (url: string) => {
    if (!picker || !currentAdmin) return;
    const { key, index } = picker;
    
    // Get old value for comparison
    let oldValue = '';
    if (key.includes(".")) {
      const [parent, child] = key.split(".");
      if (content[parent] && child === "images" && typeof index === "number") {
        oldValue = content[parent][child]?.[index] || '';
      } else if (content[parent]) {
        oldValue = content[parent][child] || '';
      }
    } else if (Array.isArray(content[key]) && typeof index === "number") {
      oldValue = (content[key] as any[])[index]?.image || '';
    } else {
      oldValue = content[key] as string || '';
    }
    
    setContent((prev) => {
      const next = { ...prev };
      if (key.includes(".")) {
        // support nested keys like "services.images"
        const [parent, child] = key.split(".");
        if (!next[parent]) next[parent] = {};
        if (child === "images") {
          const arr = Array.isArray(next[parent][child]) ? next[parent][child].slice() : [];
          if (typeof index === "number") arr[index] = url;
          else arr.push(url);
          next[parent][child] = arr;
        } else {
          next[parent][child] = url;
        }
      } else {
        // array keys or direct
        if (Array.isArray(next[key])) {
          const arr = (next[key] as any[]).slice();
          if (typeof index === "number") arr[index] = { ...(arr[index] || {}), image: url };
          else arr.push({ image: url });
          next[key] = arr;
        } else {
          // set direct value (e.g. about.logo)
          next[key] = url as any;
        }
      }
      return next;
    });

    // Log image selection
    await logActivity({
      admin_id: currentAdmin.id,
      admin_name: currentAdmin.username,
      action: 'update',
      entity_type: 'home_image_selection',
      details: `Admin ${currentAdmin.username} selected image for ${key}${typeof index === 'number' ? ` item ${index + 1}` : ''}: "${oldValue}" → "${url}"`,
      page: 'Home',
      metadata: {
        pickerKey: key,
        itemIndex: index,
        oldImageUrl: oldValue,
        newImageUrl: url,
        adminAccount: currentAdmin.username,
        adminId: currentAdmin.id,
        timestamp: new Date().toISOString()
      }
    });
    
    setPicker(null);
  };

  const closePicker = () => setPicker(null);

  // Enhanced form field handlers with logging
  const handleCarouselChange = async (index: number, field: string, value: string) => {
    const oldValue = content.carousel?.[index]?.[field as keyof typeof content.carousel[0]] || '';
    
    const arr = content.carousel || [];
    arr[index] = { ...(arr[index] || {}), [field]: value };
    setContent({ ...content, carousel: arr });
    
    await logContentChange('carousel', field, oldValue, value, index);
  };

  const handleExploreChange = async (index: number, field: string, value: string) => {
    const oldValue = content.explore?.[index]?.[field as keyof typeof content.explore[0]] || '';
    
    const arr = content.explore || [];
    arr[index] = { ...(arr[index] || {}), [field]: value };
    setContent({ ...content, explore: arr });
    
    await logContentChange('explore', field, oldValue, value, index);
  };

  const handleFeaturedProjectsChange = async (index: number, field: string, value: string) => {
    const oldValue = content.featured_projects?.[index]?.[field as keyof typeof content.featured_projects[0]] || '';
    
    const arr = content.featured_projects || [];
    arr[index] = { ...(arr[index] || {}), [field]: value };
    setContent({ ...content, featured_projects: arr });
    
    await logContentChange('featured_projects', field, oldValue, value, index);
  };

  const handleFeaturedLongImagesChange = async (index: number, field: string, value: string) => {
    const oldValue = content.featured_long_images?.[index]?.[field as keyof typeof content.featured_long_images[0]] || '';

    const arr = content.featured_long_images || [];
    arr[index] = { ...(arr[index] || {}), [field]: value };
    setContent({ ...content, featured_long_images: arr });

    await logContentChange('featured_long_images', field, oldValue, value, index);
  };

  const handlePaymentChange = async (field: string, value: string) => {
    const oldValue = content.payment?.[field as keyof typeof content.payment] || '';

    setContent({ ...content, payment: { ...(content.payment || {}), [field]: value } });

    await logContentChange('payment', field, oldValue, value);
  };

  const handleServicesChange = async (field: string, value: string) => {
    const oldValue = content.services?.[field as keyof typeof content.services] || '';
    
    setContent({ ...content, services: { ...(content.services || {}), [field]: value } });
    
    await logContentChange('services', field, oldValue, value);
  };

  const handleAboutChange = async (field: string, value: string) => {
    const oldValue = content.about?.[field as keyof typeof content.about] || '';
    
    setContent({ ...content, about: { ...(content.about || {}), [field]: value } });
    
    await logContentChange('about', field, oldValue, value);
  };

  // form control classes for visible lines
  const formControl = "w-full border border-gray-300 rounded-lg px-3 py-2 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-800";
  const formControlSmall = "border border-gray-300 rounded-lg px-3 py-2 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-800";

  return (
    <div className="p-8 max-w-5xl mx-auto bg-gray-50 min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Home Page Editor</h1>
          <p className="text-sm text-gray-600 mt-1">Manage carousel, explore section, featured projects, and more.</p>
        </div>
        <div className="text-sm text-gray-600 bg-white px-4 py-2 rounded-lg border border-gray-200 shadow-sm">
          Editing as: {currentAdmin?.username || 'Unknown Admin'}
        </div>
      </div>

      {/* Carousel */}
      <section className="mb-6 bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
              {(content.carousel || []).length} slides
            </span>
            Carousel
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => addArrayItem("carousel", { image: "", youtube_url: "" })}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg shadow transition-colors text-sm"
              type="button"
            >
              + Add Image Slide
            </button>
            <button
              onClick={() => addArrayItem("carousel", { youtube_url: "" })}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg shadow transition-colors text-sm"
              type="button"
            >
              + Add YouTube Slide
            </button>
          </div>
        </div>
        {(content.carousel || []).map((s, i) => (
          <div key={i} className="bg-gray-50 rounded-lg p-4 mb-3">
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-medium text-gray-700">Slide {i + 1}</span>
              <button 
                className="text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1 rounded-lg transition-colors text-sm" 
                onClick={() => removeArrayItem("carousel", i)}
              >
                🗑 Remove
              </button>
            </div>
            
            {/* Preview Section */}
            <div className="mb-4">
              {s.youtube_url ? (
                <div className="relative w-full aspect-video bg-gray-900 rounded-lg overflow-hidden border border-gray-300">
                  <iframe
                    src={`https://www.youtube.com/embed/${s.youtube_url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([^?&]+)/)?.[1] || ''}`}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title={`Slide ${i + 1} video preview`}
                  />
                  <div className="absolute top-2 left-2 bg-red-600 text-white text-xs px-2 py-1 rounded">🎥 Video</div>
                </div>
              ) : s.image ? (
                <div className="relative">
                  <img
                    src={s.image}
                    alt={`Slide ${i + 1}`}
                    className="w-full h-48 object-cover rounded-lg border border-gray-300"
                  />
                  <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs px-2 py-1 rounded">🖼 Image</div>
                </div>
              ) : (
                <div className="w-full h-32 bg-gray-200 rounded-lg border border-dashed border-gray-400 flex items-center justify-center text-gray-500">
                  No media selected
                </div>
              )}
            </div>
            
            <div className="space-y-3">
              <div className="flex gap-2">
                <input 
                  className={`flex-1 ${formControlSmall}`} 
                  placeholder="Choose image from library/upload" 
                  value={s.image || ""} 
                  readOnly
                />
                <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors" onClick={() => openImagePicker("carousel", i)}>Choose</button>
              </div>
              <input
                className={formControl}
                placeholder="YouTube URL (optional — if set, this slide becomes a video)"
                value={s.youtube_url || ""}
                onChange={(e) => handleCarouselChange(i, 'youtube_url', e.target.value)}
              />
              <input 
                className={formControl} 
                placeholder="Title" 
                value={s.title || ""} 
                onChange={(e) => handleCarouselChange(i, 'title', e.target.value)} 
              />
              <div className="flex gap-2">
                <input 
                  className={`flex-1 ${formControlSmall}`} 
                  placeholder="Button Text" 
                  value={s.buttonText || ""} 
                  onChange={(e) => handleCarouselChange(i, 'buttonText', e.target.value)} 
                />
                <input 
                  className={`flex-1 ${formControlSmall}`} 
                  placeholder="Button Link" 
                  value={s.buttonLink || ""} 
                  onChange={(e) => handleCarouselChange(i, 'buttonLink', e.target.value)} 
                />
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Explore */}
      <section className="mb-6 bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
              {(content.explore || []).length} items
            </span>
            Explore Our Products
          </h2>
          <button onClick={() => addArrayItem("explore", {})} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg shadow transition-colors text-sm">+ Add Item</button>
        </div>
        {(content.explore || []).map((s, i) => (
          <div key={i} className="bg-gray-50 rounded-lg p-4 mb-3">
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-medium text-gray-700">Item {i + 1}</span>
              <button 
                className="text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1 rounded-lg transition-colors text-sm" 
                onClick={() => removeArrayItem("explore", i)}
              >
                🗑 Remove
              </button>
            </div>
            
            {/* Preview Section */}
            <div className="mb-4">
              {s.image ? (
                <img
                  src={s.image}
                  alt={`Explore ${i + 1}`}
                  className="w-full h-40 object-cover rounded-lg border border-gray-300"
                />
              ) : (
                <div className="w-full h-32 bg-gray-200 rounded-lg border border-dashed border-gray-400 flex items-center justify-center text-gray-500">
                  No image selected
                </div>
              )}
            </div>
            
            <div className="space-y-3">
              <div className="flex gap-2">
                <input 
                  className={`flex-1 ${formControlSmall}`} 
                  placeholder="Choose image from library/upload" 
                  value={s.image || ""} 
                  readOnly
                />
                <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors" onClick={() => openImagePicker("explore", i)}>Choose</button>
              </div>
              <input 
                className={formControl} 
                placeholder="Title" 
                value={s.title || ""} 
                onChange={(e) => handleExploreChange(i, 'title', e.target.value)} 
              />
              <div className="flex gap-2">
                <input 
                  className={`flex-1 ${formControlSmall}`} 
                  placeholder="Button Text" 
                  value={s.buttonText || ""} 
                  onChange={(e) => handleExploreChange(i, 'buttonText', e.target.value)} 
                />
                <input 
                  className={`flex-1 ${formControlSmall}`} 
                  placeholder="Button Link" 
                  value={s.buttonLink || ""} 
                  onChange={(e) => handleExploreChange(i, 'buttonLink', e.target.value)} 
                />
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Featured Projects */}
      <section className="mb-6 bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
              {(content.featured_projects || []).length} projects
            </span>
            Featured Projects
          </h2>
          <button onClick={() => addArrayItem("featured_projects", {})} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg shadow transition-colors text-sm">+ Add Project</button>
        </div>
        {(content.featured_projects || []).map((p, i) => (
          <div key={i} className="bg-gray-50 rounded-lg p-4 mb-3">
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-medium text-gray-700">Project {i + 1}</span>
              <button 
                className="text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1 rounded-lg transition-colors text-sm" 
                onClick={() => removeArrayItem("featured_projects", i)}
              >
                🗑 Remove
              </button>
            </div>
            
            {/* Preview Section */}
            <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              {p.image ? (
                <div className="relative">
                  <img
                    src={p.image}
                    alt={`Project ${i + 1}`}
                    className="w-full h-40 object-cover rounded-lg border border-gray-300"
                  />
                  <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs px-2 py-1 rounded">🖼 Image</div>
                </div>
              ) : (
                <div className="w-full h-32 bg-gray-200 rounded-lg border border-dashed border-gray-400 flex items-center justify-center text-gray-500">
                  No image selected
                </div>
              )}
              {p.youtube_url ? (
                <div className="relative w-full aspect-video bg-gray-900 rounded-lg overflow-hidden border border-gray-300">
                  <iframe
                    src={`https://www.youtube.com/embed/${p.youtube_url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([^?&]+)/)?.[1] || ''}`}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title={`Project ${i + 1} video`}
                  />
                  <div className="absolute top-2 left-2 bg-red-600 text-white text-xs px-2 py-1 rounded">🎥 Video</div>
                </div>
              ) : (
                <div className="w-full h-32 bg-gray-200 rounded-lg border border-dashed border-gray-400 flex items-center justify-center text-gray-500">
                  No video (optional)
                </div>
              )}
            </div>
            
            <div className="space-y-3">
              <div className="flex gap-2">
                <input 
                  className={`flex-1 ${formControlSmall}`} 
                  placeholder="Choose image from library/upload" 
                  value={p.image || ""} 
                  readOnly
                />
                <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors" onClick={() => openImagePicker("featured_projects", i)}>Choose</button>
              </div>
              <input 
                className={formControl} 
                placeholder="Title" 
                value={p.title || ""} 
                onChange={(e) => handleFeaturedProjectsChange(i, 'title', e.target.value)} 
              />
              <textarea 
                className={formControl} 
                placeholder="Description" 
                value={p.description || ""} 
                onChange={(e) => handleFeaturedProjectsChange(i, 'description', e.target.value)} 
              />
              <input
                className={formControl}
                placeholder="YouTube URL (e.g. https://www.youtube.com/watch?v=...)"
                value={p.youtube_url || ""}
                onChange={(e) => handleFeaturedProjectsChange(i, 'youtube_url', e.target.value)}
              />
            </div>
          </div>
        ))}
      </section>

      {/* Featured Long Images */}
      <section className="mb-6 bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
              {(content.featured_long_images || []).length} images
            </span>
            Featured Products Long Images
          </h2>
          <button onClick={() => addArrayItem("featured_long_images", {})} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg shadow transition-colors text-sm">+ Add Image</button>
        </div>
        <p className="text-sm text-gray-500 mb-4">Recommended: keep 3 long images for homepage popup gallery.</p>
        {(content.featured_long_images || []).map((imgItem, i) => (
          <div key={i} className="bg-gray-50 rounded-lg p-4 mb-3">
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-medium text-gray-700">Image {i + 1}</span>
              <button 
                className="text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1 rounded-lg transition-colors text-sm" 
                onClick={() => removeArrayItem("featured_long_images", i)}
              >
                🗑 Remove
              </button>
            </div>
            
            {/* Preview Section */}
            <div className="mb-4">
              {imgItem.image ? (
                <img
                  src={imgItem.image}
                  alt={`Featured ${i + 1}`}
                  className="w-full h-48 object-cover rounded-lg border border-gray-300"
                />
              ) : (
                <div className="w-full h-32 bg-gray-200 rounded-lg border border-dashed border-gray-400 flex items-center justify-center text-gray-500">
                  No image selected
                </div>
              )}
            </div>
            
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  className={`flex-1 ${formControlSmall}`}
                  placeholder="Choose image from library/upload"
                  value={imgItem.image || ""}
                  readOnly
                />
                <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors" onClick={() => openImagePicker("featured_long_images", i)}>Choose</button>
              </div>
              <input
                className={formControl}
                placeholder="Title"
                value={imgItem.title || ""}
                onChange={(e) => handleFeaturedLongImagesChange(i, 'title', e.target.value)}
              />
              <textarea
                className={formControl}
                placeholder="Description"
                value={imgItem.description || ""}
                onChange={(e) => handleFeaturedLongImagesChange(i, 'description', e.target.value)}
              />
            </div>
          </div>
        ))}
      </section>

      {/* Payment Settings */}
      <section className="mb-6 bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Payment Settings</h2>
        <div className="bg-gray-50 rounded-lg p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">PayRex Phone Number</label>
          <input
            className={formControl}
            placeholder="e.g. 0917xxxxxxx"
            value={content.payment?.payrex_phone || content.payment?.payrex_number || ""}
            onChange={(e) => handlePaymentChange('payrex_phone', e.target.value)}
          />
        </div>
      </section>

      {/* Services */}
      <section className="mb-6 bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Service We Offer</h2>
        <div className="bg-gray-50 rounded-lg p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
            <input 
              className={formControl} 
              value={content.services?.title || ""} 
              onChange={(e) => handleServicesChange('title', e.target.value)} 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea 
              className={formControl} 
              value={content.services?.description || ""} 
              onChange={(e) => handleServicesChange('description', e.target.value)} 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Button Text / Link</label>
            <div className="flex gap-2">
              <input 
                className={`flex-1 ${formControlSmall}`} 
                placeholder="Button Text" 
                value={content.services?.buttonText || ""} 
                onChange={(e) => handleServicesChange('buttonText', e.target.value)} 
              />
              <input 
                className={`flex-1 ${formControlSmall}`} 
                placeholder="Button Link" 
                value={content.services?.buttonLink || ""} 
                onChange={(e) => handleServicesChange('buttonLink', e.target.value)} 
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Carousel Images (4)</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              {(content.services?.images || []).map((img, i) => (
                <div key={i} className="relative group">
                  {img ? (
                    <img src={img} alt={`Service ${i + 1}`} className="w-full h-24 object-cover rounded-lg border border-gray-300" />
                  ) : (
                    <div className="w-full h-24 bg-gray-200 rounded-lg border border-dashed border-gray-400 flex items-center justify-center text-gray-500 text-xs">
                      No image
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
                    <button className="px-2 py-1 bg-blue-600 text-white text-xs rounded" onClick={() => openImagePicker("services.images", i)}>Change</button>
                    <button className="px-2 py-1 bg-red-600 text-white text-xs rounded" onClick={() => { 
                      const imgs = (content.services?.images || []).slice(); 
                      imgs.splice(i, 1); 
                      setContent({ ...content, services: { ...(content.services || {}), images: imgs } }); 
                    }}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
            {(content.services?.images || []).map((img, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input 
                  className={`flex-1 ${formControlSmall}`} 
                  value={img || ""} 
                  readOnly
                  placeholder={`Image ${i + 1} URL`}
                />
                <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors" onClick={() => openImagePicker("services.images", i)}>Choose</button>
                <button className="text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-1 rounded-lg transition-colors" onClick={() => { 
                  const imgs = (content.services?.images || []).slice(); 
                  imgs.splice(i, 1); 
                  setContent({ ...content, services: { ...(content.services || {}), images: imgs } }); 
                }}>🗑 Remove</button>
              </div>
            ))}
            <div>
              <button onClick={() => { 
                const imgs = [...(content.services?.images || []), ""]; 
                setContent({ ...content, services: { ...(content.services || {}), images: imgs } }); 
              }} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg shadow transition-colors text-sm">+ Add Image</button>
            </div>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="mb-6 bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">ABOUT GRAND EAST</h2>
        <div className="bg-gray-50 rounded-lg p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Logo Image</label>
            {/* Logo Preview */}
            <div className="mb-3">
              {content.about?.logo ? (
                <img
                  src={content.about.logo}
                  alt="Logo"
                  className="h-20 object-contain rounded-lg border border-gray-300 bg-white p-2"
                />
              ) : (
                <div className="h-20 w-40 bg-gray-200 rounded-lg border border-dashed border-gray-400 flex items-center justify-center text-gray-500 text-sm">
                  No logo
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <input 
                className={`flex-1 ${formControlSmall}`} 
                value={content.about?.logo || ""} 
                readOnly
              />
              <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors" onClick={() => openImagePicker("about.logo")}>Choose</button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
            <input 
              className={formControl} 
              value={content.about?.title || ""} 
              onChange={(e) => handleAboutChange('title', e.target.value)} 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea 
              className={formControl} 
              value={content.about?.description || ""} 
              onChange={(e) => handleAboutChange('description', e.target.value)} 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Button Text / Link</label>
            <div className="flex gap-2">
              <input 
                className={`flex-1 ${formControlSmall}`} 
                placeholder="Button Text" 
                value={content.about?.buttonText || ""} 
                onChange={(e) => handleAboutChange('buttonText', e.target.value)} 
              />
              <input 
                className={`flex-1 ${formControlSmall}`} 
                placeholder="Button Link" 
                value={content.about?.buttonLink || ""} 
                onChange={(e) => handleAboutChange('buttonLink', e.target.value)} 
              />
            </div>
          </div>
        </div>
      </section>

      {/* Image picker modal / inline panel */}
      {picker?.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white max-w-4xl w-full p-6 rounded-xl shadow-2xl border border-gray-200">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-gray-800">Choose Image</h3>
              <button onClick={closePicker} className="bg-gray-400 hover:bg-gray-500 text-white px-4 py-2 rounded-lg transition-colors">Close</button>
            </div>

            {/* Upload form */}
            <div className="mb-4 bg-gray-50 rounded-lg p-4 flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700">Upload from your computer:</label>
              {/* accept AVIF explicitly and fallback to image/* */}
              <input type="file" accept="image/*,.avif" onChange={handleFileUpload} className="text-gray-800" />
              {uploading ? <span className="text-sm text-blue-600">📤 Uploading...</span> : null}
            </div>

            <div className="grid grid-cols-4 gap-3 max-h-64 overflow-auto">
              {images.length === 0 ? <div className="col-span-4 text-center py-8 text-gray-500">No images found in storage bucket "{BUCKET_NAME}". Upload images to Supabase Storage or change BUCKET_NAME.</div> : null}
              {images.map((img) => (
                <button key={img.name} onClick={() => handleSelectImage(img.url)} className="border border-gray-200 rounded-lg overflow-hidden hover:border-blue-500 hover:shadow-md transition-all">
                  <img src={img.url} alt={img.name} className="w-full h-24 object-cover" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 flex items-center justify-end gap-4">
        {error ? <div className="text-red-600 bg-red-50 px-4 py-2 rounded-lg border border-red-200">{error}</div> : null}
        <button onClick={save} disabled={saving} className="px-6 py-3 rounded-lg font-semibold shadow transition bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed">
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </div>
  );
}