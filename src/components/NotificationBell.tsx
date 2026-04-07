"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

type NotificationSource = "db" | "recent_order";

type Notification = {
  id: string;
  title?: string;
  message: string;
  type: "stock" | "order" | "change" | "system" | "task" | "general";
  priority: "low" | "medium" | "high";
  recipient_role?: string;
  recipient_id?: string;
  is_read: boolean;
  created_at: string;
  source: NotificationSource;
  orderItemId?: string;
};

interface NotificationBellProps {
  adminId?: string;
  adminRole?: string;
}

export default function NotificationBell({ adminId, adminRole = "admin" }: NotificationBellProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    if (!adminId) {
      setNotifications([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      let query = supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false });

      if (!showAll) {
        const normalizedRole = (adminRole || "admin").toLowerCase();
        const filters: string[] = [
          "recipient_role.is.null",
          "recipient_role.eq.all",
          "recipient_role.eq.admin",
          "recipient_role.eq.Admin",
        ];

        if (normalizedRole && normalizedRole !== "admin") {
          filters.push(`recipient_role.eq.${normalizedRole}`);
        }

        if (adminRole && !["admin", "Admin"].includes(adminRole)) {
          filters.push(`recipient_role.eq.${adminRole}`);
        }

        filters.push(`recipient_id.eq.${adminId}`);
        query = query.or(filters.join(","));
      }

      query = query.limit(showAll ? 50 : 20);

      const { data, error } = await query;
      if (error) {
        console.error("Failed to fetch notifications", error);
        setNotifications([]);
        setUnreadCount(0);
        return;
      }

      const baseNotifications: Notification[] = ((data as any[]) || []).map((item) => ({
        id: String(item.id),
        title: item.title,
        message: String(item.message || ""),
        type: (item.type || "general") as Notification["type"],
        priority: (item.priority || "medium") as Notification["priority"],
        recipient_role: item.recipient_role || undefined,
        recipient_id: item.recipient_id || undefined,
        is_read: Boolean(item.is_read),
        created_at: String(item.created_at || new Date().toISOString()),
        source: "db",
      }));

      try {
        const recentRes = await fetch(`/api/recent-orders?limit=${showAll ? 50 : 20}`, {
          cache: "no-store",
        });

        if (recentRes.ok) {
          const recentJson = await recentRes.json();
          const recentOrders: Notification[] = ((recentJson?.items || []) as any[]).map((item) => ({
            id: String(item.id),
            title: item.title || "New Order",
            message: String(item.message || ""),
            type: "order",
            priority: (item.priority || "medium") as Notification["priority"],
            is_read: false,
            created_at: String(item.created_at || new Date().toISOString()),
            source: "recent_order",
            orderItemId: String(item.orderItemId || ""),
          }));

          const merged = [...recentOrders, ...baseNotifications];
          setNotifications(merged);
          setUnreadCount(merged.filter((item) => !item.is_read).length);
          return;
        }
      } catch (recentErr) {
        console.warn("Failed to fetch recent orders", recentErr);
      }

      setNotifications(baseNotifications);
      setUnreadCount(baseNotifications.filter((item) => !item.is_read).length);
    } catch (err) {
      console.error("Notification fetch error", err);
      setNotifications([]);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, [adminId, adminRole, showAll]);

  useEffect(() => {
    if (!adminId) return;

    void fetchNotifications();

    const channel = supabase
      .channel("notifications_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        void fetchNotifications();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [adminId, fetchNotifications]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const markAsRead = async (notification: Notification) => {
    if (notification.is_read) return;

    try {
      if (notification.source === "db") {
        const { error } = await supabase
          .from("notifications")
          .update({ is_read: true })
          .eq("id", notification.id);

        if (error) {
          console.error("Failed to mark notification as read", error);
          return;
        }
      }

      setNotifications((prev) =>
        prev.map((item) =>
          item.id === notification.id ? { ...item, is_read: true } : item
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Failed to mark notification as read", err);
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    await markAsRead(notification);

    if (notification.type === "order" && notification.orderItemId) {
      setIsOpen(false);
      router.push(`/dashboard/order_management?orderId=${encodeURIComponent(notification.orderItemId)}`);
    }
  };

  const markAllAsRead = async () => {
    const unreadNotifications = notifications.filter((item) => !item.is_read);
    if (!unreadNotifications.length) return;

    const unreadDbNotifications = unreadNotifications.filter((item) => item.source === "db");

    setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
    setUnreadCount(0);

    if (!unreadDbNotifications.length) return;

    await Promise.allSettled(
      unreadDbNotifications.map(async (notification) => {
        await supabase
          .from("notifications")
          .update({ is_read: true })
          .eq("id", notification.id);
      })
    );
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "stock":
        return "📦";
      case "order":
        return "🛒";
      case "change":
        return "📝";
      case "system":
        return "⚙️";
      case "task":
        return "✅";
      default:
        return "🔔";
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return "text-red-600 bg-red-50 border-red-200";
      case "medium":
        return "text-orange-600 bg-orange-50 border-orange-200";
      case "low":
        return "text-blue-600 bg-blue-50 border-blue-200";
      default:
        return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return "Just now";
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;

    return date.toLocaleDateString();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative rounded-full p-2 text-gray-400 transition-colors hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
        title="Notifications"
      >
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.25-1.25A2 2 0 0112 14.5H9a2 2 0 01-1.75 1.25L6 17h5m4 0v1a3 3 0 11-6 0v-1m6 0H9m6-7V7a3 3 0 00-6 0v3m6 0H9"
          />
        </svg>

        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 w-5 animate-pulse items-center justify-center rounded-full bg-red-500 text-xs font-medium text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 w-96 rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="border-b border-gray-200 px-4 py-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
              <div className="flex items-center space-x-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    Mark all read
                  </button>
                )}
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-medium text-white">
                  {unreadCount}
                </span>
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-gray-400 transition-colors hover:text-gray-600"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-500"></div>
                <p className="mt-2 text-sm text-gray-500">Loading notifications...</p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <div className="mb-2 text-4xl">🔔</div>
                <p className="text-lg font-medium">No notifications yet</p>
                <p className="text-sm">You'll see notifications here when they arrive</p>
              </div>
            ) : (
              <div className="space-y-1">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => void handleNotificationClick(notification)}
                    className={`cursor-pointer border-l-4 p-4 transition-colors hover:bg-gray-50 ${
                      notification.is_read ? "border-l-gray-200 bg-white" : "border-l-blue-500 bg-blue-50"
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <div
                        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border ${getPriorityColor(
                          notification.priority
                        )}`}
                      >
                        <span className="text-sm">{getNotificationIcon(notification.type)}</span>
                      </div>

                      <div className="min-w-0 flex-1">
                        {notification.title && (
                          <p
                            className={`truncate text-sm font-medium ${
                              notification.is_read ? "text-gray-700" : "text-gray-900"
                            }`}
                          >
                            {notification.title}
                          </p>
                        )}

                        <p
                          className={`mt-1 text-sm ${
                            notification.is_read ? "text-gray-500" : "text-gray-700"
                          }`}
                        >
                          {notification.message}
                        </p>

                        {notification.type === "order" && notification.orderItemId ? (
                          <p className="mt-1 text-xs font-medium text-indigo-600">
                            Click to open this order in Order Management
                          </p>
                        ) : null}

                        <div className="mt-2 flex items-center justify-between">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${getPriorityColor(
                              notification.priority
                            )}`}
                          >
                            {notification.priority} • {notification.type}
                          </span>

                          <span className="text-xs text-gray-400">{formatTimeAgo(notification.created_at)}</span>
                        </div>
                      </div>

                      {!notification.is_read && (
                        <div className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500"></div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {notifications.length > 0 && (
            <div className="border-t border-gray-200 px-4 py-3 text-center">
              <button
                onClick={() => setShowAll((prev) => !prev)}
                className="text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-800"
              >
                {showAll ? "Show My Notifications" : "Show All"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
