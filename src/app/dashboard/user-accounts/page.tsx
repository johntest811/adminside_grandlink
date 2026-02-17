"use client";

import { useEffect, useMemo, useState } from "react";

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
    const query = searchTerm.toLowerCase();
    const matchesSearch =
      u.email.toLowerCase().includes(query) || displayName.toLowerCase().includes(query);
    return matchesStatus && matchesSearch;
  });

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
    <div className="min-h-screen p-8 bg-gray-50 text-black">
      <div className="flex gap-4 mb-4">
        <input
          type="text"
          placeholder="Search users..."
          className="border px-3 py-2 rounded w-1/3"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="bg-white shadow rounded-lg p-6">
        <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setAccountView("active");
                setSelectedIds([]);
              }}
              className={`px-3 py-2 rounded font-semibold ${accountView === "active" ? "bg-[#505A89] text-white" : "bg-gray-100 text-gray-700"}`}
            >
              Active Accounts
            </button>
            <button
              onClick={() => {
                setAccountView("deactivated");
                setSelectedIds([]);
              }}
              className={`px-3 py-2 rounded font-semibold ${accountView === "deactivated" ? "bg-[#505A89] text-white" : "bg-gray-100 text-gray-700"}`}
            >
              Deactivated Accounts
            </button>
          </div>

          <div>
            <label className="mr-2 font-semibold text-[#233a5e]">Status:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="border border-gray-300 p-2 rounded bg-white text-black"
            >
              <option value="All">All</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="bg-blue-600 text-white px-6 py-2 rounded font-semibold shadow hover:bg-blue-700 transition"
              onClick={() => {
                setShowModal(true);
                setMessage("");
              }}
            >
              Add New User
            </button>

            {accountView === "active" ? (
              <button
                className={`bg-amber-600 text-white px-4 py-2 rounded font-semibold ${selectedIds.length === 0 ? "opacity-50 cursor-not-allowed" : "hover:bg-amber-700"}`}
                disabled={selectedIds.length === 0}
                onClick={() => handleBulkDeactivate(true)}
              >
                Deactivate
              </button>
            ) : (
              <button
                className={`bg-green-600 text-white px-4 py-2 rounded font-semibold ${selectedIds.length === 0 ? "opacity-50 cursor-not-allowed" : "hover:bg-green-700"}`}
                disabled={selectedIds.length === 0}
                onClick={() => handleBulkDeactivate(false)}
              >
                Reactivate
              </button>
            )}

            {canDeleteUsers && (
              <button
                className={`bg-red-600 text-white px-4 py-2 rounded font-semibold ${selectedIds.length === 0 ? "opacity-50 cursor-not-allowed" : "hover:bg-red-800"}`}
                disabled={selectedIds.length === 0}
                onClick={handleBulkDelete}
              >
                Delete
              </button>
            )}
          </div>
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr style={{ background: "#505A89" }}>
              <th className="text-white px-4 py-2"></th>
              <th className="text-white px-4 py-2">NAME</th>
              <th className="text-white px-4 py-2">EMAIL</th>
              <th className="text-white px-4 py-2">STATUS</th>
              <th className="text-white px-4 py-2">LAST LOGIN</th>
              <th className="text-white px-4 py-2">ACTION</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((user: any) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="p-2 border text-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(user.id)}
                    onChange={(e) => handleCheckboxChange(user.id, e.target.checked)}
                  />
                </td>
                <td className="p-2 border">
                  <div className="flex items-center">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-400 mr-2">
                      {user.email ? user.email[0].toUpperCase() : "U"}
                    </div>
                    <span className="font-medium text-gray-700">
                      {user.email?.split("@")[0].replace(/\./g, " ")}
                    </span>
                  </div>
                </td>
                <td className="p-2 border">{user.email}</td>
                <td className="p-2 border">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${user.status === "Active" ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"}`}>
                    {user.status}
                  </span>
                </td>
                <td className="p-2 border text-[#505A89]">{(user as any).last_login}</td>
                <td className="p-2 border">
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
          </tbody>
        </table>

        <div className="flex justify-between items-center mt-4 text-gray-500 text-sm">
          <span>
            Showing {filteredUsers.length} of {usersByView.length} {accountView} account(s)
          </span>
        </div>

        {!canDeleteUsers && (
          <div className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Delete is restricted. Only Superadmin or admins with delete permission can permanently remove accounts.
          </div>
        )}
      </div>

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
