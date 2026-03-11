"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarClock, CheckCircle2, PackageSearch, UserCheck, Users } from "lucide-react";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import ImageLightbox from "@/components/ui/ImageLightbox";
import {
  canManageProductionWorkflow,
  FINAL_PRODUCTION_STAGE_KEY,
  PRODUCTION_STAGES,
  getProductionRoleForAdmin,
  clampPercent,
  ensureProductionWorkflow,
  getTaskMetaById,
  type ProductionRoleKey,
  type ProductionStageKey,
  type ProductionWorkflowMeta,
} from "../workflowShared";

type Task = {
  id: number;
  task_number: string;
  product_name: string;
  task_name: string;
  employee_name: string;
  employee_number: string;
  user_item_id?: string | null;
  product_id?: string | null;
  assigned_admin_id?: string | null;
  start_date: string;
  due_date: string;
  status: string;
};

type EnrichedTask = Task & {
  stageKey: ProductionStageKey | null;
  stageLabel: string;
  roleKey: ProductionRoleKey | null;
  roleLabel: string | null;
};

type AdminSession = {
  id: string;
  username: string;
  role: string;
  position?: string;
};

type TaskUpdate = {
  id: string;
  task_id: number;
  submitted_by_admin_id?: string | null;
  submitted_by_name?: string | null;
  description: string;
  image_urls: string[] | null;
  status: "submitted" | "approved" | "rejected";
  created_at: string;
  approved_by_admin_id?: string | null;
  approved_at?: string | null;
  rejection_reason?: string | null;
};

type UserItemLite = {
  id: string;
  customer_name?: string | null;
  order_status?: string | null;
  status?: string | null;
  meta?: Record<string, any> | null;
  progress_history?: any[];
  products?: { name?: string | null } | null;
};

type OrderGroup = {
  user_item_id: string;
  product_name: string;
  customer_name: string | null;
  order_status: string | null;
  production_percent: number;
  estimatedCompletionDate: string | null;
  workflow: ProductionWorkflowMeta;
  tasks: EnrichedTask[];
};

const stageOrder = new Map(PRODUCTION_STAGES.map((stage, index) => [stage.key, index]));

function enrichTask(task: Task, workflow: ProductionWorkflowMeta): EnrichedTask {
  const meta = getTaskMetaById(workflow, task.id);
  const [fallbackStageLabel, fallbackRoleLabel] = String(task.task_name || "").split(" • ");
  return {
    ...task,
    stageKey: meta?.stage_key || null,
    stageLabel: meta?.stage_label || fallbackStageLabel || "Production Stage",
    roleKey: meta?.role_key || null,
    roleLabel: meta?.role_label || fallbackRoleLabel || null,
  };
}

function sortTasks(tasks: EnrichedTask[]) {
  return [...tasks].sort((a, b) => {
    const stageA = a.stageKey ? stageOrder.get(a.stageKey) ?? 99 : 99;
    const stageB = b.stageKey ? stageOrder.get(b.stageKey) ?? 99 : 99;
    if (stageA !== stageB) return stageA - stageB;
    return a.employee_name.localeCompare(b.employee_name);
  });
}

export default function EmployeeTasksPage() {
  const searchParams = useSearchParams();
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [tasks, setTasks] = useState<EnrichedTask[]>([]);
  const [orderGroups, setOrderGroups] = useState<OrderGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<OrderGroup | null>(null);
  const [groupUpdates, setGroupUpdates] = useState<Record<number, TaskUpdate[]>>({});
  const [myRecentUpdates, setMyRecentUpdates] = useState<Record<number, TaskUpdate[]>>({});
  const [groupProgressDraft, setGroupProgressDraft] = useState<Record<string, number>>({});
  const [savingGroupProgressId, setSavingGroupProgressId] = useState<string | null>(null);
  const [progressModal, setProgressModal] = useState<{ task: EnrichedTask } | null>(null);
  const [progressText, setProgressText] = useState("");
  const [progressFiles, setProgressFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState<number | null>(null);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<{ update: TaskUpdate; group: OrderGroup; task: EnrichedTask } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number; title?: string } | null>(null);
  const [highlightOrderId, setHighlightOrderId] = useState("");

  const canReviewProgress = useMemo(() => {
    return canManageProductionWorkflow(adminSession);
  }, [adminSession]);

  const currentProductionRole = useMemo(() => getProductionRoleForAdmin(adminSession || {}), [adminSession]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("adminSession");
      if (raw) setAdminSession(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const orderId = searchParams?.get("orderId") || "";
    setHighlightOrderId(orderId);
  }, [searchParams]);

  useEffect(() => {
    if (!adminSession?.id) return;
    if (canReviewProgress) {
      void fetchOrderGroups();
    } else {
      void fetchMyTasks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSession?.id, canReviewProgress]);

  useEffect(() => {
    if (!highlightOrderId) return;
    if (canReviewProgress) {
      const target = orderGroups.find((group) => group.user_item_id === highlightOrderId);
      if (target) {
        setSelectedGroup(target);
        void loadGroupUpdates(target);
      }
    }
  }, [canReviewProgress, highlightOrderId, orderGroups]);

  const openLightbox = (urls: string[], index: number, title?: string) => {
    if (!urls.length) return;
    setLightbox({ urls, index, title });
  };

  const fetchMyTasks = async () => {
    try {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("assigned_admin_id", adminSession?.id || "")
        .order("due_date", { ascending: true });
      if (error) throw error;

      const rawTasks = (data || []) as Task[];
      const orderIds = Array.from(new Set(rawTasks.map((task) => String(task.user_item_id || "")).filter(Boolean)));
      const orderMap = new Map<string, UserItemLite>();
      if (orderIds.length > 0) {
        const { data: uiRows, error: uiErr } = await supabase
          .from("user_items")
          .select("id, customer_name, order_status, status, meta, progress_history, products(name)")
          .in("id", orderIds);
        if (uiErr) throw uiErr;
        (uiRows || []).forEach((row: any) => orderMap.set(String(row.id), row as UserItemLite));
      }

      const enriched = rawTasks.map((task) => {
        const order = orderMap.get(String(task.user_item_id || ""));
        const workflow = ensureProductionWorkflow(order?.meta?.production_workflow);
        return enrichTask(task, workflow);
      });

      const visibleTasks = currentProductionRole
        ? enriched.filter((task) => !task.roleKey || task.roleKey === currentProductionRole)
        : enriched;

      setTasks(sortTasks(visibleTasks));

      const taskIds = visibleTasks.map((task) => task.id).filter(Boolean);
      if (taskIds.length === 0) {
        setMyRecentUpdates({});
        return;
      }

      const { data: updates, error: updateErr } = await supabase
        .from("task_updates")
        .select("id, task_id, submitted_by_admin_id, submitted_by_name, description, image_urls, status, created_at, approved_by_admin_id, approved_at, rejection_reason")
        .in("task_id", taskIds)
        .order("created_at", { ascending: false });
      if (updateErr) throw updateErr;

      const grouped: Record<number, TaskUpdate[]> = {};
      (updates || []).forEach((update: any) => {
        const taskId = Number(update.task_id);
        if (!grouped[taskId]) grouped[taskId] = [];
        grouped[taskId].push(update as TaskUpdate);
      });
      setMyRecentUpdates(grouped);
    } catch (error) {
      console.error("Failed to fetch my tasks", error);
      setTasks([]);
      setMyRecentUpdates({});
    }
  };

  const fetchOrderGroups = async () => {
    try {
      const { data: taskRows, error: taskErr } = await supabase
        .from("tasks")
        .select("*")
        .not("user_item_id", "is", null)
        .order("due_date", { ascending: true });
      if (taskErr) throw taskErr;

      const rawTasks = (taskRows || []) as Task[];
      const orderIds = Array.from(new Set(rawTasks.map((task) => String(task.user_item_id || "")).filter(Boolean)));
      if (orderIds.length === 0) {
        setOrderGroups([]);
        return [] as OrderGroup[];
      }

      const { data: uiRows, error: uiErr } = await supabase
        .from("user_items")
        .select("id, customer_name, order_status, status, meta, progress_history, products(name)")
        .in("id", orderIds);
      if (uiErr) throw uiErr;

      const uiMap = new Map<string, UserItemLite>();
      (uiRows || []).forEach((row: any) => uiMap.set(String(row.id), row as UserItemLite));

      const groupedTasks = new Map<string, EnrichedTask[]>();
      for (const task of rawTasks) {
        const orderId = String(task.user_item_id || "");
        const userItem = uiMap.get(orderId);
        const workflow = ensureProductionWorkflow(userItem?.meta?.production_workflow);
        const enrichedTask = enrichTask(task, workflow);
        const current = groupedTasks.get(orderId) || [];
        current.push(enrichedTask);
        groupedTasks.set(orderId, current);
      }

      const groups: OrderGroup[] = orderIds.map((orderId) => {
        const userItem = uiMap.get(orderId);
        const workflow = ensureProductionWorkflow(userItem?.meta?.production_workflow);
        const pct = clampPercent(Number(userItem?.meta?.production_percent || 0));
        return {
          user_item_id: orderId,
          product_name: userItem?.products?.name || groupedTasks.get(orderId)?.[0]?.product_name || "(Unknown Product)",
          customer_name: userItem?.customer_name || null,
          order_status: (userItem?.order_status || userItem?.status || null) as string | null,
          production_percent: pct,
          estimatedCompletionDate: String(
            workflow.estimated_completion_date || userItem?.meta?.production_estimated_completion_date || ""
          ) || null,
          workflow,
          tasks: sortTasks(groupedTasks.get(orderId) || []),
        };
      });

      groups.sort((a, b) => a.product_name.localeCompare(b.product_name));
      setOrderGroups(groups);
      setGroupProgressDraft((prev) => {
        const next = { ...prev };
        for (const group of groups) {
          if (typeof next[group.user_item_id] !== "number") next[group.user_item_id] = group.production_percent;
        }
        return next;
      });
      return groups;
    } catch (error) {
      console.error("Failed to fetch order groups", error);
      setOrderGroups([]);
      return [] as OrderGroup[];
    }
  };

  const loadGroupUpdates = async (group: OrderGroup) => {
    try {
      const taskIds = group.tasks.map((task) => task.id).filter(Boolean);
      if (taskIds.length === 0) {
        setGroupUpdates({});
        return;
      }

      const { data, error } = await supabase
        .from("task_updates")
        .select("id, task_id, submitted_by_admin_id, submitted_by_name, description, image_urls, status, created_at, approved_by_admin_id, approved_at, rejection_reason")
        .in("task_id", taskIds)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const grouped: Record<number, TaskUpdate[]> = {};
      (data || []).forEach((update: any) => {
        const taskId = Number(update.task_id);
        if (!grouped[taskId]) grouped[taskId] = [];
        grouped[taskId].push(update as TaskUpdate);
      });
      setGroupUpdates(grouped);
    } catch (error) {
      console.error("Failed to load group updates", error);
      setGroupUpdates({});
    }
  };

  const refreshAfterChange = async (group?: OrderGroup | null) => {
    if (canReviewProgress) {
      const groups = await fetchOrderGroups();
      if (group) {
        const target = groups.find((entry) => entry.user_item_id === group.user_item_id) || group;
        setSelectedGroup(target);
        await loadGroupUpdates(target);
      }
      return;
    }
    await fetchMyTasks();
  };

  const uploadProgressImages = async (task: EnrichedTask, files: File[]) => {
    const urls: string[] = [];
    if (!files.length) return urls;

    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `orders/${task.user_item_id || "unlinked"}/tasks/${task.id}/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("uploads").upload(path, file, { upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("uploads").getPublicUrl(path);
      if (data?.publicUrl) urls.push(data.publicUrl);
    }

    return urls;
  };

  const submitProgress = async () => {
    if (!progressModal) return;
    if (!progressText.trim() && progressFiles.length === 0) {
      alert("Please add text or at least one image.");
      return;
    }

    setSubmitting(true);
    try {
      const task = progressModal.task;
      const imageUrls = await uploadProgressImages(task, progressFiles);
      const payload = {
        task_id: task.id,
        submitted_by_admin_id: adminSession?.id || null,
        submitted_by_name: adminSession?.username || task.employee_name || null,
        description: progressText.trim(),
        image_urls: imageUrls,
        status: "submitted",
      };

      const { error } = await supabase.from("task_updates").insert([payload]);
      if (error) throw error;

      if (task.status === "Pending") {
        await supabase.from("tasks").update({ status: "In Progress" }).eq("id", task.id);
      }

      setProgressText("");
      setProgressFiles([]);
      setProgressModal(null);
      await refreshAfterChange(selectedGroup);
      alert("✅ Stage evidence submitted. It now waits for leader approval.");
    } catch (error: any) {
      console.error("submitProgress error", error);
      alert(`❌ Failed to submit progress: ${error?.message || "Unknown error"}`);
    } finally {
      setSubmitting(false);
    }
  };

  const updateTaskStatus = async (taskId: number, status: string) => {
    setUpdatingStatusId(taskId);
    try {
      const { error } = await supabase.from("tasks").update({ status }).eq("id", taskId);
      if (error) throw error;
      await refreshAfterChange(selectedGroup);
    } catch (error: any) {
      console.error("updateTaskStatus error", error);
      alert(`❌ Failed to update task status: ${error?.message || "Unknown error"}`);
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const saveGroupProductionPercent = async (group: OrderGroup) => {
    const nextPct = clampPercent(Number(groupProgressDraft[group.user_item_id] || 0));
    setSavingGroupProgressId(group.user_item_id);
    try {
      const { data: uiData, error: uiErr } = await supabase
        .from("user_items")
        .select("id, meta, progress_history, order_status, status")
        .eq("id", group.user_item_id)
        .single();
      if (uiErr || !uiData) throw uiErr;

      const current = uiData as UserItemLite;
      const meta = current.meta || {};
      const history = Array.isArray(current.progress_history) ? current.progress_history : [];
      const nowIso = new Date().toISOString();
      const patch: any = {
        meta: {
          ...meta,
          production_percent: nextPct,
          production_estimated_completion_date:
            meta.production_estimated_completion_date || group.estimatedCompletionDate || null,
        },
        updated_at: nowIso,
      };

      const currentStage = String(current.order_status || current.status || "");
      if (nextPct >= 100 && currentStage !== "quality_check") {
        patch.order_status = "quality_check";
        patch.status = "quality_check";
        patch.progress_history = [{ status: "quality_check", updated_at: nowIso }, ...history];
      }

      const { error } = await supabase.from("user_items").update(patch).eq("id", group.user_item_id);
      if (error) throw error;

      const groups = await fetchOrderGroups();
      const updatedGroup = groups.find((entry) => entry.user_item_id === selectedGroup?.user_item_id) || selectedGroup;
      if (updatedGroup) setSelectedGroup(updatedGroup);
      alert(nextPct >= 100 ? "✅ Progress saved. Order moved to Quality Check." : "✅ Progress saved.");
    } catch (error: any) {
      console.error("saveGroupProductionPercent error", error);
      alert(`❌ Failed to save progress: ${error?.message || "Unknown error"}`);
    } finally {
      setSavingGroupProgressId(null);
    }
  };

  const approveTaskUpdate = async (
    update: TaskUpdate,
    task: EnrichedTask,
    group: OrderGroup,
    options?: { useAsFinalProduct?: boolean }
  ) => {
    if (!canReviewProgress) {
      alert("Only leaders can approve updates.");
      return;
    }

    setReviewBusyId(update.id);
    try {
      const nowIso = new Date().toISOString();
      const { error: rowErr } = await supabase
        .from("task_updates")
        .update({
          status: "approved",
          approved_by_admin_id: adminSession?.id || null,
          approved_at: nowIso,
          rejection_reason: null,
        })
        .eq("id", update.id);
      if (rowErr) throw rowErr;

      const { data: uiData, error: uiErr } = await supabase
        .from("user_items")
        .select("id, meta, progress_history, order_status, status")
        .eq("id", group.user_item_id)
        .single();
      if (uiErr || !uiData) throw uiErr;

      const current = uiData as UserItemLite;
      const meta = current.meta || {};
      const workflow = ensureProductionWorkflow(meta.production_workflow);
      const productionUpdates = Array.isArray(meta.production_updates) ? meta.production_updates : [];
      const taskMeta = getTaskMetaById(workflow, task.id);
      const stageKey = taskMeta?.stage_key || task.stageKey;
      const nextWorkflow = ensureProductionWorkflow({
        ...workflow,
        stage_plans: workflow.stage_plans.map((stage) => {
          if (stage.key !== stageKey) return stage;
          const approvedTaskIds = Array.from(new Set([...stage.approved_task_ids, task.id]));
          const approvedUpdateIds = Array.from(new Set([...stage.approved_update_ids, update.id]));
          const isApproved = stage.task_ids.length > 0 && approvedTaskIds.length >= stage.task_ids.length;
          return {
            ...stage,
            approved_task_ids: approvedTaskIds,
            approved_update_ids: approvedUpdateIds,
            last_submission_at: nowIso,
            approved_at: isApproved ? nowIso : stage.approved_at || null,
            status: isApproved ? "approved" : "in_progress",
          };
        }),
      });

      const approvedEntry = {
        id: update.id,
        task_update_id: update.id,
        task_id: update.task_id,
        task_name: task.task_name,
        stage_key: stageKey,
        stage_label: task.stageLabel,
        role_key: task.roleKey,
        role_label: task.roleLabel,
        employee_name: task.employee_name,
        submitted_by_admin_id: update.submitted_by_admin_id || null,
        submitted_by_name: update.submitted_by_name || task.employee_name || null,
        description: update.description || "",
        image_urls: Array.isArray(update.image_urls) ? update.image_urls : [],
        created_at: update.created_at,
        approved_at: nowIso,
        approved_by_name: adminSession?.username || null,
      };

      const nextMeta: Record<string, any> = {
        ...meta,
        production_updates: [approvedEntry, ...productionUpdates.filter((item: any) => String(item?.id || "") !== update.id)],
        production_workflow: ensureProductionWorkflow({ ...nextWorkflow, last_updated_at: nowIso }),
      };

      if (options?.useAsFinalProduct && approvedEntry.image_urls.length > 0) {
        nextMeta.production_final_images = approvedEntry.image_urls;
        nextMeta.production_final_note = approvedEntry.description || null;
        nextMeta.production_workflow = ensureProductionWorkflow({
          ...nextWorkflow,
          last_updated_at: nowIso,
          final_product_images: approvedEntry.image_urls,
          final_product_note: approvedEntry.description || null,
          final_product_update_id: update.id,
        });
      }

      const { error: metaErr } = await supabase
        .from("user_items")
        .update({ meta: nextMeta, updated_at: nowIso })
        .eq("id", group.user_item_id);
      if (metaErr) throw metaErr;

      const groups = await fetchOrderGroups();
      const updatedGroup = groups.find((entry) => entry.user_item_id === group.user_item_id) || group;
      setSelectedGroup(updatedGroup);
      await loadGroupUpdates(updatedGroup);
      alert(options?.useAsFinalProduct ? "✅ Approved and saved as final product preview." : "✅ Approved. The customer can now see this stage evidence.");
    } catch (error: any) {
      console.error("approveTaskUpdate error", error);
      alert(`❌ Failed to approve update: ${error?.message || "Unknown error"}`);
    } finally {
      setReviewBusyId(null);
    }
  };

  const rejectTaskUpdate = async (update: TaskUpdate, group: OrderGroup) => {
    if (!canReviewProgress) {
      alert("Only leaders can reject updates.");
      return;
    }
    if (!rejectReason.trim()) {
      alert("Please provide a rejection reason.");
      return;
    }

    setRejecting(true);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("task_updates")
        .update({
          status: "rejected",
          approved_by_admin_id: adminSession?.id || null,
          approved_at: nowIso,
          rejection_reason: rejectReason.trim(),
        })
        .eq("id", update.id);
      if (error) throw error;

      setRejectModal(null);
      setRejectReason("");
      await loadGroupUpdates(group);
      alert("✅ Update rejected.");
    } catch (error: any) {
      console.error("rejectTaskUpdate error", error);
      alert(`❌ Failed to reject update: ${error?.message || "Unknown error"}`);
    } finally {
      setRejecting(false);
    }
  };

  const groupedMyTasks = useMemo(() => {
    const map = new Map<string, { product_name: string; tasks: EnrichedTask[] }>();
    for (const task of tasks) {
      const key = String(task.user_item_id || task.product_name || "");
      const current = map.get(key) || { product_name: task.product_name, tasks: [] };
      current.tasks.push(task);
      map.set(key, current);
    }
    return Array.from(map.entries()).map(([key, value]) => ({ key, ...value, tasks: sortTasks(value.tasks) }));
  }, [tasks]);

  const summaryCards = useMemo(() => {
    const approvedStages = orderGroups.reduce((total, group) => {
      return total + group.workflow.stage_plans.filter((stage) => stage.status === "approved").length;
    }, 0);
    return {
      orders: orderGroups.length,
      approvedStages,
      activeTasks: orderGroups.reduce((total, group) => total + group.tasks.length, 0),
    };
  }, [orderGroups]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              {canReviewProgress ? <Users size={24} /> : <UserCheck size={24} />}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{canReviewProgress ? "Employee Task" : "My Stage Tasks"}</h1>
              <p className="text-sm text-slate-500">
                {canReviewProgress
                  ? "Review stage evidence, approve each production stage, and manage direct progress updates."
                  : "Submit image or text evidence only for the production role assigned to your account."}
              </p>
            </div>
          </div>

          {canReviewProgress ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tracked orders</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{summaryCards.orders}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approved stages</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{summaryCards.approvedStages}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active tasks</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{summaryCards.activeTasks}</div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {canReviewProgress ? (
        <div className="grid gap-5 xl:grid-cols-2">
          {orderGroups.map((group) => {
            const pct = clampPercent(Number(groupProgressDraft[group.user_item_id] ?? group.production_percent));
            const isHighlighted = highlightOrderId && highlightOrderId === group.user_item_id;
            return (
              <div
                key={group.user_item_id}
                className={`rounded-3xl border bg-white p-6 shadow-sm transition ${
                  isHighlighted ? "border-emerald-400 ring-2 ring-emerald-100" : "border-slate-200"
                }`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-lg font-semibold text-slate-900">{group.product_name}</div>
                    <div className="mt-1 text-sm text-slate-500">Customer: {group.customer_name || "—"}</div>
                    <div className="text-sm text-slate-500">Stage: {String(group.order_status || "—").replace(/_/g, " ")}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/dashboard/task/assigntask?orderId=${encodeURIComponent(group.user_item_id)}`}
                      className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Open Setup
                    </Link>
                    <button
                      type="button"
                      onClick={async () => {
                        setSelectedGroup(group);
                        await loadGroupUpdates(group);
                      }}
                      className="inline-flex items-center gap-2 rounded-2xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800"
                    >
                      <PackageSearch size={14} />
                      Review Workflow
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                  <div>
                    <div className="flex items-center justify-between text-sm font-semibold text-slate-900">
                      <span>Production progress</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-200">
                      <div className="h-3 rounded-full bg-emerald-600" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={pct}
                      onChange={(event) =>
                        setGroupProgressDraft((prev) => ({
                          ...prev,
                          [group.user_item_id]: clampPercent(Number(event.target.value || 0)),
                        }))
                      }
                      className="w-20 rounded-2xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => saveGroupProductionPercent(group)}
                      disabled={savingGroupProgressId === group.user_item_id}
                      className="rounded-2xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      {savingGroupProgressId === group.user_item_id ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                  <CalendarClock size={16} />
                  Estimated completion: {group.estimatedCompletionDate ? new Date(group.estimatedCompletionDate).toLocaleDateString() : "Not set"}
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {group.workflow.stage_plans.map((stage) => (
                    <div key={stage.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{stage.label}</div>
                          <div className="text-xs text-slate-500">{stage.task_ids.length} task(s)</div>
                        </div>
                        <span
                          className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                            stage.status === "approved"
                              ? "bg-emerald-100 text-emerald-700"
                              : stage.status === "in_progress"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-slate-200 text-slate-600"
                          }`}
                        >
                          {stage.status.replace(/_/g, " ")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : !currentProductionRole ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-10 text-center text-amber-900 shadow-sm">
          Your account is not mapped to a production role yet. Please ask an admin to assign a production position before using this page.
        </div>
      ) : groupedMyTasks.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-slate-500 shadow-sm">
          No stage tasks are assigned to you yet.
        </div>
      ) : (
        <div className="space-y-6">
          {groupedMyTasks.map((group) => (
            <div key={group.key} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-slate-900">{group.product_name}</div>
                  <div className="text-sm text-slate-500">Order: {group.key}</div>
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                {group.tasks.map((task) => {
                  const updates = myRecentUpdates[task.id] || [];
                  const latest = updates[0];
                  return (
                    <div key={task.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{task.stageLabel}</div>
                          <div className="text-xs text-slate-500">{task.roleLabel || task.task_name}</div>
                          <div className="mt-1 text-xs text-slate-500">Due: {task.due_date}</div>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700 shadow-sm">
                          {task.status}
                        </span>
                      </div>

                      <div className="mt-3 text-xs text-slate-500">
                        {latest ? `Last update: ${latest.status} • ${new Date(latest.created_at).toLocaleString()}` : "No evidence submitted yet."}
                      </div>

                      {latest?.rejection_reason ? (
                        <div className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-xs text-red-700">
                          Rejection: {latest.rejection_reason}
                        </div>
                      ) : null}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setProgressModal({ task });
                            setProgressText("");
                            setProgressFiles([]);
                          }}
                          className="rounded-2xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800"
                        >
                          Submit evidence
                        </button>
                        <select
                          value={task.status}
                          onChange={(event) => updateTaskStatus(task.id, event.target.value)}
                          disabled={updatingStatusId === task.id}
                          className="rounded-2xl border border-slate-300 px-3 py-2 text-xs text-slate-700"
                        >
                          <option value="Pending">Pending</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Completed">Completed</option>
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedGroup ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="relative max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
            <button
              type="button"
              onClick={() => setSelectedGroup(null)}
              className="absolute right-4 top-4 rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 transition hover:bg-slate-50"
            >
              ✕
            </button>

            <div className="pr-12">
              <div className="text-2xl font-bold text-slate-900">{selectedGroup.product_name}</div>
              <div className="mt-1 text-sm text-slate-500">
                Order: {selectedGroup.user_item_id} • Customer: {selectedGroup.customer_name || "—"}
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current stage</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">{String(selectedGroup.order_status || "—").replace(/_/g, " ")}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimated completion</div>
                <div className="mt-2 text-sm font-semibold text-slate-900">
                  {selectedGroup.estimatedCompletionDate ? new Date(selectedGroup.estimatedCompletionDate).toLocaleDateString() : "Not set"}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Production percent</div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={clampPercent(Number(groupProgressDraft[selectedGroup.user_item_id] ?? selectedGroup.production_percent))}
                    onChange={(event) =>
                      setGroupProgressDraft((prev) => ({
                        ...prev,
                        [selectedGroup.user_item_id]: clampPercent(Number(event.target.value || 0)),
                      }))
                    }
                    className="w-24 rounded-2xl border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => saveGroupProductionPercent(selectedGroup)}
                    className="rounded-2xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
                  >
                    Save
                  </button>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quick links</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link
                    href={`/dashboard/task/assigntask?orderId=${encodeURIComponent(selectedGroup.user_item_id)}`}
                    className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white"
                  >
                    Edit setup
                  </Link>
                  <Link
                    href={`/dashboard/order_management`}
                    className="rounded-2xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-white"
                  >
                    Order management
                  </Link>
                </div>
              </div>
            </div>

            {selectedGroup.workflow.final_product_images.length > 0 ? (
              <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <CheckCircle2 size={16} className="text-emerald-600" />
                  Final product preview
                </div>
                {selectedGroup.workflow.final_product_note ? (
                  <div className="mt-2 text-sm text-slate-600 whitespace-pre-wrap">{selectedGroup.workflow.final_product_note}</div>
                ) : null}
                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  {selectedGroup.workflow.final_product_images.map((url, index) => (
                    <button key={url} type="button" onClick={() => openLightbox(selectedGroup.workflow.final_product_images, index, "Final Product")}> 
                      <img src={url} alt="Final product" className="h-32 w-full rounded-2xl object-cover border border-slate-200" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-6 space-y-5">
              {selectedGroup.workflow.stage_plans.map((stage) => {
                const stageTasks = selectedGroup.tasks.filter((task) => task.stageKey === stage.key);
                return (
                  <div key={stage.key} className="rounded-3xl border border-slate-200 p-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="text-lg font-semibold text-slate-900">{stage.label}</div>
                        <div className="text-sm text-slate-500">{stageTasks.length} assigned task(s) • {stage.approved_task_ids.length}/{stage.task_ids.length} approved</div>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                          stage.status === "approved"
                            ? "bg-emerald-100 text-emerald-700"
                            : stage.status === "in_progress"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-200 text-slate-600"
                        }`}
                      >
                        {stage.status.replace(/_/g, " ")}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      {stageTasks.map((task) => {
                        const updates = groupUpdates[task.id] || [];
                        const latest = updates[0];
                        return (
                          <div key={task.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-slate-900">{task.employee_name}</div>
                                <div className="text-xs text-slate-500">{task.roleLabel || task.task_name}</div>
                                <div className="text-xs text-slate-500">Task #{task.task_number}</div>
                              </div>
                              <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700 shadow-sm">
                                {task.status}
                              </span>
                            </div>

                            {latest ? (
                              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
                                <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                                  <span>{latest.status}</span>
                                  <span>{new Date(latest.created_at).toLocaleString()}</span>
                                </div>
                                {latest.submitted_by_name ? <div className="mt-1 text-xs text-slate-500">By: {latest.submitted_by_name}</div> : null}
                                {latest.description ? <div className="mt-3 text-sm text-slate-700 whitespace-pre-wrap">{latest.description}</div> : null}
                                {Array.isArray(latest.image_urls) && latest.image_urls.length > 0 ? (
                                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                    {latest.image_urls.map((url, index) => (
                                      <button key={url} type="button" onClick={() => openLightbox(latest.image_urls || [], index, "Stage Evidence")}> 
                                        <img src={url} alt="Stage evidence" className="h-24 w-full rounded-2xl object-cover border border-slate-200" />
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                                {latest.rejection_reason ? (
                                  <div className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-xs text-red-700">Rejection: {latest.rejection_reason}</div>
                                ) : null}

                                {latest.status === "submitted" ? (
                                  <div className="mt-4 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() => approveTaskUpdate(latest, task, selectedGroup)}
                                      disabled={reviewBusyId === latest.id}
                                      className="rounded-2xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
                                    >
                                      {reviewBusyId === latest.id ? "Approving…" : "Approve"}
                                    </button>
                                    {task.stageKey === FINAL_PRODUCTION_STAGE_KEY && Array.isArray(latest.image_urls) && latest.image_urls.length > 0 ? (
                                      <button
                                        type="button"
                                        onClick={() => approveTaskUpdate(latest, task, selectedGroup, { useAsFinalProduct: true })}
                                        disabled={reviewBusyId === latest.id}
                                        className="rounded-2xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                                      >
                                        Approve as final product
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRejectModal({ update: latest, group: selectedGroup, task });
                                        setRejectReason("");
                                      }}
                                      disabled={reviewBusyId === latest.id}
                                      className="rounded-2xl bg-red-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                                    >
                                      Reject
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">
                                No evidence submitted yet.
                              </div>
                            )}

                            <div className="mt-4 flex items-center gap-2">
                              <select
                                value={task.status}
                                onChange={(event) => updateTaskStatus(task.id, event.target.value)}
                                disabled={updatingStatusId === task.id}
                                className="rounded-2xl border border-slate-300 px-3 py-2 text-xs text-slate-700"
                              >
                                <option value="Pending">Pending</option>
                                <option value="In Progress">In Progress</option>
                                <option value="Completed">Completed</option>
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {rejectModal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="text-lg font-semibold text-slate-900">Reject progress update</div>
            <div className="mt-1 text-sm text-slate-500">{rejectModal.task.employee_name} • {rejectModal.task.stageLabel}</div>
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={4}
              className="mt-4 w-full rounded-2xl border border-slate-300 p-3 text-sm"
              placeholder="Tell the employee what must be fixed before this stage can be approved."
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRejectModal(null)} className="rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => rejectTaskUpdate(rejectModal.update, rejectModal.group)}
                disabled={rejecting}
                className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {rejecting ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {progressModal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold text-slate-900">Submit stage evidence</div>
                <div className="mt-1 text-sm text-slate-500">
                  {progressModal.task.stageLabel} • {progressModal.task.roleLabel || progressModal.task.task_name}
                </div>
              </div>
              <button type="button" onClick={() => setProgressModal(null)} className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600">
                ✕
              </button>
            </div>

            <textarea
              value={progressText}
              onChange={(event) => setProgressText(event.target.value)}
              rows={5}
              className="mt-4 w-full rounded-2xl border border-slate-300 p-3 text-sm"
              placeholder="Describe what was finished in this stage. Text, images, or both are allowed."
            />

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">Upload photos</div>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => setProgressFiles(Array.from(event.target.files || []))}
                className="mt-3 block text-sm"
              />
              <div className="mt-2 text-xs text-slate-500">
                Selected files: {progressFiles.length}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setProgressModal(null)} className="rounded-2xl border border-slate-300 px-4 py-2 text-sm text-slate-700">
                Cancel
              </button>
              <button
                type="button"
                onClick={submitProgress}
                disabled={submitting}
                className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {submitting ? "Submitting…" : "Submit evidence"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ImageLightbox
        open={!!lightbox}
        urls={lightbox?.urls || []}
        index={lightbox?.index || 0}
        title={lightbox?.title}
        onClose={() => setLightbox(null)}
        onIndexChange={(next) => setLightbox((prev) => (prev ? { ...prev, index: next } : prev))}
      />
    </div>
  );
}
