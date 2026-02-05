"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import { UserCheck, Users, PackageSearch } from "lucide-react";

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

type TaskUpdate = {
  id: string;
  task_id: number;
  description: string;
  image_urls: string[] | null;
  status: "submitted" | "approved" | "rejected";
  created_at: string;
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

export default function EmployeeTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [progressModal, setProgressModal] = useState<{ task: Task } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [progressFiles, setProgressFiles] = useState<File[]>([]);
  const [myRecentUpdates, setMyRecentUpdates] = useState<Record<number, TaskUpdate[]>>({});
  const [updatingStatusId, setUpdatingStatusId] = useState<number | null>(null);

  const [orderGroups, setOrderGroups] = useState<OrderGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<OrderGroup | null>(null);
  const [groupUpdates, setGroupUpdates] = useState<Record<number, TaskUpdate[]>>({});
  const [savingGroupProgressId, setSavingGroupProgressId] = useState<string | null>(null);
  const [groupProgressDraft, setGroupProgressDraft] = useState<Record<string, number>>({});

  const isLeader = useMemo(() => {
    const r = adminSession?.role;
    const p = (adminSession?.position || "").toLowerCase();
    if (r === "superadmin") return true;
    if (r === "manager") return true;
    return p.includes("super") || p.includes("manager") || r === "admin";
  }, [adminSession?.role, adminSession?.position]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("adminSession");
      if (raw) setAdminSession(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    if (!adminSession?.id) return;
    if (isLeader) {
      void fetchOrderGroups();
    } else {
      void fetchMyTasks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSession?.id, isLeader]);

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
          .select("id, task_id, description, image_urls, status, created_at")
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

  const fetchOrderGroups = async () => {
    try {
      // Leaders see all assigned production tasks (grouped by order/product)
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

      const orderIds = Object.keys(byOrder);
      if (orderIds.length === 0) {
        setOrderGroups([]);
        return;
      }

      const { data: uiRows, error: uiErr } = await supabase
        .from("user_items")
        .select("id, customer_name, order_status, status, meta, progress_history, products(name)")
        .in("id", orderIds);
      if (uiErr) throw uiErr;

      const uiMap = new Map<string, UserItemLite>();
      (uiRows || []).forEach((r: any) => uiMap.set(String(r.id), r as UserItemLite));

      const groups: OrderGroup[] = orderIds
        .map((oid) => {
          const tasksForOrder = byOrder[oid] || [];
          const ui = uiMap.get(oid);

          const productName =
            ui?.products?.name ||
            tasksForOrder[0]?.product_name ||
            "(Unknown Product)";

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
          // Prioritize not-done orders
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

  const loadGroupUpdates = async (group: OrderGroup) => {
    try {
      const taskIds = group.tasks.map((t) => t.id).filter(Boolean);
      if (!taskIds.length) {
        setGroupUpdates({});
        return;
      }

      const { data: updData, error: updErr } = await supabase
        .from("task_updates")
        .select("id, task_id, description, image_urls, status, created_at")
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
    if (!isLeader) return;
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
      if (isLeader) {
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
      if (isLeader) {
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
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        {isLeader ? <Users className="text-green-700" size={28} /> : <UserCheck className="text-green-700" size={28} />}
        <h1 className="text-3xl font-bold text-green-700">{isLeader ? "Employee Tasks" : "My Tasks"}</h1>
      </div>

      {!adminSession?.id && (
        <div className="mb-4 rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
          You're not logged in as an admin employee. Tasks will not be filtered.
        </div>
      )}

      {isLeader ? (
        <div className="overflow-x-auto bg-white shadow-lg rounded-xl border border-gray-200">
          <table className="w-full text-sm text-left">
            <thead className="bg-gradient-to-r from-green-700 to-green-600 text-white">
              <tr>
                <th className="p-3">Order</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Stage</th>
                <th className="p-3">Progress</th>
                <th className="p-3">Team</th>
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
                    <td className="p-3 font-medium text-gray-800">{g.product_name}</td>
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
                  <td className="p-3 text-gray-700">{t.product_name}</td>
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
                              {last.description ? (
                                <div className="text-xs text-gray-700 mt-1 line-clamp-2">{last.description}</div>
                              ) : null}
                              {Array.isArray(last.image_urls) && last.image_urls.length > 0 ? (
                                <div className="mt-2 flex gap-2 flex-wrap">
                                  {last.image_urls.slice(0, 3).map((u) => (
                                    <a
                                      key={u}
                                      href={u}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block"
                                    >
                                      <img src={u} alt="Update" className="w-12 h-12 rounded object-cover border" />
                                    </a>
                                  ))}
                                  {last.image_urls.length > 3 ? (
                                    <span className="text-xs text-gray-500">+{last.image_urls.length - 3} more</span>
                                  ) : null}
                                </div>
                              ) : null}
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

            <div className="mt-4 text-xs text-gray-500">
              Approvals happen in <span className="font-semibold">Admin Task</span>.
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
              placeholder="What did you do today? What is pending?"
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
    </div>
  );
}
