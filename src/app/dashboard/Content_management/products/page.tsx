"use client";

import { useEffect, useState } from "react";
import { logActivity } from "@/app/lib/activity";

type ProductPageHero = {
  title: string;
  subtitle: string;
  image: string;
};

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
            <label className="block text-sm font-medium text-gray-700 mb-1">Background Image URL</label>
            <input
              type="text"
              value={heroContent.image}
              onChange={(e) => setHeroContent((prev) => ({ ...prev, image: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900"
              placeholder="https://..."
            />
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
