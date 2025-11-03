"use client";

import { FormEvent, useEffect, useState } from "react";

type Discount = {
  id: string;
  code: string;
  type: "percent" | "amount";
  value: number;
  min_subtotal?: number | null;
  active: boolean;
  created_at?: string;
  expires_at?: string | null;
};

export default function DiscountsPage() {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    code: "",
    type: "percent",
    value: "",
    min_subtotal: "",
    expires_at: "",
  });
  const [editModal, setEditModal] = useState<null | Discount>(null);
  const [editForm, setEditForm] = useState({
    code: "",
    type: "percent" as "percent" | "amount",
    value: "",
    min_subtotal: "",
    active: true,
    expires_at: "",
  });

  const loadDiscounts = async () => {
    setLoading(true);
    const res = await fetch("/api/discount-codes", { cache: "no-store" });
    const data = await res.json();
    setDiscounts(data.discounts || []);
    setLoading(false);
  };

  useEffect(() => {
    loadDiscounts();
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.code || !form.value) {
      alert("Code and value are required.");
      return;
    }
    setSubmitting(true);
    const res = await fetch("/api/discount-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.code.trim(),
        type: form.type,
        value: Number(form.value),
        min_subtotal: form.min_subtotal ? Number(form.min_subtotal) : 0,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      })
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      alert(data?.error || "Failed to save");
      return;
    }
    setForm({ code: "", type: "percent", value: "", min_subtotal: "", expires_at: "" });
    loadDiscounts();
  };

  return (
    <section className="p-6 space-y-6">
      <div className="bg-white shadow rounded p-5">
        <h1 className="text-xl font-semibold text-black mb-4">Create Discount</h1>
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-gray-600">Code</label>
            <input
              value={form.code}
              onChange={e => setForm(prev => ({ ...prev, code: e.target.value }))}
              className="border rounded px-3 py-2 text-black"
              placeholder="SUMMER25"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm text-gray-600">Type</label>
            <select
              value={form.type}
              onChange={e => setForm(prev => ({ ...prev, type: e.target.value }))}
              className="border rounded px-3 py-2 text-black"
            >
              <option value="percent">Percent (%)</option>
              <option value="amount">Amount (₱)</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm text-gray-600">
              {form.type === "percent" ? "Percent Value" : "Amount Value"}
            </label>
            <input
              type="number"
              min="0"
              value={form.value}
              onChange={e => setForm(prev => ({ ...prev, value: e.target.value }))}
              className="border rounded px-3 py-2 text-black"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm text-gray-600">Minimum Subtotal (optional)</label>
            <input
              type="number"
              min="0"
              value={form.min_subtotal}
              onChange={e => setForm(prev => ({ ...prev, min_subtotal: e.target.value }))}
              className="border rounded px-3 py-2 text-black"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm text-gray-600">Expires At (optional)</label>
            <input
              type="datetime-local"
              value={form.expires_at}
              onChange={e => setForm(prev => ({ ...prev, expires_at: e.target.value }))}
              className="border rounded px-3 py-2 text-black"
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-[#8B1C1C] text-white rounded disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save Discount"}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white shadow rounded p-5">
        <h2 className="text-lg font-semibold text-black mb-4">Existing Discounts</h2>
        {loading ? (
          <p>Loading...</p>
        ) : discounts.length === 0 ? (
          <p className="text-gray-600">No discounts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-gray-500 uppercase tracking-wide border-b">
                  <th className="py-3">Code</th>
                  <th>Type</th>
                  <th>Value</th>
                  <th>Min Subtotal</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody className="text-gray-700">
                {discounts.map(discount => (
                  <tr key={discount.id} className="border-b">
                    <td className="py-3 font-semibold text-black">{discount.code}</td>
                    <td>{discount.type}</td>
                    <td>{discount.type === "percent" ? `${discount.value}%` : `₱${Number(discount.value).toLocaleString()}`}</td>
                    <td>{discount.min_subtotal ? `₱${Number(discount.min_subtotal).toLocaleString()}` : "None"}</td>
                    <td>{discount.active ? "Active" : "Inactive"}</td>
                    <td>{discount.created_at ? new Date(discount.created_at).toLocaleString() : "--"}</td>
                    <td>{discount.expires_at ? new Date(discount.expires_at).toLocaleString() : "—"}</td>
                    <td>
                      <button
                        className="text-xs px-3 py-1 rounded bg-gray-700 text-white hover:bg-gray-800"
                        onClick={() => {
                          setEditModal(discount);
                          setEditForm({
                            code: discount.code,
                            type: discount.type,
                            value: String(discount.value),
                            min_subtotal: String(discount.min_subtotal ?? ''),
                            active: !!discount.active,
                            expires_at: discount.expires_at ? new Date(discount.expires_at).toISOString().slice(0,16) : '',
                          });
                        }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
          <div className="bg-white rounded shadow-lg w-full max-w-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-black">Edit Discount</h3>
              <button className="px-2 py-1 bg-gray-200 rounded text-black" onClick={() => setEditModal(null)}>✕</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600">Code</label>
                <input className="border rounded px-3 py-2 text-black" value={editForm.code} onChange={e=>setEditForm(f=>({...f, code:e.target.value}))} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600">Type</label>
                <select className="border rounded px-3 py-2 text-black" value={editForm.type} onChange={e=>setEditForm(f=>({...f, type:e.target.value as any}))}>
                  <option value="percent">Percent (%)</option>
                  <option value="amount">Amount (₱)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600">{editForm.type === 'percent' ? 'Percent Value' : 'Amount Value'}</label>
                <input type="number" min={0} className="border rounded px-3 py-2 text-black" value={editForm.value} onChange={e=>setEditForm(f=>({...f, value:e.target.value}))} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600">Minimum Subtotal</label>
                <input type="number" min={0} className="border rounded px-3 py-2 text-black" value={editForm.min_subtotal} onChange={e=>setEditForm(f=>({...f, min_subtotal:e.target.value}))} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-gray-600">Expires At</label>
                <input type="datetime-local" className="border rounded px-3 py-2 text-black" value={editForm.expires_at} onChange={e=>setEditForm(f=>({...f, expires_at:e.target.value}))} />
              </div>
              <div className="flex items-end gap-2">
                <label className="text-sm text-gray-600">Active</label>
                <input type="checkbox" checked={editForm.active} onChange={e=>setEditForm(f=>({...f, active:e.target.checked}))} />
              </div>
            </div>
            <div className="mt-4 flex justify-between">
              <button
                className="px-3 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700"
                onClick={async ()=>{
                  if (!editModal) return;
                  if (!confirm('Delete this discount?')) return;
                  const res = await fetch('/api/discount-codes', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: editModal.id }) });
                  const data = await res.json().catch(()=>({}));
                  if (!res.ok) { alert(data?.error||'Failed to delete'); return; }
                  setEditModal(null);
                  loadDiscounts();
                }}
              >Delete</button>
              <div className="flex gap-2 text-black">
                <button className="px-3 py-2 text-sm rounded bg-gray-200 hover:bg-gray-300" onClick={()=>setEditModal(null)}>Cancel</button>
                <button
                  className="px-3 py-2 text-sm rounded bg-[#8B1C1C] text-white hover:opacity-90"
                  onClick={async ()=>{
                    if (!editModal) return;
                    const payload:any = {
                      id: editModal.id,
                      code: editForm.code.trim(),
                      type: editForm.type,
                      value: Number(editForm.value),
                      min_subtotal: editForm.min_subtotal ? Number(editForm.min_subtotal) : 0,
                      active: !!editForm.active,
                      expires_at: editForm.expires_at ? new Date(editForm.expires_at).toISOString() : null,
                    };
                    const res = await fetch('/api/discount-codes', { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
                    const data = await res.json();
                    if (!res.ok) { alert(data?.error || 'Failed to update'); return; }
                    setEditModal(null);
                    loadDiscounts();
                  }}
                >Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}