import { NextResponse } from "next/server";
import { getAdminSupabase } from "../../../_server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { adminName, adminId } = (await req.json().catch(() => ({}))) as {
      adminName?: string;
      adminId?: string;
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

    if (thread.status === "resolved") {
      return NextResponse.json(
        { error: "Thread already resolved" },
        { status: 409 }
      );
    }

    const { error } = await supabase
      .from("chat_threads")
      .update({
        status: "active",
        accepted_at: new Date().toISOString(),
        resolved_at: null,
        resolved_by: null,
        last_message_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    // Optional system message
    await supabase.from("chat_messages").insert({
      thread_id: id,
      sender_type: "admin",
      sender_name: adminName || "Admin",
      sender_email: null,
      body: `✅ Chat accepted by ${adminName || adminId || "Admin"}`,
      read_by_admin: true,
      read_by_user: false,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("POST /api/chat/threads/[id]/accept error", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
