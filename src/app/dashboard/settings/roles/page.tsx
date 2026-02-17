"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

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

type AdminAccount = {
  id: string;
  username: string;
  role: "superadmin" | "admin" | "manager" | "employee";
  position?: string | null;
  full_name?: string | null;
  employee_number?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
  last_login?: string | null;
  password?: string | null;
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
  const [mode, setMode] = useState<"positions" | "admins" | "accounts">("positions");
  const [admins, setAdmins] = useState<AdminListRow[]>([]);
  const [selectedAdminId, setSelectedAdminId] = useState<string>("");
  const [adminOverrideKeys, setAdminOverrideKeys] = useState<Set<string>>(new Set());
  const [adminPositionKeys, setAdminPositionKeys] = useState<Set<string>>(new Set());
  const [adminHasWildcardAccess, setAdminHasWildcardAccess] = useState(false);
  const [savingAdminOverrides, setSavingAdminOverrides] = useState(false);

  // Admin accounts management (moved from Settings page)
  const [adminAccounts, setAdminAccounts] = useState<AdminAccount[]>([]);
  const [adminAccountsLoading, setAdminAccountsLoading] = useState(false);
  const [adminAccountSearch, setAdminAccountSearch] = useState("");
  const [creatingAdminAccount, setCreatingAdminAccount] = useState(false);
  const [pageSearch, setPageSearch] = useState("");
  const [newAdminAccount, setNewAdminAccount] = useState({
    username: "",
    password: "",
    role: "admin" as AdminAccount["role"],
    position: "Admin",
    full_name: "",
  });

  const hashToMode = (hash: string): typeof mode => {
    const h = (hash || "").replace(/^#/, "").trim().toLowerCase();
    if (h === "admin-overrides" || h === "overrides" || h === "admins") return "admins";
    if (h === "accounts" || h === "admin-accounts") return "accounts";
    return "positions";
  };

  const modeToHash = (m: typeof mode) => {
    if (m === "admins") return "admin-overrides";
    if (m === "accounts") return "accounts";
    return "positions";
  };

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
    try {
      const initial = hashToMode(window.location.hash);
      setMode(initial);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const nextHash = modeToHash(mode);
      if (window.location.hash.replace(/^#/, "") !== nextHash) {
        window.history.replaceState(null, "", `#${nextHash}`);
      }
    } catch {
      // ignore
    }
  }, [mode]);

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

  const positionOptions = useMemo(() => {
    const names = positions.map((p) => p.name).filter(Boolean);
    return names.length ? names : ["Admin", "Manager", "Employee", "Superadmin"];
  }, [positions]);

  const fetchAdminAccounts = async () => {
    setAdminAccountsLoading(true);
    try {
      const { data, error } = await supabase
        .from("admins")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setAdminAccounts((data as any) || []);
    } catch (e) {
      console.error("Load admin accounts error:", e);
      setAdminAccounts([]);
    } finally {
      setAdminAccountsLoading(false);
    }
  };

  const createAdminAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperadmin) {
      alert("Only a superadmin can manage admin accounts.");
      return;
    }
    if (!newAdminAccount.username || !newAdminAccount.password) {
      alert("Username and password are required.");
      return;
    }

    setCreatingAdminAccount(true);
    try {
      const payload = {
        username: newAdminAccount.username,
        password: newAdminAccount.password, // NOTE: stored as plain text per schema
        role: newAdminAccount.role,
        position: newAdminAccount.position,
        full_name: newAdminAccount.full_name || null,
        is_active: true,
      };
      const { error } = await supabase.from("admins").insert(payload);
      if (error) throw error;

      // Optional notification for audit/visibility
      await supabase.from("notifications").insert({
        title: "Admin created",
        message: `Admin "${newAdminAccount.username}" created with role "${newAdminAccount.role}".`,
        type: "general",
        recipient_role: "admin",
        metadata: { created_by: currentAdmin?.username || "system" },
      });

      setNewAdminAccount({
        username: "",
        password: "",
        role: "admin",
        position: "Admin",
        full_name: "",
      });
      await fetchAdminAccounts();
      alert("Admin account created.");
    } catch (e: any) {
      alert(`Create admin failed: ${e?.message || e}`);
    } finally {
      setCreatingAdminAccount(false);
    }
  };

  const toggleAdminAccountActive = async (a: AdminAccount) => {
    if (!isSuperadmin) {
      alert("Only a superadmin can manage admin accounts.");
      return;
    }
    try {
      const { error } = await supabase
        .from("admins")
        .update({ is_active: !a.is_active })
        .eq("id", a.id);
      if (error) throw error;
      await fetchAdminAccounts();
    } catch (e: any) {
      alert(`Update failed: ${e?.message || e}`);
    }
  };

  const updateAdminAccountField = async (
    id: string,
    changes: Partial<Pick<AdminAccount, "role" | "position" | "full_name">>
  ) => {
    if (!isSuperadmin) {
      alert("Only a superadmin can manage admin accounts.");
      return;
    }
    try {
      const { error } = await supabase.from("admins").update(changes).eq("id", id);
      if (error) throw error;
      await fetchAdminAccounts();
    } catch (e: any) {
      alert(`Update failed: ${e?.message || e}`);
    }
  };

  const resetAdminAccountPassword = async (a: AdminAccount) => {
    if (!isSuperadmin) {
      alert("Only a superadmin can manage admin accounts.");
      return;
    }
    const pw = window.prompt(
      `Enter new password for ${a.username}`,
      Math.random().toString(36).slice(2, 10)
    );
    if (!pw) return;
    try {
      const { error } = await supabase
        .from("admins")
        .update({ password: pw })
        .eq("id", a.id);
      if (error) throw error;
      alert("Password updated.");
    } catch (e: any) {
      alert(`Password reset failed: ${e?.message || e}`);
    }
  };

  const filteredAdminAccounts = useMemo(() => {
    const q = adminAccountSearch.trim().toLowerCase();
    if (!q) return adminAccounts;
    return adminAccounts.filter((a) =>
      [a.username, a.role, a.position, a.full_name, a.employee_number]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [adminAccountSearch, adminAccounts]);

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
  }, [mode, canViewRoles, currentAdmin?.id]);

  useEffect(() => {
    if (!canViewRoles) return;
    if (mode !== "accounts") return;
    if (!isSuperadmin) return;

    fetchAdminAccounts().catch((e) => alert(e.message));
  }, [mode, canViewRoles, isSuperadmin]);

  useEffect(() => {
    if (!canViewRoles) return;
    if (mode !== "admins") return;
    if (!selectedAdminId) return;
    if (!pages.length) return;
    if (!positions.length) return;
    if (!admins.length) return;
    loadAdminPermissionState(selectedAdminId).catch((e) => alert(e.message));
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

  const filteredPagesByGroup = useMemo(() => {
    const q = pageSearch.trim().toLowerCase();
    if (!q) return pagesByGroup;
    return pagesByGroup
      .map(([group, groupPages]) => {
        const filtered = groupPages.filter((p) => {
          const blob = `${p.name} ${p.path} ${p.key} ${p.group_name || ""}`.toLowerCase();
          return blob.includes(q);
        });
        return [group, filtered] as const;
      })
      .filter(([, groupPages]) => groupPages.length > 0);
  }, [pageSearch, pagesByGroup]);

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
        <h1 className="text-xl font-semibold text-gray-900">Access Control</h1>
        <p className="mt-2 text-gray-700">You do not have access to this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Access Control</h1>
            <p className="mt-1 text-sm text-gray-700">
              Manage who can access what. Use <span className="font-semibold">Position Permissions</span> as the default,
              then apply <span className="font-semibold">Give Additional permissions</span> for special cases.
              <span className="font-semibold"> Admin assign roles</span> is where you create/disable admins and assign their position.
            </p>
          </div>
          <button
            onClick={() => {
              fetchAll().catch((e) => alert(e.message));
              if (mode === "admins") fetchAdmins().catch((e) => alert(e.message));
              if (mode === "accounts") fetchAdminAccounts().catch((e) => alert(e.message));
            }}
            className="px-3 py-2 bg-black text-white rounded"
          >
            Refresh Data
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
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
            Give Additional permissions
          </button>
          <button
            onClick={() => setMode("accounts")}
            className={`px-3 py-2 rounded border ${
              mode === "accounts"
                ? "bg-black text-white border-black"
                : "bg-white text-gray-900 border-gray-300"
            }`}
          >
            Admin assign roles
          </button>

          <div className="ml-auto flex items-center gap-3 text-sm text-gray-700">
            <div>
              Pages: <span className="font-semibold">{pages.length}</span>
            </div>
            <div>
              Positions: <span className="font-semibold">{positions.length}</span>
            </div>
            <div>
              Admins: <span className="font-semibold">{admins.length}</span>
            </div>
          </div>
        </div>
      </div>

      {mode === "accounts" && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-semibold text-black">Admin assign roles</h2>
          <p className="text-sm text-gray-700">
            Create admins, assign their <span className="font-semibold">Position</span>, and manage access.
            Access to this tab is restricted to <span className="font-semibold">Superadmins</span>.
          </p>

          {!isSuperadmin ? (
            <div className="p-4 border rounded bg-gray-50 text-black">
              Only Superadmins can view and manage admin accounts.
            </div>
          ) : (
            <>
              <form
                onSubmit={createAdminAccount}
                className="grid grid-cols-1 md:grid-cols-5 gap-3"
              >
                <div>
                  <label className="block text-sm text-black mb-1">Username</label>
                  <input
                    className="w-full p-2 border rounded text-black"
                    value={newAdminAccount.username}
                    onChange={(e) =>
                      setNewAdminAccount({
                        ...newAdminAccount,
                        username: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm text-black mb-1">Password</label>
                  <input
                    type="password"
                    className="w-full p-2 border rounded text-black"
                    value={newAdminAccount.password}
                    onChange={(e) =>
                      setNewAdminAccount({
                        ...newAdminAccount,
                        password: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm text-black mb-1">Role</label>
                  <select
                    className="w-full p-2 border rounded text-black"
                    value={newAdminAccount.role}
                    onChange={(e) =>
                      setNewAdminAccount({
                        ...newAdminAccount,
                        role: e.target.value as AdminAccount["role"],
                      })
                    }
                  >
                    <option value="admin">admin</option>
                    <option value="manager">manager</option>
                    <option value="employee">employee</option>
                    <option value="superadmin">superadmin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-black mb-1">Position</label>
                  <select
                    className="w-full p-2 border rounded text-black"
                    value={newAdminAccount.position}
                    onChange={(e) =>
                      setNewAdminAccount({
                        ...newAdminAccount,
                        position: e.target.value,
                      })
                    }
                  >
                    {positionOptions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={creatingAdminAccount}
                    className="bg-black text-white px-4 py-2 rounded w-full disabled:opacity-60"
                  >
                    {creatingAdminAccount ? "Creating..." : "Create Admin"}
                  </button>
                </div>
              </form>

              <div className="flex items-center gap-3">
                <input
                  placeholder="Search admins (username, role, position)"
                  className="w-full p-2 border rounded text-black"
                  value={adminAccountSearch}
                  onChange={(e) => setAdminAccountSearch(e.target.value)}
                />
                <button
                  onClick={() => fetchAdminAccounts().catch((e) => alert(e.message))}
                  className="px-3 py-2 bg-black text-white rounded"
                >
                  Refresh
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="text-left p-2 text-black">Username</th>
                      <th className="text-left p-2 text-black">Role</th>
                      <th className="text-left p-2 text-black">Position</th>
                      <th className="text-left p-2 text-black">Active</th>
                      <th className="text-left p-2 text-black">Last login</th>
                      <th className="text-left p-2 text-black">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {adminAccountsLoading ? (
                      <tr>
                        <td className="p-3 text-black" colSpan={6}>
                          Loading…
                        </td>
                      </tr>
                    ) : filteredAdminAccounts.length === 0 ? (
                      <tr>
                        <td className="p-3 text-black" colSpan={6}>
                          No admins found
                        </td>
                      </tr>
                    ) : (
                      filteredAdminAccounts.map((a) => (
                        <tr key={a.id} className="hover:bg-gray-50">
                          <td className="p-2 text-black">{a.username}</td>
                          <td className="p-2">
                            <select
                              className="p-1 border rounded text-black"
                              value={a.role}
                              onChange={(e) =>
                                updateAdminAccountField(a.id, {
                                  role: e.target.value as AdminAccount["role"],
                                })
                              }
                            >
                              <option value="admin">admin</option>
                              <option value="manager">manager</option>
                              <option value="employee">employee</option>
                              <option value="superadmin">superadmin</option>
                            </select>
                          </td>
                          <td className="p-2">
                            <select
                              className="p-1 border rounded text-black"
                              value={a.position || ""}
                              onChange={(e) =>
                                updateAdminAccountField(a.id, {
                                  position: e.target.value,
                                })
                              }
                            >
                              {positionOptions.map((p) => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2">
                            <button
                              onClick={() => toggleAdminAccountActive(a)}
                              className={`px-2 py-1 rounded text-white ${
                                a.is_active ? "bg-green-600" : "bg-gray-500"
                              }`}
                            >
                              {a.is_active ? "Active" : "Inactive"}
                            </button>
                          </td>
                          <td className="p-2 text-black">
                            {a.last_login
                              ? new Date(a.last_login).toLocaleString()
                              : "—"}
                          </td>
                          <td className="p-2">
                            <button
                              onClick={() => resetAdminAccountPassword(a)}
                              className="px-2 py-1 rounded bg-black text-white"
                            >
                              Reset Password
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {mode === "positions" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
                This is the default set of pages a position can access.
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
              {saving ? "Saving..." : "Save Position Permissions"}
            </button>
          </div>

          <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm text-gray-600">Editing position</div>
                <div className="text-lg font-semibold text-gray-900">{selectedPosition || "—"}</div>
              </div>
              <div className="text-sm text-gray-600">
                Selected: <span className="font-semibold">{selectedPageKeys.size}</span>
              </div>
            </div>

            <div className="mt-4">
              <input
                className="w-full p-2 border rounded text-black"
                placeholder="Search pages (name/path)"
                value={pageSearch}
                onChange={(e) => setPageSearch(e.target.value)}
              />
              <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Hint: <span className="font-semibold">User Accounts Delete</span> (key: <span className="font-mono">user_accounts_delete</span>) controls permanent user deletion.
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {filteredPagesByGroup.map(([group, groupPages]) => (
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
                <div className="text-sm text-gray-600">
                  No pages found. Seed your RBAC pages table first.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {mode === "admins" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
            <div>
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
              <div className="mt-2 text-xs text-gray-600">
                  Additional permissions add extra access on top of the admin’s position permissions.
              </div>
            </div>

            <div className="rounded border border-gray-200 p-3 bg-gray-50 text-sm text-gray-700">
              <div>
                Effective: <span className="font-semibold">{adminEffectiveComputedKeys.size}</span>
              </div>
              <div>
                Overrides: <span className="font-semibold">{adminOverrideKeys.size}</span>
              </div>
              <div>
                From position: <span className="font-semibold">{adminPositionKeys.size}</span>
              </div>
            </div>

            <button
              disabled={!canManageAdminOverrides || savingAdminOverrides || !selectedAdminId}
              onClick={() => saveAdminOverrides().catch((e) => alert(e.message))}
              className="w-full px-3 py-2 bg-indigo-600 text-white rounded disabled:opacity-60"
            >
              {savingAdminOverrides ? "Saving..." : "Save Additional permissions"}
            </button>

            {adminHasWildcardAccess && (
              <div className="text-xs text-gray-600">
                This admin currently has full access. Checkboxes represent explicit overrides only.
              </div>
            )}
            {!canManageAdminOverrides && (
              <div className="text-xs text-gray-600">
                Read-only: you don’t have the “Give Additional permissions” permission.
              </div>
            )}
          </div>

          <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm text-gray-600">Additional permissions editor</div>
                <div className="text-lg font-semibold text-gray-900">
                  {admins.find((a) => a.id === selectedAdminId)?.username || "—"}
                </div>
              </div>
              <div className="text-sm text-gray-600">
                Additional permissions selected: <span className="font-semibold">{adminOverrideKeys.size}</span>
              </div>
            </div>

            <div className="mt-4">
              <input
                className="w-full p-2 border rounded text-black"
                placeholder="Search pages (name/path)"
                value={pageSearch}
                onChange={(e) => setPageSearch(e.target.value)}
              />
              <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Hint: <span className="font-semibold">User Accounts Delete</span> (key: <span className="font-mono">user_accounts_delete</span>) controls permanent user deletion.
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {filteredPagesByGroup.map(([group, groupPages]) => (
                <div key={group} className="border border-gray-100 rounded p-3">
                  <div className="text-sm font-semibold text-gray-800 mb-2">{group}</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {groupPages.map((p) => {
                      const isPositionGranted = adminPositionKeys.has(p.key);
                      const isOverrideGranted = adminOverrideKeys.has(p.key);
                      const isEffectiveGranted = adminEffectiveComputedKeys.has(p.key);

                      const isChecked = adminHasWildcardAccess
                        ? isOverrideGranted
                        : isPositionGranted || isOverrideGranted;

                      const isDisabled =
                        !canManageAdminOverrides || (!adminHasWildcardAccess && isPositionGranted);

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
                              if (!adminHasWildcardAccess && isPositionGranted) return;
                              toggleAdminOverride(p.key);
                            }}
                          />
                          <div>
                            <div className="text-sm text-gray-900">{p.name}</div>
                            <div className="text-xs text-gray-500">{p.path}</div>
                            {(isPositionGranted || isOverrideGranted || isEffectiveGranted) && (
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
                    })}
                  </div>
                </div>
              ))}

              {pages.length === 0 && (
                <div className="text-sm text-gray-600">
                  No pages found. Seed your RBAC pages table first.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
