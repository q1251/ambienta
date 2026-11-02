import React, { useState } from 'react';
import {
  Mail,
  Send,
  RefreshCw,
  Server,
  CheckCircle2,
  AlertCircle,
  FileText,
  User,
  ShieldCheck,
  Sparkles,
  Inbox,
  ArrowRight,
} from 'lucide-react';
import { Patient, HostingerConfig, EmailLog } from '../../types/pharmacy';
import { interpolateEmailTemplate } from '../../utils/pharmacyLogic';

interface HostingerEmailSyncViewProps {
  config: HostingerConfig;
  onUpdateConfig: (config: HostingerConfig) => void;
  patients: Patient[];
  emailLogs: EmailLog[];
  onSendDirectEmail: (log: EmailLog) => void;
  preselectedPatient?: Patient | null;
}

export const HostingerEmailSyncView: React.FC<HostingerEmailSyncViewProps> = ({
  config,
  onUpdateConfig,
  patients,
  emailLogs,
  onSendDirectEmail,
  preselectedPatient,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'compose' | 'history' | 'settings'>('compose');

  // Connection testing state
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Sync state
  const [isSyncingDb, setIsSyncingDb] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Compose form state
  const [selectedPatientId, setSelectedPatientId] = useState<string>(
    preselectedPatient?.id || (patients.length > 0 ? patients[0].id : '')
  );
  const [recipientEmail, setRecipientEmail] = useState<string>(
    preselectedPatient?.email || (patients.length > 0 ? patients[0].email : '')
  );
  const [recipientName, setRecipientName] = useState<string>(
    preselectedPatient ? `${preselectedPatient.firstName} ${preselectedPatient.lastName}` : (patients.length > 0 ? `${patients[0].firstName} ${patients[0].lastName}` : '')
  );
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sendSuccessMessage, setSendSuccessMessage] = useState<string | null>(null);

  const handlePatientSelectChange = (patientId: string) => {
    setSelectedPatientId(patientId);
    const p = patients.find((item) => item.id === patientId);
    if (p) {
      setRecipientEmail(p.email);
      setRecipientName(`${p.firstName} ${p.lastName}`);
    }
  };

  const handleApplyTemplate = (templateType: string) => {
    const currentPatient = patients.find((p) => p.id === selectedPatientId);
    const rx = currentPatient?.refillHistory?.[0];
    const vars = {
      patient_name: recipientName || 'Valued Patient',
      medication: rx?.medicationName || 'Prescribed Medication',
      rx_number: rx?.rxNumber || 'RX-ON-FILE',
      renewal_date: rx?.nextRefillDue || 'Upcoming',
      primary_doctor: currentPatient?.primaryDoctor || 'Your Physician',
    };

    if (templateType === 'pickup_ready') {
      setSubject(`Your Medication Order is Ready for Pickup (${vars.medication})`);
      setBody(
        `Dear ${vars.patient_name},\n\nYour order for ${vars.medication} (Rx #${vars.rx_number}) has been packaged, safety sealed, and verified by our clinical pharmacist.\n\nYou may collect it anytime at the Ambients Pharmacy pickup desk, or reply to request express courier dispatch to your address.\n\nWarm regards,\nAmbients Dispensary Team`
      );
    } else if (templateType === 'consultation') {
      setSubject(`Pharmacist Consultation Follow-up: ${vars.medication}`);
      setBody(
        `Dear ${vars.patient_name},\n\nFollowing our clinical consultation regarding your ${vars.medication} regimen, please remember to take your dose consistently as directed. If you experience any mild side effects or have questions regarding drug interactions, reply directly to this email.\n\nIn good health,\nDr. Sarah Jenkins, PharmD\nAmbients Clinical Pharmacy`
      );
    } else if (templateType === 'renewal_notice') {
      setSubject(`Refill Due Notice: ${vars.medication} (Rx #${vars.rx_number})`);
      setBody(
        `Dear ${vars.patient_name},\n\nYour medication ${vars.medication} is scheduled for renewal on ${vars.renewal_date}.\n\nReply directly to this email to confirm your refill dispatch.\n\nAmbients Pharmacy Team`
      );
    }
  };

  const handleSendDirectEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipientEmail || !subject || !body) return;

    const currentPatient = patients.find((p) => p.id === selectedPatientId);

    const newLog: EmailLog = {
      id: `email-direct-${Date.now()}`,
      recipientEmail,
      recipientName,
      subject,
      body,
      status: 'Draft',
      sentAt: new Date().toLocaleString(),
      emailType: 'direct_message',
      healthCategory: currentPatient?.healthCategory,
      rxNumber: currentPatient?.refillHistory?.[0]?.rxNumber,
    };

    onSendDirectEmail(newLog);
    setSendSuccessMessage(
      'Draft saved for this session. Connect a secure mail backend to send messages, sync replies, or track delivery.'
    );
    setSubject('');
    setBody('');
  };

  const handleTestConnection = () => {
    setIsTestingConnection(false);
    setTestResult(
      'Mail backend is not configured. SMTP and IMAP credentials must be stored server-side before a real connection can be tested.'
    );
  };

  const handleSyncDatabase = () => {
    setIsSyncingDb(false);
    setSyncMessage('Mailbox sync is unavailable until a secure server-side IMAP integration is configured.');
  };

  return (
    <div className="space-y-6">
      {/* Top Integration Status Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-teal-800 text-white flex items-center justify-center shrink-0">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900">
                Hostinger Webmail &amp; SMTP Synchronizer
              </h3>
              <span className={`flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-semibold ${
                config.isConnected
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}>
                {config.isConnected ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                {config.isConnected ? 'Connected' : 'Backend not configured'}
              </span>
            </div>
            <p className="text-xs text-slate-500 font-mono">
              Account: {config.emailAccount} · SMTP {config.smtpHost}:{config.smtpPort} · IMAP {config.imapHost}:{config.imapPort}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncDatabase}
            disabled={!config.isConnected || isSyncingDb}
            title={!config.isConnected ? 'Configure the secure mail backend first' : 'Sync mailbox'}
            className="flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingDb ? 'animate-spin' : ''}`} />
            <span>{isSyncingDb ? 'Syncing...' : 'Sync mailbox'}</span>
          </button>

          <button
            onClick={handleTestConnection}
            disabled={isTestingConnection}
            className="px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-md transition-colors flex items-center gap-1.5 shadow-xs"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{isTestingConnection ? 'Testing...' : 'Test Connection'}</span>
          </button>
        </div>
      </div>

      {testResult && (
        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-700" />
            <span>{testResult}</span>
          </div>
          <button
            onClick={() => setTestResult(null)}
            className="text-amber-800 text-xs font-bold hover:text-amber-950"
          >
            Dismiss
          </button>
        </div>
      )}

      {syncMessage && (
        <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-700" />
            <span>{syncMessage}</span>
          </div>
          <button
            onClick={() => setSyncMessage(null)}
            className="text-amber-800 text-xs font-bold hover:text-amber-950"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Sub Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveSubTab('compose')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
            activeSubTab === 'compose'
              ? 'bg-teal-800 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Mail className="w-3.5 h-3.5" />
          Direct In-Platform Composer
        </button>
        <button
          onClick={() => setActiveSubTab('history')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
            activeSubTab === 'history'
              ? 'bg-teal-800 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Inbox className="w-3.5 h-3.5" />
          Email Activity ({emailLogs.length})
        </button>
        <button
          onClick={() => setActiveSubTab('settings')}
          className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
            activeSubTab === 'settings'
              ? 'bg-teal-800 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Server className="w-3.5 h-3.5" />
          Hostinger Server Config
        </button>
      </div>

      {sendSuccessMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
            <span>{sendSuccessMessage}</span>
          </div>
          <button
            onClick={() => setSendSuccessMessage(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* SUB-TAB 1: IN-PLATFORM COMPOSER */}
      {activeSubTab === 'compose' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Email Composer</h4>
                <p className="text-xs text-slate-500">
                  Compose and save drafts here. Sending requires a secure server-side mail integration.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500">
                From: {config.emailAccount}
              </span>
            </div>

            <form onSubmit={handleSendDirectEmail} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Select Patient from CRM Database
                  </label>
                  <select
                    value={selectedPatientId}
                    onChange={(e) => handlePatientSelectChange(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
                  >
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.firstName} {p.lastName} ({p.healthCategory})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Recipient Email Address <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
                  />
                </div>
              </div>

              {/* Template Shortcuts */}
              <div>
                <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Insert Clinical Template:
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleApplyTemplate('pickup_ready')}
                    className="px-2.5 py-1 text-xs font-medium rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                  >
                    Medication Ready for Pickup
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyTemplate('consultation')}
                    className="px-2.5 py-1 text-xs font-medium rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                  >
                    Pharmacist Consultation Follow-up
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyTemplate('renewal_notice')}
                    className="px-2.5 py-1 text-xs font-medium rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                  >
                    Upcoming Refill Due Alert
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Subject Line <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Your Refill is Ready for Pickup - Ambients Pharmacy"
                  className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Email Message Body <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={7}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write message directly or select a template above..."
                  className="w-full bg-white border border-slate-300 rounded-md p-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 leading-relaxed font-sans"
                ></textarea>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[11px] text-slate-400">
                  Draft only · No email will be sent until the mail backend is configured
                </span>
                <button
                  type="submit"
                  className="px-5 py-2.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-md shadow-xs transition-colors flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Save Draft</span>
                </button>
              </div>
            </form>
          </div>

          {/* Right Column: Selected Patient Quick Snapshot */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Recipient Profile Snapshot
              </h4>
              {(() => {
                const currentPatient = patients.find((p) => p.id === selectedPatientId);
                if (!currentPatient) return <p className="text-xs text-slate-500">No patient selected</p>;
                return (
                  <div className="space-y-2 text-xs text-slate-700">
                    <div>
                      <span className="text-slate-400 block">Name</span>
                      <span className="font-semibold text-slate-900">
                        {currentPatient.firstName} {currentPatient.lastName}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Health Category</span>
                      <span className="font-medium text-teal-800">{currentPatient.healthCategory}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Primary Medications</span>
                      {currentPatient.refillHistory.map((r) => (
                        <div key={r.id} className="pt-1">
                          <p className="font-medium text-slate-900">{r.medicationName}</p>
                          <p className="text-[11px] font-mono text-slate-500">
                            {r.rxNumber} · Due: {r.nextRefillDue}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: SYNCHRONIZED MAILBOX HISTORY */}
      {activeSubTab === 'history' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <h4 className="text-sm font-bold text-slate-900">
                Email Activity
              </h4>
              <p className="text-xs text-slate-500">
                Delivery and open events appear here after the mail provider is connected. Drafts are stored in this browser.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500">
              Total Messages: {emailLogs.length}
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase">
                <tr>
                  <th className="py-2.5 px-3">Recipient</th>
                  <th className="py-2.5 px-3">Subject &amp; Body Preview</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Timestamp</th>
                  <th className="py-2.5 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {emailLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="py-3 px-3">
                      <p className="font-semibold text-slate-900">{log.recipientName}</p>
                      <p className="text-[11px] font-mono text-slate-500">{log.recipientEmail}</p>
                    </td>
                    <td className="py-3 px-3 max-w-md">
                      <p className="font-medium text-slate-800 truncate">{log.subject}</p>
                      <p className="text-[11px] text-slate-500 truncate">{log.body}</p>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-sm text-[11px] font-medium bg-slate-100 text-slate-700">
                        {log.emailType.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-600 whitespace-nowrap">
                      {log.sentAt}
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <span className={`rounded-sm border px-2 py-0.5 text-[11px] font-semibold ${
                        log.status === 'Opened' || log.status === 'Replied'
                          ? 'border-indigo-200 bg-indigo-50 text-indigo-800'
                          : log.status === 'Delivered'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : log.status === 'Failed'
                              ? 'border-rose-200 bg-rose-50 text-rose-800'
                              : 'border-slate-200 bg-slate-100 text-slate-700'
                      }`}>
                        {log.status}
                        {log.openedAt && <span className="ml-1 block font-normal">Opened {log.openedAt}</span>}
                        {log.replyBody && <span className="ml-1 block font-normal">Reply received</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: HOSTINGER SERVER CONFIG */}
      {activeSubTab === 'settings' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-2xl space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <h4 className="text-sm font-bold text-slate-900">Hostinger mailbox settings</h4>
            <p className="mt-1 text-xs leading-relaxed text-amber-800">
              These connection details are informational only. A server-side mail service and encrypted credentials are required; do not enter mailbox passwords here.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Dispensary Email Account
              </label>
              <input
                type="email"
                value={config.emailAccount}
                onChange={(e) => onUpdateConfig({ ...config, emailAccount: e.target.value })}
                className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-slate-900 font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Sender Display Name
              </label>
              <input
                type="text"
                value={config.displayName}
                onChange={(e) => onUpdateConfig({ ...config, displayName: e.target.value })}
                className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-slate-900"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Hostinger SMTP Server
              </label>
              <input
                type="text"
                value={config.smtpHost}
                onChange={(e) => onUpdateConfig({ ...config, smtpHost: e.target.value })}
                className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-slate-900 font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                SMTP Port (SSL / TLS)
              </label>
              <input
                type="number"
                value={config.smtpPort}
                onChange={(e) => onUpdateConfig({ ...config, smtpPort: parseInt(e.target.value) || 465 })}
                className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-slate-900 font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Hostinger IMAP Server
              </label>
              <input
                type="text"
                value={config.imapHost}
                onChange={(e) => onUpdateConfig({ ...config, imapHost: e.target.value })}
                className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-slate-900 font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                IMAP Port
              </label>
              <input
                type="number"
                value={config.imapPort}
                onChange={(e) => onUpdateConfig({ ...config, imapPort: parseInt(e.target.value) || 993 })}
                className="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-slate-900 font-mono"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-800">
              <input
                type="checkbox"
                checked={config.autoSyncDatabase}
                disabled
                className="rounded border-slate-300 text-teal-700 focus:ring-teal-700"
              />
              <span>Two-way sync (requires server integration)</span>
            </label>

            <span className="text-[11px] text-slate-400 font-mono">
              Sync state: {config.lastSyncedAt}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
