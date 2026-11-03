import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, ClipboardList, RefreshCw, ShoppingBag, Users } from 'lucide-react';
import { OnlineOrder } from '../../types/pharmacy';

interface OverviewData {
  orders: { total: number; byStatus: Record<string, number> };
  leads: number;
  products: number;
  lowStockCount: number;
  lowStock: Array<{ id: string; name: string; sku: string; stockCount: number; minStockThreshold: number }>;
  recentOrders: OnlineOrder[];
}

interface OperationsOverviewProps {
  onNavigate: (tab: 'orders' | 'leads' | 'inventory') => void;
}

export const OperationsOverview: React.FC<OperationsOverviewProps> = ({ onNavigate }) => {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/data.php?resource=overview', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const result = await response.json() as OverviewData & { message?: string };
      if (!response.ok || !result.orders || !Array.isArray(result.lowStock) || !Array.isArray(result.recentOrders)) {
        throw new Error(result.message || 'The operations overview could not be loaded.');
      }
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The operations overview could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  const needsReview = (data?.orders.byStatus.Submitted || 0) + (data?.orders.byStatus['Pharmacist Review'] || 0);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">Workspace overview</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Good day. Here’s what needs attention.</h1>
          <p className="mt-2 text-sm text-slate-600">Live operational records only. No patient records or clinical data are shown here.</p>
        </div>
        <button type="button" onClick={() => void loadOverview()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</p>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Orders', value: data?.orders.total ?? '—', detail: `${needsReview} awaiting review`, icon: ClipboardList, action: 'orders' as const },
          { label: 'Contact leads', value: data?.leads ?? '—', detail: 'Customer inquiries and contacts', icon: Users, action: 'leads' as const },
          { label: 'Active products', value: data?.products ?? '—', detail: 'Published in the storefront', icon: ShoppingBag, action: 'inventory' as const },
          { label: 'Low stock', value: data?.lowStockCount ?? '—', detail: 'At or below restock threshold', icon: AlertTriangle, action: 'inventory' as const },
        ].map((card) => (
          <button key={card.label} type="button" onClick={() => onNavigate(card.action)} className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500">{card.label}</span>
              <card.icon className="h-5 w-5 text-teal-800" />
            </div>
            <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{card.value}</p>
            <p className="mt-1 text-xs text-slate-500">{card.detail}</p>
          </button>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="font-semibold text-slate-900">Recent orders</h2>
              <p className="mt-0.5 text-xs text-slate-500">Latest saved customer orders</p>
            </div>
            <button type="button" onClick={() => onNavigate('orders')} className="inline-flex items-center gap-1 text-sm font-semibold text-teal-800 hover:text-teal-950">
              View orders <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {data?.recentOrders.map((order) => (
              <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{order.orderNumber} <span className="font-normal text-slate-500">· {order.patientName}</span></p>
                  <p className="mt-0.5 text-xs text-slate-500">{order.placedAt} · {order.deliveryMethod}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-900">${order.totalAmount.toFixed(2)}</p>
                  <p className="text-xs text-slate-500">{order.status}</p>
                </div>
              </div>
            ))}
            {!loading && data?.recentOrders.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-500">No orders have been placed yet.</p>}
            {loading && <p className="px-5 py-10 text-center text-sm text-slate-500">Loading live activity…</p>}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Stock that needs attention</h2>
            <p className="mt-0.5 text-xs text-slate-500">Items at or below their configured threshold</p>
          </div>
          <div className="divide-y divide-slate-100">
            {data?.lowStock.map((product) => (
              <div key={product.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{product.name}</p>
                  <p className="text-xs text-slate-500">{product.sku}</p>
                </div>
                <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{product.stockCount} left</span>
              </div>
            ))}
            {!loading && data?.lowStock.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-500">No products currently need restocking.</p>}
            {loading && <p className="px-5 py-10 text-center text-sm text-slate-500">Loading stock levels…</p>}
          </div>
          <div className="border-t border-slate-100 p-4">
            <button type="button" onClick={() => onNavigate('inventory')} className="w-full rounded-xl bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">Open inventory</button>
          </div>
        </section>
      </div>
    </div>
  );
};
