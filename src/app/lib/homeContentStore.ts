import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const HOME_CONTENT_SINGLETON_ID = "00000000-0000-0000-0000-000000000000";

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export type HomeContentRecord = {
  id?: string;
  slug?: string | null;
  content?: Record<string, any> | null;
  updated_at?: string | null;
};

export async function readHomeContentRecord(): Promise<HomeContentRecord | null> {
  const byId = await supabaseAdmin
    .from("home_content")
    .select("id, slug, content, updated_at")
    .eq("id", HOME_CONTENT_SINGLETON_ID)
    .limit(1)
    .maybeSingle<HomeContentRecord>();

  if (!byId.error && byId.data) {
    return byId.data;
  }

  const bySlug = await supabaseAdmin
    .from("home_content")
    .select("id, slug, content, updated_at")
    .eq("slug", "home")
    .limit(1)
    .maybeSingle<HomeContentRecord>();

  if (!bySlug.error && bySlug.data) {
    return bySlug.data;
  }

  return null;
}

export async function readHomeContent(): Promise<Record<string, any>> {
  const record = await readHomeContentRecord();
  return record?.content && typeof record.content === "object" ? record.content : {};
}

export async function writeHomeContent(content: Record<string, any>) {
  const existing = await readHomeContentRecord();
  const updated_at = new Date().toISOString();

  if (existing?.slug && existing.id !== HOME_CONTENT_SINGLETON_ID) {
    const { data, error } = await supabaseAdmin
      .from("home_content")
      .upsert({ slug: existing.slug, content, updated_at }, { onConflict: "slug" })
      .select("id, slug, content, updated_at")
      .single<HomeContentRecord>();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabaseAdmin
    .from("home_content")
    .upsert(
      { id: HOME_CONTENT_SINGLETON_ID, content, updated_at },
      { onConflict: "id" }
    )
    .select("id, slug, content, updated_at")
    .single<HomeContentRecord>();

  if (error) throw error;
  return data;
}
