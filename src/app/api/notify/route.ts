import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

let mailTransporter: nodemailer.Transporter | null = null;
if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
  mailTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
  });
}

const USER_WEBSITE_URL =
  process.env.NEXT_PUBLIC_USER_WEBSITE_URL ||
  process.env.NEXT_PUBLIC_BASE_URL ||
  "http://localhost:3000";

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // avoid caching for webhooks/notifications

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const { type, productName, productId, adminName, newStock } = payload || {};

    // Forward order status updates to the website API
    if (type === "order_status" || (payload?.userItemId && payload?.newStatus)) {
      try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort("timeout"), 5000);

        const res = await fetch(`${USER_WEBSITE_URL}/api/update-order-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skipUpdate: true, ...payload }),
          signal: ac.signal,
        });

        clearTimeout(timer);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          console.warn("⚠️ notify forward failed:", data?.error || res.statusText);
          return NextResponse.json({ success: true, forwarded: false, warning: data?.error || "notify failed" });
        }
        return NextResponse.json({ success: true, forwarded: true, ...data });
      } catch (e: any) {
        console.warn("⚠️ notify forward error:", e?.message || e);
        return NextResponse.json({ success: true, forwarded: false, warning: "website offline or unreachable" });
      }
    }

    console.log("📢 Notification API called:", { type, productName, productId, adminName });

    if (type === "new_product") {
      // Get all users
      const { data: allUsers, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
      
      if (usersError) {
        console.error("Error fetching users:", usersError);
        return NextResponse.json({ success: false, error: usersError.message }, { status: 500 });
      }

      let notificationsSent = 0;
      let emailsSent = 0;

      for (const user of allUsers.users) {
        // Check user preferences
        const { data: prefs } = await supabaseAdmin
          .from('user_notification_preferences')
          .select('*')
          .eq('user_id', user.id)
          .single();

        const shouldNotify = prefs?.new_product_notifications !== false;
        const shouldEmail = prefs?.email_notifications !== false;

        if (shouldNotify) {
          // Create in-app notification
          const { error: notifError } = await supabaseAdmin
            .from('user_notifications')
            .insert({
              user_id: user.id,
              title: 'New Product Available! 🆕',
              message: `Check out our new product: ${productName}`,
              type: 'new_product',
              metadata: {
                product_id: productId,
                product_name: productName,
                admin_name: adminName
              },
              action_url: `/Product/details?id=${productId}`,
              product_id: productId,
              is_read: false,
              created_at: new Date().toISOString()
            });

          if (!notifError) {
            notificationsSent++;
          } else {
            console.error("Error creating notification for user:", user.id, notifError);
          }
        }

        if (shouldEmail && mailTransporter && user.email) {
          try {
            await mailTransporter.sendMail({
              from: process.env.GMAIL_FROM || process.env.GMAIL_USER,
              to: user.email,
              subject: 'New Product Available - Grand Link',
              text: `Hello! We're excited to announce that a new product "${productName}" has been added to our catalog. Check it out on our website and place your order today!`,
              html: `<p>Hello!</p><p>We're excited to announce that a new product <strong>"${productName}"</strong> has been added to our catalog.</p><p>Check it out on our website and place your order today!</p><p>Best regards,<br>Grand Link Team</p>`
            });
            emailsSent++;
          } catch (emailError) {
            console.error("Error sending email to", user.email, emailError);
          }
        }
      }

      console.log(`✅ New product notifications sent: ${notificationsSent} in-app, ${emailsSent} emails`);
      return NextResponse.json({ 
        success: true, 
        notificationsSent, 
        emailsSent,
        message: `Notified ${notificationsSent} users (${emailsSent} emails sent)` 
      });

    } else if (type === "stock_update") {
      const { data: allUsers, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
      
      if (usersError) {
        console.error("Error fetching users:", usersError);
        return NextResponse.json({ success: false, error: usersError.message }, { status: 500 });
      }

      let notificationsSent = 0;
      let emailsSent = 0;

      for (const user of allUsers.users) {
        const { data: prefs } = await supabaseAdmin
          .from('user_notification_preferences')
          .select('*')
          .eq('user_id', user.id)
          .single();

        const shouldNotify = prefs?.stock_update_notifications !== false;
        const shouldEmail = prefs?.email_notifications !== false;

        if (shouldNotify) {
          const { error: notifError } = await supabaseAdmin
            .from('user_notifications')
            .insert({
              user_id: user.id,
              title: 'Stock Replenished! 📦',
              message: `${productName} is back in stock with ${newStock} units available. Order now!`,
              type: 'stock_update',
              metadata: {
                product_id: productId,
                product_name: productName,
                new_stock: newStock,
                admin_name: adminName
              },
              action_url: `/Product/details?id=${productId}`,
              product_id: productId,
              is_read: false,
              created_at: new Date().toISOString()
            });

          if (!notifError) {
            notificationsSent++;
          }
        }

        if (shouldEmail && mailTransporter && user.email) {
          try {
            await mailTransporter.sendMail({
              from: process.env.GMAIL_FROM || process.env.GMAIL_USER,
              to: user.email,
              subject: 'Stock Replenished - Grand Link',
              text: `Great news! "${productName}" is back in stock with ${newStock} units available. Order now before it's gone!`,
              html: `<p>Great news!</p><p><strong>"${productName}"</strong> is back in stock with <strong>${newStock}</strong> units available.</p><p>Order now before it's gone!</p><p>Best regards,<br>Grand Link Team</p>`
            });
            emailsSent++;
          } catch (emailError) {
            console.error("Error sending email to", user.email, emailError);
          }
        }
      }

      console.log(`✅ Stock update notifications sent: ${notificationsSent} in-app, ${emailsSent} emails`);
      return NextResponse.json({ 
        success: true, 
        notificationsSent, 
        emailsSent,
        message: `Notified ${notificationsSent} users (${emailsSent} emails sent)` 
      });
    }

    return NextResponse.json({ success: false, error: "Invalid notification type" }, { status: 400 });
  } catch (error) {
    console.error("💥 Notification API error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}