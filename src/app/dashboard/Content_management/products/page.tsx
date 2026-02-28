"use client";

import { useEffect, useState } from "react";
import { logActivity } from "@/app/lib/activity";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";

type ProductPageHero = {
  title: string;
  subtitle: string;
  image: string;
};

const BUCKET_NAME = "uploads";

export default function AdminProductsPageContent() {
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [heroContent, setHeroContent] = useState<ProductPageHero>({
    title: "Top Selling Products",
    subtitle:
      "Explore our premium selection of products at Grand East, designed to elevate both residential and commercial spaces.",
    image: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    const loadAdmin = async () => {
      try {
        const sessionData = localStorage.getItem("adminSession");
        if (!sessionData) return;

        const admin = JSON.parse(sessionData);
        setCurrentAdmin(admin);

        await logActivity({
          admin_id: admin.id,
          admin_name: admin.username,
          action: "view",
          entity_type: "page",
          details: `Admin ${admin.username} accessed Products Page content editor`,
          page: "Products",
          metadata: {
            section: "products_page_hero",
            adminAccount: admin.username,
            adminId: admin.id,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (error) {
        console.error("Error loading admin session", error);
      }
    };

    loadAdmin();
  }, []);

  useEffect(() => {
    const loadHeroContent = async () => {
      if (!currentAdmin) return;
      try {
        const siteBase = (process.env.NEXT_PUBLIC_WEBSITE_URL || "").replace(/\/$/, "");
        const apiUrl = siteBase ? `${siteBase}/api/home` : "/api/home";
        const response = await fetch(apiUrl, { credentials: "include" });
        if (!response.ok) return;

        const payload = await response.json();
        const content = payload?.content ?? payload ?? {};
        const hero = content?.product_page_hero;

        if (hero && typeof hero === "object") {
          setHeroContent((prev) => ({
            ...prev,
            title: typeof hero.title === "string" && hero.title.trim() ? hero.title : prev.title,
            subtitle: typeof hero.subtitle === "string" ? hero.subtitle : prev.subtitle,
            image: typeof hero.image === "string" ? hero.image : prev.image,
          }));
        }
      } catch (error) {
        console.error("Failed to load product hero content", error);
      } finally {
        setLoading(false);
      }
    };

    loadHeroContent();
  }, [currentAdmin]);

  const saveHeroContent = async () => {
    if (!currentAdmin) return;
    setSaving(true);
    try {
      const siteBase = (process.env.NEXT_PUBLIC_WEBSITE_URL || "").replace(/\/$/, "");
      const apiUrl = siteBase ? `${siteBase}/api/home` : "/api/home";

      const currentResponse = await fetch(apiUrl, { credentials: "include" });
      const currentPayload = currentResponse.ok ? await currentResponse.json() : {};
      const currentContent = currentPayload?.content ?? currentPayload ?? {};

      const nextContent = {
        ...currentContent,
        product_page_hero: {
          title: heroContent.title,
          subtitle: heroContent.subtitle,
          image: heroContent.image,
        },
      };

      const saveResponse = await fetch(apiUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(nextContent),
      });

      if (!saveResponse.ok) {
        const text = await saveResponse.text();
        throw new Error(text || "Failed to save Products page content");
      }

      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: "update",
        entity_type: "products_page_hero",
        details: `Admin ${currentAdmin.username} updated Products page hero section`,
        page: "Products",
        metadata: {
          title: heroContent.title,
          hasImage: Boolean(heroContent.image),
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString(),
        },
      });

      alert("Products page content saved successfully.");
    } catch (error: any) {
      alert(error?.message || "Failed to save Products page content");
    } finally {
      setSaving(false);
    }
  };

  const uploadToBucket = async (file: File) => {
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const filePath = `products-hero/${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file, { upsert: true, contentType: file.type });

    if (uploadError) throw uploadError;

    const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
    return `${base}/storage/v1/object/public/${BUCKET_NAME}/${encodeURIComponent(filePath)}`;
  };

  const handleHeroImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentAdmin) return;

    setUploadingImage(true);
    try {
      const url = await uploadToBucket(file);
      setHeroContent((prev) => ({ ...prev, image: url }));

      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: "upload",
        entity_type: "products_page_hero_image",
        details: `Admin ${currentAdmin.username} uploaded Products page hero image: ${file.name}`,
        page: "Products",
        metadata: {
          fileName: file.name,
          fileSize: file.size,
          imageUrl: url,
          adminAccount: currentAdmin.username,
          adminId: currentAdmin.id,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      alert(error?.message || "Failed to upload image");
    } finally {
      setUploadingImage(false);
      if (e.target) e.target.value = "";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-5xl mx-auto bg-white rounded-xl border border-gray-200 p-6 text-gray-700">
          Loading products page content...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto bg-white rounded-xl border border-gray-200 p-6">
        <h1 className="text-2xl font-bold text-gray-900">Products Page Content</h1>
        <p className="text-sm text-gray-600 mt-1 mb-6">
          Edit the hero section shown above the products listing page.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={heroContent.title}
              onChange={(e) => setHeroContent((prev) => ({ ...prev, title: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              placeholder="Top Selling Products"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              rows={5}
              value={heroContent.subtitle}
              onChange={(e) => setHeroContent((prev) => ({ ...prev, subtitle: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              placeholder="Hero description"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Background Image Upload</label>
            <input
              type="file"
              accept="image/*"
              onChange={handleHeroImageUpload}
              disabled={uploadingImage}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-2"
            />
            <p className="mt-1 text-xs text-gray-500">
              Upload from your computer. The file will be stored in Supabase and linked automatically.
            </p>
            {heroContent.image ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={heroContent.image}
                  readOnly
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700 bg-gray-50"
                />
                <button
                  type="button"
                  onClick={() => setHeroContent((prev) => ({ ...prev, image: "" }))}
                  className="px-3 py-2 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Clear
                </button>
              </div>
            ) : null}
            {uploadingImage ? <div className="mt-2 text-xs text-gray-500">Uploading image...</div> : null}
          </div>
        </div>

        {heroContent.image ? (
          <div className="mt-6">
            <div className="text-sm font-medium text-gray-700 mb-2">Preview</div>
            <div className="w-full h-56 rounded-lg overflow-hidden border border-gray-200 bg-gray-100">
              <img src={heroContent.image} alt="Products hero preview" className="w-full h-full object-cover" />
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={saveHeroContent}
            disabled={saving}
            className="bg-[#8B1C1C] hover:bg-[#7a1919] text-white px-6 py-2.5 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
