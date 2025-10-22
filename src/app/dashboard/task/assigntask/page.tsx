"use client";

import { useState } from "react";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import { FilePlus2, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function AssignTaskPage() {
  const [form, setForm] = useState({
    task_number: "",
    product_name: "",
    task_name: "",
    employee_id: "",
    employee_name: "",
    employee_number: "",
    start_date: "",
    due_date: "",
    status: "Pending",
  });

  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const assignTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.from("tasks").insert([
      {
        task_number: form.task_number,
        product_name: form.product_name,
        task_name: form.task_name,
        employee_id: form.employee_id || null, // optional if not in schema
        employee_name: form.employee_name,
        employee_number: form.employee_number,
        start_date: form.start_date,
        due_date: form.due_date,
        status: form.status,
      },
    ]);

    setLoading(false);

    if (error) {
      console.error("❌ Insert failed:", error.message);
      alert("❌ Failed to assign task: " + error.message);
    } else {
      alert("✅ Task Assigned!");
      setForm({
        task_number: "",
        product_name: "",
        task_name: "",
        employee_id: "",
        employee_name: "",
        employee_number: "",
        start_date: "",
        due_date: "",
        status: "Pending",
      });
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Return Button */}
      <div className="mb-6">
        <Link
          href="/dashboard/task/admintask"
          className="inline-flex items-center gap-2 bg-gray-200 text-gray-700 px-4 py-2 rounded-lg shadow hover:bg-gray-300 transition"
        >
          <ArrowLeft size={18} />
          Return to Task Dashboard
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-6">
        <FilePlus2 className="text-blue-700" size={28} />
        <h1 className="text-3xl font-bold text-blue-700">Assign Task</h1>
      </div>

      <form
        onSubmit={assignTask}
        className="bg-white shadow-lg rounded-xl p-6 space-y-4 border border-gray-200"
      >
        <div className="grid grid-cols-2 gap-4">
          <input
            type="text"
            name="task_number"
            placeholder="Task Number"
            value={form.task_number}
            onChange={handleChange}
            className="border p-2 rounded w-full text-gray-700"
            required
          />
          <input
            type="text"
            name="product_name"
            placeholder="Product/Task Name"
            value={form.product_name}
            onChange={handleChange}
            className="border p-2 rounded w-full text-gray-700"
            required
          />
        </div>
        <input
          type="text"
          name="task_name"
          placeholder="Task Name"
          value={form.task_name}
          onChange={handleChange}
          className="border p-2 rounded w-full text-gray-700"
          required
        />
        <div className="grid grid-cols-2 gap-4">
          <input
            type="text"
            name="employee_name"
            placeholder="Employee Name"
            value={form.employee_name}
            onChange={handleChange}
            className="border p-2 rounded w-full text-gray-700"
            required
          />
          <input
            type="text"
            name="employee_number"
            placeholder="Employee Number"
            value={form.employee_number}
            onChange={handleChange}
            className="border p-2 rounded w-full text-gray-700"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <input
            type="date"
            name="start_date"
            value={form.start_date}
            onChange={handleChange}
            className="border p-2 rounded w-full text-gray-700"
            required
          />
          <input
            type="date"
            name="due_date"
            value={form.due_date}
            onChange={handleChange}
            className="border p-2 rounded w-full text-gray-700"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition shadow-md"
        >
          {loading ? "Assigning..." : "Assign Task"}
        </button>
      </form>
    </div>
  );
}
