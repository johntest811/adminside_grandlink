'use client';

import React, { useEffect, useState } from "react";
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Logo from '../../components/Logo';
import NotificationBell from "../../components/NotificationBell";
import RecentActivity from "../../components/RecentActivity";
import { logLogoutActivity } from "@/app/lib/activity"; // ADD
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [allowedPaths, setAllowedPaths] = useState<string[] | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false); // NEW
  const [adminTheme, setAdminTheme] = useState<"light" | "dark" | "midnight">("light");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Helper for active nav item
  const isActive = (path: string) => pathname === path;

  const applyTheme = (theme: "light" | "dark" | "midnight") => {
    setAdminTheme(theme);
    try {
      document.documentElement.dataset.adminTheme = theme;
    } catch {
      // ignore
    }
  };

  // Dropdown state
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  // Sidebar navigation structure
  const navStructure = [
    { name: 'Dashboard', path: '/dashboard', icon: '📊' },
    { name: 'Announcement', path: '/dashboard/announcement', icon: '📢' },
    {
      name: 'Accounts',
      icon: '👤',
      dropdown: [
        { name: 'User Accounts', path: '/dashboard/user-accounts' },
        { name: 'Employee Account', path: '/dashboard/admins' },
      ],
    },
    { name: 'Reports', path: '/dashboard/reports', icon: '📑' },
    {
      name: 'Inventory',
      icon: '📦',
      dropdown: [
        { name: 'Update Products', path: '/dashboard/UpdateProducts' },
        { name: 'Add Products', path: '/dashboard/products' },
        { name: 'Inventory', path: '/dashboard/inventory' },
        { name: 'Archive', path: '/dashboard/trash' },
        { name: 'Discounts', path: '/dashboard/discounts' },
      ],
    },
    {
      name: 'Task',
      icon: '📝',
      dropdown: [
        { name: 'Assigned Task', path: '/dashboard/task/assigntask' },
        { name: 'Employee Task', path: '/dashboard/task/employeetask' },
        { name: 'Admin Task', path: '/dashboard/task/admintask' },
      ],
    },
    // { name: 'Orders', path: '/dashboard/orders', icon: '🛒' },
    { name: 'Order Management', path: '/dashboard/order_management', icon: '📋' },
    { name: 'Calendar', path: '/dashboard/calendar', icon: '📅' },
    { name: 'User Inquiries', path: '/dashboard/inquiries', icon: '📨' },
    { name: 'Chat Inbox', path: '/dashboard/chat', icon: '💬' },
    {
      name: 'Content Management',
      icon: '🗂️',
      dropdown: [
        { name: 'Home', path: '/dashboard/pages/home' },
        { name: 'About Us', path: '/dashboard/pages/about' },
        { name: 'Blogs Editor', path: '/dashboard/pages/blogs_editor' },
        { name: 'Showrooms', path: '/dashboard/pages/showroom' },
        { name: 'Services We Offer', path: '/dashboard/pages/Service' },
        { name: 'Featured Projects', path: '/dashboard/pages/Featured' },
        { name: 'Delivery & Ordering Process', path: '/dashboard/pages/DeliveryProcess' },
        { name: 'FAQs', path: '/dashboard/pages/FAQs' },
        { name: 'Inquire Page Editor', path: '/dashboard/inquiries/editor', icon: '📝' },
      ],
    },
    { name: 'Predictive', path: '/dashboard/predictive', icon: '🔮' },
    { name: 'Sales Forecasting', path: '/dashboard/sales-forecasting', icon: '📈' },
    {
      name: 'Settings',
      icon: '⚙️',
      dropdown: [
        { name: 'Settings', path: '/dashboard/settings' },
        { name: 'Audit', path: '/dashboard/settings/audit' },
        { name: 'Roles & Permissions', path: '/dashboard/settings/roles' },
      ],
    },
  ];

  useEffect(() => {
    checkAuthAndLoadAdmin();
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("adminSidebarCollapsed");
      setIsSidebarCollapsed(saved === "1");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("adminSidebarCollapsed", isSidebarCollapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [isSidebarCollapsed]);

  useEffect(() => {
    const load = () => {
      try {
        const saved = localStorage.getItem("adminTheme");
        const next = (saved === "dark" || saved === "midnight" || saved === "light")
          ? (saved as "light" | "dark" | "midnight")
          : "light";
        applyTheme(next);
      } catch {
        applyTheme("light");
      }
    };

    const onThemeChanged = () => load();

    load();
    window.addEventListener("admin-theme-changed", onThemeChanged);
    window.addEventListener("storage", (e) => {
      if (e.key === "adminTheme") load();
    });

    return () => {
      window.removeEventListener("admin-theme-changed", onThemeChanged);
    };
  }, []);

  // Prefer the theme saved on the account (admins.theme) when available
  useEffect(() => {
    const loadAccountTheme = async () => {
      const adminId = currentAdmin?.id;
      const adminUsername = currentAdmin?.username;
      if (!adminId && !adminUsername) return;

      try {
        let q = supabase.from("admins").select("*").limit(1);
        if (adminId) q = q.eq("id", adminId);
        else q = q.eq("username", adminUsername);

        const { data, error } = await q.maybeSingle<any>();
        if (error) throw error;

        const t = (data as any)?.theme;
        if (t === "light" || t === "dark" || t === "midnight") {
          applyTheme(t);
          try {
            localStorage.setItem("adminTheme", t);
          } catch {}
          try {
            window.dispatchEvent(new Event("admin-theme-changed"));
          } catch {}
        }
      } catch (e) {
        // If the column doesn't exist yet, or RLS blocks it, fallback to localStorage/default.
        console.warn("Unable to load account theme; falling back", e);
      }
    };

    loadAccountTheme();
  }, [currentAdmin?.id, currentAdmin?.username]);

  useEffect(() => {
    const loadAllowed = async () => {
      if (!currentAdmin?.id) return;
      try {
        const res = await fetch(`/api/rbac/allowed-pages?adminId=${encodeURIComponent(currentAdmin.id)}`);
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.warn("RBAC allowed-pages failed", j?.error);
          setAllowedPaths(["/dashboard"]);
          return;
        }
        const paths = Array.isArray(j?.allowedPaths) ? j.allowedPaths : ["/dashboard"];
        // Always allow these utility pages
        const merged = Array.from(new Set(["/dashboard", "/dashboard/unauthorized", ...paths]));
        setAllowedPaths(merged);
      } catch (e) {
        console.warn("RBAC allowed-pages exception", e);
        setAllowedPaths(["/dashboard", "/dashboard/unauthorized"]);
      }
    };

    // Only fetch after we have an admin session
    loadAllowed();
  }, [currentAdmin?.id]);

  useEffect(() => {
    if (!allowedPaths) return;
    if (!pathname.startsWith("/dashboard")) return;

    // Allow exact match, or child routes of allowed pages (e.g. /dashboard/UpdateProducts/[id])
    const allowed = allowedPaths.some((p) => pathname === p || pathname.startsWith(p + "/"));
    if (!allowed) {
      router.push("/dashboard/unauthorized");
    }
  }, [pathname, allowedPaths, router]);

  const checkAuthAndLoadAdmin = () => {
    try {
      console.log("🔍 Checking admin session...");
      
      // Get admin session from localStorage
      const sessionData = localStorage.getItem('adminSession');
      if (!sessionData) {
        console.warn("⚠️ No admin session found");
        router.push('/login');
        setLoading(false);
        return;
      }

      const adminSession = JSON.parse(sessionData);
      console.log("✅ Admin session found:", adminSession);
      
      setCurrentAdmin(adminSession);
      setLoading(false);
    } catch (error) {
      console.error("💥 Error checking admin session:", error);
      router.push('/login');
      setLoading(false);
    }
  };

  const handleLogout = async () => { // make async
    try {
      const sessionData = localStorage.getItem('adminSession');
      const admin = sessionData ? JSON.parse(sessionData) : null;

      // Log logout before clearing session
      if (admin?.id && admin?.username) {
        await logLogoutActivity(admin.id, admin.username);
      }
    } catch (error) {
      console.error("Logout activity log error:", error);
    } finally {
      try {
        localStorage.removeItem('adminSession');
      } catch {}
      setCurrentAdmin(null);
      router.push('/login');
    }
  };

  const handleLogoutClick = () => setShowLogoutConfirm(true); // NEW

  if (loading || (currentAdmin && !allowedPaths)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mx-auto mb-4"></div>
          <p className="text-black">Loading admin panel...</p>
        </div>
      </div>
    );
  }

  const allowedSet = new Set(allowedPaths || []);
  const filteredNav = navStructure
    .map((item) => {
      if (!item.dropdown) {
        return allowedSet.has(item.path!) ? item : null;
      }
      const subs = item.dropdown.filter((sub) => allowedSet.has(sub.path));
      return subs.length ? { ...item, dropdown: subs } : null;
    })
    .filter(Boolean) as typeof navStructure;

  return (
    <div className="admin-app min-h-screen">
      <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            className="text-gray-600 lg:hidden"
            onClick={() => setIsMobileSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="flex items-center gap-3">
            <Logo color={adminTheme === "light" ? "dark" : "light"} />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Recent Activity - Popup Style */}
          <RecentActivity
            adminId={currentAdmin?.id}
            limit={10}
            showAsDropdown={true}
          />
          
          {/* Notifications */}
          <NotificationBell
            adminId={currentAdmin?.id}
            adminRole={currentAdmin?.role || currentAdmin?.position || "admin"}
          />

          <div className="ml-2 flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-medium">
              {currentAdmin?.username ? currentAdmin.username.charAt(0).toUpperCase() : "A"}
            </div>
            <div className="text-sm text-black font-medium">{currentAdmin?.username ?? "Admin User"}</div>
          </div>
        </div>
      </header>

      {/* Mobile sidebar backdrop */}
      {isMobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 lg:hidden"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar (scrollable) */}
      <aside
        className={`admin-sidebar fixed inset-y-0 left-0 z-30 w-64 ${isSidebarCollapsed ? "lg:w-20" : "lg:w-64"} bg-gray-800 text-white transform transition-transform duration-300 ease-in-out ${
          isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 flex flex-col`} // flex column to allow scrolling body
        aria-label="Sidebar navigation"
      >
        {/* Sidebar top header */}
        <div className="flex-shrink-0 flex items-center justify-between h-16 px-4 border-b border-white/10">
          <div className="flex-shrink-0">
            {isSidebarCollapsed ? (
              <div className="text-white font-bold">GL</div>
            ) : (
              <Logo color="light" />
            )}
          </div>
          <button
            className="hidden lg:inline-flex text-gray-300 hover:text-white"
            onClick={() => setIsSidebarCollapsed((v) => !v)}
            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <span className="text-xl">{isSidebarCollapsed ? "»" : "«"}</span>
          </button>
          <button className="lg:hidden text-gray-300 hover:text-white" onClick={() => setIsMobileSidebarOpen(false)}>
            <span className="text-2xl">×</span>
          </button>
        </div>

        {/* Scrollable nav content */}
        <div className="flex-1 overflow-y-auto overflow-x-visible p-4">
          <nav className="space-y-1">
            {filteredNav.map((item) =>
              item.dropdown ? (
                <div key={item.name} className={`mb-2 ${isSidebarCollapsed ? "relative" : ""}`}>
                  <button
                    type="button"
                    className={`flex items-center w-full ${isSidebarCollapsed ? "justify-center px-2" : "px-4"} py-3 text-sm font-medium rounded-md transition-colors ${openDropdown === item.name ? 'bg-gray-900 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
                    onClick={() => setOpenDropdown(openDropdown === item.name ? null : item.name)}
                    title={item.name}
                  >
                    <span className={isSidebarCollapsed ? "" : "mr-3"}>{item.icon}</span>
                    {!isSidebarCollapsed && (
                      <>
                        {item.name}
                        <span className="ml-auto">{openDropdown === item.name ? '▲' : '▼'}</span>
                      </>
                    )}
                  </button>
                  {openDropdown === item.name && (
                    isSidebarCollapsed ? (
                      <div className="absolute left-full top-0 ml-2 w-56 rounded-md border border-white/10 bg-gray-800 p-2 shadow-lg z-40">
                        <div className="text-xs text-gray-300 px-2 pb-1">{item.name}</div>
                        <div className="flex flex-col gap-1">
                          {item.dropdown.map((sub) => (
                            <Link
                              key={sub.path}
                              href={sub.path}
                              className={`px-3 py-2 text-xs rounded-md transition-colors ${isActive(sub.path) ? 'bg-gray-900 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
                              onClick={() => {
                                setIsMobileSidebarOpen(false);
                                setOpenDropdown(null);
                              }}
                            >
                              <span className="inline-flex items-center gap-2">
                                <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-white/10 text-white text-[10px]">
                                  {String((sub as any).icon || sub.name?.charAt(0)?.toUpperCase() || "•")}
                                </span>
                                <span>{sub.name}</span>
                              </span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="ml-8 mt-1 flex flex-col gap-1">
                        {item.dropdown.map((sub) => (
                          <Link
                            key={sub.path}
                            href={sub.path}
                            className={`px-3 py-2 text-xs rounded-md transition-colors ${isActive(sub.path) ? 'bg-gray-900 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
                            onClick={() => setIsMobileSidebarOpen(false)}
                          >
                            <span className="inline-flex items-center gap-2">
                              <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-white/10 text-white text-[9px]">
                                {String((sub as any).icon || sub.name?.charAt(0)?.toUpperCase() || "•")}
                              </span>
                              <span>{sub.name}</span>
                            </span>
                          </Link>
                        ))}
                      </div>
                    )
                  )}
                </div>
              ) : (
                <Link
                  key={item.path}
                  href={item.path}
                  className={`flex items-center ${isSidebarCollapsed ? "justify-center px-2" : "px-4"} py-3 text-sm font-medium rounded-md transition-colors ${isActive(item.path) ? 'bg-gray-900 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
                  onClick={() => setIsMobileSidebarOpen(false)}
                  title={item.name}
                >
                  <span className={isSidebarCollapsed ? "" : "mr-3"}>{item.icon}</span>
                  {!isSidebarCollapsed && item.name}
                </Link>
              )
            )}
          </nav>
        </div>

        {/* Footer with logout (not absolute; stays after scrollable area) */}
        <div className="flex-shrink-0 w-full p-4 border-t border-white/10">
          <button
            onClick={handleLogoutClick}
            className={`flex items-center w-full ${isSidebarCollapsed ? "justify-center px-2" : "px-4"} py-3 text-sm font-medium text-gray-300 rounded-md hover:bg-gray-700 hover:text-white`}
            title="Logout"
          >
            <span className={isSidebarCollapsed ? "" : "mr-3"}>🚪</span>
            {!isSidebarCollapsed && "Logout"}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className={`flex-1 ${isSidebarCollapsed ? "lg:ml-20" : "lg:ml-64"}`}>
        <main className="p-4 lg:p-8">
          {children}
        </main>
      </div>

      {/* Logout confirmation popup */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
            <div className="px-5 py-4 border-b">
              <h3 className="text-lg font-semibold text-black">Confirm Logout</h3>
            </div>
            <div className="px-5 py-4 text-black">
              Are you sure you want to log out?
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="px-4 py-2 bg-gray-200 rounded text-black"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowLogoutConfirm(false); handleLogout(); }}
                className="px-4 py-2 bg-black text-white rounded"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}