import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

export type NotificationType = "stock" | "order" | "change" | "system" | "task" | "general";

export async function createNotification(params: {
  title?: string | null;
  message: string;
  recipient_role?: string | null;
  recipient_id?: string | null;
  type?: NotificationType;
  priority?: "low" | "medium" | "high";
}) {
  try {
    console.log("🔔 Creating notification:", params);
    
    // Fix: Ensure recipient_role matches database constraint (lowercase)
    let recipientRole = params.recipient_role || "all";
    
    // Normalize role to match database constraints
    switch (recipientRole.toLowerCase()) {
      case "admin":
      case "administrator":
        recipientRole = "admin";
        break;
      case "manager":
        recipientRole = "manager";
        break;
      case "employee":
        recipientRole = "employee";
        break;
      default:
        recipientRole = "all";
        break;
    }
    
    const payload = {
      title: params.title || "System Notification",
      message: params.message,
      type: params.type || "general",
      recipient_role: recipientRole, // Now properly normalized
      recipient_id: params.recipient_id || null,
      priority: params.priority || "medium",
      is_read: false,
      created_at: new Date().toISOString(),
    };
    
    console.log("📋 Notification payload:", payload);
    
    const { data, error } = await supabase
      .from("notifications")
      .insert([payload])
      .select();
    
    if (error) {
      console.error("❌ createNotification error:", error);
      console.error("❌ Error details:", JSON.stringify(error, null, 2));
      return { success: false, error };
    }
    
    console.log("✅ Notification created successfully:", data);
    return { success: true, data };
  } catch (err) {
    console.error("💥 createNotification exception:", err);
    return { success: false, error: err };
  }
}

// Safe notification wrapper - won't break app if notification fails
export async function safeCreateNotification(params: {
  title?: string | null;
  message: string;
  recipient_role?: string | null;
  recipient_id?: string | null;
  type?: NotificationType;
  priority?: "low" | "medium" | "high";
}) {
  try {
    const result = await createNotification(params);
    if (!result.success) {
      console.warn("⚠️ Notification creation failed but continuing:", result.error);
    }
    return result;
  } catch (error) {
    console.warn("⚠️ Notification creation exception but continuing:", error);
    return { success: false, error };
  }
}

// Enhanced stock check with notifications
export async function checkLowStockAlerts() {
  try {
    console.log("🔍 Checking for low stock alerts...");
    
    const { data: products, error } = await supabase
      .from("products")
      .select("id, name, inventory, category")
      .or("inventory.is.null,inventory.lte.5");

    if (error) {
      console.error("❌ Error fetching products for stock check:", error);
      return;
    }

    if (!products || products.length === 0) {
      console.log("✅ No low stock products found");
      return;
    }

    console.log(`📦 Found ${products.length} products with low/no stock`);

    for (const product of products) {
      const inventory = product.inventory ?? 0;
      
      if (inventory === 0) {
        await safeCreateNotification({
          title: "Out of Stock Alert",
          message: `Product "${product.name}" (${product.category}) is out of stock!`,
          recipient_role: "admin", // Fixed: using lowercase
          type: "stock",
          priority: "high",
        });
      } else if (inventory <= 2) {
        await safeCreateNotification({
          title: "Critical Stock Alert",
          message: `Product "${product.name}" (${product.category}) is critically low (${inventory} remaining)`,
          recipient_role: "admin", // Fixed: using lowercase
          type: "stock",
          priority: "high",
        });
      } else if (inventory <= 5) {
        await safeCreateNotification({
          title: "Low Stock Alert",
          message: `Product "${product.name}" (${product.category}) has only ${inventory} items left`,
          recipient_role: "admin", // Fixed: using lowercase
          type: "stock",
          priority: "medium",
        });
      }
    }
    
    console.log("✅ Stock alerts check completed");
  } catch (e) {
    console.error("💥 checkLowStockAlerts exception:", e);
  }
}

// Inventory change notifications
export async function notifyInventoryChange(productName: string, oldQty: number, newQty: number, adminName: string) {
  try {
    const change = newQty - oldQty;
    const changeText = change > 0 ? `increased by ${change}` : `decreased by ${Math.abs(change)}`;
    
    await safeCreateNotification({
      title: "Inventory Updated",
      message: `Inventory for "${productName}" ${changeText} (${oldQty} → ${newQty}) by ${adminName}`,
      recipient_role: "admin", // Fixed: using lowercase
      type: "change",
      priority: "low",
    });
  } catch (e) {
    console.error("💥 notifyInventoryChange exception:", e);
  }
}

// Product creation notification
export async function notifyProductCreated(productName: string, adminName: string, category?: string) {
  try {
    await safeCreateNotification({
      title: "New Product Added",
      message: `Product "${productName}" ${category ? `in ${category}` : ''} was created by ${adminName}`,
      recipient_role: "admin", // Fixed: using lowercase
      type: "change",
      priority: "medium",
    });
  } catch (e) {
    console.error("💥 notifyProductCreated exception:", e);
  }
}

// Product update notification  
export async function notifyProductUpdated(productName: string, adminName: string, changesCount: number, changes: string[]) {
  try {
    const changesSummary = changes.slice(0, 3).join(", ") + (changes.length > 3 ? `... and ${changes.length - 3} more` : "");
    
    const { error } = await supabase
      .from('notifications')
      .insert([
        {
          title: 'Product Updated',
          message: `Product "${productName}" was updated by ${adminName}. Changes: ${changesSummary}`,
          type: 'general',
          recipient_role: 'all',
          priority: 'medium',
          is_read: false,
          created_at: new Date().toISOString()
        }
      ]);

    if (error) {
      console.error('Error creating product update notification:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Exception creating product update notification:', error);
    return false;
  }
}

export async function notifyProductFileUploaded(productName: string, adminName: string, fileType: string, fileName: string) {
  try {
    const { error } = await supabase
      .from('notifications')
      .insert([
        {
          title: 'Product File Uploaded',
          message: `${fileType.toUpperCase()} file "${fileName}" was uploaded for product "${productName}" by ${adminName}`,
          type: 'general',
          recipient_role: 'all',
          priority: 'low',
          is_read: false,
          created_at: new Date().toISOString()
        }
      ]);

    if (error) {
      console.error('Error creating file upload notification:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Exception creating file upload notification:', error);
    return false;
  }
}

// Product deletion notification
export async function notifyProductDeleted(productName: string, adminName: string) {
  try {
    const { error } = await supabase
      .from('notifications')
      .insert([
        {
          title: 'Product Deleted',
          message: `Product "${productName}" was deleted by ${adminName}`,
          type: 'general',
          recipient_role: 'all',
          priority: 'high',
          is_read: false,
          created_at: new Date().toISOString()
        }
      ]);

    if (error) {
      console.error('Error creating product deletion notification:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Exception creating product deletion notification:', error);
    return false;
  }
}

// Generic activity notifications
export async function notifyActivity(title: string, message: string, type: NotificationType = "change", priority: "low" | "medium" | "high" = "medium") {
  try {
    await safeCreateNotification({
      title,
      message,
      recipient_role: "admin", // Fixed: using lowercase
      type,
      priority,
    });
  } catch (e) {
    console.error("💥 notifyActivity exception:", e);
  }
}