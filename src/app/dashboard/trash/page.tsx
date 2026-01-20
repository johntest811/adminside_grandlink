"use client";

import { useEffect, useMemo, useState } from "react";
import { logActivity } from "@/app/lib/activity";

type ArchivedProduct = {
  id: string; // archive row id
  product_id: string;
  product_name: string | null;
  product_category: string | null;
  product_price: number | null;
  archived_at: string;
  archived_by: string | null;
  archived_by_name: string | null;
};

export default function InventoryTrashPage() {
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [items, setItems] = useState<ArchivedProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

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
          details: "Accessed Inventory Archive/Trashcan page",
          page: "inventory/trash",
          metadata: {
            pageAccess: true,
            adminAccount: admin.username,
            timestamp: new Date().toISOString(),
          },
        });
      } catch (e) {
        console.error("Error loading admin session", e);
      }
    };

    loadAdmin();
  }, []);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
      const res = await fetch(`/api/products-archive${qs}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setItems(Array.isArray(json?.items) ? json.items : []);
    } catch (e: any) {
      console.error("Failed to load archive", e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const name = (it.product_name || "").toLowerCase();
      const cat = (it.product_category || "").toLowerCase();
      return name.includes(q) || cat.includes(q);
    });
  }, [items, query]);

  const permanentlyDelete = async (archiveId: string, label: string) => {
    if (!currentAdmin) {
      alert("Error: Admin not loaded");
      return;
    }

    if (!confirm(`Permanently delete "${label}"? This will also remove any stored images/FBX files.`)) {
      return;
    }

    setDeletingId(archiveId);
    try {
      const res = await fetch(`/api/products-archive/${archiveId}`, {
        method: "DELETE",
        headers: {
          Authorization: JSON.stringify({ id: currentAdmin.id, username: currentAdmin.username }),
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      setItems((prev) => prev.filter((x) => x.id !== archiveId));

      try {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "delete",
          entity_type: "products_archive",
          entity_id: archiveId,
          details: `Permanently deleted archived product: ${label}`,
          page: "inventory/trash",
          metadata: { archiveId, label },
        });
      } catch {}
    } catch (e: any) {
      console.error("Permanent delete failed", e);
      alert(`❌ Failed to permanently delete: ${e.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const restoreProduct = async (archiveId: string, label: string) => {
    if (!currentAdmin) {
      alert("Error: Admin not loaded");
      return;
    }

    if (!confirm(`Restore "${label}" back to Products?`)) {
      return;
    }

    setRestoringId(archiveId);
    try {
      const res = await fetch(`/api/products-archive/${archiveId}`, {
        method: "POST",
        headers: {
          Authorization: JSON.stringify({ id: currentAdmin.id, username: currentAdmin.username }),
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      setItems((prev) => prev.filter((x) => x.id !== archiveId));

      try {
        await logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "update",
          entity_type: "products_archive",
          entity_id: archiveId,
          details: `Restored product from Archive/Trashcan: ${label}`,
          page: "inventory/trash",
          metadata: { archiveId, label, restoredId: json?.restoredId },
        });
      } catch {}

      alert(`✅ Restored "${label}" successfully.`);
    } catch (e: any) {
      console.error("Restore failed", e);
      alert(`❌ Failed to restore: ${e.message}`);
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-black">Archive / Trashcan</h1>
          <p className="text-sm text-gray-600">Products deleted from Update Products appear here until permanently deleted.</p>
        </div>
        <button
          onClick={fetchItems}
          className="px-4 py-2 rounded-md bg-gray-900 text-white hover:bg-black"
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      <div className="flex items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or category..."
          className="w-full max-w-md px-3 py-2 border rounded-md text-black"
        />
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="text-sm text-gray-700">
            {loading ? "Loading..." : `${filtered.length} item(s)`}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-700">
              <tr>
                <th className="text-left px-4 py-3">Product</th>
                <th className="text-left px-4 py-3">Category</th>
                <th className="text-left px-4 py-3">Price</th>
                <th className="text-left px-4 py-3">Archived At</th>
                <th className="text-left px-4 py-3">Archived By</th>
                <th className="text-right px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                    Trashcan is empty.
                  </td>
                </tr>
              )}

              {filtered.map((it) => {
                const label = it.product_name || it.product_id;
                return (
                  <tr key={it.id} className="border-t">
                    <td className="px-4 py-3 text-black font-medium">{label}</td>
                    <td className="px-4 py-3 text-gray-700">{it.product_category || "—"}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {typeof it.product_price === "number" ? `₱${Number(it.product_price).toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{it.archived_at ? new Date(it.archived_at).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3 text-gray-700">{it.archived_by_name || it.archived_by || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => restoreProduct(it.id, label)}
                        className="mr-2 px-3 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
                        disabled={restoringId === it.id || deletingId === it.id}
                      >
                        {restoringId === it.id ? "Restoring..." : "Restore"}
                      </button>
                      <button
                        onClick={() => permanentlyDelete(it.id, label)}
                        className="px-3 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                        disabled={deletingId === it.id || restoringId === it.id}
                      >
                        {deletingId === it.id ? "Deleting..." : "Delete permanently"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
