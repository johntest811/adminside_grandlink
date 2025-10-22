"use client";
import React, { useState, useEffect } from 'react';
import { supabase } from '@/app/Clients/Supabase/SupabaseClients';

export default function AcceptedOrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentAdmin, setCurrentAdmin] = useState<any>(null);

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
      fetchAcceptedOrders();
    }
  }, [currentAdmin]);

  const fetchAcceptedOrders = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: ordersData, error: fetchError } = await supabase
        .from('user_items')
        .select('*')
        .or('order_status.eq.accepted,status.eq.accepted,status.eq.approved')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      
      console.log('Accepted orders:', ordersData);
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
      console.error('Error fetching accepted orders:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (error) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h2 className="text-red-800 font-semibold mb-2">Error</h2>
          <p className="text-red-600">{error}</p>
          <button 
            onClick={() => fetchAcceptedOrders()} 
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="p-6 text-center">Loading...</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">✅ Accepted Orders</h1>
      
      {orders.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500">No accepted orders yet</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {orders.map(order => {
            const product = products[order.product_id];
            const totalAmount = order.total_amount || ((product?.price || 0) * order.quantity);
            
            return (
              <div key={order.id} className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-start">
                  <div className="flex gap-4">
                    {product?.image1 && (
                      <img 
                        src={product.image1} 
                        alt={product.name}
                        className="w-20 h-20 object-cover rounded"
                      />
                    )}
                    <div>
                      <h3 className="font-bold text-lg">{product?.name || 'Loading...'}</h3>
                      <p className="text-sm text-gray-600">Order ID: {order.id.slice(0, 8)}...</p>
                      <p className="text-sm text-gray-600">Quantity: {order.quantity}</p>
                      <p className="text-sm text-gray-600">
                        Total: ₱{totalAmount.toLocaleString()}
                      </p>
                      <p className="text-sm text-gray-600">
                        Progress: {order.order_progress?.replace(/_/g, ' ') || 'N/A'}
                      </p>
                      <p className="text-sm text-gray-600">
                        Customer: {order.customer_name || order.meta?.customer_name || 'N/A'}
                      </p>
                    </div>
                  </div>
                  <div className="text-sm text-gray-500">
                    Accepted: {order.admin_accepted_at ? new Date(order.admin_accepted_at).toLocaleString() : 'Recently'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}