import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function requireEnv(name: string, value: string | undefined): string {
  if (value && value.trim().length > 0) return value;
  throw new Error(
    `[Supabase] Missing ${name}. Create adminside_grandlink/.env.local (copy from .env.local.example) and set ${name}.`,
  );
}

const resolvedSupabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
const resolvedSupabaseAnonKey = requireEnv(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  supabaseAnonKey,
);

// Regular client for frontend operations
export const supabase = createClient(
  resolvedSupabaseUrl,
  resolvedSupabaseAnonKey,
  {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  },
);

// Function to create admin client - only call this client-side for admin dashboards
export function createAdminClient() {
  // Use service role key for admin operations
  const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || resolvedSupabaseAnonKey;
  
  if (!supabaseServiceKey) {
    console.error('❌ No service role key found, using anon key');
    return supabase;
  }

  console.log('✅ Creating admin client with service role key');

  return createClient(resolvedSupabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// Server-side admin client (only use in API routes or server components)
export const getAdminClient = () => {
  if (typeof window !== 'undefined') {
    throw new Error('Admin client can only be used server-side');
  }
  return createAdminClient();
};
