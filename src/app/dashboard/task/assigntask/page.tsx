"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Users, Wrench, PlayCircle, Plus } from "lucide-react";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";

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

type UserItemMeta = {
  production_percent?: number;
  production_updates?: unknown[];
  final_qc?: unknown;
  [key: string]: unknown;
};

export default function AssignTaskPage() {
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);

  const [employees, setEmployees] = useState<AdminUser[]>([]);
  const [orders, setOrders] = useState<OrderOption[]>([]);

  const [teamSelectionIds, setTeamSelectionIds] = useState<string[]>([]);
  const [teamBusy, setTeamBusy] = useState(false);

  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [startingProduction, setStartingProduction] = useState(false);

  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [newTask, setNewTask] = useState({
    task_name: "",
    assigned_admin_id: "",
    start_date: new Date().toISOString().slice(0, 10),
    due_date: "",
  });

  const isLeader = useMemo(() => {
    const r = adminSession?.role;
    const p = (adminSession?.position || "").toLowerCase();
    if (r === "superadmin") return true;
    if (r === "manager") return true;
    if (r === "admin") return true;
    return p.includes("team") || p.includes("lead") || p.includes("super") || p.includes("manager") || p.includes("supervisor");
  }, [adminSession?.role, adminSession?.position]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("adminSession");
      if (raw) setAdminSession(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      // Load employees
      const { data: empData, error: empErr } = await supabase
        .from("admins")
        .select("id, username, full_name, employee_number, role, position, is_active")
        .eq("is_active", true)
        .order("full_name", { ascending: true });

      if (!empErr) setEmployees((empData || []) as AdminUser[]);

      // Load candidate orders
      const { data: orderData, error: orderErr } = await supabase
        .from("user_items")
        .select("id, product_id, customer_name, status, order_status, created_at, products(name)")
        .in("item_type", ["order", "reservation"])
        .order("created_at", { ascending: false })
        .limit(400);

      if (orderErr) {
        console.error("Failed to load orders", orderErr);
      } else {
        const allowed = new Set(["accepted", "approved", "in_production"]);
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
      }
    })();
  }, []);

  useEffect(() => {
    // Load team members + tasks for selected order
    (async () => {
      if (!selectedOrderId) {
        setTeamSelectionIds([]);
        setTasks([]);
        return;
      }

      const { data, error } = await supabase
        .from("order_team_members")
        .select("admin_id")
        .eq("user_item_id", selectedOrderId);

      if (error) {
        console.error("Failed to load order team", error);
        setTeamSelectionIds([]);
        setTasks([]);
        return;
      }

      const ids = (data || [])
        .map((r: unknown) => String((r as { admin_id?: unknown }).admin_id || ""))
        .filter(Boolean);
      setTeamSelectionIds(ids);

      setLoadingTasks(true);
      const { data: tData, error: tErr } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_item_id", selectedOrderId)
        .order("id", { ascending: true });
      if (tErr) {
        console.error("Failed to load tasks", tErr);
        setTasks([]);
      } else {
        setTasks((tData || []) as TaskRow[]);
      }
      setLoadingTasks(false);
    })();
  }, [selectedOrderId]);

  const saveTeam = async () => {
    if (!selectedOrderId) {
      alert("Please select an order first.");
      return;
    }
    if (teamSelectionIds.length === 0) {
      alert("Please select at least one employee.");
      return;
    }

    setTeamBusy(true);
    try {
      // Replace team membership for this order:
      // 1) delete existing
      const { error: delErr } = await supabase
        .from("order_team_members")
        .delete()
        .eq("user_item_id", selectedOrderId);
      if (delErr) throw delErr;

      // 2) insert selected
      const payload = teamSelectionIds.map((adminId) => ({
        user_item_id: selectedOrderId,
        admin_id: adminId,
        created_by_admin_id: adminSession?.id || null,
      }));

      const { error: insErr } = await supabase.from("order_team_members").insert(payload);
      if (insErr) throw insErr;

      alert("✅ Production team saved.");
    } catch (e: any) {
      console.error("saveTeam error", e);
      alert("❌ Failed to save team: " + (e?.message || "Unknown error"));
    } finally {
      setTeamBusy(false);
    }
  };

  const selectedOrder = useMemo(() => orders.find((o) => o.user_item_id === selectedOrderId) || null, [orders, selectedOrderId]);

  const teamEmployees = useMemo(() => {
    const set = new Set(teamSelectionIds);
    return employees.filter((e) => set.has(e.id));
  }, [employees, teamSelectionIds]);

  const startProduction = async () => {
    if (!selectedOrderId) {
      alert("Please select an order first.");
      return;
    }
    if (!isLeader) {
      alert("Only Superadmin / Team Leader can start production.");
      return;
    }

    setStartingProduction(true);
    try {
      const { data: ui, error: uiErr } = await supabase
        .from("user_items")
        .select("id, meta, progress_history")
        .eq("id", selectedOrderId)
        .single();
      if (uiErr || !ui) throw uiErr;

      const nowIso = new Date().toISOString();
      const meta = ((ui as { meta?: UserItemMeta }).meta || {}) as UserItemMeta;
      const history = Array.isArray((ui as { progress_history?: unknown }).progress_history)
        ? ((ui as { progress_history?: unknown[] }).progress_history as unknown[])
        : [];

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
        .eq("id", selectedOrderId);
      if (error) throw error;

      alert("✅ Production started (order moved to In Production). ");
    } catch (e: any) {
      console.error("startProduction error", e);
      alert("❌ Failed to start production: " + (e?.message || "Unknown error"));
    } finally {
      setStartingProduction(false);
    }
  };

  const createTask = async () => {
    if (!selectedOrderId || !selectedOrder) {
      alert("Please select an order first.");
      return;
    }

    // If the leader is already setting tasks, ensure the item is actually in production.
    // This matches the expected workflow: once a team is assigned + tasks created, production begins.
    const currentStage = String(selectedOrder.order_status || "");
    if (currentStage !== "in_production") {
      if (!isLeader) {
        alert("Only Superadmin / Team Leader can start production.");
        return;
      }
      const ok = window.confirm(
        `This order is currently '${currentStage || "(unknown)"}'. Start production now (move to In Production) before creating tasks?`
      );
      if (ok) {
        await startProduction();
      }
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
      const seq = tasks.length + 1;
      const short = selectedOrder.user_item_id.slice(0, 6).toUpperCase();
      const task_number = `ORD-${short}-${String(seq).padStart(2, "0")}`;

      const payload = {
        task_number,
        product_name: selectedOrder.product_name,
        task_name: newTask.task_name.trim(),
        user_item_id: selectedOrder.user_item_id,
        product_id: selectedOrder.product_id,
        assigned_admin_id: assignee.id,
        employee_name: assignee.full_name || assignee.username,
        employee_number: assignee.employee_number || "",
        start_date: newTask.start_date,
        due_date: newTask.due_date,
        status: "Pending",
      };

      const { error } = await supabase.from("tasks").insert([payload]);
      if (error) throw error;

      const { data: tData } = await supabase
        .from("tasks")
        .select("*")
        .eq("user_item_id", selectedOrderId)
        .order("id", { ascending: true });
      setTasks((tData || []) as TaskRow[]);

      setCreateModalOpen(false);
      setNewTask({
        task_name: "",
        assigned_admin_id: "",
        start_date: new Date().toISOString().slice(0, 10),
        due_date: "",
      });
      alert("✅ Task created.");
    } catch (e: any) {
      console.error("createTask error", e);
      alert("❌ Failed to create task: " + (e?.message || "Unknown error"));
    } finally {
      setCreatingTask(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link
          href="/dashboard/task/admintask"
          className="inline-flex items-center gap-2 bg-gray-200 text-gray-700 px-4 py-2 rounded-lg shadow hover:bg-gray-300 transition"
        >
          <ArrowLeft size={18} />
          Back to Review
        </Link>

        <div className="flex items-center gap-2">
          <Wrench className="text-blue-700" size={22} />
          <h1 className="text-2xl font-bold text-blue-700">Production Setup</h1>
        </div>
      </div>

      {!isLeader ? (
        <div className="mb-4 rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
          Only Superadmin / Team Leader should use this page.
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white shadow-lg rounded-xl p-6 border border-gray-200">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-gray-900">Select Order</div>
              <div className="text-xs text-gray-500">Pick an approved/accepted order to start production, set team, and create tasks.</div>
            </div>
            <button
              type="button"
              onClick={startProduction}
              disabled={!selectedOrderId || startingProduction || !isLeader}
              className="inline-flex items-center gap-2 rounded bg-black px-3 py-2 text-xs text-white disabled:opacity-50"
            >
              <PlayCircle size={16} />
              {startingProduction ? "Starting…" : "Start Production"}
            </button>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Order</label>
            <select
              value={selectedOrderId}
              onChange={(e) => setSelectedOrderId(e.target.value)}
              className="border p-2 rounded w-full text-gray-700"
            >
              <option value="">Select an order…</option>
              {orders.map((o) => (
                <option key={o.user_item_id} value={o.user_item_id}>
                  {o.product_name} • {o.customer_name || "(No customer name)"} • {o.order_status || ""} • {o.user_item_id.slice(0, 8)}…
                </option>
              ))}
            </select>
          </div>

          <div className="mt-5 rounded-lg border border-gray-200 p-4 bg-gray-50">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Users size={18} className="text-gray-700" />
                <div>
                  <div className="text-sm font-semibold text-gray-800">Production Team</div>
                  <div className="text-xs text-gray-500">Create the employee group working on this order.</div>
                </div>
              </div>
              <button
                type="button"
                onClick={saveTeam}
                disabled={teamBusy || !selectedOrderId || !isLeader}
                className="px-3 py-2 rounded bg-black text-white text-xs disabled:opacity-50"
              >
                {teamBusy ? "Saving…" : "Save Team"}
              </button>
            </div>

            {!selectedOrderId ? (
              <div className="mt-3 text-sm text-gray-600">Select an order to manage its team.</div>
            ) : (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-auto pr-1">
                {employees
                  .filter((e) => e.role !== "superadmin")
                  .map((e) => {
                    const label = (e.full_name || e.username) + (e.position ? ` • ${e.position}` : "");
                    const checked = teamSelectionIds.includes(e.id);
                    return (
                      <label key={e.id} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(ev) => {
                            setTeamSelectionIds((prev) => {
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
            )}

            {selectedOrderId && teamEmployees.length > 0 ? (
              <div className="mt-3 text-xs text-gray-600">Selected team members: {teamEmployees.length}</div>
            ) : null}
          </div>
        </div>

        <div className="bg-white shadow-lg rounded-xl p-6 border border-gray-200">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-gray-900">Tasks for this Order</div>
              <div className="text-xs text-gray-500">Assign tasks to employees; employees submit progress; leader approves to send updates to the customer.</div>
            </div>
            <button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              disabled={!selectedOrderId || !isLeader}
              className="inline-flex items-center gap-2 rounded bg-blue-700 px-3 py-2 text-xs text-white disabled:opacity-50"
            >
              <Plus size={16} />
              New Task
            </button>
          </div>

          {!selectedOrderId ? (
            <div className="mt-4 text-sm text-gray-600">Select an order to view and create tasks.</div>
          ) : loadingTasks ? (
            <div className="mt-4 text-sm text-gray-600">Loading tasks…</div>
          ) : tasks.length === 0 ? (
            <div className="mt-4 text-sm text-gray-600">No tasks yet.</div>
          ) : (
            <div className="mt-4 overflow-x-auto border rounded">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="p-2 text-left">Task #</th>
                    <th className="p-2 text-left">Task</th>
                    <th className="p-2 text-left">Assigned To</th>
                    <th className="p-2 text-left">Due</th>
                    <th className="p-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.id} className="border-t">
                      <td className="p-2 font-medium text-gray-800">{t.task_number}</td>
                      <td className="p-2 text-gray-700">{t.task_name}</td>
                      <td className="p-2 text-gray-700">{t.employee_name}</td>
                      <td className="p-2 text-gray-700">{t.due_date}</td>
                      <td className="p-2 text-gray-700">{t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !creatingTask && setCreateModalOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-xl p-6 z-10">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">Create Task</h2>
                <p className="text-sm text-gray-500">Order: {selectedOrderId ? selectedOrderId.slice(0, 10) + "…" : ""}</p>
              </div>
              <button
                className="text-gray-400 hover:text-gray-600"
                onClick={() => !creatingTask && setCreateModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <label className="text-sm font-medium text-gray-700">Task Name</label>
            <input
              className="mt-1 w-full border rounded p-2 text-sm"
              value={newTask.task_name}
              onChange={(e) => setNewTask((p) => ({ ...p, task_name: e.target.value }))}
              placeholder="e.g. Cut aluminum frame"
            />

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
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

            <div className="mt-4">
              <label className="text-sm font-medium text-gray-700">Assign To</label>
              <select
                className="mt-1 w-full border rounded p-2 text-sm"
                value={newTask.assigned_admin_id}
                onChange={(e) => setNewTask((p) => ({ ...p, assigned_admin_id: e.target.value }))}
              >
                <option value="">Select employee…</option>
                {teamEmployees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {(e.full_name || e.username) + (e.position ? ` • ${e.position}` : "")}
                  </option>
                ))}
              </select>
              {selectedOrderId && teamEmployees.length === 0 ? (
                <p className="text-xs text-red-600 mt-1">Select team members first (left panel), then save team.</p>
              ) : null}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded border px-4 py-2 text-sm"
                onClick={() => setCreateModalOpen(false)}
                disabled={creatingTask}
              >
                Cancel
              </button>
              <button
                className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                onClick={createTask}
                disabled={creatingTask || !isLeader}
              >
                {creatingTask ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
