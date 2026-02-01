"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import { UserCheck } from "lucide-react";

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

export default function EmployeeTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [progressModal, setProgressModal] = useState<{ task: Task } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [progressFiles, setProgressFiles] = useState<File[]>([]);
  const [myRecentUpdates, setMyRecentUpdates] = useState<Record<number, TaskUpdate[]>>({});
  const [updatingStatusId, setUpdatingStatusId] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("adminSession");
      if (raw) setAdminSession(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminSession?.id]);

  const fetchTasks = async () => {
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
      await fetchTasks();
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
      await fetchTasks();
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
        <UserCheck className="text-green-700" size={28} />
        <h1 className="text-3xl font-bold text-green-700">My Tasks</h1>
      </div>

      {!adminSession?.id && (
        <div className="mb-4 rounded border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-900">
          You're not logged in as an admin employee. Tasks will not be filtered.
        </div>
      )}

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
                className={`hover:bg-gray-50 ${
                  idx % 2 === 0 ? "bg-white" : "bg-gray-50"
                }`}
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
