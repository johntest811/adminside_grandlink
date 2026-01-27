import { NextResponse } from "next/server";
import { getAdminSupabase } from "../_server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const threadId = (searchParams.get("threadId") || "").trim();
    if (!threadId) {
      return NextResponse.json(
        { error: "threadId is required" },
        { status: 400 }
      );
    }

    const supabase = getAdminSupabase();

    const { data: thread, error: tErr } = await supabase
      .from("chat_threads")
      .select("id, status, visitor_name, visitor_email, user_id, accepted_at, resolved_at")
      .eq("id", threadId)
      .maybeSingle();

    if (tErr) throw tErr;
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ thread, messages: data ?? [] });
  } catch (e: any) {
    console.error("GET /api/chat/messages error", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      threadId?: string;
      adminName?: string;
      message?: string;
      imageUrl?: string;
    };

    const threadId = (body.threadId || "").trim();
    if (!threadId) {
      return NextResponse.json(
        { error: "threadId is required" },
        { status: 400 }
      );
    }

    const messageText = (body.message || "").trim();
    const imageUrl = (body.imageUrl || "").trim();

    if (!messageText && !imageUrl) {
      return NextResponse.json(
        { error: "Message or image is required" },
        { status: 400 }
      );
    }

    const supabase = getAdminSupabase();

    const { data: thread, error: tErr } = await supabase
      .from("chat_threads")
      .select("id, status")
      .eq("id", threadId)
      .maybeSingle();

    if (tErr) throw tErr;
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }

    if (thread.status === "pending") {
      return NextResponse.json(
        { error: "Accept the chat before replying" },
        { status: 409 }
      );
    }

    if (thread.status === "resolved") {
      return NextResponse.json(
        { error: "Thread is resolved" },
        { status: 409 }
      );
    }

    const { error } = await supabase.from("chat_messages").insert({
      thread_id: threadId,
      sender_type: "admin",
      sender_name: body.adminName || "Admin",
      sender_email: null,
      body: messageText || null,
      image_url: imageUrl || null,
      read_by_admin: true,
      read_by_user: false,
    });

    if (error) throw error;

    await supabase
      .from("chat_threads")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", threadId);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("POST /api/chat/messages error", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
