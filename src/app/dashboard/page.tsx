"use client";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import { logActivity } from "@/app/lib/activity";
// charts
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend } from "chart.js";
import { Bar } from "react-chartjs-2";
import { CalendarDays, Clock3 } from "lucide-react";

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend);

// Helper utils for activity rendering
const parseMetadata = (m: any) => {
  if (!m) return null;
  if (typeof m === "string") {
    try { return JSON.parse(m); } catch { return { raw: m }; }
  }
  return m;
};

const getPageDisplayName = (page?: string) => {
  if (!page) return null;
  const map: Record<string, string> = {
    dashboard: "Dashboard",
    inventory: "Inventory",
    products: "Products",
    "order_management": "Order Management",
    "accepted-orders": "Accepted Orders",
    "cancelled-orders": "Cancelled Orders",
    inquiries: "Inquiries",
    reports: "Reports",
    settings: "Settings",
    "settings/audit": "Audit Logs",
    admins: "Admins",
    "user-accounts": "User Accounts",
    calendar: "Calendar",
    task: "Tasks",
  };
  return map[page] || page;
};

const getActionColor = (action?: string) => {
  switch ((action || "").toLowerCase()) {
    case "create":
    case "add":
    case "accept_order":
    case "reserve_order":
      return "border-green-500 bg-green-50";
    case "view":
      return "border-gray-400 bg-gray-100";
    case "update":
    case "stock":
    case "change":
    case "order":
      return "border-blue-500 bg-blue-50";
    case "delete":
    case "cancelled":
    case "cancel":
      return "border-red-500 bg-red-50";
    case "login":
    case "logout":
      return "border-gray-400 bg-gray-50";
    default:
      return "border-indigo-500 bg-indigo-50";
  }
};

const getActionIcon = (action?: string) => {
  switch ((action || "").toLowerCase()) {
    case "create":
    case "add":
      return "➕";
    case "update":
    case "change":
      return "♻️";
    case "delete":
      return "🗑️";
    case "stock":
      return "📦";
    case "order":
    case "accept_order":
    case "reserve_order":
      return "🧾";
    case "login":
      return "🔐";
    case "logout":
      return "🔓";
    case "cancelled":
    case "cancel":
      return "⛔";
    default:
      return "📝";
  }
};

const formatTimeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleString();
};

type ActivityLog = {
  id: string | number;
  admin_id: string;
  admin_name: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  details: string;
  page?: string;
  metadata?: string;
  created_at: string;
};

export default function DashboardPage() {
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [recentActivities, setRecentActivities] = useState<ActivityLog[]>([]);
  // Removed averagePrice from stats
  const [stats, setStats] = useState({
    totalProducts: 0,
    numberOfSales: 0,
    totalUserAccounts: 0,
    activeUsers: 0,
    pendingOrders: 0,
  });

  const [, setDailySales] = useState<{ date: string; amount: number }[]>([]);
  const [, setWeeklySales] = useState<{ label: string; amount: number }[]>([]);
  // New: Orders status summary (last 30 days)
  const [, setOrdersStatusCounts] = useState<{ successful: number; cancelled: number; pending: number }>({
    successful: 0,
    cancelled: 0,
    pending: 0,
  });
  // NEW: Orders by Status timeframes
  const [ordersStatusTab, setOrdersStatusTab] = useState<"day" | "week" | "month">("day");
  const [ordersStatusDay, setOrdersStatusDay] = useState<Array<{ label: string; successful: number; cancelled: number; pending: number }>>([]);
  const [ordersStatusWeek, setOrdersStatusWeek] = useState<Array<{ label: string; successful: number; cancelled: number; pending: number }>>([]);
  const [ordersStatusMonth, setOrdersStatusMonth] = useState<Array<{ label: string; successful: number; cancelled: number; pending: number }>>([]);

  // NEW: Active Users timeframes
  const [activeTab, setActiveTab] = useState<"day" | "week" | "month">("day");
  const [activeUsersDay, setActiveUsersDay] = useState<{ label: string; count: number }[]>([]);
  const [activeUsersWeek, setActiveUsersWeek] = useState<{ label: string; count: number }[]>([]);
  const [activeUsersMonth, setActiveUsersMonth] = useState<{ label: string; count: number }[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
  const [myTasks, setMyTasks] = useState<any[]>([]);

  useEffect(() => {
    // Load current admin from localStorage
    const loadCurrentAdmin = () => {
      try {
        console.log("🔍 Loading current admin from localStorage...");
        const sessionData = localStorage.getItem('adminSession');
        if (sessionData) {
          const admin = JSON.parse(sessionData);
          console.log("✅ Admin loaded from session:", admin);
          setCurrentAdmin(admin);
        } else {
          console.log("❌ No admin session found");
        }
      } catch (error) {
        console.error("💥 Error loading admin session:", error);
      }
    };

    loadCurrentAdmin();
  }, []);

  useEffect(() => {
    // Fetch ALL recent activities for dashboard display
    const fetchRecentActivities = async () => {
      try {
        console.log("📋 Fetching ALL activities for dashboard...");
        const { data, error } = await supabase
          .from("activity_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100);

        if (error) {
          console.error("❌ Activities fetch error:", error);
          setRecentActivities([]);
          return;
        }
        
        console.log("✅ All activities fetched:", data?.length || 0);
        setRecentActivities(data || []);
      } catch (e) {
        console.error("💥 Activities fetch exception:", e);
        setRecentActivities([]);
      }
    };

    // Initial fetch
    fetchRecentActivities();

    // Set up real-time subscription for ALL activities
    const channel = supabase
      .channel("dashboard_all_activity_logs")
      .on("postgres_changes", { 
        event: "INSERT", 
        schema: "public", 
        table: "activity_logs"
      }, () => {
        console.log("🔄 Real-time activity update received (all activities)");
        fetchRecentActivities();
      })
      .subscribe();

    // Cleanup function
    return () => {
      try { 
        supabase.removeChannel(channel); 
      } catch (e) {
        console.error("Error removing channel:", e);
      }
    };
  }, []); // Empty dependency array - no dependencies that change

  useEffect(() => {
    fetchMetrics();
  }, []);

  useEffect(() => {
    const fetchDashboardExtras = async () => {
      try {
        const nowIso = new Date().toISOString();
        const { data: eventsData } = await supabase
          .from("calendar_events")
          .select("id, title, start, end, location")
          .gte("start", nowIso)
          .order("start", { ascending: true })
          .limit(6);
        setUpcomingEvents(eventsData || []);
      } catch (e) {
        console.error("Failed to fetch calendar events for dashboard", e);
        setUpcomingEvents([]);
      }

      if (!currentAdmin?.id) {
        setMyTasks([]);
        return;
      }

      try {
        const { data: tasksData } = await supabase
          .from("tasks")
          .select("id, task_name, status, due_date, product_name")
          .eq("assigned_admin_id", currentAdmin.id)
          .neq("status", "completed")
          .order("due_date", { ascending: true })
          .limit(6);
        setMyTasks(tasksData || []);
      } catch (e) {
        console.error("Failed to fetch current admin tasks", e);
        setMyTasks([]);
      }
    };

    fetchDashboardExtras();
  }, [currentAdmin?.id]);

  const fetchMetrics = async () => {
    try {
      // Products count
      {
        const { count } = await supabase.from("products").select("*", { count: "exact", head: true });
        setStats((s) => ({ ...s, totalProducts: count || 0 }));
      }

      // Payment sessions (completed)
      const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);
      const last30 = new Date(Date.now() - 30*24*60*60*1000);
      const last365 = new Date(Date.now() - 365*24*60*60*1000);

      await supabase
        .from("payment_sessions")
        .select("amount, status, created_at")
        .gte("created_at", startOfMonth.toISOString());

      // Daily sales (last 10 days) for the line chart below
      const { data: sessions30 } = await supabase
        .from("payment_sessions")
        .select("amount, status, created_at")
        .gte("created_at", last30.toISOString());

      const completed30 = (sessions30 || []).filter((s: any) => s.status === "completed");
      const byDaySales = new Map<string, number>();
      completed30.forEach((s: any) => {
        const d = new Date(s.created_at).toLocaleDateString();
        byDaySales.set(d, (byDaySales.get(d) || 0) + Number(s.amount || 0));
      });
      const last10 = Array.from(byDaySales.entries())
        .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
        .slice(-10)
        .map(([date, amount]) => ({ date, amount }));

      // Weekly sales (last 7 days buckets)
      const weekday = ["S","M","T","W","T","F","S"];
      const now = new Date();
      const week: { label: string; amount: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const label = weekday[d.getDay()];
        const key = d.toLocaleDateString();
        week.push({ label, amount: byDaySales.get(key) || 0 });
      }

      // Active users (distinct user_id updated in last 30d for KPI)
      const { data: recentItems } = await supabase
        .from("user_items")
        .select("user_id, updated_at")
        .gte("updated_at", last30.toISOString())
        .limit(5000);
      const activeUsers = new Set((recentItems || []).map((r: any) => r.user_id)).size;

      // Pending orders (not completed/cancelled)
      const { count: pendingOrders } = await supabase
        .from("user_items")
        .select("*", { count: "exact", head: true })
        .not("order_status", "in", `("completed","cancelled")`);

      // Orders by Status (last 30 days) for dashboard summary
      const { data: orders30 } = await supabase
        .from("user_items")
        .select("status, order_status, created_at, item_type")
        .gte("created_at", last30.toISOString())
        .in("item_type", ["order", "reservation"]) 
        .limit(20000);

      const successStatuses = ["completed", "approved", "ready_for_delivery", "delivered"];
      const statusCounts = { successful: 0, cancelled: 0, pending: 0 } as {
        successful: number; cancelled: number; pending: number;
      };
      (orders30 || []).forEach((o: any) => {
        const s = String(o.order_status || o.status || "").toLowerCase();
        if (successStatuses.includes(s)) statusCounts.successful += 1;
        else if (s === "cancelled") statusCounts.cancelled += 1;
        else statusCounts.pending += 1;
      });
      setOrdersStatusCounts(statusCounts);

      // KPI: Number of Sales = completed/delivered orders in the current month
      let numberOfSales = 0;
      try {
        const { data: ordersMonth } = await supabase
          .from("user_items")
          .select("status, order_status, created_at, item_type")
          .gte("created_at", startOfMonth.toISOString())
          .in("item_type", ["order", "reservation"])
          .limit(50000);
        numberOfSales = (ordersMonth || []).filter((o: any) => {
          const s = String(o.order_status || o.status || "").toLowerCase();
          return successStatuses.includes(s);
        }).length;
      } catch {
        numberOfSales = 0;
      }

      // KPI: Total user accounts
      let totalUserAccounts = 0;
      try {
        const res = await fetch("/api/admin-users");
        if (res.ok) {
          const result = await res.json();
          totalUserAccounts = Array.isArray(result?.users) ? result.users.length : 0;
        }
      } catch {
        totalUserAccounts = 0;
      }

      // NEW: Pull 12 months of user_items activity for day/week/month aggregation
      const { data: items365 } = await supabase
        .from("user_items")
        .select("user_id, updated_at")
        .gte("updated_at", last365.toISOString())
        .limit(20000);

      const items = (items365 || []).map((r: any) => ({ user_id: r.user_id, updated_at: r.updated_at }));

      // NEW: Pull orders with statuses for the same 12 months window
      const { data: orders365 } = await supabase
        .from("user_items")
        .select("status, order_status, created_at, item_type")
        .gte("created_at", last365.toISOString())
        .in("item_type", ["order", "reservation"]) 
        .limit(50000);

      // Helpers
      const ymd = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };
      const startOfWeek = (d: Date) => {
        const n = new Date(d);
        const day = n.getDay(); // 0=Sun
        n.setDate(n.getDate() - day + 1); // Monday start
        n.setHours(0,0,0,0);
        return n;
      };
      // Aggregate: Daily last 14 days
      const last14: { label: string; count: number }[] = [];
      const last14Status: Array<{ label: string; successful: number; cancelled: number; pending: number }> = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
        const key = ymd(d);
        const set = new Set<string>();
        items.forEach((row) => {
          const rd = new Date(row.updated_at);
          if (ymd(rd) === key) set.add(row.user_id);
        });
        last14.push({ label: new Date(key).toLocaleDateString(), count: set.size });

        // Orders by status for this day
        const buckets = { successful: 0, cancelled: 0, pending: 0 };
        (orders365 || []).forEach((o: any) => {
          const day = ymd(new Date(o.created_at));
          const s = String(o.order_status || o.status || "");
          if (day === key) {
            if (["completed","approved","ready_for_delivery","delivered"].includes(s)) buckets.successful += 1;
            else if (s === "cancelled") buckets.cancelled += 1;
            else buckets.pending += 1;
          }
        });
        last14Status.push({ label: new Date(key).toLocaleDateString(), ...buckets });
      }

      // Aggregate: Weekly last 8 weeks
      const last8w: { label: string; count: number }[] = [];
      const last8wStatus: Array<{ label: string; successful: number; cancelled: number; pending: number }> = [];
      for (let i = 7; i >= 0; i--) {
        const end = new Date(); end.setHours(23,59,59,999); end.setDate(end.getDate() - (i * 7));
        const start = startOfWeek(new Date(end));
        const set = new Set<string>();
        items.forEach((row) => {
          const rd = new Date(row.updated_at);
          if (rd >= start && rd <= end) set.add(row.user_id);
        });
        const label = `${start.toLocaleDateString()}–${end.toLocaleDateString()}`;
        last8w.push({ label, count: set.size });

        const buckets = { successful: 0, cancelled: 0, pending: 0 };
        (orders365 || []).forEach((o: any) => {
          const rd = new Date(o.created_at);
          const s = String(o.order_status || o.status || "");
          if (rd >= start && rd <= end) {
            if (["completed","approved","ready_for_delivery","delivered"].includes(s)) buckets.successful += 1;
            else if (s === "cancelled") buckets.cancelled += 1;
            else buckets.pending += 1;
          }
        });
        last8wStatus.push({ label, ...buckets });
      }

      // Aggregate: Monthly last 12 months
      const last12m: { label: string; count: number }[] = [];
      const last12mStatus: Array<{ label: string; successful: number; cancelled: number; pending: number }> = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); d.setMonth(d.getMonth() - i);
        const start = new Date(d);
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
        const set = new Set<string>();
        items.forEach((row) => {
          const rd = new Date(row.updated_at);
          if (rd >= start && rd <= end) set.add(row.user_id);
        });
        const label = `${start.toLocaleString(undefined, { month: "short" })} ${start.getFullYear()}`;
        last12m.push({ label, count: set.size });

        const buckets = { successful: 0, cancelled: 0, pending: 0 };
        (orders365 || []).forEach((o: any) => {
          const rd = new Date(o.created_at);
          const s = String(o.order_status || o.status || "");
          if (rd >= start && rd <= end) {
            if (["completed","approved","ready_for_delivery","delivered"].includes(s)) buckets.successful += 1;
            else if (s === "cancelled") buckets.cancelled += 1;
            else buckets.pending += 1;
          }
        });
        last12mStatus.push({ label, ...buckets });
      }

      setActiveUsersDay(last14);
      setActiveUsersWeek(last8w);
      setActiveUsersMonth(last12m);

  // Update Orders by Status timeframes
  setOrdersStatusDay(last14Status);
  setOrdersStatusWeek(last8wStatus);
  setOrdersStatusMonth(last12mStatus);

      setStats({
        totalProducts: (await supabase.from("products").select("*", { count: "exact", head: true })).count || 0,
        numberOfSales,
        totalUserAccounts,
        activeUsers,
        pendingOrders: pendingOrders || 0,
      });

    setDailySales(last10);
    setWeeklySales(week);
    } catch (e) {
      console.error("metrics error:", e);
    }
  };

  // NEW: Active Users chart data (Daily/Weekly/Monthly)
  const activeUsersChartData = useMemo(() => {
    const source =
      activeTab === "day" ? activeUsersDay :
      activeTab === "week" ? activeUsersWeek : activeUsersMonth;

    return {
      labels: source.map((s) => s.label),
      datasets: [
        {
          label: "Active Users",
          data: source.map((s) => s.count),
          backgroundColor: "rgba(16,185,129,0.8)", // emerald
          borderColor: "rgba(16,185,129,1)",
        },
      ],
    };
  }, [activeTab, activeUsersDay, activeUsersWeek, activeUsersMonth]);

  // Orders by Status chart data (stacked), switchable Day/Week/Month
  const ordersByStatusData = useMemo(() => {
    const source =
      ordersStatusTab === "day" ? ordersStatusDay :
      ordersStatusTab === "week" ? ordersStatusWeek : ordersStatusMonth;

    const labels = source.map((s) => s.label);
    const succ = source.map((s) => s.successful);
    const canc = source.map((s) => s.cancelled);
    const pend = source.map((s) => s.pending);

    return {
      labels,
      datasets: [
        { label: "Successful", data: succ, backgroundColor: "#16A34A", stack: 's' },
        { label: "Cancelled", data: canc, backgroundColor: "#DC2626", stack: 's' },
        { label: "Pending", data: pend, backgroundColor: "#F59E0B", stack: 's' },
      ],
    };
  }, [ordersStatusTab, ordersStatusDay, ordersStatusWeek, ordersStatusMonth]);

  const miniCalendarData = useMemo(() => {
    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOffset = firstOfMonth.getDay();
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(firstOfMonth.getDate() - startOffset);

    const toLocalDateKey = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate()
      ).padStart(2, "0")}`;

    const eventsByDate = new Map<string, any[]>();
    upcomingEvents.forEach((event) => {
      if (!event?.start) return;
      const eventDate = new Date(event.start);
      if (Number.isNaN(eventDate.getTime())) return;
      const key = toLocalDateKey(eventDate);
      const existing = eventsByDate.get(key) || [];
      existing.push(event);
      eventsByDate.set(key, existing);
    });

    const days = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      const key = toLocalDateKey(date);
      const isCurrentMonth = date.getMonth() === today.getMonth();
      const isToday =
        date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();

      return {
        key,
        date,
        dayNumber: date.getDate(),
        isCurrentMonth,
        isToday,
        events: eventsByDate.get(key) || [],
      };
    });

    return {
      monthLabel: today.toLocaleString(undefined, { month: "long", year: "numeric" }),
      weekDays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      days,
    };
  }, [upcomingEvents]);

  // ADD: test helpers to avoid runtime ReferenceError
  const testActivityLogging = async () => {
    try {
      const adminId = currentAdmin?.id || "anonymous";
      const adminName = currentAdmin?.username || "Admin";
      const payload = {
        admin_id: adminId,
        admin_name: adminName,
        action: "test",
        entity_type: "dashboard",
        details: "Manual test activity from dashboard",
        page: "dashboard",
        metadata: JSON.stringify({ source: "test_button", at: new Date().toISOString() }),
      };

      // Try helper if available, otherwise insert directly
      try {
        await (logActivity as any)(payload);
      } catch {
        await supabase.from("activity_logs").insert(payload);
      }

      alert("Activity log written.");
    } catch (e: any) {
      console.error("testActivityLogging failed:", e);
      alert(`Failed: ${e.message || e}`);
    }
  };

  const testSupabaseConnection = async () => {
    try {
      const { error } = await supabase
        .from("products")
        .select("id", { head: true, count: "exact" });
      if (error) throw error;
      alert("Supabase connection OK.");
    } catch (e: any) {
      console.error("testSupabaseConnection failed:", e);
      alert(`Supabase error: ${e.message || e}`);
    }
  };

  useEffect(() => {
    const fetchAnnouncements = async () => {
      try {
        const { data, error } = await supabase
          .from("notifications")
          .select("*")
          .contains("metadata", { kind: "announcement" })
          .order("created_at", { ascending: false })
          .limit(10);
        if (error) throw error;
        const nowIso = new Date().toISOString();
        setAnnouncements(
          (data || []).filter((a: any) => !a.expires_at || a.expires_at > nowIso)
        );
      } catch (e) {
        console.error("Announcements fetch error:", e);
        setAnnouncements([]);
      }
    };
    fetchAnnouncements();
    const ch = supabase
      .channel("dashboard_announcements")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        fetchAnnouncements();
      })
      .subscribe();
    return () => {
      try { supabase.removeChannel(ch); } catch {}
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-black">Dashboard</h1>
        <div className="flex items-center gap-4">
          <button onClick={testActivityLogging} className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600">🧪 Test Activity Log</button>
          <button onClick={testSupabaseConnection} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">🔌 Test Supabase</button>
          <div className="text-sm text-black">Welcome back, {currentAdmin?.username || "Admin"}</div>
        </div>
      </div>

      {/* KPI Cards (removed Average Price, 4 columns) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm">📊</div>
            <div className="ml-4">
              <div className="text-sm font-medium text-black">Number of Sales</div>
              <div className="text-2xl font-bold text-black">{stats.numberOfSales.toLocaleString()}</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white text-sm">💵</div>
            <div className="ml-4">
              <div className="text-sm font-medium text-black">Total User Accounts</div>
              <div className="text-2xl font-bold text-black">{stats.totalUserAccounts.toLocaleString()}</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center text-white text-sm">👥</div>
            <div className="ml-4">
              <div className="text-sm font-medium text-black">Active Users (30d)</div>
              <div className="text-2xl font-bold text-black">{stats.activeUsers.toLocaleString()}</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center text-white text-sm">🛒</div>
            <div className="ml-4">
              <div className="text-sm font-medium text-black">Pending Orders</div>
              <div className="text-2xl font-bold text-black">{stats.pendingOrders.toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Charts row: Active Users (left) + Sales Analytics (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Users Overview (moved into grid) */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-black">Active Users Overview</h2>
            <div className="inline-flex rounded-md border overflow-hidden">
              <button
                onClick={() => setActiveTab("day")}
                className={`px-3 py-1.5 text-sm ${activeTab === "day" ? "bg-emerald-600 text-white" : "bg-white text-black hover:bg-gray-50"}`}
              >
                Daily
              </button>
              <button
                onClick={() => setActiveTab("week")}
                className={`px-3 py-1.5 text-sm border-l ${activeTab === "week" ? "bg-emerald-600 text-white" : "bg-white text-black hover:bg-gray-50"}`}
              >
                Weekly
              </button>
              <button
                onClick={() => setActiveTab("month")}
                className={`px-3 py-1.5 text-sm border-l ${activeTab === "month" ? "bg-emerald-600 text-white" : "bg-white text-black hover:bg-gray-50"}`}
              >
                Monthly
              </button>
            </div>
          </div>
          <Bar
            data={activeUsersChartData}
            options={{
              responsive: true,
              plugins: { legend: { display: false }, tooltip: { enabled: true } },
              scales: {
                x: { ticks: { color: "#000" } },
                y: {
                  ticks: { color: "#000" },
                  beginAtZero: true,
                  suggestedMax: Math.max(5, ...((activeUsersChartData.datasets[0].data as number[]) || [0])) + 2,
                },
              },
            }}
          />
        </div>

        {/* Orders by Status – Daily / Weekly / Monthly */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-black">Orders by Status</h2>
            <div className="flex gap-2">
              {(["day","week","month"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setOrdersStatusTab(t)}
                  className={`px-3 py-1 rounded text-sm border ${ordersStatusTab===t? 'bg-emerald-600 text-white border-emerald-700' : 'bg-white text-black border-gray-300 hover:bg-gray-100'}`}
                >
                  {t === 'day' ? 'Daily' : t === 'week' ? 'Weekly' : 'Monthly'}
                </button>
              ))}
            </div>
          </div>
          <Bar
            data={ordersByStatusData}
            options={{
              responsive: true,
              plugins: { legend: { display: true } },
              scales: {
                x: { stacked: true, ticks: { color: '#000' } },
                y: { stacked: true, beginAtZero: true, ticks: { color: '#000' } },
              },
            }}
          />
        </div>
      </div>

      {/* Dashboard quick panels: Calendar + My Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-red-700" />
              <h2 className="text-lg font-semibold text-black">Upcoming Calendar</h2>
            </div>
            <a href="/dashboard/calendar" className="text-sm text-black underline">Open Calendar</a>
          </div>

          <div className="rounded border p-3">
            <div className="text-sm font-semibold text-black mb-2">{miniCalendarData.monthLabel}</div>
            <div className="grid grid-cols-7 gap-1 text-[11px] text-gray-600 mb-1">
              {miniCalendarData.weekDays.map((day) => (
                <div key={day} className="text-center font-medium">{day}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {miniCalendarData.days.map((day) => (
                <div
                  key={day.key}
                  className={`h-10 rounded border p-1 text-xs flex flex-col items-center justify-between ${
                    day.isCurrentMonth ? "bg-white text-black" : "bg-gray-50 text-gray-400"
                  } ${day.isToday ? "border-red-500" : "border-gray-200"}`}
                  title={
                    day.events.length
                      ? `${day.events.length} event${day.events.length > 1 ? "s" : ""}`
                      : "No events"
                  }
                >
                  <span className="leading-none">{day.dayNumber}</span>
                  {day.events.length > 0 ? (
                    <span className="w-2 h-2 rounded-full bg-red-600" />
                  ) : (
                    <span className="w-2 h-2" />
                  )}
                </div>
              ))}
            </div>
          </div>

          {upcomingEvents.length === 0 ? (
            <div className="text-sm text-gray-600 mt-3">No upcoming events.</div>
          ) : (
            <div className="space-y-2 mt-3">
              {upcomingEvents.slice(0, 3).map((event) => (
                <div key={event.id} className="rounded border p-2">
                  <div className="text-sm font-semibold text-black">{event.title}</div>
                  <div className="text-xs text-gray-600 mt-0.5">{event.start ? new Date(event.start).toLocaleString() : "No date"}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">
                <Clock3 className="h-4 w-4" />
              </span>
              <h2 className="text-lg font-semibold text-black">My Tasks</h2>
            </div>
            <a href="/dashboard/task/employeetask" className="text-sm text-black underline">Open Tasks</a>
          </div>

          {myTasks.length === 0 ? (
            <div className="text-sm text-gray-600">No active tasks assigned to this account.</div>
          ) : (
            <div className="space-y-3">
              {myTasks.map((task) => (
                <div key={task.id} className="rounded-lg border border-gray-200 p-3 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-black truncate">{task.task_name || task.product_name || `Task #${task.id}`}</div>
                      <div className="text-xs text-gray-600 mt-0.5">{task.due_date ? `Due ${new Date(task.due_date).toLocaleDateString()}` : "No due date"}</div>
                    </div>
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-100 text-indigo-700">
                      {task.status || "pending"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Announcements */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-black">Announcements</h2>
          <a
            href="/dashboard/announcement"
            className="text-sm text-black underline"
            title="Manage announcements"
          >
            Manage
          </a>
        </div>
        <div className="p-6">
          {announcements.length === 0 ? (
            <div className="text-black">No announcements</div>
          ) : (
            <ul className="space-y-3">
              {announcements.slice(0, 5).map((a: any) => (
                <li key={a.id} className="p-4 rounded border">
                  <div className="flex items-start gap-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        a.priority === "high"
                          ? "bg-red-100 text-red-700"
                          : a.priority === "low"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {a.priority || "medium"}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-black">{a.title}</div>
                        <div className="text-xs text-black/70">
                          {new Date(a.created_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-sm text-black mt-1">{a.message}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ALL Recent Activities Section - unchanged */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">All Recent Activities</h2>
            <div className="text-sm text-gray-500">
              System-wide • {recentActivities.length} total activities
            </div>
          </div>
        </div>
        
        {/* Fully Scrollable Activities Container */}
        <div className="max-h-96 overflow-y-auto">
          <div className="p-6">
            {recentActivities.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <div className="text-4xl mb-4">📝</div>
                <div className="text-lg font-medium mb-2">No recent activities</div>
                <div className="text-sm">System activities will appear here</div>
              </div>
            ) : (
              <div className="space-y-4">
                {recentActivities.map((activity) => {
                  const metadata = parseMetadata(activity.metadata);
                  const pageDisplay = getPageDisplayName(activity.page);
                  

                  return (
                    <div key={String(activity.id)} className={`flex items-start gap-4 p-4 rounded-lg border-l-4 ${getActionColor(activity.action)}`}>
                      <div className="flex-shrink-0">
                        <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center">
                          <span className="text-lg">{getActionIcon(activity.action)}</span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-sm font-medium text-gray-900 capitalize">
                            {activity.action} {activity.entity_type}
                          </span>
                          {pageDisplay && (
                            <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full font-medium">
                              {pageDisplay}
                            </span>
                          )}
                          <span className="text-xs text-gray-500 ml-auto">
                            {formatTimeAgo(activity.created_at)}
                          </span>
                        </div>
                        
                        <div className="text-sm text-gray-700 mb-2">
                          {activity.details}
                        </div>
                        
                        {metadata && (
                          <div className="grid grid-cols-2 gap-3 text-xs bg-white rounded p-3 border">
                            {metadata.productName && (
                              <div>
                                <span className="font-medium text-gray-600">Product:</span> 
                                <span className="text-gray-900 ml-1">{metadata.productName}</span>
                              </div>
                            )}
                            
                            {metadata.oldInventory !== undefined && metadata.newInventory !== undefined && (
                              <div>
                                <span className="font-medium text-gray-600">Inventory:</span> 
                                <span className="text-gray-900 ml-1">
                                  {metadata.oldInventory} → {metadata.newInventory}
                                  {metadata.inventoryChange && (
                                    <span className={`ml-1 ${metadata.inventoryChange > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                      ({metadata.inventoryChange > 0 ? '+' : ''}{metadata.inventoryChange})
                                    </span>
                                  )}
                                </span>
                              </div>
                            )}
                            
                            {metadata.category && (
                              <div>
                                <span className="font-medium text-gray-600">Category:</span> 
                                <span className="text-gray-900 ml-1">{metadata.category}</span>
                              </div>
                            )}
                            
                            {metadata.price !== undefined && (
                              <div>
                                <span className="font-medium text-gray-600">Price:</span> 
                                <span className="text-gray-900 ml-1">₱{metadata.price}</span>
                              </div>
                            )}
                          </div>
                        )}
                        
                        <div className="text-xs text-gray-400 mt-2">
                          {new Date(activity.created_at).toLocaleString()} • Admin: {activity.admin_name}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}