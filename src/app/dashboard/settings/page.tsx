"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

type Admin = {
  id: string;
  username: string;
  role: "superadmin" | "admin" | "manager";
  position?: string | null;
  full_name?: string | null;
  employee_number?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
  last_login?: string | null;
  password?: string | null;
};

type HomeContentRow = { id: string; content: any; updated_at?: string };
type InquireContentRow = {
  id: string;
  title: string;
  description: string;
  phone?: string | null;
  email?: string | null;
  facebook?: string | null;
};

const POSITIONS = [
  "Sales Manager",
  "Site Manager",
  "Media Handler",
  "Supervisor",
  "Manager",
  "Admin",
  "Superadmin",
];

export default function SettingsPage() {
  // Current admin (loaded from Supabase Auth or localStorage)
  const [currentAdmin, setCurrentAdmin] = useState<Admin | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // Edit profile modal
  const [editOpen, setEditOpen] = useState(false);
  const [editFullName, setEditFullName] = useState("");
  const [editPosition, setEditPosition] = useState<string>("");
  const [editPassword, setEditPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    loadCurrentAdminProfile();
  }, []);

  const loadCurrentAdminProfile = async () => {
    setProfileLoading(true);
    try {
      // 1) Try Supabase auth user -> match admins row by id
      let adminRow: Admin | null = null;
      try {
        const { data: auth } = await supabase.auth.getUser();
        const authId = auth?.user?.id;
        if (authId) {
          const { data } = await supabase
            .from("admins")
            .select("*")
            .eq("id", authId)
            .maybeSingle<Admin>();
          if (data) adminRow = data as Admin;
        }
      } catch {}

      // 2) Fallback: check localStorage "adminSession" { id/username }
      if (!adminRow) {
        try {
          const raw = localStorage.getItem("adminSession");
          if (raw) {
            const sess = JSON.parse(raw);
            if (sess?.id) {
              const { data } = await supabase
                .from("admins")
                .select("*")
                .eq("id", sess.id)
                .maybeSingle<Admin>();
              if (data) adminRow = data as Admin;
            } else if (sess?.username) {
              const { data } = await supabase
                .from("admins")
                .select("*")
                .eq("username", sess.username)
                .maybeSingle<Admin>();
              if (data) adminRow = data as Admin;
            }
          }
        } catch {}
      }

      // 3) Last resort: first active admin
      if (!adminRow) {
        const { data } = await supabase
          .from("admins")
          .select("*")
          .eq("is_active", true)
          .order("last_login", { ascending: false })
          .limit(1)
          .maybeSingle<Admin>();
        if (data) adminRow = data as Admin;
      }

      if (adminRow) {
        setCurrentAdmin(adminRow);
      } else {
        setCurrentAdmin(null);
      }
    } catch (e) {
      console.error("loadCurrentAdminProfile error:", e);
      setCurrentAdmin(null);
    } finally {
      setProfileLoading(false);
    }
  };

  const openEditProfile = () => {
    if (!currentAdmin) return;
    setEditFullName(currentAdmin.full_name || "");
    setEditPosition(currentAdmin.position || "Admin");
    setEditPassword("");
    setEditOpen(true);
  };

  const saveProfile = async () => {
    if (!currentAdmin) return;
    setSavingProfile(true);
    try {
      const updates: Partial<Admin> = {
        full_name: editFullName || null,
        position: editPosition || null,
      };
      const { error } = await supabase
        .from("admins")
        .update(updates)
        .eq("id", currentAdmin.id);
      if (error) throw error;

      if (editPassword.trim()) {
        const { error: pwErr } = await supabase
          .from("admins")
          .update({ password: editPassword.trim() })
          .eq("id", currentAdmin.id);
        if (pwErr) throw pwErr;
      }

      await loadCurrentAdminProfile();
      setEditOpen(false);
      alert("Profile updated.");
    } catch (e: any) {
      alert(`Failed to update profile: ${e.message || e}`);
    } finally {
      setSavingProfile(false);
    }
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
    } catch {}
    try {
      localStorage.removeItem("adminSession");
    } catch {}
    window.location.href = "/dashboard/login";
  };

  const initials = (() => {
    const name = currentAdmin?.full_name || currentAdmin?.username || "";
    const parts = name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "AD";
  })();

  // General site settings (stored in home_content.content JSONB)
  const [homeId, setHomeId] = useState<string | null>(null);
  const [general, setGeneral] = useState({
    siteName: "GrandLink Glass and Aluminium",
    siteDescription:
      "Quality glass and aluminium products for your home and business",
    contactEmail: "info@grandlink.com",
    contactPhone: "+63 900 000 0000",
    address: "Cebu City, Philippines",
    facebook: "https://facebook.com/grandlink",
  });
  const [savingGeneral, setSavingGeneral] = useState(false);

  // Inquire page content (stored in inqruire_content)
  const [inqId, setInqId] = useState<string | null>(null);
  const [inquire, setInquire] = useState({
    title: "Contact Us",
    description: "Send us your inquiry and we will reach out shortly.",
    phone: "+63 900 000 0000",
    email: "info@grandlink.com",
    facebook: "https://facebook.com/grandlink",
  });
  const [savingInquire, setSavingInquire] = useState(false);

  // Admin management
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [adminsLoading, setAdminsLoading] = useState(true);
  const [adminSearch, setAdminSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newAdmin, setNewAdmin] = useState({
    username: "",
    password: "",
    role: "admin" as Admin["role"],
    position: "Admin",
    full_name: "",
  });

  useEffect(() => {
    // Load initial settings/admins
    const load = async () => {
      // home_content (get latest row)
      {
        const { data, error } = await supabase
          .from("home_content")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle<HomeContentRow>();
        if (!error && data) {
          setHomeId(data.id);
          const c = data.content || {};
          setGeneral((g) => ({
            ...g,
            ...c,
          }));
        }
      }

      // inqruire_content (first/only row)
      {
        const { data, error } = await supabase
          .from("inqruire_content")
          .select("*")
          .limit(1)
          .maybeSingle<InquireContentRow>();
        if (!error && data) {
          setInqId(data.id);
          setInquire({
            title: data.title || "Contact Us",
            description: data.description || "",
            phone: data.phone || "",
            email: data.email || "",
            facebook: data.facebook || "",
          });
        }
      }

      // admins list
      await fetchAdmins();
    };
    load();
  }, []);

  const fetchAdmins = async () => {
    setAdminsLoading(true);
    try {
      const { data, error } = await supabase
        .from("admins")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setAdmins((data as any) || []);
    } catch (e) {
      console.error("Load admins error:", e);
      setAdmins([]);
    } finally {
      setAdminsLoading(false);
    }
  };

  // Save general site settings to home_content
  const saveGeneral = async () => {
    setSavingGeneral(true);
    try {
      if (homeId) {
        const { error } = await supabase
          .from("home_content")
          .update({ content: general, updated_at: new Date().toISOString() })
          .eq("id", homeId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("home_content")
          .insert({ content: general })
          .select()
          .maybeSingle();
        if (error) throw error;
        if (data?.id) setHomeId(data.id);
      }
      alert("General settings saved.");
    } catch (e: any) {
      alert(`Failed to save general settings: ${e.message || e}`);
    } finally {
      setSavingGeneral(false);
    }
  };

  // Save inquire/contact settings to inqruire_content
  const saveInquire = async () => {
    setSavingInquire(true);
    try {
      if (inqId) {
        const { error } = await supabase
          .from("inqruire_content")
          .update({
            title: inquire.title,
            description: inquire.description,
            phone: inquire.phone,
            email: inquire.email,
            facebook: inquire.facebook,
            updated_at: new Date().toISOString(),
          })
          .eq("id", inqId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("inqruire_content")
          .insert({
            title: inquire.title,
            description: inquire.description,
            phone: inquire.phone,
            email: inquire.email,
            facebook: inquire.facebook,
          })
          .select()
          .maybeSingle();
        if (error) throw error;
        if (data?.id) setInqId(data.id);
      }
      alert("Inquiry settings saved.");
    } catch (e: any) {
      alert(`Failed to save inquiry settings: ${e.message || e}`);
    } finally {
      setSavingInquire(false);
    }
  };

  // Create admin
  const createAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdmin.username || !newAdmin.password) {
      alert("Username and password are required.");
      return;
    }
    setCreating(true);
    try {
      const payload = {
        username: newAdmin.username,
        password: newAdmin.password, // NOTE: stored as plain text per schema
        role: newAdmin.role,
        position: newAdmin.position,
        full_name: newAdmin.full_name || null,
        is_active: true,
      };
      const { error } = await supabase.from("admins").insert(payload);
      if (error) throw error;

      // Optional: create notification record for audit/visibility
      await supabase.from("notifications").insert({
        title: "Admin created",
        message: `Admin "${newAdmin.username}" created with role "${newAdmin.role}".`,
        type: "general",
        recipient_role: "admin",
        metadata: { created_by: currentAdmin?.username || "system" },
      });

      setNewAdmin({
        username: "",
        password: "",
        role: "admin",
        position: "Admin",
        full_name: "",
      });
      await fetchAdmins();
      alert("Admin account created.");
    } catch (e: any) {
      alert(`Create admin failed: ${e.message || e}`);
    } finally {
      setCreating(false);
    }
  };

  // Toggle active
  const toggleActive = async (a: Admin) => {
    try {
      const { error } = await supabase
        .from("admins")
        .update({ is_active: !a.is_active })
        .eq("id", a.id);
      if (error) throw error;
      await fetchAdmins();
    } catch (e: any) {
      alert(`Update failed: ${e.message || e}`);
    }
  };

  // Update role/position single row
  const updateAdminField = async (
    id: string,
    changes: Partial<Pick<Admin, "role" | "position" | "full_name">>
  ) => {
    try {
      const { error } = await supabase.from("admins").update(changes).eq("id", id);
      if (error) throw error;
      await fetchAdmins();
    } catch (e: any) {
      alert(`Update failed: ${e.message || e}`);
    }
  };

  // Reset password (prompt)
  const resetPassword = async (a: Admin) => {
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
      alert(`Password reset failed: ${e.message || e}`);
    }
  };

  const filteredAdmins = useMemo(() => {
    const q = adminSearch.trim().toLowerCase();
    if (!q) return admins;
    return admins.filter((a) =>
      [
        a.username,
        a.role,
        a.position,
        a.full_name,
        a.employee_number,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [adminSearch, admins]);

  return (
    <div className="space-y-8">
      {/* Profile header */}
      <div className="bg-white shadow rounded-lg p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-full bg-black text-white flex items-center justify-center text-xl font-bold">
            {profileLoading ? "…" : initials}
          </div>
          <div>
            <div className="text-xl font-semibold text-black">
              {profileLoading
                ? "Loading admin…"
                : currentAdmin?.full_name || currentAdmin?.username || "Admin"}
            </div>
            {currentAdmin ? (
              <>
                <div className="text-sm text-black">
                  Username: <span className="font-medium">{currentAdmin.username}</span>
                </div>
                <div className="text-sm text-black">
                  Role: <span className="font-medium">{currentAdmin.role}</span>
                  {" • "}
                  Position: <span className="font-medium">{currentAdmin.position || "—"}</span>
                </div>
                <div className="text-xs text-black">
                  Last login:{" "}
                  {currentAdmin.last_login
                    ? new Date(currentAdmin.last_login).toLocaleString()
                    : "—"}
                </div>
              </>
            ) : (
              <div className="text-sm text-black">
                Not signed in. Some settings may be unavailable.
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={openEditProfile}
            disabled={!currentAdmin}
            className="px-4 py-2 bg-black text-white rounded disabled:opacity-60"
          >
            Edit Profile
          </button>
          <button onClick={logout} className="px-4 py-2 bg-black text-white rounded">
            Logout
          </button>
        </div>
      </div>

      {/* General site settings */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4 text-black">General Site Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-black mb-1">Site Name</label>
            <input
              className="w-full p-2 border rounded text-black"
              value={general.siteName}
              onChange={(e) => setGeneral({ ...general, siteName: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-black mb-1">Facebook</label>
            <input
              className="w-full p-2 border rounded text-black"
              value={general.facebook}
              onChange={(e) => setGeneral({ ...general, facebook: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-black mb-1">Site Description</label>
            <textarea
              rows={3}
              className="w-full p-2 border rounded text-black"
              value={general.siteDescription}
              onChange={(e) =>
                setGeneral({ ...general, siteDescription: e.target.value })
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-black mb-1">Contact Email</label>
            <input
              type="email"
              className="w-full p-2 border rounded text-black"
              value={general.contactEmail}
              onChange={(e) =>
                setGeneral({ ...general, contactEmail: e.target.value })
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-black mb-1">Contact Phone</label>
            <input
              className="w-full p-2 border rounded text-black"
              value={general.contactPhone}
              onChange={(e) =>
                setGeneral({ ...general, contactPhone: e.target.value })
              }
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-black mb-1">Business Address</label>
            <textarea
              rows={2}
              className="w-full p-2 border rounded text-black"
              value={general.address}
              onChange={(e) => setGeneral({ ...general, address: e.target.value })}
            />
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={saveGeneral}
            disabled={savingGeneral}
            className="bg-black text-white px-4 py-2 rounded disabled:opacity-60"
          >
            {savingGeneral ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>

      {/* Inquiry/Contact settings */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4 text-black">Inquiry/Contact Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-black mb-1">Title</label>
            <input
              className="w-full p-2 border rounded text-black"
              value={inquire.title}
              onChange={(e) => setInquire({ ...inquire, title: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-black mb-1">Email</label>
            <input
              className="w-full p-2 border rounded text-black"
              value={inquire.email}
              onChange={(e) => setInquire({ ...inquire, email: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-black mb-1">Phone</label>
            <input
              className="w-full p-2 border rounded text-black"
              value={inquire.phone}
              onChange={(e) => setInquire({ ...inquire, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-black mb-1">Facebook</label>
            <input
              className="w-full p-2 border rounded text-black"
              value={inquire.facebook}
              onChange={(e) => setInquire({ ...inquire, facebook: e.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-black mb-1">Description</label>
            <textarea
              rows={3}
              className="w-full p-2 border rounded text-black"
              value={inquire.description}
              onChange={(e) =>
                setInquire({ ...inquire, description: e.target.value })
              }
            />
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={saveInquire}
            disabled={savingInquire}
            className="bg-black text-white px-4 py-2 rounded disabled:opacity-60"
          >
            {savingInquire ? "Saving..." : "Save Inquiry Settings"}
          </button>
        </div>
      </div>

      {/* Admin management */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4 text-black">Admin Accounts</h2>

        {/* Create admin */}
        <form onSubmit={createAdmin} className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-6">
          <div>
            <label className="block text-sm text-black mb-1">Username</label>
            <input
              className="w-full p-2 border rounded text-black"
              value={newAdmin.username}
              onChange={(e) =>
                setNewAdmin({ ...newAdmin, username: e.target.value })
              }
            />
          </div>
          <div>
            <label className="block text-sm text-black mb-1">Password</label>
            <input
              type="password"
              className="w-full p-2 border rounded text-black"
              value={newAdmin.password}
              onChange={(e) =>
                setNewAdmin({ ...newAdmin, password: e.target.value })
              }
            />
          </div>
          <div>
            <label className="block text-sm text-black mb-1">Role</label>
            <select
              className="w-full p-2 border rounded text-black"
              value={newAdmin.role}
              onChange={(e) =>
                setNewAdmin({ ...newAdmin, role: e.target.value as Admin["role"] })
              }
            >
              <option value="admin">admin</option>
              <option value="manager">manager</option>
              <option value="superadmin">superadmin</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-black mb-1">Position</label>
            <select
              className="w-full p-2 border rounded text-black"
              value={newAdmin.position}
              onChange={(e) =>
                setNewAdmin({ ...newAdmin, position: e.target.value })
              }
            >
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={creating}
              className="bg-black text-white px-4 py-2 rounded w-full disabled:opacity-60"
            >
              {creating ? "Creating..." : "Create Admin"}
            </button>
          </div>
        </form>

        {/* Search */}
        <div className="flex items-center gap-3 mb-3">
          <input
            placeholder="Search admins (username, role, position)"
            className="w-full p-2 border rounded text-black"
            value={adminSearch}
            onChange={(e) => setAdminSearch(e.target.value)}
          />
          <button
            onClick={fetchAdmins}
            className="px-3 py-2 bg-black text-white rounded"
          >
            Refresh
          </button>
        </div>

        {/* Admins table */}
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
              {adminsLoading ? (
                <tr>
                  <td className="p-3 text-black" colSpan={6}>
                    Loading…
                  </td>
                </tr>
              ) : filteredAdmins.length === 0 ? (
                <tr>
                  <td className="p-3 text-black" colSpan={6}>
                    No admins found
                  </td>
                </tr>
              ) : (
                filteredAdmins.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="p-2 text-black">{a.username}</td>
                    <td className="p-2">
                      <select
                        className="p-1 border rounded text-black"
                        value={a.role}
                        onChange={(e) =>
                          updateAdminField(a.id, {
                            role: e.target.value as Admin["role"],
                          })
                        }
                      >
                        <option value="admin">admin</option>
                        <option value="manager">manager</option>
                        <option value="superadmin">superadmin</option>
                      </select>
                    </td>
                    <td className="p-2">
                      <select
                        className="p-1 border rounded text-black"
                        value={a.position || ""}
                        onChange={(e) =>
                          updateAdminField(a.id, { position: e.target.value })
                        }
                      >
                        {POSITIONS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      <button
                        onClick={() => toggleActive(a)}
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
                      <div className="flex gap-2">
                        <button
                          onClick={() => resetPassword(a)}
                          className="px-2 py-1 rounded bg-black text-white"
                        >
                          Reset Password
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit profile modal */}
      {editOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold mb-4 text-black">
              Edit Profile
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-black mb-1">
                  Full Name
                </label>
                <input
                  className="w-full p-2 border rounded text-black"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-black mb-1">
                  Position
                </label>
                <select
                  className="w-full p-2 border rounded text-black"
                  value={editPosition}
                  onChange={(e) => setEditPosition(e.target.value)}
                >
                  {POSITIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-black mb-1">
                  Password
                </label>
                <input
                  type="password"
                  className="w-full p-2 border rounded text-black"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setEditOpen(false)}
                className="flex-1 px-4 py-2 bg-gray-200 rounded text-black"
              >
                Cancel
              </button>
              <button
                onClick={saveProfile}
                disabled={savingProfile}
                className="flex-1 px-4 py-2 bg-black text-white rounded disabled:opacity-60"
              >
                {savingProfile ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}