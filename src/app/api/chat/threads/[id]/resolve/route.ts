import { NextResponse } from "next/server";
import { getAdminSupabase } from "../../../_server";
import nodemailer from "nodemailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canSendEmail() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_PASS);
}

function getMailTransporter() {
  if (!canSendEmail()) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER!, pass: process.env.GMAIL_PASS! },
  });
}

function escapeHtml(v: string) {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function looksLikeEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { adminName, adminId, adminEmail } = (await req.json().catch(() => ({}))) as {
      adminName?: string;
      adminId?: string;
      adminEmail?: string;
    };

    const supabase = getAdminSupabase();

    const { data: thread, error: getErr } = await supabase
      .from("chat_threads")
      .select("id, status")
      .eq("id", id)
      .maybeSingle();

    if (getErr) throw getErr;
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const { error } = await supabase
      .from("chat_threads")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by: adminName || adminId || "Admin",
        last_message_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    await supabase.from("chat_messages").insert({
      thread_id: id,
      sender_type: "admin",
      sender_name: adminName || "Admin",
      sender_email: null,
      body: `✅ Marked as resolved by ${adminName || adminId || "Admin"}`,
      read_by_admin: true,
      read_by_user: false,
    });

    // Email transcript to the admin (best-effort)
    let emailSent = false;
    try {
      const toRaw = String(adminEmail || "").trim();
      const to =
        (toRaw && looksLikeEmail(toRaw) ? toRaw : null) ||
        (adminName && looksLikeEmail(adminName) ? adminName : null) ||
        (process.env.GMAIL_USER || null);

      const transporter = getMailTransporter();
      if (transporter && to) {
        const [{ data: threadInfo }, { data: msgs }] = await Promise.all([
          supabase
            .from("chat_threads")
            .select("id, created_at, visitor_name, visitor_email, user_id, accepted_at, resolved_at, resolved_by")
            .eq("id", id)
            .maybeSingle(),
          supabase
            .from("chat_messages")
            .select("created_at, sender_type, sender_name, body, image_url")
            .eq("thread_id", id)
            .order("created_at", { ascending: true }),
        ]);

        const subject = `Grand Link Chat Resolved — ${id}`;
        const header = `
          <h2 style="margin:0 0 10px;">Chat Transcript (Resolved)</h2>
          <p style="margin:0 0 6px;"><b>Thread:</b> ${escapeHtml(id)}</p>
          <p style="margin:0 0 6px;"><b>Visitor:</b> ${escapeHtml(String((threadInfo as any)?.visitor_name || ""))} ${
            (threadInfo as any)?.visitor_email ? `(${escapeHtml(String((threadInfo as any).visitor_email))})` : ""
          }</p>
          <p style="margin:0 0 6px;"><b>User ID:</b> ${escapeHtml(String((threadInfo as any)?.user_id || ""))}</p>
          <p style="margin:0 0 6px;"><b>Resolved By:</b> ${escapeHtml(String((threadInfo as any)?.resolved_by || adminName || "Admin"))}</p>
          <hr style="margin:14px 0;" />
        `;

        const rows = (msgs || []).map((m: any) => {
          const who = m?.sender_name || m?.sender_type || "unknown";
          const when = m?.created_at ? new Date(m.created_at).toLocaleString() : "";
          const body = m?.body ? `<div style="white-space:pre-wrap;">${escapeHtml(String(m.body))}</div>` : "";
          const img = m?.image_url
            ? `<div style="margin-top:6px;"><a href="${escapeHtml(String(m.image_url))}">Image</a></div>`
            : "";
          return `
            <tr>
              <td style="padding:8px;border-bottom:1px solid #eee;vertical-align:top;white-space:nowrap;">${escapeHtml(when)}</td>
              <td style="padding:8px;border-bottom:1px solid #eee;vertical-align:top;white-space:nowrap;"><b>${escapeHtml(String(who))}</b></td>
              <td style="padding:8px;border-bottom:1px solid #eee;vertical-align:top;">${body}${img}</td>
            </tr>
          `;
        });

        const html = `
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;">
            ${header}
            <table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;">
              <thead>
                <tr>
                  <th align="left" style="padding:8px;border-bottom:2px solid #ddd;">Time</th>
                  <th align="left" style="padding:8px;border-bottom:2px solid #ddd;">Sender</th>
                  <th align="left" style="padding:8px;border-bottom:2px solid #ddd;">Message</th>
                </tr>
              </thead>
              <tbody>
                ${rows.join("\n")}
              </tbody>
            </table>
          </div>
        `;

        await transporter.sendMail({
          from: process.env.GMAIL_FROM || process.env.GMAIL_USER!,
          to,
          subject,
          html,
        });
        emailSent = true;
      }
    } catch (mailErr) {
      console.error("Chat transcript email failed", mailErr);
    }

    return NextResponse.json({ ok: true, emailSent });
  } catch (e: any) {
    console.error("POST /api/chat/threads/[id]/resolve error", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
