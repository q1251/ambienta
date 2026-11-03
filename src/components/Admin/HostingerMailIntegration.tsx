import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle, Mail, Send, ShieldCheck } from 'lucide-react';

interface HostingerMailIntegrationProps {
  role: 'admin' | 'operator';
}

interface MailSettings {
  configured: boolean;
  emailAccount: string;
  displayName: string;
  smtpHost: string;
  smtpPort: number;
}

interface MailActivity {
  id: string;
  recipientEmail: string;
  subject: string;
  status: 'Queued' | 'Sent' | 'Failed';
  sentAt: string;
}

interface ApiResponse {
  message?: string;
  error?: string;
  configured?: boolean;
  emailAccount?: string;
  displayName?: string;
  smtpHost?: string;
  smtpPort?: number;
  messages?: MailActivity[];
  connected?: boolean;
  sent?: boolean;
  logged?: boolean;
}

const requestMailApi = async (resource: string, method: 'GET' | 'POST', body?: object): Promise<ApiResponse> => {
  const response = await fetch(`/api/data.php?resource=${resource}`, {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json() as ApiResponse;
  if (!response.ok) {
    throw new Error(result.message || 'The mail request could not be completed.');
  }
  return result;
};

export const HostingerMailIntegration: React.FC<HostingerMailIntegrationProps> = ({ role }) => {
  const [settings, setSettings] = useState<MailSettings>({
    configured: false,
    emailAccount: 'customersupport@ambienta.io',
    displayName: 'Ambienta Customer Support',
    smtpHost: 'smtp.hostinger.com',
    smtpPort: 465,
  });
  const [messages, setMessages] = useState<MailActivity[]>([]);
  const [password, setPassword] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [connectionVerified, setConnectionVerified] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const loadData = async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const [settingsResult, activityResult] = await Promise.all([
        requestMailApi('email-settings', 'GET'),
        requestMailApi('email-activity', 'GET'),
      ]);
      if (typeof settingsResult.configured !== 'boolean'
        || !Array.isArray(activityResult.messages)) {
        throw new Error('The mail integration returned an invalid response.');
      }
      setSettings({
        configured: settingsResult.configured,
        emailAccount: settingsResult.emailAccount || 'customersupport@ambienta.io',
        displayName: settingsResult.displayName || 'Ambienta Customer Support',
        smtpHost: settingsResult.smtpHost || 'smtp.hostinger.com',
        smtpPort: settingsResult.smtpPort || 465,
      });
      setMessages(activityResult.messages);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Hostinger email settings could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsSaving(true);
    try {
      const result = await requestMailApi('email-settings', 'POST', {
        emailAccount: settings.emailAccount,
        displayName: settings.displayName,
        password,
      });
      setSettings((current) => ({ ...current, configured: result.configured === true }));
      setPassword('');
      setConnectionVerified(false);
      setSuccessMessage('Mailbox settings saved securely. Test the connection before sending.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Mailbox settings could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    setIsTesting(true);
    try {
      const result = await requestMailApi('email-test', 'POST', {});
      if (result.connected !== true) throw new Error('Hostinger SMTP authentication was not confirmed.');
      setConnectionVerified(true);
      setSuccessMessage('Hostinger SMTP authentication succeeded.');
    } catch (error) {
      setConnectionVerified(false);
      setErrorMessage(error instanceof Error ? error.message : 'Hostinger SMTP connection failed.');
    } finally {
      setIsTesting(false);
    }
  };

  const sendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsSending(true);
    try {
      const result = await requestMailApi('email-send', 'POST', {
        recipientEmail,
        subject,
        body: messageBody,
      });
      if (result.sent !== true) throw new Error(result.message || 'Hostinger did not accept the email.');
      setSuccessMessage(result.message || 'Hostinger accepted the email for sending.');
      setSubject('');
      setMessageBody('');
      try {
        const activity = await requestMailApi('email-activity', 'GET');
        setMessages(activity.messages || []);
      } catch (error) {
        const detail = error instanceof Error ? ` ${error.message}` : '';
        setErrorMessage(`Hostinger accepted the email, but the activity list could not be refreshed.${detail}`);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The email could not be sent.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">Communications</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Email</h1>
        <p className="mt-2 text-sm text-slate-600">Connect customersupport@ambienta.io and manage customer-support messages from the CRM.</p>
      </header>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-violet-50 p-3 text-violet-700"><Mail className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Hostinger email</h2>
              <p className="mt-1 text-sm text-slate-600">Connect the customer support mailbox for sending email from the CRM.</p>
              <p className="mt-2 font-mono text-xs text-slate-500">
                {settings.emailAccount} · {settings.smtpHost}:{settings.smtpPort}
              </p>
            </div>
          </div>
          <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            connectionVerified
              ? 'bg-emerald-50 text-emerald-800'
              : settings.configured
                ? 'bg-amber-50 text-amber-800'
                : 'bg-slate-100 text-slate-700'
          }`}>
            {connectionVerified ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            {connectionVerified ? 'Connection verified' : settings.configured ? 'Credentials saved · not tested' : 'Not configured'}
          </span>
        </div>

        {errorMessage && (
          <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{errorMessage}</p>
        )}
        {successMessage && (
          <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{successMessage}</p>
        )}

        {role === 'admin' ? (
          <form onSubmit={(event) => void saveSettings(event)} className="mt-5 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
            <div>
              <label htmlFor="hostinger-sender" className="mb-1 block text-sm font-medium text-slate-700">Mailbox address</label>
              <input id="hostinger-sender" type="email" value={settings.emailAccount} readOnly className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700" />
            </div>
            <div>
              <label htmlFor="hostinger-display-name" className="mb-1 block text-sm font-medium text-slate-700">Sender display name</label>
              <input id="hostinger-display-name" value={settings.displayName} maxLength={120} required onChange={(event) => setSettings((current) => ({ ...current, displayName: event.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="hostinger-password" className="mb-1 block text-sm font-medium text-slate-700">Hostinger mailbox password</label>
              <input id="hostinger-password" type="password" autoComplete="new-password" value={password} required={!settings.configured} onChange={(event) => setPassword(event.target.value)} placeholder={settings.configured ? 'Leave blank to keep the saved password' : 'Enter the mailbox password'} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
              <p className="mt-1 text-xs text-slate-500">The password is encrypted on the server, stored outside the public website, and never sent back to this page.</p>
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="submit" disabled={isLoading || isSaving || (!settings.configured && !password)} className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50">
                {isSaving && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {isSaving ? 'Saving securely…' : 'Save mailbox settings'}
              </button>
              <button type="button" onClick={() => void testConnection()} disabled={!settings.configured || isTesting || isLoading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                {isTesting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {isTesting ? 'Testing…' : 'Test connection'}
              </button>
            </div>
          </form>
        ) : (
          <p className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            Only an administrator can configure the mailbox. You can send messages after the administrator has saved and verified it.
          </p>
        )}
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <form onSubmit={(event) => void sendMessage(event)} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div>
            <h2 className="font-semibold text-slate-950">Compose an email</h2>
            <p className="mt-1 text-sm text-slate-600">One-to-one customer support messages are sent through Hostinger SMTP.</p>
          </div>
          <div>
            <label htmlFor="mail-recipient" className="mb-1 block text-sm font-medium text-slate-700">To</label>
            <input id="mail-recipient" type="email" required maxLength={254} value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
          </div>
          <div>
            <label htmlFor="mail-subject" className="mb-1 block text-sm font-medium text-slate-700">Subject</label>
            <input id="mail-subject" required maxLength={180} value={subject} onChange={(event) => setSubject(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
          </div>
          <div>
            <label htmlFor="mail-body" className="mb-1 block text-sm font-medium text-slate-700">Message</label>
            <textarea id="mail-body" required maxLength={6000} rows={7} value={messageBody} onChange={(event) => setMessageBody(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-6 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
            <p className="mt-1 text-xs text-amber-700">Do not include medical or other sensitive health information in email.</p>
          </div>
          <button type="submit" disabled={!settings.configured || !connectionVerified || isSending || isLoading} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
            {isSending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {isSending ? 'Sending…' : 'Send email'}
          </button>
          {!connectionVerified && <p className="text-xs text-slate-500">Save the mailbox and verify the SMTP connection before sending.</p>}
        </form>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-950">Recent email activity</h2>
              <p className="mt-1 text-sm text-slate-600">The CRM records the recipient, subject, and time—not message content.</p>
            </div>
            <button type="button" onClick={() => void loadData()} disabled={isLoading} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Refresh
            </button>
          </div>
          {isLoading ? (
            <p role="status" className="py-8 text-center text-sm text-slate-500">Loading email activity…</p>
          ) : messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No email has been sent from the CRM yet.</p>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <ul className="divide-y divide-slate-100">
                {messages.map((item) => (
                  <li key={item.id} className="py-3">
                    <p className="truncate text-sm font-medium text-slate-900">{item.subject}</p>
                    <p className="mt-1 truncate text-xs text-slate-600">{item.recipientEmail}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.status === 'Sent' ? 'Accepted by SMTP' : item.status === 'Failed' ? 'Sending failed' : 'Result unknown; verify before retrying'} · {item.sentAt}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </section>

      <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        SMTP can submit outgoing messages but does not confirm delivery or opens. Inbox synchronization, replies, bulk campaigns, and delivery/open tracking are not connected yet.
      </p>
    </div>
  );
};
