import React, { Suspense, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  ClipboardList,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Mail,
  MessageCircle,
  Package,
  Settings2,
  ShieldCheck,
  Users,
  UserRound,
} from 'lucide-react';
import { CatalogItem, ContactLead, ContactLeadInput, ContactLeadUpdate, LeadActivity, LeadActivityInput, LeadProfile, OnlineOrder } from '../../types/pharmacy';
import type { ProductCsvItem } from '../../utils/productCsv';
import { AuditLogView } from './AuditLogView';
import { HostingerMailIntegration } from './HostingerMailIntegration';
import { IntegrationStatus } from './IntegrationStatus';
import { InventoryManager } from './InventoryManager';
import { OperationsOverview } from './OperationsOverview';
import { OrdersManager } from './OrdersManager';
import { StaffManager } from './StaffManager';
import { ProfileManager } from './ProfileManager';
import { LiveChatInbox } from './LiveChatInbox';

const ContactLeadManager = React.lazy(() => import('../CRM/ContactLeadManager').then((module) => ({ default: module.ContactLeadManager })));

export type AdminTab = 'overview' | 'orders' | 'inventory' | 'leads' | 'chat' | 'email' | 'integrations' | 'profile' | 'staff' | 'audit';
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
  permissions: string[];
  isImpersonating: boolean;
  impersonatedBy: string;
  onExitImpersonation: () => Promise<void>;
  onEnterAccount: (session: {
    role: 'operator';
    email: string;
    displayName: string;
    permissions: Array<'leads' | 'new_leads' | 'orders' | 'products' | 'integrations' | 'chat'>;
    impersonating: true;
    impersonatedBy: string;
  }) => void;
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
  onUploadProductImages: (files: File[]) => Promise<string[]>;
  onUpdateProduct: (item: CatalogItem) => Promise<CatalogItem>;
  onDeleteProduct: (productId: string) => Promise<void>;
  onBulkPriceAdjust: (category: string, percentChange: number) => Promise<void>;
  orders: OnlineOrder[];
  orderPagination: OrderPagination;
  ordersLoading: boolean;
  onLoadOrders: (search: OrderSearch) => void;
  onUpdateOrderStatus: (order: OnlineOrder, newStatus: OnlineOrder['status']) => Promise<void>;
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
  { id: 'chat', label: 'Live chat', icon: MessageCircle, group: 'Workspace' },
  { id: 'email', label: 'Email', icon: Mail, group: 'Workspace' },
  { id: 'inventory', label: 'Products & stock', icon: Package, group: 'Workspace' },
  { id: 'staff', label: 'Agent management', icon: Users, group: 'Administration' },
  { id: 'audit', label: 'Audit log', icon: ShieldCheck, group: 'Administration' },
  { id: 'integrations', label: 'Integrations', icon: Settings2, group: 'Settings' },
  { id: 'profile', label: 'Profile & security', icon: UserRound, group: 'Settings' },
];
const permissionForTab: Partial<Record<AdminTab, string>> = {
  leads: 'leads',
  email: 'integrations',
  chat: 'chat',
  orders: 'orders',
  inventory: 'products',
  integrations: 'integrations',
};

export const AdminLayout: React.FC<AdminLayoutProps> = (props) => {
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('leadId')) return 'leads';
    const requestedTab = params.get('section');
    const validTabs: AdminTab[] = ['overview', 'orders', 'inventory', 'leads', 'chat', 'email', 'integrations', 'profile', 'staff', 'audit'];
    if (!requestedTab || !validTabs.includes(requestedTab as AdminTab)) return 'overview';
    if (props.role !== 'admin' && (requestedTab === 'staff' || requestedTab === 'audit'
      || (requestedTab === 'leads' && !props.permissions.includes('leads'))
      || (requestedTab === 'chat' && !props.permissions.includes('chat'))
      || (requestedTab === 'email' && !props.permissions.includes('integrations'))
      || (requestedTab === 'orders' && !props.permissions.includes('orders'))
      || (requestedTab === 'inventory' && !props.permissions.includes('products'))
      || (requestedTab === 'integrations' && !props.permissions.includes('integrations')))) return 'overview';
    return requestedTab as AdminTab;
  });
  const [logoutError, setLogoutError] = useState('');
  const [impersonationError, setImpersonationError] = useState('');
  const [emailInitialFolder, setEmailInitialFolder] = useState<'inbox' | 'campaigns'>('inbox');
  useEffect(() => {
    let failureReported = false;
    const presencePermission = activeTab === 'orders' ? 'orders'
      : activeTab === 'inventory' ? 'products'
        : activeTab === 'leads' ? 'leads'
          : activeTab === 'chat' ? 'chat'
            : activeTab === 'email' || activeTab === 'integrations' ? 'integrations'
              : null;
    const presenceSection = props.role !== 'admin' && (
      activeTab === 'staff'
      || activeTab === 'audit'
      || (presencePermission !== null && !props.permissions.includes(presencePermission))
    ) ? 'overview' : activeTab;
    const heartbeat = async () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      try {
        const response = await fetch('/api/data.php?resource=staff-presence', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ section: presenceSection }),
          keepalive: true,
        });
        if (!response.ok) {
          const result = await response.json() as { message?: string };
          throw new Error(result.message || `Staff presence update failed (${response.status}).`);
        }
        failureReported = false;
      } catch (error) {
        if (!failureReported) {
          console.error('Ambients CRM presence could not be updated.', error);
          failureReported = true;
        }
      }
    };
    const refreshPresence = () => {
      if (document.visibilityState === 'visible' && document.hasFocus()) void heartbeat();
    };
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), 30_000);
    document.addEventListener('visibilitychange', refreshPresence);
    window.addEventListener('focus', refreshPresence);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshPresence);
      window.removeEventListener('focus', refreshPresence);
    };
  }, [activeTab, props.role, props.permissions]);
  const selectTab = (tab: AdminTab) => {
    setEmailInitialFolder('inbox');
    const neededPermission = tab === 'leads' ? 'leads'
      : tab === 'orders' ? 'orders'
        : tab === 'inventory' ? 'products'
          : tab === 'email' || tab === 'integrations' ? 'integrations'
              : tab === 'chat' ? 'chat'
                : null;
    if (props.role !== 'admin' && (
      tab === 'staff'
      || tab === 'audit'
      || (neededPermission !== null && !props.permissions.includes(neededPermission))
    )) return;
    const url = new URL(window.location.href);
    if (tab === 'overview') url.searchParams.delete('section');
    else url.searchParams.set('section', tab);
    if (tab !== 'leads') url.searchParams.delete('leadId');
    window.history.replaceState(window.history.state, '', url);
    setActiveTab(tab);
    window.scrollTo(0, 0);
  };
  const openEmailCampaigns = () => {
    selectTab('email');
    setEmailInitialFolder('campaigns');
  };
  const permissionsKey = props.permissions.join(',');
  const visibleNavigation = useMemo(() => navigation.filter((item) => {
    const requiredPermission = permissionForTab[item.id];
    return props.role === 'admin'
      || (item.id !== 'staff' && item.id !== 'audit' && (!requiredPermission || permissionsKey.split(',').includes(requiredPermission)));
  }), [props.role, permissionsKey]);
  useEffect(() => {
    if (visibleNavigation.some((item) => item.id === activeTab)) return;
    setActiveTab('overview');
    const url = new URL(window.location.href);
    url.searchParams.delete('section');
    url.searchParams.delete('leadId');
    window.history.replaceState(window.history.state, '', url);
  }, [activeTab, props.role, visibleNavigation]);
  const activeItem = navigation.find((item) => item.id === activeTab);
  const labelForItem = (item: (typeof navigation)[number]) =>
    item.id === 'profile' && props.role === 'operator' ? 'My agent profile' : item.label;
  const activeLabel = activeItem ? labelForItem(activeItem) : 'Overview';

  const logout = async () => {
    setLogoutError('');
    try {
      await props.onLogout();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'Unable to sign out securely.');
    }
  };

  const exitImpersonation = async () => {
    setImpersonationError('');
    try {
      await props.onExitImpersonation();
    } catch (error) {
      setImpersonationError(error instanceof Error ? error.message : 'The administrator account could not be restored.');
    }
  };

  return (
    <div className={`crm-shell bg-[#f1f5f9] text-slate-900 ${
      activeTab === 'email' || activeTab === 'chat'
        ? 'flex h-dvh min-h-0 flex-col overflow-hidden'
        : 'min-h-screen'
    }`}>
      <header className="sticky top-0 z-30 border-b border-[#e2e8f0] bg-white">
        <div className="flex h-[72px] items-center justify-between gap-4 px-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/ambients-mark.svg" alt="" className="h-10 w-10 rounded-xl" />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold tracking-[-0.03em] text-[#172033]">Ambienta</p>
              <p className="text-[11px] font-medium tracking-wide text-slate-500">PHARMACY OPERATIONS</p>
            </div>
            <span className="mx-2 hidden h-8 w-px bg-slate-200 sm:block" />
            <p className="hidden truncate text-sm font-semibold text-slate-700 sm:block">{activeLabel}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className={`hidden rounded-full px-2.5 py-1.5 text-[11px] font-bold sm:inline-flex ${props.role === 'admin' ? 'bg-[#f0edf8] text-[#554477]' : 'bg-[#e8f2fb] text-[#1d4ed8]'}`}>
              {props.role === 'admin' ? 'Superadmin' : 'Agent'}
            </span>
            <div className="hidden min-w-0 items-center gap-2.5 border-l border-slate-200 pl-3 sm:flex">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e8f2fb] text-xs font-bold uppercase text-[#1e40af]">
                {(props.displayName || props.email || 'A').trim().slice(0, 1)}
              </span>
              <span className="max-w-40 truncate text-xs font-semibold text-slate-700">{props.displayName || props.email}</span>
            </div>
            <button type="button" onClick={props.onNavigateHome} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
              Storefront <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {logoutError && <p role="alert" className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-center text-sm text-rose-900">{logoutError}</p>}
        {props.isImpersonating && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-violet-200 bg-violet-50 px-4 py-3">
            <p className="text-sm font-medium text-violet-950">Superadmin {props.impersonatedBy} is viewing as {props.displayName} ({props.email}).</p>
            <button type="button" onClick={() => void exitImpersonation()} className="rounded-lg bg-violet-800 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-900">Return to superadmin</button>
          </div>
        )}
        {impersonationError && <p role="alert" className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-center text-sm text-rose-900">{impersonationError}</p>}
      </header>

      <div className={`flex ${
        activeTab === 'email' || activeTab === 'chat'
          ? 'min-h-0 flex-1'
          : 'min-h-[calc(100vh-72px)]'
      }`}>
        <aside className="sticky top-[72px] hidden h-[calc(100vh-72px)] w-[264px] shrink-0 flex-col border-r border-[#e2e8f0] bg-[#f8fafc] px-4 py-6 lg:flex">
          <div className="mb-6 rounded-xl border border-[#e2e8f0] bg-white px-3.5 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Workspace</p>
            <p className="mt-1 text-sm font-semibold text-[#1e3a5f]">{props.role === 'admin' ? 'Administration' : 'Team workspace'}</p>
          </div>
          <nav aria-label="Workspace navigation" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div>
              {visibleNavigation.filter((item) => item.group === 'Workspace').map((item) => (
                <NavButton key={item.id} item={item} label={labelForItem(item)} active={activeTab === item.id} onSelect={selectTab} />
              ))}
            </div>
          {props.role === 'admin' && (
            <>
              <p className="px-3 pb-2 pt-7 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Administration</p>
              {visibleNavigation.filter((item) => item.group === 'Administration').map((item) => (
                <NavButton key={item.id} item={item} label={labelForItem(item)} active={activeTab === item.id} onSelect={selectTab} />
              ))}
            </>
          )}
          <div className="mt-1">
            <p className="px-3 pb-2 pt-7 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Settings</p>
            {visibleNavigation.filter((item) => item.group === 'Settings').map((item) => (
              <NavButton key={item.id} item={item} label={labelForItem(item)} active={activeTab === item.id} onSelect={selectTab} />
            ))}
          </div>
          </nav>
          <div className="mt-5 border-t border-[#e2e8f0] pt-4">
            <div className="mb-3 flex min-w-0 items-center gap-2.5 px-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e8f2fb] text-xs font-bold uppercase text-[#1e40af]">
                {(props.displayName || props.email || 'A').trim().slice(0, 1)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-800">{props.displayName || 'Ambienta staff'}</p>
                <p className="truncate text-[11px] text-slate-500">{props.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-slate-600 transition hover:bg-[#f1f5f9] hover:text-slate-950"
            >
              <LogOut className="h-4 w-4 text-slate-400" />
              <span>Sign out</span>
            </button>
          </div>
        </aside>

        <main className={`min-w-0 flex-1 ${
          activeTab === 'email' || activeTab === 'chat'
            ? 'min-h-0 overflow-hidden px-3 py-3 sm:px-5 sm:py-4 lg:px-6 lg:py-4'
            : 'px-4 py-4 sm:px-6 sm:py-6 lg:px-7 lg:py-7'
        }`}>
          <div className={`mx-auto w-full max-w-[1480px] ${
            activeTab === 'email' || activeTab === 'chat' ? 'flex h-full min-h-0 flex-col' : ''
          }`}>
            <div className={`mb-4 lg:hidden ${activeTab === 'email' || activeTab === 'chat' ? 'mb-3 shrink-0' : ''}`}>
              <label htmlFor="admin-section" className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Workspace section</label>
              <select id="admin-section" value={activeTab} onChange={(event) => selectTab(event.target.value as AdminTab)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 shadow-sm">
                {visibleNavigation.map((item) => <option key={item.id} value={item.id}>{labelForItem(item)}</option>)}
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
                canManagePaymentLinks={props.role === 'admin'}
              />
            )}
            {activeTab === 'inventory' && (
              <InventoryManager categories={props.categories} catalogItems={props.catalogItems} catalogError={props.catalogError} onAddCategory={props.onAddCategory} onBulkAddProducts={props.onBulkAddProducts} onAddProduct={props.onAddProduct} onUploadProductImages={props.onUploadProductImages} onUpdateProduct={props.onUpdateProduct} onDeleteProduct={props.onDeleteProduct} onBulkPriceAdjust={props.onBulkPriceAdjust} />
            )}
            {activeTab === 'leads' && (
              <Suspense fallback={<p role="status" className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">Loading contact leads…</p>}>
                <ContactLeadManager role={props.role} canSendEmail={props.role === 'admin' || props.permissions.includes('integrations')} leads={props.leads} dataError={props.leadDataError} onOpenEmailCampaigns={props.role === 'admin' ? openEmailCampaigns : undefined} onSaveLeads={props.onSaveLeads} onLoadLeadProfile={props.onLoadLeadProfile} onUpdateLead={props.onUpdateLead} onAddLeadActivity={props.onAddLeadActivity} />
              </Suspense>
            )}
            {activeTab === 'chat' && <LiveChatInbox role={props.role} />}
            {activeTab === 'email' && <HostingerMailIntegration role={props.role} mode="mailbox" initialFolder={emailInitialFolder} />}
            {activeTab === 'integrations' && <IntegrationStatus role={props.role} />}
            {activeTab === 'profile' && <ProfileManager role={props.role} email={props.email} displayName={props.displayName} onProfileUpdated={props.onProfileUpdated} />}
            {activeTab === 'staff' && props.role === 'admin' && <StaffManager onEnterAccount={props.onEnterAccount} />}
            {activeTab === 'audit' && props.role === 'admin' && <AuditLogView />}
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 lg:hidden"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </main>
      </div>
    </div>
  );
};

interface NavButtonProps {
  item: (typeof navigation)[number];
  label: string;
  active: boolean;
  onSelect: (tab: AdminTab) => void;
}

const NavButton: React.FC<NavButtonProps> = ({ item, label, active, onSelect }) => (
  <button type="button" onClick={() => onSelect(item.id)} aria-current={active ? 'page' : undefined} className={`group mb-1 flex w-full items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-left text-[13px] transition ${active ? 'border-[#1d4ed8] bg-[#e8f2fb] font-semibold text-[#1e3a5f]' : 'border-transparent font-medium text-slate-600 hover:bg-[#f1f5f9] hover:text-slate-950'}`}>
    <item.icon className={`h-[17px] w-[17px] ${active ? 'text-[#1e40af]' : 'text-slate-400 group-hover:text-slate-600'}`} />
    <span>{label}</span>
  </button>
);
