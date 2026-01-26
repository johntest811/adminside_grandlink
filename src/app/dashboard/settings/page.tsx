"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

type Admin = {
  id: string;
  username: string;
  role: "superadmin" | "admin" | "manager" | "employee";
  position?: string | null;
  theme?: "light" | "dark" | "midnight" | string | null;
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

const DEFAULT_POSITIONS = [
  "Sales Manager",
  "Site Manager",
  "Media Handler",
  "Supervisor",
  "Employee",
  "Manager",
  "Admin",
  "Superadmin",
];

export default function SettingsPage() {
  // Current admin (loaded from Supabase Auth or localStorage)
  const [currentAdmin, setCurrentAdmin] = useState<Admin | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // Positions list used by the profile editor dropdown
  const [positionsList, setPositionsList] = useState<string[]>(DEFAULT_POSITIONS);

  // Admin theme (persisted to localStorage; applied by dashboard layout)
  const [adminTheme, setAdminTheme] = useState<"light" | "dark" | "midnight">("light");

  // Edit profile modal
  const [editOpen, setEditOpen] = useState(false);
  const [editFullName, setEditFullName] = useState("");
  const [editPosition, setEditPosition] = useState<string>("");
  const [editPassword, setEditPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    loadCurrentAdminProfile();
  }, []);

  useEffect(() => {
    const loadPositions = async () => {
      try {
        const res = await fetch("/api/rbac/positions");
        const j = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const names = Array.isArray(j?.positions)
          ? j.positions.map((p: any) => String(p?.name)).filter(Boolean)
          : [];
        if (names.length) setPositionsList(names);
      } catch {
        // ignore
      }
    };

    loadPositions();
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("adminTheme");
      if (saved === "light" || saved === "dark" || saved === "midnight") {
        setAdminTheme(saved);
      }
    } catch {
      // ignore
    }
  }, []);

  const setTheme = async (theme: "light" | "dark" | "midnight") => {
    setAdminTheme(theme);
    try {
      localStorage.setItem("adminTheme", theme);
    } catch {}
    try {
      window.dispatchEvent(new Event("admin-theme-changed"));
    } catch {}

    // Persist to the admin account (requires `admins.theme` column)
    if (currentAdmin?.id) {
      try {
        const { error } = await supabase
          .from("admins")
          // use any-cast to avoid TS mismatch if the column isn't in generated types
          .update({ theme } as any)
          .eq("id", currentAdmin.id);
        if (error) {
          // If the column doesn't exist yet, this will fail; UI still works via localStorage.
          console.warn("Failed to persist theme to admins.theme", error);
        } else {
          setCurrentAdmin((prev) => (prev ? ({ ...prev, theme } as any) : prev));
        }
      } catch (e) {
        console.warn("Theme persist exception", e);
      }
    }
  };

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

        // Prefer theme saved on the account (fallback to localStorage/default)
        const t = (adminRow as any)?.theme;
        if (t === "light" || t === "dark" || t === "midnight") {
          setAdminTheme(t);
          try {
            localStorage.setItem("adminTheme", t);
          } catch {}
          try {
            window.dispatchEvent(new Event("admin-theme-changed"));
          } catch {}
        }
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
    const ok = window.confirm("Are you sure you want to log out?");
    if (!ok) return;
    try {
      await supabase.auth.signOut();
    } catch {}
    try {
      localStorage.removeItem("adminSession");
    } catch {}
    window.location.href = "/login";
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

  useEffect(() => {
    // Load initial settings
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

    };
    load();
  }, []);

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

      {/* Theme settings */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4 text-black">Theme</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            onClick={() => setTheme("light")}
            className={`p-4 rounded border text-left ${
              adminTheme === "light" ? "bg-black text-white" : "bg-gray-50 text-black"
            }`}
          >
            <div className="font-semibold">Light</div>
            <div className="text-sm opacity-80">Default light theme</div>
          </button>

          <button
            onClick={() => setTheme("dark")}
            className={`p-4 rounded border text-left ${
              adminTheme === "dark" ? "bg-black text-white" : "bg-gray-50 text-black"
            }`}
          >
            <div className="font-semibold">Dark</div>
            <div className="text-sm opacity-80">Classic dark mode</div>
          </button>

          <button
            onClick={() => setTheme("midnight")}
            className={`p-4 rounded border text-left ${
              adminTheme === "midnight" ? "bg-black text-white" : "bg-gray-50 text-black"
            }`}
          >
            <div className="font-semibold">Midnight</div>
            <div className="text-sm opacity-80">Deep navy dark theme</div>
          </button>
        </div>
        <p className="mt-3 text-sm text-black">
          This applies across the entire admin dashboard.
        </p>
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
                  {positionsList.map((p) => (
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