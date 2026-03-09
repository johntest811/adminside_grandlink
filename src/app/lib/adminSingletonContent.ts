import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SINGLETON_ID = "00000000-0000-0000-0000-000000000000";

type SingletonContent = Record<string, any>;

function getSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function readSingletonContent(): Promise<{ content: SingletonContent; updatedAt: string | null }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("home_content")
    .select("content, updated_at")
    .eq("id", SINGLETON_ID)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || "Failed to load singleton content");
  }

  const content = data?.content && typeof data.content === "object" && !Array.isArray(data.content)
    ? (data.content as SingletonContent)
    : {};

  return {
    content,
    updatedAt: data?.updated_at ?? null,
  };
}

export async function writeSingletonContent(content: SingletonContent): Promise<{ content: SingletonContent; updatedAt: string | null }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("home_content")
    .upsert(
      {
        id: SINGLETON_ID,
        content,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    )
    .select("content, updated_at")
    .single();

  if (error) {
    throw new Error(error.message || "Failed to save singleton content");
  }

  return {
    content: data?.content && typeof data.content === "object" && !Array.isArray(data.content)
      ? (data.content as SingletonContent)
      : {},
    updatedAt: data?.updated_at ?? null,
  };
}

export async function patchSingletonContent(
  updater: (current: SingletonContent) => SingletonContent
): Promise<{ content: SingletonContent; updatedAt: string | null }> {
  const current = await readSingletonContent();
  const next = updater(current.content || {});
  return writeSingletonContent(next);
}
