import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function listAllAuthUsers(perPage = 200) {
  const users: Array<{ id: string; email?: string | null }> = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...(data.users as Array<{ id: string; email?: string | null }>));
    if (!data.users || data.users.length < perPage) break;
    page += 1;
  }

  return users;
}

let mailTransporter: nodemailer.Transporter | null = null;

let primaryGmailQuotaExceeded = false;
let backupGmailQuotaExceeded = false;

function hasPrimaryGmailConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_PASS);
}

function hasBackupGmailConfigured() {
  return Boolean(process.env.GMAIL_BACKUP_USER && process.env.GMAIL_BACKUP_PASS);
}

function getOrCreatePrimaryGmailTransporter() {
  if (!hasPrimaryGmailConfigured()) return null;
  if (mailTransporter) return mailTransporter;

  mailTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS!.replace(/\s+/g, ""),
    },
  });
  return mailTransporter;
}

function createBackupGmailTransporter() {
  if (!hasBackupGmailConfigured()) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_BACKUP_USER,
      pass: process.env.GMAIL_BACKUP_PASS!.replace(/\s+/g, ""),
    },
  });
}

function hasAnyEmailProviderConfigured() {
  return hasPrimaryGmailConfigured() || hasBackupGmailConfigured();
}

function shouldRetryWithBackupProvider(err: any) {
  const message = String(err?.message || err || "").toLowerCase();
  const responseCode = Number(err?.responseCode || err?.statusCode || 0);

  // Likely permanent failures (do not retry on backup sender)
  if ([550, 551, 552, 553, 554].includes(responseCode)) return false;
  if (message.includes("invalid") && message.includes("address")) return false;
  if (message.includes("no such user")) return false;
  if (message.includes("recipient")) return false;

  return true;
}

function isGmailQuotaExceeded(err: any) {
  const message = String(err?.message || err || "").toLowerCase();
  const response = String(err?.response || "").toLowerCase();
  const responseCode = Number(err?.responseCode || 0);

  // Common Gmail quota / rate limit signals.
  if (message.includes("quota")) return true;
  if (message.includes("daily user sending quota exceeded")) return true;
  if (message.includes("rate limit")) return true;
  if (message.includes("too many login attempts")) return true;
  if (response.includes("daily user sending quota exceeded")) return true;
  if ([421, 450, 451, 452, 454].includes(responseCode)) return true;
  return false;
}

async function sendEmail(options: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}): Promise<{ sent: boolean; provider: string | null; error?: string }> {
  const { to, subject, text, html } = options;

  // 1) Gmail primary
  const primary = primaryGmailQuotaExceeded ? null : getOrCreatePrimaryGmailTransporter();
  if (primary) {
    try {
      await primary.sendMail({
        from: process.env.GMAIL_FROM || process.env.GMAIL_USER!,
        to,
        subject,
        text,
        html,
      });
      return { sent: true, provider: "gmail_primary" };
    } catch (err: any) {
      console.error("Primary Gmail send failed:", err);
      if (isGmailQuotaExceeded(err)) {
        primaryGmailQuotaExceeded = true;
      }
      if (!shouldRetryWithBackupProvider(err)) {
        return { sent: false, provider: "gmail_primary", error: err?.message || String(err) };
      }
      // else fall through to backup
    }
  }

  // 2) Gmail backup
  const backup = backupGmailQuotaExceeded ? null : createBackupGmailTransporter();
  if (backup) {
    try {
      await backup.sendMail({
        from: process.env.GMAIL_BACKUP_FROM || process.env.GMAIL_BACKUP_USER!,
        to,
        subject,
        text,
        html,
      });
      return { sent: true, provider: "gmail_backup" };
    } catch (err: any) {
      console.error("Backup Gmail send failed:", err);
      if (isGmailQuotaExceeded(err)) {
        backupGmailQuotaExceeded = true;
      }
      return { sent: false, provider: "gmail_backup", error: err?.message || String(err) };
    }
  }

  return {
    sent: false,
    provider: null,
    error: hasAnyEmailProviderConfigured()
      ? "Email providers are misconfigured (missing credentials)."
      : "No email provider configured.",
  };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // avoid caching for webhooks/notifications
export const maxDuration = 60;

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<{ succeeded: number; failed: number }> {
  const effectiveConcurrency = Math.max(1, Math.floor(concurrency || 1));
  let index = 0;
  let succeeded = 0;
  let failed = 0;

  const runners = Array.from({ length: Math.min(effectiveConcurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      const item = items[currentIndex];
      try {
        await worker(item);
        succeeded += 1;
      } catch {
        failed += 1;
      }
    }
  });

  await Promise.all(runners);
  return { succeeded, failed };
}

type UserPreferenceRow = {
  user_id: string;
  new_product_notifications?: boolean | null;
  stock_update_notifications?: boolean | null;
  email_notifications?: boolean | null;
};

async function getPreferencesByUserId(
  userIds: string[]
): Promise<Map<string, UserPreferenceRow>> {
  const map = new Map<string, UserPreferenceRow>();
  if (userIds.length === 0) return map;

  // Keep chunks reasonably small to avoid URL/query limits.
  for (const idsChunk of chunkArray(userIds, 500)) {
    const { data, error } = await supabaseAdmin
      .from("user_notification_preferences")
      .select("user_id,new_product_notifications,stock_update_notifications,email_notifications")
      .in("user_id", idsChunk);

    if (error) {
      console.warn("Failed to fetch notification preferences chunk:", error);
      continue;
    }

    for (const row of (data || []) as UserPreferenceRow[]) {
      if (row?.user_id) map.set(row.user_id, row);
    }
  }

  return map;
}

function normalizeBaseUrl(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/$/, "");
}

function getWebsiteBaseCandidates() {
  const candidates = [
    process.env.NEXT_PUBLIC_USER_WEBSITE_URL,
    process.env.NEXT_PUBLIC_WEBSITE_URL,
    process.env.WEBSITE_URL,
    process.env.WEBSITE_PUBLIC_URL,
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
    "http://localhost:3000",
    "https://grandlink-website.vercel.app",
    "https://grandlnik-website.vercel.app",
  ]
    .map((value) => normalizeBaseUrl(value))
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(candidates));
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const { type, productName, productId, adminName, newStock } = payload || {};

    if (type === "order_status" || (payload?.userItemId && payload?.newStatus)) {
      const userItemId = payload?.userItemId;
      const newStatus = payload?.newStatus;
      if (!userItemId || !newStatus) {
        return NextResponse.json({ success: false, error: "Missing userItemId or newStatus" }, { status: 400 });
      }

      // Only proxy "approved" to website (invoice flow lives there).
      // All other status updates are handled locally so email notifications work
      // even if the website project env isn't configured.
      if (String(newStatus) === "approved") {
        const websiteBases = getWebsiteBaseCandidates();

        for (const websiteBase of websiteBases) {
          try {
            const websiteResponse = await fetch(`${websiteBase}/api/update-order-status`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                userItemId,
                newStatus,
                adminName: payload?.adminName || null,
                adminNotes: payload?.adminNotes || null,
                estimatedDeliveryDate: payload?.estimatedDeliveryDate || null,
                skipUpdate: true,
              }),
              cache: "no-store",
            });

            const websiteJson = await websiteResponse.json().catch(() => ({}));
            if (websiteResponse.ok) {
              return NextResponse.json({
                success: true,
                proxied: true,
                websiteBase,
                message: websiteJson?.message || "Notification processed",
                invoiceEmailSent: websiteJson?.invoiceEmailSent || false,
              });
            }

            console.warn(
              `Website order-status proxy failed for ${websiteBase}, trying next candidate:`,
              websiteJson?.error || websiteResponse.statusText
            );
          } catch (proxyError) {
            console.warn(`Website order-status proxy error for ${websiteBase}, trying next candidate:`, proxyError);
          }
        }
      }

      const { data: orderData, error: orderErr } = await supabaseAdmin
        .from("user_items")
        .select("*")
        .eq("id", userItemId)
        .single();

      if (orderErr || !orderData) {
        console.error("Order fetch error:", orderErr);
        return NextResponse.json({ success: false, error: "Order not found" }, { status: 404 });
      }

      const { data: productData } = await supabaseAdmin
        .from("products")
        .select("name")
        .eq("id", orderData.product_id)
        .single();

      const productName = payload?.productName || orderData.meta?.product_name || productData?.name || "Your Order";
      const statusDisplay = String(newStatus).replace(/_/g, " ").toUpperCase();
      const statusMessages: Record<string, string> = {
        pending_payment: "Your order is awaiting payment confirmation.",
        reserved: "Your order has been reserved and payment confirmed.",
        pending_balance_payment: "Please settle the remaining balance so we can continue processing your order.",
        approved: "Your order has been approved and will begin production soon.",
        in_production: "Your order is currently being manufactured.",
        quality_check: "Your order is undergoing quality inspection.",
        start_packaging: "Your order is being packaged.",
        packaging: "Your order is being packaged.",
        ready_for_delivery: "Your order is ready for delivery! We will contact you soon.",
        out_for_delivery: "Your order is on its way to you!",
        completed: "Your order has been completed successfully. Thank you for choosing Grand Link!",
        cancelled: "Your order has been cancelled. If you have any questions, please contact us.",
        pending_cancellation: "Your cancellation request is being processed.",
      };

      const message = statusMessages[newStatus] || `Your order status has been updated to: ${statusDisplay}`;
      const now = new Date().toISOString();
      const adminName = payload?.adminName || null;

      const { data: userWrap } = await supabaseAdmin.auth.admin.getUserById(orderData.user_id);
      const userEmail = userWrap?.user?.email || null;

      const { data: preferences } = await supabaseAdmin
        .from("user_notification_preferences")
        .select("*")
        .eq("user_id", orderData.user_id)
        .single();

      const shouldSendInApp = preferences?.order_status_notifications !== false;
      const shouldSendEmail = preferences?.email_notifications !== false;

      let notificationInserted = false;
      if (shouldSendInApp) {
        const { error: notifError } = await supabaseAdmin.from("user_notifications").insert({
          user_id: orderData.user_id,
          title: `Order Status: ${statusDisplay}`,
          message: `${productName} - ${message}`,
          type: "order_status",
          metadata: {
            order_id: userItemId,
            product_id: orderData.product_id,
            product_name: productName,
            new_status: newStatus,
            admin_name: adminName,
          },
          action_url: "/profile/order",
          order_id: userItemId,
          is_read: false,
          created_at: now,
        });

        if (!notifError) {
          notificationInserted = true;
        } else {
          console.error("Failed to insert user notification:", notifError);
        }
      }

      let emailSent = false;
      let emailProvider: string | null = null;
      if (shouldSendEmail && userEmail) {
        try {
          const result = await sendEmail({
            to: userEmail,
            subject: `Order Status: ${statusDisplay}`,
            html: `<p>${message}</p><p>Order ID: ${userItemId}</p>`,
          });
          emailSent = result.sent;
          emailProvider = result.provider;
        } catch (mailErr) {
          console.error("Email send failed:", mailErr);
        }
      }

      await supabaseAdmin.from("email_notifications").insert({
        recipient_email: userEmail,
        subject: `Order Status: ${statusDisplay}`,
        message: `${productName} - ${message}`,
        notification_type: "order_status",
        related_entity_type: "user_items",
        related_entity_id: userItemId,
        status: emailSent ? "sent" : shouldSendEmail && userEmail ? "pending" : "skipped",
        created_at: now,
      });

      return NextResponse.json({
        success: true,
        notified: {
          inApp: notificationInserted,
          emailSent,
          emailProvider,
        },
        emailProvidersConfigured: {
          primary: hasPrimaryGmailConfigured(),
          backup: hasBackupGmailConfigured(),
        },
      });
    }

    console.log("Notification API called:", { type, productName, productId, adminName });

    if (type === "new_product") {
      let allUsers: Array<{ id: string; email?: string | null }> = [];
      try {
        allUsers = await listAllAuthUsers(200);
      } catch (usersError: any) {
        console.error("Error fetching users:", usersError);
        return NextResponse.json({ success: false, error: usersError?.message || "Failed to fetch users" }, { status: 500 });
      }

      const userIds = allUsers.map((u) => u.id);
      const prefsByUserId = await getPreferencesByUserId(userIds);
      const now = new Date().toISOString();

      const notificationsToInsert: any[] = [];
      const emailJobs: Array<{ to: string }> = [];

      for (const user of allUsers) {
        const prefs = prefsByUserId.get(user.id);
        const shouldNotify = prefs?.new_product_notifications !== false;
        const shouldEmail = prefs?.email_notifications !== false;

        if (shouldNotify) {
          notificationsToInsert.push({
            user_id: user.id,
            title: "New Product Available!",
            message: `Check out our new product: ${productName}`,
            type: "new_product",
            metadata: {
              product_id: productId,
              product_name: productName,
              admin_name: adminName,
            },
            action_url: `/Product/details?id=${productId}`,
            product_id: productId,
            is_read: false,
            created_at: now,
          });
        }

        if (shouldEmail && user.email && hasAnyEmailProviderConfigured()) {
          emailJobs.push({ to: user.email });
        }
      }

      let notificationsSent = 0;
      for (const insertChunk of chunkArray(notificationsToInsert, 500)) {
        const { error: notifError } = await supabaseAdmin
          .from("user_notifications")
          .insert(insertChunk);

        if (notifError) {
          console.error("Error bulk-inserting notifications:", notifError);
        } else {
          notificationsSent += insertChunk.length;
        }
      }

      let emailsSent = 0;
      let emailsFailed = 0;
      if (emailJobs.length > 0 && hasAnyEmailProviderConfigured()) {
        const result = await runWithConcurrency(emailJobs, 3, async (job) => {
          const result = await sendEmail({
            to: job.to,
            subject: "New Product Available - Grand Link",
            text: `Hello! We're excited to announce that a new product "${productName}" has been added to our catalog. Check it out on our website and place your order today!`,
            html: `<p>Hello!</p><p>We're excited to announce that a new product <strong>"${productName}"</strong> has been added to our catalog.</p><p>Check it out on our website and place your order today!</p><p>Best regards,<br>Grand Link Team</p>`,
          });
          if (!result.sent) {
            throw new Error(result.error || "Email send failed");
          }
        });
        emailsSent = result.succeeded;
        emailsFailed = result.failed;
      }

      console.log(
        `New product notifications sent: ${notificationsSent} in-app, ${emailsSent} emails (failed: ${emailsFailed})`
      );
      return NextResponse.json({ 
        success: true, 
        notificationsSent, 
        emailsSent,
        emailsFailed,
        mailConfigured: hasAnyEmailProviderConfigured(),
        emailProvidersConfigured: {
          primary: hasPrimaryGmailConfigured(),
          backup: hasBackupGmailConfigured(),
        },
        message: `Notified ${notificationsSent} users (${emailsSent} emails sent)` 
      });

    } else if (type === "stock_update") {
      let allUsers: Array<{ id: string; email?: string | null }> = [];
      try {
        allUsers = await listAllAuthUsers(200);
      } catch (usersError: any) {
        console.error("Error fetching users:", usersError);
        return NextResponse.json({ success: false, error: usersError?.message || "Failed to fetch users" }, { status: 500 });
      }

      const userIds = allUsers.map((u) => u.id);
      const prefsByUserId = await getPreferencesByUserId(userIds);
      const now = new Date().toISOString();

      const notificationsToInsert: any[] = [];
      const emailJobs: Array<{ to: string }> = [];

      for (const user of allUsers) {
        const prefs = prefsByUserId.get(user.id);
        const shouldNotify = prefs?.stock_update_notifications !== false;
        const shouldEmail = prefs?.email_notifications !== false;

        if (shouldNotify) {
          notificationsToInsert.push({
            user_id: user.id,
            title: "Stock Replenished!",
            message: `${productName} is back in stock with ${newStock} units available. Order now!`,
            type: "stock_update",
            metadata: {
              product_id: productId,
              product_name: productName,
              new_stock: newStock,
              admin_name: adminName,
            },
            action_url: `/Product/details?id=${productId}`,
            product_id: productId,
            is_read: false,
            created_at: now,
          });
        }

        if (shouldEmail && user.email && hasAnyEmailProviderConfigured()) {
          emailJobs.push({ to: user.email });
        }
      }

      let notificationsSent = 0;
      for (const insertChunk of chunkArray(notificationsToInsert, 500)) {
        const { error: notifError } = await supabaseAdmin
          .from("user_notifications")
          .insert(insertChunk);

        if (notifError) {
          console.error("Error bulk-inserting notifications:", notifError);
        } else {
          notificationsSent += insertChunk.length;
        }
      }

      let emailsSent = 0;
      let emailsFailed = 0;
      if (emailJobs.length > 0 && hasAnyEmailProviderConfigured()) {
        const result = await runWithConcurrency(emailJobs, 3, async (job) => {
          const result = await sendEmail({
            to: job.to,
            subject: "Stock Replenished - Grand Link",
            text: `Great news! "${productName}" is back in stock with ${newStock} units available. Order now before it's gone!`,
            html: `<p>Great news!</p><p><strong>"${productName}"</strong> is back in stock with <strong>${newStock}</strong> units available.</p><p>Order now before it's gone!</p><p>Best regards,<br>Grand Link Team</p>`,
          });
          if (!result.sent) {
            throw new Error(result.error || "Email send failed");
          }
        });
        emailsSent = result.succeeded;
        emailsFailed = result.failed;
      }

      console.log(
        `Stock update notifications sent: ${notificationsSent} in-app, ${emailsSent} emails (failed: ${emailsFailed})`
      );
      return NextResponse.json({ 
        success: true, 
        notificationsSent, 
        emailsSent,
        emailsFailed,
        mailConfigured: hasAnyEmailProviderConfigured(),
        emailProvidersConfigured: {
          primary: hasPrimaryGmailConfigured(),
          backup: hasBackupGmailConfigured(),
        },
        message: `Notified ${notificationsSent} users (${emailsSent} emails sent)` 
      });
    } else if (type === "order_placed") {
      const items = payload?.items || [];
      const total = payload?.total;
      const msg = `New order placed with ${items.length} item(s). Total: ₱${Number(total || 0).toLocaleString()}`;
      // Store admin notification
      const { error: nerr } = await supabaseAdmin.from("notifications").insert({
        title: "New Order",
        message: msg,
        type: "order",
        priority: "high",
        recipient_role: "admin",
        is_read: false,
        created_at: new Date().toISOString()
      });
      if (nerr) console.warn("admin notify insert error:", nerr.message);
      return NextResponse.json({ success: true, message: "Admin notified" });
    }

    return NextResponse.json({ success: false, error: "Invalid notification type" }, { status: 400 });
  } catch (error) {
    console.error(" Notification API error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}