import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  const body = await req.json();
  const { admin_id, email } = body; // send id or email from client after auth

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // SERVER ONLY
  );

  // update by id or email
  const { error } = await supabase
    .from("admins")
    .update({ last_login: new Date().toISOString() })
    .match(admin_id ? { id: admin_id } : { email });

  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ ok: true });
}