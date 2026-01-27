import { NextResponse } from "next/server";
import { getAdminSupabase } from "../_server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = (searchParams.get("status") || "pending").trim();

    const allowed = new Set(["pending", "active", "resolved"]);
    if (!allowed.has(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const supabase = getAdminSupabase();

    const { data, error } = await supabase
      .from("chat_threads")
      .select(
        "id, status, created_at, last_message_at, visitor_name, visitor_email, user_id, accepted_at, resolved_at, resolved_by"
      )
      .eq("status", status)
      .order("last_message_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    return NextResponse.json({ threads: data ?? [] });
  } catch (e: any) {
    console.error("GET /api/chat/threads error", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
