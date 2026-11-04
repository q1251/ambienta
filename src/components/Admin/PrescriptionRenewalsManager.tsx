import React, { useState, useMemo } from 'react';
import {
  Bell,
  Play,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Mail,
  Send,
  Calendar,
  Sparkles,
  RefreshCw,
  Search,
  Filter,
  Check,
  ChevronRight,
  ShieldAlert,
  User,
  Pill,
  ExternalLink,
  Plus,
  X,
} from 'lucide-react';
import { Patient, ReminderRule, EmailLog, RefillRecord, HealthCategory, OnlineOrder } from '../../types/pharmacy';
import { calculateDaysRemaining, determineRefillStatus, evaluateDueReminders, getLocalDateString, interpolateEmailTemplate } from '../../utils/pharmacyLogic';

interface PrescriptionRenewalsManagerProps {
  role?: 'admin' | 'operator';
  patients: Patient[];
  reminderRules: ReminderRule[];
  emailLogs: EmailLog[];
  onToggleRule: (ruleId: string) => void;
  onDispatchReminderEmails: (logs: EmailLog[]) => void;
  onFulfillRefillOrder?: (patient: Patient, record: RefillRecord) => Promise<void>;
  onNavigateToOrders?: () => void;
}

export const PrescriptionRenewalsManager: React.FC<PrescriptionRenewalsManagerProps> = ({
  role = 'admin',
  patients,
  reminderRules,
  emailLogs,
  onToggleRule,
  onDispatchReminderEmails,
  onFulfillRefillOrder,
  onNavigateToOrders,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'queue' | 'rules' | 'categories' | 'logs'>('queue');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  // Selected patient for clinical modal
  const [inspectingPatient, setInspectingPatient] = useState<Patient | null>(null);

  // Fulfilling state
  const [fulfillingRxId, setFulfillingRxId] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Quick reminder draft popover
  const [draftingRecord, setDraftingRecord] = useState<{ patient: Patient; record: RefillRecord } | null>(null);
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');

  const currentDate = getLocalDateString();

  const dueItems = useMemo(
    () => evaluateDueReminders(patients, reminderRules, currentDate),
    [patients, reminderRules, currentDate]
  );

  // Metrics
  const totalPrescriptions = useMemo(() => {
    return patients.reduce((acc, p) => acc + (p.refillHistory ? p.refillHistory.length : 0), 0);
  }, [patients]);

  const dueSoonCount = useMemo(() => {
    return patients.reduce((acc, p) => {
      return (
        acc +
        p.refillHistory.filter((r) => {
          const days = calculateDaysRemaining(r.nextRefillDue, currentDate);
          return days <= 7 && days >= 0;
        }).length
      );
    }, 0);
  }, [patients, currentDate]);

  const activeRulesCount = useMemo(() => {
    return reminderRules.filter((r) => r.isActive).length;
  }, [reminderRules]);

  // Filtered patients with refill records
  const filteredPatientPrescriptions = useMemo(() => {
    const list: Array<{ patient: Patient; record: RefillRecord; daysLeft: number }> = [];

    patients.forEach((patient) => {
      if (categoryFilter !== 'All' && patient.healthCategory !== categoryFilter) return;

      patient.refillHistory.forEach((record) => {
        const daysLeft = calculateDaysRemaining(record.nextRefillDue, currentDate);
        const computedStatus = determineRefillStatus(record.remainingRefills, daysLeft);

        if (statusFilter !== 'All' && computedStatus !== statusFilter && record.status !== statusFilter) {
          return;
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matches =
            `${patient.firstName} ${patient.lastName}`.toLowerCase().includes(q) ||
            patient.email.toLowerCase().includes(q) ||
            record.medicationName.toLowerCase().includes(q) ||
            record.rxNumber.toLowerCase().includes(q);
          if (!matches) return;
        }

        list.push({ patient, record, daysLeft });
      });
    });

    // Sort by daysLeft ascending (most urgent first)
    return list.sort((a, b) => a.daysLeft - b.daysLeft);
  }, [patients, categoryFilter, statusFilter, searchQuery, currentDate]);

  // Automated scan and dispatch
  const handleRunScanAndDispatch = () => {
    setIsScanning(true);
    setScanResult(null);

    setTimeout(() => {
      if (dueItems.length === 0) {
        setScanResult('Scan complete: No patients currently meet the threshold for active automated rules.');
        setIsScanning(false);
        return;
      }

      const generatedLogs: EmailLog[] = dueItems.map(({ patient, record, rule }) => {
        const vars = {
          patient_name: `${patient.firstName} ${patient.lastName}`,
          medication: record.medicationName,
          rx_number: record.rxNumber,
          renewal_date: record.nextRefillDue,
          primary_doctor: patient.primaryDoctor,
        };

        const subject = interpolateEmailTemplate(rule.subjectTemplate, vars);
        const body = interpolateEmailTemplate(rule.bodyTemplate, vars);

        return {
          id: `auto-log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          recipientEmail: patient.email,
          recipientName: `${patient.firstName} ${patient.lastName}`,
          subject,
          body,
          status: 'Draft',
          sentAt: new Date().toLocaleString(),
          emailType: 'automated_renewal',
          healthCategory: patient.healthCategory,
          rxNumber: record.rxNumber,
        };
      });

      onDispatchReminderEmails(generatedLogs);
      setScanResult(`Generated ${generatedLogs.length} automated renewal reminder drafts and queued to Hostinger mail.`);
      setIsScanning(false);
    }, 500);
  };

  const handleOpenQuickDraft = (patient: Patient, record: RefillRecord) => {
    const vars = {
      patient_name: `${patient.firstName} ${patient.lastName}`,
      medication: record.medicationName,
      rx_number: record.rxNumber,
      renewal_date: record.nextRefillDue,
      primary_doctor: patient.primaryDoctor,
    };
    const matchingRule = reminderRules.find((r) => r.isActive) || reminderRules[0];
    const subject = matchingRule
      ? interpolateEmailTemplate(matchingRule.subjectTemplate, vars)
      : `Prescription Renewal Due: ${record.medicationName} (Rx #${record.rxNumber})`;
    const body = matchingRule
      ? interpolateEmailTemplate(matchingRule.bodyTemplate, vars)
      : `Dear ${patient.firstName},\n\nYour prescription for ${record.medicationName} is scheduled for renewal on ${record.nextRefillDue}.\n\nPlease let us know if you wish to proceed with courier fulfillment.\n\nWarm regards,\nAmbients Dispensary`;

    setDraftSubject(subject);
    setDraftBody(body);
    setDraftingRecord({ patient, record });
  };

  const handleConfirmDraftSend = () => {
    if (!draftingRecord) return;
    const log: EmailLog = {
      id: `manual-log-${Date.now()}`,
      recipientEmail: draftingRecord.patient.email,
      recipientName: `${draftingRecord.patient.firstName} ${draftingRecord.patient.lastName}`,
      subject: draftSubject,
      body: draftBody,
      status: 'Draft',
      sentAt: new Date().toLocaleString(),
      emailType: 'automated_renewal',
      healthCategory: draftingRecord.patient.healthCategory,
      rxNumber: draftingRecord.record.rxNumber,
    };
    onDispatchReminderEmails([log]);
    setActionSuccess(`Reminder notice created for ${draftingRecord.patient.firstName} ${draftingRecord.patient.lastName}.`);
    setDraftingRecord(null);
  };

  const handle1ClickFulfill = async (patient: Patient, record: RefillRecord) => {
    setFulfillingRxId(record.id);
    setActionSuccess(null);
    try {
      if (onFulfillRefillOrder) {
        await onFulfillRefillOrder(patient, record);
      } else {
        // Fallback: create order via API
        await fetch('/api/data.php?resource=orders', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            patientName: `${patient.firstName} ${patient.lastName}`,
            email: patient.email,
            phone: patient.phone,
            rxNumber: record.rxNumber,
            medicationName: `${record.medicationName} (${record.strength})`,
            deliveryMethod: 'Express Courier',
            deliveryAddress: patient.address,
            orderType: 'Medication Refill',
            items: [
              {
                productId: `rx-${record.rxNumber.toLowerCase()}`,
                name: record.medicationName,
                category: patient.healthCategory === 'Sleep' ? 'Sleep' : 'Daily Wellness',
                quantity: 1,
                unitPrice: 35.0,
                dosage: record.dosageForm,
                rxRequired: true,
              },
            ],
            subtotal: 35.0,
            shippingFee: 0,
            totalAmount: 35.0,
          }),
        });
      }
      setActionSuccess(`Refill order successfully created for ${record.medicationName} (Rx #${record.rxNumber})!`);
    } catch (err) {
      console.error('Refill order fulfillment failed', err);
    } finally {
      setFulfillingRxId(null);
    }
  };

  const automatedLogs = emailLogs.filter((l) => l.emailType === 'automated_renewal');

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#315649]">
            <Clock className="h-3.5 w-3.5" />
            <span>Prescription Care &amp; Maintenance</span>
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Rx Renewals &amp; Automated Refills
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Monitors patient maintenance therapies, triggers proactive replenishment alerts, and fulfills recurring medication orders.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleRunScanAndDispatch}
            disabled={isScanning}
            className="inline-flex items-center gap-2 rounded-lg bg-[#27483e] px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[#1f3b33] disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>{isScanning ? 'Scanning schedules…' : 'Run cron scan'}</span>
          </button>
          {onNavigateToOrders && (
            <button
              type="button"
              onClick={onNavigateToOrders}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <span>View live orders</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Notifications / Feedback */}
      {scanResult && (
        <div className="flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50/70 p-3.5 text-xs text-teal-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-teal-700" />
            <span className="font-semibold">{scanResult}</span>
          </div>
          <button
            type="button"
            onClick={() => setScanResult(null)}
            className="text-xs font-bold text-teal-800 hover:text-teal-950"
          >
            Dismiss
          </button>
        </div>
      )}

      {actionSuccess && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
            <span className="font-semibold">{actionSuccess}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionSuccess(null)}
            className="text-xs font-bold text-emerald-800 hover:text-emerald-950"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Executive KPI Metric Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-[#e5e7e1] bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Due within 7 days</span>
            <AlertCircle className="h-4 w-4 text-amber-600" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{dueSoonCount}</p>
          <p className="mt-1 text-[11px] text-amber-700 font-medium">Require proactive outreach</p>
        </div>

        <div className="rounded-xl border border-[#e5e7e1] bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Active Therapies</span>
            <Pill className="h-4 w-4 text-[#315649]" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{totalPrescriptions}</p>
          <p className="mt-1 text-[11px] text-slate-500">{patients.length} active patients</p>
        </div>

        <div className="rounded-xl border border-[#e5e7e1] bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Automated Rules</span>
            <Bell className="h-4 w-4 text-teal-600" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{activeRulesCount}</p>
          <p className="mt-1 text-[11px] text-teal-700 font-medium">Cron triggers enabled</p>
        </div>

        <div className="rounded-xl border border-[#e5e7e1] bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-semibold uppercase tracking-wider">Queued Notices</span>
            <Mail className="h-4 w-4 text-purple-600" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{automatedLogs.length}</p>
          <p className="mt-1 text-[11px] text-slate-500">Drafts generated</p>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveSubTab('queue')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition ${
            activeSubTab === 'queue'
              ? 'border-[#2d5244] text-[#224136]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Clock className="h-3.5 w-3.5" />
          <span>Renewal Queue ({filteredPatientPrescriptions.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('rules')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition ${
            activeSubTab === 'rules'
              ? 'border-[#2d5244] text-[#224136]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Bell className="h-3.5 w-3.5" />
          <span>Automation Rules ({reminderRules.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('categories')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition ${
            activeSubTab === 'categories'
              ? 'border-[#2d5244] text-[#224136]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Filter className="h-3.5 w-3.5" />
          <span>Health Categories &amp; Campaigns</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('logs')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition ${
            activeSubTab === 'logs'
              ? 'border-[#2d5244] text-[#224136]'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Mail className="h-3.5 w-3.5" />
          <span>Trigger History &amp; Logs ({automatedLogs.length})</span>
        </button>
      </div>

      {/* TAB 1: RENEWAL QUEUE */}
      {activeSubTab === 'queue' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:flex-row sm:items-center sm:justify-between text-xs">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search patient, medication name, or Rx number..."
                className="w-full rounded-lg border border-slate-200 bg-[#f9faf8] py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#315649] focus:bg-white focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1">
                <span className="text-slate-400">Category:</span>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="bg-transparent font-medium text-slate-700 focus:outline-none cursor-pointer"
                >
                  <option value="All">All Categories</option>
                  <option value="Sleep">Sleep</option>
                  <option value="Weight Loss">Weight Loss</option>
                  <option value="Diabetes Care">Diabetes Care</option>
                  <option value="Cardiology / Hypertension">Cardiology</option>
                  <option value="Asthma &amp; Respiratory">Respiratory</option>
                  <option value="Daily Wellness">Daily Wellness</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1">
                <span className="text-slate-400">Refill Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-transparent font-medium text-slate-700 focus:outline-none cursor-pointer"
                >
                  <option value="All">All Statuses</option>
                  <option value="Due Soon">Due Soon (&le; 5 days)</option>
                  <option value="Active">Active Supply</option>
                  <option value="Renewal Required">Renewal Required (0 refills)</option>
                  <option value="Overdue">Overdue</option>
                </select>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-xl border border-[#e5e7e1] bg-white shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#e5e7e1] bg-[#f9faf8] text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Patient &amp; Contact</th>
                    <th className="px-4 py-3">Prescription &amp; Dosage</th>
                    <th className="px-4 py-3">Doctor / Clinic</th>
                    <th className="px-4 py-3">Renewal Due Date</th>
                    <th className="px-4 py-3">Refills Left</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPatientPrescriptions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                        No maintenance prescriptions match the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredPatientPrescriptions.map(({ patient, record, daysLeft }) => {
                      const computedStatus = determineRefillStatus(record.remainingRefills, daysLeft);
                      const isOverdue = daysLeft < 0;
                      const isDueSoon = daysLeft >= 0 && daysLeft <= 5;

                      return (
                        <tr key={record.id} className="hover:bg-slate-50/70 transition">
                          {/* Patient */}
                          <td className="px-4 py-3.5">
                            <button
                              type="button"
                              onClick={() => setInspectingPatient(patient)}
                              className="text-left group"
                            >
                              <p className="font-semibold text-slate-900 group-hover:text-[#2d5244] flex items-center gap-1.5">
                                <span>{patient.firstName} {patient.lastName}</span>
                                <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </p>
                              <p className="font-mono text-[11px] text-slate-500">{patient.email}</p>
                              <span className="mt-0.5 inline-block text-[10px] text-slate-400">
                                {patient.healthCategory}
                              </span>
                            </button>
                          </td>

                          {/* Rx Details */}
                          <td className="px-4 py-3.5 max-w-xs">
                            <p className="font-semibold text-slate-900">{record.medicationName}</p>
                            <p className="text-[11px] text-slate-500">{record.strength} · {record.dosageForm}</p>
                            <span className="font-mono text-[10px] text-slate-400">Rx #{record.rxNumber}</span>
                          </td>

                          {/* Doctor */}
                          <td className="px-4 py-3.5">
                            <p className="font-medium text-slate-800">{record.providerDoctor}</p>
                            <p className="text-[11px] text-slate-400">{record.doctorClinic}</p>
                          </td>

                          {/* Renewal Date */}
                          <td className="px-4 py-3.5 whitespace-nowrap">
                            <span className="font-mono font-semibold text-slate-900">{record.nextRefillDue}</span>
                            <span className={`block text-[11px] font-medium ${
                              isOverdue ? 'text-rose-600' : isDueSoon ? 'text-amber-700' : 'text-slate-500'
                            }`}>
                              {daysLeft === 0
                                ? 'Due today'
                                : daysLeft < 0
                                ? `${Math.abs(daysLeft)}d overdue`
                                : `${daysLeft} days away`}
                            </span>
                          </td>

                          {/* Remaining Refills */}
                          <td className="px-4 py-3.5 font-mono">
                            <span className={`font-bold ${record.remainingRefills > 0 ? 'text-slate-800' : 'text-rose-600'}`}>
                              {record.remainingRefills}
                            </span>
                            <span className="text-[11px] text-slate-400 ml-1">remaining</span>
                          </td>

                          {/* Status Badge */}
                          <td className="px-4 py-3.5">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                              computedStatus === 'Due Soon'
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : computedStatus === 'Overdue'
                                ? 'bg-rose-50 text-rose-800 border border-rose-200'
                                : computedStatus === 'Renewal Required'
                                ? 'bg-purple-50 text-purple-800 border border-purple-200'
                                : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            }`}>
                              {computedStatus}
                            </span>
                          </td>

                          {/* 1-Click Actions */}
                          <td className="px-4 py-3.5 text-right whitespace-nowrap space-x-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenQuickDraft(patient, record)}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
                              title="Draft reminder notice"
                            >
                              <Mail className="h-3 w-3 text-slate-500" />
                              <span>Draft notice</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => void handle1ClickFulfill(patient, record)}
                              disabled={fulfillingRxId === record.id}
                              className="inline-flex items-center gap-1 rounded-md bg-[#2d5244] px-2.5 py-1 text-[11px] font-semibold text-white shadow-2xs transition hover:bg-[#234237] disabled:opacity-50"
                              title="1-click create refill order"
                            >
                              <RefreshCw className={`h-3 w-3 ${fulfillingRxId === record.id ? 'animate-spin' : ''}`} />
                              <span>{fulfillingRxId === record.id ? 'Processing…' : 'Refill order'}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: AUTOMATION RULES */}
      {activeSubTab === 'rules' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8 space-y-4">
            <div className="rounded-xl border border-[#e5e7e1] bg-white p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Trigger Automation Schedules</h3>
                  <p className="text-xs text-slate-500">
                    Active rules automatically evaluate all patients and queue reminders before medication runs out.
                  </p>
                </div>
              </div>

              <div className="space-y-3.5">
                {reminderRules.map((rule) => (
                  <div
                    key={rule.id}
                    className={`rounded-xl border p-4 transition ${
                      rule.isActive
                        ? 'border-teal-200 bg-teal-50/30'
                        : 'border-slate-200 bg-slate-50/60 opacity-70'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${
                          rule.isActive ? 'bg-[#2d5244] text-white' : 'bg-slate-200 text-slate-600'
                        }`}>
                          {rule.daysBeforeDue}d
                        </span>
                        <h4 className="text-xs font-bold text-slate-900">{rule.title}</h4>
                      </div>

                      <button
                        type="button"
                        onClick={() => onToggleRule(rule.id)}
                        className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                          rule.isActive
                            ? 'bg-[#2d5244] text-white hover:bg-[#244237]'
                            : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                        }`}
                      >
                        {rule.isActive ? 'Active Rule' : 'Inactive'}
                      </button>
                    </div>

                    <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-3 text-xs">
                      <p className="font-mono text-slate-700 text-[11px] font-semibold">
                        Subject: <span className="text-[#2d5244]">{rule.subjectTemplate}</span>
                      </p>
                      <p className="whitespace-pre-line text-slate-600 text-[11px] leading-relaxed">
                        {rule.bodyTemplate}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-4 space-y-4">
            <div className="rounded-xl border border-[#e5e7e1] bg-white p-5 shadow-2xs space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Template Variables
              </h3>
              <p className="text-xs text-slate-500">
                These tags are dynamically replaced with individual patient data during scan and dispatch:
              </p>

              <div className="space-y-2 text-xs">
                <div className="rounded-lg bg-slate-50 p-2 border border-slate-200">
                  <span className="font-mono font-bold text-[#2d5244]">{`{{patient_name}}`}</span>
                  <p className="text-[11px] text-slate-500">Full legal name of the patient</p>
                </div>

                <div className="rounded-lg bg-slate-50 p-2 border border-slate-200">
                  <span className="font-mono font-bold text-[#2d5244]">{`{{medication}}`}</span>
                  <p className="text-[11px] text-slate-500">Medication brand and clinical name</p>
                </div>

                <div className="rounded-lg bg-slate-50 p-2 border border-slate-200">
                  <span className="font-mono font-bold text-[#2d5244]">{`{{rx_number}}`}</span>
                  <p className="text-[11px] text-slate-500">Official prescription reference code</p>
                </div>

                <div className="rounded-lg bg-slate-50 p-2 border border-slate-200">
                  <span className="font-mono font-bold text-[#2d5244]">{`{{renewal_date}}`}</span>
                  <p className="text-[11px] text-slate-500">Calculated date of medication depletion</p>
                </div>

                <div className="rounded-lg bg-slate-50 p-2 border border-slate-200">
                  <span className="font-mono font-bold text-[#2d5244]">{`{{primary_doctor}}`}</span>
                  <p className="text-[11px] text-slate-500">Authorizing physician or clinic</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: HEALTH CATEGORIES */}
      {activeSubTab === 'categories' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(['Sleep', 'Weight Loss', 'Diabetes Care', 'Cardiology / Hypertension', 'Daily Wellness'] as HealthCategory[]).map(
            (category) => {
              const matched = patients.filter((p) => p.healthCategory === category);
              const totalMeds = matched.reduce((acc, p) => acc + p.refillHistory.length, 0);

              return (
                <div key={category} className="rounded-xl border border-[#e5e7e1] bg-white p-5 shadow-2xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="rounded-md bg-[#edf2ed] px-2 py-0.5 text-[11px] font-bold text-[#28483b]">
                      {category}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">{matched.length} patients</span>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-slate-900">{category} Maintenance</h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {totalMeds} active prescription protocols under dispensary care.
                    </p>
                  </div>

                  <div className="border-t border-slate-100 pt-3 flex items-center justify-between text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setCategoryFilter(category);
                        setActiveSubTab('queue');
                      }}
                      className="font-semibold text-[#2d5244] hover:underline"
                    >
                      Filter renewal queue &rarr;
                    </button>
                  </div>
                </div>
              );
            }
          )}
        </div>
      )}

      {/* TAB 4: DISPATCH HISTORY & LOGS */}
      {activeSubTab === 'logs' && (
        <div className="overflow-hidden rounded-xl border border-[#e5e7e1] bg-white shadow-2xs">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Renewal Notice Activity Log ({automatedLogs.length})</h3>
            <span className="text-xs text-slate-500">Synced with Hostinger email queue</span>
          </div>

          <div className="divide-y divide-slate-100">
            {automatedLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No renewal notice logs generated yet. Click &quot;Run cron scan&quot; or &quot;Draft notice&quot; to queue messages.
              </div>
            ) : (
              automatedLogs.map((log) => (
                <div key={log.id} className="p-4 hover:bg-slate-50/70 transition text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">{log.recipientName}</span>
                      <span className="font-mono text-slate-400 text-[11px]">({log.recipientEmail})</span>
                      {log.rxNumber && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                          {log.rxNumber}
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-slate-400">{log.sentAt}</span>
                  </div>

                  <p className="font-medium text-slate-800">{log.subject}</p>
                  <p className="text-slate-600 line-clamp-2 text-[11px] font-sans">{log.body}</p>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">
                      Category: {log.healthCategory || 'General Care'}
                    </span>
                    <span className="rounded bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-800 border border-teal-200">
                      Status: {log.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* QUICK REMINDER DRAFT POPOVER MODAL */}
      {draftingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Compose Renewal Reminder</h3>
                <p className="text-xs text-slate-500">
                  Recipient: {draftingRecord.patient.firstName} {draftingRecord.patient.lastName} ({draftingRecord.patient.email})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDraftingRecord(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={draftSubject}
                  onChange={(e) => setDraftSubject(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 focus:outline-none focus:border-[#315649]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Message Body</label>
                <textarea
                  rows={6}
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 focus:outline-none focus:border-[#315649]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setDraftingRecord(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDraftSend}
                className="rounded-lg bg-[#2d5244] px-4 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-[#234237]"
              >
                Queue reminder draft
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PATIENT CLINICAL DETAIL MODAL */}
      {inspectingPatient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-2xl text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#e8eeea] text-sm font-bold text-[#2d5244]">
                  {inspectingPatient.firstName.slice(0, 1)}
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {inspectingPatient.firstName} {inspectingPatient.lastName}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    {inspectingPatient.email} · {inspectingPatient.phone}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectingPatient(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Clinical Overview Grid */}
            <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-lg border border-slate-200">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Primary Physician</span>
                <span className="font-semibold text-slate-800">{inspectingPatient.primaryDoctor}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Health Category</span>
                <span className="font-semibold text-slate-800">{inspectingPatient.healthCategory}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Insurance</span>
                <span className="font-semibold text-slate-800">{inspectingPatient.insuranceProvider} ({inspectingPatient.insurancePolicyNumber})</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Documented Allergies</span>
                <span className="font-semibold text-rose-700">{inspectingPatient.allergies.join(', ') || 'No known allergies'}</span>
              </div>
            </div>

            {/* Active Prescriptions */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Active Maintenance Prescriptions ({inspectingPatient.refillHistory.length})
              </h4>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                {inspectingPatient.refillHistory.map((rx) => (
                  <div key={rx.id} className="p-3 bg-white hover:bg-slate-50 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{rx.medicationName} ({rx.strength})</p>
                      <p className="text-[11px] text-slate-500">{rx.dosageForm} · Qty: {rx.quantity} · {rx.refillInstructions}</p>
                      <p className="font-mono text-[10px] text-slate-400">Rx #{rx.rxNumber} · Prescribed by {rx.providerDoctor}</p>
                    </div>
                    <div className="text-right">
                      <span className="font-mono font-bold text-slate-800 block">Due: {rx.nextRefillDue}</span>
                      <span className="text-[11px] font-semibold text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded">
                        {rx.remainingRefills} refills left
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Pharmacist Notes */}
            {inspectingPatient.notes && inspectingPatient.notes.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Pharmacist Clinical Notes
                </h4>
                <div className="space-y-2">
                  {inspectingPatient.notes.map((note) => (
                    <div key={note.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">{note.authorName} ({note.authorTitle})</span>
                        <span className="text-[10px] text-slate-400 font-mono">{note.createdAt}</span>
                      </div>
                      <p className="text-slate-600 text-[11px]">{note.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-slate-100 pt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setInspectingPatient(null)}
                className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
              >
                Close Profile
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
