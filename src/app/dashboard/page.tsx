"use client";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import NotificationBell from "@/components/NotificationBell";
import { logActivity } from "@/app/lib/activity";
// charts
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend } from "chart.js";
import { Bar, Line } from "react-chartjs-2";

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
    salesRevenue: 0,
    activeUsers: 0,
    pendingOrders: 0,
  });

  const [dailySales, setDailySales] = useState<{ date: string; amount: number }[]>([]);
  const [weeklySales, setWeeklySales] = useState<{ label: string; amount: number }[]>([]);

  // NEW: Active Users timeframes
  const [activeTab, setActiveTab] = useState<"day" | "week" | "month">("day");
  const [activeUsersDay, setActiveUsersDay] = useState<{ label: string; count: number }[]>([]);
  const [activeUsersWeek, setActiveUsersWeek] = useState<{ label: string; count: number }[]>([]);
  const [activeUsersMonth, setActiveUsersMonth] = useState<{ label: string; count: number }[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);

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

      const { data: sessions } = await supabase
        .from("payment_sessions")
        .select("amount, status, created_at")
        .gte("created_at", startOfMonth.toISOString());

      const completed = (sessions || []).filter((s: any) => s.status === "completed");
      const numberOfSales = completed.length;
      const salesRevenue = completed.reduce((sum: number, s: any) => sum + Number(s.amount || 0), 0);

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

      // NEW: Pull 12 months of user_items activity for day/week/month aggregation
      const { data: items365 } = await supabase
        .from("user_items")
        .select("user_id, updated_at")
        .gte("updated_at", last365.toISOString())
        .limit(20000);

      const items = (items365 || []).map((r: any) => ({ user_id: r.user_id, updated_at: r.updated_at }));

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
      const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

      // Aggregate: Daily last 14 days
      const last14: { label: string; count: number }[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
        const key = ymd(d);
        const set = new Set<string>();
        items.forEach((row) => {
          const rd = new Date(row.updated_at);
          if (ymd(rd) === key) set.add(row.user_id);
        });
        last14.push({ label: new Date(key).toLocaleDateString(), count: set.size });
      }

      // Aggregate: Weekly last 8 weeks
      const last8w: { label: string; count: number }[] = [];
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
      }

      // Aggregate: Monthly last 12 months
      const last12m: { label: string; count: number }[] = [];
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
      }

      setActiveUsersDay(last14);
      setActiveUsersWeek(last8w);
      setActiveUsersMonth(last12m);

      setStats({
        totalProducts: (await supabase.from("products").select("*", { count: "exact", head: true })).count || 0,
        numberOfSales,
        salesRevenue,
        activeUsers,
        pendingOrders: pendingOrders || 0,
      });

      setDailySales(last10);
      setWeeklySales(week);
    } catch (e) {
      console.error("metrics error:", e);
    }
  };

  const currency = (n: number) => `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0 })}`;

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

  // Keep Sales Analytics (line) as before
  const salesAnalyticsData = useMemo(() => ({
    labels: weeklySales.map(w => w.label),
    datasets: [
      {
        label: "Sales",
        data: weeklySales.map(w => w.amount),
        borderColor: "#7c3aed",
        backgroundColor: "rgba(124,58,237,0.15)",
        fill: true,
        pointBackgroundColor: "#7c3aed",
      },
    ],
  }), [weeklySales]);

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
    <div className="p-6 space-y-6">
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
              <div className="text-sm font-medium text-black">Sales Revenue</div>
              <div className="text-2xl font-bold text-black">{currency(stats.salesRevenue)}</div>
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

        {/* Sales Analytics */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-black mb-4">Sales Analytics</h2>
          <Line data={salesAnalyticsData} options={{ responsive: true, plugins: { legend: { display: false } } }} />
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