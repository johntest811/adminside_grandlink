"use client";

import { useEffect, useState } from "react";
import Link from "next/link"; // ✅ import Link for navigation
import { supabase } from "../../../Clients/Supabase/SupabaseClients";

type Task = {
  id: number;
  task_number: string;
  product_name: string;
  task_name: string;
  employee_name: string;
  employee_number: string;
  start_date: string;
  due_date: string;
  status: string;
};

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [newStatus, setNewStatus] = useState("");

  // Fetch tasks
  const fetchTasks = async () => {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("id", { ascending: true });
    if (!error && data) setTasks(data as Task[]);
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  // Update task status
  const updateStatus = async () => {
    if (!selectedTask) return;
    const { error } = await supabase
      .from("tasks")
      .update({ status: newStatus })
      .eq("id", selectedTask.id);

    if (error) {
      console.error("❌ Update failed:", error.message);
      alert("Failed to update status: " + error.message);
    } else {
      alert("✅ Status updated!");
      setSelectedTask(null);
      setNewStatus("");
      fetchTasks();
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-blue-700">
          📋 Admin Task Dashboard
        </h1>

      </div>

      {/* Task Table */}
      <div className="overflow-x-auto shadow-md rounded-lg border border-gray-200">
        <table className="w-full text-sm text-left text-gray-700">
          <thead className="bg-red-300 text-gray-800 font-semibold">
            <tr>
              <th className="px-4 py-2">Task #</th>
              <th className="px-4 py-2">Product/Task</th>
              <th className="px-4 py-2">Task Name</th>
              <th className="px-4 py-2">Employee</th>
              <th className="px-4 py-2">Employee #</th>
              <th className="px-4 py-2">Start</th>
              <th className="px-4 py-2">Due</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr
                key={task.id}
                className="border-t hover:bg-gray-50 transition"
              >
                <td className="px-4 py-2">{task.task_number}</td>
                <td className="px-4 py-2">{task.product_name}</td>
                <td className="px-4 py-2">{task.task_name}</td>
                <td className="px-4 py-2">{task.employee_name}</td>
                <td className="px-4 py-2">{task.employee_number}</td>
                <td className="px-4 py-2">{task.start_date}</td>
                <td className="px-4 py-2">{task.due_date}</td>
                <td className="px-4 py-2 font-semibold">{task.status}</td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => {
                      setSelectedTask(task);
                      setNewStatus(task.status);
                    }}
                    className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                  >
                    Edit Status
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Status Editor */}
      {selectedTask && (
        <div className="mt-6 p-4 bg-white border rounded-lg shadow-md">
          <h2 className="text-lg font-bold text-blue-700 mb-3">
            Update Status for Task #{selectedTask.task_number}
          </h2>
          <select
            className="border p-2 rounded w-64 mr-4"
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value)}
          >
            <option value="Pending">Pending</option>
            <option value="In Progress">In Progress</option>
            <option value="Completed">Completed</option>
            <option value="On Hold">On Hold</option>
          </select>
          <button
            onClick={updateStatus}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition"
          >
            Save
          </button>
          <button
            onClick={() => setSelectedTask(null)}
            className="ml-2 bg-gray-400 text-white px-4 py-2 rounded hover:bg-gray-500 transition"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
