"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../Clients/Supabase/SupabaseClients"; // <-- Use shared client

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
        // eslint-disable-next-line no-console
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

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this inquiry? This action cannot be undone.")) return;
    try {
      const { error } = await supabase.from("inquiries").delete().eq("id", id);
      if (error) throw error;
      setInquiries((s) => s.filter((r) => r.id !== id));
      if (selected?.id === id) setSelected(null);
      alert("Inquiry deleted");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("delete inquiry", err);
      alert("Could not delete inquiry");
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-black">Inquiries</h1>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="text-sm px-3 py-1 rounded bg-gray-100">Back</Link>
        </div>
      </header>

      <div className="bg-white p-4 rounded shadow">
        <div className="flex gap-3 mb-4 items-center">
          <input
            className="flex-1 border rounded px-3 py-2 text-gray-700"
            placeholder="Search name, email, phone, type or message"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="text-black text-sm flex items-center gap-1">
            From:
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="border rounded px-2 py-1 text-black"
            />
          </label>
          <label className="text-black text-sm flex items-center gap-1">
            To:
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="border rounded px-2 py-1 text-black"
            />
          </label>
        </div>

        {loading ? (
          <div className="py-8 text-center text-black">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-black">No inquiries found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-auto">
              <thead>
                <tr className="text-left text-sm text-black border-b">
                  <th className="p-2">Name</th>
                  <th className="p-2">Email / Phone</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">Message</th>
                  <th className="p-2">Created</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((iq) => (
                  <tr key={iq.id} className="border-b hover:bg-gray-50 align-top">
                    <td className="p-2 align-top">
                      <div className="font-medium text-black">{iq.first_name} {iq.last_name}</div>
                      {iq.user_id && <div className="text-xs text-black">user: {iq.user_id}</div>}
                    </td>
                    <td className="p-2 align-top">
                      <div className="text-sm text-black">{iq.email ?? "—"}</div>
                      <div className="text-xs text-black">{iq.phone ?? "—"}</div>
                    </td>
                    <td className="p-2 align-top">
                      <div className="text-sm text-black">{iq.inquiry_type}</div>
                    </td>
                    <td className="p-2 truncate max-w-xs align-top">
                      <div className="text-sm text-black">{iq.message ?? "—"}</div>
                    </td>
                    <td className="p-2 align-top text-sm text-black">
                      {new Date(iq.created_at).toLocaleString()}
                    </td>
                    <td className="p-2 align-top text-sm">
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => setSelected(iq)}
                          className="px-3 py-1 rounded bg-blue-600 text-white text-sm"
                        >
                          View
                        </button>
                        <button
                          onClick={() => handleDelete(iq.id)}
                          className="px-3 py-1 rounded bg-red-500 text-white text-sm"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* detail panel */}
      {selected && (
        <div className="bg-white p-4 rounded shadow">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-semibold text-black">Inquiry detail</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setSelected(null)}
                className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
              >
                Close
              </button>
              <button onClick={() => handleDelete(selected.id)} className="px-3 py-1 rounded bg-red-500 text-white">Delete</button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-black">Name</div>
              <div className="font-medium text-black">{selected.first_name} {selected.last_name}</div>

              <div className="mt-3 text-xs text-black">Contact</div>
              <div className="text-black">{selected.email ?? "—"}</div>
              <div className="text-black">{selected.phone ?? "—"}</div>

              <div className="mt-3 text-xs text-black">Type</div>
              <div className="font-medium text-black">{selected.inquiry_type}</div>

              {selected.user_id && (
                <>
                  <div className="mt-3 text-xs text-black">User ID</div>
                  <div className="text-sm text-black">{selected.user_id}</div>
                </>
              )}
            </div>

            <div>
              <div className="text-xs text-black">Message</div>
              <div className="whitespace-pre-wrap text-black">{selected.message ?? "—"}</div>
              <div className="mt-4 text-xs text-black">Created</div>
              <div className="text-sm text-black">{new Date(selected.created_at).toLocaleString()}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}