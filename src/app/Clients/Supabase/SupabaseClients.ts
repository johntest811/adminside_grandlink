import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Validate required environment variables
if (!supabaseUrl) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
}

if (!supabaseAnonKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable');
}

// Regular client for frontend operations
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Function to create admin client - only call this client-side for admin dashboards
export function createAdminClient() {
  // Use service role key for admin operations
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!supabaseServiceKey) {
    console.error('❌ No service role key found, using anon key');
    return supabase;
  }

  console.log('✅ Creating admin client with service role key');

  return createClient(supabaseUrl, supabaseServiceKey, {
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

export async function GET() {
  const adminClient = createAdminClient();
  const { data, error } = await adminClient.auth.admin.listUsers();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ users: data.users });
}