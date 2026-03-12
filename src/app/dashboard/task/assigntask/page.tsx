"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarClock, Factory, PlayCircle } from "lucide-react";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import {
  canManageProductionWorkflow,
  clampPercent,
  ensureProductionWorkflow,
  PRODUCTION_ROLE_CONFIGS,
  PRODUCTION_ROLE_LABELS,
} from "../workflowShared";

type AdminSession = {
  id: string;
  username: string;
  role: string;
  position?: string;
};

type OrderOption = {
  user_item_id: string;
  product_id: string;
  product_name: string;
  customer_name: string | null;
  order_status: string | null;
  created_at: string;
  meta?: Record<string, unknown> | null;
};

type UserItemRecord = {
  id: string;
  meta?: Record<string, unknown> | null;
  progress_history?: unknown[];
  order_status?: string | null;
  status?: string | null;
};

const SCHEDULE_TARGET_MIN_OFFSET_DAYS = 1;
const SCHEDULE_TARGET_MAX_YEARS_AHEAD = 5;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function toDateTimeLocalInputValue(date: Date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addYears(date: Date, years: number) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 0, 0);
  return next;
}

function parseEstimatedCompletionInput(value: string): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateTimeLocalValueFromAny(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return toDateTimeLocalInputValue(parsed);
}

function validateScheduleTarget(value: string, minDate: Date, maxDate: Date) {
  const parsed = parseEstimatedCompletionInput(value);
  if (!parsed) return { ok: false as const, message: "Please set an estimated completion date/time." };
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    return { ok: false as const, message: "Estimated completion date/time is invalid." };
  }
  if (minDate && parsed.getTime() < minDate.getTime()) {
    return {
      ok: false as const,
      message: `Estimated completion must be on/after ${minDate.toLocaleString()}.`,
    };
  }
  if (maxDate && parsed.getTime() > maxDate.getTime()) {
    return {
      ok: false as const,
      message: `Estimated completion must be on/before ${maxDate.toLocaleString()}.`,
    };
  }
  return { ok: true as const, value: parsed.toISOString() };
}

function validateStartOfProduction(value: string, minDate: Date, maxDate: Date) {
  const raw = String(value || "").trim();
  if (!raw) return { ok: true as const, value: null as string | null };
  const parsed = parseEstimatedCompletionInput(raw);
  if (!parsed) return { ok: false as const, message: "Start of production date/time is invalid." };
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    return { ok: false as const, message: "Start of production date/time is invalid." };
  }
  if (minDate && parsed.getTime() < minDate.getTime()) {
    return {
      ok: false as const,
      message: `Start of production must be on/after ${minDate.toLocaleString()}.`,
    };
  }
  if (maxDate && parsed.getTime() > maxDate.getTime()) {
    return {
      ok: false as const,
      message: `Start of production must be on/before ${maxDate.toLocaleString()}.`,
    };
  }
  return { ok: true as const, value: parsed.toISOString() };
}

function getCustomerNameFromEnrichedItem(item: any): string | null {
  const addr = item?.address_details || null;
  const addressName =
    (addr?.full_name as string | undefined) ||
    (addr?.first_name && addr?.last_name ? `${addr.first_name} ${addr.last_name}` : null);

  return (
    (addressName || null) ||
    (item?.customer?.name as string | undefined) ||
    (item?.customer_name as string | undefined) ||
    (item?.meta?.customer_name as string | undefined) ||
    null
  );
}

export default function StartProductionPage() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<"select" | "schedule" | "roles" | "blueprint">("select");
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [selectedOrderRecord, setSelectedOrderRecord] = useState<UserItemRecord | null>(null);
  const [existingTaskCount, setExistingTaskCount] = useState(0);
  const [startOfProductionDate, setStartOfProductionDate] = useState("");
  const [estimatedCompletionDate, setEstimatedCompletionDate] = useState("");
  const [startingProduction, setStartingProduction] = useState(false);
  const [loadingOrderContext, setLoadingOrderContext] = useState(false);

  const isLeader = useMemo(() => canManageProductionWorkflow(adminSession), [adminSession]);

  const scheduleTargetMin = useMemo(
    () => startOfDay(addDays(new Date(), SCHEDULE_TARGET_MIN_OFFSET_DAYS)),
    []
  );
  const scheduleTargetMax = useMemo(
    () => endOfDay(addYears(new Date(), SCHEDULE_TARGET_MAX_YEARS_AHEAD)),
    []
  );
  const scheduleTargetMinValue = useMemo(() => toDateTimeLocalInputValue(scheduleTargetMin), [scheduleTargetMin]);
  const scheduleTargetMaxValue = useMemo(() => toDateTimeLocalInputValue(scheduleTargetMax), [scheduleTargetMax]);

  const startOfProductionMin = useMemo(() => startOfDay(new Date()), []);
  const startOfProductionMax = scheduleTargetMax;
  const startOfProductionMinValue = useMemo(
    () => toDateTimeLocalInputValue(startOfProductionMin),
    [startOfProductionMin]
  );
  const startOfProductionMaxValue = scheduleTargetMaxValue;

  useEffect(() => {
    try {
      const raw = localStorage.getItem("adminSession");
      if (raw) setAdminSession(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/order-management/list-items", { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { items?: any[] };
        const allowed = new Set(["accepted", "approved", "in_production", "quality_check", "packaging"]);

        const mapped: OrderOption[] = (json.items || [])
          .map((row: any) => {
            const stage = String(row?.order_status || row?.status || "");
            if (!allowed.has(stage)) return null;

            return {
              user_item_id: String(row.id),
              product_id: String(row.product_id || ""),
              product_name:
                String(row?.meta?.product_name || row?.product_details?.name || row?.product_id || "") ||
                "(Unknown Product)",
              customer_name: getCustomerNameFromEnrichedItem(row),
              order_status: (row.order_status || row.status || null) as string | null,
              created_at: String(row.created_at || new Date().toISOString()),
              meta: (row.meta || null) as Record<string, unknown> | null,
            };
          })
          .filter(Boolean) as OrderOption[];

        setOrders(mapped);
      } catch (error) {
        console.error("Failed to load orders", error);
        setOrders([]);
      }
    })();
  }, []);

  useEffect(() => {
    const orderId = searchParams?.get("orderId") || "";
    if (!orderId || selectedOrderId) return;
    setSelectedOrderId(orderId);
  }, [searchParams, selectedOrderId]);

  useEffect(() => {
    (async () => {
      if (!selectedOrderId) {
        setSelectedOrderRecord(null);
        setExistingTaskCount(0);
        setStartOfProductionDate("");
        setEstimatedCompletionDate("");
        return;
      }

      setLoadingOrderContext(true);
      try {
        const [{ data: orderRow, error: orderErr }, { data: taskRows, error: taskErr }] = await Promise.all([
          supabase
            .from("user_items")
            .select("id, meta, progress_history, order_status, status")
            .eq("id", selectedOrderId)
            .single(),
          supabase.from("tasks").select("id").eq("user_item_id", selectedOrderId),
        ]);

        if (orderErr) throw orderErr;
        if (taskErr) throw taskErr;

        const record = (orderRow || null) as UserItemRecord | null;
        setSelectedOrderRecord(record);
        setExistingTaskCount((taskRows || []).length);

        const workflow = ensureProductionWorkflow(record?.meta?.production_workflow);
        setStartOfProductionDate(
          toDateTimeLocalValueFromAny(
            String(
              workflow.started_at ||
                (record?.meta as any)?.production_started_at ||
                (record?.meta as any)?.production_start_of_production ||
                ""
            )
          )
        );
        setEstimatedCompletionDate(
          toDateTimeLocalValueFromAny(
            String(workflow.estimated_completion_date || record?.meta?.production_estimated_completion_date || "")
          )
        );
      } catch (error) {
        console.error("Failed to load order context", error);
        setSelectedOrderRecord(null);
        setExistingTaskCount(0);
        setStartOfProductionDate("");
        setEstimatedCompletionDate("");
      } finally {
        setLoadingOrderContext(false);
      }
    })();
  }, [selectedOrderId]);

  const selectedOrder = useMemo(
    () => orders.find((order) => order.user_item_id === selectedOrderId) || null,
    [orders, selectedOrderId]
  );

  const currentWorkflow = useMemo(
    () => ensureProductionWorkflow(selectedOrderRecord?.meta?.production_workflow),
    [selectedOrderRecord?.meta]
  );

  const startProduction = async () => {
    if (!selectedOrderRecord || !selectedOrder) {
      alert("Please select an order first.");
      return;
    }
    if (!isLeader) {
      alert("Only leaders can start production.");
      return;
    }
    if (existingTaskCount === 0) {
      alert("This order has no workflow tasks yet. Please set up the workflow first.");
      return;
    }

    const scheduleValidation = validateScheduleTarget(estimatedCompletionDate, scheduleTargetMin, scheduleTargetMax);
    if (!scheduleValidation.ok) {
      alert(scheduleValidation.message);
      return;
    }

    const startValidation = validateStartOfProduction(startOfProductionDate, startOfProductionMin, startOfProductionMax);
    if (!startValidation.ok) {
      alert(startValidation.message);
      return;
    }

    setStartingProduction(true);
    try {
      const nowIso = new Date().toISOString();
      const meta = { ...(selectedOrderRecord.meta || {}) } as Record<string, unknown>;
      const workflow = ensureProductionWorkflow(meta.production_workflow);
      const history = Array.isArray(selectedOrderRecord.progress_history) ? selectedOrderRecord.progress_history : [];

      const startedAtIso = startValidation.value || workflow.started_at || nowIso;
      if (startedAtIso && scheduleValidation.value && startedAtIso > scheduleValidation.value) {
        alert("Start of production must be before the estimated completion date.");
        return;
      }

      const nextWorkflow = ensureProductionWorkflow({
        ...workflow,
        estimated_completion_date: scheduleValidation.value,
        started_at: startedAtIso,
        last_updated_at: nowIso,
      });

      const { error } = await supabase
        .from("user_items")
        .update({
          status: "in_production",
          order_status: "in_production",
          meta: {
            ...meta,
            production_percent: clampPercent(Number(meta.production_percent || 0)),
            production_estimated_completion_date: scheduleValidation.value,
            production_workflow: nextWorkflow,
          },
          progress_history: [{ status: "in_production", updated_at: nowIso }, ...history],
          updated_at: nowIso,
        })
        .eq("id", selectedOrder.user_item_id);
      if (error) throw error;

      setSelectedOrderRecord((prev) =>
        prev
          ? {
              ...prev,
              status: "in_production",
              order_status: "in_production",
              meta: {
                ...(prev.meta || {}),
                production_workflow: nextWorkflow,
                production_estimated_completion_date: scheduleValidation.value,
              },
            }
          : prev
      );

      alert("✅ Production started. The order is now visible in Employee Task for stage review.");
    } catch (error: any) {
      console.error("startProduction error", error);
      alert(`❌ Failed to start production: ${error?.message || "Unknown error"}`);
    } finally {
      setStartingProduction(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Link
            href="/dashboard/task/employeetask"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-800"
          >
            <ArrowLeft size={16} />
            Back to Employee Task
          </Link>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              <Factory size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Start Production</h1>
              <p className="text-sm text-slate-500">
                Select an order, confirm the estimated completion date, and move it to In Production.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workflow tasks</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{existingTaskCount}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order stage</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">
              {String(selectedOrderRecord?.order_status || selectedOrderRecord?.status || "Not selected").replace(/_/g, " ")}
            </div>
          </div>
        </div>
      </div>

      {!isLeader ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Only leaders can start production.
        </div>
      ) : null}

      <div className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setActiveTab("select")}
            className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
              activeTab === "select" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white/60"
            }`}
          >
            Select order
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("schedule")}
            className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
              activeTab === "schedule" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white/60"
            }`}
          >
            Schedule target
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("roles")}
            className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
              activeTab === "roles" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white/60"
            }`}
          >
            Requirement construction roles
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("blueprint")}
            className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
              activeTab === "blueprint" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white/60"
            }`}
          >
            Stage blueprint
          </button>
        </div>
      </div>

      {activeTab === "select" ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <Factory className="text-emerald-700" size={20} />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Select order</h2>
              <p className="text-sm text-slate-500">
                The dropdown shows the customer name from the saved address (addresses table).
              </p>
            </div>
          </div>

          <select
            value={selectedOrderId}
            onChange={(event) => setSelectedOrderId(event.target.value)}
            className="mt-4 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-800 outline-none ring-0 transition focus:border-emerald-500"
          >
            <option value="">Select an order…</option>
            {orders.map((order) => (
              <option key={order.user_item_id} value={order.user_item_id}>
                {order.product_name} • {order.customer_name || "No customer"} • {order.order_status || "—"}
              </option>
            ))}
          </select>

          {selectedOrder ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-lg font-semibold text-slate-900">{selectedOrder.product_name}</div>
              <div className="mt-1 text-sm text-slate-600">Customer: {selectedOrder.customer_name || "—"}</div>
              <div className="text-sm text-slate-600">Created: {new Date(selectedOrder.created_at).toLocaleString()}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                  Status: {String(selectedOrder.order_status || "—").replace(/_/g, " ")}
                </span>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                  Order ID: {selectedOrder.user_item_id.slice(0, 8)}…
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/dashboard/task/setup-workflow?orderId=${encodeURIComponent(selectedOrder.user_item_id)}`}
                  className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white"
                >
                  Set up / Edit workflow
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "schedule" ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <CalendarClock className="text-emerald-700" size={20} />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Schedule target</h2>
              <p className="text-sm text-slate-500">This date is shown in the website Order Progress popup.</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-sm font-semibold text-slate-900">Start of production</div>
              <input
                type="datetime-local"
                value={startOfProductionDate}
                min={startOfProductionMinValue}
                max={startOfProductionMaxValue}
                onChange={(event) => setStartOfProductionDate(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-emerald-500"
              />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">Estimated completion</div>
              <input
                type="datetime-local"
                value={estimatedCompletionDate}
                min={scheduleTargetMinValue}
                max={scheduleTargetMaxValue}
                onChange={(event) => setEstimatedCompletionDate(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="mt-2 text-xs text-slate-500">
            Start range: {startOfProductionMin.toLocaleString()} to {startOfProductionMax.toLocaleString()}.
            <br />
            Estimated completion range: {scheduleTargetMin.toLocaleString()} to {scheduleTargetMax.toLocaleString()}.
          </div>

          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
            {startOfProductionDate
              ? `Start of production: ${new Date(parseEstimatedCompletionInput(startOfProductionDate) || new Date()).toLocaleString()}`
              : "No start of production date/time set yet."}
            <div className="mt-2">
              {estimatedCompletionDate
                ? `Estimated completion: ${new Date(parseEstimatedCompletionInput(estimatedCompletionDate) || new Date()).toLocaleString()}`
                : "No estimated completion date/time set yet."}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "roles" ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <Factory className="text-emerald-700" size={20} />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Requirement construction roles</h2>
              <p className="text-sm text-slate-500">This is pulled from the saved workflow attached to the order.</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {PRODUCTION_ROLE_CONFIGS.map((role) => {
              const members = currentWorkflow.team_members.filter((member) => member.role_keys.includes(role.key));
              return (
                <div key={role.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{role.label}</div>
                      <div className="mt-1 text-xs text-slate-500">Assigned: {members.length}</div>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                        members.length > 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {members.length > 0 ? "Covered" : "Missing"}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {members.length > 0 ? (
                      members.map((member) => (
                        <span
                          key={`${role.key}-${member.admin_id}`}
                          className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm"
                        >
                          {member.admin_name}
                          {member.employee_number ? ` • ${member.employee_number}` : ""}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-500">No employee is assigned to this role yet.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {selectedOrderId ? (
              <Link
                href={`/dashboard/task/setup-workflow?orderId=${encodeURIComponent(selectedOrderId)}`}
                className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white"
              >
                Edit workflow
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeTab === "blueprint" ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <Factory className="text-emerald-700" size={20} />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Stage blueprint</h2>
              <p className="text-sm text-slate-500">Stages and who will submit evidence for each stage.</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {currentWorkflow.stage_plans.map((stage) => {
              const members = currentWorkflow.team_members.filter((member) =>
                member.role_keys.some((roleKey) => stage.required_role_keys.includes(roleKey))
              );

              return (
                <div key={stage.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{stage.label}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        Required roles: {stage.required_role_keys.map((roleKey) => PRODUCTION_ROLE_LABELS[roleKey]).join(", ")}
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                        members.length > 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {members.length > 0 ? `${members.length} assigned` : "Needs assignee"}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {members.length > 0 ? (
                      members.map((member) => (
                        <span
                          key={`${stage.key}-${member.admin_id}`}
                          className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm"
                        >
                          {member.admin_name} • {member.role_labels
                            .filter((label) =>
                              stage.required_role_keys.some((roleKey) => PRODUCTION_ROLE_LABELS[roleKey] === label)
                            )
                            .join(", ")}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-500">No employee is assigned to this stage yet.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-600">
          {loadingOrderContext
            ? "Loading order details…"
            : existingTaskCount === 0 && selectedOrderId
              ? "This order has no workflow tasks yet. Set up the workflow first."
              : ""}
        </div>
        <button
          type="button"
          onClick={startProduction}
          disabled={!selectedOrderId || !isLeader || startingProduction || loadingOrderContext || existingTaskCount === 0}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
        >
          <PlayCircle size={18} />
          {startingProduction ? "Starting…" : "Start Production"}
        </button>
      </div>
    </div>
  );
}
