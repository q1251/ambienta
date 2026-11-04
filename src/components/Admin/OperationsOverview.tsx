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

  const needsReview = (data?.orders.byStatus.Pending || 0)
    + (data?.orders.byStatus.Submitted || 0)
    + (data?.orders.byStatus['Pharmacist Review'] || 0);

  return (
    <div className="space-y-7">
      <header className="flex flex-col justify-between gap-6 rounded-2xl bg-[#193c34] px-6 py-7 text-white sm:flex-row sm:items-end sm:px-8 sm:py-8">
        <div className="max-w-2xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c7d7c8]">Operations · Daily brief</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.045em] sm:text-[2.4rem]">A clear view of today.</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#e2ebe2]">Live orders, customer inquiries, and inventory in one place. No patient or clinical data is shown here.</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#285247] px-3 py-2 text-xs font-semibold text-[#e6efe7]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#9ec49f]" /> Live workspace
          </span>
          <button type="button" onClick={() => void loadOverview()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-white px-3.5 py-2.5 text-xs font-bold text-[#23473c] transition hover:bg-[#edf3ed] disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</p>}

      <section aria-label="Operational summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Orders', value: data?.orders.total ?? '—', detail: `${needsReview} awaiting review`, icon: ClipboardList, action: 'orders' as const, tone: 'bg-[#edf2ed] text-[#456953]' },
          { label: 'Contact leads', value: data?.leads ?? '—', detail: 'Customer inquiries and contacts', icon: Users, action: 'leads' as const, tone: 'bg-[#f2efe8] text-[#806d46]' },
          { label: 'Active products', value: data?.products ?? '—', detail: 'Published in the storefront', icon: ShoppingBag, action: 'inventory' as const, tone: 'bg-[#edf0f5] text-[#526783]' },
          { label: 'Low stock', value: data?.lowStockCount ?? '—', detail: 'At or below restock threshold', icon: AlertTriangle, action: 'inventory' as const, tone: 'bg-[#f7eee7] text-[#a3693e]' },
        ].map((card) => (
          <button key={card.label} type="button" onClick={() => onNavigate(card.action)} className="group rounded-xl border border-[#e5e8e1] bg-white p-5 text-left transition hover:border-[#c8d4c8] hover:shadow-[0_8px_24px_-18px_rgba(27,57,47,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#52735f] focus-visible:ring-offset-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-semibold text-slate-600">{card.label}</span>
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${card.tone}`}>
                <card.icon className="h-[18px] w-[18px]" />
              </span>
            </div>
            <p className="mt-4 text-[2rem] font-semibold leading-none tracking-[-0.045em] text-[#1d302d]">{card.value}</p>
            <p className="mt-2 text-xs text-slate-500 group-hover:text-slate-700">{card.detail}</p>
          </button>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <section className="overflow-hidden rounded-xl border border-[#e5e8e1] bg-white">
          <div className="flex items-center justify-between border-b border-[#eceee9] px-5 py-4">
            <div>
              <h2 className="text-sm font-bold text-[#263b36]">Recent orders</h2>
              <p className="mt-1 text-xs text-slate-500">Latest saved customer orders</p>
            </div>
            <button type="button" onClick={() => onNavigate('orders')} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-[#456953] transition hover:bg-[#edf2ed] hover:text-[#244438]">
              View orders <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="divide-y divide-[#eff0ec]">
            {data?.recentOrders.map((order) => (
              <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition hover:bg-[#fbfcfa]">
                <div>
                  <p className="text-[13px] font-semibold text-slate-800">{order.orderNumber} <span className="font-medium text-slate-500">· {order.patientName}</span></p>
                  <p className="mt-0.5 text-xs text-slate-500">{order.placedAt} · {order.deliveryMethod}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-[#263b36]">${order.totalAmount.toFixed(2)}</p>
                  <p className="text-xs text-slate-500">{order.status}</p>
                </div>
              </div>
            ))}
            {!loading && data?.recentOrders.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-500">No orders have been placed yet.</p>}
            {loading && <p className="px-5 py-10 text-center text-sm text-slate-500">Loading live activity…</p>}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-[#e5e8e1] bg-white">
          <div className="border-b border-[#eceee9] px-5 py-4">
            <h2 className="text-sm font-bold text-[#263b36]">Stock that needs attention</h2>
            <p className="mt-1 text-xs text-slate-500">Items at or below their configured threshold</p>
          </div>
          <div className="divide-y divide-[#eff0ec]">
            {data?.lowStock.map((product) => (
              <div key={product.id} className="flex items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-slate-800">{product.name}</p>
                  <p className="text-xs text-slate-500">{product.sku}</p>
                </div>
                <span className="shrink-0 rounded-md bg-[#f7eee7] px-2.5 py-1 text-xs font-bold text-[#9a633c]">{product.stockCount} left</span>
              </div>
            ))}
            {!loading && data?.lowStock.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-500">No products currently need restocking.</p>}
            {loading && <p className="px-5 py-10 text-center text-sm text-slate-500">Loading stock levels…</p>}
          </div>
          <div className="border-t border-[#eceee9] p-4">
            <button type="button" onClick={() => onNavigate('inventory')} className="w-full rounded-lg bg-[#f3f5f1] px-4 py-2.5 text-xs font-bold text-[#425b4c] transition hover:bg-[#e9eee8]">Open inventory</button>
          </div>
        </section>
      </div>
    </div>
  );
};
