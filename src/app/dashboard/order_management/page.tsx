"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
};

type PaymentModalData = {
  item: UserItem;
  type: 'approve_balance' | 'request_balance' | 'refund';
};

export default function OrdersPage() {
  const [reservations, setReservations] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending_payment');
  // NEW: search
  const [searchQuery, setSearchQuery] = useState('');
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState<PaymentModalData | null>(null);
  const [paymentNotes, setPaymentNotes] = useState('');
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);

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
      const normalized = mapStatusForDB(newStatus);

      const progressMap: Record<string, string> = {
        pending_payment: "awaiting_payment",
        reserved: "payment_confirmed",
        approved: "in_production",
        in_production: "in_production",
        quality_check: "quality_check",
        start_packaging: "packaging",
        packaging: "packaging",
        ready_for_delivery: "ready_for_delivery",
        out_for_delivery: "out_for_delivery",
        completed: "delivered",
        cancelled: "cancelled",
        pending_cancellation: "pending_cancellation",
        pending_balance_payment: "balance_due",
        // NEW
        approve_cancellation: "cancelled",
      };

      const updates: any = {
        status: normalized,
        order_status: newStatus === 'approve_cancellation' ? 'cancelled' : newStatus,
        order_progress: progressMap[newStatus] || newStatus,
        admin_notes:
          newStatus === 'approved' ? `Order approved by ${by}` :
          newStatus === 'cancelled' || newStatus === 'approve_cancellation' ? `Order cancellation approved by ${by}` :
          newStatus === 'in_production' ? `Production started by ${by}` :
          newStatus === 'start_packaging' || newStatus === 'packaging' ? `Packaging started by ${by}` :
          newStatus === 'out_for_delivery' ? `Out for delivery - ${by}` :
          newStatus === 'ready_for_delivery' ? `Ready for delivery by ${by}` :
          newStatus === 'completed' ? `Delivered by ${by}` :
          null,
        updated_at: now,
        // NEW: mark cancellation approved timestamp if applicable
        ...(newStatus === 'approve_cancellation' ? { cancellation_approved_at: now } : {}),
      };

      const updatedItem = await updateOrderViaApi({ itemId, updates });

      // Notify user
      try {
        await adminNotificationService.notifyOrderStatusUpdate(
          itemId,
          item.user_id,
          newStatus === 'approve_cancellation' ? 'cancelled' : newStatus,
          by,
          item.meta?.product_name || ''
        );
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

  // ONLY update user_items for payment actions
  const handlePaymentAction = async (action: 'approve_balance' | 'request_balance' | 'refund') => {
    if (!showPaymentModal || !currentAdmin) return;
    const { item } = showPaymentModal;
    setUpdatingStatus(item.id);

    try {
      const unitPrice = item.price ?? item.meta?.price ?? 0;
      const totalPrice = unitPrice * item.quantity;
      const reservationFee = item.reservation_fee ?? item.meta?.reservation_fee ?? 500;
      const balanceDue = Math.max(totalPrice - reservationFee, 0);
      const baseNoteBy = currentAdmin.username || currentAdmin.name || 'admin';

      let updates: any = { updated_at: new Date().toISOString() };
      let notifyStatus = item.status;

      if (action === 'approve_balance') {
        updates = {
          ...updates,
          balance_payment_status: 'completed',
          total_paid: totalPrice,
          status: 'approved',                  // allowed
          order_status: 'approved',
          meta: {
            ...item.meta,
            payment_stage: 'fully_paid',
            admin_payment_notes: paymentNotes,
            balance_amount_received: balanceDue,
            balance_payment_approved_by: baseNoteBy,
            balance_payment_approved_at: new Date().toISOString(),
            payment_history: [
              ...(item.meta?.payment_history || []),
              {
                type: 'balance_payment',
                amount: balanceDue,
                approved_by: baseNoteBy,
                approved_at: new Date().toISOString(),
                notes: paymentNotes,
              },
            ],
          },
        };
        notifyStatus = 'approved';
      } else if (action === 'request_balance') {
        updates = {
          ...updates,
          status: 'reserved',                   // keep valid status
          order_status: 'pending_balance_payment', // fine-grained for UI/email
          balance_payment_status: 'pending',
          meta: {
            ...item.meta,
            payment_stage: 'balance_due',
            admin_payment_notes: paymentNotes,
            balance_amount_due: balanceDue,
            balance_payment_requested_by: baseNoteBy,
            balance_payment_requested_at: new Date().toISOString(),
            balance_payment_link: `${process.env.NEXT_PUBLIC_USER_WEBSITE_URL}/payment/balance?order_id=${item.id}`,
          },
        };
        notifyStatus = 'pending_balance_payment';
      } else if (action === 'refund') {
        const refundAmount = item.total_paid ?? reservationFee;
        updates = {
          ...updates,
          status: 'cancelled',                  // allowed
          order_status: 'cancelled',
          payment_status: 'refunded',
          meta: {
            ...item.meta,
            refund_status: 'processing',
            refund_amount: refundAmount,
            refund_reason: paymentNotes,
            refund_processed_by: baseNoteBy,
            refund_processed_at: new Date().toISOString(),
          },
        };
        notifyStatus = 'cancelled';
      }

      const updatedItem = await updateOrderViaApi({ itemId: item.id, updates });

      await adminNotificationService.notifyOrderStatusUpdate(
        item.id,
        item.user_id,
        notifyStatus,
        baseNoteBy,
        item.meta?.product_name || ''
      );

      setReservations(prev => prev.map(r => (r.id === item.id ? { ...r, ...updatedItem } : r)));
      setShowPaymentModal(null);
      setPaymentNotes('');
      await fetchReservations();
    } catch (err: any) {
      console.error('Error processing payment action:', err);
      alert(`Error: ${err.message}`);
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

  const getPaymentInfo = (item: UserItem) => {
    const unitPrice = item.price ?? item.meta?.price ?? 0;
    const totalPrice = unitPrice * item.quantity;
    const reservationFee = item.reservation_fee ?? item.meta?.reservation_fee ?? 500;
    const balance = Math.max(totalPrice - reservationFee, 0);
    const totalPaid = item.total_paid ?? (item.payment_status === 'completed' ? reservationFee : 0);
    return {
      totalPrice,
      reservationFee,
      balance,
      totalPaid,
      isFullyPaid: totalPaid >= totalPrice,
      hasReservationFee: item.payment_status === 'completed',
    };
  };

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
    pending_cancellation: ["approve_cancellation"],
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
      quality_check: "🔍 Quality Check",
      packaging: "📦 Start Packaging",
      ready_for_delivery: "🚚 Ready for Delivery",
      out_for_delivery: "🚛 Out for Delivery",
      completed: "✅ Mark Delivered",
      // NEW
      approve_cancellation: "🛑 Approve Cancellation",
    };
    return labels[action] || action.replace(/_/g, ' ').toUpperCase();
  };

  // Build status options (includes common flow + others)
  const statusOptions = useMemo(
    () => [
      
      { value: 'pending_payment', label: 'Pending Payment' },
      { value: 'reserved', label: 'Reserved' },
      { value: 'pending_balance_payment', label: 'Pending Balance Payment' },
      { value: 'approved', label: 'Approved' },
      { value: 'in_production', label: 'In Production' },
      { value: 'quality_check', label: 'Quality Check' },
      { value: 'packaging', label: 'Packaging' },
      { value: 'start_packaging', label: 'Start Packaging' },
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

      {/* Filters / Controls */}
      <div className="bg-white p-4 rounded-lg shadow-sm border">
        <div className="flex flex-wrap items-end gap-4">
          {/* NEW: Search */}
          <div className="flex-1 min-w-[240px]">
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
          {(statusFilter || searchQuery) && (
            <button
              onClick={() => { setStatusFilter(''); setSearchQuery(''); }}
              className="px-3 py-2 border rounded-md bg-white hover:bg-gray-50 text-black"
              title="Clear filters"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-black">Order</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-black">Delivery Address</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-black">Payment</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-black">Status</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-black">Actions</th>
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
              const payInfo = getPaymentInfo(r);
              const isEditingPayment = editingPaymentId === r.id;
              
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
                    {stage === 'pending_payment' ? (
                      <div className="flex flex-col gap-2">
                        {!isEditingPayment ? (
                          <>
                            <div className="text-xs text-black">
                              Total Paid: ₱{Number(r.total_paid || 0).toLocaleString()}
                            </div>
                            <button
                              className="text-xs bg-gray-600 text-white px-3 py-1 rounded hover:bg-gray-700"
                              onClick={() => setEditingPaymentId(r.id)}
                            >
                              Edit Payment
                            </button>
                          </>
                        ) : (
                          <div className="flex flex-col gap-2">
                            <input
                              type="number"
                              defaultValue={Number(r.total_paid || 0)}
                              onChange={(e) => (r as any)._editPaid = e.target.value}
                              className="w-28 px-2 py-1 border rounded text-sm text-black"
                              min={0}
                              placeholder="Amount"
                            />
                            <div className="flex gap-1">
                              <button
                                className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700"
                                disabled={updatingStatus === r.id}
                                onClick={async () => {
                                  const val = Number((r as any)._editPaid ?? r.total_paid ?? 0);
                                  try {
                                    const updated = await updateOrderViaApi({ itemId: r.id, updates: { total_paid: val } });
                                    setReservations(prev => prev.map(x => x.id === r.id ? { ...x, ...updated } : x));
                                    setEditingPaymentId(null);
                                  } catch (e: any) {
                                    alert(e.message || String(e));
                                  }
                                }}
                              >
                                Save
                              </button>
                              <button
                                className="text-xs bg-gray-500 text-white px-2 py-1 rounded hover:bg-gray-600"
                                onClick={() => setEditingPaymentId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-black">
                        <div>Total Paid: ₱{Number(r.total_paid || 0).toLocaleString()}</div>
                        <div className="mt-1">Amount Due: ₱{Math.max((r.price ?? r.meta?.price ?? 0) * r.quantity - (r.total_paid || 0), 0).toLocaleString()}</div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${getStatusColor(stage)}`}>
                      {(stage || "").replace(/_/g, " ").toUpperCase()}
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
                    </div>
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

      {/* Payment modal JSX remains unchanged */}
    </div>
  );
}