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

type AdminListRow = {
  id: string;
  username: string;
  role?: string | null;
  position?: string | null;
  is_active?: boolean | null;
};

export default function RolesAndPermissionsPage() {
  const [currentAdmin, setCurrentAdmin] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [allowedPaths, setAllowedPaths] = useState<string[] | null>(null);
  const [pages, setPages] = useState<RbacPage[]>([]);
  const [positions, setPositions] = useState<RbacPosition[]>([]);
  const [selectedPosition, setSelectedPosition] = useState<string>("");
  const [selectedPageKeys, setSelectedPageKeys] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [newPositionName, setNewPositionName] = useState("");
  const [newPositionDescription, setNewPositionDescription] = useState("");

  // Admin overrides UI
  const [mode, setMode] = useState<"positions" | "admins">("positions");
  const [admins, setAdmins] = useState<AdminListRow[]>([]);
  const [selectedAdminId, setSelectedAdminId] = useState<string>("");
  const [adminOverrideKeys, setAdminOverrideKeys] = useState<Set<string>>(new Set());
  const [adminPositionKeys, setAdminPositionKeys] = useState<Set<string>>(new Set());
  const [adminHasWildcardAccess, setAdminHasWildcardAccess] = useState(false);
  const [savingAdminOverrides, setSavingAdminOverrides] = useState(false);

  const norm = (v?: string) => String(v || "").toLowerCase().replace(/[\s_-]/g, "");
  const isSuperadmin =
    norm(currentAdmin?.role) === "superadmin" || norm(currentAdmin?.position) === "superadmin";

  const canViewRoles = useMemo(() => {
    if (isSuperadmin) return true;
    return Array.isArray(allowedPaths) && allowedPaths.includes("/dashboard/settings/roles");
  }, [allowedPaths, isSuperadmin]);

  const canManageAdminOverrides = useMemo(() => {
    if (isSuperadmin) return true;
    return (
      Array.isArray(allowedPaths) &&
      allowedPaths.includes("/dashboard/settings/roles#admin-overrides")
    );
  }, [allowedPaths, isSuperadmin]);

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

  useEffect(() => {
    const loadAllowed = async () => {
      try {
        if (!currentAdmin?.id) return;
        const res = await fetch(
          `/api/rbac/allowed-pages?adminId=${encodeURIComponent(currentAdmin.id)}`
        );
        if (!res.ok) {
          setAllowedPaths(["/dashboard"]);
          return;
        }
        const j = await res.json().catch(() => ({}));
        setAllowedPaths(Array.isArray(j?.allowedPaths) ? j.allowedPaths : ["/dashboard"]);
      } catch {
        setAllowedPaths(["/dashboard"]);
      }
    };

    if (!currentAdmin?.id) return;
    if (isSuperadmin) {
      setAllowedPaths(["*"]);
      return;
    }
    loadAllowed();
  }, [currentAdmin?.id, isSuperadmin]);

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

  const fetchAdmins = async () => {
    if (!currentAdmin?.id) return;
    const res = await fetch("/api/rbac/admins", {
      headers: {
        "x-admin-id": currentAdmin.id,
      },
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error || "Failed to load admins");
    const list: AdminListRow[] = Array.isArray(j?.admins) ? j.admins : [];
    setAdmins(list);
    setSelectedAdminId((prev) => {
      if (prev && list.some((a) => a.id === prev)) return prev;
      return list[0]?.id || "";
    });
  };

  const loadAdminPermissionState = async (adminId: string) => {
    if (!currentAdmin?.id) return;

    const selectedAdmin = admins.find((a) => a.id === adminId);
    const selectedAdminPosition = selectedAdmin?.position || "";
    const positionRow = positions.find((p) => p.name === selectedAdminPosition);
    setAdminPositionKeys(new Set(positionRow?.pageKeys || []));

    // Load override keys
    const overridesRes = await fetch(
      `/api/rbac/admins/${encodeURIComponent(adminId)}/page-overrides`,
      {
        headers: {
          "x-admin-id": currentAdmin.id,
        },
      }
    );
    const overridesJson = await overridesRes.json().catch(() => ({}));
    if (!overridesRes.ok) {
      throw new Error(overridesJson?.error || "Failed to load admin overrides");
    }
    const overrideKeys: string[] = Array.isArray(overridesJson?.pageKeys)
      ? overridesJson.pageKeys
      : [];
    setAdminOverrideKeys(new Set(overrideKeys));

    // Load effective paths (we only need wildcard/full-access detection here)
    const effRes = await fetch(
      `/api/rbac/allowed-pages?adminId=${encodeURIComponent(adminId)}`
    );
    const effJson = await effRes.json().catch(() => ({}));
    const effPaths: string[] = Array.isArray(effJson?.allowedPaths)
      ? effJson.allowedPaths
      : [];

    // Wildcard means full access.
    if (effPaths.includes("*")) {
      setAdminHasWildcardAccess(true);
      return;
    }

    setAdminHasWildcardAccess(false);
  };

  useEffect(() => {
    if (!loading && currentAdmin && (isSuperadmin || allowedPaths !== null)) {
      if (!canViewRoles) return;
      fetchAll().catch((e) => alert(e.message));
    }
  }, [allowedPaths, canViewRoles, currentAdmin, isSuperadmin, loading]);

  useEffect(() => {
    if (!canViewRoles) return;
    if (mode !== "admins") return;
    if (!currentAdmin?.id) return;

    // Admin dropdown is only needed in admin override mode.
    fetchAdmins().catch((e) => alert(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, canViewRoles, currentAdmin?.id]);

  useEffect(() => {
    if (!canViewRoles) return;
    if (mode !== "admins") return;
    if (!selectedAdminId) return;
    if (!pages.length) return;
    if (!positions.length) return;
    if (!admins.length) return;
    loadAdminPermissionState(selectedAdminId).catch((e) => alert(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedAdminId, pages.length, positions.length, admins.length, canViewRoles]);

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

  const adminEffectiveComputedKeys = useMemo(() => {
    if (mode !== "admins") return new Set<string>();
    if (adminHasWildcardAccess) return new Set(pages.map((p) => p.key));
    const merged = new Set<string>();
    for (const k of adminPositionKeys) merged.add(k);
    for (const k of adminOverrideKeys) merged.add(k);
    return merged;
  }, [adminHasWildcardAccess, adminOverrideKeys, adminPositionKeys, mode, pages]);

  const toggle = (pageKey: string) => {
    setSelectedPageKeys((prev) => {
      const next = new Set(prev);
      if (next.has(pageKey)) next.delete(pageKey);
      else next.add(pageKey);
      return next;
    });
  };

  const toggleAdminOverride = (pageKey: string) => {
    setAdminOverrideKeys((prev) => {
      const next = new Set(prev);
      if (next.has(pageKey)) next.delete(pageKey);
      else next.add(pageKey);
      return next;
    });
  };

  const saveAdminOverrides = async () => {
    if (!currentAdmin?.id) return;
    if (!selectedAdminId) return;

    if (!canManageAdminOverrides) {
      alert("You do not have permission to manage admin overrides.");
      return;
    }

    setSavingAdminOverrides(true);
    try {
      const res = await fetch(
        `/api/rbac/admins/${encodeURIComponent(selectedAdminId)}/page-overrides`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "x-admin-id": currentAdmin.id,
          },
          body: JSON.stringify({ pageKeys: Array.from(adminOverrideKeys) }),
        }
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Failed to save admin overrides");

      await loadAdminPermissionState(selectedAdminId);
      alert("Admin permissions saved.");
    } finally {
      setSavingAdminOverrides(false);
    }
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

  if (!canViewRoles) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h1 className="text-xl font-semibold text-gray-900">Roles & Permissions</h1>
        <p className="mt-2 text-gray-700">You do not have access to this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Roles & Permissions</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMode("positions")}
            className={`px-3 py-2 rounded border ${
              mode === "positions"
                ? "bg-black text-white border-black"
                : "bg-white text-gray-900 border-gray-300"
            }`}
          >
            Position Permissions
          </button>
          <button
            onClick={() => setMode("admins")}
            className={`px-3 py-2 rounded border ${
              mode === "admins"
                ? "bg-black text-white border-black"
                : "bg-white text-gray-900 border-gray-300"
            }`}
          >
            Admin Overrides
          </button>
          <button
            onClick={() => {
              fetchAll().catch((e) => alert(e.message));
              if (mode === "admins") fetchAdmins().catch((e) => alert(e.message));
            }}
            className="px-3 py-2 bg-black text-white rounded"
          >
            Refresh
          </button>
        </div>
      </div>

      {mode === "admins" && (
        <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-end gap-3">
            <div className="flex-1">
              <div className="text-sm font-semibold text-gray-800">Select Admin Account</div>
              <select
                className="mt-2 w-full p-2 border rounded text-black"
                value={selectedAdminId}
                onChange={(e) => setSelectedAdminId(e.target.value)}
              >
                {admins.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.username} {a.position ? `(${a.position})` : ""}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-xs text-gray-600">
                Effective permissions include the admin’s position permissions + any overrides.
              </div>
            </div>

            <div className="min-w-[240px]">
              <div className="text-sm text-gray-700">
                Effective: <span className="font-semibold">{adminEffectiveComputedKeys.size}</span>
              </div>
              <div className="text-sm text-gray-700">
                Overrides: <span className="font-semibold">{adminOverrideKeys.size}</span>
              </div>
              <button
                disabled={!canManageAdminOverrides || savingAdminOverrides || !selectedAdminId}
                onClick={() => saveAdminOverrides().catch((e) => alert(e.message))}
                className="mt-2 w-full px-3 py-2 bg-indigo-600 text-white rounded disabled:opacity-60"
              >
                {savingAdminOverrides ? "Saving..." : "Save Admin Overrides"}
              </button>
              {adminHasWildcardAccess && (
                <div className="mt-2 text-xs text-gray-600">
                  This admin has full access. Checkboxes reflect “Admin Overrides” only.
                </div>
              )}
              {!canManageAdminOverrides && (
                <div className="mt-2 text-xs text-gray-600">
                  Read-only: you don’t have the “Roles - Admin Overrides” permission.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Create + select position */}
        <div
          className={`bg-white border border-gray-200 rounded-lg p-5 space-y-4 ${
            mode === "admins" ? "opacity-60 pointer-events-none" : ""
          }`}
        >
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
              <div className="text-sm text-gray-600">
                {mode === "admins" ? "Admin override editor" : "Editing position"}
              </div>
              <div className="text-lg font-semibold text-gray-900">
                {mode === "admins"
                  ? admins.find((a) => a.id === selectedAdminId)?.username || "—"
                  : selectedPosition || "—"}
              </div>
            </div>
            <div className="text-sm text-gray-600">
              {mode === "admins" ? (
                <>
                  Overrides selected: <span className="font-semibold">{adminOverrideKeys.size}</span>
                </>
              ) : (
                <>
                  Selected: <span className="font-semibold">{selectedPageKeys.size}</span>
                </>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {pagesByGroup.map(([group, groupPages]) => (
              <div key={group} className="border border-gray-100 rounded p-3">
                <div className="text-sm font-semibold text-gray-800 mb-2">{group}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {groupPages.map((p) => (
                    (() => {
                      const isPositionGranted = mode === "admins" && adminPositionKeys.has(p.key);
                      const isOverrideGranted = mode === "admins" && adminOverrideKeys.has(p.key);
                      const isEffectiveGranted =
                        mode === "admins" && adminEffectiveComputedKeys.has(p.key);

                      // In wildcard/full-access mode, show only explicit overrides as checked so they can be removed.
                      const isChecked =
                        mode === "admins"
                          ? adminHasWildcardAccess
                            ? isOverrideGranted
                            : isPositionGranted || isOverrideGranted
                          : selectedPageKeys.has(p.key);

                      // Overrides are additive; you can't remove position-granted access via overrides.
                      const isDisabled =
                        mode === "admins" ? !canManageAdminOverrides || (!adminHasWildcardAccess && isPositionGranted) : false;

                      return (
                    <label
                      key={p.key}
                      className="flex items-start gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={isChecked}
                        disabled={isDisabled}
                        onChange={() => {
                          if (mode !== "admins") {
                            toggle(p.key);
                            return;
                          }
                          if (!adminHasWildcardAccess && isPositionGranted) return;
                          toggleAdminOverride(p.key);
                        }}
                      />
                      <div>
                        <div className="text-sm text-gray-900">{p.name}</div>
                        <div className="text-xs text-gray-500">{p.path}</div>
                        {mode === "admins" && (isPositionGranted || isOverrideGranted || isEffectiveGranted) && (
                          <div className="text-xs text-green-700">
                            {isPositionGranted
                              ? "Granted by position"
                              : isOverrideGranted
                                ? "Granted by override"
                                : "Effective for this admin"}
                          </div>
                        )}
                      </div>
                    </label>
                      );
                    })()
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
