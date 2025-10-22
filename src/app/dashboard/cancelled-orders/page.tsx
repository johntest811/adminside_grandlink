"use client";
import React, { useState, useEffect } from 'react';
import { supabase } from '@/app/Clients/Supabase/SupabaseClients';
import { logActivity } from '@/app/lib/activity';

export default function CancelledOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    const loadAdmin = async () => {
      const sessionData = localStorage.getItem('adminSession');
      if (sessionData) {
        setCurrentAdmin(JSON.parse(sessionData));
      }
    };
    loadAdmin();
  }, []);

  useEffect(() => {
    if (currentAdmin) {
      fetchPendingCancellations();
    }
  }, [currentAdmin]);

  const fetchPendingCancellations = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: ordersData, error: fetchError } = await supabase
        .from('user_items')
        .select('*')
        .or('order_status.eq.pending_cancellation,status.eq.pending_cancellation')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      
      console.log('Pending cancellations:', ordersData);
      setOrders(ordersData || []);

      // Fetch products
      if (ordersData && ordersData.length > 0) {
        const productIds = [...new Set(ordersData.map((order: any) => order.product_id))];
        const { data: productsData } = await supabase
          .from('products')
          .select('id, name, price, image1')
          .in('id', productIds);

        const productsMap: Record<string, any> = {};
        productsData?.forEach(product => {
          productsMap[product.id] = product;
        });
        setProducts(productsMap);
      }
    } catch (err: any) {
      console.error('Error fetching cancellations:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const approveCancellation = async (orderId: string, shouldRefund: boolean) => {
    if (!currentAdmin) return;

    if (!confirm('Approve this cancellation request?')) return;

    setActionLoading(orderId);
    try {
      const order = orders.find(o => o.id === orderId);
      
      // If approved, restore inventory
      if (shouldRefund && order?.product_id && order?.quantity) {
        const { data: product } = await supabase
          .from('products')
          .select('inventory')
          .eq('id', order.product_id)
          .single();

        if (product) {
          await supabase
            .from('products')
            .update({ 
              inventory: (product.inventory || 0) + order.quantity 
            })
            .eq('id', order.product_id);
        }
      }

      const updateData: any = {
        status: 'cancelled',
        order_status: 'cancelled',
        cancellation_approved_at: new Date().toISOString(),
        cancelled_by_admin_id: currentAdmin.id,
        updated_at: new Date().toISOString(),
        meta: {
          ...(order?.meta || {}),
          refund_status: shouldRefund ? 'processing' : 'not_applicable',
          refund_amount: shouldRefund ? 500 : 0,
          cancellation_approved_by: currentAdmin.username
        }
      };

      const { error: updateError } = await supabase
        .from('user_items')
        .update(updateData)
        .eq('id', orderId);

      if (updateError) throw updateError;

      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'update',
        entity_type: 'order_cancellation',
        entity_id: orderId,
        details: `Approved cancellation for order ${orderId}`,
        page: 'cancelled-orders'
      });

      alert('Cancellation approved successfully!');
      fetchPendingCancellations();
    } catch (error: any) {
      console.error('Error approving cancellation:', error);
      alert('Failed to approve cancellation: ' + error.message);
    } finally {
      setActionLoading(null);
    }
  };

  const rejectCancellation = async (orderId: string) => {
    if (!currentAdmin) return;

    const reason = prompt('Enter reason for rejection (optional):');

    setActionLoading(orderId);
    try {
      const order = orders.find(o => o.id === orderId);

      const updateData: any = {
        status: 'accepted',
        order_status: 'accepted',
        cancellation_requested_at: null,
        cancellation_notes: reason || 'Cancellation rejected by admin',
        updated_at: new Date().toISOString(),
        meta: {
          ...(order?.meta || {}),
          cancellation_rejected_by: currentAdmin.username,
          cancellation_rejected_at: new Date().toISOString(),
          rejection_reason: reason
        }
      };

      const { error: updateError } = await supabase
        .from('user_items')
        .update(updateData)
        .eq('id', orderId);

      if (updateError) throw updateError;

      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: 'update',
        entity_type: 'order_cancellation_rejection',
        entity_id: orderId,
        details: `Rejected cancellation for order ${orderId}`,
        page: 'cancelled-orders'
      });

      alert('Cancellation request rejected!');
      fetchPendingCancellations();
    } catch (error: any) {
      console.error('Error rejecting cancellation:', error);
      alert('Failed to reject cancellation: ' + error.message);
    } finally {
      setActionLoading(null);
    }
  };

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h2 className="text-red-800 font-semibold mb-2">Error</h2>
          <p className="text-red-600">{error}</p>
          <button 
            onClick={() => fetchPendingCancellations()} 
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">🚫 Pending Cancellations</h1>

      {loading ? (
        <div className="text-center py-12">Loading...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500">No pending cancellations</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold">Order ID</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">Product</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">Customer</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">Quantity</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">Total</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">Requested</th>
                <th className="px-4 py-3 text-left text-sm font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orders.map(order => {
                const product = products[order.product_id];
                const totalAmount = order.total_amount || ((product?.price || 0) * order.quantity);
                
                return (
                  <tr key={order.id}>
                    <td className="px-4 py-3 text-sm font-mono">{order.id.slice(0, 8)}...</td>
                    <td className="px-4 py-3 text-sm">{product?.name || 'Loading...'}</td>
                    <td className="px-4 py-3 text-sm">{order.customer_name || order.meta?.customer_name || 'N/A'}</td>
                    <td className="px-4 py-3 text-sm">{order.quantity}</td>
                    <td className="px-4 py-3 text-sm font-semibold">
                      ₱{totalAmount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {order.cancellation_requested_at 
                        ? new Date(order.cancellation_requested_at).toLocaleString() 
                        : 'Recently'}
                    </td>
                    <td className="px-4 py-3 flex gap-2">
                      <button
                        onClick={() => approveCancellation(order.id, true)}
                        disabled={actionLoading === order.id}
                        className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm disabled:opacity-50"
                      >
                        Approve & Refund
                      </button>
                      <button
                        onClick={() => rejectCancellation(order.id)}
                        disabled={actionLoading === order.id}
                        className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}