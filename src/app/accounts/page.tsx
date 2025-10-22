"use client";
import { useEffect, useState } from "react";
import { supabase } from "../Clients/Supabase/SupabaseClients";

export default function AccountsPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUsers() {
      setLoading(true);
      // Fetch users from Supabase Auth
      const { data, error } = await supabase.auth.admin.listUsers();
      if (error) {
        setUsers([]);
      } else {
        setUsers(data.users || []);
      }
      setLoading(false);
    }
    fetchUsers();
  }, []);

  return (
    <div className="min-h-screen bg-[#f5f6fa] flex flex-col">
      {/* Header */}
      <header className="bg-white flex items-center px-6 py-4 shadow">
        <img src="/logo.svg" alt="Grand East Logo" className="h-10 w-10 mr-3" />
        <div className="font-bold text-xl text-[#232d3b]">
          GRAND EAST <span className="block text-xs font-normal text-gray-500">GLASS AND ALUMINUM</span>
        </div>
        <div className="ml-auto flex gap-4 items-center">
          <button className="text-2xl text-gray-500 hover:text-[#8B1C1C]"><span className="material-icons">history</span></button>
          <button className="text-2xl text-gray-500 hover:text-[#8B1C1C]"><span className="material-icons">notifications</span></button>
          <button className="text-2xl text-gray-500 hover:text-[#8B1C1C]"><span className="material-icons">account_circle</span></button>
        </div>
      </header>
      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="bg-[#232d3b] text-white w-64 min-h-full py-8 px-4 flex flex-col gap-2">
          <div className="font-bold text-lg mb-6">Dashboard</div>
          <nav className="flex flex-col gap-2">
            <a href="#" className="hover:bg-[#1a222e] rounded px-3 py-2">Announcements</a>
            <a href="#" className="hover:bg-[#1a222e] rounded px-3 py-2 font-semibold bg-[#1a222e]">Accounts</a>
            <a href="#" className="hover:bg-[#1a222e] rounded px-3 py-2">Reports</a>
            <a href="#" className="hover:bg-[#1a222e] rounded px-3 py-2">Inventory</a>
            <a href="#" className="hover:bg-[#1a222e] rounded px-3 py-2">Employee Task</a>
            <a href="#" className="hover:bg-[#1a222e] rounded px-3 py-2">Orders</a>
            <a href="#" className="hover:bg-[#1a222e] rounded px-3 py-2">Order Management</a>
            <a href="#" className="hover:bg-[#1a222e] rounded px-3 py-2">Calendar</a>
            <a href="#" className="hover:bg-[#1a222e] rounded px-3 py-2">Content Management</a>
            <a href="#" className="hover:bg-[#1a222e] rounded px-3 py-2">Predictive Settings</a>
          </nav>
          <div className="mt-auto">
            <a href="#" className="flex items-center gap-2 text-[#8B1C1C] hover:underline mt-8">
              <span className="material-icons">logout</span> LOG OUT
            </a>
          </div>
        </aside>
        {/* Main Content */}
        <main className="flex-1 p-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-[#232d3b]">ACCOUNTS</h1>
            <div className="flex gap-2">
              <button className="bg-[#6c63ff] text-white px-4 py-2 rounded font-semibold text-sm hover:bg-[#554fd8]">Add User</button>
              <button className="bg-[#e74c3c] text-white px-4 py-2 rounded font-semibold text-sm hover:bg-[#c0392b]">Delete</button>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center gap-4 mb-4">
              <label>
                <select className="border rounded px-2 py-1 text-sm">
                  <option>9</option>
                  <option>18</option>
                  <option>27</option>
                </select>
                <span className="ml-2 text-gray-600 text-sm">records per page</span>
              </label>
              <div className="ml-auto flex items-center gap-2">
                <span className="text-gray-600 text-sm">Search:</span>
                <input className="border rounded px-2 py-1 text-sm" placeholder=""/>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-[#232d3b] text-white">
                    <th className="px-2 py-2"><input type="checkbox" /></th>
                    <th className="px-2 py-2 text-left">Username</th>
                    <th className="px-2 py-2 text-left">Email</th>
                    <th className="px-2 py-2 text-left">Day Joined</th>
                    <th className="px-2 py-2 text-left">Address</th>
                    <th className="px-2 py-2 text-left">Option</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8">Loading...</td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8">No users found.</td>
                    </tr>
                  ) : (
                    users.map((user: any) => (
                      <tr key={user.id} className="border-b">
                        <td className="px-2 py-2"><input type="checkbox" /></td>
                        <td className="px-2 py-2">{user.user_metadata?.name || user.email.split("@")[0]}</td>
                        <td className="px-2 py-2">{user.email}</td>
                        <td className="px-2 py-2">{user.created_at ? new Date(user.created_at).toLocaleDateString() : ""}</td>
                        <td className="px-2 py-2">{user.user_metadata?.address || "-"}</td>
                        <td className="px-2 py-2">
                          <button className="bg-[#e74c3c] text-white px-3 py-1 rounded text-xs hover:bg-[#c0392b]">Disable</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}