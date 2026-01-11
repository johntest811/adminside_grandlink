"use client";

import React, { useEffect, useMemo, useState } from "react";

type AdminSession = {
  id: string;
  username: string;
  role?: string;
  position?: string;
};

type RbacPage = {
  key: string;
  name: string;
  path: string;
  group_name?: string | null;
};

type RbacPosition = {
  name: string;
  description?: string | null;
  pageKeys: string[];
};

export default function RolesAndPermissionsPage() {
  const [currentAdmin, setCurrentAdmin] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState<RbacPage[]>([]);
  const [positions, setPositions] = useState<RbacPosition[]>([]);
  const [selectedPosition, setSelectedPosition] = useState<string>("");
  const [selectedPageKeys, setSelectedPageKeys] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [newPositionName, setNewPositionName] = useState("");
  const [newPositionDescription, setNewPositionDescription] = useState("");

  const norm = (v?: string) => String(v || "").toLowerCase().replace(/[\s_-]/g, "");
  const isSuperadmin =
    norm(currentAdmin?.role) === "superadmin" || norm(currentAdmin?.position) === "superadmin";

  useEffect(() => {
    try {
      const raw = localStorage.getItem("adminSession");
      if (raw) {
        setCurrentAdmin(JSON.parse(raw));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAll = async () => {
    const [pagesRes, positionsRes] = await Promise.all([
      fetch("/api/rbac/pages"),
      fetch("/api/rbac/positions"),
    ]);

    if (!pagesRes.ok) {
      const j = await pagesRes.json().catch(() => ({}));
      throw new Error(j?.error || "Failed to load pages");
    }
    if (!positionsRes.ok) {
      const j = await positionsRes.json().catch(() => ({}));
      throw new Error(j?.error || "Failed to load positions");
    }

    const pagesJson = await pagesRes.json();
    const positionsJson = await positionsRes.json();

    setPages(pagesJson.pages || []);
    setPositions(positionsJson.positions || []);

    // Pick a valid selected position.
    const names: string[] = Array.isArray(positionsJson.positions)
      ? positionsJson.positions.map((p: any) => String(p?.name || "")).filter(Boolean)
      : [];
    const firstName = names[0] || "";
    setSelectedPosition((prev) => {
      if (prev && names.includes(prev)) return prev;
      return firstName;
    });
  };

  useEffect(() => {
    if (!loading && isSuperadmin) {
      fetchAll().catch((e) => alert(e.message));
    }
  }, [loading, isSuperadmin]);

  useEffect(() => {
    const pos = positions.find((p) => p.name === selectedPosition);
    setSelectedPageKeys(new Set(pos?.pageKeys || []));
  }, [positions, selectedPosition]);

  const pagesByGroup = useMemo(() => {
    const grouped = new Map<string, RbacPage[]>();
    for (const p of pages) {
      const group = p.group_name || "Other";
      const list = grouped.get(group) || [];
      list.push(p);
      grouped.set(group, list);
    }
    return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [pages]);

  const toggle = (pageKey: string) => {
    setSelectedPageKeys((prev) => {
      const next = new Set(prev);
      if (next.has(pageKey)) next.delete(pageKey);
      else next.add(pageKey);
      return next;
    });
  };

  const saveAssignments = async () => {
    if (!selectedPosition) return;
    if (!currentAdmin?.id) return;

    setSaving(true);
    try {
      const res = await fetch(
        `/api/rbac/positions/${encodeURIComponent(selectedPosition)}/pages`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-admin-id": currentAdmin.id,
          },
          body: JSON.stringify({ pageKeys: Array.from(selectedPageKeys) }),
        }
      );

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Failed to save permissions");

      await fetchAll();
      alert("Permissions saved.");
    } finally {
      setSaving(false);
    }
  };

  const deleteSelectedPosition = async () => {
    if (!currentAdmin?.id) return;
    if (!selectedPosition) return;

    const selectedNorm = norm(selectedPosition);
    if (selectedNorm === "superadmin") {
      alert("The Superadmin position cannot be deleted.");
      return;
    }

    const ok = window.confirm(
      `Delete position "${selectedPosition}"? This will also remove its page permissions.`
    );
    if (!ok) return;

    setDeleting(true);
    try {
      const res = await fetch(
        `/api/rbac/positions?name=${encodeURIComponent(selectedPosition)}`,
        {
          method: "DELETE",
          headers: {
            "x-admin-id": currentAdmin.id,
          },
        }
      );

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Failed to delete position");

      // Clear selection first, then refresh (fetchAll will pick first remaining).
      setSelectedPosition("");
      await fetchAll();
      alert("Position deleted.");
    } finally {
      setDeleting(false);
    }
  };

  const createPosition = async () => {
    if (!currentAdmin?.id) return;

    const name = newPositionName.trim();
    if (!name) {
      alert("Position name is required.");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/rbac/positions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-id": currentAdmin.id,
        },
        body: JSON.stringify({
          name,
          description: newPositionDescription.trim() || null,
        }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Failed to create position");

      setNewPositionName("");
      setNewPositionDescription("");
      await fetchAll();
      setSelectedPosition(name);
      alert("Position created.");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
      </div>
    );
  }

  if (!currentAdmin) {
    return <div className="text-black">No admin session found.</div>;
  }

  if (!isSuperadmin) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h1 className="text-xl font-semibold text-gray-900">Roles & Permissions</h1>
        <p className="mt-2 text-gray-700">Only Superadmins can manage roles and permissions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Roles & Permissions</h1>
        <button
          onClick={() => fetchAll().catch((e) => alert(e.message))}
          className="px-3 py-2 bg-black text-white rounded"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Create + select position */}
        <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
          <div>
            <div className="text-sm font-semibold text-gray-800">Create Position</div>
            <div className="mt-2 space-y-2">
              <input
                className="w-full p-2 border rounded text-black"
                placeholder="Position name (e.g. Content Editor)"
                value={newPositionName}
                onChange={(e) => setNewPositionName(e.target.value)}
              />
              <input
                className="w-full p-2 border rounded text-black"
                placeholder="Description (optional)"
                value={newPositionDescription}
                onChange={(e) => setNewPositionDescription(e.target.value)}
              />
              <button
                disabled={creating}
                onClick={() => createPosition().catch((e) => alert(e.message))}
                className="w-full px-3 py-2 bg-indigo-600 text-white rounded disabled:opacity-60"
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>

          <hr />

          <div>
            <div className="text-sm font-semibold text-gray-800">Select Position</div>
            <select
              className="mt-2 w-full p-2 border rounded text-black"
              value={selectedPosition}
              onChange={(e) => setSelectedPosition(e.target.value)}
            >
              {positions.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="mt-2 text-xs text-gray-600">
              Assign which pages this position can access.
            </div>
          </div>

          <button
            disabled={deleting || !selectedPosition}
            onClick={() => deleteSelectedPosition().catch((e) => alert(e.message))}
            className="px-3 py-2 border border-red-300 text-red-700 rounded disabled:opacity-60"
          >
            {deleting ? "Deleting..." : "Delete Position"}
          </button>

          <button
            disabled={saving || !selectedPosition}
            onClick={() => saveAssignments().catch((e) => alert(e.message))}
            className="px-3 py-2 bg-black text-white rounded disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Permissions"}
          </button>
        </div>

        {/* Right: Permissions matrix */}
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600">Editing position</div>
              <div className="text-lg font-semibold text-gray-900">{selectedPosition || "—"}</div>
            </div>
            <div className="text-sm text-gray-600">
              Selected: <span className="font-semibold">{selectedPageKeys.size}</span>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {pagesByGroup.map(([group, groupPages]) => (
              <div key={group} className="border border-gray-100 rounded p-3">
                <div className="text-sm font-semibold text-gray-800 mb-2">{group}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {groupPages.map((p) => (
                    <label
                      key={p.key}
                      className="flex items-start gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selectedPageKeys.has(p.key)}
                        onChange={() => toggle(p.key)}
                      />
                      <div>
                        <div className="text-sm text-gray-900">{p.name}</div>
                        <div className="text-xs text-gray-500">{p.path}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}

            {pages.length === 0 && (
              <div className="text-sm text-gray-600">No pages found. Apply the SQL seed first.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
