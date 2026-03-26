"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../Clients/Supabase/SupabaseClients"; 

type Inquiry = {
  id: string;
  user_id?: string | null;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  inquiry_type: string;
  message?: string | null;
  created_at: string;
};

export default function AdminInquiriesPage() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Inquiry | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("inquiries")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        if (mounted) setInquiries(data ?? []);
      } catch (err) {
        console.error("load inquiries", err);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = inquiries;
    if (q) {
      result = result.filter((i) => {
        return (
          i.first_name.toLowerCase().includes(q) ||
          i.last_name.toLowerCase().includes(q) ||
          (i.email ?? "").toLowerCase().includes(q) ||
          (i.phone ?? "").toLowerCase().includes(q) ||
          i.inquiry_type.toLowerCase().includes(q) ||
          (i.message ?? "").toLowerCase().includes(q)
        );
      });
    }
    if (dateFrom) {
      result = result.filter((i) => new Date(i.created_at) >= new Date(dateFrom));
    }
    if (dateTo) {
      // Add one day to include the end date
      const endDate = new Date(dateTo);
      endDate.setDate(endDate.getDate() + 1);
      result = result.filter((i) => new Date(i.created_at) < endDate);
    }
    return result;
  }, [inquiries, query, dateFrom, dateTo]);

  const totalCount = inquiries.length;
  const filteredCount = filtered.length;
  const todayCount = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const d = today.getDate();
    return inquiries.filter((item) => {
      const created = new Date(item.created_at);
      return created.getFullYear() === y && created.getMonth() === m && created.getDate() === d;
    }).length;
  }, [inquiries]);

  useEffect(() => {
    if (!selected) return;
    if (!filtered.some((item) => item.id === selected.id)) {
      setSelected(null);
    }
  }, [filtered, selected]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this inquiry? This action cannot be undone.")) return;
    try {
      const { error } = await supabase.from("inquiries").delete().eq("id", id);
      if (error) throw error;
      setInquiries((s) => s.filter((r) => r.id !== id));
      if (selected?.id === id) setSelected(null);
      alert("Inquiry deleted");
    } catch (err) {
      console.error("delete inquiry", err);
      alert("Could not delete inquiry");
    }
  };

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Inquiries</h1>
            <p className="text-sm text-slate-500">Review customer questions, inspect full details, and clean up resolved records.</p>
          </div>
          <Link href="/dashboard" className="w-fit rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
            Back to Dashboard
          </Link>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total records</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{totalCount}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Matching filters</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{filteredCount}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Received today</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{todayCount}</div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800"
            placeholder="Search by name, email, phone, type, or message"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-slate-800"
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-slate-800"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setDateFrom("");
              setDateTo("");
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Clear Filters
          </button>
        </div>
      </section>

      <section>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-slate-700">Inquiry List</div>

          {loading ? (
            <div className="py-10 text-center text-slate-500">Loading inquiries...</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-slate-500">No inquiries found for the current filters.</div>
          ) : (
            <div className="space-y-3">
              {filtered.map((iq) => {
                const isSelected = selected?.id === iq.id;
                return (
                  <div
                    key={iq.id}
                    className={`rounded-xl border p-4 transition ${
                      isSelected
                        ? "border-blue-500 bg-blue-50"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-slate-900">{iq.first_name} {iq.last_name}</div>
                        <div className="mt-1 text-sm text-slate-600">{iq.email || "No email"} · {iq.phone || "No phone"}</div>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                        {iq.inquiry_type}
                      </span>
                    </div>

                    <div className="mt-3 line-clamp-2 text-sm text-slate-700">
                      {iq.message || "No message provided."}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-slate-500">{new Date(iq.created_at).toLocaleString()}</div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelected(iq)}
                          className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          View Details
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(iq.id)}
                          className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

    
      {selected ? (
        //
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => setSelected(null)}
          role="presentation"
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="selected-inquiry-title"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="selected-inquiry-title" className="text-base font-semibold text-slate-900">Selected Inquiry</h2>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</div>
                <div className="mt-1 text-lg font-bold text-slate-900">{selected.first_name} {selected.last_name}</div>
                <div className="mt-2 text-sm text-slate-700">Email: {selected.email || "—"}</div>
                <div className="text-sm text-slate-700">Phone: {selected.phone || "—"}</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inquiry Type</div>
                <div className="mt-1 text-base font-semibold text-slate-900">{selected.inquiry_type}</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Message</div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{selected.message || "—"}</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Meta</div>
                <div className="mt-1 text-sm text-slate-700">Received: {new Date(selected.created_at).toLocaleString()}</div>
                {selected.user_id ? <div className="text-sm text-slate-700">User ID: {selected.user_id}</div> : null}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="rounded border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(selected.id)}
                  className="rounded bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
                >
                  Delete Inquiry
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}