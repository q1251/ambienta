import React, { useState } from 'react';
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
} from 'lucide-react';
import { Patient, ReminderRule, EmailLog } from '../../types/pharmacy';
import { evaluateDueReminders, interpolateEmailTemplate } from '../../utils/pharmacyLogic';

interface AutomatedRemindersViewProps {
  patients: Patient[];
  reminderRules: ReminderRule[];
  onToggleRule: (ruleId: string) => void;
  onDispatchReminderEmails: (logs: EmailLog[]) => void;
  emailLogs: EmailLog[];
}

export const AutomatedRemindersView: React.FC<AutomatedRemindersViewProps> = ({
  patients,
  reminderRules,
  onToggleRule,
  onDispatchReminderEmails,
  emailLogs,
}) => {
  const [lastScanResult, setLastScanResult] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  // Compute upcoming renewals across patients
  const dueItems = evaluateDueReminders(patients, reminderRules);

  const handleRunScanAndDispatch = () => {
    setIsScanning(true);
    setTimeout(() => {
      if (dueItems.length === 0) {
        setLastScanResult('Scan complete: No patients currently meet the threshold for active automated rules.');
        setIsScanning(false);
        return;
      }

      const generatedLogs: EmailLog[] = dueItems.map(({ patient, record, rule, daysLeft }) => {
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
      setLastScanResult(
        `Created ${generatedLogs.length} renewal reminder drafts. Connect a secure mail backend to send them.`
      );
      setIsScanning(false);
    }, 600);
  };

  // Filter email logs for automated reminders
  const automatedLogs = emailLogs.filter((l) => l.emailType === 'automated_renewal');

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-800 uppercase tracking-wider mb-1">
            <Bell className="w-3.5 h-3.5 text-blue-700" />
            <span>Automated Cron Engine</span>
          </div>
          <h3 className="text-base font-bold text-slate-900">
            Order Renewal Email Reminders
          </h3>
          <p className="text-xs text-slate-500">
            Proactively notifies patients prior to medication depletion to maintain uninterrupted therapy
          </p>
        </div>

        <button
          onClick={handleRunScanAndDispatch}
          disabled={isScanning}
          className="px-4 py-2 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-md transition-colors flex items-center gap-2 shadow-xs shrink-0"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>{isScanning ? 'Scanning schedules...' : 'Scan & create drafts'}</span>
        </button>
      </div>

      {lastScanResult && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between text-xs text-blue-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-blue-700 shrink-0" />
            <span className="font-semibold">{lastScanResult}</span>
          </div>
          <button
            onClick={() => setLastScanResult(null)}
            className="text-blue-700 hover:text-blue-900 text-xs font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Grid: Rules Configuration & Upcoming Due Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Configured Rules */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Trigger Automation Rules ({reminderRules.length})
            </h4>
            <p className="text-xs text-slate-500">
              Reminder drafts can be generated here; sending requires the secure mail backend.
            </p>

            <div className="space-y-3 pt-2">
              {reminderRules.map((rule) => (
                <div
                  key={rule.id}
                  className={`p-3.5 rounded-lg border transition-colors ${
                    rule.isActive
                      ? 'border-blue-200 bg-blue-50/40'
                      : 'border-slate-200 bg-slate-50 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-slate-900">{rule.title}</span>
                    <button
                      onClick={() => onToggleRule(rule.id)}
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-sm transition-colors ${
                        rule.isActive
                          ? 'bg-blue-700 text-white'
                          : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                      }`}
                    >
                      {rule.isActive ? 'Active Rule' : 'Disabled'}
                    </button>
                  </div>
                  <p className="text-xs font-mono text-slate-600 truncate">
                    Subject: {rule.subjectTemplate}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">
                    {rule.bodyTemplate}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Upcoming Renewals Queue */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Active Renewal Candidates ({dueItems.length})
              </h4>
              <span className="text-xs text-slate-500">
                Calculated for today ({new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })})
              </span>
            </div>

            {dueItems.length > 0 ? (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <tr>
                      <th className="py-2.5 px-3">Patient</th>
                      <th className="py-2.5 px-3">Rx &amp; Medication</th>
                      <th className="py-2.5 px-3">Due Date</th>
                      <th className="py-2.5 px-3">Trigger Rule</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dueItems.map(({ patient, record, rule, daysLeft }, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3">
                          <p className="font-semibold text-slate-900">
                            {patient.firstName} {patient.lastName}
                          </p>
                          <p className="text-[11px] text-slate-500">{patient.email}</p>
                        </td>
                        <td className="py-2.5 px-3">
                          <p className="font-medium text-slate-800">{record.medicationName}</p>
                          <p className="text-[11px] font-mono text-slate-400">{record.rxNumber}</p>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap font-mono">
                          <span className="font-semibold text-slate-900">{record.nextRefillDue}</span>
                          <span className="block text-[11px] text-amber-700 font-sans">
                            {daysLeft === 0 ? 'Due Today' : `${daysLeft} days away`}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="inline-block px-2 py-0.5 rounded-sm text-[11px] font-medium bg-blue-50 text-blue-800 border border-blue-200">
                            {rule.title}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 bg-slate-50 rounded-lg border border-slate-200 text-slate-500 text-xs">
                <CheckCircle2 className="w-6 h-6 mx-auto text-blue-600 mb-1" />
                <p>All patient medication renewals are up to date.</p>
              </div>
            )}
          </div>

          {/* Trigger Dispatch History */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Recent Automated Reminder Logs ({automatedLogs.length})
            </h4>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
              {automatedLogs.map((log) => (
                <div key={log.id} className="p-3 text-xs space-y-1 hover:bg-slate-50">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{log.recipientName}</span>
                    <span className="font-mono text-[11px] text-slate-400">{log.sentAt}</span>
                  </div>
                  <p className="text-slate-700 font-medium">{log.subject}</p>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span className="font-mono">{log.recipientEmail}</span>
                    <span className="text-blue-700 font-semibold bg-blue-50 px-1.5 py-0.2 rounded-sm border border-blue-200">
                      Email status: {log.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
