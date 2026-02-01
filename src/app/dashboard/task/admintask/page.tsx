"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import { Eye, Pencil, ArrowRight } from "lucide-react";

type Task = {
  id: number;
  task_number: string;
  product_name: string;
  task_name: string;
  employee_name: string;
  employee_number: string;
  user_item_id?: string | null;
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

type OrderOption = {
  user_item_id: string;
  product_id: string;
  product_name: string;
  customer_name: string | null;
  order_status: string | null;
  created_at: string;
};

type TaskUpdate = {
  id: string;
  task_id: number;
  submitted_by_admin_id: string | null;
  submitted_by_name: string | null;
  description: string;
  image_urls: string[] | null;
  status: "submitted" | "approved" | "rejected";
  is_final_qc?: boolean | null;
  created_at: string;
  approved_by_admin_id?: string | null;
  approved_at?: string | null;
  rejection_reason?: string | null;
};

type UserItemLite = {
  id: string;
  meta: any;
  progress_history: any[];
  order_status: string | null;
  order_progress?: string | null;
};

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | null>(null);

  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [updates, setUpdates] = useState<TaskUpdate[]>([]);
  const [loadingUpdates, setLoadingUpdates] = useState(false);
  const [orderProgress, setOrderProgress] = useState<number>(0);
  const [savingOrderProgress, setSavingOrderProgress] = useState(false);
  const [approveBusyId, setApproveBusyId] = useState<string | null>(null);
  const [markFinalQc, setMarkFinalQc] = useState(false);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");

  const isLeader = useMemo(() => {
    const r = adminSession?.role;
    const p = (adminSession?.position || "").toLowerCase();
    if (r === "superadmin") return true;
    if (r === "manager") return true;
    return p.includes("super") || p.includes("manager") || r === "admin";
  }, [adminSession?.role, adminSession?.position]);

  // Fetch tasks
  const fetchTasks = async () => {
    let q = supabase.from("tasks").select("*").order("id", { ascending: true });
    if (selectedOrderId) q = q.eq("user_item_id", selectedOrderId);
    const { data } = await q;

    if (data) setTasks(data as Task[]);
  };

  useEffect(() => {
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrderId]);

  useEffect(() => {
    (async () => {
      const { data: orderData, error: orderErr } = await supabase
        .from("user_items")
        .select("id, product_id, customer_name, status, order_status, created_at, products(name)")
        .in("item_type", ["order", "reservation"])
        .order("created_at", { ascending: false })
        .limit(400);

      if (orderErr) {
        console.error("Failed to load orders", orderErr);
        return;
      }

      const allowed = new Set(["accepted", "approved", "in_production", "quality_check", "packaging", "ready_for_delivery", "out_for_delivery"]);
      const mapped: OrderOption[] = (orderData || [])
        .map((row: unknown) => {
        const r = row as {
          id: string;
          product_id: string;
          customer_name?: string | null;
          status?: string | null;
          order_status?: string | null;
          created_at: string;
          products?: { name?: string | null } | null;
        };

        const stage = String(r.order_status || r.status || "");
        if (!allowed.has(stage)) return null;
        return {
          user_item_id: r.id,
          product_id: r.product_id,
          product_name: r.products?.name || "(Unknown Product)",
          customer_name: r.customer_name || null,
          order_status: (r.order_status || r.status || null) as string | null,
          created_at: r.created_at,
        };
        })
        .filter(Boolean) as OrderOption[];

      setOrders(mapped);
    })();
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("adminSession");
      if (raw) setAdminSession(JSON.parse(raw));
    } catch {}
  }, []);

  const loadTaskContext = async (task: Task) => {
    setLoadingUpdates(true);
    try {
      const { data: updData, error: updErr } = await supabase
        .from("task_updates")
        .select(
          "id, task_id, submitted_by_admin_id, submitted_by_name, description, image_urls, status, is_final_qc, created_at, approved_by_admin_id, approved_at, rejection_reason"
        )
        .eq("task_id", task.id)
        .order("created_at", { ascending: false });
      if (updErr) throw updErr;
      setUpdates((updData || []) as TaskUpdate[]);

      if (task.user_item_id) {
        const { data: uiData, error: uiErr } = await supabase
          .from("user_items")
          .select("id, meta, progress_history, order_status")
          .eq("id", task.user_item_id)
          .single();
        if (!uiErr && uiData) {
          const ui = uiData as UserItemLite;
          const pct = Number(ui?.meta?.production_percent ?? 0);
          setOrderProgress(Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0);
        }
      } else {
        setOrderProgress(0);
      }
    } catch (e) {
      console.error("Failed to load task updates", e);
      setUpdates([]);
      setOrderProgress(0);
    } finally {
      setLoadingUpdates(false);
    }
  };

  const saveOrderProgress = async () => {
    if (!selectedTask?.user_item_id) {
      alert("This task is not linked to an order.");
      return;
    }
    setSavingOrderProgress(true);
    try {
      const { data: uiData, error: uiErr } = await supabase
        .from("user_items")
        .select("id, meta")
        .eq("id", selectedTask.user_item_id)
        .single();
      if (uiErr || !uiData) throw uiErr;
      const meta = (uiData as any).meta || {};

      const { error } = await supabase
        .from("user_items")
        .update({
          meta: {
            ...meta,
            production_percent: Math.max(0, Math.min(100, Number(orderProgress) || 0)),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedTask.user_item_id);
      if (error) throw error;
      alert("✅ Order progress updated.");
    } catch (e: any) {
      console.error("saveOrderProgress error", e);
      alert("❌ Failed to update order progress: " + (e?.message || "Unknown error"));
    } finally {
      setSavingOrderProgress(false);
    }
  };

  const safeUpdateTaskUpdateRow = async (id: string, patch: Record<string, unknown>) => {
    // Some environments may not have the latest columns yet (e.g., visible_to_customer).
    // Try once with the patch as-is; if it fails due to missing column, retry without it.
    const { error } = await supabase.from("task_updates").update(patch).eq("id", id);
    if (!error) return;

    const msg = String((error as any)?.message || "");
    if (msg.toLowerCase().includes("column") && msg.toLowerCase().includes("visible_to_customer")) {
      const { visible_to_customer, ...rest } = patch as any;
      const { error: retryErr } = await supabase.from("task_updates").update(rest).eq("id", id);
      if (retryErr) throw retryErr;
      return;
    }

    throw error;
  };

  const pushApprovedUpdateToCustomer = async (task: Task, update: TaskUpdate) => {
    if (!task.user_item_id) return;
    const { data: uiData, error: uiErr } = await supabase
      .from("user_items")
      .select("id, meta, progress_history")
      .eq("id", task.user_item_id)
      .single();
    if (uiErr || !uiData) throw uiErr;

    const ui = uiData as UserItemLite;
    const prevMeta = ui.meta || {};
    const prevUpdates = Array.isArray(prevMeta.production_updates) ? prevMeta.production_updates : [];

    const nowIso = new Date().toISOString();
    const approvedPayload = {
      id: update.id,
      task_update_id: update.id,
      task_id: task.id,
      task_name: task.task_name,
      employee_name: task.employee_name,
      description: update.description,
      image_urls: update.image_urls || [],
      approved_at: nowIso,
      is_final_qc: !!markFinalQc,
    };

    const nextMeta = {
      ...prevMeta,
      production_percent: orderProgress,
      production_updates: [approvedPayload, ...prevUpdates],
      ...(markFinalQc
        ? {
            final_qc: {
              ...approvedPayload,
            },
          }
        : null),
    };

    const history = Array.isArray(ui.progress_history) ? ui.progress_history : [];
    const patch: any = {
      meta: nextMeta,
      updated_at: nowIso,
    };

    if (markFinalQc) {
      patch.order_status = "quality_check";
      patch.status = "quality_check";
      patch.progress_history = [{ status: "quality_check", updated_at: nowIso }, ...history];
    }

    const { error: uiUpdErr } = await supabase.from("user_items").update(patch).eq("id", task.user_item_id);
    if (uiUpdErr) throw uiUpdErr;
  };

  const approveUpdate = async (task: Task, update: TaskUpdate) => {
    if (!isLeader) {
      alert("Only team leaders/superadmins can approve progress.");
      return;
    }
    if (!adminSession?.id) {
      alert("Missing admin session.");
      return;
    }

    if (markFinalQc) {
      const hasDesc = Boolean(update.description && String(update.description).trim().length > 0);
      const hasImg = Array.isArray(update.image_urls) && update.image_urls.length > 0;
      if (!hasDesc || !hasImg) {
        alert("Final QC requires BOTH a description and at least one image.");
        return;
      }
    }

    setApproveBusyId(update.id);
    try {
      await safeUpdateTaskUpdateRow(update.id, {
        status: "approved",
        approved_by_admin_id: adminSession.id,
        approved_at: new Date().toISOString(),
        is_final_qc: markFinalQc,
        visible_to_customer: true,
      });
      await pushApprovedUpdateToCustomer(task, update);
      await loadTaskContext(task);
      alert("✅ Approved and sent to customer.");
    } catch (e: any) {
      console.error("approveUpdate error", e);
      alert("❌ Failed to approve: " + (e?.message || "Unknown error"));
    } finally {
      setApproveBusyId(null);
    }
  };

  const rejectUpdate = async (task: Task, update: TaskUpdate) => {
    if (!isLeader) {
      alert("Only team leaders/superadmins can reject progress.");
      return;
    }
    if (!adminSession?.id) {
      alert("Missing admin session.");
      return;
    }

    const reason = window.prompt("Rejection reason (optional):", "") ?? "";
    setApproveBusyId(update.id);
    try {
      await safeUpdateTaskUpdateRow(update.id, {
        status: "rejected",
        approved_by_admin_id: adminSession.id,
        rejected_at: new Date().toISOString(),
        visible_to_customer: false,
        rejection_reason: reason.trim() || null,
      });
      await loadTaskContext(task);
    } catch (e: any) {
      console.error("rejectUpdate error", e);
      alert("❌ Failed to reject: " + (e?.message || "Unknown error"));
    } finally {
      setApproveBusyId(null);
    }
  };

  return (
    <>
      {/* PAGE CONTENT */}
      <div
        className={`p-6 bg-gray-50 min-h-screen transition ${
          selectedTask ? "blur-sm pointer-events-none" : ""
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Production Review</h1>
            <div className="text-sm text-gray-500">Approve employee progress to publish it to the customer's Order Progress page.</div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <select
              value={selectedOrderId}
              onChange={(e) => setSelectedOrderId(e.target.value)}
              className="border rounded px-3 py-2 text-sm bg-white"
            >
              <option value="">All orders</option>
              {orders.map((o) => (
                <option key={o.user_item_id} value={o.user_item_id}>
                  {o.product_name} • {o.customer_name || "(No customer)"} • {o.order_status || ""} • {o.user_item_id.slice(0, 8)}…
                </option>
              ))}
            </select>

            <Link
              href="/dashboard/task/assigntask"
              className="inline-flex items-center justify-center gap-2 rounded bg-blue-700 px-3 py-2 text-sm text-white"
            >
              Production Setup <ArrowRight size={16} />
            </Link>
          </div>
        </div>

        {/* TABLE */}
        <div className="bg-white rounded-lg shadow border overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-100 text-gray-600">
              <tr>
                <th className="px-6 py-3">Task#</th>
                <th className="px-6 py-3">Product</th>
                <th className="px-6 py-3">Task</th>
                <th className="px-6 py-3">Employee</th>
                  <th className="px-6 py-3">Employee #</th>
                <th className="px-6 py-3">Production Start</th>
                <th className="px-6 py-3">Due</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-center">Action</th>
              </tr>
            </thead>

            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} className="border-t hover:bg-gray-50">
                  <td className="px-6 py-4">{task.task_number}</td>
                  <td className="px-6 py-4">{task.product_name}</td>
                  <td className="px-6 py-4">{task.task_name}</td>
                  <td className="px-6 py-4">{task.employee_name}</td>
                  <td className="px-6 py-4">{task.employee_number || "—"}</td>
                  <td className="px-6 py-4">{task.start_date}</td>
                  <td className="px-6 py-4">{task.due_date}</td>
                  <td className="px-6 py-4 font-medium">{task.status}</td>

                  <td className="px-6 py-4">
                    <div className="flex justify-center gap-2">
                      <button
                        onClick={() => {
                          setSelectedTask(task);
                          setMode("view");
                          loadTaskContext(task);
                        }}
                        className="h-8 w-8 rounded-md bg-yellow-400 hover:bg-yellow-500 text-white flex items-center justify-center"
                      >
                        <Eye size={16} />
                      </button>

                      <button
                        onClick={() => {
                          setSelectedTask(task);
                          setMode("edit");
                          setMarkFinalQc(false);
                          loadTaskContext(task);
                        }}
                        className="h-8 w-8 rounded-md bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center"
                      >
                        <Pencil size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              setSelectedTask(null);
              setMode(null);
            }}
          />

          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl p-6 z-10">
            {/* HEADER */}
            <div className="flex justify-between items-center mb-6">
              <div>
                  <h2 className="text-lg font-semibold">{selectedTask.task_number} • {selectedTask.task_name}</h2>
                <p className="text-sm text-gray-500">
                  {mode === "edit" ? "Editor Page" : "Viewer Page"}
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedTask(null);
                  setMode(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <p className="text-xs text-gray-500">Linked Order</p>
                <div className="mt-1 px-3 py-2 border rounded-md text-sm">
                  {selectedTask.user_item_id ? selectedTask.user_item_id.slice(0, 12) + "…" : "Not linked"}
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500">Employee</p>
                <div className="mt-1 px-3 py-2 border rounded-md text-sm">
                  {selectedTask.employee_name || "—"}
                </div>
              </div>
            </div>

            {/* VIEW MODE */}
            {mode === "view" && (
              <>
                <div className="mb-6">
                  <p className="text-xs text-gray-500">Task Status</p>
                  <div className="mt-1 px-3 py-2 border rounded-md text-sm">{selectedTask.status}</div>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-2">Submitted Updates</p>
                  {loadingUpdates ? (
                    <div className="text-sm text-gray-500">Loading…</div>
                  ) : updates.length === 0 ? (
                    <div className="text-sm text-gray-500">No updates yet.</div>
                  ) : (
                    <div className="space-y-3">
                      {updates.map((u) => (
                        <div key={u.id} className="border rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold">
                              {u.status.toUpperCase()} {u.is_final_qc ? "• FINAL QC" : ""}
                            </div>
                            <div className="text-xs text-gray-500">{new Date(u.created_at).toLocaleString()}</div>
                          </div>
                          {u.submitted_by_name && (
                            <div className="text-xs text-gray-500 mt-1">By: {u.submitted_by_name}</div>
                          )}
                          {u.rejection_reason && (
                            <div className="text-xs text-red-700 mt-1">Rejection: {u.rejection_reason}</div>
                          )}
                          {u.description && <div className="mt-2 text-sm text-gray-800 whitespace-pre-wrap">{u.description}</div>}
                          {Array.isArray(u.image_urls) && u.image_urls.length > 0 && (
                            <div className="mt-2 grid grid-cols-3 gap-2">
                              {u.image_urls.map((url, idx) => (
                                <img key={idx} src={url} alt="" className="h-24 w-full object-cover rounded border" />
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* EDIT MODE */}
            {mode === "edit" && (
              <>
                {!isLeader ? (
                  <div className="rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
                    You can view updates, but only team leaders/superadmins can approve.
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="text-xs text-gray-500">Order Progress (0-100%)</label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={orderProgress}
                      onChange={(e) => setOrderProgress(Number(e.target.value))}
                      className="w-full mt-1 px-3 py-2 border rounded-md"
                    />
                    <button
                      onClick={saveOrderProgress}
                      disabled={savingOrderProgress || !selectedTask.user_item_id}
                      className="mt-2 px-3 py-2 rounded bg-black text-white text-xs disabled:opacity-50"
                      type="button"
                    >
                      {savingOrderProgress ? "Saving…" : "Save Order Progress"}
                    </button>
                  </div>

                  <div>
                    <label className="text-xs text-gray-500">Special Approval</label>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        id="finalqc"
                        type="checkbox"
                        checked={markFinalQc}
                        onChange={(e) => setMarkFinalQc(e.target.checked)}
                      />
                      <label htmlFor="finalqc" className="text-sm text-gray-700">
                        Mark next approval as Final QC (moves order to Quality Check)
                      </label>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Use this when the final product photo/description is ready.
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-gray-500 mb-2">Updates</p>
                  {loadingUpdates ? (
                    <div className="text-sm text-gray-500">Loading…</div>
                  ) : updates.length === 0 ? (
                    <div className="text-sm text-gray-500">No updates yet.</div>
                  ) : (
                    <div className="space-y-3">
                      {updates.map((u) => (
                        <div key={u.id} className="border rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold">
                              {u.status.toUpperCase()} {u.is_final_qc ? "• FINAL QC" : ""}
                            </div>
                            <div className="text-xs text-gray-500">{new Date(u.created_at).toLocaleString()}</div>
                          </div>
                          {u.submitted_by_name && (
                            <div className="text-xs text-gray-500 mt-1">By: {u.submitted_by_name}</div>
                          )}
                          {u.description && <div className="mt-2 text-sm text-gray-800 whitespace-pre-wrap">{u.description}</div>}
                          {Array.isArray(u.image_urls) && u.image_urls.length > 0 && (
                            <div className="mt-2 grid grid-cols-3 gap-2">
                              {u.image_urls.map((url, idx) => (
                                <img key={idx} src={url} alt="" className="h-24 w-full object-cover rounded border" />
                              ))}
                            </div>
                          )}

                          {u.status === "submitted" && isLeader && (
                            <div className="mt-3 flex gap-2">
                              <button
                                className="px-3 py-2 rounded bg-green-700 text-white text-xs disabled:opacity-50"
                                onClick={() => approveUpdate(selectedTask, u)}
                                disabled={approveBusyId === u.id}
                                type="button"
                              >
                                {approveBusyId === u.id ? "Approving…" : "Approve & Send"}
                              </button>
                              <button
                                className="px-3 py-2 rounded bg-red-600 text-white text-xs disabled:opacity-50"
                                onClick={() => rejectUpdate(selectedTask, u)}
                                disabled={approveBusyId === u.id}
                                type="button"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* FOOTER */}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  setSelectedTask(null);
                  setMode(null);
                }}
                className="px-6 py-2 border rounded-md"
              >
                Cancel
              </button>

              {mode === "edit" && (
                <button
                  className="px-6 py-2 bg-blue-600 text-white rounded-md"
                  onClick={() => setMode("view")}
                  type="button"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}