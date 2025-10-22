"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/app/Clients/Supabase/SupabaseClients";

type ActivityLog = {
  id: string | number;
  admin_id: string;
  admin_name: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  details: string;
  page?: string | null;
  metadata?: string | null;
  created_at: string;
};

const actions = ["create","update","delete","login","logout","upload","view","accept_order","reserve_order"];

export default function AuditPage() {
  const [data, setData] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const fetchAll = async () => {
    setLoading(true);
    try {
      let q = supabase
        .from("activity_logs")
        .select("*")
        .order("created_at", { ascending: false });

      if (action) q = q.eq("action", action);
      if (page) q = q.eq("page", page);
      if (from) q = q.gte("created_at", new Date(from).toISOString());
      if (to) q = q.lte("created_at", new Date(new Date(to).getTime() + 24*60*60*1000 - 1).toISOString());

      const { data, error } = await q.limit(1000);
      if (error) throw error;

      const rows = (data as ActivityLog[]) || [];
      setData(
        rows.filter((r) => {
          if (!search.trim()) return true;
          const s = search.toLowerCase();
          return [
            r.admin_name,
            r.action,
            r.entity_type,
            r.entity_id,
            r.details,
            r.page,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(s);
        })
      );
    } catch (e) {
      console.error("audit fetch error:", e);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const ch = supabase
      .channel("audit_activity_logs")
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_logs" }, fetchAll)
      .subscribe();
    return () => {
      try { supabase.removeChannel(ch); } catch {}
    };
  }, []);

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, page, from, to]);

  const pages = useMemo(() => {
    const set = new Set<string>();
    data.forEach((d) => d.page && set.add(d.page));
    return Array.from(set).sort();
  }, [data]);

  const exportCsv = () => {
    const headers = ["id","created_at","admin_name","action","entity_type","entity_id","page","details","metadata"];
    const lines = [headers.join(",")];
    data.forEach((r) => {
      const row = [
        r.id,
        new Date(r.created_at).toISOString(),
        r.admin_name,
        r.action,
        r.entity_type,
        r.entity_id || "",
        r.page || "",
        (r.details || "").replace(/[\r\n,]+/g, " ").trim(),
        (r.metadata || "").replace(/[\r\n,]+/g, " ").trim(),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
      lines.push(row.join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit_logs_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-black">Audit Logs</h1>
        <button onClick={exportCsv} className="px-3 py-2 bg-black text-white rounded">Export CSV</button>
      </div>

      <div className="bg-white p-4 rounded-lg shadow-sm border">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="md:col-span-2">
            <label className="text-xs text-black">Search</label>
            <input
              className="w-full mt-1 px-3 py-2 border rounded text-black placeholder:text-black/50"
              placeholder="Admin, action, entity, details..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-black">Action</label>
            <select className="w-full mt-1 px-3 py-2 border rounded text-black" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All</option>
              {actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-black">Page</label>
            <select className="w-full mt-1 px-3 py-2 border rounded text-black" value={page} onChange={(e) => setPage(e.target.value)}>
              <option value="">All</option>
              {pages.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-black">From</label>
              <input type="date" className="w-full mt-1 px-3 py-2 border rounded text-black" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="text-xs text-black">To</label>
              <input type="date" className="w-full mt-1 px-3 py-2 border rounded text-black" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={fetchAll} className="px-3 py-2 bg-blue-600 text-white rounded">Apply</button>
          <button onClick={() => { setSearch(""); setAction(""); setPage(""); setFrom(""); setTo(""); fetchAll(); }} className="px-3 py-2 border rounded text-black">Clear</button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow border">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="text-black font-medium">All Recent Activities</div>
          <div className="text-sm text-black/70">{loading ? "Loading…" : `${data.length} records`}</div>
        </div>

        <div className="max-h-[70vh] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left text-black">Time</th>
                <th className="px-3 py-2 text-left text-black">Admin</th>
                <th className="px-3 py-2 text-left text-black">Action</th>
                <th className="px-3 py-2 text-left text-black">Entity</th>
                <th className="px-3 py-2 text-left text-black">Details</th>
                <th className="px-3 py-2 text-left text-black">Page</th>
                <th className="px-3 py-2 text-left text-black">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr><td className="px-3 py-4 text-black" colSpan={7}>Loading…</td></tr>
              ) : data.length === 0 ? (
                <tr><td className="px-3 py-6 text-black" colSpan={7}>No records</td></tr>
              ) : (
                data.map((r) => {
                  const meta = (() => { try { return r.metadata ? JSON.parse(r.metadata) : null; } catch { return r.metadata; } })();
                  return (
                    <tr key={String(r.id)} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-black whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2 text-black">{r.admin_name}</td>
                      <td className="px-3 py-2 text-black capitalize">{r.action}</td>
                      <td className="px-3 py-2 text-black">{r.entity_type}{r.entity_id ? ` • ${r.entity_id}` : ""}</td>
                      <td className="px-3 py-2 text-black max-w-xl">{r.details}</td>
                      <td className="px-3 py-2 text-black">{r.page || "-"}</td>
                      <td className="px-3 py-2">
                        {meta ? (
                          <details className="text-black">
                            <summary className="cursor-pointer text-blue-700">View</summary>
                            <pre className="text-xs bg-gray-100 p-2 rounded overflow-auto max-h-40">{JSON.stringify(meta, null, 2)}</pre>
                          </details>
                        ) : <span className="text-black/70">-</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}