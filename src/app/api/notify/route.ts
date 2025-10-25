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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // avoid caching for webhooks/notifications

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
      if (shouldSendEmail && mailTransporter && userEmail) {
        try {
          await mailTransporter.sendMail({
            from: process.env.GMAIL_FROM || process.env.GMAIL_USER!,
            to: userEmail,
            subject: `Order Status: ${statusDisplay}`,
            html: `<p>${message}</p><p>Order ID: ${userItemId}</p>`,
          });
          emailSent = true;
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
        },
      });
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
    console.error("💥 Notification API error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}