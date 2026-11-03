import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Inbox,
  LoaderCircle,
  Mail,
  Megaphone,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

interface HostingerMailIntegrationProps {
  role: 'admin' | 'operator';
  mode: 'settings' | 'mailbox';
}

interface MailSettings {
  configured: boolean;
  verified: boolean;
  emailAccount: string;
  displayName: string;
  smtpHost: string;
  smtpPort: number;
}

interface MailActivity {
  id: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: 'Queued' | 'Sent' | 'Failed';
  sentAt: string;
}

interface MailDraft {
  id: string;
  recipientEmail: string;
  subject: string;
  body: string;
  updatedAt: string;
}

interface InboxMessage {
  id: string;
  folder: string;
  from: string;
  subject: string;
  date: string;
  body: string;
  unread: boolean;
}

type MailboxFolder = 'inbox' | 'compose' | 'sent' | 'drafts' | 'trash' | 'campaigns' | 'campaign-history';

interface MailCampaign {
  id: string;
  name: string;
  subject: string;
  body: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'partial' | 'failed';
  scheduledAt: string | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  unsubscribedCount: number;
  createdAt: string;
  completedAt: string | null;
}

interface ApiResponse {
  message?: string;
  error?: string;
  configured?: boolean;
  verified?: boolean;
  emailAccount?: string;
  displayName?: string;
  smtpHost?: string;
  smtpPort?: number;
  messages?: MailActivity[];
  drafts?: MailDraft[];
  draft?: MailDraft;
  inbox?: InboxMessage[];
  mailboxMessages?: InboxMessage[];
  folderAvailable?: boolean;
  connected?: boolean;
  sent?: boolean;
  logged?: boolean;
  campaigns?: MailCampaign[];
  campaignId?: string;
  audienceCount?: number;
  audienceLimit?: number;
  recipientCount?: number;
  scheduled?: boolean;
  queued?: boolean;
  workerToken?: string;
  command?: string;
  processed?: number;
  failed?: number;
}

const getDefaultScheduleValue = (): string => {
  const date = new Date(Date.now() + 10 * 60 * 1000 - new Date().getTimezoneOffset() * 60 * 1000);
  return date.toISOString().slice(0, 16);
};

const requestMailApi = async (resource: string, method: 'GET' | 'POST' | 'DELETE', body?: object): Promise<ApiResponse> => {
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

export const HostingerMailIntegration: React.FC<HostingerMailIntegrationProps> = ({ role, mode }) => {
  const [settings, setSettings] = useState<MailSettings>({
    configured: false,
    verified: false,
    emailAccount: 'customersupport@ambienta.io',
    displayName: 'Ambienta Customer Support',
    smtpHost: 'smtp.hostinger.com',
    smtpPort: 465,
  });
  const [messages, setMessages] = useState<MailActivity[]>([]);
  const [campaigns, setCampaigns] = useState<MailCampaign[]>([]);
  const [campaignAudienceCount, setCampaignAudienceCount] = useState(0);
  const [campaignName, setCampaignName] = useState('');
  const [campaignSubject, setCampaignSubject] = useState('');
  const [campaignBody, setCampaignBody] = useState('');
  const [campaignScheduleAt, setCampaignScheduleAt] = useState(getDefaultScheduleValue);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [campaignWorkerCommand, setCampaignWorkerCommand] = useState('');
  const [isCampaignSaving, setIsCampaignSaving] = useState(false);
  const [isCampaignAction, setIsCampaignAction] = useState(false);
  const [drafts, setDrafts] = useState<MailDraft[]>([]);
  const [trash, setTrash] = useState<MailDraft[]>([]);
  const [inboxMessages, setInboxMessages] = useState<InboxMessage[]>([]);
  const [hostSentMessages, setHostSentMessages] = useState<InboxMessage[]>([]);
  const [mailTrashMessages, setMailTrashMessages] = useState<InboxMessage[]>([]);
  const [inboxFolderAvailable, setInboxFolderAvailable] = useState(true);
  const [sentFolderAvailable, setSentFolderAvailable] = useState(false);
  const [trashFolderAvailable, setTrashFolderAvailable] = useState(false);
  const [activeFolder, setActiveFolder] = useState<MailboxFolder>('inbox');
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncingInbox, setIsSyncingInbox] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (mode === 'mailbox' && settings.configured) {
      if (activeFolder === 'inbox') void refreshMailboxFolder('inbox');
      if (activeFolder === 'sent') void refreshMailboxFolder('sent');
      if (activeFolder === 'trash') void refreshMailboxFolder('trash');
    }
  }, [mode, activeFolder, settings.configured]);

  const loadData = async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const settingsResult = await requestMailApi('email-settings', 'GET');
      if (typeof settingsResult.configured !== 'boolean' || typeof settingsResult.verified !== 'boolean') {
        throw new Error('The mail integration returned an invalid response.');
      }
      setSettings({
        configured: settingsResult.configured,
        verified: settingsResult.verified,
        emailAccount: settingsResult.emailAccount || 'customersupport@ambienta.io',
        displayName: settingsResult.displayName || 'Ambienta Customer Support',
        smtpHost: settingsResult.smtpHost || 'smtp.hostinger.com',
        smtpPort: settingsResult.smtpPort || 465,
      });
      if (mode === 'mailbox') {
        const [activityResult, draftResult, trashResult] = await Promise.all([
          requestMailApi('email-activity', 'GET'),
          requestMailApi('email-drafts', 'GET'),
          requestMailApi('email-draft-trash', 'GET'),
        ]);
        if (!Array.isArray(activityResult.messages) || !Array.isArray(draftResult.drafts) || !Array.isArray(trashResult.drafts)) {
          throw new Error('The email folders returned an invalid response.');
        }
        setMessages(activityResult.messages);
        setDrafts(draftResult.drafts);
        setTrash(trashResult.drafts);
        if (role === 'admin') {
          const [campaignResult, audienceResult] = await Promise.all([
            requestMailApi('email-campaigns', 'GET'),
            requestMailApi('email-campaign-audience', 'GET'),
          ]);
          if (!Array.isArray(campaignResult.campaigns) || typeof audienceResult.audienceCount !== 'number') {
            throw new Error('Campaign data returned an invalid response.');
          }
          setCampaigns(campaignResult.campaigns);
          setCampaignAudienceCount(audienceResult.audienceCount);
        }
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Hostinger email settings could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [mode]);

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
      setSettings((current) => ({ ...current, configured: result.configured === true, verified: false }));
      setPassword('');
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
      setSettings((current) => ({ ...current, verified: true }));
      setSuccessMessage(result.message || 'Hostinger SMTP and IMAP authentication succeeded.');
    } catch (error) {
      setSettings((current) => ({ ...current, verified: false }));
      setErrorMessage(error instanceof Error ? error.message : 'Hostinger SMTP connection failed.');
    } finally {
      setIsTesting(false);
    }
  };

  const refreshMailboxFolder = async (folder: 'inbox' | 'sent' | 'trash') => {
    setErrorMessage('');
    if (folder === 'inbox') setIsSyncingInbox(true);
    try {
      const result = await requestMailApi(`email-inbox&folder=${folder}`, 'GET');
      if (!Array.isArray(result.mailboxMessages)) throw new Error('The mailbox response is invalid.');
      if (folder === 'inbox') {
        setInboxMessages(result.mailboxMessages);
        setInboxFolderAvailable(result.folderAvailable !== false);
      }
      if (folder === 'sent') {
        setHostSentMessages(result.mailboxMessages);
        setSentFolderAvailable(result.folderAvailable === true);
      }
      if (folder === 'trash') {
        setMailTrashMessages(result.mailboxMessages);
        setTrashFolderAvailable(result.folderAvailable === true);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The Hostinger mailbox folder could not be synchronized.');
    } finally {
      if (folder === 'inbox') setIsSyncingInbox(false);
    }
  };

  const refreshInbox = () => refreshMailboxFolder('inbox');

  const replyToInbox = (message: InboxMessage) => {
    const address = message.from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
    if (!address) {
      setErrorMessage('This message does not contain a reply address.');
      return;
    }
    setRecipientEmail(address);
    setSubject(message.subject.toLowerCase().startsWith('re:') ? message.subject : `Re: ${message.subject}`);
    setMessageBody('');
    setEditingDraftId(null);
    setActiveFolder('compose');
  };

  const saveDraft = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const result = await requestMailApi('email-draft', 'POST', {
        ...(editingDraftId ? { id: editingDraftId } : {}),
        recipientEmail,
        subject,
        body: messageBody,
      });
      if (!result.draft) throw new Error('The saved draft was missing from the response.');
      setDrafts((current) => [
        result.draft!,
        ...current.filter((draft) => draft.id !== result.draft!.id),
      ]);
      setEditingDraftId(result.draft.id);
      setSuccessMessage('Draft saved.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The draft could not be saved.');
    }
  };

  const openDraft = (draft: MailDraft) => {
    setEditingDraftId(draft.id);
    setRecipientEmail(draft.recipientEmail);
    setSubject(draft.subject);
    setMessageBody(draft.body);
    setActiveFolder('compose');
  };

  const moveDraftToTrash = async (draft: MailDraft) => {
    setErrorMessage('');
    try {
      await requestMailApi('email-draft-trash', 'POST', { id: draft.id });
      setDrafts((current) => current.filter((item) => item.id !== draft.id));
      setTrash((current) => [draft, ...current]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The draft could not be moved to Trash.');
    }
  };

  const restoreDraft = async (draft: MailDraft) => {
    setErrorMessage('');
    try {
      await requestMailApi('email-draft-restore', 'POST', { id: draft.id });
      setTrash((current) => current.filter((item) => item.id !== draft.id));
      setDrafts((current) => [draft, ...current]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The draft could not be restored.');
    }
  };

  const permanentlyDeleteDraft = async (draft: MailDraft) => {
    setErrorMessage('');
    try {
      await requestMailApi('email-draft-purge', 'DELETE', { id: draft.id });
      setTrash((current) => current.filter((item) => item.id !== draft.id));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The draft could not be permanently deleted.');
    }
  };

  const moveMailToTrash = async (message: InboxMessage) => {
    setErrorMessage('');
    try {
      await requestMailApi('email-message-trash', 'POST', { id: message.id });
      setInboxMessages((current) => current.filter((item) => item.id !== message.id));
      setMailTrashMessages((current) => [message, ...current]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The message could not be moved to Trash.');
    }
  };

  const restoreMailMessage = async (message: InboxMessage) => {
    setErrorMessage('');
    try {
      await requestMailApi('email-message-restore', 'POST', { id: message.id });
      setMailTrashMessages((current) => current.filter((item) => item.id !== message.id));
      setInboxMessages((current) => [message, ...current]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The message could not be restored.');
    }
  };

  const permanentlyDeleteMailMessage = async (message: InboxMessage) => {
    setErrorMessage('');
    try {
      await requestMailApi('email-message-purge', 'DELETE', { id: message.id });
      setMailTrashMessages((current) => current.filter((item) => item.id !== message.id));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The message could not be permanently deleted.');
    }
  };

  const persistCampaignDraft = async (): Promise<string> => {
    const result = await requestMailApi('email-campaign-save', 'POST', {
      ...(editingCampaignId ? { id: editingCampaignId } : {}),
      name: campaignName,
      subject: campaignSubject,
      body: campaignBody,
    });
    if (!result.campaignId) throw new Error('The saved campaign was missing from the response.');
    setEditingCampaignId(result.campaignId);
    return result.campaignId;
  };

  const saveCampaign = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsCampaignSaving(true);
    try {
      await persistCampaignDraft();
      setSuccessMessage('Campaign draft saved.');
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The campaign draft could not be saved.');
    } finally {
      setIsCampaignSaving(false);
    }
  };

  const openCampaignDraft = (campaign: MailCampaign) => {
    setEditingCampaignId(campaign.id);
    setCampaignName(campaign.name);
    setCampaignSubject(campaign.subject);
    setCampaignBody(campaign.body);
    setCampaignScheduleAt(getDefaultScheduleValue());
  };

  const scheduleCampaign = async () => {
    if (!editingCampaignId || !campaignScheduleAt) return;
    setErrorMessage('');
    setSuccessMessage('');
    setIsCampaignAction(true);
    try {
      const audienceResult = await requestMailApi('email-campaign-audience', 'GET');
      if (typeof audienceResult.audienceCount !== 'number') throw new Error('The campaign audience count is invalid.');
      setCampaignAudienceCount(audienceResult.audienceCount);
      if (audienceResult.audienceCount === 0 || audienceResult.audienceCount > 5000) {
        throw new Error(audienceResult.audienceCount === 0
          ? 'There are no opted-in leads with valid email addresses for this campaign.'
          : 'Campaigns are limited to 5,000 opted-in recipients.');
      }
      if (!window.confirm(`Schedule "${campaignName}" for ${campaignScheduleAt} to ${audienceResult.audienceCount} opted-in leads?`)) return;
      const campaignId = await persistCampaignDraft();
      await requestMailApi('email-campaign-schedule', 'POST', {
        id: campaignId,
        scheduledAt: new Date(campaignScheduleAt).toISOString(),
      });
      setSuccessMessage(`Campaign scheduled for ${new Date(campaignScheduleAt).toLocaleString()}.`);
      setEditingCampaignId(null);
      setCampaignName('');
      setCampaignSubject('');
      setCampaignBody('');
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The campaign could not be scheduled.');
    } finally {
      setIsCampaignAction(false);
    }
  };

  const launchCampaign = async () => {
    if (!editingCampaignId) return;
    setErrorMessage('');
    setSuccessMessage('');
    setIsCampaignAction(true);
    try {
      const audienceResult = await requestMailApi('email-campaign-audience', 'GET');
      if (typeof audienceResult.audienceCount !== 'number') throw new Error('The campaign audience count is invalid.');
      setCampaignAudienceCount(audienceResult.audienceCount);
      if (audienceResult.audienceCount === 0 || audienceResult.audienceCount > 5000) {
        throw new Error(audienceResult.audienceCount === 0
          ? 'There are no opted-in leads with valid email addresses for this campaign.'
          : 'Campaigns are limited to 5,000 opted-in recipients.');
      }
      if (!window.confirm(`Send "${campaignName}" to ${audienceResult.audienceCount} opted-in leads now? This cannot be undone.`)) return;
      const campaignId = await persistCampaignDraft();
      const result = await requestMailApi('email-campaign-launch', 'POST', { id: campaignId });
      setSuccessMessage(`Campaign queued for ${result.recipientCount ?? campaignAudienceCount} opted-in leads. ${result.sent ?? 0} sent in the first batch; remaining messages will be processed by the scheduled worker.`);
      setEditingCampaignId(null);
      setCampaignName('');
      setCampaignSubject('');
      setCampaignBody('');
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The campaign could not be launched.');
    } finally {
      setIsCampaignAction(false);
    }
  };

  const cancelCampaign = async (campaign: MailCampaign) => {
    if (!window.confirm(`Cancel the scheduled campaign "${campaign.name}"?`)) return;
    setErrorMessage('');
    setSuccessMessage('');
    try {
      await requestMailApi('email-campaign-cancel', 'POST', { id: campaign.id });
      setSuccessMessage('Scheduled campaign cancelled and returned to drafts.');
      await loadData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The scheduled campaign could not be cancelled.');
    }
  };

  const generateCampaignWorkerCommand = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const result = await requestMailApi('email-campaign-worker-token', 'POST', {});
      if (!result.command) throw new Error('The campaign worker command was missing from the response.');
      setCampaignWorkerCommand(result.command);
      setSuccessMessage('Worker command generated. Copy it into a Hostinger cron job running every minute. Generate a new command if you lose this one.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The campaign worker command could not be generated.');
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
      setSettings((current) => ({ ...current, verified: true }));
      if (editingDraftId) {
        try {
          await requestMailApi('email-draft-remove', 'DELETE', { id: editingDraftId });
          setDrafts((current) => current.filter((draft) => draft.id !== editingDraftId));
        } catch {
          setErrorMessage('Email sent successfully, but its saved draft could not be removed.');
        }
      }
      setEditingDraftId(null);
      setRecipientEmail('');
      setSubject('');
      setMessageBody('');
      try {
        await loadData();
      } catch (error) {
        const detail = error instanceof Error ? ` ${error.message}` : '';
        setErrorMessage(`Hostinger accepted the email, but the activity list could not be refreshed.${detail}`);
      }
    } catch (error) {
      setSettings((current) => ({ ...current, verified: false }));
      setErrorMessage(error instanceof Error ? error.message : 'The email could not be sent.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">
          {mode === 'settings' ? 'Connections' : 'Communications'}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
          {mode === 'settings' ? 'Email integration' : 'Email'}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {mode === 'settings'
            ? 'Configure and test the Hostinger mailbox connection used by the CRM.'
            : 'Compose customer-support messages and review sent activity.'}
        </p>
      </header>
      {mode === 'settings' && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
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
            settings.verified
              ? 'bg-emerald-50 text-emerald-800'
              : settings.configured
                ? 'bg-amber-50 text-amber-800'
                : 'bg-slate-100 text-slate-700'
          }`}>
            {settings.verified ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            {settings.verified ? 'Connection verified' : settings.configured ? 'Credentials saved · not tested' : 'Not configured'}
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
      </section>}

      {mode === 'mailbox' && <section className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Sent from CRM</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{messages.filter((item) => item.status === 'Sent').length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Delivered</p>
            <p className="mt-1 text-lg font-semibold text-slate-700">Not tracked</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Opened</p>
            <p className="mt-1 text-lg font-semibold text-slate-700">Not tracked</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Drafts · Trash</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{drafts.length} · {trash.length}</p>
          </div>
        </div>

        <div className="grid items-stretch gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className={`rounded-2xl border border-slate-200 bg-white p-3 ${
          activeFolder === 'compose' || activeFolder === 'campaigns' || activeFolder === 'campaign-history' ? 'h-fit self-start' : 'h-full self-stretch'
        }`}>
          <button
            type="button"
            onClick={() => setActiveFolder('compose')}
            className={`mb-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold shadow-sm transition-colors ${
              activeFolder === 'compose'
                ? 'bg-violet-800 text-white'
                : 'bg-violet-700 text-white hover:bg-violet-800'
            }`}
          >
            <Mail className="h-4 w-4" /> Compose
          </button>
          <nav aria-label="Email folders" className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:flex lg:flex-col">
            {([
              ['inbox', 'Inbox', Inbox, ''],
              ['sent', 'Sent', Send, ''],
              ['drafts', 'Drafts', FileText, drafts.length ? String(drafts.length) : ''],
              ['trash', 'Trash', Trash2, trash.length + mailTrashMessages.length ? String(trash.length + mailTrashMessages.length) : ''],
            ] as const).map(([folder, label, Icon, count]) => (
              <button
                key={folder}
                type="button"
                aria-current={activeFolder === folder ? 'page' : undefined}
                onClick={() => setActiveFolder(folder)}
                className={`flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  activeFolder === folder
                    ? 'bg-violet-50 text-violet-900'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {count && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{count}</span>}
              </button>
            ))}
          </nav>
          {role === 'admin' && (
            <>
              <button
                type="button"
                aria-current={activeFolder === 'campaigns' || activeFolder === 'campaign-history' ? 'page' : undefined}
                onClick={() => setActiveFolder('campaigns')}
                className={`mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  activeFolder === 'campaigns' || activeFolder === 'campaign-history'
                    ? 'bg-violet-50 text-violet-900'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                }`}
              >
                <Megaphone className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">Campaigns</span>
              </button>
              <button
                type="button"
                aria-current={activeFolder === 'campaign-history' ? 'page' : undefined}
                onClick={() => setActiveFolder('campaign-history')}
                className={`ml-7 flex w-[calc(100%-1.75rem)] items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors ${
                  activeFolder === 'campaign-history'
                    ? 'bg-violet-50 text-violet-900'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="h-1 w-1 shrink-0 rounded-full bg-current" />
                <span className="min-w-0 flex-1 truncate">Campaign history</span>
              </button>
            </>
          )}
          <div className="mt-4 hidden border-t border-slate-100 px-2 pt-4 lg:block">
            <p className="text-xs font-medium text-slate-500">Mailbox</p>
            <p className="mt-1 truncate text-sm font-medium text-slate-800">{settings.emailAccount}</p>
            <p className={`mt-2 inline-flex items-center gap-1.5 text-xs ${settings.verified ? 'text-emerald-700' : 'text-amber-700'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${settings.verified ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {settings.verified ? 'Connected' : 'Connection not verified'}
            </p>
          </div>
        </aside>

        <div className="h-full min-w-0 self-stretch space-y-5">
          {errorMessage && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{errorMessage}</p>}
          {successMessage && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{successMessage}</p>}

          {activeFolder === 'compose' && (
            <form onSubmit={(event) => void sendMessage(event)} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <div>
                <h2 className="font-semibold text-slate-950">{editingDraftId ? 'Edit draft' : 'Compose an email'}</h2>
                <p className="mt-1 text-sm text-slate-600">Send through {settings.emailAccount}. Drafts are saved in the CRM.</p>
              </div>
              <div>
                <label htmlFor="mail-recipient" className="mb-1 block text-sm font-medium text-slate-700">To</label>
                <input id="mail-recipient" type="email" maxLength={254} value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
              </div>
              <div>
                <label htmlFor="mail-subject" className="mb-1 block text-sm font-medium text-slate-700">Subject</label>
                <input id="mail-subject" maxLength={180} value={subject} onChange={(event) => setSubject(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
              </div>
              <div>
                <label htmlFor="mail-body" className="mb-1 block text-sm font-medium text-slate-700">Message</label>
                <textarea id="mail-body" maxLength={6000} rows={9} value={messageBody} onChange={(event) => setMessageBody(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-6 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
                <p className="mt-1 text-xs text-amber-700">Do not include medical or other sensitive health information in email.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void saveDraft()} disabled={isLoading || (!recipientEmail && !subject && !messageBody)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  <FileText className="h-4 w-4" /> Save draft
                </button>
                <button type="submit" disabled={!settings.configured || !settings.verified || isSending || isLoading || !recipientEmail || !subject || !messageBody} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {isSending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {isSending ? 'Sending…' : 'Send email'}
                </button>
                {!settings.verified && <p className="self-center text-xs text-slate-500">Configure and test SMTP + IMAP under Integrations before sending.</p>}
              </div>
            </form>
          )}

          {activeFolder === 'inbox' && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-950">Inbox</h2>
                  <p className="mt-1 text-sm text-slate-600">Recent messages from the Hostinger INBOX mailbox.</p>
                </div>
                <button type="button" onClick={() => void refreshInbox()} disabled={!settings.configured || isSyncingInbox} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  <RefreshCw className={`h-4 w-4 ${isSyncingInbox ? 'animate-spin' : ''}`} /> {isSyncingInbox ? 'Syncing…' : 'Sync inbox'}
                </button>
              </div>
              {!settings.configured ? (
                <p className="py-8 text-center text-sm text-slate-500">Configure the Hostinger mailbox under Integrations to load the inbox.</p>
              ) : !inboxFolderAvailable ? (
                <p className="py-8 text-center text-sm text-rose-700">The Hostinger inbox folder is unavailable.</p>
              ) : isSyncingInbox ? (
                <p role="status" className="py-8 text-center text-sm text-slate-500">Synchronizing inbox…</p>
              ) : inboxMessages.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">No inbox messages were returned. Use Sync inbox to check again.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {inboxMessages.map((item) => (
                    <li key={item.id} className="py-3">
                      <p className={`truncate text-sm ${item.unread ? 'font-bold text-slate-950' : 'font-medium text-slate-800'}`}>{item.subject}</p>
                      <p className="mt-1 truncate text-xs text-slate-600">{item.from}</p>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs text-slate-500">{item.date} {item.unread ? '· Unread' : ''}</p>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => replyToInbox(item)} className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Reply</button>
                          <button type="button" onClick={() => void moveMailToTrash(item)} className="rounded-md border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">Move to Trash</button>
                        </div>
                      </div>
                      {item.body && (
                        <details className="mt-2 text-xs text-slate-600">
                          <summary className="cursor-pointer font-medium">Read message preview</summary>
                          <p className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3">{item.body}</p>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {activeFolder === 'sent' && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-slate-950">Sent from CRM</h2>
                  <p className="mt-1 text-sm text-slate-600">Messages submitted from this CRM.</p>
                </div>
                <button type="button" onClick={() => { void loadData(); void refreshMailboxFolder('sent'); }} disabled={isLoading || !settings.configured} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Refresh</button>
              </div>
              {messages.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No email has been sent from the CRM yet.</p> : (
                <ul className="divide-y divide-slate-100">
                  {messages.map((item) => (
                    <li key={item.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">{item.subject || '(no subject)'}</p>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.status === 'Sent' ? 'bg-emerald-50 text-emerald-800' : item.status === 'Failed' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>{item.status}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-600">{item.recipientEmail} · {item.sentAt}</p>
                      {item.body && <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer font-medium">View message</summary><p className="mt-2 whitespace-pre-wrap">{item.body}</p></details>}
                      <p className="mt-1 text-xs text-slate-500">{item.status === 'Sent' ? 'Accepted by SMTP; delivery is not confirmed.' : item.status === 'Failed' ? 'Sending failed.' : 'Sending outcome unknown; check Hostinger before retrying.'}</p>
                    </li>
                  ))}
                </ul>
              )}
              {settings.configured && !sentFolderAvailable && <p className="mt-4 text-xs text-amber-700">The Hostinger Sent folder was not found. CRM-sent activity is shown separately above.</p>}
              {hostSentMessages.length > 0 && (
                <div className="mt-6 border-t border-slate-200 pt-4">
                  <h3 className="font-semibold text-slate-900">Hostinger Sent folder</h3>
                  <ul className="mt-2 divide-y divide-slate-100">
                    {hostSentMessages.map((item) => (
                      <li key={item.id} className="py-3">
                        <p className="truncate text-sm font-medium text-slate-900">{item.subject}</p>
                        <p className="mt-1 truncate text-xs text-slate-600">{item.from}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.date}</p>
                        {item.body && <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer font-medium">View message</summary><p className="mt-2 whitespace-pre-wrap">{item.body}</p></details>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {activeFolder === 'drafts' && (
            <DraftFolder drafts={drafts} onOpen={openDraft} onTrash={(draft) => void moveDraftToTrash(draft)} />
          )}
          {activeFolder === 'trash' && (
            <div className="space-y-5">
              <MailTrashFolder
                messages={mailTrashMessages}
                folderAvailable={trashFolderAvailable}
                onRestore={(message) => void restoreMailMessage(message)}
                onDelete={(message) => void permanentlyDeleteMailMessage(message)}
              />
              <TrashFolder drafts={trash} onRestore={(draft) => void restoreDraft(draft)} onDelete={(draft) => void permanentlyDeleteDraft(draft)} />
            </div>
          )}
          {activeFolder === 'campaigns' && role === 'admin' && (
            <div className="space-y-5">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-950">{editingCampaignId ? 'Edit campaign draft' : 'Create an email campaign'}</h2>
                    <p className="mt-1 text-sm text-slate-600">Send to leads with recorded marketing consent only.</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    campaignAudienceCount > 5000 ? 'bg-rose-50 text-rose-800' : 'bg-violet-50 text-violet-800'
                  }`}>
                    {campaignAudienceCount > 5000 ? 'Over 5,000 opted-in recipients' : `${campaignAudienceCount} opted-in recipients`}
                  </span>
                </div>
                {!settings.verified && (
                  <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    Verify the Hostinger connection in Integrations before scheduling or sending campaigns.
                  </p>
                )}
                {campaignAudienceCount > 5000 && (
                  <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                    Campaigns are limited to 5,000 recipients. Narrow the opted-in audience before sending.
                  </p>
                )}
                <form onSubmit={(event) => void saveCampaign(event)} className="mt-5 space-y-4">
                  <div>
                    <label htmlFor="campaign-name" className="mb-1 block text-sm font-medium text-slate-700">Campaign name</label>
                    <input id="campaign-name" value={campaignName} maxLength={160} required onChange={(event) => setCampaignName(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
                  </div>
                  <div>
                    <label htmlFor="campaign-subject" className="mb-1 block text-sm font-medium text-slate-700">Email subject</label>
                    <input id="campaign-subject" value={campaignSubject} maxLength={180} required onChange={(event) => setCampaignSubject(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
                  </div>
                  <div>
                    <label htmlFor="campaign-schedule" className="mb-1 block text-sm font-medium text-slate-700">Schedule for</label>
                    <div className="flex flex-wrap items-end gap-3">
                      <input id="campaign-schedule" type="datetime-local" value={campaignScheduleAt} onChange={(event) => setCampaignScheduleAt(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100 sm:w-auto" />
                      <button type="button" onClick={() => void scheduleCampaign()} disabled={!editingCampaignId || !settings.verified || campaignAudienceCount === 0 || campaignAudienceCount > 5000 || isCampaignAction || isLoading} className="inline-flex items-center gap-2 rounded-lg border border-violet-200 px-4 py-2.5 text-sm font-semibold text-violet-800 hover:bg-violet-50 disabled:opacity-50">
                        {isCampaignAction && <LoaderCircle className="h-4 w-4 animate-spin" />} Schedule campaign
                      </button>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="campaign-body" className="mb-1 block text-sm font-medium text-slate-700">Message</label>
                    <textarea id="campaign-body" value={campaignBody} maxLength={5000} rows={8} required onChange={(event) => setCampaignBody(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-6 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
                    <p className="mt-1 text-xs text-slate-500">Each campaign email includes a working unsubscribe link and one-click unsubscribe headers. Do not include sensitive health information.</p>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <button type="submit" disabled={isCampaignSaving || isLoading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      {isCampaignSaving && <LoaderCircle className="h-4 w-4 animate-spin" />}
                      {isCampaignSaving ? 'Saving…' : 'Save draft'}
                    </button>
                    <button type="button" onClick={() => void launchCampaign()} disabled={!editingCampaignId || !settings.verified || campaignAudienceCount === 0 || campaignAudienceCount > 5000 || isCampaignAction || isLoading} className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50">
                      {isCampaignAction && <LoaderCircle className="h-4 w-4 animate-spin" />} Send now
                    </button>
                  </div>
                  {!editingCampaignId && <p className="text-xs text-slate-500">Save the campaign draft first to enable scheduling or sending.</p>}
                </form>
              </section>

              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-amber-950">Scheduled campaign worker</h2>
                    <p className="mt-1 max-w-2xl text-sm text-amber-900">Hostinger must call the protected worker every minute to send scheduled campaigns and continue large sends (up to five recipients per run). Generate a command and add it as a Hostinger cron job.</p>
                  </div>
                  <button type="button" onClick={() => void generateCampaignWorkerCommand()} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-100">Generate cron command</button>
                </div>
                {campaignWorkerCommand && (
                  <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-amber-200 bg-white p-3 text-xs text-slate-800">{campaignWorkerCommand}</pre>
                )}
                <p className="mt-3 text-xs text-amber-900">The command contains a private worker token. Keep it secret. Generating a new command immediately invalidates the previous one.</p>
              </section>
            </div>
          )}
          {activeFolder === 'campaign-history' && role === 'admin' && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-950">Campaign history</h2>
                  <p className="mt-1 text-sm text-slate-600">View send progress and manage scheduled campaigns. “Sent” means accepted by SMTP; delivery and opens are not tracked.</p>
                </div>
                <button type="button" onClick={() => void loadData()} disabled={isLoading} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Refresh</button>
              </div>
              {campaigns.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">No campaigns yet. Create a campaign to get started.</p>
              ) : (
                <ul className="mt-4 divide-y divide-slate-100">
                  {campaigns.map((campaign) => (
                    <li key={campaign.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">{campaign.name}</p>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            campaign.status === 'sent' ? 'bg-emerald-50 text-emerald-800'
                              : campaign.status === 'partial' || campaign.status === 'failed' ? 'bg-rose-50 text-rose-800'
                                : campaign.status === 'sending' ? 'bg-blue-50 text-blue-800'
                                  : campaign.status === 'scheduled' ? 'bg-violet-50 text-violet-800'
                                    : 'bg-slate-100 text-slate-700'
                          }`}>{campaign.status}</span>
                        </div>
                        <p className="mt-1 truncate text-sm text-slate-700">{campaign.subject}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {campaign.recipientCount} recipients · {campaign.sentCount} sent · {campaign.failedCount} failed · {campaign.unsubscribedCount} unsubscribed
                          {campaign.scheduledAt ? ` · Scheduled ${new Date(`${campaign.scheduledAt.replace(' ', 'T')}Z`).toLocaleString()}` : ''}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {campaign.status === 'draft' && (
                          <button
                            type="button"
                            onClick={() => {
                              openCampaignDraft(campaign);
                              setActiveFolder('campaigns');
                            }}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Edit draft
                          </button>
                        )}
                        {campaign.status === 'scheduled' && (
                          <button type="button" onClick={() => void cancelCampaign(campaign)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Cancel schedule</button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
        </div>
      </section>}

      {mode === 'mailbox' && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        Inbox, Hostinger Sent, and mailbox Trash connect over IMAP. CRM drafts and CRM-sent activity are stored separately. SMTP does not provide delivered/opened events, so those statistics are not available.
      </p>}
    </div>
  );
};

interface DraftFolderProps {
  drafts: MailDraft[];
  onOpen: (draft: MailDraft) => void;
  onTrash: (draft: MailDraft) => void;
}

const DraftFolder: React.FC<DraftFolderProps> = ({ drafts, onOpen, onTrash }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <h2 className="font-semibold text-slate-950">Drafts</h2>
    <p className="mt-1 text-sm text-slate-600">Saved in the CRM and available across signed-in sessions.</p>
    {drafts.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No drafts saved.</p> : (
      <ul className="mt-4 divide-y divide-slate-100">
        {drafts.map((draft) => (
          <li key={draft.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <button type="button" onClick={() => onOpen(draft)} className="min-w-0 flex-1 text-left">
              <p className="truncate text-sm font-semibold text-slate-900">{draft.subject || '(no subject)'}</p>
              <p className="mt-1 truncate text-xs text-slate-600">{draft.recipientEmail || 'No recipient'} · Updated {draft.updatedAt}</p>
              {draft.body && <p className="mt-1 truncate text-xs text-slate-500">{draft.body}</p>}
            </button>
            <button type="button" onClick={() => onTrash(draft)} aria-label={`Move ${draft.subject || 'draft'} to Trash`} className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700">
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
);

interface MailTrashFolderProps {
  messages: InboxMessage[];
  folderAvailable: boolean;
  onRestore: (message: InboxMessage) => void;
  onDelete: (message: InboxMessage) => void;
}

const MailTrashFolder: React.FC<MailTrashFolderProps> = ({ messages, folderAvailable, onRestore, onDelete }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <h2 className="font-semibold text-slate-950">Hostinger mailbox Trash</h2>
    {!folderAvailable ? (
      <p className="py-6 text-sm text-slate-500">A Hostinger Trash folder was not found for this mailbox.</p>
    ) : messages.length === 0 ? (
      <p className="py-6 text-sm text-slate-500">Hostinger Trash is empty.</p>
    ) : (
      <ul className="mt-4 divide-y divide-slate-100">
        {messages.map((message) => (
          <li key={message.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{message.subject}</p>
              <p className="mt-1 truncate text-xs text-slate-600">{message.from} · {message.date}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => onRestore(message)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Restore to Inbox</button>
              <button type="button" onClick={() => onDelete(message)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Delete permanently</button>
            </div>
          </li>
        ))}
      </ul>
    )}
  </section>
);

interface TrashFolderProps {
  drafts: MailDraft[];
  onRestore: (draft: MailDraft) => void;
  onDelete: (draft: MailDraft) => void;
}

const TrashFolder: React.FC<TrashFolderProps> = ({ drafts, onRestore, onDelete }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <h2 className="font-semibold text-slate-950">Trash</h2>
    <p className="mt-1 text-sm text-slate-600">Deleted CRM drafts can be restored or permanently removed.</p>
    {drafts.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">Trash is empty.</p> : (
      <ul className="mt-4 divide-y divide-slate-100">
        {drafts.map((draft) => (
          <li key={draft.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{draft.subject || '(no subject)'}</p>
              <p className="mt-1 truncate text-xs text-slate-600">{draft.recipientEmail || 'No recipient'} · {draft.updatedAt}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => onRestore(draft)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Restore</button>
              <button type="button" onClick={() => onDelete(draft)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Delete permanently</button>
            </div>
          </li>
        ))}
      </ul>
    )}
  </section>
);
