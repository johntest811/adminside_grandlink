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

const actionBadgeClass = (a: string) => {
  switch ((a || "").toLowerCase()) {
    case "create":
      return "bg-emerald-100 text-emerald-800";
    case "update":
      return "bg-blue-100 text-blue-800";
    case "delete":
      return "bg-red-100 text-red-800";
    case "login":
      return "bg-indigo-100 text-indigo-800";
    case "logout":
      return "bg-slate-100 text-slate-800";
    case "upload":
      return "bg-purple-100 text-purple-800";
    case "accept_order":
      return "bg-green-100 text-green-800";
    case "reserve_order":
      return "bg-amber-100 text-amber-900";
    default:
      return "bg-gray-100 text-gray-800";
  }
};

const formatTs = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

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
    <div className="space-y-4 w-full max-w-full">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-black">Audit Logs</h1>
        <button onClick={exportCsv} className="px-3 py-2 bg-black text-white rounded w-full sm:w-auto">Export CSV</button>
      </div>

      <div className="bg-white p-4 rounded-lg shadow-sm border w-full max-w-full overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-4">
            <label className="text-xs text-black">Search</label>
            <input
              className="w-full mt-1 px-3 py-2 border rounded text-black placeholder:text-black/50"
              placeholder="Admin, action, entity, details..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-xs text-black">From</label>
            <input
              type="date"
              className="w-full mt-1 px-3 py-2 border rounded text-black"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-xs text-black">To</label>
            <input
              type="date"
              className="w-full mt-1 px-3 py-2 border rounded text-black"
              value={to}
              onChange={(e) => setTo(e.target.value)}
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

        <div className="max-h-[70vh] overflow-auto w-full">
          {loading ? (
            <div className="p-4 text-black">Loading…</div>
          ) : data.length === 0 ? (
            <div className="p-6 text-black">No records</div>
          ) : (
            <div className="divide-y">
              {data.map((r) => {
                const meta = (() => {
                  try {
                    return r.metadata ? JSON.parse(r.metadata) : null;
                  } catch {
                    return r.metadata;
                  }
                })();

                const summary = `${r.admin_name} • ${r.action} • ${r.entity_type}${r.entity_id ? ` • ${r.entity_id}` : ""}${r.page ? ` • ${r.page}` : ""}`;

                return (
                  <details key={String(r.id)} className="group">
                    <summary className="list-none cursor-pointer px-4 py-3 hover:bg-gray-50">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex-shrink-0 text-black/60 group-open:rotate-90 transition-transform select-none">▶</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <div className="text-sm font-medium text-black">{formatTs(r.created_at)}</div>
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${actionBadgeClass(r.action)}`}>
                              {r.action}
                            </span>
                            <div className="text-xs text-black/60 break-words">ID: {String(r.id)}</div>
                          </div>
                          <div className="mt-1 text-sm text-black break-words">
                            <span className="font-medium">{r.admin_name}</span>
                            <span className="text-black/70"> • {r.entity_type}</span>
                            {r.entity_id ? <span className="text-black/60"> • {r.entity_id}</span> : null}
                            {r.page ? <span className="text-black/60"> • {r.page}</span> : null}
                          </div>
                          <div className="mt-1 text-xs text-black/60 break-words line-clamp-2">
                            {r.details}
                          </div>
                        </div>
                      </div>
                    </summary>

                    <div className="px-4 pb-4">
                      <div className="mt-2 rounded-md border bg-gray-50 p-3">
                        <div className="text-xs font-medium text-black/70">Full Details</div>
                        <div className="mt-1 text-sm text-black whitespace-pre-wrap break-words">{r.details}</div>

                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                          <div className="text-black">
                            <div className="text-xs text-black/60">Entity</div>
                            <div className="font-medium break-words">
                              {r.entity_type}{r.entity_id ? ` • ${r.entity_id}` : ""}
                            </div>
                          </div>
                          <div className="text-black">
                            <div className="text-xs text-black/60">Page</div>
                            <div className="font-medium break-words">{r.page || "-"}</div>
                          </div>
                        </div>

                        <div className="mt-3">
                          <div className="text-xs text-black/60">Metadata</div>
                          {meta ? (
                            <pre className="mt-1 text-xs bg-white p-2 rounded overflow-auto max-h-56 whitespace-pre-wrap break-words">{typeof meta === "string" ? meta : JSON.stringify(meta, null, 2)}</pre>
                          ) : (
                            <div className="mt-1 text-sm text-black/70">-</div>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 text-xs text-black/50 break-words">{summary}</div>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}