"use client";

import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";

type SupabaseUser = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at?: string;
  deactivated_account?: boolean;
  deactivated_at?: string | null;
};

type AdminSession = {
  id: string;
  username: string;
};

export default function UsersPage() {
  const [users, setUsers] = useState<SupabaseUser[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Active" | "Inactive">("All");
  const [accountView, setAccountView] = useState<"active" | "deactivated">("active");
  const [currentAdmin, setCurrentAdmin] = useState<AdminSession | null>(null);
  const [canDeleteUsers, setCanDeleteUsers] = useState(false);
  const [isUiPending, startUiTransition] = useTransition();
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const fetchUsers = async (adminId?: string | null) => {
    try {
      const res = await fetch("/api/admin-users", {
        headers: adminId ? { "x-admin-id": adminId } : undefined,
      });
      const result = await res.json();
      if (!res.ok) {
        setMessage("Error fetching users: " + (result.error || "Unknown error"));
        return;
      }

      setCanDeleteUsers(Boolean(result?.canDelete));
      const usersWithLogin = (result.users || []).map((u: any) => {
        const lastLoginDate = u.last_sign_in_at
          ? new Date(u.last_sign_in_at)
          : new Date(u.created_at);
        const now = new Date();
        const diffDays = (now.getTime() - lastLoginDate.getTime()) / (1000 * 60 * 60 * 24);

        return {
          ...u,
          status: diffDays <= 3 ? "Active" : "Inactive",
          last_login: lastLoginDate.toISOString().slice(0, 10),
          deactivated_account: Boolean(u.deactivated_account),
        };
      });

      setUsers(usersWithLogin);
    } catch (err) {
      setMessage("Error fetching users: " + (err as Error).message);
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem("adminSession");
      if (raw) {
        const admin = JSON.parse(raw) as AdminSession;
        setCurrentAdmin(admin);
        fetchUsers(admin.id);
        return;
      }
      fetchUsers();
    } catch {
      fetchUsers();
    }
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    if (!email || !password) {
      setMessage("Email and password are required.");
      return;
    }

    try {
      const res = await fetch("/api/admin-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await res.json();
      if (res.ok) {
        setMessage("User account created successfully!");
        setEmail("");
        setPassword("");
        setShowModal(false);
        await fetchUsers(currentAdmin?.id || null);
      } else {
        setMessage("Error: " + (result.error || "Unknown error"));
      }
    } catch (err) {
      setMessage("Error: " + (err as Error).message);
    }
  };

  const handleDeactivateToggle = async (userId: string, deactivate: boolean) => {
    try {
      const res = await fetch("/api/admin-users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(currentAdmin?.id ? { "x-admin-id": currentAdmin.id } : {}),
        },
        body: JSON.stringify({ userId, deactivated: deactivate }),
      });

      const result = await res.json();
      if (!res.ok) {
        setMessage("Error updating account status: " + (result.error || "Unknown error"));
        return;
      }

      setMessage(deactivate ? "Account deactivated successfully!" : "Account reactivated successfully!");
      await fetchUsers(currentAdmin?.id || null);
      setSelectedIds((prev) => prev.filter((id) => id !== userId));
    } catch (err) {
      setMessage("Error updating account status: " + (err as Error).message);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!canDeleteUsers) {
      setMessage("You do not have permission to delete user accounts.");
      return;
    }

    if (!confirm("Are you sure you want to permanently delete this user?")) return;

    try {
      const res = await fetch("/api/admin-users", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(currentAdmin?.id ? { "x-admin-id": currentAdmin.id } : {}),
        },
        body: JSON.stringify({ userId }),
      });
      const result = await res.json();
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        setSelectedIds((prev) => prev.filter((id) => id !== userId));
        setMessage("User deleted successfully!");
      } else {
        setMessage("Error deleting user: " + (result.error || "Unknown error"));
      }
    } catch (err) {
      setMessage("Error deleting user: " + (err as Error).message);
    }
  };

  const handleCheckboxChange = (id: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? [...prev, id] : prev.filter((selectedId) => selectedId !== id)));
  };

  const usersByView = useMemo(() => {
    return users.filter((u) => {
      const isDeactivated = Boolean((u as any).deactivated_account);
      return accountView === "deactivated" ? isDeactivated : !isDeactivated;
    });
  }, [users, accountView]);

  const filteredUsers = usersByView.filter((u: any) => {
    const matchesStatus = statusFilter === "All" || u.status === statusFilter;
    const displayName = u.email?.split("@")[0].replace(/\./g, " ") || "";
    const query = deferredSearchTerm.toLowerCase();
    const matchesSearch =
      u.email.toLowerCase().includes(query) || displayName.toLowerCase().includes(query);
    return matchesStatus && matchesSearch;
  });

  const dashboardStats = useMemo(() => {
    const activeCount = users.filter((user: any) => !Boolean((user as any).deactivated_account)).length;
    const deactivatedCount = users.length - activeCount;
    const onlineRecentlyCount = users.filter((user: any) => user.status === "Active").length;
    return {
      total: users.length,
      active: activeCount,
      deactivated: deactivatedCount,
      onlineRecently: onlineRecentlyCount,
    };
  }, [users]);

  const handleBulkDeactivate = async (deactivate: boolean) => {
    if (selectedIds.length === 0) return;

    const prompt = deactivate
      ? "Deactivate selected accounts?"
      : "Reactivate selected accounts?";

    if (!confirm(prompt)) return;

    for (const userId of selectedIds) {
      await handleDeactivateToggle(userId, deactivate);
    }

    setSelectedIds([]);
  };

  const handleBulkDelete = async () => {
    if (!canDeleteUsers) {
      setMessage("You do not have permission to delete user accounts.");
      return;
    }

    if (selectedIds.length === 0) return;
    if (!confirm("Permanently delete selected users?")) return;

    for (const userId of selectedIds) {
      await handleDeleteUser(userId);
    }
    setSelectedIds([]);
  };

  return (
    <div className="mx-auto min-h-screen max-w-7xl space-y-6 bg-slate-50 px-4 py-6 text-black md:px-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">User Accounts</h1>
            <p className="mt-1 text-sm text-slate-600">
              Manage active and deactivated user accounts with controlled bulk actions.
            </p>
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-600">
            Admin: {currentAdmin?.username || "Unknown"}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Users</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{dashboardStats.total}</div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Active Accounts</div>
            <div className="mt-1 text-2xl font-bold text-emerald-700">{dashboardStats.active}</div>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">Deactivated</div>
            <div className="mt-1 text-2xl font-bold text-rose-700">{dashboardStats.deactivated}</div>
          </div>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Recently Active</div>
            <div className="mt-1 text-2xl font-bold text-indigo-700">{dashboardStats.onlineRecently}</div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                startUiTransition(() => {
                  setAccountView("active");
                  setSelectedIds([]);
                });
              }}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                accountView === "active"
                  ? "bg-[#505A89] text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Active Accounts
            </button>
            <button
              onClick={() => {
                startUiTransition(() => {
                  setAccountView("deactivated");
                  setSelectedIds([]);
                });
              }}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                accountView === "deactivated"
                  ? "bg-[#505A89] text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Deactivated Accounts
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 transition"
              onClick={() => {
                setShowModal(true);
                setMessage("");
              }}
            >
              Add New User
            </button>

            {accountView === "active" ? (
              <button
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${selectedIds.length === 0 ? "cursor-not-allowed bg-amber-300" : "bg-amber-600 hover:bg-amber-700"}`}
                disabled={selectedIds.length === 0}
                onClick={() => handleBulkDeactivate(true)}
              >
                Deactivate
              </button>
            ) : (
              <button
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${selectedIds.length === 0 ? "cursor-not-allowed bg-green-300" : "bg-green-600 hover:bg-green-700"}`}
                disabled={selectedIds.length === 0}
                onClick={() => handleBulkDeactivate(false)}
              >
                Reactivate
              </button>
            )}

            {canDeleteUsers && (
              <button
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${selectedIds.length === 0 ? "cursor-not-allowed bg-red-300" : "bg-red-600 hover:bg-red-800"}`}
                disabled={selectedIds.length === 0}
                onClick={handleBulkDelete}
              >
                Delete
              </button>
            )}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr,220px]">
          <input
            type="text"
            placeholder="Search by email or display name..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm"
            value={searchTerm}
            onChange={(e) => {
              const value = e.target.value;
              startUiTransition(() => setSearchTerm(value));
            }}
          />

          <select
            value={statusFilter}
            onChange={(e) => {
              const value = e.target.value as "All" | "Active" | "Inactive";
              startUiTransition(() => setStatusFilter(value));
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
          >
            <option value="All">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ background: "#505A89" }}>
                <th className="px-4 py-3 text-white"></th>
                <th className="px-4 py-3 text-left text-white">NAME</th>
                <th className="px-4 py-3 text-left text-white">EMAIL</th>
                <th className="px-4 py-3 text-left text-white">STATUS</th>
                <th className="px-4 py-3 text-left text-white">LAST LOGIN</th>
                <th className="px-4 py-3 text-left text-white">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user: any) => (
                <tr key={user.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(user.id)}
                      onChange={(e) => handleCheckboxChange(user.id, e.target.checked)}
                    />
                  </td>
                  <td className="p-3">
                    <div className="flex items-center">
                      <div className="mr-3 flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-500">
                        {user.email ? user.email[0].toUpperCase() : "U"}
                      </div>
                      <span className="font-medium text-slate-700">
                        {user.email?.split("@")[0].replace(/\./g, " ")}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 text-slate-700">{user.email}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${user.status === "Active" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                      {user.status}
                    </span>
                  </td>
                  <td className="p-3 text-[#505A89]">{(user as any).last_login}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      {accountView === "active" ? (
                        <button
                          className="text-amber-600 hover:underline"
                          onClick={() => handleDeactivateToggle(user.id, true)}
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          className="text-green-600 hover:underline"
                          onClick={() => handleDeactivateToggle(user.id, false)}
                        >
                          Reactivate
                        </button>
                      )}

                      {canDeleteUsers && (
                        <button
                          className="text-red-600 hover:underline"
                          onClick={() => handleDeleteUser(user.id)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                    No users found for the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
          <span>
            Showing {filteredUsers.length} of {usersByView.length} {accountView} account(s)
          </span>
          {isUiPending && <span className="text-xs text-slate-400">Updating view...</span>}
        </div>

        {!canDeleteUsers && (
          <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Delete is restricted. Only Superadmin or admins with delete permission can permanently remove accounts.
          </div>
        )}
      </section>

      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: "transparent" }}>
          <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md relative">
            <button
              className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 text-xl"
              onClick={() => setShowModal(false)}
            >
              &times;
            </button>
            <h2 className="text-xl font-bold mb-4 text-black">Add New User</h2>
            <form className="flex flex-col gap-4" onSubmit={handleAddUser}>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="border px-3 py-2 rounded w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="border px-3 py-2 rounded w-full"
                  required
                />
              </div>
              <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded font-semibold">
                Add User
              </button>
            </form>
            {message && <div className="text-center text-red-600 mt-2">{message}</div>}
          </div>
        </div>
      )}

      {message && !showModal && (
        <div className="mt-4 text-sm text-[#233a5e]">{message}</div>
      )}
    </div>
  );
}
