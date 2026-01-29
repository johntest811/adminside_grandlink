"use client";

import { useEffect, useMemo, useState } from "react";

type QuoteItem = {
  description: string;
  qty: number;
  price: number;
};

type Quotation = {
  id: string;
  quote_number: string;
  client_name: string;
  client_email?: string | null;
  client_phone?: string | null;
  status: "draft" | "sent" | "approved" | "rejected" | "expired";
  currency: string;
  items: QuoteItem[];
  subtotal: number;
  discount_value: number;
  total_amount: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export default function QuotationsPage() {
  const [rows, setRows] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    client_name: "",
    client_email: "",
    client_phone: "",
    notes: "",
    discount_value: 0,
    items: [{ description: "", qty: 1, price: 0 }] as QuoteItem[],
  });

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/sales/quotations?limit=200", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load quotations");
      setRows(json?.quotations || []);
    } catch (e: any) {
      setError(e?.message || String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      return (
        r.quote_number?.toLowerCase().includes(q) ||
        r.client_name?.toLowerCase().includes(q) ||
        (r.client_email || "").toLowerCase().includes(q)
      );
    });
  }, [rows, query]);

  const subtotalDraft = useMemo(() => {
    return (form.items || []).reduce((sum, it) => sum + Math.max(0, it.qty) * Math.max(0, it.price), 0);
  }, [form.items]);

  const totalDraft = useMemo(() => {
    return Math.max(0, subtotalDraft - Math.max(0, Number(form.discount_value || 0)));
  }, [subtotalDraft, form.discount_value]);

  const create = async () => {
    if (!form.client_name.trim()) {
      alert("Client name is required");
      return;
    }
    try {
      setCreating(true);
      const res = await fetch("/api/sales/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: form.client_name.trim(),
          client_email: form.client_email.trim() || null,
          client_phone: form.client_phone.trim() || null,
          notes: form.notes.trim() || null,
          discount_value: Number(form.discount_value || 0),
          items: form.items.map((i) => ({
            description: i.description,
            qty: Number(i.qty || 0),
            price: Number(i.price || 0),
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to create quotation");
      await load();
      setForm({
        client_name: "",
        client_email: "",
        client_phone: "",
        notes: "",
        discount_value: 0,
        items: [{ description: "", qty: 1, price: 0 }],
      });
      alert(`Created ${json?.quotation?.quote_number}`);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setCreating(false);
    }
  };

  const setStatus = async (id: string, status: Quotation["status"]) => {
    try {
      const res = await fetch("/api/sales/quotations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, patch: { status } }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to update quotation");
      await load();
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Quotations</h1>
        <button className="px-4 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50" onClick={load}>
          Refresh
        </button>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 rounded-lg p-4">
        <div className="font-semibold">Database note</div>
        <div className="text-sm mt-1">
          Quotations need the table from <span className="font-mono">SUPABASE_QUOTATIONS.sql</span> to be run in Supabase.
        </div>
      </div>

      <div className="bg-white p-4 rounded-lg border space-y-3">
        <div className="font-semibold text-gray-900">Create quotation</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input className="px-3 py-2 border rounded text-black" placeholder="Client name" value={form.client_name} onChange={(e) => setForm((p) => ({ ...p, client_name: e.target.value }))} />
          <input className="px-3 py-2 border rounded text-black" placeholder="Client email" value={form.client_email} onChange={(e) => setForm((p) => ({ ...p, client_email: e.target.value }))} />
          <input className="px-3 py-2 border rounded text-black" placeholder="Client phone" value={form.client_phone} onChange={(e) => setForm((p) => ({ ...p, client_phone: e.target.value }))} />
        </div>

        <div className="space-y-2">
          <div className="font-medium text-gray-800">Line items</div>
          {(form.items || []).map((it, idx) => (
            <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2">
              <input
                className="md:col-span-6 px-3 py-2 border rounded text-black"
                placeholder="Description"
                value={it.description}
                onChange={(e) => {
                  const items = [...form.items];
                  items[idx] = { ...items[idx], description: e.target.value };
                  setForm((p) => ({ ...p, items }));
                }}
              />
              <input
                className="md:col-span-2 px-3 py-2 border rounded text-black"
                type="number"
                min={0}
                placeholder="Qty"
                value={it.qty}
                onChange={(e) => {
                  const items = [...form.items];
                  items[idx] = { ...items[idx], qty: Number(e.target.value || 0) };
                  setForm((p) => ({ ...p, items }));
                }}
              />
              <input
                className="md:col-span-2 px-3 py-2 border rounded text-black"
                type="number"
                min={0}
                placeholder="Price"
                value={it.price}
                onChange={(e) => {
                  const items = [...form.items];
                  items[idx] = { ...items[idx], price: Number(e.target.value || 0) };
                  setForm((p) => ({ ...p, items }));
                }}
              />
              <button
                className="md:col-span-2 px-3 py-2 rounded bg-gray-200 hover:bg-gray-300"
                onClick={() => setForm((p) => ({ ...p, items: p.items.filter((_, i) => i !== idx) }))}
                disabled={form.items.length <= 1}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            className="px-3 py-2 rounded bg-white border border-gray-300 hover:bg-gray-50"
            onClick={() => setForm((p) => ({ ...p, items: [...p.items, { description: "", qty: 1, price: 0 }] }))}
          >
            Add line
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            className="px-3 py-2 border rounded text-black"
            type="number"
            min={0}
            placeholder="Discount"
            value={form.discount_value}
            onChange={(e) => setForm((p) => ({ ...p, discount_value: Number(e.target.value || 0) }))}
          />
          <input
            className="md:col-span-2 px-3 py-2 border rounded text-black"
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
          />
        </div>

        <div className="text-sm text-gray-700">
          Subtotal: <span className="font-semibold">₱{subtotalDraft.toLocaleString()}</span> · Total: <span className="font-semibold">₱{totalDraft.toLocaleString()}</span>
        </div>

        <button className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50" onClick={create} disabled={creating}>
          {creating ? "Creating…" : "Create quotation"}
        </button>
      </div>

      <div className="bg-white p-4 rounded-lg border">
        <div className="flex items-center gap-3">
          <input className="flex-1 px-3 py-2 border rounded text-black" placeholder="Search quotes" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="text-sm text-gray-600">{filtered.length} results</div>
        </div>
        {error && <div className="mt-3 text-sm text-red-700">{error}</div>}
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="px-4 py-3 text-left">Quote #</th>
              <th className="px-4 py-3 text-left">Client</th>
              <th className="px-4 py-3 text-left">Total</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-4" colSpan={5}>
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td className="px-4 py-4" colSpan={5}>
                  No quotations found.
                </td>
              </tr>
            ) : (
              filtered.map((q) => (
                <tr key={q.id} className="border-t">
                  <td className="px-4 py-3 font-medium text-gray-900">{q.quote_number}</td>
                  <td className="px-4 py-3 text-gray-700">{q.client_name}</td>
                  <td className="px-4 py-3 text-gray-900">₱{Number(q.total_amount || 0).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <select
                      className="px-2 py-1 border rounded text-sm text-black"
                      value={q.status}
                      onChange={(e) => setStatus(q.id, e.target.value as any)}
                    >
                      <option value="draft">draft</option>
                      <option value="sent">sent</option>
                      <option value="approved">approved</option>
                      <option value="rejected">rejected</option>
                      <option value="expired">expired</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-gray-500">{new Date(q.created_at).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
