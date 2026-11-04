import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
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
  initialFolder?: 'inbox' | 'campaigns';
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
  cc: string[];
  bcc: string[];
  threadHeaders: { 'In-Reply-To'?: string; References?: string };
}

interface MailDraft {
  id: string;
  recipientEmail: string;
  subject: string;
  body: string;
  cc: string[];
  bcc: string[];
  threadHeaders: { 'In-Reply-To'?: string; References?: string };
  attachments: MailAttachment[];
  updatedAt: string;
}

interface MailAttachment {
  name: string;
  contentType: string;
  content: string;
}

interface InboxMessage {
  id: string;
  folder: string;
  from: string;
  subject: string;
  date: string;
  body: string;
  unread: boolean;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  detailsLoaded?: boolean;
  detailsLoading?: boolean;
  attachments?: MailAttachment[];
}

type MailboxFolder = 'inbox' | 'compose' | 'sent' | 'drafts' | 'trash' | 'campaigns' | 'campaign-history';

interface MailCampaign {
  id: string;
  name: string;
  subject: string;
  body: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'partial' | 'failed';
  scheduledAt: string | null;
  audienceFilter: CampaignAudienceFilter;
  trackOpens: boolean;
  openCount: number;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  unsubscribedCount: number;
  createdAt: string;
  completedAt: string | null;
}

interface CampaignAudienceFilter {
  country: string;
  status: string;
  source: string;
}

const formatMailboxDate = (value: string, includeTime = false) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], includeTime
    ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric' });
};

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
  total?: number;
  page?: number;
  pageSize?: number;
  countries?: string[];
  statuses?: string[];
  sources?: string[];
  recipient?: string;
  body?: string;
  attachments?: MailAttachment[];
}

const campaignTemplates = {
  blank: { subject: '', body: '' },
  update: {
    subject: 'A note from Ambienta',
    body: 'Hello {{first_name}},\n\nWe have an update to share from Ambienta. Visit our website to learn more.\n\nWarm regards,\nAmbienta Customer Support',
  },
  welcome: {
    subject: 'Welcome to Ambienta',
    body: 'Hello {{first_name}},\n\nThank you for staying in touch with Ambienta. We are here to help with questions about our services.\n\nVisit ambienta.io for more information.\n\nWarm regards,\nAmbienta Customer Support',
  },
  seasonal: {
    subject: 'News from Ambienta',
    body: 'Hello {{first_name}},\n\nHere is the latest news from Ambienta. Visit our website to see current updates and offerings.\n\nWarm regards,\nAmbienta Customer Support',
  },
} as const;

const previewMergeTags = (value: string): string => value
  .replaceAll('{{first_name}}', 'Alex')
  .replaceAll('{{last_name}}', 'Morgan')
  .replaceAll('{{email}}', 'alex@example.com')
  .replaceAll('{{country}}', 'South Africa')
  .replace(/\*\*(.*?)\*\*/gs, '$1')
  .replace(/\*(.*?)\*/gs, '$1');

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

export const HostingerMailIntegration: React.FC<HostingerMailIntegrationProps> = ({ role, mode, initialFolder = 'inbox' }) => {
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
  const [campaignTemplate, setCampaignTemplate] = useState<keyof typeof campaignTemplates>('blank');
  const [campaignAudienceFilter, setCampaignAudienceFilter] = useState<CampaignAudienceFilter>({ country: '', status: '', source: '' });
  const [campaignCountries, setCampaignCountries] = useState<string[]>([]);
  const [campaignStatuses, setCampaignStatuses] = useState<string[]>([]);
  const [campaignSources, setCampaignSources] = useState<string[]>([]);
  const [campaignTrackOpens, setCampaignTrackOpens] = useState(false);
  const [campaignScheduleAt, setCampaignScheduleAt] = useState(getDefaultScheduleValue);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [campaignWorkerCommand, setCampaignWorkerCommand] = useState('');
  const campaignBodyRef = useRef<HTMLTextAreaElement>(null);
  const [isCampaignSaving, setIsCampaignSaving] = useState(false);
  const [isCampaignAction, setIsCampaignAction] = useState(false);
  const [drafts, setDrafts] = useState<MailDraft[]>([]);
  const [trash, setTrash] = useState<MailDraft[]>([]);
  const [inboxMessages, setInboxMessages] = useState<InboxMessage[]>([]);
  const [hostSentMessages, setHostSentMessages] = useState<InboxMessage[]>([]);
  const [mailTrashMessages, setMailTrashMessages] = useState<InboxMessage[]>([]);
  const [mailboxSearchInput, setMailboxSearchInput] = useState('');
  const [mailboxSearch, setMailboxSearch] = useState('');
  const [mailboxPage, setMailboxPage] = useState(1);
  const [mailboxTotal, setMailboxTotal] = useState(0);
  const [inboxFolderAvailable, setInboxFolderAvailable] = useState(true);
  const [sentFolderAvailable, setSentFolderAvailable] = useState(false);
  const [trashFolderAvailable, setTrashFolderAvailable] = useState(false);
  const [activeFolder, setActiveFolder] = useState<MailboxFolder>(initialFolder);
  const [selectedMailboxMessageId, setSelectedMailboxMessageId] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [threadHeaders, setThreadHeaders] = useState<{ 'In-Reply-To'?: string; References?: string }>({});
  const [attachments, setAttachments] = useState<MailAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncingInbox, setIsSyncingInbox] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (mode === 'mailbox' && settings.verified) {
      if (activeFolder === 'inbox' || activeFolder === 'sent' || activeFolder === 'trash') {
        void refreshMailboxFolder(activeFolder);
        const interval = window.setInterval(() => void refreshMailboxFolder(activeFolder), 60_000);
        return () => window.clearInterval(interval);
      }
    }
  }, [mode, activeFolder, settings.verified, mailboxPage, mailboxSearch]);

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
          if (!Array.isArray(campaignResult.campaigns) || typeof audienceResult.audienceCount !== 'number'
            || !Array.isArray(audienceResult.countries) || !Array.isArray(audienceResult.statuses) || !Array.isArray(audienceResult.sources)) {
            throw new Error('Campaign data returned an invalid response.');
          }
          setCampaigns(campaignResult.campaigns);
          setCampaignAudienceCount(audienceResult.audienceCount);
          setCampaignCountries(audienceResult.countries);
          setCampaignStatuses(audienceResult.statuses);
          setCampaignSources(audienceResult.sources);
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

  useEffect(() => {
    if (mode !== 'mailbox' || role !== 'admin' || activeFolder !== 'campaigns') return;
    const query = new URLSearchParams({
      country: campaignAudienceFilter.country,
      status: campaignAudienceFilter.status,
      source: campaignAudienceFilter.source,
    }).toString();
    let active = true;
    const timeout = window.setTimeout(() => {
      void requestMailApi(`email-campaign-audience&${query}`, 'GET')
        .then((result) => {
          if (active && typeof result.audienceCount === 'number') setCampaignAudienceCount(result.audienceCount);
        })
        .catch((error: unknown) => {
          if (active) setErrorMessage(error instanceof Error ? error.message : 'The campaign audience could not be refreshed.');
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [campaignAudienceFilter, mode, role, activeFolder]);

  useEffect(() => {
    if (mode !== 'mailbox' || activeFolder !== 'campaign-history') return;
    const interval = window.setInterval(() => void loadData(), 60_000);
    return () => window.clearInterval(interval);
  }, [mode, activeFolder]);

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
      const result = await requestMailApi(
        `email-inbox&folder=${folder}&page=${mailboxPage}&search=${encodeURIComponent(mailboxSearch)}`,
        'GET'
      );
      if (!Array.isArray(result.mailboxMessages)) throw new Error('The mailbox response is invalid.');
      setMailboxTotal(result.total ?? 0);
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

  const setMessageReadState = async (message: InboxMessage, folder: 'inbox' | 'sent' | 'trash', seen: boolean) => {
    setErrorMessage('');
    try {
      await requestMailApi('email-message-seen', 'POST', { id: message.id, folder, seen });
      const update = (current: InboxMessage[]) => current.map((item) => item.id === message.id ? { ...item, unread: !seen } : item);
      if (folder === 'inbox') setInboxMessages(update);
      if (folder === 'sent') setHostSentMessages(update);
      if (folder === 'trash') setMailTrashMessages(update);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The message read status could not be updated.');
    }
  };

  const loadMessageDetails = async (message: InboxMessage, folder: 'inbox' | 'sent' | 'trash'): Promise<{ body: string; attachments: MailAttachment[] } | null> => {
    setErrorMessage('');
    const update = (current: InboxMessage[]) => current.map((item) => item.id === message.id ? { ...item, detailsLoading: true } : item);
    if (folder === 'inbox') setInboxMessages(update);
    if (folder === 'sent') setHostSentMessages(update);
    if (folder === 'trash') setMailTrashMessages(update);
    try {
      const result = await requestMailApi('email-message-details', 'POST', { id: message.id, folder });
      if (typeof result.body !== 'string' || !Array.isArray(result.attachments)) {
        throw new Error('The message details response was invalid.');
      }
      const updateDetails = (current: InboxMessage[]) => current.map((item) => item.id === message.id
        ? { ...item, body: result.body!, attachments: result.attachments!, detailsLoaded: true, detailsLoading: false }
        : item);
      if (folder === 'inbox') setInboxMessages(updateDetails);
      if (folder === 'sent') setHostSentMessages(updateDetails);
      if (folder === 'trash') setMailTrashMessages(updateDetails);
      return { body: result.body, attachments: result.attachments };
    } catch (error) {
      const clearLoading = (current: InboxMessage[]) => current.map((item) => item.id === message.id ? { ...item, detailsLoading: false } : item);
      if (folder === 'inbox') setInboxMessages(clearLoading);
      if (folder === 'sent') setHostSentMessages(clearLoading);
      if (folder === 'trash') setMailTrashMessages(clearLoading);
      setErrorMessage(error instanceof Error ? error.message : 'The message details could not be loaded.');
      return null;
    }
  };

  const replyToInbox = (message: InboxMessage) => {
    const address = message.from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
    if (!address) {
      setErrorMessage('This message does not contain a reply address.');
      return;
    }
    setRecipientEmail(address);
    setSubject(message.subject.toLowerCase().startsWith('re:') ? message.subject : `Re: ${message.subject}`);
    setMessageBody('');
    setCc('');
    setBcc('');
    setAttachments([]);
    setThreadHeaders({
      'In-Reply-To': message.messageId || undefined,
      References: [message.references, message.messageId].filter(Boolean).join(' ') || undefined,
    });
    setEditingDraftId(null);
    setActiveFolder('compose');
  };

  const forwardInboxMessage = async (message: InboxMessage) => {
    const details = message.detailsLoaded
      ? { body: message.body, attachments: message.attachments || [] }
      : await loadMessageDetails(message, 'inbox');
    if (details === null) return;
    setRecipientEmail('');
    setSubject(message.subject.toLowerCase().startsWith('fwd:') ? message.subject : `Fwd: ${message.subject}`);
    setMessageBody(`\n\n---------- Forwarded message ----------\nFrom: ${message.from}\nDate: ${message.date}\nSubject: ${message.subject}\n\n${details.body}`);
    setCc('');
    setBcc('');
    setAttachments(details.attachments);
    setThreadHeaders({});
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
        cc,
        bcc,
        threadHeaders,
        attachments,
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
    setCc(draft.cc.join(', '));
    setBcc(draft.bcc.join(', '));
    setThreadHeaders(draft.threadHeaders);
    setAttachments(draft.attachments);
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
      audienceFilter: campaignAudienceFilter,
      trackOpens: campaignTrackOpens,
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
    setCampaignTemplate('blank');
    setCampaignAudienceFilter(campaign.audienceFilter);
    setCampaignTrackOpens(campaign.trackOpens);
    setCampaignScheduleAt(getDefaultScheduleValue());
  };

  const scheduleCampaign = async () => {
    if (!editingCampaignId || !campaignScheduleAt) return;
    setErrorMessage('');
    setSuccessMessage('');
    setIsCampaignAction(true);
    try {
      const audienceQuery = new URLSearchParams({
        country: campaignAudienceFilter.country,
        status: campaignAudienceFilter.status,
        source: campaignAudienceFilter.source,
      });
      const audienceResult = await requestMailApi(`email-campaign-audience&${audienceQuery}`, 'GET');
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
      const audienceQuery = new URLSearchParams({
        country: campaignAudienceFilter.country,
        status: campaignAudienceFilter.status,
        source: campaignAudienceFilter.source,
      });
      const audienceResult = await requestMailApi(`email-campaign-audience&${audienceQuery}`, 'GET');
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

  const sendCampaignTest = async () => {
    if (!campaignSubject.trim() || !campaignBody.trim()) {
      setErrorMessage('Add a subject and message before sending a test.');
      return;
    }
    if (!window.confirm(`Send a test of "${campaignSubject}" to ${settings.emailAccount}?`)) return;
    setErrorMessage('');
    setSuccessMessage('');
    setIsCampaignAction(true);
    try {
      const result = await requestMailApi('email-campaign-test-send', 'POST', {
        subject: campaignSubject,
        body: campaignBody,
      });
      if (result.sent !== true) throw new Error('Hostinger did not accept the test email.');
      setSuccessMessage(`Hostinger accepted the test email for ${result.recipient || settings.emailAccount}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The campaign test email could not be sent.');
    } finally {
      setIsCampaignAction(false);
    }
  };

  const wrapCampaignSelection = (marker: '**' | '*') => {
    const textarea = campaignBodyRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = campaignBody.slice(start, end);
    const replacement = `${marker}${selected || 'text'}${marker}`;
    const nextBody = `${campaignBody.slice(0, start)}${replacement}${campaignBody.slice(end)}`;
    setCampaignBody(nextBody);
    requestAnimationFrame(() => {
      textarea.focus();
      const selectionStart = start + marker.length;
      const selectionEnd = selectionStart + (selected || 'text').length;
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
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
        cc,
        bcc,
        threadHeaders,
        attachments,
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
      setCc('');
      setBcc('');
      setThreadHeaders({});
      setAttachments([]);
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

  const addAttachments = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorMessage('');
    try {
      const selectedFiles = Array.from(files);
      if (attachments.length + selectedFiles.length > 5) {
        throw new Error('You can attach up to five files.');
      }
      const selectedBytes = selectedFiles.reduce((total, file) => total + file.size, 0);
      const currentBytes = attachments.reduce((total, attachment) => total + Math.floor(attachment.content.length * 3 / 4), 0);
      if (selectedBytes + currentBytes > 4 * 1024 * 1024) {
        throw new Error('Attachments must total 4 MB or less.');
      }
      const encoded = await Promise.all(selectedFiles.map(async (file): Promise<MailAttachment> => {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
          reader.onload = () => typeof reader.result === 'string'
            ? resolve(reader.result)
            : reject(new Error(`Could not read ${file.name}.`));
          reader.readAsDataURL(file);
        });
        return {
          name: file.name,
          contentType: file.type || 'application/octet-stream',
          content: dataUrl.split(',', 2)[1] || '',
        };
      }));
      setAttachments((current) => [...current, ...encoded]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The selected attachments could not be added.');
    }
  };

  const totalCampaignOpens = campaigns.reduce((total, campaign) => total + campaign.openCount, 0);
  const hasOpenTrackedCampaign = campaigns.some((campaign) => campaign.trackOpens);
  const selectedMailboxMessage = inboxMessages.find((message) => message.id === selectedMailboxMessageId) || inboxMessages[0] || null;

  return (
    <div className={mode === 'mailbox' ? 'mx-auto flex h-full min-h-0 max-w-[1500px] flex-col gap-3' : 'space-y-5'}>
      <header className={mode === 'mailbox' ? 'shrink-0 flex flex-wrap items-end justify-between gap-x-4 gap-y-2' : undefined}>
        <div className="min-w-0">
          <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${mode === 'settings' ? 'text-violet-700' : 'text-[#315649]'}`}>
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
        </div>
        {mode === 'mailbox' && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600" aria-label="Email activity summary">
            <span><strong className="text-slate-900">{messages.filter((item) => item.status === 'Sent').length}</strong> sent</span>
            <span>Delivery <strong className="text-slate-900">not tracked</strong></span>
            <span>Opens <strong className="text-slate-900">{hasOpenTrackedCampaign ? totalCampaignOpens : 'off'}</strong></span>
          </div>
        )}
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

      {mode === 'mailbox' && <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex min-w-0 flex-nowrap items-center gap-1 border-b border-slate-200 bg-white p-2">
          <button
            type="button"
            onClick={() => setActiveFolder('compose')}
            className={`mr-1 inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
              activeFolder === 'compose'
                ? 'bg-[#315649] text-white'
                : 'bg-[#315649] text-white hover:bg-[#26483b]'
            }`}
          >
            <Mail className="h-4 w-4" /> Compose
          </button>
          <nav aria-label="Email folders" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap">
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
                onClick={() => {
                  setMailboxPage(1);
                  setActiveFolder(folder);
                }}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  activeFolder === folder
                    ? 'bg-[#eaf0eb] text-[#315649]'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {count && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{count}</span>}
              </button>
            ))}
            {role === 'admin' && (
              <>
              <button
                type="button"
                aria-current={activeFolder === 'campaigns' || activeFolder === 'campaign-history' ? 'page' : undefined}
                onClick={() => setActiveFolder('campaigns')}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  activeFolder === 'campaigns' || activeFolder === 'campaign-history'
                    ? 'bg-[#eaf0eb] text-[#315649]'
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
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  activeFolder === 'campaign-history'
                    ? 'bg-[#eaf0eb] text-[#315649]'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">Campaign history</span>
              </button>
              </>
            )}
          </nav>
          <span className={`ml-auto hidden shrink-0 items-center gap-1.5 px-2 text-xs 2xl:inline-flex ${settings.verified ? 'text-emerald-700' : 'text-amber-700'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${settings.verified ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {settings.verified ? 'Connected' : 'Not verified'}
          </span>
        </div>

        <div className={`min-h-0 min-w-0 flex-1 bg-[#f7f9fb] p-2.5 sm:p-3 ${activeFolder === 'inbox' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto'}`}>
          {errorMessage && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{errorMessage}</p>}
          {successMessage && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{successMessage}</p>}

          {activeFolder === 'compose' && (
            <form onSubmit={(event) => void sendMessage(event)} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div>
                <h2 className="font-semibold text-slate-950">{editingDraftId ? 'Edit draft' : 'Compose an email'}</h2>
                <p className="mt-1 text-sm text-slate-600">Send through {settings.emailAccount}. Drafts are saved in the CRM.</p>
              </div>
              <div>
                <label htmlFor="mail-recipient" className="mb-1 block text-sm font-medium text-slate-700">To</label>
                <input id="mail-recipient" type="email" maxLength={254} value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
              </div>
              <details className="rounded-lg border border-slate-200 px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium text-slate-700">CC and BCC</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="mail-cc" className="mb-1 block text-xs font-medium text-slate-600">CC</label>
                    <input id="mail-cc" type="text" value={cc} onChange={(event) => setCc(event.target.value)} placeholder="Separate addresses with commas" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
                  </div>
                  <div>
                    <label htmlFor="mail-bcc" className="mb-1 block text-xs font-medium text-slate-600">BCC</label>
                    <input id="mail-bcc" type="text" value={bcc} onChange={(event) => setBcc(event.target.value)} placeholder="Separate addresses with commas" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
                  </div>
                </div>
              </details>
              <div>
                <label htmlFor="mail-subject" className="mb-1 block text-sm font-medium text-slate-700">Subject</label>
                <input id="mail-subject" maxLength={180} value={subject} onChange={(event) => setSubject(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
              </div>
              <div>
                <label htmlFor="mail-body" className="mb-1 block text-sm font-medium text-slate-700">Message</label>
                <textarea id="mail-body" maxLength={6000} rows={9} value={messageBody} onChange={(event) => setMessageBody(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-6 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
                <p className="mt-1 text-xs text-amber-700">Do not include medical or other sensitive health information in email.</p>
              </div>
              <div>
                <label htmlFor="mail-attachments" className="mb-1 block text-sm font-medium text-slate-700">Attachments</label>
                <input id="mail-attachments" type="file" multiple onChange={(event) => { void addAttachments(event.target.files); event.target.value = ''; }} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200" />
                <p className="mt-1 text-xs text-slate-500">Up to five files, 4 MB total.</p>
                {attachments.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {attachments.map((attachment, index) => (
                      <li key={`${attachment.name}-${index}`} className="flex items-center justify-between gap-2 text-xs text-slate-600">
                        <span className="truncate">{attachment.name}</span>
                        <button type="button" onClick={() => setAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index))} className="font-semibold text-rose-700">Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
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
            <section className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.4fr)]">
              <div className={`min-h-0 flex-col border-b border-slate-200 lg:flex lg:border-b-0 lg:border-r ${selectedMailboxMessageId ? 'hidden' : 'flex'}`}>
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-slate-950">Inbox</h2>
                      <p className="mt-0.5 text-xs text-slate-500">{mailboxTotal} messages</p>
                  </div>
                  <button type="button" onClick={() => void refreshInbox()} disabled={!settings.verified || isSyncingInbox} aria-label="Sync inbox" className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                    <RefreshCw className={`h-4 w-4 ${isSyncingInbox ? 'animate-spin' : ''}`} /> {isSyncingInbox ? 'Syncing' : 'Sync'}
                  </button>
                </div>
                <MailboxSearchControls
                  className="mb-0 space-y-2 border-b border-slate-100 p-2.5"
                  searchInput={mailboxSearchInput}
                  page={mailboxPage}
                  total={mailboxTotal}
                  disabled={!settings.verified}
                  onSearchChange={setMailboxSearchInput}
                  onSearch={(event) => {
                    event.preventDefault();
                    setMailboxPage(1);
                    setMailboxSearch(mailboxSearchInput.trim());
                  }}
                  onPageChange={setMailboxPage}
                />
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
                  {!settings.configured ? (
                    <p className="p-6 text-center text-sm text-slate-500">Configure the Hostinger mailbox under Integrations to load the inbox.</p>
                  ) : !inboxFolderAvailable ? (
                    <p className="p-6 text-center text-sm text-rose-700">The Hostinger inbox folder is unavailable.</p>
                  ) : isSyncingInbox && inboxMessages.length === 0 ? (
                    <p role="status" className="p-6 text-center text-sm text-slate-500">Synchronizing inbox…</p>
                  ) : inboxMessages.length === 0 ? (
                    <p className="p-6 text-center text-sm text-slate-500">No inbox messages. Use Sync to check again.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {inboxMessages.map((message) => (
                        <li key={message.id}>
                          <button type="button" onClick={() => setSelectedMailboxMessageId(message.id)} aria-current={selectedMailboxMessage?.id === message.id ? 'true' : undefined} className={`w-full border-l-2 px-3 py-2.5 text-left transition-colors ${selectedMailboxMessage?.id === message.id ? 'border-[#315649] bg-[#edf3ee]' : 'border-transparent hover:bg-slate-50'}`}>
                            <span className="flex items-center justify-between gap-2">
                              <span className={`truncate text-sm ${message.unread ? 'font-bold text-slate-950' : 'font-medium text-slate-800'}`}>{message.from.split('<')[0].trim() || message.from}</span>
                              <time className="shrink-0 text-[10px] text-slate-500" title={message.date}>{formatMailboxDate(message.date)}</time>
                            </span>
                            <span className="mt-1 block truncate text-sm text-slate-800">{message.subject || '(no subject)'}</span>
                            <span className="mt-1 block truncate text-xs text-slate-500">{message.body || 'Open message to view details'}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className={`min-h-0 min-w-0 overflow-hidden bg-white ${selectedMailboxMessageId ? 'block' : 'hidden lg:block'}`}>
                {selectedMailboxMessage ? (
                  <article className="flex h-full flex-col">
                    <header className="border-b border-slate-100 px-4 py-3 sm:px-5">
                      <button type="button" onClick={() => setSelectedMailboxMessageId(null)} className="mb-3 inline-flex items-center gap-1 rounded-md py-1 text-xs font-semibold text-slate-600 hover:text-slate-950 lg:hidden">
                        <ArrowLeft className="h-4 w-4" /> Back to messages
                      </button>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="break-words text-lg font-semibold tracking-tight text-slate-950">{selectedMailboxMessage.subject || '(no subject)'}</h3>
                          <p className="mt-2 break-all text-sm font-medium text-slate-700">{selectedMailboxMessage.from}</p>
                          <p className="mt-1 text-xs text-slate-500">{formatMailboxDate(selectedMailboxMessage.date, true)}</p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${selectedMailboxMessage.unread ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                          {selectedMailboxMessage.unread ? 'Unread' : 'Read'}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => replyToInbox(selectedMailboxMessage)} className="rounded-lg bg-[#315649] px-3 py-2 text-xs font-semibold text-white hover:bg-[#26483b]">Reply</button>
                        <button type="button" onClick={() => void forwardInboxMessage(selectedMailboxMessage)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Forward</button>
                        <button type="button" onClick={() => void setMessageReadState(selectedMailboxMessage, 'inbox', selectedMailboxMessage.unread)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">{selectedMailboxMessage.unread ? 'Mark read' : 'Mark unread'}</button>
                        <button type="button" onClick={() => void moveMailToTrash(selectedMailboxMessage)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Move to Trash</button>
                      </div>
                    </header>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-4 sm:px-5">
                      {selectedMailboxMessage.body ? (
                        <div className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{selectedMailboxMessage.body}</div>
                      ) : (
                        <p className="text-sm text-slate-500">Load the full message to view its content.</p>
                      )}
                      <MessageAttachmentActions message={selectedMailboxMessage} onLoad={() => void loadMessageDetails(selectedMailboxMessage, 'inbox')} />
                    </div>
                  </article>
                ) : (
                  <div className="flex h-full min-h-0 flex-col items-center justify-center px-6 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#edf3ee] text-[#315649]"><Inbox className="h-5 w-5" /></span>
                    <p className="mt-3 text-sm font-semibold text-slate-800">Select a message</p>
                    <p className="mt-1 text-xs text-slate-500">Choose an email from the list to read it here.</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {activeFolder === 'sent' && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-slate-950">Sent from CRM</h2>
                  <p className="mt-1 text-sm text-slate-600">Messages submitted from this CRM. Hostinger’s Sent folder auto-refreshes every minute.</p>
                </div>
                <button type="button" onClick={() => { void loadData(); void refreshMailboxFolder('sent'); }} disabled={isLoading || !settings.verified} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Refresh</button>
              </div>
              <MailboxSearchControls
                searchInput={mailboxSearchInput}
                page={mailboxPage}
                total={mailboxTotal}
                disabled={!settings.verified}
                onSearchChange={setMailboxSearchInput}
                onSearch={(event) => {
                  event.preventDefault();
                  setMailboxPage(1);
                  setMailboxSearch(mailboxSearchInput.trim());
                }}
                onPageChange={setMailboxPage}
              />
              {messages.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No email has been sent from the CRM yet.</p> : (
                <ul className="divide-y divide-slate-100">
                  {messages.map((item) => (
                    <li key={item.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-900">{item.subject || '(no subject)'}</p>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.status === 'Sent' ? 'bg-emerald-50 text-emerald-800' : item.status === 'Failed' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>{item.status}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-600">{item.recipientEmail} · {item.sentAt}</p>
                      {(item.cc.length > 0 || item.bcc.length > 0) && (
                        <p className="mt-1 text-xs text-slate-500">
                          {item.cc.length > 0 ? `CC: ${item.cc.join(', ')}` : ''}
                          {item.cc.length > 0 && item.bcc.length > 0 ? ' · ' : ''}
                          {item.bcc.length > 0 ? `BCC: ${item.bcc.join(', ')}` : ''}
                        </p>
                      )}
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
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <p className="text-xs text-slate-500">{item.date} {item.unread ? '· Unread' : ''}</p>
                          <button type="button" onClick={() => void setMessageReadState(item, 'sent', item.unread)} className="text-xs font-semibold text-violet-800">{item.unread ? 'Mark read' : 'Mark unread'}</button>
                        </div>
                        {item.body && <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer font-medium">View message</summary><p className="mt-2 whitespace-pre-wrap">{item.body}</p></details>}
                        <MessageAttachmentActions message={item} onLoad={() => void loadMessageDetails(item, 'sent')} />
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
              <MailboxSearchControls
                searchInput={mailboxSearchInput}
                page={mailboxPage}
                total={mailboxTotal}
                disabled={!settings.verified}
                onSearchChange={setMailboxSearchInput}
                onSearch={(event) => {
                  event.preventDefault();
                  setMailboxPage(1);
                  setMailboxSearch(mailboxSearchInput.trim());
                }}
                onPageChange={setMailboxPage}
              />
              <MailTrashFolder
                messages={mailTrashMessages}
                folderAvailable={trashFolderAvailable}
                onRestore={(message) => void restoreMailMessage(message)}
                onDelete={(message) => void permanentlyDeleteMailMessage(message)}
                onSetSeen={(message, seen) => void setMessageReadState(message, 'trash', seen)}
                onLoadDetails={(message) => void loadMessageDetails(message, 'trash')}
              />
              <TrashFolder drafts={trash} onRestore={(draft) => void restoreDraft(draft)} onDelete={(draft) => void permanentlyDeleteDraft(draft)} />
            </div>
          )}
          {activeFolder === 'campaigns' && role === 'admin' && (
            <div className="space-y-5">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
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
                    <label htmlFor="campaign-template" className="mb-1 block text-sm font-medium text-slate-700">Start from a template</label>
                    <select id="campaign-template" value={campaignTemplate} onChange={(event) => {
                      const template = campaignTemplates[event.target.value as keyof typeof campaignTemplates];
                      setCampaignTemplate(event.target.value as keyof typeof campaignTemplates);
                      setCampaignSubject(template.subject);
                      setCampaignBody(template.body);
                    }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100 sm:max-w-sm">
                      <option value="blank">Blank campaign</option>
                      <option value="welcome">Welcome</option>
                      <option value="update">Customer update</option>
                      <option value="seasonal">News announcement</option>
                    </select>
                  </div>
                  <fieldset className="rounded-xl border border-slate-200 p-4">
                    <legend className="px-1 text-sm font-semibold text-slate-800">Audience segments</legend>
                    <p className="mb-3 text-xs text-slate-500">All recipients must have recorded marketing consent. Filters narrow that opted-in audience.</p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="text-xs font-medium text-slate-600">
                        Country
                        <select value={campaignAudienceFilter.country} onChange={(event) => setCampaignAudienceFilter((current) => ({ ...current, country: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800">
                          <option value="">All countries</option>
                          {campaignCountries.map((country) => <option key={country} value={country}>{country}</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-medium text-slate-600">
                        Lead status
                        <select value={campaignAudienceFilter.status} onChange={(event) => setCampaignAudienceFilter((current) => ({ ...current, status: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800">
                          <option value="">All statuses</option>
                          {campaignStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-medium text-slate-600">
                        Lead source
                        <select value={campaignAudienceFilter.source} onChange={(event) => setCampaignAudienceFilter((current) => ({ ...current, source: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800">
                          <option value="">All sources</option>
                          {campaignSources.map((source) => <option key={source} value={source}>{source}</option>)}
                        </select>
                      </label>
                    </div>
                  </fieldset>
                  <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                    <input type="checkbox" checked={campaignTrackOpens} onChange={(event) => setCampaignTrackOpens(event.target.checked)} className="mt-0.5 rounded border-slate-300 text-violet-700 focus:ring-violet-500" />
                    <span><span className="font-medium">Enable approximate open tracking</span><span className="mt-1 block text-xs text-slate-500">Adds a 1-pixel image to campaign messages. Privacy features may block it, and image loads are not proof that a person read the email.</span></span>
                  </label>
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
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => wrapCampaignSelection('**')} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700">Bold</button>
                      <button type="button" onClick={() => wrapCampaignSelection('*')} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs italic text-slate-700">Italic</button>
                      <span className="text-xs text-slate-500">Personalize:</span>
                      {(['{{first_name}}', '{{last_name}}', '{{email}}', '{{country}}'] as const).map((tag) => (
                        <button key={tag} type="button" onClick={() => setCampaignBody((current) => `${current}${tag}`)} className="rounded-md bg-violet-50 px-2 py-1 font-mono text-[11px] text-violet-800">{tag}</button>
                      ))}
                    </div>
                    <textarea ref={campaignBodyRef} id="campaign-body" value={campaignBody} maxLength={20000} rows={8} required onChange={(event) => setCampaignBody(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm leading-6 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
                    <p className="mt-1 text-xs text-slate-500">Supports bold and italic formatting. Every campaign includes unsubscribe links and one-click unsubscribe headers. Do not include sensitive health information.</p>
                  </div>
                  <details className="rounded-lg border border-slate-200 p-3">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-700">Preview with sample recipient</summary>
                    <p className="mt-3 font-semibold text-slate-900">{previewMergeTags(campaignSubject) || '(subject preview)'}</p>
                    <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6 text-slate-700">{previewMergeTags(campaignBody) || '(message preview)'}</pre>
                  </details>
                  <div className="flex flex-wrap items-end gap-3">
                    <button type="submit" disabled={isCampaignSaving || isLoading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      {isCampaignSaving && <LoaderCircle className="h-4 w-4 animate-spin" />}
                      {isCampaignSaving ? 'Saving…' : 'Save draft'}
                    </button>
                    <button type="button" onClick={() => void launchCampaign()} disabled={!editingCampaignId || !settings.verified || campaignAudienceCount === 0 || campaignAudienceCount > 5000 || isCampaignAction || isLoading} className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50">
                      {isCampaignAction && <LoaderCircle className="h-4 w-4 animate-spin" />} Send now
                    </button>
                    <button type="button" onClick={() => void sendCampaignTest()} disabled={!settings.verified || !campaignSubject.trim() || !campaignBody.trim() || isCampaignAction || isLoading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      Send test to mailbox
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
            <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-950">Campaign history</h2>
                  <p className="mt-1 text-sm text-slate-600">View send progress and manage scheduled campaigns. SMTP acceptance is not confirmed delivery; open counts are approximate.</p>
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
                          {campaign.recipientCount} recipients · {campaign.sentCount} SMTP accepted · {campaign.failedCount} failed · {campaign.unsubscribedCount} unsubscribed · {campaign.trackOpens ? `${campaign.openCount} opens` : 'open tracking off'}
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
      </section>}

      {mode === 'mailbox' && <details className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">Email sync and tracking information</summary>
        <p className="mt-2">Inbox, Hostinger Sent, and mailbox Trash connect over IMAP. CRM drafts and CRM-sent activity are stored separately. Hostinger SMTP confirms acceptance only, not final delivery; campaign opens are approximate and available only when open tracking is enabled for a campaign.</p>
      </details>}
    </div>
  );
};

interface DraftFolderProps {
  drafts: MailDraft[];
  onOpen: (draft: MailDraft) => void;
  onTrash: (draft: MailDraft) => void;
}

interface MailboxSearchControlsProps {
  className?: string;
  searchInput: string;
  page: number;
  total: number;
  disabled: boolean;
  onSearchChange: (value: string) => void;
  onSearch: (event: React.FormEvent) => void;
  onPageChange: (page: number) => void;
}

const MailboxSearchControls: React.FC<MailboxSearchControlsProps> = ({
  className,
  searchInput,
  page,
  total,
  disabled,
  onSearchChange,
  onSearch,
  onPageChange,
}) => {
  const pageCount = Math.max(1, Math.ceil(total / 20));
  return (
    <div className={className || 'mb-4 space-y-3'}>
      <form onSubmit={onSearch} className="flex flex-wrap gap-2">
        <label htmlFor="mailbox-search" className="sr-only">Search Hostinger mailbox messages</label>
        <input
          id="mailbox-search"
          value={searchInput}
          maxLength={128}
          disabled={disabled}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search this Hostinger folder"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
        />
        <button type="submit" disabled={disabled} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">Search</button>
      </form>
      <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>{total} messages · Page {Math.min(page, pageCount)} of {pageCount}</span>
        <div className="flex gap-2">
          <button type="button" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)} className="rounded-md border border-slate-300 px-2.5 py-1.5 font-semibold text-slate-700 disabled:opacity-40">Previous</button>
          <button type="button" disabled={disabled || page >= pageCount} onClick={() => onPageChange(page + 1)} className="rounded-md border border-slate-300 px-2.5 py-1.5 font-semibold text-slate-700 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
};

const DraftFolder: React.FC<DraftFolderProps> = ({ drafts, onOpen, onTrash }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
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
  onSetSeen: (message: InboxMessage, seen: boolean) => void;
  onLoadDetails: (message: InboxMessage) => void;
}

const MailTrashFolder: React.FC<MailTrashFolderProps> = ({ messages, folderAvailable, onRestore, onDelete, onSetSeen, onLoadDetails }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
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
              <button type="button" onClick={() => onSetSeen(message, message.unread)} className="mt-1 text-xs font-semibold text-violet-800">{message.unread ? 'Mark read' : 'Mark unread'}</button>
              <MessageAttachmentActions message={message} onLoad={() => onLoadDetails(message)} />
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

interface MessageAttachmentActionsProps {
  message: InboxMessage;
  onLoad: () => void;
}

const MessageAttachmentActions: React.FC<MessageAttachmentActionsProps> = ({ message, onLoad }) => (
  <div className="mt-2">
    {!message.detailsLoaded ? (
      <button type="button" onClick={onLoad} disabled={message.detailsLoading} className="text-xs font-semibold text-violet-800 disabled:opacity-50">
        {message.detailsLoading ? 'Loading message…' : 'Load full message and attachments'}
      </button>
    ) : message.attachments?.length ? (
      <ul className="mt-2 space-y-1">
        {message.attachments.map((attachment, index) => (
          <li key={`${attachment.name}-${index}`}>
            <a
              href={`data:application/octet-stream;base64,${attachment.content}`}
              download={attachment.name}
              className="text-xs font-semibold text-violet-800 underline"
            >
              Download {attachment.name}
            </a>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-xs text-slate-500">No attachments.</p>
    )}
  </div>
);

interface TrashFolderProps {
  drafts: MailDraft[];
  onRestore: (draft: MailDraft) => void;
  onDelete: (draft: MailDraft) => void;
}

const TrashFolder: React.FC<TrashFolderProps> = ({ drafts, onRestore, onDelete }) => (
  <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
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
