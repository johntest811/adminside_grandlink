'use client';

import React, { useEffect, useRef, useState } from "react";
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Logo from '../../components/Logo';
import NotificationBell from "../../components/NotificationBell";
import RecentActivity from "../../components/RecentActivity";
import { logLogoutActivity } from "@/app/lib/activity"; // ADD
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import {
  BarChart3,
  Megaphone,
  Users,
  FileBarChart2,
  Boxes,
  ListChecks,
  ClipboardList,
  CalendarDays,
  Mail,
  MessageSquare,
  FolderKanban,
  Sparkles,
  CreditCard,
  Settings,
  ChevronDown,
  ChevronRight,
  LogOut,
  CheckCircle,
} from "lucide-react";

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
  const [showTaskDropdown, setShowTaskDropdown] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [editFullName, setEditFullName] = useState("");
  const [editPosition, setEditPosition] = useState("");
  const [editProfileImageUrl, setEditProfileImageUrl] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingProfileImage, setUploadingProfileImage] = useState(false);
  const [myTasks, setMyTasks] = useState<any[]>([]);
  const [loadingMyTasks, setLoadingMyTasks] = useState(false);
  const taskDropdownRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const navButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [collapsedFlyout, setCollapsedFlyout] = useState<{ name: string; top: number } | null>(null);

  const [flyoutViewportHeight, setFlyoutViewportHeight] = useState<number>(0);

  const basePath = (p?: string) => String(p || "").split("#")[0];

  // Helper for active nav item
  const isActive = (path: string) => pathname === basePath(path);

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

  type NavSubItem = { name: string; path: string; icon?: React.ReactNode };
  type NavItem = {
    name: string;
    path?: string;
    icon: React.ReactNode;
    dropdown?: NavSubItem[];
  };

  // Sidebar navigation structure
  const navStructure: NavItem[] = [
    { name: 'Dashboard', path: '/dashboard', icon: <BarChart3 className="h-4 w-4" /> },
    { name: 'Announcement', path: '/dashboard/announcement', icon: <Megaphone className="h-4 w-4" /> },
    {
      name: 'Accounts',
      icon: <Users className="h-4 w-4" />,
      dropdown: [
        { name: 'User Accounts', path: '/dashboard/user-accounts' },
        { name: 'Admin Accounts', path: '/dashboard/admins' },
      ],
    },
    { name: 'Reports', path: '/dashboard/reports', icon: <FileBarChart2 className="h-4 w-4" /> },
    {
      name: 'Inventory',
      icon: <Boxes className="h-4 w-4" />,
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
      icon: <ListChecks className="h-4 w-4" />,
      dropdown: [
        { name: 'Assigned Task', path: '/dashboard/task/assigntask' },
        { name: 'Employee Task', path: '/dashboard/task/employeetask' },
        { name: 'Admin Task', path: '/dashboard/task/admintask' },
      ],
    },
    // { name: 'Orders', path: '/dashboard/orders', icon: '🛒' },
    { name: 'Order Management', path: '/dashboard/order_management', icon: <ClipboardList className="h-4 w-4" /> },
    { name: 'Calendar', path: '/dashboard/calendar', icon: <CalendarDays className="h-4 w-4" /> },
    { name: 'User Inquiries', path: '/dashboard/inquiries', icon: <Mail className="h-4 w-4" /> },
    { name: 'Chat Inbox', path: '/dashboard/chat', icon: <MessageSquare className="h-4 w-4" /> },
    {
      name: 'Content Management',
      icon: <FolderKanban className="h-4 w-4" />,
      dropdown: [
        { name: 'Home', path: '/dashboard/Content_management/home' },
        { name: 'About Us', path: '/dashboard/Content_management/about' },
        { name: 'Blogs Editor', path: '/dashboard/Content_management/blogs_editor' },
        { name: 'Showrooms', path: '/dashboard/Content_management/showroom' },
        { name: 'Services We Offer', path: '/dashboard/Content_management/Service' },
        { name: 'Featured Projects', path: '/dashboard/Content_management/Featured' },
        { name: 'Products Page', path: '/dashboard/Content_management/products' },
        { name: 'Delivery & Ordering Process', path: '/dashboard/Content_management/DeliveryProcess' },
        { name: 'FAQs', path: '/dashboard/Content_management/FAQs' },
        { name: 'Inquire Page Editor', path: '/dashboard/inquiries/editor', icon: '📝' },
      ],
    },
    { name: 'Predictive', path: '/dashboard/predictive', icon: <Sparkles className="h-4 w-4" /> },
    {
      name: 'Sales',
      icon: <CreditCard className="h-4 w-4" />,
      dropdown: [
        { name: 'Invoices', path: '/dashboard/sales/invoices' },
        { name: 'Quotations', path: '/dashboard/sales/quotations' },
        { name: 'Sales Forecasting', path: '/dashboard/sales-forecasting' },
      ],
    },
    {
      name: 'Settings',
      icon: <Settings className="h-4 w-4" />,
      dropdown: [
        { name: 'Settings', path: '/dashboard/settings' },
        { name: 'Audit', path: '/dashboard/settings/audit' },
        { name: 'Access Control', path: '/dashboard/settings/roles' },
      ],
    },
  ];

  useEffect(() => {
    try {
      console.log("🔍 Checking admin session...");

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
  }, [router]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (taskDropdownRef.current && !taskDropdownRef.current.contains(target)) {
        setShowTaskDropdown(false);
      }
      if (profileMenuRef.current && !profileMenuRef.current.contains(target)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    const loadMyTasks = async () => {
      if (!currentAdmin?.id) return;
      setLoadingMyTasks(true);
      try {
        const { data, error } = await supabase
          .from("tasks")
          .select("id, task_name, status, due_date, product_name")
          .eq("assigned_admin_id", currentAdmin.id)
          .neq("status", "completed")
          .order("due_date", { ascending: true })
          .limit(8);

        if (error) throw error;
        setMyTasks(data || []);
      } catch (e) {
        console.error("Failed to load my tasks", e);
        setMyTasks([]);
      } finally {
        setLoadingMyTasks(false);
      }
    };

    loadMyTasks();
  }, [currentAdmin?.id]);

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
    setCollapsedFlyout(null);
  }, [isSidebarCollapsed]);

  useEffect(() => {
    const update = () => setFlyoutViewportHeight(window.innerHeight || 0);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

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

        if (data) {
          try {
            const fallbackImage = localStorage.getItem(`adminProfileImage:${data.id}`) || "";
            if (fallbackImage && !data.profile_image_url) {
              data.profile_image_url = fallbackImage;
            }
          } catch {}

          setCurrentAdmin((prev: any) => ({ ...(prev || {}), ...data }));
        }

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

  const getAdminInitial = () => {
    const label = String(currentAdmin?.full_name || currentAdmin?.username || "A").trim();
    return label.charAt(0).toUpperCase() || "A";
  };

  const getAdminProfileImage = () => {
    return String(
      currentAdmin?.profile_image_url || currentAdmin?.avatar_url || currentAdmin?.image_url || ""
    ).trim();
  };

  const openProfileEdit = () => {
    setEditFullName(String(currentAdmin?.full_name || ""));
    setEditPosition(String(currentAdmin?.position || "Admin"));
    setEditProfileImageUrl(getAdminProfileImage());
    setShowProfileEdit(true);
    setShowProfileMenu(false);
  };

  const uploadAdminProfileImage = async (file: File): Promise<string> => {
    if (!currentAdmin?.id) throw new Error("No admin session found.");
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `admin-profiles/${currentAdmin.id}/${Date.now()}-${safeName}`;

    const { error } = await supabase.storage
      .from("uploads")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;

    const { data } = supabase.storage.from("uploads").getPublicUrl(path);
    if (!data?.publicUrl) throw new Error("Failed to resolve uploaded image URL.");
    return data.publicUrl;
  };

  const onPickAdminProfileImage = async (file: File | null) => {
    if (!file) return;
    setUploadingProfileImage(true);
    try {
      const publicUrl = await uploadAdminProfileImage(file);
      setEditProfileImageUrl(publicUrl);
    } catch (e: any) {
      alert(`Failed to upload profile image: ${e?.message || e}`);
    } finally {
      setUploadingProfileImage(false);
    }
  };

  const saveTopNavProfile = async () => {
    if (!currentAdmin?.id) return;
    setSavingProfile(true);
    try {
      const updates: any = {
        full_name: editFullName || null,
        position: editPosition || null,
        profile_image_url: editProfileImageUrl || null,
      };

      let { error } = await supabase.from("admins").update(updates).eq("id", currentAdmin.id);

      if (error && String(error.message || "").toLowerCase().includes("profile_image_url")) {
        const fallback = {
          full_name: editFullName || null,
          position: editPosition || null,
        };
        const retry = await supabase.from("admins").update(fallback).eq("id", currentAdmin.id);
        error = retry.error;
        if (!error) {
          try {
            localStorage.setItem(`adminProfileImage:${currentAdmin.id}`, editProfileImageUrl || "");
          } catch {}
        }
      }

      if (error) throw error;

      setCurrentAdmin((prev: any) => ({
        ...(prev || {}),
        full_name: editFullName || null,
        position: editPosition || null,
        profile_image_url: editProfileImageUrl || null,
      }));
      setShowProfileEdit(false);
    } catch (e: any) {
      alert(`Failed to save profile: ${e?.message || e}`);
    } finally {
      setSavingProfile(false);
    }
  };

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
        return allowedSet.has(basePath(item.path!)) ? item : null;
      }
      const subs = item.dropdown.filter((sub) => allowedSet.has(basePath(sub.path)));
      return subs.length ? { ...item, dropdown: subs } : null;
    })
    .filter(Boolean) as typeof navStructure;

  const activeFlyoutItem =
    collapsedFlyout && isSidebarCollapsed
      ? (filteredNav.find((item) => item.name === collapsedFlyout.name && item.dropdown) as any)
      : null;

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
          <div className="relative" ref={taskDropdownRef}>
            <button
              type="button"
              className="relative p-2 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 rounded-full transition-colors"
              onClick={() => setShowTaskDropdown((v) => !v)}
              aria-label="My tasks"
              title="My Tasks"
            >
              <CheckCircle className="h-6 w-6" />
              {myTasks.length > 0 && (
                <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-medium animate-pulse">
                  {myTasks.length > 9 ? '9+' : myTasks.length}
                </span>
              )}
            </button>

            {showTaskDropdown && (
              <div className="absolute right-0 mt-2 w-96 rounded-xl border border-gray-200 bg-white shadow-xl z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-white">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-900">My Tasks</div>
                    <div className="text-xs text-gray-500">{myTasks.length} active</div>
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto bg-white">
                  {loadingMyTasks ? (
                    <div className="px-4 py-4 text-sm text-gray-600">Loading tasks...</div>
                  ) : myTasks.length === 0 ? (
                    <div className="px-4 py-5 text-sm text-gray-600">No active tasks assigned.</div>
                  ) : (
                    myTasks.map((task) => (
                      <Link
                        key={task.id}
                        href="/dashboard/task/employeetask"
                        className="block px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors"
                        onClick={() => setShowTaskDropdown(false)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-gray-900 truncate">{task.task_name || task.product_name || `Task #${task.id}`}</div>
                            <div className="text-xs text-gray-600 mt-1">{task.due_date ? `Due ${new Date(task.due_date).toLocaleDateString()}` : "No due date"}</div>
                          </div>
                          <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-100 text-indigo-700">
                            {task.status || "pending"}
                          </span>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
                <div className="px-4 py-2 border-t border-gray-200 bg-gray-50">
                  <Link href="/dashboard/task/employeetask" className="text-xs font-medium text-indigo-700 hover:underline" onClick={() => setShowTaskDropdown(false)}>
                    Open Employee Task Page
                  </Link>
                </div>
              </div>
            )}
          </div>

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

          <div className="ml-2 relative" ref={profileMenuRef}>
            <button
              type="button"
              onClick={() => setShowProfileMenu((v) => !v)}
              className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-gray-100 transition-colors"
            >
              <div className="h-8 w-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-medium overflow-hidden">
                {getAdminProfileImage() ? (
                  <img
                    src={getAdminProfileImage()}
                    alt="Admin profile"
                    className="h-8 w-8 object-cover"
                  />
                ) : (
                  getAdminInitial()
                )}
              </div>
              <div className="text-sm text-black font-medium">
                {currentAdmin?.full_name || currentAdmin?.username || "Admin User"}
              </div>
            </button>

            {showProfileMenu && (
              <div className="absolute right-0 mt-2 w-44 rounded-lg border border-gray-200 bg-white shadow-lg z-50 overflow-hidden">
                <button
                  type="button"
                  onClick={openProfileEdit}
                  className="w-full text-left px-4 py-2 text-sm text-black hover:bg-gray-100"
                >
                  Edit Profile
                </button>
                <button
                  type="button"
                  onClick={handleLogoutClick}
                  className="w-full text-left px-4 py-2 text-sm text-black hover:bg-gray-100"
                >
                  Logout
                </button>
              </div>
            )}
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
        } lg:translate-x-0 flex flex-col`} 
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
                    onClick={(event) => {
                      const target = event.currentTarget as HTMLButtonElement;
                      navButtonRefs.current[item.name] = target;

                      if (isSidebarCollapsed) {
                        if (collapsedFlyout?.name === item.name) {
                          setCollapsedFlyout(null);
                          setOpenDropdown(null);
                        } else {
                          const rect = target.getBoundingClientRect();
                          setCollapsedFlyout({ name: item.name, top: rect.top });
                          setOpenDropdown(item.name);
                        }
                        return;
                      }

                      setCollapsedFlyout(null);
                      setOpenDropdown(openDropdown === item.name ? null : item.name);
                    }}
                    title={item.name}
                  >
                    <span className={isSidebarCollapsed ? "" : "mr-3"}>{item.icon}</span>
                    {!isSidebarCollapsed && (
                      <>
                        {item.name}
                        <span className="ml-auto">{openDropdown === item.name ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
                      </>
                    )}
                  </button>
                  {openDropdown === item.name && (
                    isSidebarCollapsed ? null : (
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
                  key={item.path || item.name}
                  href={item.path || "/dashboard"}
                  className={`flex items-center ${isSidebarCollapsed ? "justify-center px-2" : "px-4"} py-3 text-sm font-medium rounded-md transition-colors ${isActive(item.path || "") ? 'bg-gray-900 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
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
            <span className={isSidebarCollapsed ? "" : "mr-3"}><LogOut className="h-4 w-4" /></span>
            {!isSidebarCollapsed && "Logout"}
          </button>
        </div>
      </aside>

      {activeFlyoutItem && (
        <div
          className="fixed z-[70] w-56 rounded-md border border-white/10 bg-gray-800 p-2 shadow-lg max-h-[calc(100vh-96px)] overflow-y-auto"
          style={{
            left: 84,
            top: (() => {
              const preferredTop = Math.max(72, collapsedFlyout?.top || 72);
              const viewport = flyoutViewportHeight || 0;
              if (!viewport) return preferredTop;
              const maxTop = Math.max(72, viewport - 96);
              return Math.min(preferredTop, maxTop);
            })(),
          }}
          onMouseLeave={() => setCollapsedFlyout(null)}
        >
          <div className="text-xs text-gray-300 px-2 pb-1">{activeFlyoutItem.name}</div>
          <div className="flex flex-col gap-1">
            {activeFlyoutItem.dropdown.map((sub: any) => (
              <Link
                key={sub.path}
                href={sub.path}
                className={`px-3 py-2 text-xs rounded-md transition-colors ${isActive(sub.path) ? 'bg-gray-900 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`}
                onClick={() => {
                  setIsMobileSidebarOpen(false);
                  setOpenDropdown(null);
                  setCollapsedFlyout(null);
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded bg-white/10 text-white text-[9px]">•</span>
                  <span>{sub.name}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

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

      {/* Top-nav profile edit popup */}
      {showProfileEdit && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-black">Edit Profile</h3>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-black mb-1">Full Name</label>
                <input
                  className="w-full p-2 border rounded text-black"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-black mb-1">Position</label>
                <input
                  className="w-full p-2 border rounded text-black"
                  value={editPosition}
                  onChange={(e) => setEditPosition(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-black mb-1">Profile Image URL</label>
                <input
                  className="w-full p-2 border rounded text-black"
                  value={editProfileImageUrl}
                  onChange={(e) => setEditProfileImageUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-black mb-1">Upload Profile Image</label>
                <input
                  type="file"
                  accept="image/*"
                  className="w-full p-2 border rounded text-black"
                  onChange={(e) => onPickAdminProfileImage(e.target.files?.[0] || null)}
                  disabled={uploadingProfileImage}
                />
                {uploadingProfileImage && (
                  <p className="mt-1 text-xs text-gray-600">Uploading image...</p>
                )}
              </div>
              {editProfileImageUrl && (
                <div className="flex items-center gap-3 p-2 border rounded">
                  <img
                    src={editProfileImageUrl}
                    alt="Profile preview"
                    className="h-12 w-12 rounded-full object-cover border"
                  />
                  <span className="text-xs text-black break-all">Preview</span>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowProfileEdit(false)}
                className="px-4 py-2 bg-gray-200 rounded text-black"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveTopNavProfile}
                disabled={savingProfile}
                className="px-4 py-2 bg-black text-white rounded disabled:opacity-60"
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