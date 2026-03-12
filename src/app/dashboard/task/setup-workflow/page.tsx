"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Factory,
  Save,
  Users,
  Wrench,
} from "lucide-react";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import {
  canManageProductionWorkflow,
  PRODUCTION_ROLE_CONFIGS,
  PRODUCTION_ROLE_LABELS,
  PRODUCTION_STAGES,
  buildRoleAssignmentsFromWorkflow,
  buildStagePlansFromAssignments,
  buildWorkflowMembers,
  createEmptyRoleAssignments,
  ensureProductionWorkflow,
  getProductionRoleForAdmin,
  type ProductionRoleKey,
} from "../workflowShared";

type AdminUser = {
  id: string;
  username: string;
  full_name: string | null;
  employee_number: string | null;
  role: string;
  position: string | null;
  is_active: boolean;
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

type AdminSession = {
  id: string;
  username: string;
  role: string;
  position?: string;
};

type TaskRow = {
  id: number;
  task_number: string;
  product_name: string;
  task_name: string;
  employee_name: string;
  employee_number: string;
  assigned_admin_id?: string | null;
  user_item_id?: string | null;
  product_id?: string | null;
  start_date: string;
  due_date: string;
  status: string;
};

type UserItemRecord = {
  id: string;
  meta?: Record<string, unknown> | null;
  progress_history?: unknown[];
  order_status?: string | null;
  status?: string | null;
};

const ACTIVE_PRODUCTION_STAGES = new Set([
  "in_production",
  "quality_check",
  "packaging",
  "ready_for_delivery",
  "out_for_delivery",
  "completed",
]);

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

function toDateTimeLocalValueFromAny(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return toDateTimeLocalInputValue(parsed);
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

function normalizeName(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
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

export default function AssignTaskPage() {
  const searchParams = useSearchParams();
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [employees, setEmployees] = useState<AdminUser[]>([]);
  const [rbacPositionNames, setRbacPositionNames] = useState<Set<string> | null>(null);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [selectedOrderRecord, setSelectedOrderRecord] = useState<UserItemRecord | null>(null);
  const [existingTasks, setExistingTasks] = useState<TaskRow[]>([]);
  const [roleAssignments, setRoleAssignments] = useState<Record<ProductionRoleKey, string[]>>(createEmptyRoleAssignments());
  const [estimatedCompletionDate, setEstimatedCompletionDate] = useState("");
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [loadingOrderContext, setLoadingOrderContext] = useState(false);

  const isLeader = useMemo(() => {
    return canManageProductionWorkflow(adminSession);
  }, [adminSession]);

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
        const res = await fetch("/api/rbac/positions", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { positions?: Array<{ name?: string | null }> };
        const names = (json.positions || [])
          .map((pos) => normalizeName(pos?.name || ""))
          .filter(Boolean);
        setRbacPositionNames(new Set(names));
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const [{ data: empData, error: empErr }, ordersRes] = await Promise.all([
        supabase
          .from("admins")
          .select("id, username, full_name, employee_number, role, position, is_active")
          .eq("is_active", true)
          .order("full_name", { ascending: true }),
        fetch("/api/order-management/list-items", { cache: "no-store" }),
      ]);

      if (!empErr) {
        setEmployees((empData || []) as AdminUser[]);
      }

      try {
        const json = (await ordersRes.json().catch(() => ({}))) as { items?: any[] };
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
        setExistingTasks([]);
        setEstimatedCompletionDate("");
        setRoleAssignments(createEmptyRoleAssignments());
        return;
      }

      setLoadingOrderContext(true);
      try {
        const [{ data: orderRow, error: orderErr }, { data: taskRows, error: taskErr }, { data: teamRows, error: teamErr }] = await Promise.all([
          supabase.from("user_items").select("id, meta, progress_history, order_status, status").eq("id", selectedOrderId).single(),
          supabase.from("tasks").select("*").eq("user_item_id", selectedOrderId).order("id", { ascending: true }),
          supabase.from("order_team_members").select("admin_id").eq("user_item_id", selectedOrderId),
        ]);

        if (orderErr) throw orderErr;
        if (taskErr) throw taskErr;
        if (teamErr) throw teamErr;

        const record = (orderRow || null) as UserItemRecord | null;
        setSelectedOrderRecord(record);
        setExistingTasks((taskRows || []) as TaskRow[]);

        const workflow = ensureProductionWorkflow(record?.meta?.production_workflow);
        const nextAssignments = buildRoleAssignmentsFromWorkflow(workflow);
        const fallbackTeamIds = (teamRows || [])
          .map((row: { admin_id?: string | null }) => String(row.admin_id || ""))
          .filter(Boolean);

        if (fallbackTeamIds.length > 0) {
          for (const adminId of fallbackTeamIds) {
            const employee = employees.find((item) => item.id === adminId);
            const roleKey = employee ? getProductionRoleForAdmin(employee) : null;
            if (roleKey && !nextAssignments[roleKey].includes(adminId)) {
              nextAssignments[roleKey].push(adminId);
            }
          }
        }

        setRoleAssignments(nextAssignments);
        setEstimatedCompletionDate(
          toDateTimeLocalValueFromAny(String(workflow.estimated_completion_date || record?.meta?.production_estimated_completion_date || ""))
        );
      } catch (error) {
        console.error("Failed to load order context", error);
        setSelectedOrderRecord(null);
        setExistingTasks([]);
        setEstimatedCompletionDate("");
        setRoleAssignments(createEmptyRoleAssignments());
      } finally {
        setLoadingOrderContext(false);
      }
    })();
  }, [employees, selectedOrderId]);

  const selectedOrder = useMemo(
    () => orders.find((order) => order.user_item_id === selectedOrderId) || null,
    [orders, selectedOrderId]
  );

  const productionEmployeesByRole = useMemo(() => {
    const grouped = Object.fromEntries(PRODUCTION_ROLE_CONFIGS.map((role) => [role.key, [] as AdminUser[]])) as Record<
      ProductionRoleKey,
      AdminUser[]
    >;

    for (const employee of employees) {
      if (employee.is_active === false) continue;

      if (rbacPositionNames) {
        const normalizedPosition = normalizeName(employee.position);
        if (!normalizedPosition || !rbacPositionNames.has(normalizedPosition)) continue;
      }

      const roleKey = getProductionRoleForAdmin(employee);
      if (!roleKey) continue;
      grouped[roleKey].push(employee);
    }

    return grouped;
  }, [employees, rbacPositionNames]);

  const workflowPreview = useMemo(() => {
    const stagePlans = buildStagePlansFromAssignments(roleAssignments);
    const teamMembers = buildWorkflowMembers(employees, roleAssignments);
    return { stagePlans, teamMembers };
  }, [employees, roleAssignments]);

  const stageCoverageIssues = useMemo(
    () => workflowPreview.stagePlans.filter((stage) => stage.assigned_admin_ids.length === 0),
    [workflowPreview.stagePlans]
  );

  const selectedTeamCount = workflowPreview.teamMembers.length;

  const setRoleMember = (roleKey: ProductionRoleKey, adminId: string, checked: boolean) => {
    setRoleAssignments((prev) => {
      const current = prev[roleKey] || [];
      return {
        ...prev,
        [roleKey]: checked ? Array.from(new Set([...current, adminId])) : current.filter((id) => id !== adminId),
      };
    });
  };

  const buildTaskBlueprints = () => {
    const taskBlueprints: Array<{
      stageKey: (typeof PRODUCTION_STAGES)[number]["key"];
      stageLabel: string;
      roleKey: ProductionRoleKey;
      roleLabel: string;
      admin: AdminUser;
    }> = [];

    for (const stage of PRODUCTION_STAGES) {
      for (const roleKey of stage.roleKeys) {
        for (const adminId of roleAssignments[roleKey] || []) {
          const admin = employees.find((item) => item.id === adminId);
          if (!admin) continue;
          taskBlueprints.push({
            stageKey: stage.key,
            stageLabel: stage.label,
            roleKey,
            roleLabel: PRODUCTION_ROLE_LABELS[roleKey],
            admin,
          });
        }
      }
    }

    return taskBlueprints;
  };

  const syncWorkflow = async () => {
    if (!selectedOrder || !selectedOrderRecord) {
      alert("Please select an order first.");
      return;
    }
    if (!isLeader) {
      alert("Only leaders can configure the production workflow.");
      return;
    }
    const scheduleValidation = validateScheduleTarget(estimatedCompletionDate, scheduleTargetMin, scheduleTargetMax);
    if (!scheduleValidation.ok) {
      alert(scheduleValidation.message);
      return;
    }
    if (selectedTeamCount === 0) {
      alert("Please assign at least one production employee.");
      return;
    }
    if (stageCoverageIssues.length > 0) {
        alert(`Please cover all five stages before saving. Missing: ${stageCoverageIssues.map((item) => item.label).join(", ")}`);
      return;
    }

    setSavingWorkflow(true);
    try {
      const currentStage = String(selectedOrderRecord.order_status || selectedOrderRecord.status || "");
      const existingTaskIds = existingTasks.map((task) => task.id).filter(Boolean);
      let hasUpdates = false;

      if (existingTaskIds.length) {
        const { data: updateRows, error: updateErr } = await supabase
          .from("task_updates")
          .select("id")
          .in("task_id", existingTaskIds)
          .limit(1);
        if (updateErr) throw updateErr;
        hasUpdates = (updateRows || []).length > 0;
      }

      if (hasUpdates) {
        alert("This order already has submitted production evidence. Please manage it from Employee Task to avoid losing live progress.");
        return;
      }

      const estimatedCompletionIso = scheduleValidation.value;
      const normalizedDueDate = estimatedCompletionIso.slice(0, 10);
      const blueprints = buildTaskBlueprints();
      const short = selectedOrder.user_item_id.slice(0, 6).toUpperCase();

      if (existingTaskIds.length > 0) {
        if (ACTIVE_PRODUCTION_STAGES.has(currentStage) && currentStage !== "in_production") {
          alert("This order is already beyond production setup. Use Employee Task to review instead of rebuilding the workflow.");
          return;
        }

        const { error: deleteErr } = await supabase.from("tasks").delete().eq("user_item_id", selectedOrder.user_item_id);
        if (deleteErr) throw deleteErr;
      }

      const payload = blueprints.map((blueprint, index) => ({
        task_number: `ORD-${short}-${String(index + 1).padStart(2, "0")}`,
        product_name: selectedOrder.product_name,
        task_name: `${blueprint.stageLabel} • ${blueprint.roleLabel}`,
        user_item_id: selectedOrder.user_item_id,
        product_id: selectedOrder.product_id,
        assigned_admin_id: blueprint.admin.id,
        employee_name: blueprint.admin.full_name || blueprint.admin.username,
        employee_number: blueprint.admin.employee_number || "",
        start_date: new Date().toISOString().slice(0, 10),
        due_date: normalizedDueDate,
        status: "Pending",
      }));

      const { data: createdTasks, error: insertErr } = await supabase.from("tasks").insert(payload).select("*");
      if (insertErr) throw insertErr;

      const insertedTasks = (createdTasks || []) as TaskRow[];
      const stagePlans = buildStagePlansFromAssignments(roleAssignments);
      const taskRegistry = insertedTasks
        .map((task) => {
          const blueprint = blueprints.find(
            (item) => item.admin.id === task.assigned_admin_id && `${item.stageLabel} • ${item.roleLabel}` === task.task_name
          );
          if (!blueprint) return null;
          return {
            task_id: task.id,
            assigned_admin_id: blueprint.admin.id,
            employee_name: blueprint.admin.full_name || blueprint.admin.username,
            employee_number: blueprint.admin.employee_number || null,
            role_key: blueprint.roleKey,
            role_label: blueprint.roleLabel,
            stage_key: blueprint.stageKey,
            stage_label: blueprint.stageLabel,
            due_date: task.due_date,
          };
        })
        .filter(Boolean);

      const stageMap = new Map(stagePlans.map((stage) => [stage.key, { ...stage, task_ids: [] as number[] }]));
      for (const entry of taskRegistry) {
        if (!entry) continue;
        stageMap.get(entry.stage_key)?.task_ids.push(entry.task_id);
      }

      const teamMembers = buildWorkflowMembers(employees, roleAssignments);
      const workflow = ensureProductionWorkflow({
        estimated_completion_date: estimatedCompletionIso,
        final_product_images: selectedOrderRecord.meta?.production_final_images as string[] | undefined,
        final_product_note: (selectedOrderRecord.meta?.production_final_note as string | undefined) || null,
        started_at: (selectedOrderRecord.meta?.production_workflow as { started_at?: string | null } | undefined)?.started_at || null,
        last_updated_at: new Date().toISOString(),
        team_members: teamMembers,
        task_registry: taskRegistry,
        stage_plans: Array.from(stageMap.values()),
      });

      const uniqueAdminIds = Array.from(new Set(teamMembers.map((item) => item.admin_id)));
      const { error: deleteTeamErr } = await supabase.from("order_team_members").delete().eq("user_item_id", selectedOrder.user_item_id);
      if (deleteTeamErr) throw deleteTeamErr;

      if (uniqueAdminIds.length > 0) {
        const { error: insertTeamErr } = await supabase.from("order_team_members").insert(
          uniqueAdminIds.map((adminId) => ({
            user_item_id: selectedOrder.user_item_id,
            admin_id: adminId,
            created_by_admin_id: adminSession?.id || null,
          }))
        );
        if (insertTeamErr) throw insertTeamErr;
      }

      const nextMeta = {
        ...(selectedOrderRecord.meta || {}),
        production_estimated_completion_date: estimatedCompletionIso,
        production_final_images: workflow.final_product_images,
        production_final_note: workflow.final_product_note,
        production_workflow: workflow,
      };

      const { error: updateErr } = await supabase
        .from("user_items")
        .update({ meta: nextMeta, updated_at: new Date().toISOString() })
        .eq("id", selectedOrder.user_item_id);
      if (updateErr) throw updateErr;

      setExistingTasks(insertedTasks);
      setSelectedOrderRecord((prev) => (prev ? { ...prev, meta: nextMeta } : prev));
      alert("✅ Production workflow saved. Stage tasks were generated successfully.");
    } catch (error: any) {
      console.error("syncWorkflow error", error);
      alert(`❌ Failed to save workflow: ${error?.message || "Unknown error"}`);
    } finally {
      setSavingWorkflow(false);
    }
  };

  const currentWorkflow = useMemo(
    () => ensureProductionWorkflow(selectedOrderRecord?.meta?.production_workflow),
    [selectedOrderRecord?.meta]
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
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
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
              <Factory size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Assign Production Workflow</h1>
              <p className="text-sm text-slate-500">
                Build the role-based team, generate the five construction stages, and prepare the order for live production tracking.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assigned people</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{selectedTeamCount}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Generated tasks</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{existingTasks.length}</div>
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
          Only leaders can configure the production workflow.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_1.2fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <ClipboardList className="text-blue-700" size={20} />
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Select order</h2>
                <p className="text-sm text-slate-500">Choose the order that needs a production team and stage plan.</p>
              </div>
            </div>

            <select
              value={selectedOrderId}
              onChange={(event) => setSelectedOrderId(event.target.value)}
              className="mt-4 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-800 outline-none ring-0 transition focus:border-blue-500"
            >
              <option value="">Select an order…</option>
              {orders.map((order) => (
                <option key={order.user_item_id} value={order.user_item_id}>
                  {order.product_name} • {order.customer_name || "—"} • {order.order_status || "—"}
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
              </div>
            ) : null}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <CalendarClock className="text-blue-700" size={20} />
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Schedule target</h2>
                <p className="text-sm text-slate-500">This estimated completion date is shown in the website Order Progress popup.</p>
              </div>
            </div>

            <input
              type="datetime-local"
              value={estimatedCompletionDate}
              min={scheduleTargetMinValue}
              max={scheduleTargetMaxValue}
              onChange={(event) => setEstimatedCompletionDate(event.target.value)}
              className="mt-4 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-blue-500"
            />

            <div className="mt-2 text-xs text-slate-500">
              Allowed range: {scheduleTargetMin.toLocaleString()} to {scheduleTargetMax.toLocaleString()}.
            </div>

            <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
              {estimatedCompletionDate
                ? `Estimated completion: ${new Date(parseEstimatedCompletionInput(estimatedCompletionDate) || new Date()).toLocaleString()}`
                : "No estimated completion date/time set yet."}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <Users className="text-blue-700" size={20} />
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Required construction roles</h2>
                <p className="text-sm text-slate-500">
                  Only employees tagged as Lead Welder, Helper Welder, Sealant Applicator, or Repair Staff can be selected.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {PRODUCTION_ROLE_CONFIGS.map((role) => {
                const candidates = productionEmployeesByRole[role.key] || [];
                return (
                  <div key={role.key} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{role.label}</div>
                        <div className="text-xs text-slate-500">Selected: {(roleAssignments[role.key] || []).length}</div>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        {candidates.length} eligible account{candidates.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    {candidates.length === 0 ? (
                      <div className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        No active employee currently matches the {role.label} role.
                      </div>
                    ) : (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {candidates.map((employee) => {
                          const checked = (roleAssignments[role.key] || []).includes(employee.id);
                          return (
                            <label
                              key={employee.id}
                              className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-3 text-sm transition ${
                                checked
                                  ? "border-blue-500 bg-blue-50 text-blue-900"
                                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => setRoleMember(role.key, employee.id, event.target.checked)}
                              />
                              <span>
                                <span className="block font-medium">{employee.full_name || employee.username}</span>
                                <span className="block text-xs text-slate-500">
                                  {employee.position || role.label}
                                  {employee.employee_number ? ` • ${employee.employee_number}` : ""}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <Wrench className="text-blue-700" size={20} />
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Stage blueprint</h2>
                <p className="text-sm text-slate-500">
                  These are the five production stages that employees will submit evidence for in Employee Task.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {workflowPreview.stagePlans.map((stage) => {
                const members = workflowPreview.teamMembers.filter((member) =>
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
                            {member.admin_name} • {member.role_labels.filter((label) =>
                              stage.required_role_keys.some((roleKey) => PRODUCTION_ROLE_LABELS[roleKey] === label)
                            ).join(", ")}
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

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="text-blue-700" size={20} />
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Saved workflow status</h2>
                <p className="text-sm text-slate-500">Preview what is already attached to this order before you start production.</p>
              </div>
            </div>

            {loadingOrderContext ? (
              <div className="mt-4 text-sm text-slate-500">Loading order workflow…</div>
            ) : !selectedOrderId ? (
              <div className="mt-4 text-sm text-slate-500">Select an order to inspect its workflow plan.</div>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimated completion</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      {currentWorkflow.estimated_completion_date
                        ? new Date(currentWorkflow.estimated_completion_date).toLocaleString()
                        : "Not set"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Workflow tasks</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{existingTasks.length}</div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-sm font-semibold text-slate-900">Current team</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {currentWorkflow.team_members.length > 0 ? (
                      currentWorkflow.team_members.map((member) => (
                        <span key={member.admin_id} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                          {member.admin_name} • {member.role_labels.join(", ")}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-500">No workflow saved yet.</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={syncWorkflow}
                disabled={!isLeader || savingWorkflow || !selectedOrderId}
                className="inline-flex items-center gap-2 rounded-2xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save size={16} />
                {savingWorkflow ? "Saving workflow…" : "Save workflow"}
              </button>
              {selectedOrderId ? (
                <Link
                  href={`/dashboard/task/assigntask?orderId=${encodeURIComponent(selectedOrderId)}`}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  <Factory size={16} />
                  Start production
                </Link>
              ) : null}
              {selectedOrderId ? (
                <Link
                  href={`/dashboard/task/employeetask?orderId=${encodeURIComponent(selectedOrderId)}`}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <CheckCircle2 size={16} />
                  Open Employee Task
                </Link>
              ) : null}
            </div>

            {stageCoverageIssues.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Missing stage coverage: {stageCoverageIssues.map((stage) => stage.label).join(", ")}.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
