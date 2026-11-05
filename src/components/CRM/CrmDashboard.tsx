import React, { useState } from 'react';
import {
  Users,
  FileSpreadsheet,
  Bell,
  Mail,
  Send,
  Search,
  Filter,
  Plus,
  ArrowUpRight,
  ShieldAlert,
  Server,
  RefreshCw,
  Clock,
  Pill,
} from 'lucide-react';
import { ContactLead, Patient, HostingerConfig, EmailLog, ReminderRule, HealthCategory } from '../../types/pharmacy';
import { calculateDaysRemaining } from '../../utils/pharmacyLogic';
import { ContactLeadManager } from './ContactLeadManager';
import { AutomatedRemindersView } from './AutomatedRemindersView';
import { HostingerEmailSyncView } from './HostingerEmailSyncView';
import { BulkHealthCategoryCampaignView } from './BulkHealthCategoryCampaignView';

interface CrmDashboardProps {
  patients: Patient[];
  onSelectPatient: (patient: Patient) => void;
  leads: ContactLead[];
  leadDataError?: string;
  onSaveLeads: (leads: Omit<ContactLead, 'id' | 'createdAt'>[]) => Promise<void>;
  hostingerConfig: HostingerConfig;
  onUpdateHostingerConfig: (config: HostingerConfig) => void;
  emailLogs: EmailLog[];
  onSendEmail: (log: EmailLog) => void;
  onBatchSendEmails: (logs: EmailLog[]) => void;
  reminderRules: ReminderRule[];
  onToggleReminderRule: (ruleId: string) => void;
  onTriggerDirectEmail: (patient: Patient) => void;
}

export const CrmDashboard: React.FC<CrmDashboardProps> = ({
  patients,
  onSelectPatient,
  leads,
  leadDataError,
  onSaveLeads,
  hostingerConfig,
  onUpdateHostingerConfig,
  emailLogs,
  onSendEmail,
  onBatchSendEmails,
  reminderRules,
  onToggleReminderRule,
  onTriggerDirectEmail,
}) => {
  const [activeTab, setActiveTab] = useState<'patients' | 'leads' | 'reminders' | 'hostinger' | 'bulk'>('patients');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All Categories');
  const [selectedStatus, setSelectedStatus] = useState<string>('All Statuses');

  // Compute stats
  const totalPatients = patients.length;
  const dueRefillsCount = patients.reduce((acc, p) => {
    return (
      acc +
      p.refillHistory.filter(
        (r) => r.status === 'Due Soon' || r.status === 'Renewal Required' || r.status === 'Overdue'
      ).length
    );
  }, 0);
  const totalNotesCount = patients.reduce((acc, p) => acc + p.notes.length, 0);
  const deliveredEmailCount = emailLogs.filter((log) =>
    ['Delivered', 'Opened', 'Replied'].includes(log.status)
  ).length;
  const openedEmailCount = emailLogs.filter((log) =>
    ['Opened', 'Replied'].includes(log.status) || Boolean(log.openedAt)
  ).length;

  // Filtered patients
  const filteredPatients = patients.filter((p) => {
    const matchesSearch =
      p.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.lastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.phone.includes(searchQuery) ||
      p.refillHistory.some(
        (r) =>
          r.rxNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
          r.medicationName.toLowerCase().includes(searchQuery.toLowerCase())
      );

    const matchesCategory =
      selectedCategory === 'All Categories' || p.healthCategory === selectedCategory;

    const matchesStatus =
      selectedStatus === 'All Statuses' ||
      p.refillHistory.some((r) => r.status === selectedStatus);

    return matchesSearch && matchesCategory && matchesStatus;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* CRM Header & Top KPI Metrics */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-800 uppercase tracking-wider mb-1">
            <span className="w-2 h-2 rounded-full bg-blue-600"></span>
            <span>Clinical Dispensary Administration</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Pharmacy Patient &amp; Refill CRM
          </h2>
          <p className="text-xs text-slate-500">
            Lead uploads, customer refill lifecycles, automated renewals &amp; Hostinger synchronization
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('leads')}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md transition-colors flex items-center gap-1.5 shadow-xs"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-blue-700" />
            <span>Upload Leads (CSV)</span>
          </button>
          <button
            onClick={() => setActiveTab('hostinger')}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors flex items-center gap-1.5 shadow-xs"
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Hostinger Mailbox</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Managed Patients</span>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900">{totalPatients}</div>
          <p className="text-[11px] text-slate-400 mt-1">Active customer profiles</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Refills Due This Week</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-800">{dueRefillsCount}</div>
          <p className="text-[11px] text-slate-400 mt-1">Pending order renewal</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Email delivery / opens</span>
            <Mail className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-blue-800">{deliveredEmailCount} / {openedEmailCount}</div>
          <p className="text-[11px] text-slate-400 mt-1">Delivered / opened · provider not connected</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Secure Pharmacist Notes</span>
            <ShieldAlert className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900">{totalNotesCount}</div>
          <p className="text-[11px] text-slate-400 mt-1">Clinical reviews &amp; interactions</p>
        </div>
      </div>

      {/* Segmented Sub-Navigation Bar */}
      <div className="flex items-center gap-1.5 border-b border-slate-200 overflow-x-auto pb-2 no-scrollbar">
        <button
          onClick={() => setActiveTab('patients')}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'patients'
              ? 'bg-blue-800 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Patients &amp; Refill Directory</span>
        </button>

        <button
          onClick={() => setActiveTab('leads')}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'leads'
              ? 'bg-blue-800 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          <span>Lead Ingestion (CSV / Manual)</span>
        </button>

        <button
          onClick={() => setActiveTab('reminders')}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'reminders'
              ? 'bg-blue-800 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Bell className="w-3.5 h-3.5" />
          <span>Automated Renewal Reminders</span>
        </button>

        <button
          onClick={() => setActiveTab('hostinger')}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'hostinger'
              ? 'bg-blue-800 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Server className="w-3.5 h-3.5" />
          <span>Email Workspace</span>
        </button>

        <button
          onClick={() => setActiveTab('bulk')}
          className={`px-4 py-2 text-xs font-semibold rounded-md transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'bulk'
              ? 'bg-blue-800 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          <span>Health Category Bulk Campaigns</span>
        </button>
      </div>

      {/* SUB-VIEW 1: PATIENTS & REFILL DIRECTORY */}
      {activeTab === 'patients' && (
        <div className="space-y-4">
          {/* Filter and Search Bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search patient name, email, Rx number (e.g. RX-884219), or medication..."
                className="w-full bg-slate-50 border border-slate-300 rounded-md pl-9 pr-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-xs text-slate-800"
              >
                <option value="All Categories">All Health Categories</option>
                <option value="Cardiology / Hypertension">Cardiology / Hypertension</option>
                <option value="Diabetes Care">Diabetes Care</option>
                <option value="Asthma & Respiratory">Asthma &amp; Respiratory</option>
                <option value="Senior Wellness">Senior Wellness</option>
                <option value="Dermatology & Topicals">Dermatology &amp; Topicals</option>
                <option value="Allergies & Immunology">Allergies &amp; Immunology</option>
                <option value="General Care">General Care</option>
              </select>

              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-xs text-slate-800"
              >
                <option value="All Statuses">All Refill Statuses</option>
                <option value="Due Soon">Due Soon</option>
                <option value="Renewal Required">Renewal Required</option>
                <option value="Active">Active</option>
                <option value="Overdue">Overdue</option>
              </select>
            </div>
          </div>

          {/* Patients Data Grid */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Patient Profile</th>
                    <th className="py-3 px-3">Health Category</th>
                    <th className="py-3 px-3">Active Medication &amp; Rx #</th>
                    <th className="py-3 px-3">Next Renewal Date</th>
                    <th className="py-3 px-3 text-center">Refills Left</th>
                    <th className="py-3 px-3 text-center">Clinical Notes</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPatients.map((patient) => {
                    const primaryRx = patient.refillHistory[0];
                    const daysRemaining = primaryRx
                      ? calculateDaysRemaining(primaryRx.nextRefillDue)
                      : null;

                    return (
                      <tr
                        key={patient.id}
                        onClick={() => onSelectPatient(patient)}
                        className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                      >
                        <td className="py-3 px-4">
                          <p className="font-bold text-slate-900">
                            {patient.firstName} {patient.lastName}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500">{patient.email}</p>
                          <p className="text-[11px] text-slate-400">{patient.phone}</p>
                        </td>

                        <td className="py-3 px-3">
                          <span className="font-semibold text-blue-800 bg-blue-50 px-2 py-0.5 rounded-sm border border-blue-200">
                            {patient.healthCategory}
                          </span>
                          <span className="block text-[11px] text-slate-400 mt-1">
                            Dr: {patient.primaryDoctor.split('(')[0]}
                          </span>
                        </td>

                        <td className="py-3 px-3">
                          {primaryRx ? (
                            <div>
                              <p className="font-medium text-slate-800">{primaryRx.medicationName}</p>
                              <p className="text-[11px] font-mono text-slate-500">
                                {primaryRx.rxNumber} · {primaryRx.strength}
                              </p>
                            </div>
                          ) : (
                            <span className="text-slate-400 italic">No Rx on file</span>
                          )}
                        </td>

                        <td className="py-3 px-3 font-mono">
                          {primaryRx ? (
                            <div>
                              <span className="font-semibold text-slate-900">{primaryRx.nextRefillDue}</span>
                              <span
                                className={`block text-[11px] font-sans font-medium ${
                                  daysRemaining !== null && daysRemaining <= 3
                                    ? 'text-rose-600'
                                    : 'text-slate-500'
                                }`}
                              >
                                {daysRemaining !== null
                                  ? daysRemaining > 0
                                    ? `In ${daysRemaining} days`
                                    : daysRemaining === 0
                                    ? 'Due Today'
                                    : `${Math.abs(daysRemaining)} days overdue`
                                  : ''}
                              </span>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>

                        <td className="py-3 px-3 text-center font-mono font-bold text-slate-900">
                          {primaryRx?.remainingRefills ?? 0}
                        </td>

                        <td className="py-3 px-3 text-center">
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                            {patient.notes.length}
                          </span>
                        </td>

                        <td
                          className="py-3 px-4 text-right space-x-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => onTriggerDirectEmail(patient)}
                            title="Direct Email via Hostinger"
                            className="p-1.5 text-slate-500 hover:text-blue-800 hover:bg-slate-100 rounded-md transition-colors"
                          >
                            <Mail className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onSelectPatient(patient)}
                            className="px-2.5 py-1 text-xs font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md transition-colors"
                          >
                            View Record
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredPatients.length === 0 && (
              <div className="text-center py-12 text-slate-500 text-xs">
                No patients match the specified search or filter parameters.
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-VIEW 2: LEAD INGESTION (CSV / MANUAL) */}
      {activeTab === 'leads' && (
        <ContactLeadManager
          leads={leads}
          dataError={leadDataError}
          onSaveLeads={onSaveLeads}
        />
      )}

      {/* SUB-VIEW 3: AUTOMATED RENEWAL REMINDERS */}
      {activeTab === 'reminders' && (
        <AutomatedRemindersView
          patients={patients}
          reminderRules={reminderRules}
          onToggleRule={onToggleReminderRule}
          onDispatchReminderEmails={onBatchSendEmails}
          emailLogs={emailLogs}
        />
      )}

      {/* SUB-VIEW 4: HOSTINGER SYNCED MAILBOX */}
      {activeTab === 'hostinger' && (
        <HostingerEmailSyncView
          config={hostingerConfig}
          onUpdateConfig={onUpdateHostingerConfig}
          patients={patients}
          emailLogs={emailLogs}
          onSendDirectEmail={onSendEmail}
        />
      )}

      {/* SUB-VIEW 5: BULK CAMPAIGNS BY HEALTH CATEGORY */}
      {activeTab === 'bulk' && (
        <BulkHealthCategoryCampaignView
          patients={patients}
          onDispatchBulkCampaign={onBatchSendEmails}
          hostingerConfig={hostingerConfig}
        />
      )}
    </div>
  );
};
