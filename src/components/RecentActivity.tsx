"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

type Activity = {
  id: string;
  admin_id: string;
  admin_name: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  details: string;
  page?: string;
  // Accept either jsonb object or legacy stringified JSON
  metadata?: any;
  created_at: string;
  is_read?: boolean;
};

interface RecentActivityProps {
  adminId?: string;
  limit?: number;
  showAsDropdown?: boolean;
}

export default function RecentActivity({ adminId, limit = 10, showAsDropdown = false }: RecentActivityProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Helper function to get read status from localStorage
  const getActivityReadStatus = useCallback((activityId: string): boolean => {
    try {
      const readActivities = JSON.parse(localStorage.getItem(`readActivities_${adminId}`) || '[]');
      return readActivities.includes(activityId);
    } catch {
      return false;
    }
  }, [adminId]);

  const fetchActivities = useCallback(async () => {
    if (!adminId) {
      console.log("⚠️ No adminId provided for fetching activities");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      console.log("📋 Fetching activities for admin:", adminId, "showAll:", showAll);
      
      let query = supabase
        .from('activity_logs')
        .select('*')
        .order('created_at', { ascending: false });

      // If showAll is false, only show current admin's activities
      if (!showAll && adminId) {
        query = query.eq('admin_id', adminId);
      }

      query = query.limit(showAll ? 100 : limit);
      
      const { data, error } = await query;
      
      if (error) {
        console.error('❌ Error fetching activities:', error);
        setActivities([]);
        return;
      }
      
      console.log("✅ Activities fetched:", data?.length || 0);
      
      // Add is_read property to activities
      const activitiesWithReadStatus = (data || []).map(activity => ({
        ...activity,
        is_read: getActivityReadStatus(activity.id)
      }));
      
      setActivities(activitiesWithReadStatus);
      
      // Count unread activities
      const unread = activitiesWithReadStatus.filter(a => !a.is_read).length;
      setUnreadCount(unread);
      console.log("📊 Unread activities:", unread);
      
    } catch (error) {
      console.error('💥 Error in fetchActivities:', error);
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [adminId, limit, showAll, getActivityReadStatus]);

  useEffect(() => {
    if (adminId) {
      fetchActivities();
      
      // Set up real-time subscription
      const channel = supabase
        .channel('activity_realtime')
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'activity_logs' 
        }, (payload) => {
          console.log('🔄 Real-time activity update received:', payload);
          fetchActivities();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [adminId, fetchActivities]);

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

  // Helper function to mark activity as read
  const markActivityAsRead = (activityId: string) => {
    try {
      const storageKey = `readActivities_${adminId}`;
      const readActivities = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (!readActivities.includes(activityId)) {
        readActivities.push(activityId);
        localStorage.setItem(storageKey, JSON.stringify(readActivities));
        
        // Update state
        setActivities(prev => prev.map(activity => 
          activity.id === activityId ? { ...activity, is_read: true } : activity
        ));
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error('Error marking activity as read:', error);
    }
  };

  // Mark all activities as read
  const markAllAsRead = async () => {
    try {
      const storageKey = `readActivities_${adminId}`;
      const allActivityIds = activities.map(activity => activity.id);
      localStorage.setItem(storageKey, JSON.stringify(allActivityIds));
      
      // Update state
      setActivities(prev => prev.map(activity => ({ ...activity, is_read: true })));
      setUnreadCount(0);
      
      console.log("✅ All activities marked as read");
    } catch (error) {
      console.error('❌ Error marking all activities as read:', error);
    }
  };

  const getActionIcon = (action: string) => {
    switch (action.toLowerCase()) {
      case 'create': return '➕';
      case 'update': return '✏️';
      case 'delete': return '🗑️';
      case 'login': return '🔑';
      case 'logout': return '🚪';
      case 'view': return '👀';
      case 'upload': return '📤';
      default: return '📝';
    }
  };

  const getActionColor = (action: string) => {
    switch (action.toLowerCase()) {
      case 'create': return 'text-green-600 bg-green-50 border-green-200';
      case 'update': return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'delete': return 'text-red-600 bg-red-50 border-red-200';
      case 'login': return 'text-purple-600 bg-purple-50 border-purple-200';
      case 'logout': return 'text-gray-600 bg-gray-50 border-gray-200';
      case 'view': return 'text-indigo-600 bg-indigo-50 border-indigo-200';
      case 'upload': return 'text-orange-600 bg-orange-50 border-orange-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
    
    return date.toLocaleDateString();
  };

  const parseMetadata = (metadata?: any) => {
    if (!metadata) return null;
    if (typeof metadata === 'string') {
      try {
        return JSON.parse(metadata);
      } catch {
        return null;
      }
    }
    // Already an object from jsonb
    return metadata;
  };

  // Dropdown/Popup version for navbar
  if (showAsDropdown) {
    return (
      <div className="relative" ref={dropdownRef}>
        {/* Activity Icon Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="relative p-2 text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 rounded-full transition-colors"
          title="Recent Activities"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>

          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center animate-pulse font-medium">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {isOpen && (
          <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
            <div className="px-4 py-3 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                  Recent Activities
                </h3>
                <div className="flex items-center space-x-2">
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
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <div className="p-6 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto"></div>
                  <p className="text-sm text-gray-500 mt-2">Loading activities...</p>
                </div>
              ) : activities.length === 0 ? (
                <div className="p-6 text-center text-gray-500">
                  <div className="text-4xl mb-2">📋</div>
                  <p className="text-lg font-medium">No recent activities</p>
                  <p className="text-sm">Your actions will appear here</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {activities.map((activity) => {
                    const metadata = parseMetadata(activity.metadata);

                    return (
                      <div
                        key={activity.id}
                        onClick={() => !activity.is_read && markActivityAsRead(activity.id)}
                        className={`p-4 hover:bg-gray-50 transition-colors cursor-pointer border-l-4 ${
                          activity.is_read
                            ? "bg-white border-l-gray-200"
                            : "bg-blue-50 border-l-blue-500"
                        }`}
                      >
                        <div className="flex items-start space-x-3">
                          <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${getActionColor(activity.action)}`}>
                            <span className="text-sm">{getActionIcon(activity.action)}</span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-gray-900">
                                  {activity.admin_name}
                                </span>
                                <span className="text-xs text-gray-500">
                                  performed {activity.action.toLowerCase()}
                                </span>
                                {activity.page && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                                    {activity.page}
                                  </span>
                                )}
                                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
                                  {activity.entity_type}
                                </span>
                                {activity.entity_id && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-200">
                                    id: {activity.entity_id}
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-gray-400 ml-2 whitespace-nowrap">
                                {formatTimeAgo(activity.created_at)}
                              </span>
                            </div>

                            <p className={`text-sm ${activity.is_read ? "text-gray-500" : "text-gray-700"}`}>
                              {activity.details}
                            </p>

                            {metadata && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {/* Common metadata quick chips */}
                                {'changesCount' in metadata && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                    changes: {metadata.changesCount}
                                  </span>
                                )}
                                {'fieldChanged' in metadata && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                    field: {String(metadata.fieldChanged)}
                                  </span>
                                )}
                                {'action' in metadata && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                                    {String(metadata.action)}
                                  </span>
                                )}
                                {'aboutId' in metadata && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                                    about: {String(metadata.aboutId)}
                                  </span>
                                )}
                                {'projectId' in metadata && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                                    project: {String(metadata.projectId)}
                                  </span>
                                )}
                                {'serviceId' in metadata && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                                    service: {String(metadata.serviceId)}
                                  </span>
                                )}
                                {'showroomId' in metadata && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                                    showroom: {String(metadata.showroomId)}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          {!activity.is_read && (
                            <div className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {activities.length > 0 && (
              <div className="px-4 py-3 border-t border-gray-200 text-center">
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  {showAll ? 'Show My Activities' : 'View All Activities'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Regular card version for dashboard pages
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Recent Activities</h3>
          <div className="flex items-center space-x-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              >
                Mark all read
              </button>
            )}
            <label className="flex items-center text-sm text-gray-600">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
                className="mr-2 rounded"
              />
              Show All
            </label>
            <span className="bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center font-medium">
              {unreadCount}
            </span>
          </div>
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="p-4">
            <div className="animate-pulse space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
                  <div className="flex-1">
                    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : activities.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <div className="text-4xl mb-2">📋</div>
            <p>No recent activities</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {activities.map((activity) => {
              const metadata = parseMetadata(activity.metadata);

              return (
                <div
                  key={activity.id}
                  onClick={() => !activity.is_read && markActivityAsRead(activity.id)}
                  className={`p-4 hover:bg-gray-50 transition-colors cursor-pointer ${
                    !activity.is_read ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3 flex-1">
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${getActionColor(activity.action)}`}>
                        <span className="text-sm">{getActionIcon(activity.action)}</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 mb-1 flex-wrap">
                          <span className="text-sm font-medium text-gray-900">{activity.admin_name}</span>
                          <span className="text-xs text-gray-500">performed {activity.action.toLowerCase()}</span>
                          {activity.page && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
                              {activity.page}
                            </span>
                          )}
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
                            {activity.entity_type}
                          </span>
                          {activity.entity_id && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-200">
                              id: {activity.entity_id}
                            </span>
                          )}
                        </div>

                        <p className="text-sm text-gray-600">
                          {activity.details}
                        </p>

                        {metadata && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {'changesCount' in metadata && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                                changes: {metadata.changesCount}
                              </span>
                            )}
                            {'fieldChanged' in metadata && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                field: {String(metadata.fieldChanged)}
                              </span>
                            )}
                            {'serviceId' in metadata && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                                service: {String(metadata.serviceId)}
                              </span>
                            )}
                            {'showroomId' in metadata && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                                showroom: {String(metadata.showroomId)}
                              </span>
                            )}
                            {'categoryName' in metadata && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                                category: {String(metadata.categoryName)}
                              </span>
                            )}
                            {'productName' in metadata && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                                product: {String(metadata.productName)}
                              </span>
                            )}
                            {'section' in metadata && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-700 border border-gray-200">
                                section: {String(metadata.section)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex-shrink-0 ml-4 text-right">
                      <p className="text-xs text-gray-500">
                        {formatTimeAgo(activity.created_at)}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {new Date(activity.created_at).toLocaleString()}
                      </p>
                      {!activity.is_read && (
                        <div className="w-2 h-2 bg-blue-500 rounded-full mt-1 ml-auto"></div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}