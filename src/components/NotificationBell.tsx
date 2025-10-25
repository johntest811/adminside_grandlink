"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

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
};

interface NotificationBellProps {
  adminId?: string;
  adminRole?: string;
}

export default function NotificationBell({
  adminId,
  adminRole = "admin",
}: NotificationBellProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    if (!adminId) {
      console.log("⚠️ No adminId provided for notifications");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      console.log("🔔 Fetching notifications for admin:", adminId, "role:", adminRole);
      
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

        if (adminId) {
          filters.push(`recipient_id.eq.${adminId}`);
        }

        query = query.or(filters.join(","));
      }

      query = query.limit(showAll ? 50 : 20);

      const { data, error } = await query;

      if (error) {
        console.error("❌ Error fetching notifications:", error);
        setNotifications([]);
        setUnreadCount(0);
        return;
      }

      console.log("✅ Notifications fetched:", data?.length || 0);
      const baseNotifications = data || [];

      // Also fetch latest pending-payment reservations to surface in dropdown
      try {
        const res = await fetch(`/api/recent-orders?limit=${showAll ? 50 : 20}`, { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          const recentOrders: Notification[] = (json?.items || []).map((r: any) => ({
            id: r.id,
            title: r.title || "New Order",
            message: r.message,
            type: (r.type || "order") as any,
            priority: (r.priority || "medium") as any,
            is_read: false,
            created_at: r.created_at,
          }));

          // Merge: show recent orders first, then normal notifications
          const merged = [...recentOrders, ...baseNotifications];
          setNotifications(merged);
          const unread = merged.filter((n) => !n.is_read).length;
          setUnreadCount(unread);
        } else {
          // fallback: show base notifications only
          setNotifications(baseNotifications);
          const unread = baseNotifications.filter((n) => !n.is_read).length;
          setUnreadCount(unread);
        }
      } catch (e) {
        console.warn("⚠️ Could not fetch recent pending orders:", e);
        setNotifications(baseNotifications);
        const unread = baseNotifications.filter((n) => !n.is_read).length;
        setUnreadCount(unread);
      }

      const unread = (baseNotifications || []).filter((n) => !n.is_read).length;
      setUnreadCount(unread);
      console.log("📊 Unread notifications:", unread);
    } catch (error) {
      console.error("💥 Error in fetchNotifications:", error);
      setNotifications([]);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, [adminId, adminRole, showAll]);

  useEffect(() => {
    if (adminId) {
      fetchNotifications();

      // Set up real-time subscription
      const channel = supabase
        .channel("notifications_realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications" },
          () => {
            console.log("🔔 Real-time notification update received");
            fetchNotifications();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [adminId, fetchNotifications]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const markAsRead = async (notificationId: string) => {
    try {
      console.log("📖 Marking notification as read:", notificationId);
      
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notificationId);

      if (error) {
        console.error("❌ Error marking notification as read:", error);
        return;
      }

      // Update local state immediately
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId ? { ...n, is_read: true } : n
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      console.log("✅ Notification marked as read successfully");
    } catch (error) {
      console.error("💥 Error marking notification as read:", error);
    }
  };

  // Simplified Mark All As Read - Individual Updates Approach
  const markAllAsRead = async () => {
    try {
      console.log("📚 Starting mark all as read process...");
      
      // Get current unread notifications
      const unreadNotifications = notifications.filter(n => !n.is_read);
      console.log("📋 Unread notifications to mark:", unreadNotifications.length);
      
      if (unreadNotifications.length === 0) {
        console.log("ℹ️ No unread notifications to mark as read");
        return;
      }

      // Update UI immediately for better UX
      setNotifications(prev => prev.map(notification => 
        !notification.is_read 
          ? { ...notification, is_read: true } 
          : notification
      ));
      setUnreadCount(0);
      console.log("✅ UI updated immediately");

      // Try to update database in background using individual updates
      let successCount = 0;
      const updatePromises = unreadNotifications.map(async (notification) => {
        try {
          const { error } = await supabase
            .from("notifications")
            .update({ is_read: true })
            .eq("id", notification.id);
          
          if (!error) {
            successCount++;
            console.log(`✅ Updated notification ${notification.id}`);
          } else {
            console.warn(`⚠️ Failed to update notification ${notification.id}:`, error);
          }
        } catch (err) {
          console.warn(`⚠️ Exception updating notification ${notification.id}:`, err);
        }
      });

      // Wait for all updates to complete
      await Promise.allSettled(updatePromises);
      
      console.log(`📊 Database sync: ${successCount}/${unreadNotifications.length} notifications updated`);
      
      if (successCount < unreadNotifications.length) {
        console.warn(`⚠️ Only ${successCount} of ${unreadNotifications.length} notifications were updated in database`);
      }

    } catch (error) {
      console.error("💥 Exception in markAllAsRead:", error);
      
      // If there's a major error, still keep UI updated but log the issue
      console.log("🔄 Keeping UI state updated despite database error");
    }
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
      {/* Bell Icon Button */}
      <button
        onClick={() => {
          console.log("🔔 Notification bell clicked, current state:", isOpen);
          setIsOpen(!isOpen);
        }}
        className="relative p-2 text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 rounded-full transition-colors"
        title="Notifications"
      >
        {/* Bell Icon SVG */}
        <svg
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.25-1.25A2 2 0 0112 14.5H9a2 2 0 01-1.75 1.25L6 17h5m4 0v1a3 3 0 11-6 0v-1m6 0H9m6-7V7a3 3 0 00-6 0v3m6 0H9"
          />
        </svg>

        {/* Unread Count Badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center animate-pulse font-medium">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                Notifications
              </h3>
              <div className="flex items-center space-x-2">
                {/* Mark All as Read Button */}
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    Mark all read
                  </button>
                )}
                <span className="bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-medium">
                  {unreadCount}
                </span>
                <button
                  onClick={() => setIsOpen(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
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

          {/* Notifications List */}
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto"></div>
                <p className="text-sm text-gray-500 mt-2">Loading notifications...</p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                <div className="text-4xl mb-2">🔔</div>
                <p className="text-lg font-medium">No notifications yet</p>
                <p className="text-sm">You'll see notifications here when they arrive</p>
              </div>
            ) : (
              <div className="space-y-1">
                {notifications.map((notification) => (
                  <div
                    key={notification.id}
                    onClick={() => !notification.is_read && markAsRead(notification.id)}
                    className={`p-4 hover:bg-gray-50 transition-colors cursor-pointer border-l-4 ${
                      notification.is_read
                        ? "bg-white border-l-gray-200"
                        : "bg-blue-50 border-l-blue-500"
                    }`}
                  >
                    <div className="flex items-start space-x-3">
                      <div
                        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${getPriorityColor(
                          notification.priority
                        )}`}
                      >
                        <span className="text-sm">
                          {getNotificationIcon(notification.type)}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        {notification.title && (
                          <p
                            className={`text-sm font-medium ${
                              notification.is_read
                                ? "text-gray-700"
                                : "text-gray-900"
                            } truncate`}
                          >
                            {notification.title}
                          </p>
                        )}

                        <p
                          className={`text-sm ${
                            notification.is_read
                              ? "text-gray-500"
                              : "text-gray-700"
                          } mt-1`}
                        >
                          {notification.message}
                        </p>

                        <div className="flex items-center justify-between mt-2">
                          <span
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${getPriorityColor(
                              notification.priority
                            )}`}
                          >
                            {notification.priority} • {notification.type}
                          </span>

                          <span className="text-xs text-gray-400">
                            {formatTimeAgo(notification.created_at)}
                          </span>
                        </div>
                      </div>

                      {!notification.is_read && (
                        <div className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer - Show All functionality */}
          {notifications.length > 0 && (
            <div className="px-4 py-3 border-t border-gray-200 text-center">
              <button
                onClick={() => {
                  setShowAll(!showAll);
                  // Keep dropdown open to show the updated list
                }}
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
              >
                {showAll ? 'Show My Notifications' : 'Show All'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}