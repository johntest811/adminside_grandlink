"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { adminNotificationService } from "@/utils/notificationHelper";

type UserItem = {
  id: string;
  user_id: string;
  product_id: string;
  item_type: 'reservation' | 'order';
  status: string;
  quantity: number;
  meta: any;
  created_at: string;
  updated_at: string;
  reservation_fee?: number;
  payment_status?: string;
  special_instructions?: string;
  delivery_address_id?: string;
  balance_payment_status?: string;
  balance_payment_id?: string;
  total_paid?: number;
  admin_notes?: string;
  estimated_delivery_date?: string;
  payment_id?: string;
  price?: number;
  total_amount?: number;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  delivery_address?: string;
  payment_method?: string;
  order_status?: string;
  order_progress?: string;
  // Enriched by API
  product_details?: any;
  address_details?: any;
  customer?: { name?: string|null; email?: string|null; phone?: string|null };
  invoice_details?: {
    id: string;
    invoice_number?: string | null;
    invoice_html?: string | null;
    issued_at?: string | null;
    email_sent_at?: string | null;
    updated_at?: string | null;
  } | null;
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatStageLabel(value: string): string {
  const key = String(value || '').toLowerCase();
  const labels: Record<string, string> = {
    pending_payment: 'Pending Payment',
    approved: 'Approved',
    in_production: 'In Production',
    quality_check: 'Final Quality Check',
    packaging: 'Packaging',
    ready_for_delivery: 'Ready for Delivery',
    out_for_delivery: 'Out for Delivery',
    completed: 'Completed',
    pending_cancellation: 'Pending Cancellation',
    cancelled: 'Cancelled',
  };
  return labels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildReceiptPreviewHtml(item: UserItem): string {
  const meta = (item.meta || {}) as Record<string, any>;
  const productName = String(meta.product_name || item.product_details?.name || item.product_id || 'Purchased Item');
  const paymentMethod = String(item.payment_method || meta.payment_method || 'PayMongo');
  const paymentChannel = String(meta.paymongo_channel || '').toUpperCase();
  const reference = String(item.payment_id || meta.payment_session_id || '').trim();
  const paidAmount = Number(
    item.total_paid ?? item.total_amount ?? meta.amount_paid ?? meta.final_total_per_item ?? 0
  );
  const qty = Number(item.quantity || 1);
  const sentAt = String(meta.receipt_email_sent_at || '').trim();
  const sentTo = String(meta.receipt_email_to || item.customer_email || '').trim();

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:0 auto;background:#f3f4f6;padding:24px;border-radius:16px;">
      <div style="background:#16a34a;color:#fff;padding:24px;border-radius:12px;text-align:center;">
        <div style="font-size:24px;font-weight:700;line-height:1.2;">Payment Successful</div>
        <div style="font-size:14px;opacity:0.95;margin-top:6px;">Reservation payment has been received and is waiting for admin approval.</div>
      </div>

      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-top:16px;">
        <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;">Reservation Receipt</div>
        <div style="font-size:13px;color:#374151;line-height:1.7;">
          <div><strong>Order ID:</strong> ${escapeHtml(item.id)}</div>
          <div><strong>Payment Reference:</strong> ${escapeHtml(reference || 'N/A')}</div>
          <div><strong>Payment Method:</strong> ${escapeHtml(paymentMethod)}${paymentChannel ? ` (${escapeHtml(paymentChannel)})` : ''}</div>
          <div><strong>Total Paid:</strong> PHP ${paidAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          ${sentTo ? `<div><strong>Receipt Email:</strong> ${escapeHtml(sentTo)}</div>` : ''}
          ${sentAt ? `<div><strong>Sent At:</strong> ${escapeHtml(new Date(sentAt).toLocaleString())}</div>` : ''}
        </div>
      </div>

      <div style="display:flex;gap:16px;align-items:flex-start;padding:16px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;margin-top:12px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:15px;font-weight:700;color:#111827;">${escapeHtml(productName)}</div>
          <div style="margin-top:6px;font-size:13px;color:#374151;">Quantity: ${escapeHtml(qty)}</div>
          <div style="margin-top:4px;font-size:13px;color:#111827;font-weight:600;">Paid Amount: PHP ${paidAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
      </div>

      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-top:16px;">
        <div style="font-size:16px;font-weight:700;color:#111827;margin-bottom:10px;">What’s Next?</div>
        <div style="font-size:13px;color:#374151;line-height:1.8;">
          <div><strong>1.</strong> Payment is confirmed and waiting for admin approval.</div>
          <div><strong>2.</strong> After approval, production and delivery workflow continues.</div>
          <div><strong>3.</strong> Final invoice PDF is sent after admin approval.</div>
        </div>
      </div>
    </div>
  `;
}

function formatRequestValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) => formatRequestValue(entry))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => {
        const formatted = formatRequestValue(entry);
        if (!formatted) return '';
        return `${key.replace(/_/g, ' ')}: ${formatted}`;
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function extractRequestDetails(item: UserItem | null) {
  const meta = (item?.meta || {}) as Record<string, any>;
  const specialInstructions = [
    item?.special_instructions,
    meta.special_instructions,
    meta.specialInstructions,
    meta.customer_special_instructions,
    meta.customer_request?.special_instructions,
    meta.customer_request?.specialInstructions,
    meta.customization?.special_instructions,
    meta.customization?.notes,
    meta.notes,
  ]
    .map((entry) => formatRequestValue(entry))
    .find(Boolean) || '';

  const colorCustomization = [
    meta.color_customization,
    meta.colorCustomization,
    meta.custom_color,
    meta.customColor,
    meta.preferred_color,
    meta.preferredColor,
    meta.color,
    meta.product_color,
    meta.customization?.color,
    meta.customization?.colors,
  ]
    .map((entry) => formatRequestValue(entry))
    .find(Boolean) || '';

  return { specialInstructions, colorCustomization };
}

function formatLocalDateTime(value: unknown) {
  const text = typeof value === "string" ? value : "";
  if (!text) return "";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleString();
}

function getPaymentSummary(item: UserItem) {
  const meta = (item.meta || {}) as Record<string, any>;
  const paymentStatus = String(item.payment_status || meta.payment_status || "").toLowerCase();
  const paymongoChannel = String(meta.paymongo_channel || "").toLowerCase();
  const confirmedAt = meta.payment_confirmed_at || meta.paid_at || meta.payment_paid_at || null;
  const reference = item.payment_id || meta.payment_session_id || meta.payment_reference || null;

  const isPaid = paymentStatus === "completed" || paymentStatus === "paid";
  const provider = String(item.payment_method || meta.payment_method || "").toLowerCase();
  const providerLabel = provider ? provider.toUpperCase() : "";
  const channelLabel = paymongoChannel ? paymongoChannel.toUpperCase() : "";

  return {
    isPaid,
    paymentStatus: paymentStatus || "unknown",
    providerLabel,
    channelLabel,
    confirmedAtText: formatLocalDateTime(confirmedAt),
    reference: reference ? String(reference) : "",
  };
}

export default function OrdersPage() {
  const [reservations, setReservations] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  // NEW: search
  const [searchQuery, setSearchQuery] = useState('');
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  // removed inline edit id in favor of modal
  // New: edit payment modal state
  const [editPaymentItem, setEditPaymentItem] = useState<UserItem | null>(null);
  const [editPaymentForm, setEditPaymentForm] = useState({
    price: '',
    total_amount: '',
    payment_id: '',
    payment_method: '',
  });
  const [requestDetailsItem, setRequestDetailsItem] = useState<UserItem | null>(null);
  const [receiptPreviewItem, setReceiptPreviewItem] = useState<UserItem | null>(null);
  const [invoicePreviewItem, setInvoicePreviewItem] = useState<UserItem | null>(null);
  // New: date/time filter
  const [startDateTime, setStartDateTime] = useState<string>('');
  const [endDateTime, setEndDateTime] = useState<string>('');

  // Minimal API to update only user_items
  const updateOrderViaApi = async (payload: any) => {
    const res = await fetch('/api/order-management/update-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result?.success) {
      throw new Error(result?.error || 'Failed to update order');
    }
    return result.item as UserItem;
  };

  useEffect(() => {
    const sessionData = localStorage.getItem('adminSession');
    if (sessionData) {
      setCurrentAdmin(JSON.parse(sessionData));
    }
  }, []);

  useEffect(() => {
    if (currentAdmin) fetchReservations();
  }, [currentAdmin]);

  // ONLY select from user_items
  const fetchReservations = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/order-management/list-items', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Failed to load items');
      setReservations(json.items || []);
    } catch (err: any) {
      console.error('fetchReservations error:', err);
      alert(`Error loading reservations: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const mapStatusForDB = (s: string) => {
    switch (s) {
      case 'packaging':
        return 'start_packaging';
      case 'out_for_delivery':
        return 'ready_for_delivery';
      case 'pending_balance_payment':
        return 'reserved';
      // NEW: approve cancellation maps to cancelled in DB
      case 'approve_cancellation':
        return 'cancelled';
      default:
        return s;
    }
  };

  // Expand actions to include packaging and out_for_delivery
  const updateReservationStatus = async (itemId: string, newStatus: string, item: UserItem) => {
    if (!currentAdmin) return;
    setUpdatingStatus(itemId);
    try {
      const by = currentAdmin.username || currentAdmin.name || 'admin';
      const now = new Date().toISOString();
      const previousStage = String(item?.meta?.cancel_prev_stage || item?.order_status || item?.order_progress || item?.status || 'approved');
      const normalized = newStatus === 'reject_cancellation' ? mapStatusForDB(previousStage) : mapStatusForDB(newStatus);

      const computedOrderStatus =
        newStatus === 'approve_cancellation'
          ? 'cancelled'
          : newStatus === 'reject_cancellation'
          ? previousStage
          : newStatus;

      const updates: any = {
        status: normalized,
        order_status: computedOrderStatus,
        admin_notes:
          newStatus === 'approved' ? `Order approved by ${by}` :
          newStatus === 'approve_cancellation' ? `Order cancellation approved by ${by}` :
          newStatus === 'reject_cancellation' ? `Order cancellation rejected by ${by}` :
          newStatus === 'cancelled' ? `Order cancelled by ${by}` :
          newStatus === 'in_production' ? `Production started by ${by}` :
          newStatus === 'start_packaging' || newStatus === 'packaging' ? `Packaging started by ${by}` :
          newStatus === 'out_for_delivery' ? `Out for delivery - ${by}` :
          newStatus === 'ready_for_delivery' ? `Ready for delivery by ${by}` :
          newStatus === 'completed' ? `Delivered by ${by}` :
          null,
        updated_at: now,
        meta: {
          ...(item.meta || {}),
          ...(newStatus === 'approve_cancellation'
            ? {
                cancel_request_status: 'approved',
                cancel_approved_at: now,
                cancel_approved_by: by,
              }
            : {}),
          ...(newStatus === 'reject_cancellation'
            ? {
                cancel_request_status: 'rejected',
                cancel_rejected_at: now,
                cancel_rejected_by: by,
              }
            : {}),
        },
      };

      const updatedItem = await updateOrderViaApi({ itemId, updates });

      // Notify user
      try {
        const notifStatus =
          newStatus === 'approve_cancellation'
            ? 'cancelled'
            : newStatus === 'reject_cancellation'
            ? 'cancellation_denied'
            : newStatus;
        await adminNotificationService.notifyOrderStatusUpdate(itemId, item.user_id, notifStatus, by, item.meta?.product_name || '');
      } catch (notifError: any) {
        console.warn('Failed to send notification:', notifError);
      }

      setReservations(prev => prev.map(r => (r.id === itemId ? { ...r, ...updatedItem } : r)));
      await fetchReservations();
    } catch (err: any) {
      console.error("updateReservationStatus error:", err);
      alert(`Error updating status: ${err.message || err}`);
    } finally {
      setUpdatingStatus(null);
    }
  };


  const getStatusColor = (status: string) =>
    ({
      pending_payment: 'bg-yellow-100 text-yellow-800',
      reserved: 'bg-blue-100 text-blue-800',
      pending_balance_payment: 'bg-orange-100 text-orange-800', // used when we pass order_progress/order_status
      approved: 'bg-green-100 text-green-800',
      in_production: 'bg-purple-100 text-purple-800',
      packaging: 'bg-pink-100 text-pink-800',
      out_for_delivery: 'bg-indigo-100 text-indigo-800',
      ready_for_delivery: 'bg-indigo-100 text-indigo-800',
      completed: 'bg-emerald-100 text-emerald-800',
      pending_cancellation: 'bg-orange-100 text-orange-800',
      cancelled: 'bg-red-100 text-red-800',
    }[status] || 'bg-gray-100 text-gray-800');

  // Current UI stage (prefers order_status/order_progress)
  const getStage = (r: UserItem) => r.order_status || r.order_progress || r.status;

  // Next actions map (UI stages) - COMPLETE MAP
  const nextActions: Record<string, string[]> = {
    // NEW: allow approving when still pending payment
    pending_payment: ["approved"],
    reserved: ["approved", "pending_balance_payment"],
    approved: ["in_production"],
    in_production: ["quality_check", "packaging"],
    quality_check: ["packaging"],
    packaging: ["ready_for_delivery"],
    start_packaging: ["ready_for_delivery"],
    ready_for_delivery: ["out_for_delivery", "completed"],
    out_for_delivery: ["completed"],
    // NEW: allow approving cancellation
    pending_cancellation: ["approve_cancellation", "reject_cancellation"],
  };

  const getNextActions = (r: UserItem) => {
    const stage = getStage(r);
    return nextActions[stage] || [];
  };

  const formatActionLabel = (action: string): string => {
    const labels: Record<string, string> = {
      approved: "✅ Approve",
      pending_balance_payment: "💰 Request Balance",
      in_production: "🏭 Start Production",
      quality_check: "🔍 Final Quality Check",
      packaging: "📦 Start Packaging",
      ready_for_delivery: "🚚 Ready for Delivery",
      out_for_delivery: "🚛 Out for Delivery",
      completed: "✅ Mark Delivered",
      // NEW
      approve_cancellation: "🛑 Approve Cancellation",
      reject_cancellation: "↩ Reject Cancellation",
    };
    return labels[action] || action.replace(/_/g, ' ').toUpperCase();
  };

  // Build status options (includes common flow + others)
  const statusOptions = useMemo(
    () => [
      
      { value: 'pending_payment', label: 'Pending Payment' },
      { value: 'approved', label: 'Approved' },
      { value: 'in_production', label: 'In Production' },
      { value: 'quality_check', label: 'Final Quality Check' },
      { value: 'packaging', label: 'Packaging' },
      { value: 'ready_for_delivery', label: 'Ready for Delivery' },
      { value: 'out_for_delivery', label: 'Out for Delivery' },
      { value: 'completed', label: 'Completed' },
      { value: 'pending_cancellation', label: 'Pending Cancellation' },
      { value: 'cancelled', label: 'Cancelled' },
      { value: '', label: 'All Statuses' },
    ],
    []
  );

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    reservations.forEach((r) => {
      const s = getStage(r);
      counts[s] = (counts[s] || 0) + 1;
    });
    return counts;
  }, [reservations]);

  // NEW: query filter
  const filteredReservations = reservations.filter((r) => {
    if (statusFilter && getStage(r) !== statusFilter) return false;
    // Date range filter (created_at)
    if (startDateTime) {
      const from = new Date(startDateTime).getTime();
      const created = new Date(r.created_at).getTime();
      if (!Number.isNaN(from) && !Number.isNaN(created) && created < from) return false;
    }
    if (endDateTime) {
      const to = new Date(endDateTime).getTime();
      const created = new Date(r.created_at).getTime();
      if (!Number.isNaN(to) && !Number.isNaN(created) && created > to) return false;
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    const fields = [
      r.id,
      r.user_id,
      r.product_id,
      r.customer_name,
      r.customer_email,
      r.customer_phone,
      r.meta?.product_name,
      r.meta?.customer_name,
      r.meta?.customer_email,
      r.meta?.customer_phone,
    ]
      .filter(Boolean)
      .map((x: any) => String(x).toLowerCase());
    return fields.some((f) => f.includes(q));
  });

  const filteredStageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredReservations.forEach((r) => {
      const s = getStage(r);
      counts[s] = (counts[s] || 0) + 1;
    });
    return counts;
  }, [filteredReservations]);

  const requestDetails = useMemo(() => extractRequestDetails(requestDetailsItem), [requestDetailsItem]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-black">Reservations & Orders Management</h1>
        <div className="bg-white p-6 rounded-lg shadow-sm text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto"></div>
          <p className="text-sm text-black mt-2">Loading reservations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-black">Reservations & Orders Management</h1>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Records</p>
          <p className="mt-1 text-2xl font-semibold text-black">{reservations.length}</p>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Filtered Results</p>
          <p className="mt-1 text-2xl font-semibold text-black">{filteredReservations.length}</p>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">In Progress</p>
          <p className="mt-1 text-2xl font-semibold text-black">
            {(filteredStageCounts.approved || 0) + (filteredStageCounts.in_production || 0) + (filteredStageCounts.quality_check || 0) + (filteredStageCounts.packaging || 0)}
          </p>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Pending Cancellation</p>
          <p className="mt-1 text-2xl font-semibold text-black">{filteredStageCounts.pending_cancellation || 0}</p>
        </div>
      </div>

      {/* Filters / Controls */}
      <div className="bg-white p-4 rounded-lg shadow-sm border">
        <div className="flex flex-wrap items-end gap-4">
          {/* Left group: search + date range */}
          <div className="flex-1 min-w-[260px] grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-black mb-1">Search</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by Order ID, Product, Customer name/email/phone"
                className="w-full px-3 py-2 border rounded-md text-black placeholder:text-black/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-black mb-1">Date From</label>
              <input
                type="datetime-local"
                value={startDateTime}
                onChange={(e) => setStartDateTime(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-black"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-black mb-1">Date To</label>
              <input
                type="datetime-local"
                value={endDateTime}
                onChange={(e) => setEndDateTime(e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-black"
              />
            </div>
          </div>

          {/* Right group: status filter + clear */}
          <div className="ml-auto flex items-end gap-2">
            <div>
              <label className="block text-sm font-medium text-black mb-1">Filter by Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border rounded-md text-black"
              >
                {statusOptions.map((o) => (
                  <option key={o.value || 'all'} value={o.value}>
                    {o.label}{o.value && stageCounts[o.value] ? ` (${stageCounts[o.value]})` : ''}
                  </option>
                ))}
              </select>
            </div>
            {(statusFilter || searchQuery || startDateTime || endDateTime) && (
              <button
                onClick={() => { setStatusFilter(''); setSearchQuery(''); setStartDateTime(''); setEndDateTime(''); }}
                className="px-3 py-2 border rounded-md bg-white hover:bg-gray-50 text-black"
                title="Clear filters"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="border-b bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Review each order from left to right: order details, customer delivery info, payment details, then apply next-stage actions.
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-black">Order Details</th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-black">Customer and Delivery</th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-black">Payment</th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-black">Current Status</th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-black">Next Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredReservations.map((r) => {
              const actions = getNextActions(r);
              const addr = r.address_details || {} as any;
              
              // Build comprehensive address string from address_details
              const addressParts = [];
              if (addr.address) {
                addressParts.push(addr.address);
              } else {
                if (addr.line1 || addr.street) addressParts.push(addr.line1 || addr.street);
                if (addr.barangay) addressParts.push(addr.barangay);
                if (addr.city) addressParts.push(addr.city);
                if (addr.province || addr.region) addressParts.push(addr.province || addr.region);
                if (addr.postal_code) addressParts.push(addr.postal_code);
              }
              
              const fullAddress = addressParts.length > 0 
                ? addressParts.join(', ') 
                : r.delivery_address || '—';
              
              const customerName = addr.full_name || 
                (addr.first_name && addr.last_name ? `${addr.first_name} ${addr.last_name}` : '') ||
                r.customer?.name || 
                r.customer_name || 
                '';
              
              const phone = addr.phone || r.customer?.phone || r.customer_phone || '';
              const email = addr.email || r.customer?.email || r.customer_email || '';
              const branch = addr.branch || '';
              
              const stage = getStage(r);
              const payment = getPaymentSummary(r);
              // inline payment editing removed; we now use a modal

              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 align-top">
                    <div className="text-sm text-black font-medium break-all">{r.id}</div>
                    <div className="text-xs text-black mt-1">{new Date(r.created_at).toLocaleString()}</div>
                    <div className="text-xs text-black font-semibold mt-2">{r.meta?.product_name || r.product_details?.name || r.product_id}</div>
                    <div className="text-xs text-black">Qty: {r.quantity}</div>
                  </td>
                  <td className="px-4 py-3 align-top max-w-[320px]">
                    {customerName && (
                      <div className="text-sm text-black font-medium mb-1">{customerName}</div>
                    )}
                    {phone && (
                      <div className="text-xs text-black flex items-center gap-1 mb-1">
                        <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                        {phone}
                      </div>
                    )}
                    {email && (
                      <div className="text-xs text-black flex items-center gap-1 mb-2">
                        <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        {email}
                      </div>
                    )}
                    <div className="text-xs text-black break-words">
                      <span className="font-medium">Address:</span> {fullAddress}
                    </div>
                    {branch && (
                      <div className="text-xs text-black mt-1">
                        <span className="font-medium">Branch:</span> {branch}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="text-xs text-black">
                      {(() => {
                        const paidAmount =
                          r.total_paid ??
                          r.total_amount ??
                          r.meta?.amount_paid ??
                          r.meta?.final_total_per_item ??
                          r.price ??
                          r.meta?.price ??
                          0;
                        return <div>Total Amount: ₱{Number(paidAmount || 0).toLocaleString()}</div>;
                      })()}
                    </div>

                    <div className="mt-2 space-y-1 text-xs">
                      <div className={payment.isPaid ? "text-emerald-700 font-semibold" : "text-amber-700 font-semibold"}>
                        {payment.isPaid ? "PAID" : "NOT PAID"}
                        {payment.providerLabel ? ` · ${payment.providerLabel}` : ""}
                        {payment.channelLabel ? ` · ${payment.channelLabel}` : ""}
                      </div>
                      {payment.confirmedAtText ? (
                        <div className="text-slate-700">Confirmed: {payment.confirmedAtText}</div>
                      ) : null}
                      {payment.reference ? (
                        <div className="text-slate-700 break-all">Ref: {payment.reference}</div>
                      ) : null}
                    </div>

                    <button
                      className="mt-2 text-xs bg-gray-600 text-white px-3 py-1 rounded hover:bg-gray-700"
                      onClick={() => {
                        setEditPaymentItem(r);
                        setEditPaymentForm({
                          price: String(r.price ?? r.meta?.price ?? ''),
                          total_amount: String(r.total_paid ?? r.total_amount ?? r.meta?.amount_paid ?? r.meta?.final_total_per_item ?? ''),
                          payment_id: String(r.payment_id ?? ''),
                          payment_method: String(r.payment_method ?? r.meta?.payment_type ?? ''),
                        });
                      }}
                    >
                      Edit Payment
                    </button>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="text-xs bg-emerald-600 text-white px-3 py-1 rounded hover:bg-emerald-700"
                        onClick={() => setReceiptPreviewItem(r)}
                      >
                        View Receipt
                      </button>
                      <button
                        type="button"
                        className="text-xs bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700 disabled:opacity-60"
                        disabled={!r.invoice_details?.invoice_html}
                        onClick={() => setInvoicePreviewItem(r)}
                        title={r.invoice_details?.invoice_html ? 'View invoice sent to customer email' : 'Invoice will be available after approval email generation'}
                      >
                        View Invoice
                      </button>
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${getStatusColor(stage)}`}>
                      {formatStageLabel(stage || "")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {actions.length === 0 ? (
                        <span className="text-xs text-black">No actions</span>
                      ) : (
                        actions.map((a) => {
                          const isDanger = a === 'approve_cancellation' || a === 'cancelled';
                          const btnClass = isDanger
                            ? "text-xs font-semibold bg-red-600 text-white border border-red-700 px-2 py-1 rounded hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                            : "text-xs font-semibold bg-blue-600 text-white border border-blue-700 px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors";
                          return (
                            <button
                              key={`${r.id}-${a}`}
                              disabled={updatingStatus === r.id}
                              onClick={() => updateReservationStatus(r.id, a, r)}
                              className={btnClass}
                              title={`Set status: ${a}`}
                            >
                              {formatActionLabel(a)}
                            </button>
                          );
                        })
                      )}
                      <button
                        type="button"
                        onClick={() => setRequestDetailsItem(r)}
                        className="text-xs font-semibold bg-white text-slate-700 border border-slate-200 px-2 py-1 rounded hover:bg-slate-50 transition-colors"
                      >
                        Request Details
                      </button>
                    </div>
                    {['approved', 'in_production', 'quality_check', 'packaging'].includes(String(stage || '')) ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                          href={`/dashboard/task/assigntask?orderId=${encodeURIComponent(r.id)}`}
                          className="text-xs font-semibold bg-white text-blue-700 border border-blue-200 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                        >
                          Setup Workflow
                        </Link>
                        <Link
                          href={`/dashboard/task/employeetask?orderId=${encodeURIComponent(r.id)}`}
                          className="text-xs font-semibold bg-white text-emerald-700 border border-emerald-200 px-2 py-1 rounded hover:bg-emerald-50 transition-colors"
                        >
                          Review Stages
                        </Link>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredReservations.length === 0 && (
        <div className="text-center py-12">
          <p className="text-black">No records</p>
        </div>
      )}

      {/* Edit Payment Modal */}
      {editPaymentItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white w-full max-w-md rounded-lg shadow-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-black">Edit Payment</h3>
              <button
                className="text-sm px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-black"
                onClick={() => setEditPaymentItem(null)}
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-black mb-1">Unit Price (₱)</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 border rounded text-black"
                    value={editPaymentForm.price}
                    onChange={(e) => setEditPaymentForm((f) => ({ ...f, price: e.target.value }))}
                    min={0}
                  />
                </div>
                <div>
                  <label className="block text-xs text-black mb-1">Total Amount (line total) (₱)</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 border rounded text-black"
                    value={editPaymentForm.total_amount}
                    onChange={(e) => setEditPaymentForm((f) => ({ ...f, total_amount: e.target.value }))}
                    min={0}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-black mb-1">Payment Method</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border rounded text-black"
                    placeholder="PayMongo / PayPal / Cash / Other"
                    value={editPaymentForm.payment_method}
                    onChange={(e) => setEditPaymentForm((f) => ({ ...f, payment_method: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs text-black mb-1">Payment Reference / ID</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border rounded text-black"
                    value={editPaymentForm.payment_id}
                    onChange={(e) => setEditPaymentForm((f) => ({ ...f, payment_id: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-2 text-sm rounded bg-gray-100 hover:bg-gray-200 text-black"
                onClick={() => setEditPaymentItem(null)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
                disabled={!!updatingStatus}
                onClick={async () => {
                  if (!editPaymentItem) return;
                  setUpdatingStatus(editPaymentItem.id);
                  try {
                    const updates: any = { updated_at: new Date().toISOString() };
                    const pr = editPaymentForm.price.trim();
                    const ta = editPaymentForm.total_amount.trim();
                    if (pr !== '') updates.price = Number(pr);
                    if (ta !== '') {
                      const amount = Number(ta);
                      updates.total_amount = amount;
                      updates.total_paid = amount;
                    }
                    if (editPaymentForm.payment_id) updates.payment_id = editPaymentForm.payment_id.trim();
                    if (editPaymentForm.payment_method) updates.payment_method = editPaymentForm.payment_method.trim();

                    // Also mirror into meta for audit (non-destructive merge happens server-side)
                    updates.meta = {
                      manual_payment_override: true,
                      manual_payment_updated_at: new Date().toISOString(),
                      ...(editPaymentForm.payment_method ? { payment_type: editPaymentForm.payment_method.trim() } : {}),
                      ...(pr !== '' ? { price: Number(pr) } : {}),
                      ...(ta !== '' ? { final_total_per_item: Number(ta), amount_paid: Number(ta), total_amount: Number(ta) } : {}),
                    };

                    const updated = await updateOrderViaApi({ itemId: editPaymentItem.id, updates });
                    setReservations(prev => prev.map(x => x.id === editPaymentItem.id ? { ...x, ...updated } : x));
                    setEditPaymentItem(null);
                    await fetchReservations();
                  } catch (e: any) {
                    alert(e.message || String(e));
                  } finally {
                    setUpdatingStatus(null);
                  }
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {requestDetailsItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-900">Customer request details</div>
                <div className="mt-1 text-sm text-slate-500">
                  {requestDetailsItem.meta?.product_name || requestDetailsItem.product_details?.name || requestDetailsItem.product_id} • {requestDetailsItem.customer?.name || requestDetailsItem.customer_name || 'No customer'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRequestDetailsItem(null)}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 transition hover:bg-slate-50"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Special Instructions</div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {requestDetails.specialInstructions || 'No special instructions provided.'}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Color Customization</div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {requestDetails.colorCustomization || 'No color customization provided.'}
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setRequestDetailsItem(null)}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {receiptPreviewItem && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white w-full max-w-5xl rounded-lg shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="text-base font-semibold text-black">Receipt Preview</h3>
              <button
                className="text-sm px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-black"
                onClick={() => setReceiptPreviewItem(null)}
              >
                ✕
              </button>
            </div>
            <iframe
              title="Receipt Preview"
              className="w-full h-[75vh]"
              srcDoc={buildReceiptPreviewHtml(receiptPreviewItem)}
            />
          </div>
        </div>
      )}

      {invoicePreviewItem && (
        <div className="fixed inset-0 z-[71] flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white w-full max-w-6xl rounded-lg shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div>
                <h3 className="text-base font-semibold text-black">Invoice Preview</h3>
                <p className="text-xs text-slate-600">
                  {invoicePreviewItem.invoice_details?.invoice_number || 'Invoice'}
                </p>
              </div>
              <button
                className="text-sm px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 text-black"
                onClick={() => setInvoicePreviewItem(null)}
              >
                ✕
              </button>
            </div>
            <iframe
              title="Invoice Preview"
              className="w-full h-[75vh]"
              srcDoc={invoicePreviewItem.invoice_details?.invoice_html || '<div style="padding:24px;font-family:Arial">Invoice is not available yet.</div>'}
            />
          </div>
        </div>
      )}
    </div>
  );
}