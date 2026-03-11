// Admin-side notification helper to communicate with user-side API

function normalizeBaseUrl(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/$/, "");
}

function buildNotifyUrl(requestUrl?: string) {
  if (requestUrl) {
    return new URL("/api/notify", requestUrl).toString();
  }

  if (typeof window !== "undefined") {
    return "/api/notify";
  }

  const base =
    normalizeBaseUrl(process.env.NEXT_PUBLIC_BASE_URL) ||
    normalizeBaseUrl(process.env.BASE_URL) ||
    normalizeBaseUrl(process.env.SITE_URL) ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null) ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
    normalizeBaseUrl(process.env.NEXT_PUBLIC_SITE_URL) ||
    (process.env.NODE_ENV === "development" ? "http://localhost:3000" : null);

  if (!base) {
    throw new Error(
      "Cannot call /api/notify from server without a base URL. Set NEXT_PUBLIC_BASE_URL (or pass requestUrl)."
    );
  }

  return `${base}/api/notify`;
}

export const adminNotificationService = {
  // Notify users about new products
  async notifyNewProduct(productName: string, productId: string, adminName: string, requestUrl?: string) {
    try {
      const response = await fetch(buildNotifyUrl(requestUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'new_product', productName, productId, adminName }),
      });
      const result = await response.json();
      if (response.ok && result.success) return { success: true, message: result.message };
      console.error("❌ Failed to send new product notification:", result.error);
      return { success: false, error: result.error };
    } catch (error) {
      console.error("💥 Error sending new product notification:", error);
      return { success: false, error };
    }
  },

  // Notify users about stock updates
  async notifyStockUpdate(productName: string, productId: string, newStock: number, adminName: string, requestUrl?: string) {
    try {
      const response = await fetch(buildNotifyUrl(requestUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'stock_update', productName, productId, newStock, adminName }),
      });
      const result = await response.json();
      if (response.ok && result.success) return { success: true, message: result.message };
      console.error("❌ Failed to send stock update notification:", result.error);
      return { success: false, error: result.error };
    } catch (error) {
      console.error("💥 Error sending stock update notification:", error);
      return { success: false, error };
    }
  },

  // Notify user about order status update (called from admin side)
  async notifyOrderStatusUpdate(orderId: string, userId: string, newStatus: string, adminName: string, productName: string, requestUrl?: string) {
    try {
      // FIX: call local admin API (server → server) to avoid browser CORS/network issues
      const response = await fetch(buildNotifyUrl(requestUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'order_status',
          userItemId: orderId,
          newStatus,
          adminName,
          productName,
          // The admin app updates the DB already; website should only notify
          skipUpdate: true
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error("❌ Failed to forward order status notification:", result?.error || response.statusText);
        return { success: false, error: result?.error || response.statusText };
      }
      return { success: true, message: result?.message || 'Notification processed' };
    } catch (error: any) {
      console.error("💥 Error sending order status notification:", error);
      return { success: false, error: error.message || String(error) };
    }
  },
};