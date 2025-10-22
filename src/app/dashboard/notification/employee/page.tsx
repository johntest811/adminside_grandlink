"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../Clients/Supabase/SupabaseClients";
import { Bell, FileText, Package, ClipboardList } from "lucide-react";

type Notification = {
  id: number;
  title: string;
  message: string;
  type: "report" | "stock" | "task";
  recipient_role: string;
  created_at: string;
  is_read: boolean;
};

export default function EmployeeNotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const userRole = "employee"; // 🔴 Replace with actual logged-in user's role

  // Fetch notifications
  const fetchNotifications = async () => {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .or(`recipient_role.eq.all,recipient_role.eq.${userRole}`)
      .order("created_at", { ascending: false });

    if (error) console.error(error);
    else setNotifications(data || []);
  };

  useEffect(() => {
    fetchNotifications();

    // ✅ Realtime subscription
    const channel = supabase
      .channel("notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          setNotifications((prev) => [payload.new as Notification, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Filter notifications by type
  const reports = notifications.filter((n) => n.type === "report");
  const stocks = notifications.filter((n) => n.type === "stock");
  const tasks = notifications.filter((n) => n.type === "task");

  const renderCard = (
    title: string,
    icon: React.ReactNode,
    items: Notification[],
    color: string
  ) => (
    <div className="bg-white shadow-md rounded-xl p-6 flex-1 border border-gray-200 hover:shadow-lg transition">
      <div className="flex items-center gap-2 mb-4">
        <div className={`p-2 rounded-full ${color}`}>{icon}</div>
        <h2 className="text-lg font-bold text-gray-800">{title}</h2>
      </div>
      {items.length === 0 ? (
        <p className="text-gray-500 text-sm">No {title.toLowerCase()} yet.</p>
      ) : (
        <ul className="space-y-3 max-h-72 overflow-y-auto pr-2">
          {items.map((n) => (
            <li
              key={n.id}
              className={`p-3 rounded-lg border ${
                n.is_read ? "bg-gray-50 border-gray-200" : "bg-red-50 border-red-200"
              }`}
            >
              <div className="flex justify-between items-start">
                <h3 className="font-semibold text-sm text-gray-800">{n.title}</h3>
                <span className="text-xs text-gray-500">
                  {new Date(n.created_at).toLocaleDateString()}
                </span>
              </div>
              <p className="text-gray-700 text-sm mt-1">{n.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Bell className="text-red-700" size={24} />
        <h1 className="text-2xl font-bold text-red-700">My Notifications</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {renderCard("Reports", <FileText className="text-red-700" />, reports, "bg-red-100")}
        {renderCard("Stocks", <Package className="text-green-700" />, stocks, "bg-green-100")}
        {renderCard("Tasks", <ClipboardList className="text-blue-700" />, tasks, "bg-blue-100")}
      </div>
    </div>
  );
}
