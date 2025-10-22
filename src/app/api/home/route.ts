import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars for /api/home");
}

const supabase = createClient(SUPABASE_URL || "", SUPABASE_SERVICE_ROLE_KEY || "");

// use a fixed UUID so we keep a single row (singleton)
// NOTE: id column in the DB is uuid, so use a valid UUID string here.
const SINGLETON_ID = "00000000-0000-0000-0000-000000000000";

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("home_content")
      .select("id, content, updated_at")
      .eq("id", SINGLETON_ID)
      .limit(1)
      .single();

    if (error && (error as any).code !== "PGRST116") {
      // PGRST116 or similar may be returned if no rows; handle gracefully
      console.error("supabase select error:", error);
    }

    if (!data) {
      return NextResponse.json({ content: {} });
    }

    return NextResponse.json({ id: data.id, content: data.content ?? {}, updated_at: data.updated_at });
  } catch (err: any) {
    console.error("GET /api/home error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    // allow client to send either { content: {...} } or the content object directly
    const content = body?.content ?? body;

    if (!content || typeof content !== "object") {
      return NextResponse.json({ error: "Invalid content payload" }, { status: 400 });
    }

    const payload = {
      id: SINGLETON_ID,
      content,
    };

    // upsert the singleton row (onConflict id)
    const { data, error } = await supabase
      .from("home_content")
      .upsert(payload, { onConflict: "id" })
      .select("id, content, updated_at")
      .single();

    if (error) {
      console.error("supabase upsert error:", error);
      return NextResponse.json({ error: error.message || error }, { status: 500 });
    }

    return NextResponse.json({ id: data.id, content: data.content ?? {}, updated_at: data.updated_at });
  } catch (err: any) {
    console.error("PUT /api/home error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}