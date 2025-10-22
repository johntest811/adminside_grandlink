import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

export interface ActivityLogData {
  admin_id: string;
  admin_name: string;
  action: 'create' | 'update' | 'delete' | 'login' | 'logout' | 'upload' | 'view' | 'export' | 'import';
  entity_type: string;
  entity_id?: string;
  details: string;
  page?: string;
  metadata?: Record<string, any>;
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
}

export const logActivity = async (data: ActivityLogData) => {
  try {
    console.log("📝 Logging activity:", data);

    const activityData = {
      admin_id: data.admin_id,
      admin_name: data.admin_name,
      action: data.action,
      entity_type: data.entity_type,
      entity_id: data.entity_id || null,
      details: data.details,
      page: data.page || null,
      // Store as JSON (jsonb), not as string
      metadata: data.metadata ?? null,
      created_at: new Date().toISOString(),
    };

    const { data: result, error } = await supabase
      .from("activity_logs")
      .insert([activityData])
      .select();

    if (error) {
      console.error("❌ Failed to log activity:", error);
      return { success: false, error };
    }

    console.log("✅ Activity logged successfully:", result?.[0]);
    return { success: true, data: result?.[0] };
  } catch (error) {
    console.error("💥 Exception in logActivity:", error);
    return { success: false, error };
  }
};

// Helper to get current admin from localStorage or session
export const getCurrentAdmin = async (): Promise<{ id: string; username: string } | null> => {
  try {
    // First try localStorage
    const sessionData = localStorage.getItem('adminSession');
    if (sessionData) {
      const admin = JSON.parse(sessionData);
      return {
        id: admin.id || admin.admin_id || 'unknown',
        username: admin.username || admin.name || 'Unknown Admin'
      };
    }

    // Fallback to Supabase auth
    const { data: sessionUser } = await supabase.auth.getUser();
    if (sessionUser?.user?.id) {
      const { data: adminRow } = await supabase
        .from("admins")
        .select("id, username")
        .eq("id", sessionUser.user.id)
        .single();
      
      if (adminRow) {
        return {
          id: adminRow.id,
          username: adminRow.username || adminRow.id
        };
      }
    }
  } catch (error) {
    console.error("Error getting current admin:", error);
  }
  return null;
};

// Auto-log function that can be called from any page
export const autoLogActivity = async (
  action: ActivityLogData['action'],
  entity_type: string,
  details: string,
  options: Partial<ActivityLogData> = {}
) => {
  const admin = await getCurrentAdmin();
  if (!admin) {
    console.warn("⚠️ No admin found for auto-logging");
    return { success: false, error: "No admin found" };
  }

  return await logActivity({
    admin_id: admin.id,
    admin_name: admin.username,
    action,
    entity_type,
    details,
    ...options
  });
};

// Helper to detect changes between old and new objects
export const detectChanges = (oldObj: any, newObj: any): { changes: Record<string, { old: any; new: any }>, hasChanges: boolean } => {
  const changes: Record<string, { old: any; new: any }> = {};
  let hasChanges = false;

  const allKeys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);

  allKeys.forEach(key => {
    const oldValue = oldObj?.[key];
    const newValue = newObj?.[key];

    if (oldValue !== newValue && key !== 'updated_at' && key !== 'created_at') {
      changes[key] = { old: oldValue, new: newValue };
      hasChanges = true;
    }
  });

  return { changes, hasChanges };
};

// Format changes for display
export const formatChangesForDisplay = (changes: Record<string, { old: any; new: any }>): string => {
  const changeStrings = Object.entries(changes).map(([field, { old, new: newVal }]) => {
    return `${field}: "${old}" → "${newVal}"`;
  });
  return changeStrings.join(', ');
};

// Enhanced login activity logger
export const logLoginActivity = async (adminId: string, adminName: string) => {
  return await logActivity({
    admin_id: adminId,
    admin_name: adminName,
    action: 'login',
    entity_type: 'session',
    details: `Admin ${adminName} logged into the system`,
    page: 'login',
    metadata: {
      loginTime: new Date().toISOString(),
      userAgent: navigator.userAgent,
      loginMethod: 'credentials'
    }
  });
};

// Enhanced logout activity logger
export const logLogoutActivity = async (adminId: string, adminName: string) => {
  return await logActivity({
    admin_id: adminId,
    admin_name: adminName,
    action: 'logout',
    entity_type: 'session',
    details: `Admin ${adminName} logged out of the system`,
    page: 'logout',
    metadata: {
      logoutTime: new Date().toISOString(),
      sessionDuration: 'calculated'
    }
  });
};