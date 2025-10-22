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
  start_date: string;
  due_date: string;
  status: string;
};

export default function EmployeeTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("due_date");
    if (error) console.error(error);
    else setTasks(data || []);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <UserCheck className="text-green-700" size={28} />
        <h1 className="text-3xl font-bold text-green-700">My Tasks</h1>
      </div>

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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
