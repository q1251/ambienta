import React, { useState } from 'react';
import {
  Users,
  Package,
  FileSpreadsheet,
  Bell,
  Mail,
  Send,
  ShoppingBag,
  ExternalLink,
  ShieldCheck,
  Server,
  LogOut,
  ChevronRight,
  ClipboardList,
} from 'lucide-react';
import { Patient, CatalogItem, HostingerConfig, EmailLog, ReminderRule, OnlineOrder, PharmacistNote } from '../../types/pharmacy';
import { CrmDashboard } from '../CRM/CrmDashboard';
import { InventoryManager } from './InventoryManager';
import { OrdersManager } from './OrdersManager';
import { CsvLeadUploader } from '../CRM/CsvLeadUploader';
import { AutomatedRemindersView } from '../CRM/AutomatedRemindersView';
import { HostingerEmailSyncView } from '../CRM/HostingerEmailSyncView';
import { BulkHealthCategoryCampaignView } from '../CRM/BulkHealthCategoryCampaignView';
import { PatientDetailModal } from '../CRM/PatientDetailModal';

interface AdminLayoutProps {
  onNavigateHome: () => void;
  patients: Patient[];
  onSelectPatient: (patient: Patient) => void;
  onImportPatients: (patients: Partial<Patient>[]) => void;
  onAddManualPatient: (patient: Patient) => void;
  catalogItems: CatalogItem[];
  onAddProduct: (item: CatalogItem) => void;
  onUpdateProduct: (item: CatalogItem) => void;
  onDeleteProduct: (productId: string) => void;
  onBulkPriceAdjust: (category: string, percentChange: number) => void;
  hostingerConfig: HostingerConfig;
  onUpdateHostingerConfig: (config: HostingerConfig) => void;
  emailLogs: EmailLog[];
  onSendEmail: (log: EmailLog) => void;
  onBatchSendEmails: (logs: EmailLog[]) => void;
  reminderRules: ReminderRule[];
  onToggleReminderRule: (ruleId: string) => void;
  orders: OnlineOrder[];
  onUpdateOrderStatus: (orderId: string, newStatus: OnlineOrder['status']) => void;
  onUpdateOrderTracking?: (orderId: string, carrier: string, trackingNumber: string) => void;
  onAddOrderInternalNote?: (orderId: string, note: string) => void;
  onAddManualOrder?: (order: OnlineOrder) => void;
  selectedPatient: Patient | null;
  onClosePatientModal: () => void;
  onAddPharmacistNote: (patientId: string, note: Omit<PharmacistNote, 'id' | 'createdAt'>) => void;
  onTriggerRefillDispense: (patientId: string, rxNumber: string) => void;
}

export type AdminTab =
  | 'crm'
  | 'inventory'
  | 'leads'
  | 'reminders'
  | 'hostinger'
  | 'campaigns'
  | 'orders';

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  onNavigateHome,
  patients,
  onSelectPatient,
  onImportPatients,
  onAddManualPatient,
  catalogItems,
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct,
  onBulkPriceAdjust,
  hostingerConfig,
  onUpdateHostingerConfig,
  emailLogs,
  onSendEmail,
  onBatchSendEmails,
  reminderRules,
  onToggleReminderRule,
  orders,
  onUpdateOrderStatus,
  onUpdateOrderTracking,
  onAddOrderInternalNote,
  onAddManualOrder,
  selectedPatient,
  onClosePatientModal,
  onAddPharmacistNote,
  onTriggerRefillDispense,
}) => {
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>('crm');

  const pendingOrdersCount = orders.filter(
    (o) => o.status === 'Submitted' || o.status === 'Pharmacist Review'
  ).length;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-900">
      {/* Admin Top Navigation Bar */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-teal-600 flex items-center justify-center font-bold text-white shadow-xs">
                Rx
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base tracking-tight text-white">
                    AuraCare Clinical Admin
                  </span>
                  <span className="text-[11px] font-mono bg-teal-900/80 text-teal-300 border border-teal-700/60 px-2 py-0.5 rounded">
                    /admin portal
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Pharmacist &amp; Dispensary Operations Hub
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Hostinger Status Indicator */}
              <div className="hidden md:flex items-center gap-2 text-xs text-slate-300 bg-slate-800/80 px-3 py-1.5 rounded-md border border-slate-700">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span className="font-mono">{hostingerConfig.emailAccount}</span>
                <span className="text-slate-500">·</span>
                <span className="text-emerald-400 font-medium">Hostinger Synced</span>
              </div>

              {/* Back to Public Site */}
              <button
                onClick={onNavigateHome}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md transition-colors border border-slate-700"
              >
                <span>View Public Pharmacy (/)</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Admin Subheader with Tabs */}
      <nav className="bg-white border-b border-slate-200 sticky top-16 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-1 overflow-x-auto py-2 no-scrollbar text-xs font-semibold">
            <button
              onClick={() => setActiveAdminTab('crm')}
              className={`px-3.5 py-2 rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeAdminTab === 'crm'
                  ? 'bg-teal-800 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Patient &amp; Refill CRM ({patients.length})</span>
            </button>

            <button
              onClick={() => setActiveAdminTab('inventory')}
              className={`px-3.5 py-2 rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeAdminTab === 'inventory'
                  ? 'bg-teal-800 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>Catalog &amp; Stock Inventory ({catalogItems.length})</span>
            </button>

            <button
              onClick={() => setActiveAdminTab('orders')}
              className={`px-3.5 py-2 rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeAdminTab === 'orders'
                  ? 'bg-teal-800 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span>Dispensing Orders ({orders.length})</span>
              {pendingOrdersCount > 0 && (
                <span className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                  {pendingOrdersCount} review
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveAdminTab('leads')}
              className={`px-3.5 py-2 rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeAdminTab === 'leads'
                  ? 'bg-teal-800 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>CSV Lead Ingestion</span>
            </button>

            <button
              onClick={() => setActiveAdminTab('reminders')}
              className={`px-3.5 py-2 rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeAdminTab === 'reminders'
                  ? 'bg-teal-800 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              <span>Automated Reminders</span>
            </button>

            <button
              onClick={() => setActiveAdminTab('hostinger')}
              className={`px-3.5 py-2 rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeAdminTab === 'hostinger'
                  ? 'bg-teal-800 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>Hostinger Mailbox</span>
            </button>

            <button
              onClick={() => setActiveAdminTab('campaigns')}
              className={`px-3.5 py-2 rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${
                activeAdminTab === 'campaigns'
                  ? 'bg-teal-800 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              <span>Health Category Bulk Email</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Main Admin Content Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeAdminTab === 'crm' && (
          <CrmDashboard
            patients={patients}
            onSelectPatient={onSelectPatient}
            onImportPatients={onImportPatients}
            onAddManualPatient={onAddManualPatient}
            hostingerConfig={hostingerConfig}
            onUpdateHostingerConfig={onUpdateHostingerConfig}
            emailLogs={emailLogs}
            onSendEmail={onSendEmail}
            onBatchSendEmails={onBatchSendEmails}
            reminderRules={reminderRules}
            onToggleReminderRule={onToggleReminderRule}
            onTriggerDirectEmail={(p) => onSelectPatient(p)}
          />
        )}

        {activeAdminTab === 'inventory' && (
          <InventoryManager
            catalogItems={catalogItems}
            onAddProduct={onAddProduct}
            onUpdateProduct={onUpdateProduct}
            onDeleteProduct={onDeleteProduct}
            onBulkPriceAdjust={onBulkPriceAdjust}
          />
        )}

        {activeAdminTab === 'orders' && (
          <OrdersManager
            orders={orders}
            onUpdateOrderStatus={onUpdateOrderStatus}
            onUpdateOrderTracking={onUpdateOrderTracking}
            onAddOrderInternalNote={onAddOrderInternalNote}
            onSendEmailNotification={onSendEmail}
            onAddManualOrder={onAddManualOrder}
            catalogItems={catalogItems}
          />
        )}

        {activeAdminTab === 'leads' && (
          <CsvLeadUploader
            onImportPatients={onImportPatients}
            onAddManualPatient={onAddManualPatient}
          />
        )}

        {activeAdminTab === 'reminders' && (
          <AutomatedRemindersView
            patients={patients}
            reminderRules={reminderRules}
            onToggleRule={onToggleReminderRule}
            onDispatchReminderEmails={onBatchSendEmails}
            emailLogs={emailLogs}
          />
        )}

        {activeAdminTab === 'hostinger' && (
          <HostingerEmailSyncView
            config={hostingerConfig}
            onUpdateConfig={onUpdateHostingerConfig}
            patients={patients}
            emailLogs={emailLogs}
            onSendDirectEmail={onSendEmail}
          />
        )}

        {activeAdminTab === 'campaigns' && (
          <BulkHealthCategoryCampaignView
            patients={patients}
            onDispatchBulkCampaign={onBatchSendEmails}
            hostingerConfig={hostingerConfig}
          />
        )}
      </main>

      {/* Patient Profile Detail Modal */}
      <PatientDetailModal
        patient={selectedPatient}
        isOpen={selectedPatient !== null}
        onClose={onClosePatientModal}
        onAddNote={onAddPharmacistNote}
        onTriggerRefill={onTriggerRefillDispense}
        onOpenEmailComposer={() => {
          onClosePatientModal();
          setActiveAdminTab('hostinger');
        }}
      />
    </div>
  );
};
