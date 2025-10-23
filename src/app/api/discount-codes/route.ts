import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function GET() {
  const { data, error } = await supabase
    .from('discount_codes')
    .select('*')
    .order('created_at', { ascending: false } as any);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ discounts: data ?? [] });
}

export async function POST(request: NextRequest) {
  try {
    const { code, type, value, min_subtotal = 0, max_uses = null, starts_at = null, active = true } = await request.json();

    if (!code || !type || (type !== 'percent' && type !== 'amount') || typeof value !== 'number') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('discount_codes')
      .insert({
        code: String(code).trim(),
        type,
        value,
        min_subtotal,
        max_uses,
        starts_at: starts_at || null,
        active: !!active
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ discount: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to create discount' }, { status: 500 });
  }
}