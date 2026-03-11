"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import {
  Activity,
  BarChart3,
  BellRing,
  Boxes,
  Clock3,
  RefreshCcw,
  ShoppingCart,
  TriangleAlert,
} from "lucide-react";

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend);

type ChartGranularity = "day" | "week" | "month";

type ActivityLog = {
  id: string | number;
  admin_name: string;
  action: string;
  entity_type: string;
  details: string;
  page?: string;
  metadata?: string | Record<string, unknown> | null;
  created_at: string;
};

type ActiveUserEvent = {
  user_id: string;
  updated_at: string;
};

type OrderEvent = {
  id?: string;
  status?: string | null;
  order_status?: string | null;
  created_at: string;
};

type LowStockProduct = {
  id: string;
  name: string;
  category?: string | null;
  inventory?: number | null;
};

type TaskItem = {
  id: string;
  task_name?: string | null;
  product_name?: string | null;
  status?: string | null;
  due_date?: string | null;
};

type Announcement = {
  id: string | number;
  title?: string | null;
  message: string;
  priority?: "low" | "medium" | "high" | string | null;
  created_at: string;
  expires_at?: string | null;
};

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string | null;
  description?: string | null;
  location?: string | null;
};

type MetricCard = {
  title: string;
  value: number;
  subtitle: string;
  accentClass: string;
  icon: typeof Boxes;
};

type Bucket = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

const SUCCESS_STATUSES = new Set(["completed", "approved", "ready_for_delivery", "delivered"]);
const LOW_STOCK_THRESHOLD = 5;
const LOOKBACK_DAYS = 730;

function toInputDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function parseDateInput(value: string, fallback: Date) {
  if (!value) return new Date(fallback);
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : parsed;
}

function normalizeDateRange(startInput: string, endInput: string, fallbackDays: number) {
  const fallbackEnd = new Date();
  const fallbackStart = addDays(fallbackEnd, -(fallbackDays - 1));
  const parsedStart = startOfDay(parseDateInput(startInput, fallbackStart));
  const parsedEnd = endOfDay(parseDateInput(endInput, fallbackEnd));

  if (parsedStart.getTime() <= parsedEnd.getTime()) {
    return { start: parsedStart, end: parsedEnd };
  }

  return { start: startOfDay(parsedEnd), end: endOfDay(parsedStart) };
}

function buildBuckets(start: Date, end: Date, granularity: ChartGranularity): Bucket[] {
  const buckets: Bucket[] = [];

  if (granularity === "day") {
    let cursor = startOfDay(start);
    while (cursor.getTime() <= end.getTime()) {
      const bucketStart = startOfDay(cursor);
      const bucketEnd = endOfDay(cursor);
      buckets.push({
        key: toInputDate(bucketStart),
        label: bucketStart.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        start: bucketStart,
        end: bucketEnd,
      });
      cursor = addDays(cursor, 1);
    }
    return buckets;
  }

  if (granularity === "week") {
    let cursor = startOfDay(start);
    while (cursor.getTime() <= end.getTime()) {
      const bucketStart = startOfDay(cursor);
      const bucketEnd = endOfDay(addDays(bucketStart, 6));
      const clippedEnd = bucketEnd.getTime() > end.getTime() ? endOfDay(end) : bucketEnd;
      buckets.push({
        key: `${toInputDate(bucketStart)}-${toInputDate(clippedEnd)}`,
        label: `${bucketStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${clippedEnd.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
        start: bucketStart,
        end: clippedEnd,
      });
      cursor = addDays(bucketStart, 7);
    }
    return buckets;
  }

  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor.getTime() <= end.getTime()) {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
    const clippedStart = monthStart.getTime() < start.getTime() ? startOfDay(start) : monthStart;
    const clippedEnd = monthEnd.getTime() > end.getTime() ? endOfDay(end) : monthEnd;
    buckets.push({
      key: `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`,
      label: monthStart.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
      start: clippedStart,
      end: clippedEnd,
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  return buckets;
}

function normalizeOrderStatus(status?: string | null, orderStatus?: string | null) {
  return String(orderStatus || status || "").trim().toLowerCase();
}

function parseMetadata(metadata?: string | Record<string, unknown> | null) {
  if (!metadata) return null;
  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      return { raw: metadata };
    }
  }
  return metadata;
}

function formatTimeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleString();
}

function getActivityAccent(action?: string) {
  switch (String(action || "").toLowerCase()) {
    case "create":
    case "add":
      return "border-emerald-500 bg-emerald-50";
    case "update":
    case "change":
    case "stock":
      return "border-blue-500 bg-blue-50";
    case "delete":
    case "cancel":
    case "cancelled":
      return "border-red-500 bg-red-50";
    default:
      return "border-slate-400 bg-slate-50";
  }
}

function getActivityIcon(action?: string) {
  switch (String(action || "").toLowerCase()) {
    case "create":
    case "add":
      return "➕";
    case "update":
    case "change":
      return "♻️";
    case "delete":
      return "🗑️";
    case "cancel":
    case "cancelled":
      return "⛔";
    case "upload":
      return "📤";
    default:
      return "📝";
  }
}

export default function DashboardPage() {
  const today = useMemo(() => new Date(), []);
  const defaultEnd = useMemo(() => toInputDate(today), [today]);
  const defaultStart = useMemo(() => toInputDate(addDays(today, -29)), [today]);

  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [recentActivities, setRecentActivities] = useState<ActivityLog[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [myTasks, setMyTasks] = useState<TaskItem[]>([]);
  const [lowStockProducts, setLowStockProducts] = useState<LowStockProduct[]>([]);
  const [activeUserEvents, setActiveUserEvents] = useState<ActiveUserEvent[]>([]);
  const [orderEvents, setOrderEvents] = useState<OrderEvent[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [metrics, setMetrics] = useState({
    totalProducts: 0,
    totalUsers: 0,
    pendingOrders: 0,
    cancelledOrders: 0,
    successfulSales: 0,
    lowStockCount: 0,
  });

  const [activeGranularity, setActiveGranularity] = useState<ChartGranularity>("day");
  const [ordersGranularity, setOrdersGranularity] = useState<ChartGranularity>("day");
  const [activeStartDate, setActiveStartDate] = useState(defaultStart);
  const [activeEndDate, setActiveEndDate] = useState(defaultEnd);
  const [ordersStartDate, setOrdersStartDate] = useState(defaultStart);
  const [ordersEndDate, setOrdersEndDate] = useState(defaultEnd);

  useEffect(() => {
    try {
      const sessionData = localStorage.getItem("adminSession");
      if (!sessionData) return;
      setCurrentAdmin(JSON.parse(sessionData));
    } catch (error) {
      console.error("Failed to load admin session", error);
    }
  }, []);

  useEffect(() => {
    if (!currentAdmin) return;

    const fetchDashboard = async () => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const last30Start = addDays(new Date(), -29);
      last30Start.setHours(0, 0, 0, 0);

      const lookbackStart = addDays(new Date(), -(LOOKBACK_DAYS - 1));
      lookbackStart.setHours(0, 0, 0, 0);

      try {
        const [
          totalProductsResult,
          lowStockResult,
          pendingOrdersResult,
          monthlyOrdersResult,
          ordersHistoryResult,
          activeUsersResult,
          activitiesResult,
          announcementsResult,
          tasksResult,
          adminUsersResult,
          calendarEventsResult,
        ] = await Promise.all([
          supabase.from("products").select("id", { count: "exact", head: true }),
          supabase
            .from("products")
            .select("id, name, inventory, category")
            .lte("inventory", LOW_STOCK_THRESHOLD)
            .order("inventory", { ascending: true })
            .limit(12),
          supabase
            .from("user_items")
            .select("id", { count: "exact", head: true })
            .in("item_type", ["order", "reservation"])
            .not("order_status", "in", '("completed","cancelled")'),
          supabase
            .from("user_items")
            .select("status, order_status, created_at, item_type")
            .gte("created_at", monthStart.toISOString())
            .in("item_type", ["order", "reservation"])
            .limit(50000),
          supabase
            .from("user_items")
            .select("id, status, order_status, created_at, item_type")
            .gte("created_at", lookbackStart.toISOString())
            .in("item_type", ["order", "reservation"])
            .limit(50000),
          supabase
            .from("user_items")
            .select("user_id, updated_at")
            .gte("updated_at", lookbackStart.toISOString())
            .limit(50000),
          supabase.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(30),
          supabase
            .from("notifications")
            .select("id, title, message, priority, created_at, expires_at")
            .contains("metadata", { kind: "announcement" })
            .order("created_at", { ascending: false })
            .limit(6),
          supabase
            .from("tasks")
            .select("id, task_name, status, due_date, product_name")
            .eq("assigned_admin_id", currentAdmin.id)
            .neq("status", "completed")
            .order("due_date", { ascending: true })
            .limit(6),
          fetch("/api/admin-users", { cache: "no-store" }).then(async (res) => {
            if (!res.ok) return { users: [] as unknown[] };
            return await res.json();
          }),
          supabase.from("calendar_events").select("id,title,start,end,description,location").order("start", { ascending: true }).limit(500),
        ]);

        const monthlySales = ((monthlyOrdersResult.data || []) as OrderEvent[]).filter((row) =>
          SUCCESS_STATUSES.has(normalizeOrderStatus(row.status, row.order_status))
        ).length;

        const cancelledLast30 = ((ordersHistoryResult.data || []) as OrderEvent[]).filter((row) => {
          const createdAt = new Date(row.created_at).getTime();
          return createdAt >= last30Start.getTime() && normalizeOrderStatus(row.status, row.order_status) === "cancelled";
        }).length;

        const nowIso = new Date().toISOString();

        setMetrics({
          totalProducts: totalProductsResult.count || 0,
          totalUsers: Array.isArray(adminUsersResult?.users) ? adminUsersResult.users.length : 0,
          pendingOrders: pendingOrdersResult.count || 0,
          cancelledOrders: cancelledLast30,
          successfulSales: monthlySales,
          lowStockCount: (lowStockResult.data || []).length,
        });

        setLowStockProducts((lowStockResult.data || []) as LowStockProduct[]);
        setActiveUserEvents(((activeUsersResult.data || []) as ActiveUserEvent[]).filter((row) => !!row.user_id));
        setOrderEvents((ordersHistoryResult.data || []) as OrderEvent[]);
        setRecentActivities((activitiesResult.data || []) as ActivityLog[]);
        setAnnouncements(
          ((announcementsResult.data || []) as Announcement[]).filter((item) => !item.expires_at || item.expires_at > nowIso)
        );
        setMyTasks((tasksResult.data || []) as TaskItem[]);
        setCalendarEvents((calendarEventsResult.data || []) as CalendarEvent[]);
      } catch (error) {
        console.error("Failed to load dashboard", error);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    };

    setRefreshing(true);
    fetchDashboard();
  }, [currentAdmin, refreshNonce]);

  const fullCalendarEvents = useMemo(
    () => calendarEvents.map((event) => ({ ...event, end: event.end ?? undefined })),
    [calendarEvents]
  );

  const activeRange = useMemo(
    () => normalizeDateRange(activeStartDate, activeEndDate, 30),
    [activeStartDate, activeEndDate]
  );

  const ordersRange = useMemo(
    () => normalizeDateRange(ordersStartDate, ordersEndDate, 30),
    [ordersStartDate, ordersEndDate]
  );

  const activeUserBuckets = useMemo(() => {
    const buckets = buildBuckets(activeRange.start, activeRange.end, activeGranularity);
    return buckets.map((bucket) => {
      const users = new Set<string>();
      activeUserEvents.forEach((event) => {
        const updatedAt = new Date(event.updated_at).getTime();
        if (updatedAt >= bucket.start.getTime() && updatedAt <= bucket.end.getTime()) {
          users.add(event.user_id);
        }
      });
      return { label: bucket.label, count: users.size };
    });
  }, [activeGranularity, activeRange.end, activeRange.start, activeUserEvents]);

  const ordersStatusBuckets = useMemo(() => {
    const buckets = buildBuckets(ordersRange.start, ordersRange.end, ordersGranularity);
    return buckets.map((bucket) => {
      const counts = { successful: 0, cancelled: 0, pending: 0 };
      orderEvents.forEach((event) => {
        const createdAt = new Date(event.created_at).getTime();
        if (createdAt < bucket.start.getTime() || createdAt > bucket.end.getTime()) return;
        const normalized = normalizeOrderStatus(event.status, event.order_status);
        if (SUCCESS_STATUSES.has(normalized)) counts.successful += 1;
        else if (normalized === "cancelled") counts.cancelled += 1;
        else counts.pending += 1;
      });
      return { label: bucket.label, ...counts };
    });
  }, [orderEvents, ordersGranularity, ordersRange.end, ordersRange.start]);

  const activeUsersInRange = useMemo(() => {
    const unique = new Set<string>();
    activeUserEvents.forEach((event) => {
      const updatedAt = new Date(event.updated_at).getTime();
      if (updatedAt >= activeRange.start.getTime() && updatedAt <= activeRange.end.getTime()) {
        unique.add(event.user_id);
      }
    });
    return unique.size;
  }, [activeRange.end, activeRange.start, activeUserEvents]);

  const activeAverage = useMemo(() => {
    if (!activeUserBuckets.length) return 0;
    const total = activeUserBuckets.reduce((sum, bucket) => sum + bucket.count, 0);
    return total / activeUserBuckets.length;
  }, [activeUserBuckets]);

  const orderRangeTotals = useMemo(() => {
    return ordersStatusBuckets.reduce(
      (totals, bucket) => ({
        successful: totals.successful + bucket.successful,
        cancelled: totals.cancelled + bucket.cancelled,
        pending: totals.pending + bucket.pending,
      }),
      { successful: 0, cancelled: 0, pending: 0 }
    );
  }, [ordersStatusBuckets]);

  const activeUsersChartData = useMemo(
    () => ({
      labels: activeUserBuckets.map((bucket) => bucket.label),
      datasets: [
        {
          label: "Active Users",
          data: activeUserBuckets.map((bucket) => bucket.count),
          backgroundColor: "rgba(15, 118, 110, 0.85)",
          borderColor: "rgba(15, 118, 110, 1)",
          borderRadius: 8,
          maxBarThickness: 34,
        },
      ],
    }),
    [activeUserBuckets]
  );

  const ordersByStatusData = useMemo(
    () => ({
      labels: ordersStatusBuckets.map((bucket) => bucket.label),
      datasets: [
        {
          label: "Successful",
          data: ordersStatusBuckets.map((bucket) => bucket.successful),
          backgroundColor: "#16A34A",
          borderRadius: 6,
          stack: "orders",
        },
        {
          label: "Cancelled",
          data: ordersStatusBuckets.map((bucket) => bucket.cancelled),
          backgroundColor: "#DC2626",
          borderRadius: 6,
          stack: "orders",
        },
        {
          label: "Pending",
          data: ordersStatusBuckets.map((bucket) => bucket.pending),
          backgroundColor: "#F59E0B",
          borderRadius: 6,
          stack: "orders",
        },
      ],
    }),
    [ordersStatusBuckets]
  );

  const metricCards = useMemo<MetricCard[]>(
    () => [
      {
        title: "Needs Restock",
        value: metrics.lowStockCount,
        subtitle: `Inventory at ${LOW_STOCK_THRESHOLD} or below`,
        accentClass: "from-red-500/15 to-red-50 text-red-700",
        icon: TriangleAlert,
      },
      {
        title: "Cancelled Orders",
        value: metrics.cancelledOrders,
        subtitle: "Last 30 days",
        accentClass: "from-rose-500/15 to-rose-50 text-rose-700",
        icon: ShoppingCart,
      },
      {
        title: "Pending Orders",
        value: metrics.pendingOrders,
        subtitle: "Open orders and reservations",
        accentClass: "from-amber-500/15 to-amber-50 text-amber-700",
        icon: Clock3,
      },
      {
        title: "Sales This Month",
        value: metrics.successfulSales,
        subtitle: "Successful deliveries and approvals",
        accentClass: "from-emerald-500/15 to-emerald-50 text-emerald-700",
        icon: BarChart3,
      },
      {
        title: "Total Products",
        value: metrics.totalProducts,
        subtitle: `${metrics.totalUsers.toLocaleString()} user accounts tracked`,
        accentClass: "from-sky-500/15 to-sky-50 text-sky-700",
        icon: Boxes,
      },
    ],
    [metrics.cancelledOrders, metrics.lowStockCount, metrics.pendingOrders, metrics.successfulSales, metrics.totalProducts, metrics.totalUsers]
  );

  if (!currentAdmin && loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-600">Loading dashboard...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 p-6 md:p-8 space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white/90 shadow-sm">
        <div className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600">
              <Activity className="h-3.5 w-3.5" />
              Admin Command Center
            </div>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">
              Focused operational overview for stock, orders, activity, and customer movement. Built for faster admin decisions.
            </p>
          </div>

          <div className="flex flex-col items-start gap-3 md:items-end">
            <div className="text-sm text-slate-500">
              Signed in as <span className="font-semibold text-slate-700">{currentAdmin?.username || "Admin"}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setRefreshing(true);
                setRefreshNonce((value) => value + 1);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
            >
              <RefreshCcw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh Dashboard
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        {metricCards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-600">{card.title}</p>
                  <p className="mt-3 text-3xl font-bold text-slate-900">{card.value.toLocaleString()}</p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{card.subtitle}</p>
                </div>
                <div className={`rounded-2xl bg-gradient-to-br p-3 ${card.accentClass}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Active Users Overview</h2>
              <p className="mt-1 text-sm text-slate-500">Track active customer activity across a custom reporting window.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(["day", "week", "month"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setActiveGranularity(value)}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    activeGranularity === value
                      ? "bg-teal-600 text-white shadow-sm"
                      : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {value === "day" ? "Daily" : value === "week" ? "Weekly" : "Monthly"}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Start Date</span>
              <input
                type="date"
                value={activeStartDate}
                onChange={(event) => setActiveStartDate(event.target.value)}
                className="w-full bg-transparent text-sm font-medium text-slate-900 outline-none"
              />
            </label>
            <label className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">End Date</span>
              <input
                type="date"
                value={activeEndDate}
                onChange={(event) => setActiveEndDate(event.target.value)}
                className="w-full bg-transparent text-sm font-medium text-slate-900 outline-none"
              />
            </label>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-teal-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-teal-700">Unique Users</div>
              <div className="mt-2 text-2xl font-bold text-teal-900">{activeUsersInRange.toLocaleString()}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Average per Bucket</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{activeAverage.toFixed(1)}</div>
            </div>
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Granularity</div>
              <div className="mt-2 text-2xl font-bold capitalize text-slate-900">{activeGranularity}</div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <Bar
              data={activeUsersChartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                },
                scales: {
                  x: { ticks: { color: "#475569" }, grid: { display: false } },
                  y: { beginAtZero: true, ticks: { color: "#475569" }, grid: { color: "rgba(148,163,184,0.2)" } },
                },
              }}
              height={280}
            />
          </div>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Orders by Status</h2>
              <p className="mt-1 text-sm text-slate-500">Analyze successful, cancelled, and pending orders inside a custom reporting window.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(["day", "week", "month"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setOrdersGranularity(value)}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    ordersGranularity === value
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {value === "day" ? "Daily" : value === "week" ? "Weekly" : "Monthly"}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Start Date</span>
              <input
                type="date"
                value={ordersStartDate}
                onChange={(event) => setOrdersStartDate(event.target.value)}
                className="w-full bg-transparent text-sm font-medium text-slate-900 outline-none"
              />
            </label>
            <label className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">End Date</span>
              <input
                type="date"
                value={ordersEndDate}
                onChange={(event) => setOrdersEndDate(event.target.value)}
                className="w-full bg-transparent text-sm font-medium text-slate-900 outline-none"
              />
            </label>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-emerald-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Successful</div>
              <div className="mt-2 text-2xl font-bold text-emerald-900">{orderRangeTotals.successful.toLocaleString()}</div>
            </div>
            <div className="rounded-2xl bg-rose-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">Cancelled</div>
              <div className="mt-2 text-2xl font-bold text-rose-900">{orderRangeTotals.cancelled.toLocaleString()}</div>
            </div>
            <div className="rounded-2xl bg-amber-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Pending</div>
              <div className="mt-2 text-2xl font-bold text-amber-900">{orderRangeTotals.pending.toLocaleString()}</div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <Bar
              data={ordersByStatusData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { position: "top" as const, labels: { color: "#334155" } },
                },
                scales: {
                  x: { stacked: true, ticks: { color: "#475569" }, grid: { display: false } },
                  y: { stacked: true, beginAtZero: true, ticks: { color: "#475569" }, grid: { color: "rgba(148,163,184,0.2)" } },
                },
              }}
              height={280}
            />
          </div>
        </article>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Restock Watchlist</h2>
              <p className="mt-1 text-sm text-slate-500">Products that need immediate stock attention.</p>
            </div>
            <div className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">
              {lowStockProducts.length} flagged
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {lowStockProducts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                No products are currently below the restock threshold.
              </div>
            ) : (
              lowStockProducts.map((product) => {
                const stockLevel = Number(product.inventory || 0);
                const critical = stockLevel <= 0;
                return (
                  <div key={product.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{product.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{product.category || "Uncategorized"}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${critical ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                        {critical ? "Out of stock" : "Low stock"}
                      </span>
                      <div className="text-right">
                        <div className="text-xs uppercase tracking-wide text-slate-400">Inventory</div>
                        <div className="text-lg font-bold text-slate-900">{stockLevel}</div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </article>

        <div className="grid grid-cols-1 gap-6">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
                  <Activity className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Calendar</h2>
                  <p className="mt-1 text-sm text-slate-500">Upcoming events and schedule overview.</p>
                </div>
              </div>
              <a href="/dashboard/calendar" className="text-sm font-semibold text-slate-700 underline">Open</a>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <FullCalendar
                plugins={[dayGridPlugin]}
                initialView="dayGridMonth"
                headerToolbar={{ left: "prev,next", center: "title", right: "" }}
                height={420}
                events={fullCalendarEvents}
                dayMaxEventRows={2}
              />
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-700">
                  <Clock3 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">My Tasks</h2>
                  <p className="mt-1 text-sm text-slate-500">Open assignments for this admin account.</p>
                </div>
              </div>
              <a href="/dashboard/task/employeetask" className="text-sm font-semibold text-slate-700 underline">View all</a>
            </div>

            <div className="mt-5 space-y-3">
              {myTasks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  No active tasks assigned to this account.
                </div>
              ) : (
                myTasks.map((task) => (
                  <div key={task.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{task.task_name || task.product_name || `Task ${task.id}`}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {task.due_date ? `Due ${new Date(task.due_date).toLocaleDateString()}` : "No due date"}
                        </div>
                      </div>
                      <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700 capitalize">
                        {task.status || "pending"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-amber-50 p-3 text-amber-700">
                  <BellRing className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-900">Announcements</h2>
                  <p className="mt-1 text-sm text-slate-500">Current internal notices for the admin team.</p>
                </div>
              </div>
              <a href="/dashboard/announcement" className="text-sm font-semibold text-slate-700 underline">Manage</a>
            </div>

            <div className="mt-5 space-y-3">
              {announcements.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  No announcements available.
                </div>
              ) : (
                announcements.map((announcement) => (
                  <div key={announcement.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-900">{announcement.title || "Announcement"}</div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          announcement.priority === "high"
                            ? "bg-red-100 text-red-700"
                            : announcement.priority === "low"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {announcement.priority || "medium"}
                      </span>
                    </div>
                    <div className="mt-2 text-sm leading-6 text-slate-600">{announcement.message}</div>
                    <div className="mt-3 text-xs text-slate-400">{new Date(announcement.created_at).toLocaleString()}</div>
                  </div>
                ))
              )}
            </div>
          </article>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Recent Activity</h2>
            <p className="mt-1 text-sm text-slate-500">Latest admin and system activity across products, inventory, and orders.</p>
          </div>
          <div className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600">
            {recentActivities.length} recent entries
          </div>
        </div>

        <div className="mt-5 max-h-[34rem] space-y-4 overflow-y-auto pr-1">
          {recentActivities.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              No recent activity logged yet.
            </div>
          ) : (
            recentActivities.map((activityLog) => {
              const metadata = parseMetadata(activityLog.metadata);
              return (
                <article key={String(activityLog.id)} className={`rounded-2xl border-l-4 p-4 ${getActivityAccent(activityLog.action)}`}>
                  <div className="flex gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-lg shadow-sm">
                      {getActivityIcon(activityLog.action)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <div className="text-sm font-semibold capitalize text-slate-900">
                            {activityLog.action} {activityLog.entity_type}
                          </div>
                          <div className="mt-1 text-sm leading-6 text-slate-600">{activityLog.details}</div>
                        </div>
                        <div className="text-xs font-medium text-slate-400">{formatTimeAgo(activityLog.created_at)}</div>
                      </div>

                      {metadata ? (
                        <div className="mt-3 grid grid-cols-1 gap-2 rounded-2xl border border-white/70 bg-white/70 p-3 text-xs text-slate-500 md:grid-cols-2">
                          {metadata.productName ? (
                            <div>
                              <span className="font-semibold text-slate-600">Product:</span> {String(metadata.productName)}
                            </div>
                          ) : null}
                          {metadata.category ? (
                            <div>
                              <span className="font-semibold text-slate-600">Category:</span> {String(metadata.category)}
                            </div>
                          ) : null}
                          {metadata.price !== undefined ? (
                            <div>
                              <span className="font-semibold text-slate-600">Price:</span> ₱{String(metadata.price)}
                            </div>
                          ) : null}
                          {metadata.oldInventory !== undefined && metadata.newInventory !== undefined ? (
                            <div>
                              <span className="font-semibold text-slate-600">Inventory:</span> {String(metadata.oldInventory)} → {String(metadata.newInventory)}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mt-3 text-xs text-slate-400">
                        {new Date(activityLog.created_at).toLocaleString()} • Admin: {activityLog.admin_name}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
