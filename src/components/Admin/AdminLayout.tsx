import React, { useState } from 'react';
import {
  ArrowUpRight,
  ClipboardList,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Package,
  Settings2,
  ShieldCheck,
  Users,
  UserRound,
} from 'lucide-react';
import { CatalogItem, ContactLead, ContactLeadInput, ContactLeadUpdate, LeadActivity, LeadActivityInput, LeadProfile, OnlineOrder } from '../../types/pharmacy';
import type { ProductCsvItem } from '../../utils/productCsv';
import { AuditLogView } from './AuditLogView';
import { IntegrationStatus } from './IntegrationStatus';
import { InventoryManager } from './InventoryManager';
import { OperationsOverview } from './OperationsOverview';
import { OrdersManager } from './OrdersManager';
import { StaffManager } from './StaffManager';
import { ProfileManager } from './ProfileManager';
import { ContactLeadManager } from '../CRM/ContactLeadManager';

export type AdminTab = 'overview' | 'orders' | 'inventory' | 'leads' | 'integrations' | 'profile' | 'staff' | 'audit';
export interface OrderSearch {
  query: string;
  status: string;
  page: number;
}
export interface OrderPagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

interface AdminLayoutProps {
  onNavigateHome: () => void;
  onLogout: () => Promise<void>;
  role: 'admin' | 'operator';
  email: string;
  displayName: string;
  onProfileUpdated: (email: string, displayName: string) => void;
  leads: ContactLead[];
  leadDataError?: string;
  dataError?: string;
  onSaveLeads: (leads: ContactLeadInput[]) => Promise<void>;
  onLoadLeadProfile: (leadId: number) => Promise<LeadProfile>;
  onUpdateLead: (leadId: number, update: ContactLeadUpdate) => Promise<ContactLead>;
  onAddLeadActivity: (leadId: number, activity: LeadActivityInput) => Promise<LeadActivity>;
  categories: string[];
  catalogItems: CatalogItem[];
  catalogError?: string;
  onAddCategory: (name: string) => Promise<string>;
  onBulkAddProducts: (products: ProductCsvItem[]) => Promise<CatalogItem[]>;
  onAddProduct: (item: CatalogItem) => Promise<CatalogItem>;
  onUpdateProduct: (item: CatalogItem) => Promise<CatalogItem>;
  onDeleteProduct: (productId: string) => Promise<void>;
  onBulkPriceAdjust: (category: string, percentChange: number) => Promise<void>;
  orders: OnlineOrder[];
  orderPagination: OrderPagination;
  ordersLoading: boolean;
  onLoadOrders: (search: OrderSearch) => void;
  onUpdateOrderStatus: (orderId: string, newStatus: OnlineOrder['status']) => Promise<void>;
  onUpdateOrderTracking: (orderId: string, carrier: string, trackingNumber: string) => Promise<void>;
  onAddOrderInternalNote: (orderId: string, note: string) => Promise<string>;
  onCreateManualOrder: (data: {
    customerName: string;
    email: string;
    phone: string;
    deliveryMethod: OnlineOrder['deliveryMethod'];
    deliveryAddress: string;
    productId: string;
    quantity: number;
  }) => Promise<OnlineOrder>;
}

const navigation: Array<{ id: AdminTab; label: string; icon: typeof LayoutDashboard; group: string }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'Workspace' },
  { id: 'orders', label: 'Orders', icon: ClipboardList, group: 'Workspace' },
  { id: 'leads', label: 'Contact leads', icon: FileSpreadsheet, group: 'Workspace' },
  { id: 'inventory', label: 'Products & stock', icon: Package, group: 'Workspace' },
  { id: 'integrations', label: 'Integrations', icon: Settings2, group: 'Settings' },
  { id: 'profile', label: 'Profile & security', icon: UserRound, group: 'Settings' },
  { id: 'staff', label: 'Staff access', icon: Users, group: 'Administration' },
  { id: 'audit', label: 'Audit log', icon: ShieldCheck, group: 'Administration' },
];

export const AdminLayout: React.FC<AdminLayoutProps> = (props) => {
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('leadId')) return 'leads';
    const requestedTab = params.get('section');
    const validTabs: AdminTab[] = ['overview', 'orders', 'inventory', 'leads', 'integrations', 'profile', 'staff', 'audit'];
    if (!requestedTab || !validTabs.includes(requestedTab as AdminTab)) return 'overview';
    if (props.role !== 'admin' && (requestedTab === 'staff' || requestedTab === 'audit')) return 'overview';
    return requestedTab as AdminTab;
  });
  const [logoutError, setLogoutError] = useState('');
  const selectTab = (tab: AdminTab) => {
    const url = new URL(window.location.href);
    if (tab === 'overview') url.searchParams.delete('section');
    else url.searchParams.set('section', tab);
    if (tab !== 'leads') url.searchParams.delete('leadId');
    window.history.replaceState(window.history.state, '', url);
    setActiveTab(tab);
  };
  const visibleNavigation = navigation.filter((item) =>
    props.role === 'admin' || (item.id !== 'staff' && item.id !== 'audit')
  );
  const activeLabel = navigation.find((item) => item.id === activeTab)?.label || 'Overview';

  const logout = async () => {
    setLogoutError('');
    try {
      await props.onLogout();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'Unable to sign out securely.');
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f7fa] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex h-[68px] items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/ambients-mark.svg" alt="" className="h-10 w-10 rounded-xl" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-slate-950">{props.displayName || 'Ambients operations'}</p>
              <p className="text-xs text-slate-500">{activeLabel}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${props.role === 'admin' ? 'bg-violet-50 text-violet-800' : 'bg-teal-50 text-teal-800'}`}>
              {props.role === 'admin' ? 'Administrator' : 'Operator'}
            </span>
            <button type="button" onClick={props.onNavigateHome} className="hidden items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 md:inline-flex">
              Storefront <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {logoutError && <p role="alert" className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-center text-sm text-rose-900">{logoutError}</p>}
      </header>

      <div className="flex min-h-[calc(100vh-68px)]">
        <aside className="sticky top-[68px] hidden h-[calc(100vh-68px)] w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-5 lg:flex">
          <p className="px-3 pb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Workspace</p>
          {visibleNavigation.filter((item) => item.group === 'Workspace').map((item) => (
            <NavButton key={item.id} item={item} active={activeTab === item.id} onSelect={selectTab} />
          ))}
          <p className="px-3 pb-3 pt-7 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Settings</p>
          {visibleNavigation.filter((item) => item.group === 'Settings').map((item) => (
            <NavButton key={item.id} item={item} active={activeTab === item.id} onSelect={selectTab} />
          ))}
          {props.role === 'admin' && (
            <>
              <p className="px-3 pb-3 pt-7 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Administration</p>
              {visibleNavigation.filter((item) => item.group === 'Administration').map((item) => (
                <NavButton key={item.id} item={item} active={activeTab === item.id} onSelect={selectTab} />
              ))}
            </>
          )}
          <div className="mt-auto rounded-xl border border-amber-100 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-950">Operational data only</p>
            <p className="mt-1 text-[11px] leading-4 text-amber-900">Do not enter patient, prescription, insurance, or payment-card data.</p>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-4 flex w-full items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-left text-sm font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100"
          >
            <LogOut className="h-4 w-4" />
            <span>Logout</span>
          </button>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-7 lg:px-9 lg:py-8">
          <div className="mb-5 lg:hidden">
            <label htmlFor="admin-section" className="sr-only">Workspace section</label>
            <select id="admin-section" value={activeTab} onChange={(event) => selectTab(event.target.value as AdminTab)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium">
              {visibleNavigation.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
          {props.dataError && <p role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{props.dataError}</p>}

          {activeTab === 'overview' && <OperationsOverview onNavigate={selectTab} />}
          {activeTab === 'orders' && (
            <OrdersManager
              orders={props.orders}
              pagination={props.orderPagination}
              isLoading={props.ordersLoading}
              onLoadOrders={props.onLoadOrders}
              onUpdateOrderStatus={props.onUpdateOrderStatus}
              onUpdateOrderTracking={props.onUpdateOrderTracking}
              onAddOrderInternalNote={props.onAddOrderInternalNote}
              onCreateManualOrder={props.onCreateManualOrder}
              catalogItems={props.catalogItems}
            />
          )}
          {activeTab === 'inventory' && (
            <InventoryManager categories={props.categories} catalogItems={props.catalogItems} catalogError={props.catalogError} onAddCategory={props.onAddCategory} onBulkAddProducts={props.onBulkAddProducts} onAddProduct={props.onAddProduct} onUpdateProduct={props.onUpdateProduct} onDeleteProduct={props.onDeleteProduct} onBulkPriceAdjust={props.onBulkPriceAdjust} />
          )}
          {activeTab === 'leads' && <ContactLeadManager leads={props.leads} dataError={props.leadDataError} onSaveLeads={props.onSaveLeads} onLoadLeadProfile={props.onLoadLeadProfile} onUpdateLead={props.onUpdateLead} onAddLeadActivity={props.onAddLeadActivity} />}
          {activeTab === 'integrations' && <IntegrationStatus />}
          {activeTab === 'profile' && <ProfileManager role={props.role} email={props.email} displayName={props.displayName} onProfileUpdated={props.onProfileUpdated} />}
          {activeTab === 'staff' && props.role === 'admin' && <StaffManager />}
          {activeTab === 'audit' && props.role === 'admin' && <AuditLogView />}
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 lg:hidden"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </main>
      </div>
    </div>
  );
};

interface NavButtonProps {
  item: (typeof navigation)[number];
  active: boolean;
  onSelect: (tab: AdminTab) => void;
}

const NavButton: React.FC<NavButtonProps> = ({ item, active, onSelect }) => (
  <button type="button" onClick={() => onSelect(item.id)} className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${active ? 'bg-teal-50 text-teal-900' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'}`}>
    <item.icon className={`h-4 w-4 ${active ? 'text-teal-800' : 'text-slate-400'}`} />
    <span>{item.label}</span>
  </button>
);
