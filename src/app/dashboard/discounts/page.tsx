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
};

export default function DiscountsPage() {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    code: "",
    type: "percent",
    value: "",
    min_subtotal: ""
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
        min_subtotal: form.min_subtotal ? Number(form.min_subtotal) : 0
      })
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      alert(data?.error || "Failed to save");
      return;
    }
    setForm({ code: "", type: "percent", value: "", min_subtotal: "" });
    loadDiscounts();
  };

  return (
    <section className="p-6 space-y-6">
      <div className="bg-white shadow rounded p-5">
        <h1 className="text-xl font-semibold text-black mb-4">Create Discount</h1>
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}