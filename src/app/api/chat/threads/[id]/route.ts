import { NextResponse } from "next/server";
import { getAdminSupabase } from "../../_server";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const supabase = getAdminSupabase();

    // Deleting thread will cascade delete messages
    const { error } = await supabase.from("chat_threads").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("DELETE /api/chat/threads/[id] error", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
