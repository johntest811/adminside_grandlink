"use client";

import { useEffect, useMemo, useState } from "react";

type Invoice = {
  id: string;
  user_item_id: string;
  user_id: string;
  invoice_number: string;
  currency: string;
  subtotal: number;
  addons_total: number;
  discount_value: number;
  reservation_fee: number;
  total_amount: number;
  payment_method?: string | null;
  issued_at: string;
  email_sent_at?: string | null;
  created_at: string;
  updated_at: string;
};

type InvoiceFull = Invoice & {
  invoice_html?: string;
  meta?: any;
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<InvoiceFull | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/sales/invoices?limit=200", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load invoices");
      setInvoices(json?.invoices || []);
    } catch (e: any) {
      setError(e?.message || String(e));
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((i) => {
      return (
        i.invoice_number?.toLowerCase().includes(q) ||
        i.user_item_id?.toLowerCase().includes(q) ||
        i.user_id?.toLowerCase().includes(q)
      );
    });
  }, [invoices, query]);

  const openInvoice = async (id: string) => {
    try {
      setSaving(true);
      const res = await fetch(`/api/sales/invoices/${id}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load invoice");
      setSelected(json?.invoice || null);
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const markEmailed = async () => {
    if (!selected) return;
    try {
      setSaving(true);
      const res = await fetch("/api/sales/invoices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          patch: { email_sent_at: new Date().toISOString() },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to update invoice");
      setSelected((prev) => (prev ? { ...prev, ...json.invoice } : prev));
      await load();
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const updatePaymentMethod = async (payment_method: string) => {
    if (!selected) return;
    try {
      setSaving(true);
      const res = await fetch("/api/sales/invoices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selected.id,
          patch: { payment_method },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to update invoice");
      setSelected((prev) => (prev ? { ...prev, ...json.invoice } : prev));
      await load();
    } catch (e: any) {
      alert(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Invoices</h1>
        <button
          className="px-4 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50"
          onClick={load}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      <div className="bg-white p-4 rounded-lg border">
        <div className="flex items-center gap-3">
          <input
            className="flex-1 px-3 py-2 border rounded text-black"
            placeholder="Search by invoice #, order id, user id"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="text-sm text-gray-600">{filtered.length} results</div>
        </div>
        {error && <div className="mt-3 text-sm text-red-700">{error}</div>}
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="px-4 py-3 text-left">Invoice #</th>
              <th className="px-4 py-3 text-left">Issued</th>
              <th className="px-4 py-3 text-left">Total</th>
              <th className="px-4 py-3 text-left">Payment</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="px-4 py-4" colSpan={6}>
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td className="px-4 py-4" colSpan={6}>
                  No invoices found.
                </td>
              </tr>
            ) : (
              filtered.map((inv) => (
                <tr key={inv.id} className="border-t">
                  <td className="px-4 py-3 font-medium text-gray-900">{inv.invoice_number}</td>
                  <td className="px-4 py-3 text-gray-700">{new Date(inv.issued_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-900">₱{Number(inv.total_amount || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-700">{inv.payment_method || "—"}</td>
                  <td className="px-4 py-3 text-gray-700">{inv.email_sent_at ? "Sent" : "Not sent"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className="px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700"
                      onClick={() => openInvoice(inv.id)}
                      disabled={saving}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelected(null)} />
          <div className="relative bg-white w-[min(1100px,95vw)] h-[min(750px,90vh)] rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <div className="font-semibold text-gray-900">{selected.invoice_number}</div>
                <div className="text-xs text-gray-600">Order: {selected.user_item_id}</div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  className="px-2 py-1 border rounded text-sm text-black"
                  value={selected.payment_method || ""}
                  onChange={(e) => updatePaymentMethod(e.target.value)}
                  disabled={saving}
                >
                  <option value="">Payment method…</option>
                  <option value="paymongo">PayMongo</option>
                  <option value="paypal">PayPal</option>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                </select>
                <button
                  className="px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                  onClick={markEmailed}
                  disabled={saving}
                >
                  Mark emailed
                </button>
                <button
                  className="px-3 py-1.5 rounded bg-gray-200 hover:bg-gray-300"
                  onClick={() => setSelected(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <div className="h-[calc(100%-52px)]">
              <iframe
                title="invoice"
                className="w-full h-full"
                sandbox="allow-same-origin"
                srcDoc={selected.invoice_html || "<div style='padding:16px;font-family:system-ui'>No invoice_html found for this invoice.</div>"}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
