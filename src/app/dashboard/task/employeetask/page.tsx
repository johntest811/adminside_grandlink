"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import { UserCheck, Users, PackageSearch } from "lucide-react";
import ImageLightbox from "@/components/ui/ImageLightbox";

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

type AdminSession = {
  id: string;
  username: string;
  role: string;
  position?: string;
};

type AdminUser = {
  id: string;
  username: string;
  full_name?: string | null;
  employee_number?: string | null;
  role?: string | null;
  position?: string | null;
  is_active?: boolean | null;
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
  meta?: any;
  progress_history?: any[];
  products?: { name?: string | null } | null;
};

type OrderGroup = {
  user_item_id: string;
  product_name: string;
  customer_name: string | null;
  order_status: string | null;
  production_percent: number;
  tasks: Task[];
};

type TeamMemberRow = {
  admin_id: string;
};

export default function EmployeeTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [progressModal, setProgressModal] = useState<{ task: Task } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [progressFiles, setProgressFiles] = useState<File[]>([]);
  const [myRecentUpdates, setMyRecentUpdates] = useState<Record<number, TaskUpdate[]>>({});
  const [updatingStatusId, setUpdatingStatusId] = useState<number | null>(null);

  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<{ update: TaskUpdate; task: Task; group: OrderGroup } | null>(null);
  const [rejectReason, setRejectReason] = useState<string>("");
  const [rejecting, setRejecting] = useState(false);

  const [selectedMyGroup, setSelectedMyGroup] = useState<{
    key: string;
    product_name: string;
    user_item_id: string | null;
    tasks: Task[];
  } | null>(null);
  const [expandedUpdates, setExpandedUpdates] = useState<Record<number, boolean>>({});

  const [orderGroups, setOrderGroups] = useState<OrderGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<OrderGroup | null>(null);
  const [groupUpdates, setGroupUpdates] = useState<Record<number, TaskUpdate[]>>({});
  const [savingGroupProgressId, setSavingGroupProgressId] = useState<string | null>(null);
  const [groupProgressDraft, setGroupProgressDraft] = useState<Record<string, number>>({});

  const [employees, setEmployees] = useState<AdminUser[]>([]);
  const [teamMemberIds, setTeamMemberIds] = useState<string[]>([]);
  const [teamBusy, setTeamBusy] = useState(false);
  const [manageTeamOpen, setManageTeamOpen] = useState(false);

  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [newTask, setNewTask] = useState({
    task_name: "",
    assigned_admin_id: "",
    start_date: new Date().toISOString().slice(0, 10),
    due_date: "",
  });

  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number; title?: string } | null>(null);

  const openLightbox = (urls: string[], index: number, title?: string) => {
    if (!Array.isArray(urls) || urls.length === 0) return;
    setLightbox({ urls, index: Math.max(0, Math.min(urls.length - 1, index)), title });
  };

  const canReviewProgress = useMemo(() => {
    const r = String(adminSession?.role || "").toLowerCase();
    const p = String(adminSession?.position || "").toLowerCase();
    if (r === "superadmin") return true;
    if (r === "team_leader" || r === "team leader") return true;
    // allow if position explicitly signals team leader
    return p.includes("team leader") || p.includes("team_leader") || p.includes("teamlead") || p.includes("lead");
  }, [adminSession?.role, adminSession?.position]);

  const employeeById = useMemo(() => {
    const m = new Map<string, AdminUser>();
    for (const e of employees) m.set(e.id, e);
    return m;
  }, [employees]);

  const activeEmployees = useMemo(() => {
    return employees.filter((e) => e.is_active !== false);
  }, [employees]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("adminSession");
      if (raw) setAdminSession(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    if (!adminSession?.id) return;
    if (!canReviewProgress) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("admins")
          .select("id, username, full_name, employee_number, role, position, is_active")
          .order("is_active", { ascending: false })
          .order("full_name", { ascending: true });
        if (error) throw error;
        setEmployees((data || []) as AdminUser[]);
      } catch (e) {
        console.error("Failed to load employees", e);
        setEmployees([]);
      }
    })();
  }, [adminSession?.id, canReviewProgress]);

  useEffect(() => {
    if (!adminSession?.id) return;
    if (canReviewProgress) {
      void fetchOrderGroups();
    } else {
      void fetchMyTasks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSession?.id, canReviewProgress]);

  const fetchMyTasks = async () => {
    try {
      let query = supabase.from("tasks").select("*").order("due_date");

      // Filter to only tasks assigned to the logged-in admin (employee)
      if (adminSession?.id) {
        query = query.eq("assigned_admin_id", adminSession.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      setTasks((data || []) as Task[]);

      // Prefetch recent updates for these tasks (lightweight)
      const ids = (data || []).map((t: any) => t.id).filter(Boolean);
      if (ids.length) {
        const { data: updData } = await supabase
          .from("task_updates")
          .select("id, task_id, submitted_by_admin_id, submitted_by_name, description, image_urls, status, created_at, approved_by_admin_id, approved_at, rejection_reason")
          .in("task_id", ids)
          .order("created_at", { ascending: false })
          .limit(50);

        const grouped: Record<number, TaskUpdate[]> = {};
        (updData || []).forEach((u: any) => {
          const tid = Number(u.task_id);
          if (!grouped[tid]) grouped[tid] = [];
          grouped[tid].push(u as TaskUpdate);
        });
        setMyRecentUpdates(grouped);
      } else {
        setMyRecentUpdates({});
      }
    } catch (e) {
      console.error("Failed to fetch tasks", e);
    }
  };

  const myTaskGroups = useMemo(() => {
    const byKey: Record<string, { key: string; product_name: string; user_item_id: string | null; tasks: Task[] }> = {};
    for (const t of tasks) {
      const key = String(t.user_item_id || t.product_name || "").trim();
      if (!key) continue;
      if (!byKey[key]) {
        byKey[key] = {
          key,
          product_name: t.product_name || "(Unknown Product)",
          user_item_id: (t.user_item_id ?? null) as any,
          tasks: [],
        };
      }
      byKey[key].tasks.push(t);
    }
    return Object.values(byKey).sort((a, b) => a.product_name.localeCompare(b.product_name));
  }, [tasks]);

  const toggleUpdates = (taskId: number) =>
    setExpandedUpdates((prev) => ({ ...prev, [taskId]: !prev[taskId] }));

  const publishApprovedUpdateToOrder = async (task: Task, update: TaskUpdate, approvedAtIso: string) => {
    const orderId = String(task.user_item_id || "").trim();
    if (!orderId) return;

    const { data: uiData, error: uiErr } = await supabase
      .from("user_items")
      .select("id, meta")
      .eq("id", orderId)
      .single();
    if (uiErr || !uiData) throw uiErr;

    const meta = (uiData as any).meta || {};
    const existing = Array.isArray(meta.production_updates) ? meta.production_updates : [];

    const entry = {
      id: update.id,
      task_id: update.task_id,
      task_name: task.task_name,
      employee_name: task.employee_name,
      submitted_by_admin_id: update.submitted_by_admin_id ?? null,
      submitted_by_name: update.submitted_by_name ?? task.employee_name ?? null,
      description: update.description || "",
      image_urls: Array.isArray(update.image_urls) ? update.image_urls : [],
      created_at: update.created_at,
      approved_at: approvedAtIso,
      approved_by_name: adminSession?.username || null,
    };

    // Avoid duplicates if re-approving
    const next = [entry, ...existing.filter((x: any) => String(x?.id || "") !== String(update.id))];
    const { error: updErr } = await supabase
      .from("user_items")
      .update({ meta: { ...meta, production_updates: next }, updated_at: approvedAtIso })
      .eq("id", orderId);
    if (updErr) throw updErr;
  };

  const approveTaskUpdate = async (update: TaskUpdate, task: Task, group: OrderGroup) => {
    if (!canReviewProgress) {
      alert("Only Superadmin / Team Leader can approve updates.");
      return;
    }
    setReviewBusyId(update.id);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("task_updates")
        .update({
          status: "approved",
          approved_by_admin_id: adminSession?.id || null,
          approved_at: nowIso,
          rejection_reason: null,
        })
        .eq("id", update.id);
      if (error) throw error;

      await publishApprovedUpdateToOrder(task, update, nowIso);
      await loadGroupUpdates(group);
      alert("✅ Approved. This update is now visible to the customer.");
    } catch (e: any) {
      console.error("approveTaskUpdate error", e);
      alert("❌ Failed to approve update: " + (e?.message || "Unknown error"));
    } finally {
      setReviewBusyId(null);
    }
  };

  const rejectTaskUpdate = async (update: TaskUpdate, group: OrderGroup) => {
    if (!canReviewProgress) {
      alert("Only Superadmin / Team Leader can reject updates.");
      return;
    }
    const reason = rejectReason.trim();
    if (!reason) {
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
          rejection_reason: reason,
        })
        .eq("id", update.id);
      if (error) throw error;
      setRejectModal(null);
      setRejectReason("");
      await loadGroupUpdates(group);
      alert("✅ Rejected.");
    } catch (e: any) {
      console.error("rejectTaskUpdate error", e);
      alert("❌ Failed to reject update: " + (e?.message || "Unknown error"));
    } finally {
      setRejecting(false);
    }
  };

  const fetchOrderGroups = async () => {
    try {
      // Leaders see all production-related orders:
      // - any orders that already have tasks
      // - any orders in in_production / quality_check stages
      const { data: taskRows, error: taskErr } = await supabase
        .from("tasks")
        .select("*")
        .not("user_item_id", "is", null)
        .order("due_date", { ascending: true })
        .limit(1500);
      if (taskErr) throw taskErr;

      const allTasks = (taskRows || []) as Task[];
      const byOrder: Record<string, Task[]> = {};
      for (const t of allTasks) {
        const key = String(t.user_item_id || "").trim();
        if (!key) continue;
        if (!byOrder[key]) byOrder[key] = [];
        byOrder[key].push(t);
      }
      const taskOrderIds = Object.keys(byOrder);

      const { data: stageRows, error: stageErr } = await supabase
        .from("user_items")
        .select("id, customer_name, order_status, status, meta, progress_history, products(name)")
        .or("order_status.in.(in_production,quality_check),status.in.(in_production,quality_check)")
        .limit(1500);
      if (stageErr) throw stageErr;

      const uiMap = new Map<string, UserItemLite>();
      (stageRows || []).forEach((r: any) => uiMap.set(String(r.id), r as UserItemLite));

      const stageIds = new Set<string>((stageRows || []).map((r: any) => String(r.id)));
      const missingTaskIds = taskOrderIds.filter((id) => !stageIds.has(id));

      if (missingTaskIds.length) {
        const { data: extraRows, error: extraErr } = await supabase
          .from("user_items")
          .select("id, customer_name, order_status, status, meta, progress_history, products(name)")
          .in("id", missingTaskIds);
        if (extraErr) throw extraErr;
        (extraRows || []).forEach((r: any) => uiMap.set(String(r.id), r as UserItemLite));
      }

      const orderIds = Array.from(new Set<string>([...Array.from(uiMap.keys()), ...taskOrderIds]));
      if (orderIds.length === 0) {
        setOrderGroups([]);
        return;
      }

      const groups: OrderGroup[] = orderIds
        .map((oid) => {
          const tasksForOrder = byOrder[oid] || [];
          const ui = uiMap.get(oid);

          const productName = ui?.products?.name || tasksForOrder[0]?.product_name || "(Unknown Product)";

          const pctRaw = Number(ui?.meta?.production_percent ?? 0);
          const production_percent = Number.isFinite(pctRaw) ? Math.max(0, Math.min(100, pctRaw)) : 0;

          return {
            user_item_id: oid,
            product_name: productName,
            customer_name: ui?.customer_name ?? null,
            order_status: (ui?.order_status || ui?.status || null) as string | null,
            production_percent,
            tasks: tasksForOrder,
          };
        })
        .sort((a, b) => {
          return (a.production_percent === 100 ? 1 : 0) - (b.production_percent === 100 ? 1 : 0);
        });

      setOrderGroups(groups);
      setGroupProgressDraft((prev) => {
        const next = { ...prev };
        for (const g of groups) {
          if (typeof next[g.user_item_id] !== "number") next[g.user_item_id] = g.production_percent;
        }
        return next;
      });
    } catch (e) {
      console.error("Failed to fetch grouped orders", e);
      setOrderGroups([]);
    }
  };

  const loadTeamMembersForGroup = async (group: OrderGroup) => {
    try {
      const { data, error } = await supabase
        .from("order_team_members")
        .select("admin_id")
        .eq("user_item_id", group.user_item_id);
      if (error) throw error;
      const ids = (data || [])
        .map((r: unknown) => String((r as TeamMemberRow).admin_id || ""))
        .filter(Boolean);
      setTeamMemberIds(ids);
    } catch (e) {
      console.error("Failed to load team members", e);
      setTeamMemberIds([]);
    }
  };

  const saveTeamMembersForGroup = async (group: OrderGroup) => {
    if (!canReviewProgress) return;
    if (!group?.user_item_id) return;
    if (teamMemberIds.length === 0) {
      alert("Please select at least one employee for the production team.");
      return;
    }
    setTeamBusy(true);
    try {
      const { error: delErr } = await supabase
        .from("order_team_members")
        .delete()
        .eq("user_item_id", group.user_item_id);
      if (delErr) throw delErr;

      const payload = teamMemberIds.map((adminId) => ({
        user_item_id: group.user_item_id,
        admin_id: adminId,
        created_by_admin_id: adminSession?.id || null,
      }));
      const { error: insErr } = await supabase.from("order_team_members").insert(payload);
      if (insErr) throw insErr;

      alert("✅ Production team saved.");
      setManageTeamOpen(false);
    } catch (e: any) {
      console.error("saveTeamMembersForGroup error", e);
      alert("❌ Failed to save team: " + (e?.message || "Unknown error"));
    } finally {
      setTeamBusy(false);
    }
  };

  const startProductionForOrderIfNeeded = async (orderId: string) => {
    const { data: ui, error: uiErr } = await supabase
      .from("user_items")
      .select("id, meta, progress_history, order_status, status")
      .eq("id", orderId)
      .single();
    if (uiErr || !ui) throw uiErr;

    const currentStage = String((ui as any).order_status || (ui as any).status || "");
    if (currentStage === "in_production") return;

    const ok = window.confirm(
      `This order is currently '${currentStage || "(unknown)"}'. Start production now (move to In Production) before creating tasks?`
    );
    if (!ok) return;

    const nowIso = new Date().toISOString();
    const meta = ((ui as any).meta || {}) as any;
    const history = Array.isArray((ui as any).progress_history) ? (ui as any).progress_history : [];
    const { error } = await supabase
      .from("user_items")
      .update({
        status: "in_production",
        order_status: "in_production",
        meta: {
          ...meta,
          production_percent: Number.isFinite(Number(meta.production_percent)) ? meta.production_percent : 0,
        },
        progress_history: [{ status: "in_production", updated_at: nowIso }, ...history],
        updated_at: nowIso,
      })
      .eq("id", orderId);
    if (error) throw error;
  };

  const createTaskForGroup = async (group: OrderGroup) => {
    if (!canReviewProgress) {
      alert("Only Superadmin / Team Leader can create tasks.");
      return;
    }
    if (!group?.user_item_id) {
      alert("This product is not linked to an order.");
      return;
    }
    if (!newTask.task_name.trim()) {
      alert("Please enter a task name.");
      return;
    }
    if (!newTask.assigned_admin_id) {
      alert("Please assign this task to an employee.");
      return;
    }
    if (!newTask.start_date || !newTask.due_date) {
      alert("Please set start and due dates.");
      return;
    }

    const assignee = employees.find((e) => e.id === newTask.assigned_admin_id);
    if (!assignee) {
      alert("Invalid assignee.");
      return;
    }

    setCreatingTask(true);
    try {
      await startProductionForOrderIfNeeded(group.user_item_id);

      const { data: existingTasks, error: tErr } = await supabase
        .from("tasks")
        .select("id")
        .eq("user_item_id", group.user_item_id);
      if (tErr) throw tErr;
      const seq = (existingTasks || []).length + 1;
      const short = group.user_item_id.slice(0, 6).toUpperCase();
      const task_number = `ORD-${short}-${String(seq).padStart(2, "0")}`;

      const payload = {
        task_number,
        product_name: group.product_name,
        task_name: newTask.task_name.trim(),
        user_item_id: group.user_item_id,
        // If tasks table expects product_id, keep it nullable; order_groups was built from tasks/user_items.
        product_id: (group.tasks?.[0]?.product_id ?? null) as any,
        assigned_admin_id: assignee.id,
        employee_name: assignee.full_name || assignee.username,
        employee_number: assignee.employee_number || "",
        start_date: newTask.start_date,
        due_date: newTask.due_date,
        status: "Pending",
      };

      const { error } = await supabase.from("tasks").insert([payload]);
      if (error) throw error;

      const { data: tData, error: reloadErr } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_item_id", group.user_item_id)
        .order("due_date", { ascending: true });
      if (reloadErr) throw reloadErr;

      const updatedGroup: OrderGroup = { ...group, tasks: (tData || []) as Task[] };
      setSelectedGroup(updatedGroup);
      await loadGroupUpdates(updatedGroup);

      setCreateTaskOpen(false);
      setNewTask({
        task_name: "",
        assigned_admin_id: "",
        start_date: new Date().toISOString().slice(0, 10),
        due_date: "",
      });
      await fetchOrderGroups();
      alert("✅ Task created.");
    } catch (e: any) {
      console.error("createTaskForGroup error", e);
      alert("❌ Failed to create task: " + (e?.message || "Unknown error"));
    } finally {
      setCreatingTask(false);
    }
  };

  const loadGroupUpdates = async (group: OrderGroup) => {
    try {
      const taskIds = group.tasks.map((t) => t.id).filter(Boolean);
      if (!taskIds.length) {
        setGroupUpdates({});
        return;
      }

      const { data: updData, error: updErr } = await supabase
        .from("task_updates")
        .select("id, task_id, submitted_by_admin_id, submitted_by_name, description, image_urls, status, created_at, approved_by_admin_id, approved_at, rejection_reason")
        .in("task_id", taskIds)
        .order("created_at", { ascending: false })
        .limit(250);
      if (updErr) throw updErr;

      const grouped: Record<number, TaskUpdate[]> = {};
      (updData || []).forEach((u: any) => {
        const tid = Number(u.task_id);
        if (!grouped[tid]) grouped[tid] = [];
        grouped[tid].push(u as TaskUpdate);
      });
      setGroupUpdates(grouped);
    } catch (e) {
      console.error("Failed to load group updates", e);
      setGroupUpdates({});
    }
  };

  const saveGroupProductionPercent = async (group: OrderGroup) => {
    if (!canReviewProgress) return;
    const nextPct = Math.max(0, Math.min(100, Number(groupProgressDraft[group.user_item_id]) || 0));
    setSavingGroupProgressId(group.user_item_id);
    try {
      const { data: uiData, error: uiErr } = await supabase
        .from("user_items")
        .select("id, meta, progress_history, order_status, status")
        .eq("id", group.user_item_id)
        .single();
      if (uiErr || !uiData) throw uiErr;

      const ui = uiData as UserItemLite;
      const meta = ui.meta || {};
      const history = Array.isArray(ui.progress_history) ? ui.progress_history : [];
      const nowIso = new Date().toISOString();

      const patch: any = {
        meta: {
          ...meta,
          production_percent: nextPct,
        },
        updated_at: nowIso,
      };

      // Automation: when production hits 100%, move to Quality Check.
      if (nextPct >= 100) {
        const currentStage = String(ui.order_status || ui.status || "");
        if (currentStage !== "quality_check") {
          patch.order_status = "quality_check";
          patch.status = "quality_check";
          patch.progress_history = [{ status: "quality_check", updated_at: nowIso }, ...history];
        }
      }

      const { error: updErr } = await supabase.from("user_items").update(patch).eq("id", group.user_item_id);
      if (updErr) throw updErr;

      await fetchOrderGroups();
      alert(nextPct >= 100 ? "✅ Saved. Moved to Quality Check." : "✅ Progress saved.");
    } catch (e: any) {
      console.error("saveGroupProductionPercent error", e);
      alert("❌ Failed to update progress: " + (e?.message || "Unknown error"));
    } finally {
      setSavingGroupProgressId(null);
    }
  };

  const uploadProgressImages = async (task: Task, files: File[]): Promise<string[]> => {
    const urls: string[] = [];
    if (!files.length) return urls;

    for (const f of files) {
      const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `orders/${task.user_item_id || "unlinked"}/tasks/${task.id}/${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        // Use the same bucket used by other CMS uploads in this repo.
        .from("uploads")
        .upload(path, f, { upsert: false });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(path);
      if (urlData?.publicUrl) urls.push(urlData.publicUrl);
    }

    return urls;
  };

  const submitProgress = async () => {
    if (!progressModal) return;
    const task = progressModal.task;
    if (!progressText.trim() && progressFiles.length === 0) {
      alert("Please provide a description or at least one image.");
      return;
    }

    setSubmitting(true);
    try {
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

      setProgressText("");
      setProgressFiles([]);
      setProgressModal(null);
      if (canReviewProgress) {
        await fetchOrderGroups();
      } else {
        await fetchMyTasks();
      }
      alert("✅ Progress submitted! Awaiting approval.");
    } catch (e: any) {
      console.error("submitProgress error", e);
      alert("❌ Failed to submit progress: " + (e?.message || "Unknown error"));
    } finally {
      setSubmitting(false);
    }
  };

  const updateTaskStatus = async (taskId: number, status: string) => {
    if (!adminSession?.id) {
      alert("Missing admin session.");
      return;
    }

    setUpdatingStatusId(taskId);
    try {
      const { error } = await supabase.from("tasks").update({ status }).eq("id", taskId);
      if (error) throw error;
      if (canReviewProgress) {
        await fetchOrderGroups();
      } else {
        await fetchMyTasks();
      }
    } catch (e: any) {
      console.error("updateTaskStatus error", e);
      alert("❌ Failed to update task status: " + (e?.message || "Unknown error"));
    } finally {
      setUpdatingStatusId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        {canReviewProgress ? <Users className="text-green-700" size={28} /> : <UserCheck className="text-green-700" size={28} />}
        <h1 className="text-3xl font-bold text-green-700">{canReviewProgress ? "Employee Tasks" : "My Tasks"}</h1>
      </div>

      {!adminSession?.id && (
        <div className="mb-4 rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
          You're not logged in as an admin employee. Tasks will not be filtered.
        </div>
      )}

      {canReviewProgress ? (
        <div className="overflow-x-auto bg-white shadow-lg rounded-xl border border-gray-200">
          <table className="w-full text-sm text-left">
            <thead className="bg-gradient-to-r from-green-700 to-green-600 text-white">
              <tr>
                <th className="p-3">Order</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Stage</th>
                <th className="p-3">Progress</th>
                <th className="p-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {orderGroups.map((g, idx) => {
                const pct = Math.max(0, Math.min(100, Number(groupProgressDraft[g.user_item_id]) ?? g.production_percent));
                return (
                  <tr
                    key={g.user_item_id}
                    className={`hover:bg-gray-50 ${idx % 2 === 0 ? "bg-white" : "bg-gray-50"}`}
                  >
                    <td className="p-3 font-medium text-gray-800">
                      <button
                        type="button"
                        onClick={async () => {
                          setSelectedGroup(g);
                          setTeamMemberIds([]);
                          await Promise.all([loadGroupUpdates(g), loadTeamMembersForGroup(g)]);
                        }}
                        className="text-left text-green-800 hover:underline"
                        title="Open order details"
                      >
                        {g.product_name}
                      </button>
                    </td>
                    <td className="p-3 text-gray-700">{g.customer_name || "—"}</td>
                    <td className="p-3 text-gray-700">{g.order_status || "—"}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-44 h-2 rounded bg-gray-200 overflow-hidden">
                          <div className="h-2 bg-green-600" style={{ width: `${pct}%` }} />
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={pct}
                          onChange={(e) =>
                            setGroupProgressDraft((prev) => ({
                              ...prev,
                              [g.user_item_id]: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                            }))
                          }
                          className="w-20 border rounded px-2 py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => saveGroupProductionPercent(g)}
                          disabled={savingGroupProgressId === g.user_item_id}
                          className="px-3 py-1 rounded bg-green-700 text-white text-xs hover:bg-green-800 disabled:opacity-50"
                        >
                          {savingGroupProgressId === g.user_item_id ? "Saving…" : "Save"}
                        </button>
                      </div>
                      <div className="text-[11px] text-gray-500 mt-1">
                        Set to 100% to auto-move to <span className="font-semibold">quality_check</span>.
                      </div>
                    </td>
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={async () => {
                          setSelectedGroup(g);
                          setTeamMemberIds([]);
                          await loadTeamMembersForGroup(g);
                          await loadGroupUpdates(g);
                        }}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-white border text-xs hover:bg-gray-50"
                      >
                        <PackageSearch size={16} /> View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white shadow-lg rounded-xl border border-gray-200">
          <table className="w-full text-sm text-left">
            <thead className="bg-gradient-to-r from-green-700 to-green-600 text-white">
              <tr>
                <th className="p-3">Task #</th>
                <th className="p-3">Product/Task</th>
                <th className="p-3">Task Name</th>
                <th className="p-3">Employee</th>
                <th className="p-3">Employee #</th>
                <th className="p-3">Start</th>
                <th className="p-3">Due</th>
                <th className="p-3">Status</th>
                <th className="p-3">Progress</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t, idx) => (
                <tr
                  key={t.id}
                  className={`hover:bg-gray-50 ${idx % 2 === 0 ? "bg-white" : "bg-gray-50"}`}
                >
                  <td className="p-3 font-medium text-gray-700">{t.task_number}</td>
                  <td className="p-3 text-gray-700">
                    <button
                      type="button"
                      onClick={() => {
                        const key = String(t.user_item_id || t.product_name || "").trim();
                        const g = myTaskGroups.find((x) => x.key === key);
                        if (g) setSelectedMyGroup(g);
                      }}
                      className="text-left text-green-800 hover:underline"
                      title="Open product tasks"
                    >
                      {t.product_name}
                    </button>
                    {t.user_item_id ? <div className="text-[11px] text-gray-500">Order: {t.user_item_id}</div> : null}
                  </td>
                  <td className="p-3 text-gray-700">{t.task_name}</td>
                  <td className="p-3 text-gray-700">{t.employee_name}</td>
                  <td className="p-3 text-gray-700">{t.employee_number}</td>
                  <td className="p-3 text-gray-700">{t.start_date}</td>
                  <td className="p-3 text-gray-700">{t.due_date}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold ${
                        t.status === "Completed"
                          ? "bg-green-100 text-green-700"
                          : t.status === "In Progress"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-yellow-100 text-yellow-700"
                      }`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={() => {
                            setProgressModal({ task: t });
                            setProgressText("");
                            setProgressFiles([]);
                          }}
                          className="px-3 py-1.5 rounded bg-green-700 text-white text-xs hover:bg-green-800"
                        >
                          Submit Update
                        </button>
                        <span className="text-xs text-gray-500">
                          {(myRecentUpdates[t.id]?.[0]?.status && `Last: ${myRecentUpdates[t.id][0].status}`) || ""}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <select
                          className="border rounded px-2 py-1 text-xs text-gray-700"
                          value={t.status}
                          onChange={(e) => updateTaskStatus(t.id, e.target.value)}
                          disabled={updatingStatusId === t.id}
                        >
                          <option value="Pending">Pending</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Completed">Completed</option>
                        </select>
                        {updatingStatusId === t.id ? <span className="text-xs text-gray-500">Saving…</span> : null}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!canReviewProgress && selectedMyGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedMyGroup(null)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-5xl p-6 z-10">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <PackageSearch size={18} /> {selectedMyGroup.product_name}
                </h2>
                <p className="text-sm text-gray-500">
                  {selectedMyGroup.user_item_id ? `Order: ${selectedMyGroup.user_item_id} • ` : ""}
                  Click a task to submit an update with description + images.
                </p>
              </div>
              <button className="text-gray-400 hover:text-gray-600" onClick={() => setSelectedMyGroup(null)}>
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {selectedMyGroup.tasks.map((t) => {
                const updates = myRecentUpdates[t.id] || [];
                const last = updates[0];
                const isExpanded = !!expandedUpdates[t.id];

                return (
                  <div key={t.id} className="border rounded-lg p-4 bg-white">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-gray-800">
                          #{t.task_number} • {t.task_name}
                        </div>
                        <div className="text-xs text-gray-500">Due: {t.due_date} • Status: {t.status}</div>
                        {last ? (
                          <div className="mt-2 text-xs">
                            <span className="font-semibold text-gray-700">Last update:</span>{" "}
                            <span className="text-gray-600">{last.status}</span>
                            <span className="text-gray-400"> • {new Date(last.created_at).toLocaleString()}</span>
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-gray-500">No updates yet.</div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setProgressModal({ task: t });
                            setProgressText("");
                            setProgressFiles([]);
                          }}
                          className="px-3 py-2 rounded bg-green-700 text-white text-xs hover:bg-green-800"
                        >
                          Submit Update
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleUpdates(t.id)}
                          className="px-3 py-2 rounded border text-xs hover:bg-gray-50"
                        >
                          {isExpanded ? "Hide Updates" : "View Updates"}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 space-y-3">
                        {updates.length ? (
                          updates.map((u) => (
                            <div key={u.id} className="rounded border bg-gray-50 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs font-semibold text-gray-700">{u.status}</div>
                                <div className="text-[11px] text-gray-500">{new Date(u.created_at).toLocaleString()}</div>
                              </div>
                                {u.submitted_by_name ? (
                                  <div className="text-[11px] text-gray-500 mt-1">By: {u.submitted_by_name}</div>
                                ) : null}
                              {u.description ? <div className="text-xs text-gray-700 mt-2 whitespace-pre-wrap">{u.description}</div> : null}
                              {Array.isArray(u.image_urls) && u.image_urls.length ? (
                                <div className="mt-2 flex gap-2 flex-wrap">
                                  {u.image_urls.slice(0, 6).map((img, idx) => (
                                    <button
                                      key={img}
                                      type="button"
                                      onClick={() => openLightbox(u.image_urls || [], idx, "Update Images")}
                                      className="block"
                                      aria-label="Open image"
                                    >
                                      <img src={img} alt="Update" className="w-14 h-14 rounded object-cover border" />
                                    </button>
                                  ))}
                                  {u.image_urls.length > 6 ? (
                                    <span className="text-xs text-gray-500">+{u.image_urls.length - 6} more</span>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <div className="text-xs text-gray-500">No updates yet.</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {selectedGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedGroup(null)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-5xl p-6 z-10">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Users size={18} /> {selectedGroup.product_name}
                </h2>
                <p className="text-sm text-gray-500">
                  Order: {selectedGroup.user_item_id} • Customer: {selectedGroup.customer_name || "—"} • Stage:{" "}
                  {selectedGroup.order_status || "—"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await loadTeamMembersForGroup(selectedGroup);
                    setManageTeamOpen(true);
                  }}
                  className="px-3 py-2 rounded bg-green-700 text-white text-xs hover:bg-green-800"
                >
                  Manage Team
                </button>
                <button
                  type="button"
                  onClick={() => setCreateTaskOpen(true)}
                  className="px-3 py-2 rounded bg-purple-700 text-white text-xs hover:bg-purple-800"
                >
                  New Task
                </button>
                <Link
                  href={`/dashboard/task/admintask?orderId=${encodeURIComponent(selectedGroup.user_item_id)}&auto=edit`}
                  className="px-3 py-2 rounded bg-blue-700 text-white text-xs hover:bg-blue-800"
                >
                  Open in AdminTask
                </Link>
                <button className="text-gray-400 hover:text-gray-600" onClick={() => setSelectedGroup(null)}>
                  ✕
                </button>
              </div>
            </div>

            <div className="mb-4 rounded border bg-gray-50 p-3">
              <div className="text-sm font-semibold text-gray-800">Assigned Employees</div>
              <div className="text-xs text-gray-500">Production team members and task assignees for this product/order.</div>

              <div className="mt-3">
                <div className="text-xs font-semibold text-gray-700">Production Team</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {teamMemberIds.length === 0 ? (
                    <span className="text-xs text-gray-500">No team members set yet.</span>
                  ) : (
                    teamMemberIds.map((id) => {
                      const e = employeeById.get(id);
                      const label = e ? (e.full_name || e.username) : `Unknown (${id.slice(0, 8)}…)`;
                      const inactive = e?.is_active === false;
                      return (
                        <span
                          key={id}
                          className={`inline-flex items-center rounded-full border bg-white px-2 py-1 text-xs ${inactive ? "text-gray-500" : "text-gray-700"}`}
                          title={inactive ? "Inactive employee" : ""}
                        >
                          {label}{inactive ? " (inactive)" : ""}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="mt-4">
                <div className="text-xs font-semibold text-gray-700">Task Assignees</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {Array.from(
                    new Map(
                      (selectedGroup.tasks || [])
                        .map((t) => {
                          const id = String(t.assigned_admin_id || "").trim();
                          const fallback = String(t.employee_name || "").trim();
                          if (!id && !fallback) return null;
                          const e = id ? employeeById.get(id) : undefined;
                          const label = e ? (e.full_name || e.username) : (fallback || (id ? `Unknown (${id.slice(0, 8)}…)` : "Unknown"));
                          return [id || label, { id, label, inactive: e?.is_active === false }];
                        })
                        .filter(Boolean) as any
                    ).values()
                  ).length === 0 ? (
                    <span className="text-xs text-gray-500">No tasks assigned yet.</span>
                  ) : (
                    Array.from(
                      new Map(
                        (selectedGroup.tasks || [])
                          .map((t) => {
                            const id = String(t.assigned_admin_id || "").trim();
                            const fallback = String(t.employee_name || "").trim();
                            if (!id && !fallback) return null;
                            const e = id ? employeeById.get(id) : undefined;
                            const label = e ? (e.full_name || e.username) : (fallback || (id ? `Unknown (${id.slice(0, 8)}…)` : "Unknown"));
                            return [id || label, { id, label, inactive: e?.is_active === false }];
                          })
                          .filter(Boolean) as any
                      ).values()
                    ).map((x: any) => (
                      <span
                        key={x.id || x.label}
                        className={`inline-flex items-center rounded-full border bg-white px-2 py-1 text-xs ${x.inactive ? "text-gray-500" : "text-gray-700"}`}
                        title={x.inactive ? "Inactive employee" : ""}
                      >
                        {x.label}{x.inactive ? " (inactive)" : ""}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left p-3">Employee</th>
                    <th className="text-left p-3">Task</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-left p-3">Last Update</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedGroup.tasks.map((t) => {
                    const last = groupUpdates[t.id]?.[0];
                    const isExpanded = !!expandedUpdates[t.id];
                    return (
                      <tr key={t.id} className="border-t">
                        <td className="p-3">
                          <div className="font-medium text-gray-800">{t.employee_name}</div>
                          <div className="text-xs text-gray-500">{t.employee_number}</div>
                        </td>
                        <td className="p-3">
                          <div className="text-gray-800">{t.task_name}</div>
                          <div className="text-xs text-gray-500">#{t.task_number}</div>
                        </td>
                        <td className="p-3">
                          <span
                            className={`px-2 py-1 rounded text-xs font-semibold ${
                              t.status === "Completed"
                                ? "bg-green-100 text-green-700"
                                : t.status === "In Progress"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-yellow-100 text-yellow-700"
                            }`}
                          >
                            {t.status}
                          </span>
                        </td>
                        <td className="p-3">
                          {last ? (
                            <div>
                              <div className="text-xs font-semibold text-gray-700">{last.status}</div>
                              <div className="text-xs text-gray-500">{new Date(last.created_at).toLocaleString()}</div>
                              {last.submitted_by_name ? (
                                <div className="text-[11px] text-gray-500 mt-1">By: {last.submitted_by_name}</div>
                              ) : null}
                              {last.description ? (
                                <div className="text-xs text-gray-700 mt-1 line-clamp-2">{last.description}</div>
                              ) : null}
                              {Array.isArray(last.image_urls) && last.image_urls.length > 0 ? (
                                <div className="mt-2 flex gap-2 flex-wrap">
                                  {last.image_urls.slice(0, 3).map((u, idx) => (
                                    <button
                                      key={u}
                                      type="button"
                                      onClick={() => openLightbox(last.image_urls || [], idx, "Update Images")}
                                      className="block"
                                      aria-label="Open image"
                                    >
                                      <img src={u} alt="Update" className="w-12 h-12 rounded object-cover border" />
                                    </button>
                                  ))}
                                  {last.image_urls.length > 3 ? (
                                    <span className="text-xs text-gray-500">+{last.image_urls.length - 3} more</span>
                                  ) : null}
                                </div>
                              ) : null}

                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => toggleUpdates(t.id)}
                                  className="px-3 py-1.5 rounded border text-xs hover:bg-gray-50"
                                >
                                  {isExpanded ? "Hide Updates" : "View Updates"}
                                </button>
                                {last.status === "submitted" ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => approveTaskUpdate(last, t, selectedGroup)}
                                      disabled={reviewBusyId === last.id}
                                      className="px-3 py-1.5 rounded bg-blue-700 text-white text-xs hover:bg-blue-800 disabled:opacity-50"
                                    >
                                      {reviewBusyId === last.id ? "Approving…" : "Approve Latest"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRejectModal({ update: last, task: t, group: selectedGroup });
                                        setRejectReason("");
                                      }}
                                      disabled={reviewBusyId === last.id}
                                      className="px-3 py-1.5 rounded bg-red-600 text-white text-xs hover:bg-red-700 disabled:opacity-50"
                                    >
                                      Reject Latest
                                    </button>
                                  </>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => updateTaskStatus(t.id, "Completed")}
                                  className="px-3 py-1.5 rounded bg-green-700 text-white text-xs hover:bg-green-800"
                                >
                                  Mark Completed
                                </button>
                              </div>

                              {isExpanded && (
                                <div className="mt-3 space-y-3">
                                  {(groupUpdates[t.id] || []).length ? (
                                    (groupUpdates[t.id] || []).map((u) => (
                                      <div key={u.id} className="rounded border bg-gray-50 p-3">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="text-xs font-semibold text-gray-700">{u.status}</div>
                                          <div className="text-[11px] text-gray-500">{new Date(u.created_at).toLocaleString()}</div>
                                        </div>
                                        {u.submitted_by_name ? (
                                          <div className="text-[11px] text-gray-500 mt-1">By: {u.submitted_by_name}</div>
                                        ) : null}
                                        {u.rejection_reason ? (
                                          <div className="text-xs text-red-700 mt-1">Rejection: {u.rejection_reason}</div>
                                        ) : null}
                                        {u.description ? (
                                          <div className="text-xs text-gray-700 mt-2 whitespace-pre-wrap">{u.description}</div>
                                        ) : null}
                                        {Array.isArray(u.image_urls) && u.image_urls.length ? (
                                          <div className="mt-2 flex gap-2 flex-wrap">
                                            {u.image_urls.slice(0, 6).map((img, idx) => (
                                              <button
                                                key={img}
                                                type="button"
                                                onClick={() => openLightbox(u.image_urls || [], idx, "Update Images")}
                                                className="block"
                                                aria-label="Open image"
                                              >
                                                <img src={img} alt="Update" className="w-14 h-14 rounded object-cover border" />
                                              </button>
                                            ))}
                                            {u.image_urls.length > 6 ? (
                                              <span className="text-xs text-gray-500">+{u.image_urls.length - 6} more</span>
                                            ) : null}
                                          </div>
                                        ) : null}

                                        {u.status === "submitted" ? (
                                          <div className="mt-3 flex flex-wrap gap-2">
                                            <button
                                              type="button"
                                              onClick={() => approveTaskUpdate(u, t, selectedGroup)}
                                              disabled={reviewBusyId === u.id}
                                              className="px-3 py-1.5 rounded bg-blue-700 text-white text-xs hover:bg-blue-800 disabled:opacity-50"
                                            >
                                              {reviewBusyId === u.id ? "Approving…" : "Approve"}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setRejectModal({ update: u, task: t, group: selectedGroup });
                                                setRejectReason("");
                                              }}
                                              disabled={reviewBusyId === u.id}
                                              className="px-3 py-1.5 rounded bg-red-600 text-white text-xs hover:bg-red-700 disabled:opacity-50"
                                            >
                                              Reject
                                            </button>
                                          </div>
                                        ) : null}
                                      </div>
                                    ))
                                  ) : (
                                    <div className="text-xs text-gray-500">No updates yet</div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-500">No updates yet</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {selectedGroup && manageTeamOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !teamBusy && setManageTeamOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 z-10">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Manage Production Team</h3>
                <p className="text-sm text-gray-500">{selectedGroup.product_name} • Order: {selectedGroup.user_item_id}</p>
              </div>
              <button
                className="text-gray-400 hover:text-gray-600"
                onClick={() => !teamBusy && setManageTeamOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="max-h-80 overflow-auto border rounded p-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {activeEmployees
                  .filter((e) => String(e.role || "").toLowerCase() !== "superadmin")
                  .map((e) => {
                    const label = (e.full_name || e.username) + (e.position ? ` • ${e.position}` : "");
                    const checked = teamMemberIds.includes(e.id);
                    return (
                      <label key={e.id} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(ev) => {
                            setTeamMemberIds((prev) => {
                              if (ev.target.checked) return Array.from(new Set([...prev, e.id]));
                              return prev.filter((id) => id !== e.id);
                            });
                          }}
                        />
                        <span>{label}</span>
                      </label>
                    );
                  })}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded border px-4 py-2 text-sm"
                onClick={() => setManageTeamOpen(false)}
                disabled={teamBusy}
              >
                Cancel
              </button>
              <button
                className="rounded bg-green-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={() => saveTeamMembersForGroup(selectedGroup)}
                disabled={teamBusy}
              >
                {teamBusy ? "Saving…" : "Save Team"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedGroup && createTaskOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !creatingTask && setCreateTaskOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-xl p-6 z-10">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Create New Task</h3>
                <p className="text-sm text-gray-500">{selectedGroup.product_name} • Order: {selectedGroup.user_item_id}</p>
              </div>
              <button
                className="text-gray-400 hover:text-gray-600"
                onClick={() => !creatingTask && setCreateTaskOpen(false)}
              >
                ✕
              </button>
            </div>

            <label className="text-sm font-medium text-gray-700">Task Name</label>
            <input
              className="mt-1 w-full border rounded p-2 text-sm"
              value={newTask.task_name}
              onChange={(e) => setNewTask((p) => ({ ...p, task_name: e.target.value }))}
              placeholder="e.g. Fabricate base frame"
            />

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Assign to</label>
                <select
                  className="mt-1 w-full border rounded p-2 text-sm"
                  value={newTask.assigned_admin_id}
                  onChange={(e) => setNewTask((p) => ({ ...p, assigned_admin_id: e.target.value }))}
                >
                  <option value="">Select employee…</option>
                  {activeEmployees
                    .filter((e) => String(e.role || "").toLowerCase() !== "superadmin")
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.full_name || e.username}{e.position ? ` • ${e.position}` : ""}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Start Date</label>
                <input
                  type="date"
                  className="mt-1 w-full border rounded p-2 text-sm"
                  value={newTask.start_date}
                  onChange={(e) => setNewTask((p) => ({ ...p, start_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Due Date</label>
                <input
                  type="date"
                  className="mt-1 w-full border rounded p-2 text-sm"
                  value={newTask.due_date}
                  onChange={(e) => setNewTask((p) => ({ ...p, due_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded border px-4 py-2 text-sm"
                onClick={() => setCreateTaskOpen(false)}
                disabled={creatingTask}
              >
                Cancel
              </button>
              <button
                className="rounded bg-purple-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={() => createTaskForGroup(selectedGroup)}
                disabled={creatingTask}
              >
                {creatingTask ? "Creating…" : "Create Task"}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !rejecting && setRejectModal(null)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6 z-10">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Reject Progress Update</h3>
                <p className="text-sm text-gray-500">
                  {rejectModal.task.employee_name} • {rejectModal.task.task_name}
                </p>
              </div>
              <button
                className="text-gray-400 hover:text-gray-600"
                onClick={() => !rejecting && setRejectModal(null)}
              >
                ✕
              </button>
            </div>

            <label className="text-sm font-medium text-gray-700">Rejection reason</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full mt-1 border rounded p-2 text-sm"
              rows={4}
              placeholder="Tell the employee what to fix or provide."
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded border px-4 py-2 text-sm"
                onClick={() => setRejectModal(null)}
                disabled={rejecting}
              >
                Cancel
              </button>
              <button
                className="rounded bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={() => rejectTaskUpdate(rejectModal.update, rejectModal.group)}
                disabled={rejecting}
              >
                {rejecting ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}

      {progressModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !submitting && setProgressModal(null)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 z-10">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">Submit Progress</h2>
                <p className="text-sm text-gray-500">
                  {progressModal.task.task_number} • {progressModal.task.task_name}
                </p>
              </div>
              <button
                className="text-gray-400 hover:text-gray-600"
                onClick={() => !submitting && setProgressModal(null)}
              >
                ✕
              </button>
            </div>

            <label className="text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={progressText}
              onChange={(e) => setProgressText(e.target.value)}
              className="w-full mt-1 border rounded p-2 text-sm"
              rows={4}
              placeholder="Describe the progress and attach product/work photos (if any)."
            />

            <div className="mt-4">
              <label className="text-sm font-medium text-gray-700">Images (optional)</label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setProgressFiles(Array.from(e.target.files || []))}
                className="block mt-1"
              />
              {progressFiles.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">Selected: {progressFiles.length} file(s)</p>
              )}
              <p className="text-xs text-gray-500 mt-1">
                Uploaded images will be visible to the customer only after approval.
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded border px-4 py-2 text-sm"
                onClick={() => setProgressModal(null)}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                className="rounded bg-green-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={submitProgress}
                disabled={submitting}
              >
                {submitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ImageLightbox
        open={!!lightbox}
        urls={lightbox?.urls || []}
        index={lightbox?.index || 0}
        title={lightbox?.title}
        onClose={() => setLightbox(null)}
        onIndexChange={(next) =>
          setLightbox((prev) => (prev ? { ...prev, index: next } : prev))
        }
      />
    </div>
  );
}
