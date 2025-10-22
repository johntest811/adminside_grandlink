"use client";
import { useState, useEffect } from "react";
type SupabaseUser = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at?: string; // Supabase Auth field
  role?: string;
  status?: string;
  last_login?: string;
};

export default function UsersPage() {
  const [users, setUsers] = useState<SupabaseUser[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showAddUserPopup, setShowAddUserPopup] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch("/api/admin-users");
        const result = await res.json();
        if (res.ok) {
          const usersWithLogin = (result.users || []).map((u: any) => {
            const lastLoginDate = u.last_sign_in_at
              ? new Date(u.last_sign_in_at)
              : new Date(u.created_at);
            const now = new Date();
            const diffDays = (now.getTime() - lastLoginDate.getTime()) / (1000 * 60 * 60 * 24);
            return {
              ...u,
              role: "User",
              status: diffDays <= 3 ? "Active" : "Inactive",
              last_login: lastLoginDate.toISOString().slice(0, 10),
            };
          });
          setUsers(usersWithLogin);
        } else {
          setMessage("Error fetching users: " + (result.error || "Unknown error"));
        }
      } catch (err) {
        setMessage("Error fetching users: " + (err as Error).message);
      }
    };
    fetchUsers();
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
        setUsers(prev => [
          ...prev,
          {
            ...result.user,
            role: "User",
            status: "Active",
            last_login: new Date().toISOString().slice(0, 10),
          },
        ]);
      } else {
        setMessage("Error: " + (result.error || "Unknown error"));
      }
    } catch (err) {
      setMessage("Error: " + (err as Error).message);
    }
  };

  // Delete user handler
  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Are you sure you want to delete this user?")) return;
    try {
      const res = await fetch("/api/admin-users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const result = await res.json();
      if (res.ok) {
        setUsers(users.filter(u => u.id !== userId));
        setMessage("User deleted successfully!");
      } else {
        setMessage("Error deleting user: " + (result.error || "Unknown error"));
      }
    } catch (err) {
      setMessage("Error deleting user: " + (err as Error).message);
    }
  };

  // Filter users by status and search term
  const filteredUsers = users.filter(u => {
    const matchesStatus = statusFilter === "All" || u.status === statusFilter;
    const matchesSearch =
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.email?.split("@")[0].replace(/\./g, " ").toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  // Handle checkbox change
  const handleCheckboxChange = (id: string, checked: boolean) => {
    setSelectedIds(prev =>
      checked ? [...prev, id] : prev.filter(selectedId => selectedId !== id)
    );
  };

  // Bulk delete handler
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm("Are you sure you want to delete the selected users?")) return;
    for (const userId of selectedIds) {
      await handleDeleteUser(userId);
    }
    setSelectedIds([]);
  };

  return (
    <div className="min-h-screen p-8 bg-gray-50">
      <div className="flex items-center mb-8">
        <div className="flex items-center mr-4">
          {/* <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-xl font-bold text-gray-400 mr-2">A</div>
          <span className="font-semibold text-lg">Admin User</span> */}
        </div>
      </div>
      
      <div className="flex gap-4 mb-4 text-black">
        <input
          type="text"
          placeholder="Search users..."
          className="border px-3 py-2 rounded w-1/3"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>
      <div className="bg-white shadow rounded-lg p-6">
        {/* Status Filter Dropdown */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <label className="mr-2 font-semibold text-[#233a5e]">All Status:</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="border border-gray-300 p-2 rounded bg-white text-black"
            >
              <option value="All">All</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
          <div className="flex items-center space-x-2">
            <button
          className="bg-blue-600 text-white px-6 py-2 rounded font-semibold shadow hover:bg-blue-700 transition"
          onClick={() => { setShowModal(true); setMessage(""); }}
        >
          Add New User
        </button>

            <button
              className={`bg-red-600 text-white px-4 py-2 rounded font-semibold ${selectedIds.length === 0 ? "opacity-50 cursor-not-allowed" : "hover:bg-red-800"}`}
              disabled={selectedIds.length === 0}
              onClick={handleBulkDelete}
            >
              Delete
            </button>
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
            {filteredUsers.map((user, idx) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="p-2 border text-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(user.id)}
                    onChange={e => handleCheckboxChange(user.id, e.target.checked)}
                  />
                </td>
                <td className="p-2 border">
                  <div className="flex items-center">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-400 mr-2">
                      {user.email ? user.email[0].toUpperCase() : "U"}
                    </div>
                    <span className="font-medium text-gray-700">{user.email?.split("@")[0].replace(/\./g, " ")}</span>
                  </div>
                </td>
                <td className="p-2 border">
                  <span className="text-black">{user.email}</span>
                </td>
                <td className="p-2 border">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${user.status === "Active" ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"}`}>{user.status}</span>
                </td>
                <td className="p-2 border">
                  <span style={{ color: "#505A89" }}>{user.last_login}</span>
                </td>
                <td className="p-2 border">
                  <span
                    className="text-red-600 cursor-pointer hover:underline"
                    onClick={() => handleDeleteUser(user.id)}
                  >
                    Delete
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-between items-center mt-4 text-gray-500 text-sm">
          <span>Showing 1 to {users.length} of {users.length} results</span>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1 border rounded bg-white">Previous</button>
            <span>1</span>
            <button className="px-3 py-1 border rounded bg-white">Next</button>
          </div>
        </div>
      </div>

      {/* Add User Modal */}
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
                  onChange={e => setEmail(e.target.value)}
                  className="border px-3 py-2 rounded w-full"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="border px-3 py-2 rounded w-full"
                  required
                />
              </div>
              <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded font-semibold">Add User</button>
            </form>
            {message && <div className="text-center text-red-600 mt-2">{message}</div>}
          </div>
        </div>
      )}

      {/* Add New User Popup */}
      {showAddUserPopup && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 shadow-lg relative min-w-[300px]">
            <button
              onClick={() => setShowAddUserPopup(false)}
              className="absolute top-2 right-2 text-gray-600 hover:text-black text-xl font-bold"
            >
              ×
            </button>
            <h2 className="text-lg font-bold mb-4 text-[#233a5e]">Add New User</h2>
            {/* Add your form fields for new user here */}
            {/* Example: */}
            <form>
              <input
                type="email"
                placeholder="Email"
                className="w-full border border-gray-300 p-2 rounded mb-4"
              />
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded font-semibold hover:bg-blue-800 w-full"
              >
                Create User
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}