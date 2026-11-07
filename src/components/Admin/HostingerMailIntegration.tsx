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
  Paperclip,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

interface HostingerMailIntegrationProps {
  role: 'admin' | 'operator';
  mode: 'settings' | 'mailbox';
  initialFolder?: 'inbox' | 'sent' | 'drafts' | 'trash' | 'campaigns' | 'campaign-history';
  canManageCampaigns?: boolean;
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
  messageId?: string | null;
  attachments?: MailAttachment[];
  detailsLoaded?: boolean;
  detailsLoading?: boolean;
}

interface MailDraft {
  id: string;
  recipientEmail: string;
  recipientLeadId?: number | null;
  replyMailbox?: { id: string; folder: 'inbox' } | null;
  subject: string;
  body: string;
  cc: string[];
  bcc: string[];
  threadHeaders: { 'In-Reply-To'?: string; References?: string };
  attachments: MailAttachment[];
  emailDesign: MailEmailDesign;
  updatedAt: string;
}

interface MailAttachment {
  name: string;
  contentType: string;
  content: string;
}

interface MailRecipientLead {
  id: number;
  name: string;
  email: string;
}

interface InboxMessage {
  id: string;
  folder: string;
  from: string;
  subject: string;
  date: string;
  body: string;
  unread: boolean;
  messageId?: string | null;
  inReplyTo?: string;
  references?: string;
  detailsLoaded?: boolean;
  detailsLoading?: boolean;
  attachments?: MailAttachment[];
}

type MailboxFolder = 'inbox' | 'compose' | 'sent' | 'drafts' | 'trash' | 'campaigns' | 'campaign-history';
type MailEmailDesign = 'card' | 'plain';
type CampaignReviewIntent = 'send' | 'schedule';
type CampaignDialogMode = 'preview' | 'review' | 'selection' | null;

interface MailCampaign {
  id: string;
  name: string;
  subject: string;
  body: string;
  emailDesign: MailEmailDesign;
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'partial' | 'failed';
  scheduledAt: string | null;
  audienceFilter: CampaignAudienceFilter;
  audienceMode: 'all' | 'selected';
  selectedLeadIds: number[];
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
  leads?: MailRecipientLead[];
  campaignId?: string;
  audienceCount?: number;
  audienceLimit?: number;
  snapshotHash?: string;
  selectedLeadIds?: number[];
  selectionLimit?: number;
  noCampaignCount?: number;
  withoutEmailCount?: number;
  total?: number;
  page?: number;
  pageSize?: number;
  recipientCount?: number;
  scheduled?: boolean;
  queued?: boolean;
  workerToken?: string;
  command?: string;
  processed?: number;
  failed?: number;
  sentCount?: number;
  failedCount?: number;
  queuedCount?: number;
  countries?: string[];
  statuses?: string[];
  sources?: string[];
  recipients?: MailRecipientLead[];
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

const formatMailText = (value: string): string => value
  .replace(/\*\*(.*?)\*\*/gs, '$1')
  .replace(/\*(.*?)\*/gs, '$1');

const formatCampaignPreviewHtml = (value: string): string => value
  .replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character] || character)
  .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
  .replace(/\*(.+?)\*/gs, '<em>$1</em>')
  .replace(/\n/g, '<br>');

const extractMessageIds = (value?: string | null): string[] => value?.match(/<[^<>\r\n]{1,990}>/g) || [];

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

export const HostingerMailIntegration: React.FC<HostingerMailIntegrationProps> = ({ role, mode, initialFolder = 'inbox', canManageCampaigns = false }) => {
  const campaignAccess = role === 'admin' || canManageCampaigns;
  const [settings, setSettings] = useState<MailSettings>({
    configured: false,
    verified: false,
    emailAccount: 'customersupport@ambienta.io',
    displayName: 'Ambienta Customer Support',
    smtpHost: 'smtp.hostinger.com',
    smtpPort: 465,
  });
  const [messages, setMessages] = useState<MailActivity[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activitySentCount, setActivitySentCount] = useState(0);
  const [campaigns, setCampaigns] = useState<MailCampaign[]>([]);
  const [campaignAudienceCount, setCampaignAudienceCount] = useState(0);
  const [campaignName, setCampaignName] = useState('');
  const [campaignSubject, setCampaignSubject] = useState('');
  const [campaignBody, setCampaignBody] = useState('');
  const [campaignEmailDesign, setCampaignEmailDesign] = useState<MailEmailDesign>('plain');
  const [campaignAudienceMode, setCampaignAudienceMode] = useState<'all' | 'selected'>('all');
  const [campaignSelectedLeadIds, setCampaignSelectedLeadIds] = useState<number[]>([]);
  const [campaignLeadSearch, setCampaignLeadSearch] = useState('');
  const [campaignLeadPage, setCampaignLeadPage] = useState(1);
  const [campaignLeadResults, setCampaignLeadResults] = useState<MailRecipientLead[]>([]);
  const [campaignLeadTotal, setCampaignLeadTotal] = useState(0);
  const [isLoadingCampaignLeads, setIsLoadingCampaignLeads] = useState(false);
  const [isSelectingCampaignMatches, setIsSelectingCampaignMatches] = useState(false);
  const [campaignNoCampaignCount, setCampaignNoCampaignCount] = useState(0);
  const [campaignWithoutEmailCount, setCampaignWithoutEmailCount] = useState(0);
  const [campaignDialogMode, setCampaignDialogMode] = useState<CampaignDialogMode>(null);
  const [campaignReviewIntent, setCampaignReviewIntent] = useState<CampaignReviewIntent>('send');
  const [campaignReviewPage, setCampaignReviewPage] = useState(1);
  const [campaignReviewRecipients, setCampaignReviewRecipients] = useState<MailRecipientLead[]>([]);
  const [campaignReviewTotal, setCampaignReviewTotal] = useState(0);
  const [campaignReviewSnapshotHash, setCampaignReviewSnapshotHash] = useState('');
  const [isLoadingCampaignReview, setIsLoadingCampaignReview] = useState(false);
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
  const mailBodyRef = useRef<HTMLTextAreaElement>(null);
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
  const [activeFolder, setActiveFolder] = useState<MailboxFolder>(
    !campaignAccess && (initialFolder === 'campaigns' || initialFolder === 'campaign-history') ? 'inbox' : initialFolder,
  );
  const [selectedMailboxMessageId, setSelectedMailboxMessageId] = useState<string | null>(null);
  const [sentSource, setSentSource] = useState<'crm' | 'hostinger'>('crm');
  const [selectedSentActivityId, setSelectedSentActivityId] = useState<string | null>(null);
  const [selectedHostSentMessageId, setSelectedHostSentMessageId] = useState<string | null>(null);
  const [mailThreadMessages, setMailThreadMessages] = useState<MailActivity[]>([]);
  const [isLoadingMailThread, setIsLoadingMailThread] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientType, setRecipientType] = useState<'to' | 'cc' | 'bcc'>('to');
  const [recipientLeadId, setRecipientLeadId] = useState('');
  const [recipientLeads, setRecipientLeads] = useState<MailRecipientLead[]>([]);
  const [replyMailbox, setReplyMailbox] = useState<{ id: string; folder: 'inbox' } | null>(null);
  const [subject, setSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [emailDesign, setEmailDesign] = useState<MailEmailDesign>('plain');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [threadHeaders, setThreadHeaders] = useState<{ 'In-Reply-To'?: string; References?: string }>({});
  const [attachments, setAttachments] = useState<MailAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncingInbox, setIsSyncingInbox] = useState(false);
  const [isSyncingSent, setIsSyncingSent] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const showErrorMessage = errorMessage !== 'A valid agent account is required to manage email campaigns.';

  useEffect(() => {
    if (mode !== 'mailbox') return;
    const url = new URL(window.location.href);
    if (activeFolder === 'inbox') url.searchParams.delete('emailFolder');
    else if (activeFolder === 'compose') url.searchParams.delete('emailFolder');
    else url.searchParams.set('emailFolder', activeFolder);
    window.history.replaceState(window.history.state, '', url);
  }, [activeFolder, mode]);

  useEffect(() => {
    if (mode === 'mailbox' && settings.verified) {
      const mailboxFolder = activeFolder === 'sent' && sentSource === 'crm' ? null : activeFolder;
      if (mailboxFolder === 'inbox' || mailboxFolder === 'sent' || mailboxFolder === 'trash') {
        void refreshMailboxFolder(mailboxFolder);
        const interval = window.setInterval(() => void refreshMailboxFolder(mailboxFolder), 60_000);
        return () => window.clearInterval(interval);
      }
    }
  }, [mode, activeFolder, sentSource, settings.verified, mailboxPage, mailboxSearch]);

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
        if (role === 'operator') {
          const recipientResult = await requestMailApi('email-recipient-leads', 'GET');
          if (!Array.isArray(recipientResult.recipients)) {
            throw new Error('The authorized email recipient list is invalid.');
          }
          setRecipientLeads(recipientResult.recipients);
        }
        const [activityResult, draftResult, trashResult] = await Promise.all([
          requestMailApi(`email-activity&page=${activeFolder === 'sent' && sentSource === 'crm' ? mailboxPage : 1}&search=${encodeURIComponent(activeFolder === 'sent' && sentSource === 'crm' ? mailboxSearch : '')}`, 'GET'),
          requestMailApi('email-drafts', 'GET'),
          requestMailApi('email-draft-trash', 'GET'),
        ]);
        if (!Array.isArray(activityResult.messages) || !Array.isArray(draftResult.drafts) || !Array.isArray(trashResult.drafts)) {
          throw new Error('The email folders returned an invalid response.');
        }
        setMessages(activityResult.messages);
        setActivityTotal(activityResult.total ?? activityResult.messages.length);
        setActivitySentCount(activityResult.sentCount ?? activityResult.messages.filter((item) => item.status === 'Sent').length);
        setDrafts(draftResult.drafts);
        setTrash(trashResult.drafts);
        if (campaignAccess) {
          const [campaignResult, audienceResult] = await Promise.all([
            requestMailApi('email-campaigns', 'GET'),
            requestMailApi('email-campaign-audience', 'GET'),
          ]);
          if (!Array.isArray(campaignResult.campaigns) || typeof audienceResult.audienceCount !== 'number'
            || typeof audienceResult.noCampaignCount !== 'number' || typeof audienceResult.withoutEmailCount !== 'number'
            || !Array.isArray(audienceResult.countries) || !Array.isArray(audienceResult.statuses) || !Array.isArray(audienceResult.sources)) {
            throw new Error('Campaign data returned an invalid response.');
          }
          setCampaigns(campaignResult.campaigns);
          setCampaignAudienceCount(audienceResult.audienceCount);
          setCampaignNoCampaignCount(audienceResult.noCampaignCount);
          setCampaignWithoutEmailCount(audienceResult.withoutEmailCount);
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
    if (mode !== 'mailbox' || activeFolder !== 'sent' || sentSource !== 'crm') return;
    let active = true;
    void requestMailApi(`email-activity&page=${mailboxPage}&search=${encodeURIComponent(mailboxSearch)}`, 'GET')
      .then((result) => {
        if (!Array.isArray(result.messages)) throw new Error('The sent activity response was invalid.');
        if (!active) return;
        setMessages(result.messages);
        setActivityTotal(result.total ?? result.messages.length);
        setActivitySentCount(result.sentCount ?? result.messages.filter((item) => item.status === 'Sent').length);
        if (typeof result.page === 'number' && result.page !== mailboxPage) setMailboxPage(result.page);
      })
      .catch((error: unknown) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'CRM sent activity could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [mode, activeFolder, sentSource, mailboxPage, mailboxSearch]);

  useEffect(() => {
    if (mode !== 'mailbox' || !campaignAccess || activeFolder !== 'campaigns') return;
    let active = true;
    const timeout = window.setTimeout(() => {
      const request = campaignAudienceMode === 'selected'
        ? requestMailApi('email-campaign-audience', 'POST', { selectedLeadIds: campaignSelectedLeadIds })
        : requestMailApi(`email-campaign-audience&${new URLSearchParams({
          country: campaignAudienceFilter.country,
          status: campaignAudienceFilter.status,
          source: campaignAudienceFilter.source,
        })}`, 'GET');
      void request
        .then((result) => {
          if (active && typeof result.audienceCount === 'number') {
            setCampaignAudienceCount(result.audienceCount);
            if (typeof result.noCampaignCount === 'number') setCampaignNoCampaignCount(result.noCampaignCount);
            if (typeof result.withoutEmailCount === 'number') setCampaignWithoutEmailCount(result.withoutEmailCount);
          }
        })
        .catch((error: unknown) => {
          if (active) setErrorMessage(error instanceof Error ? error.message : 'The campaign audience could not be refreshed.');
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [campaignAudienceFilter, campaignAudienceMode, campaignSelectedLeadIds, mode, campaignAccess, activeFolder]);

  useEffect(() => {
    if (mode !== 'mailbox' || !campaignAccess || activeFolder !== 'campaigns' || campaignAudienceMode !== 'selected') return;
    let active = true;
    setIsLoadingCampaignLeads(true);
    const query = new URLSearchParams({
      view: 'leads',
      search: campaignLeadSearch.trim(),
      page: String(campaignLeadPage),
      country: campaignAudienceFilter.country,
      status: campaignAudienceFilter.status,
      source: campaignAudienceFilter.source,
    });
    const timeout = window.setTimeout(() => {
      setIsLoadingCampaignLeads(true);
      void requestMailApi(`email-campaign-audience&${query}`, 'GET')
        .then((result) => {
          if (!Array.isArray(result.leads) || typeof result.total !== 'number') {
            throw new Error('The Contact Leads selection list is invalid.');
          }
          if (!active) return;
          setCampaignLeadResults(result.leads);
          setCampaignLeadTotal(result.total);
        })
        .catch((error: unknown) => {
          if (active) setErrorMessage(error instanceof Error ? error.message : 'Eligible Contact Leads could not be loaded.');
        })
        .finally(() => {
          if (active) setIsLoadingCampaignLeads(false);
        });
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [campaignAudienceMode, campaignLeadSearch, campaignLeadPage, campaignAudienceFilter, mode, campaignAccess, activeFolder]);

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
    if (folder === 'sent') setIsSyncingSent(true);
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
      if (folder === 'sent') setIsSyncingSent(false);
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

  const replyToInbox = async (message: InboxMessage) => {
    const address = role === 'admin'
      ? message.from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
      : undefined;
    if (role === 'admin' && !address) {
      setErrorMessage('This message does not contain a reply address.');
      return;
    }
    const details = message.detailsLoaded
      ? { body: message.body }
      : await loadMessageDetails(message, 'inbox');
    if (details === null) return;
    setRecipientEmail(address || '');
    setRecipientType('to');
    setRecipientLeadId('');
    setReplyMailbox(role === 'operator' ? { id: message.id, folder: 'inbox' } : null);
    setSubject(message.subject.toLowerCase().startsWith('re:') ? message.subject : `Re: ${message.subject}`);
    const quotedBody = details.body.split(/\r?\n/).map((line) => `> ${line}`).join('\n');
    setMessageBody(role === 'admin' ? `\n\nOn ${formatMailboxDate(message.date, true)}, ${message.from} wrote:\n${quotedBody}` : '');
    setCc('');
    setBcc('');
    setAttachments([]);
    setThreadHeaders({});
    const messageIds = [...extractMessageIds(message.references), ...extractMessageIds(message.messageId)];
    const inReplyTo = extractMessageIds(message.messageId)[0];
    setThreadHeaders({
      'In-Reply-To': inReplyTo,
      References: [...new Set(messageIds)].join(' ') || undefined,
    });
    setEditingDraftId(null);
    setActiveFolder('compose');
  };

  const forwardInboxMessage = async (message: InboxMessage) => {
    if (role !== 'admin') return;
    const details = message.detailsLoaded
      ? { body: message.body, attachments: message.attachments || [] }
      : await loadMessageDetails(message, 'inbox');
    if (details === null) return;
    setRecipientEmail('');
    setRecipientType('to');
    setRecipientLeadId('');
    setReplyMailbox(null);
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
        ...(role === 'admin'
          ? { recipientEmail }
          : replyMailbox
            ? { replyMailbox }
            : { leadId: recipientLeadId ? Number(recipientLeadId) : undefined }),
        subject,
        body: messageBody,
        emailDesign,
        cc: role === 'admin' ? cc : '',
        bcc: role === 'admin' ? bcc : '',
        threadHeaders,
        attachments: role === 'admin' ? attachments : [],
      });
      if (!result.draft) throw new Error('The saved draft was missing from the response.');
      setDrafts((current) => [
        result.draft!,
        ...current.filter((draft) => draft.id !== result.draft!.id),
      ]);
      setEditingDraftId(result.draft.id);
      setRecipientLeadId(result.draft.recipientLeadId ? String(result.draft.recipientLeadId) : '');
      setReplyMailbox(result.draft.replyMailbox || null);
      setSuccessMessage('Draft saved.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The draft could not be saved.');
    }
  };

  const openDraft = (draft: MailDraft) => {
    setEditingDraftId(draft.id);
    setRecipientEmail(role === 'admin' ? draft.recipientEmail : '');
    setRecipientType('to');
    setRecipientLeadId(draft.recipientLeadId ? String(draft.recipientLeadId) : '');
    setReplyMailbox(draft.replyMailbox || null);
    setSubject(draft.subject);
    setMessageBody(draft.body);
    setEmailDesign(draft.emailDesign || 'plain');
    setCc(draft.cc.join(', '));
    setBcc(draft.bcc.join(', '));
    setThreadHeaders(role === 'admin' ? draft.threadHeaders : {});
    setAttachments(draft.attachments);
    setActiveFolder('compose');
  };

  const startNewCompose = () => {
    setEditingDraftId(null);
    setRecipientEmail('');
    setRecipientType('to');
    setRecipientLeadId('');
    setReplyMailbox(null);
    setSubject('');
    setMessageBody('');
    setEmailDesign('plain');
    setCc('');
    setBcc('');
    setThreadHeaders({});
    setAttachments([]);
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

  const refreshCampaignAudience = async (): Promise<ApiResponse> => campaignAudienceMode === 'selected'
    ? requestMailApi('email-campaign-audience', 'POST', { selectedLeadIds: campaignSelectedLeadIds })
    : requestMailApi(`email-campaign-audience&${new URLSearchParams({
      country: campaignAudienceFilter.country,
      status: campaignAudienceFilter.status,
      source: campaignAudienceFilter.source,
    })}`, 'GET');

  const loadCampaignReviewPage = async (page: number, intent: CampaignReviewIntent): Promise<boolean> => {
    setIsLoadingCampaignReview(true);
    try {
      const result = await requestMailApi('email-campaign-audience', 'POST', {
        action: 'review',
        audienceMode: campaignAudienceMode,
        audienceFilter: campaignAudienceFilter,
        selectedLeadIds: campaignSelectedLeadIds,
        page,
      });
      if (typeof result.audienceCount !== 'number' || typeof result.snapshotHash !== 'string' || !Array.isArray(result.recipients)) {
        throw new Error('The campaign recipient review could not be loaded.');
      }
      if (page > 1 && campaignReviewSnapshotHash && campaignReviewSnapshotHash !== result.snapshotHash) {
        throw new Error('The eligible audience changed while you were reviewing it. Please reopen the recipient review.');
      }
      setCampaignReviewRecipients(result.recipients);
      setCampaignReviewTotal(result.audienceCount);
      setCampaignReviewSnapshotHash(result.snapshotHash);
      setCampaignReviewPage(page);
      setCampaignReviewIntent(intent);
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The campaign recipient review could not be loaded.');
      return false;
    } finally {
      setIsLoadingCampaignReview(false);
    }
  };

  const openCampaignReview = async (intent: CampaignReviewIntent) => {
    if (!editingCampaignId) return;
    setErrorMessage('');
    setSuccessMessage('');
    setIsCampaignAction(true);
    try {
      const result = await refreshCampaignAudience();
      if (typeof result.audienceCount !== 'number') throw new Error('The campaign audience count is invalid.');
      setCampaignAudienceCount(result.audienceCount);
      if (result.audienceCount === 0 || result.audienceCount > 5000) {
        throw new Error(result.audienceCount === 0
          ? 'There are no eligible leads with valid email addresses for this campaign.'
          : 'Campaigns are limited to 5,000 recipients.');
      }
      if (await loadCampaignReviewPage(1, intent)) setCampaignDialogMode('review');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The campaign recipient list could not be reviewed.');
    } finally {
      setIsCampaignAction(false);
    }
  };

  const closeCampaignDialog = () => {
    if (isCampaignAction || isLoadingCampaignReview || isSelectingCampaignMatches) return;
    setCampaignDialogMode(null);
  };

  useEffect(() => {
    if (!campaignDialogMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeCampaignDialog();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [campaignDialogMode, isCampaignAction, isLoadingCampaignReview, isSelectingCampaignMatches]);

  const previewCampaignBody = campaignBody
    .replace(/\{\{\s*first_name\s*\}\}/gi, 'Alex')
    .replace(/\{\{\s*last_name\s*\}\}/gi, 'Morgan')
    .replace(/\{\{\s*email\s*\}\}/gi, 'alex.morgan@example.com')
    .replace(/\{\{\s*country\s*\}\}/gi, 'South Africa');
  const previewCampaignSubject = campaignSubject
    .replace(/\{\{\s*first_name\s*\}\}/gi, 'Alex')
    .replace(/\{\{\s*last_name\s*\}\}/gi, 'Morgan')
    .replace(/\{\{\s*email\s*\}\}/gi, 'alex.morgan@example.com')
    .replace(/\{\{\s*country\s*\}\}/gi, 'South Africa');

  const selectMatchingCampaignLeads = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    setIsSelectingCampaignMatches(true);
    try {
      const result = await requestMailApi('email-campaign-audience', 'POST', {
        action: 'selectMatching',
        search: campaignLeadSearch.trim(),
        audienceFilter: campaignAudienceFilter,
      });
      if (!Array.isArray(result.selectedLeadIds) || typeof result.total !== 'number') {
        throw new Error('The matching Contact Leads could not be selected.');
      }
      const selectedLeadIds = result.selectedLeadIds;
      const newSelection = Array.from(new Set([...campaignSelectedLeadIds, ...selectedLeadIds])).slice(0, 5000);
      setCampaignSelectedLeadIds(newSelection);
      setSuccessMessage(result.total > 5000
        ? `${newSelection.length - campaignSelectedLeadIds.length} matching leads added. The selection is capped at 5,000; narrow your search to choose a different group.`
        : `${newSelection.length - campaignSelectedLeadIds.length} matching eligible leads added.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Matching Contact Leads could not be selected.');
    } finally {
      setIsSelectingCampaignMatches(false);
    }
  };

  const clearMatchingCampaignLeads = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    setIsSelectingCampaignMatches(true);
    try {
      const result = await requestMailApi('email-campaign-audience', 'POST', {
        action: 'selectMatching',
        search: campaignLeadSearch.trim(),
        audienceFilter: campaignAudienceFilter,
      });
      if (!Array.isArray(result.selectedLeadIds) || typeof result.total !== 'number') {
        throw new Error('The matching Contact Leads could not be loaded.');
      }
      const matchingIds = new Set(result.selectedLeadIds);
      const removedCount = campaignSelectedLeadIds.filter((id) => matchingIds.has(id)).length;
      setCampaignSelectedLeadIds((current) => current.filter((id) => !matchingIds.has(id)));
      setSuccessMessage(result.total > 5000
        ? `${removedCount} matching leads removed. Narrow the category or search to clear more; matching results are capped at 5,000.`
        : `${removedCount} matching leads removed.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Matching Contact Leads could not be cleared.');
    } finally {
      setIsSelectingCampaignMatches(false);
    }
  };

  const persistCampaignDraft = async (): Promise<string> => {
    const result = await requestMailApi('email-campaign-save', 'POST', {
      ...(editingCampaignId ? { id: editingCampaignId } : {}),
      name: campaignName,
      subject: campaignSubject,
      body: campaignBody,
      emailDesign: campaignEmailDesign,
      audienceFilter: campaignAudienceFilter,
      audienceMode: campaignAudienceMode,
      selectedLeadIds: campaignSelectedLeadIds,
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
    setCampaignEmailDesign(campaign.emailDesign || 'plain');
    setCampaignAudienceMode(campaign.audienceMode || 'all');
    setCampaignSelectedLeadIds(campaign.selectedLeadIds || []);
    setCampaignLeadPage(1);
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
      const campaignId = await persistCampaignDraft();
      await requestMailApi('email-campaign-schedule', 'POST', {
        id: campaignId,
        scheduledAt: new Date(campaignScheduleAt).toISOString(),
        expectedSnapshotHash: campaignReviewSnapshotHash,
      });
      setSuccessMessage(`Campaign scheduled for ${new Date(campaignScheduleAt).toLocaleString()}.`);
      setEditingCampaignId(null);
      setCampaignName('');
      setCampaignSubject('');
      setCampaignBody('');
      setCampaignEmailDesign('plain');
      setCampaignAudienceMode('all');
      setCampaignSelectedLeadIds([]);
      setCampaignLeadSearch('');
      setCampaignLeadPage(1);
      setCampaignDialogMode(null);
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
      const campaignId = await persistCampaignDraft();
      const result = await requestMailApi('email-campaign-launch', 'POST', {
        id: campaignId,
        expectedSnapshotHash: campaignReviewSnapshotHash,
      });
      setSuccessMessage(`Campaign queued for ${result.recipientCount ?? campaignAudienceCount} leads. ${result.sent ?? 0} sent in the first batch; remaining messages will be processed by the scheduled worker.`);
      setEditingCampaignId(null);
      setCampaignName('');
      setCampaignSubject('');
      setCampaignBody('');
      setCampaignEmailDesign('plain');
      setCampaignAudienceMode('all');
      setCampaignSelectedLeadIds([]);
      setCampaignLeadSearch('');
      setCampaignLeadPage(1);
      setCampaignDialogMode(null);
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
        emailDesign: campaignEmailDesign,
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

  const wrapMessageSelection = (marker: '**' | '*') => {
    const textarea = mailBodyRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = messageBody.slice(start, end);
    const replacement = `${marker}${selected || 'text'}${marker}`;
    setMessageBody(`${messageBody.slice(0, start)}${replacement}${messageBody.slice(end)}`);
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
        ...(role === 'admin'
          ? { recipientEmail }
          : replyMailbox
            ? { replyMailbox }
            : { leadId: recipientLeadId ? Number(recipientLeadId) : undefined }),
        subject,
        body: messageBody,
        emailDesign,
        cc: role === 'admin' ? cc : '',
        bcc: role === 'admin' ? bcc : '',
        threadHeaders: role === 'admin' ? threadHeaders : {},
        attachments: role === 'admin' ? attachments : [],
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
      setRecipientType('to');
      setRecipientLeadId('');
      setReplyMailbox(null);
      setSubject('');
      setMessageBody('');
      setEmailDesign('plain');
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

  const loadSentActivityDetails = async (activity: MailActivity) => {
    setErrorMessage('');
    setMessages((current) => current.map((item) => item.id === activity.id ? { ...item, detailsLoading: true } : item));
    try {
      const result = await requestMailApi(`email-activity-details&id=${encodeURIComponent(activity.id)}`, 'GET');
      if (!Array.isArray(result.attachments)) throw new Error('The sent message details response was invalid.');
      setMessages((current) => current.map((item) => item.id === activity.id
        ? { ...item, attachments: result.attachments, detailsLoaded: true, detailsLoading: false }
        : item));
    } catch (error) {
      setMessages((current) => current.map((item) => item.id === activity.id ? { ...item, detailsLoading: false } : item));
      setErrorMessage(error instanceof Error ? error.message : 'The sent message details could not be loaded.');
    }
  };

  const totalCampaignOpens = campaigns.reduce((total, campaign) => total + campaign.openCount, 0);
  const hasOpenTrackedCampaign = campaigns.some((campaign) => campaign.trackOpens);
  const campaignMergeTags = role === 'admin'
    ? [
      { tag: '{{first_name}}', label: 'First name' },
      { tag: '{{last_name}}', label: 'Last name' },
      { tag: '{{email}}', label: 'Email' },
      { tag: '{{country}}', label: 'Country' },
    ]
    : [
      { tag: '{{first_name}}', label: 'First name' },
      { tag: '{{last_name}}', label: 'Last name' },
      { tag: '{{country}}', label: 'Country' },
    ];
  const selectedMailboxMessage = inboxMessages.find((message) => message.id === selectedMailboxMessageId) || inboxMessages[0] || null;
  const selectedSentActivity = messages.find((message) => message.id === selectedSentActivityId) || messages[0] || null;
  const selectedHostSentMessage = hostSentMessages.find((message) => message.id === selectedHostSentMessageId) || hostSentMessages[0] || null;
  const mailboxThreadRoot = role === 'operator'
    ? selectedMailboxMessage?.id || ''
    : extractMessageIds(selectedMailboxMessage?.references)[0]
      || extractMessageIds(selectedMailboxMessage?.messageId)[0]
      || '';
  const mailboxThreadQuery = role === 'operator'
    ? `email-thread&replyId=${encodeURIComponent(mailboxThreadRoot)}`
    : `email-thread&messageId=${encodeURIComponent(mailboxThreadRoot)}`;

  useEffect(() => {
    if (mode !== 'mailbox' || activeFolder !== 'inbox' || !mailboxThreadRoot) {
      setMailThreadMessages([]);
      return;
    }
    let active = true;
    setIsLoadingMailThread(true);
    void requestMailApi(mailboxThreadQuery, 'GET')
      .then((result) => {
        if (!Array.isArray(result.messages)) throw new Error('The email conversation response was invalid.');
        if (active) setMailThreadMessages(result.messages);
      })
      .catch((error: unknown) => {
        if (active) setErrorMessage(error instanceof Error ? error.message : 'The email conversation could not be loaded.');
      })
      .finally(() => {
        if (active) setIsLoadingMailThread(false);
      });
    return () => {
      active = false;
    };
  }, [mode, activeFolder, mailboxThreadRoot, mailboxThreadQuery]);

  return (
    <div className={mode === 'mailbox' ? 'mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col gap-3' : 'space-y-5'}>
      <header className={mode === 'mailbox' ? 'shrink-0 flex flex-wrap items-end justify-between gap-x-4 gap-y-2' : undefined}>
        <div className="min-w-0">
          <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${mode === 'settings' ? 'text-violet-700' : 'text-[#1e40af]'}`}>
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
          <div className="flex flex-col items-start gap-1 text-xs text-slate-600 sm:items-end">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Email activity summary">
              <span><strong className="text-slate-900">{activitySentCount}</strong> SMTP accepted</span>
              <span>Final delivery <strong className="text-slate-900">not confirmed</strong></span>
              <span>Opens <strong className="text-slate-900">{hasOpenTrackedCampaign ? totalCampaignOpens : 'off'}</strong></span>
            </div>
            <details className="relative text-xs">
              <summary className="cursor-pointer text-slate-500 hover:text-slate-800">Email sync and tracking information</summary>
              <p className="mt-1 max-w-md text-left leading-5 text-slate-600 sm:text-right">Inbox, Hostinger Sent, and mailbox Trash connect over IMAP. CRM drafts and CRM-sent activity are stored separately. Hostinger SMTP confirms acceptance only, not final delivery; campaign opens are approximate and available only when open tracking is enabled for a campaign.</p>
            </details>
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
              ? 'bg-blue-50 text-blue-800'
              : settings.configured
                ? 'bg-amber-50 text-amber-800'
                : 'bg-slate-100 text-slate-700'
          }`}>
            {settings.verified ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            {settings.verified ? 'Connection verified' : settings.configured ? 'Credentials saved · not tested' : 'Not configured'}
          </span>
        </div>

        {showErrorMessage && errorMessage && (
          <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{errorMessage}</p>
        )}
        {successMessage && (
          <p role="status" className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{successMessage}</p>
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

      {mode === 'mailbox' && <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-w-0 flex-nowrap items-center gap-1 border-b border-slate-200 bg-white p-2">
          <button
            type="button"
            onClick={startNewCompose}
            className={`mr-1 inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
              activeFolder === 'compose'
                ? 'bg-[#1e40af] text-white'
                : 'bg-[#1e40af] text-white hover:bg-[#1e40af]'
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
                    ? 'bg-[#e8f2fb] text-[#1e40af]'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {count && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{count}</span>}
              </button>
            ))}
            {campaignAccess && (
              <>
              <button
                type="button"
                aria-current={activeFolder === 'campaigns' || activeFolder === 'campaign-history' ? 'page' : undefined}
                onClick={() => setActiveFolder('campaigns')}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  activeFolder === 'campaigns' || activeFolder === 'campaign-history'
                    ? 'bg-[#e8f2fb] text-[#1e40af]'
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
                    ? 'bg-[#e8f2fb] text-[#1e40af]'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">Campaign history</span>
              </button>
              </>
            )}
          </nav>
          <span className={`ml-auto hidden shrink-0 items-center gap-1.5 px-2 text-xs 2xl:inline-flex ${settings.verified ? 'text-blue-700' : 'text-amber-700'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${settings.verified ? 'bg-blue-500' : 'bg-amber-500'}`} />
            {settings.verified ? 'Connected' : 'Not verified'}
          </span>
        </div>

        <div className={`min-h-0 min-w-0 flex-1 bg-[#f7f9fb] p-2.5 sm:p-3 ${activeFolder === 'inbox' || activeFolder === 'sent' ? 'flex flex-col overflow-hidden' : activeFolder === 'compose' || activeFolder === 'campaigns' ? 'flex flex-col overflow-y-auto' : 'overflow-y-auto'}`}>
          {showErrorMessage && errorMessage && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{errorMessage}</p>}
          {successMessage && <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{successMessage}</p>}

          {activeFolder === 'compose' && (
            <form onSubmit={(event) => void sendMessage(event)} className="mx-auto flex min-h-full w-full max-w-5xl flex-1 flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold text-slate-950">{editingDraftId ? 'Edit draft' : 'Compose an email'}</h2>
                </div>
                <p className="max-w-full truncate text-xs text-slate-500 sm:max-w-[45%]">
                  From <span className="font-medium text-slate-800">{settings.emailAccount}</span>
                </p>
              </div>

              <div className="grid gap-2 md:grid-cols-12">
                <div className="md:col-span-9">
                  <label htmlFor="mail-recipient" className="mb-1 block text-xs font-semibold text-slate-600">{role === 'admin' ? 'Recipient' : 'To'}</label>
                  {role === 'admin' ? (
                    <div className="flex h-9 overflow-hidden rounded-lg border border-slate-300 focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-100">
                      <select
                        aria-label="Recipient type"
                        value={recipientType}
                        onChange={(event) => {
                          const type = event.target.value;
                          if (type === 'to' || type === 'cc' || type === 'bcc') setRecipientType(type);
                        }}
                        className="w-20 shrink-0 border-r border-slate-300 bg-slate-50 px-2 text-sm text-slate-700 focus:outline-none"
                      >
                        <option value="to">To</option>
                        <option value="cc">CC</option>
                        <option value="bcc">BCC</option>
                      </select>
                      <input
                        id="mail-recipient"
                        type={recipientType === 'to' ? 'email' : 'text'}
                        maxLength={recipientType === 'to' ? 254 : undefined}
                        value={recipientType === 'to' ? recipientEmail : recipientType === 'cc' ? cc : bcc}
                        onChange={(event) => {
                          if (recipientType === 'to') setRecipientEmail(event.target.value);
                          else if (recipientType === 'cc') setCc(event.target.value);
                          else setBcc(event.target.value);
                        }}
                        placeholder={recipientType === 'to' ? 'Email address' : 'Separate addresses with commas'}
                        className="h-full min-w-0 flex-1 px-3 text-sm focus:outline-none"
                      />
                    </div>
                  ) : replyMailbox ? (
                    <p className="flex h-9 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">Replying to selected inbox message; recipient hidden.</p>
                  ) : (
                    <select
                      id="mail-recipient"
                      value={recipientLeadId}
                      onChange={(event) => {
                        setRecipientLeadId(event.target.value);
                        setReplyMailbox(null);
                      }}
                      className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
                    >
                      <option value="">Select an assigned lead</option>
                      {recipientLeads.map((lead) => (
                        <option key={lead.id} value={lead.id}>{lead.name} · {lead.email}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="md:col-span-3">
                  <label htmlFor="mail-email-design" className="mb-1 block text-xs font-semibold text-slate-600">Design</label>
                  <select
                    id="mail-email-design"
                    value={emailDesign}
                    onChange={(event) => setEmailDesign(event.target.value as MailEmailDesign)}
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
                  >
                    <option value="plain">Plain email</option>
                    <option value="card">Designed card</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="mail-subject" className="mb-1 block text-xs font-semibold text-slate-600">Subject</label>
                <input id="mail-subject" maxLength={180} value={subject} onChange={(event) => setSubject(event.target.value)} className="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
              </div>
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="mail-body" className="block text-xs font-semibold text-slate-600">Message</label>
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <button type="button" onClick={() => wrapMessageSelection('**')} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">Bold</button>
                    <button type="button" onClick={() => wrapMessageSelection('*')} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs italic text-slate-700 hover:bg-slate-50">Italic</button>
                    {role === 'admin' && (
                      <label htmlFor="mail-attachments" title="Attach files (up to 5 files, 4 MB total)" className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-violet-200">
                        <Paperclip aria-hidden="true" className="h-4 w-4" />
                        <input id="mail-attachments" type="file" multiple aria-label="Attach files" onChange={(event) => { void addAttachments(event.target.files); event.target.value = ''; }} className="sr-only" />
                      </label>
                    )}
                    {role === 'admin' && attachments.map((attachment, index) => (
                      <span key={`${attachment.name}-${index}`} className="inline-flex max-w-40 items-center gap-1 rounded bg-slate-50 py-0.5 pl-2 pr-1 text-[11px] text-slate-600">
                        <span className="truncate">{attachment.name}</span>
                        <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => setAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index))} className="shrink-0 rounded px-1 font-semibold text-slate-500 hover:bg-slate-200 hover:text-rose-700">×</button>
                      </span>
                    ))}
                  </div>
                </div>
                <textarea ref={mailBodyRef} id="mail-body" maxLength={6000} value={messageBody} onChange={(event) => setMessageBody(event.target.value)} className="min-h-40 w-full flex-1 resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm leading-5 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-3">
                <button type="button" onClick={() => void saveDraft()} disabled={isLoading || (role === 'admin' ? (!recipientEmail && !subject && !messageBody) : (!recipientLeadId && !replyMailbox))} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  <FileText className="h-3.5 w-3.5" /> Save draft
                </button>
                <button type="submit" disabled={!settings.configured || !settings.verified || isSending || isLoading || (role === 'admin' ? !recipientEmail : (!recipientLeadId && !replyMailbox)) || !subject || !messageBody} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {isSending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {isSending ? 'Sending…' : 'Send email'}
                </button>
                {!settings.verified && <p className="mr-auto text-xs text-slate-500">Verify SMTP + IMAP under Integrations before sending.</p>}
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
                          <button type="button" onClick={() => setSelectedMailboxMessageId(message.id)} aria-current={selectedMailboxMessage?.id === message.id ? 'true' : undefined} className={`w-full border-l-2 px-3 py-2.5 text-left transition-colors ${selectedMailboxMessage?.id === message.id ? 'border-[#1e40af] bg-[#e8f2fb]' : 'border-transparent hover:bg-slate-50'}`}>
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
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${selectedMailboxMessage.unread ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>
                          {selectedMailboxMessage.unread ? 'Unread' : 'Read'}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => void replyToInbox(selectedMailboxMessage)} className="rounded-lg bg-[#1e40af] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1e40af]">Reply</button>
                        {role === 'admin' && <button type="button" onClick={() => void forwardInboxMessage(selectedMailboxMessage)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Forward</button>}
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
                      {role === 'admin' && <MessageAttachmentActions message={selectedMailboxMessage} onLoad={() => void loadMessageDetails(selectedMailboxMessage, 'inbox')} />}
                      <section className="mt-6 border-t border-slate-100 pt-4">
                        <h4 className="text-sm font-semibold text-slate-900">CRM replies in this conversation</h4>
                        {isLoadingMailThread ? (
                          <p role="status" className="mt-2 text-xs text-slate-500">Checking for replies sent from the CRM…</p>
                        ) : mailThreadMessages.length === 0 ? (
                          <p className="mt-2 text-xs text-slate-500">No CRM replies are recorded for this conversation.</p>
                        ) : (
                          <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                            {mailThreadMessages.map((reply) => (
                              <li key={reply.id} className="p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-xs font-medium text-slate-700">To: {reply.recipientEmail}</span>
                                  <time className="text-xs text-slate-500">{formatMailboxDate(reply.sentAt, true)}</time>
                                </div>
                                <p className="mt-1 text-sm font-semibold text-slate-900">{reply.subject || '(no subject)'}</p>
                                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{formatMailText(reply.body)}</p>
                                <p className="mt-2 text-xs text-slate-500">{reply.status === 'Sent' ? 'Accepted by SMTP; final delivery is not confirmed.' : reply.status}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </section>
                    </div>
                  </article>
                ) : (
                  <div className="flex h-full min-h-0 flex-col items-center justify-center px-6 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e8f2fb] text-[#1e40af]"><Inbox className="h-5 w-5" /></span>
                    <p className="mt-3 text-sm font-semibold text-slate-800">Select a message</p>
                    <p className="mt-1 text-xs text-slate-500">Choose an email from the list to read it here.</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {activeFolder === 'sent' && (
            <section className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.4fr)]">
              <div className={`min-h-0 flex-col border-b border-slate-200 lg:flex lg:border-b-0 lg:border-r ${selectedSentActivityId || selectedHostSentMessageId ? 'hidden' : 'flex'}`}>
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-slate-950">Sent mail</h2>
                    <p className="mt-0.5 text-xs text-slate-500">CRM activity and Hostinger mailbox</p>
                  </div>
                  <button type="button" onClick={() => { void loadData(); if (sentSource === 'hostinger') void refreshMailboxFolder('sent'); }} disabled={isLoading || (sentSource === 'hostinger' && (!settings.verified || isSyncingSent))} className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Refresh</button>
                </div>
                <div role="tablist" aria-label="Sent mail source" className="grid grid-cols-2 gap-1 border-b border-slate-100 p-2">
                  <button type="button" role="tab" aria-selected={sentSource === 'crm'} onClick={() => { setSentSource('crm'); setMailboxPage(1); setMailboxSearchInput(''); setMailboxSearch(''); setSelectedSentActivityId(null); setSelectedHostSentMessageId(null); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${sentSource === 'crm' ? 'bg-[#e8f2fb] text-[#1e40af]' : 'text-slate-600 hover:bg-slate-50'}`}>CRM sent ({activityTotal})</button>
                  <button type="button" role="tab" aria-selected={sentSource === 'hostinger'} onClick={() => { setSentSource('hostinger'); setMailboxPage(1); setMailboxSearchInput(''); setMailboxSearch(''); setSelectedSentActivityId(null); setSelectedHostSentMessageId(null); }} className={`rounded-lg px-3 py-2 text-sm font-semibold ${sentSource === 'hostinger' ? 'bg-[#e8f2fb] text-[#1e40af]' : 'text-slate-600 hover:bg-slate-50'}`}>Hostinger ({mailboxTotal})</button>
                </div>
                {sentSource === 'hostinger' && !settings.configured ? (
                  <p className="p-6 text-center text-sm text-slate-500">Configure the Hostinger mailbox to load sent messages.</p>
                ) : sentSource === 'hostinger' && isSyncingSent && hostSentMessages.length === 0 ? (
                  <p role="status" className="p-6 text-center text-sm text-slate-500">Synchronizing Hostinger Sent…</p>
                ) : sentSource === 'hostinger' && !sentFolderAvailable ? (
                  <p className="p-6 text-center text-sm text-amber-800">The Hostinger Sent folder was not found.</p>
                ) : (
                  <>
                    <MailboxSearchControls
                      className="mb-0 space-y-2 border-b border-slate-100 p-2.5"
                      searchInput={mailboxSearchInput}
                      page={mailboxPage}
                      total={sentSource === 'crm' ? activityTotal : mailboxTotal}
                      disabled={sentSource === 'hostinger' && !settings.verified}
                      searchLabel={sentSource === 'crm' ? 'Search CRM sent email activity' : undefined}
                      searchPlaceholder={sentSource === 'crm' ? 'Search recipient or subject' : undefined}
                      onSearchChange={setMailboxSearchInput}
                      onSearch={(event) => {
                        event.preventDefault();
                        setMailboxPage(1);
                        setMailboxSearch(mailboxSearchInput.trim());
                        setSelectedSentActivityId(null);
                        setSelectedHostSentMessageId(null);
                      }}
                      onPageChange={(page) => {
                        setMailboxPage(page);
                        setSelectedSentActivityId(null);
                        setSelectedHostSentMessageId(null);
                      }}
                    />
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
                      {sentSource === 'crm' ? (
                        messages.length === 0 ? (
                          <p className="p-6 text-center text-sm text-slate-500">No CRM-sent messages match this search.</p>
                        ) : (
                          <ul className="divide-y divide-slate-100">
                            {messages.map((item) => (
                              <li key={item.id}>
                                <button type="button" onClick={() => setSelectedSentActivityId(item.id)} aria-current={selectedSentActivity?.id === item.id ? 'true' : undefined} className={`w-full border-l-2 px-3 py-2.5 text-left transition-colors ${selectedSentActivity?.id === item.id ? 'border-[#1e40af] bg-[#e8f2fb]' : 'border-transparent hover:bg-slate-50'}`}>
                                  <span className="flex items-center justify-between gap-2">
                                    <span className="truncate text-sm font-semibold text-slate-900">{item.recipientEmail}</span>
                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.status === 'Sent' ? 'bg-blue-50 text-blue-800' : item.status === 'Failed' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>{item.status === 'Sent' ? 'SMTP accepted' : item.status}</span>
                                  </span>
                                  <span className="mt-1 block truncate text-sm text-slate-800">{item.subject || '(no subject)'}</span>
                                  <time className="mt-1 block truncate text-xs text-slate-500" title={item.sentAt}>{formatMailboxDate(item.sentAt, true)}</time>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )
                      ) : hostSentMessages.length === 0 ? (
                        <p className="p-6 text-center text-sm text-slate-500">{settings.configured ? 'No messages found in Hostinger Sent.' : 'Configure the Hostinger mailbox to load sent messages.'}</p>
                      ) : (
                        <ul className="divide-y divide-slate-100">
                          {hostSentMessages.map((item) => (
                            <li key={item.id}>
                              <button type="button" onClick={() => setSelectedHostSentMessageId(item.id)} aria-current={selectedHostSentMessage?.id === item.id ? 'true' : undefined} className={`w-full border-l-2 px-3 py-2.5 text-left transition-colors ${selectedHostSentMessage?.id === item.id ? 'border-[#1e40af] bg-[#e8f2fb]' : 'border-transparent hover:bg-slate-50'}`}>
                                <span className="flex items-center justify-between gap-2">
                                  <span className="truncate text-sm font-semibold text-slate-900">{item.from.split('<')[0].trim() || item.from}</span>
                                  <time className="shrink-0 text-[10px] text-slate-500" title={item.date}>{formatMailboxDate(item.date)}</time>
                                </span>
                                <span className="mt-1 block truncate text-sm text-slate-800">{item.subject || '(no subject)'}</span>
                                <span className="mt-1 block truncate text-xs text-slate-500">{item.body || 'Open message to view details'}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className={`min-h-0 min-w-0 overflow-hidden bg-white ${(selectedSentActivityId || selectedHostSentMessageId) ? 'block' : 'hidden lg:block'}`}>
                {sentSource === 'crm' && selectedSentActivity ? (
                  <article className="flex h-full flex-col">
                    <header className="border-b border-slate-100 px-4 py-3 sm:px-5">
                      <button type="button" onClick={() => setSelectedSentActivityId(null)} className="mb-3 inline-flex items-center gap-1 rounded-md py-1 text-xs font-semibold text-slate-600 hover:text-slate-950 lg:hidden"><ArrowLeft className="h-4 w-4" /> Back to messages</button>
                      <h3 className="break-words text-lg font-semibold tracking-tight text-slate-950">{selectedSentActivity.subject || '(no subject)'}</h3>
                      <p className="mt-2 break-all text-sm text-slate-700">To: {selectedSentActivity.recipientEmail}</p>
                      {selectedSentActivity.cc.length > 0 && <p className="mt-1 break-all text-xs text-slate-500">CC: {selectedSentActivity.cc.join(', ')}</p>}
                      {selectedSentActivity.bcc.length > 0 && <p className="mt-1 break-all text-xs text-slate-500">BCC: {selectedSentActivity.bcc.join(', ')}</p>}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${selectedSentActivity.status === 'Sent' ? 'bg-blue-50 text-blue-800' : selectedSentActivity.status === 'Failed' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>{selectedSentActivity.status === 'Sent' ? 'SMTP accepted' : selectedSentActivity.status}</span>
                        <time className="text-xs text-slate-500">{formatMailboxDate(selectedSentActivity.sentAt, true)}</time>
                      </div>
                      <p className="text-xs text-slate-500">{selectedSentActivity.status === 'Sent' ? 'Accepted by SMTP; final delivery is not confirmed.' : selectedSentActivity.status === 'Failed' ? 'Sending failed.' : 'Sending outcome is unknown; check Hostinger before retrying.'}</p>
                      {role === 'admin' && selectedSentActivity.messageId && <p className="mt-2 break-all text-xs text-slate-500">Message ID: {selectedSentActivity.messageId}</p>}
                    </header>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-4 sm:px-5">
                      <div className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{formatMailText(selectedSentActivity.body) || 'No message content was recorded.'}</div>
                      {role === 'admin' && !selectedSentActivity.detailsLoaded ? (
                        <button type="button" onClick={() => void loadSentActivityDetails(selectedSentActivity)} disabled={selectedSentActivity.detailsLoading} className="mt-4 text-xs font-semibold text-violet-800 disabled:opacity-50">
                          {selectedSentActivity.detailsLoading ? 'Loading attachments…' : 'Load attachments'}
                        </button>
                      ) : role === 'admin' && selectedSentActivity.attachments?.length ? (
                        <ul className="mt-4 space-y-1">
                          {selectedSentActivity.attachments.map((attachment, index) => (
                            <li key={`${attachment.name}-${index}`}>
                              <a href={`data:${attachment.contentType};base64,${attachment.content}`} download={attachment.name} className="text-xs font-semibold text-violet-800 underline">Download {attachment.name}</a>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="mt-4 text-xs text-slate-500">No attachments.</p>}
                    </div>
                  </article>
                ) : sentSource === 'hostinger' && selectedHostSentMessage ? (
                  <article className="flex h-full flex-col">
                    <header className="border-b border-slate-100 px-4 py-3 sm:px-5">
                      <button type="button" onClick={() => setSelectedHostSentMessageId(null)} className="mb-3 inline-flex items-center gap-1 rounded-md py-1 text-xs font-semibold text-slate-600 hover:text-slate-950 lg:hidden"><ArrowLeft className="h-4 w-4" /> Back to messages</button>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="break-words text-lg font-semibold tracking-tight text-slate-950">{selectedHostSentMessage.subject || '(no subject)'}</h3>
                          <p className="mt-2 break-all text-sm font-medium text-slate-700">{selectedHostSentMessage.from}</p>
                          <time className="mt-1 block text-xs text-slate-500">{formatMailboxDate(selectedHostSentMessage.date, true)}</time>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{selectedHostSentMessage.unread ? 'Unread' : 'Read'}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => void setMessageReadState(selectedHostSentMessage, 'sent', selectedHostSentMessage.unread)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">{selectedHostSentMessage.unread ? 'Mark read' : 'Mark unread'}</button>
                      </div>
                    </header>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-4 sm:px-5">
                      {selectedHostSentMessage.body ? <div className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">{selectedHostSentMessage.body}</div> : <p className="text-sm text-slate-500">Load the full message to view its content.</p>}
                      {role === 'admin' && <MessageAttachmentActions message={selectedHostSentMessage} onLoad={() => void loadMessageDetails(selectedHostSentMessage, 'sent')} />}
                    </div>
                  </article>
                ) : (
                  <div className="flex h-full min-h-0 flex-col items-center justify-center px-6 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#e8f2fb] text-[#1e40af]"><Send className="h-5 w-5" /></span>
                    <p className="mt-3 text-sm font-semibold text-slate-800">Select a sent message</p>
                    <p className="mt-1 text-xs text-slate-500">Choose a message from the list to read it here.</p>
                  </div>
                )}
              </div>
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
                showAttachments={role === 'admin'}
                onRestore={(message) => void restoreMailMessage(message)}
                onDelete={(message) => void permanentlyDeleteMailMessage(message)}
                onSetSeen={(message, seen) => void setMessageReadState(message, 'trash', seen)}
                onLoadDetails={(message) => void loadMessageDetails(message, 'trash')}
              />
              <TrashFolder drafts={trash} onRestore={(draft) => void restoreDraft(draft)} onDelete={(draft) => void permanentlyDeleteDraft(draft)} />
            </div>
          )}
          {activeFolder === 'campaigns' && campaignAccess && (
            <div className="space-y-4">
              <section>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                  <div>
                    <h2 className="font-semibold text-slate-950">{editingCampaignId ? 'Edit campaign draft' : 'Create an email campaign'}</h2>
                    <p className="mt-0.5 text-xs text-slate-600">{role === 'admin'
                      ? 'Choose all Contact Leads or select specific contacts. Leads on the No Campaign list and contacts without a valid email are excluded.'
                      : 'Choose from your assigned Contact Leads or select specific contacts. Leads on the No Campaign list and contacts without a valid email are excluded.'}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    campaignAudienceCount > 5000 ? 'bg-rose-50 text-rose-800' : 'bg-violet-50 text-violet-800'
                  }`}>
                    {campaignAudienceCount > 5000 ? 'Over 5,000 eligible contacts' : `${campaignAudienceCount} eligible contacts`}
                  </span>
                </div>
                {!settings.verified && (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Verify the Hostinger connection in Integrations before scheduling or sending campaigns.
                  </p>
                )}
                {campaignAudienceCount === 0 && (
                  <p role="status" className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    {campaignAudienceMode === 'selected'
                      ? campaignSelectedLeadIds.length === 0
                        ? 'Select at least one eligible Contact Lead to continue.'
                        : 'None of the selected leads are currently eligible. Check their email addresses and No Campaign status.'
                      : role === 'admin'
                        ? 'No eligible Contact Leads match. Add a valid email, remove excluded leads from the No Campaign list, or adjust the audience filters.'
                        : 'No eligible assigned Contact Leads match. Check that assigned leads have valid emails and are not on the No Campaign list, or adjust the filters.'}
                  </p>
                )}
                {campaignAudienceCount > 5000 && (
                  <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                    Campaigns are limited to 5,000 recipients. Narrow the audience before sending.
                  </p>
                )}
                <details className="mt-2 rounded-lg border border-slate-200 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-700">Why might a lead be excluded?</summary>
                  <div className="mt-2 space-y-1 text-xs text-slate-600">
                    <p className="text-[11px] text-slate-500">Counts cover all Contact Leads available to you, before any audience filters are applied.</p>
                    <p><strong className="text-slate-800">{campaignNoCampaignCount.toLocaleString()}</strong> lead records are on the No Campaign list.</p>
                    <p><strong className="text-slate-800">{campaignWithoutEmailCount.toLocaleString()}</strong> lead records have no email address. Invalid email addresses are excluded too.</p>
                    <p className="text-[11px] text-slate-500">These are lead-record counts and may overlap. Campaign recipient counts deduplicate matching email addresses.</p>
                  </div>
                </details>
                <form onSubmit={(event) => void saveCampaign(event)} className="space-y-2 pt-2">
                  <fieldset className="rounded-lg border border-slate-200 px-3 py-2">
                    <legend className="px-1 text-xs font-semibold text-slate-700">Who should receive this campaign?</legend>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      <label className="flex items-center gap-2 text-xs text-slate-700">
                        <input type="radio" name="campaign-audience-mode" value="all" checked={campaignAudienceMode === 'all'} onChange={() => setCampaignAudienceMode('all')} className="border-slate-300 text-violet-700 focus:ring-violet-500" />
                        All eligible leads
                      </label>
                      <label className="flex items-center gap-2 text-xs text-slate-700">
                        <input type="radio" name="campaign-audience-mode" value="selected" checked={campaignAudienceMode === 'selected'} onChange={() => {
                          setCampaignAudienceMode('selected');
                          setCampaignDialogMode('selection');
                        }} className="border-slate-300 text-violet-700 focus:ring-violet-500" />
                        Select specific leads
                      </label>
                    </div>
                    {campaignAudienceMode === 'selected' && (
                      <button type="button" onClick={() => setCampaignDialogMode('selection')} className="mt-2 flex w-full items-center justify-between gap-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-left hover:bg-violet-100">
                        <span>
                          <span className="block text-xs font-semibold text-violet-950">Choose recipients</span>
                          <span className="mt-0.5 block text-[11px] text-violet-800">
                            {campaignSelectedLeadIds.length.toLocaleString()} selected · Use search and categories to manage your list
                          </span>
                        </span>
                        <span className="shrink-0 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-violet-800">Open selector</span>
                      </button>
                    )}
                    {campaignDialogMode === 'selection' && (
                      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-2 sm:p-5" onMouseDown={(event) => {
                        if (event.target === event.currentTarget) closeCampaignDialog();
                      }}>
                        <section role="dialog" aria-modal="true" aria-labelledby="campaign-selection-title" className="flex max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                          <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-6">
                            <div>
                              <h2 id="campaign-selection-title" className="text-base font-semibold text-slate-950">Choose campaign recipients</h2>
                              <p className="mt-1 text-xs text-slate-600">Search, filter by category, and select individual leads or whole matching groups.</p>
                            </div>
                            <button type="button" onClick={closeCampaignDialog} disabled={isSelectingCampaignMatches} aria-label="Close recipient selector" className="rounded-lg px-2 py-1 text-xl leading-none text-slate-500 hover:bg-slate-100 disabled:opacity-50">×</button>
                          </header>
                          {showErrorMessage && errorMessage && <p role="alert" className="mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 sm:mx-6">{errorMessage}</p>}
                          {successMessage && <p role="status" className="mx-4 mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 sm:mx-6">{successMessage}</p>}
                          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
                          <div className="rounded-lg bg-slate-50 p-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label htmlFor="campaign-lead-search" className="sr-only">Search eligible Contact Leads</label>
                          <input
                            id="campaign-lead-search"
                            type="search"
                            value={campaignLeadSearch}
                            onChange={(event) => {
                              setCampaignLeadSearch(event.target.value);
                              setCampaignLeadPage(1);
                            }}
                            placeholder="Search eligible leads by name or email"
                            className="h-9 min-w-56 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
                          />
                          <span className="text-xs font-medium text-slate-700">
                            {campaignSelectedLeadIds.length} selected
                          </span>
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                          <label className="text-[11px] font-medium text-slate-600">
                            Country
                            <select
                              value={campaignAudienceFilter.country}
                              onChange={(event) => {
                                setCampaignAudienceFilter((current) => ({ ...current, country: event.target.value }));
                                setCampaignLeadPage(1);
                              }}
                              className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-800"
                            >
                              <option value="">All countries</option>
                              {campaignCountries.map((country) => <option key={country} value={country}>{country}</option>)}
                            </select>
                          </label>
                          <label className="text-[11px] font-medium text-slate-600">
                            Lead status
                            <select
                              value={campaignAudienceFilter.status}
                              onChange={(event) => {
                                setCampaignAudienceFilter((current) => ({ ...current, status: event.target.value }));
                                setCampaignLeadPage(1);
                              }}
                              className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-800"
                            >
                              <option value="">All statuses</option>
                              {campaignStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                            </select>
                          </label>
                          <label className="text-[11px] font-medium text-slate-600">
                            Lead source
                            <select
                              value={campaignAudienceFilter.source}
                              onChange={(event) => {
                                setCampaignAudienceFilter((current) => ({ ...current, source: event.target.value }));
                                setCampaignLeadPage(1);
                              }}
                              className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-800"
                            >
                              <option value="">All sources</option>
                              {campaignSources.map((source) => <option key={source} value={source}>{source}</option>)}
                            </select>
                          </label>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Filter by category, then search within those eligible leads. Bulk actions apply to the entire matching group, not just this page.
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setCampaignSelectedLeadIds((current) => Array.from(new Set([...current, ...campaignLeadResults.map((lead) => lead.id)])).slice(0, 5000))}
                            disabled={isLoadingCampaignLeads || campaignLeadResults.every((lead) => campaignSelectedLeadIds.includes(lead.id)) || campaignSelectedLeadIds.length >= 5000}
                            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 disabled:opacity-50"
                          >
                            Select this page
                          </button>
                          <button
                            type="button"
                            onClick={() => void selectMatchingCampaignLeads()}
                            disabled={isLoadingCampaignLeads || isSelectingCampaignMatches || campaignLeadTotal === 0 || campaignSelectedLeadIds.length >= 5000}
                            className="rounded-md border border-violet-200 bg-white px-2.5 py-1 text-xs font-semibold text-violet-800 disabled:opacity-50"
                          >
                            {isSelectingCampaignMatches ? 'Applying…' : `Select all ${campaignLeadTotal > 5000 ? '5,000+' : campaignLeadTotal} matching`}
                          </button>
                          <button
                            type="button"
                            onClick={() => void clearMatchingCampaignLeads()}
                            disabled={isLoadingCampaignLeads || isSelectingCampaignMatches || campaignSelectedLeadIds.length === 0 || campaignLeadTotal === 0}
                            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 disabled:opacity-50"
                          >
                            Clear matching
                          </button>
                          <button
                            type="button"
                            onClick={() => setCampaignSelectedLeadIds((current) => current.filter((id) => !campaignLeadResults.some((lead) => lead.id === id)))}
                            disabled={campaignLeadResults.every((lead) => !campaignSelectedLeadIds.includes(lead.id))}
                            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 disabled:opacity-50"
                          >
                            Clear this page
                          </button>
                          {campaignSelectedLeadIds.length > 0 && (
                            <button type="button" onClick={() => setCampaignSelectedLeadIds([])} className="rounded-md px-2.5 py-1 text-xs font-medium text-violet-800 hover:bg-violet-100">
                              Clear all
                            </button>
                          )}
                          <span className="ml-auto text-[11px] text-slate-500">Only eligible leads are listed. Maximum 5,000 recipients.</span>
                        </div>
                        <div className="mt-2 max-h-[55vh] overflow-y-auto rounded-lg border border-slate-200 bg-white">
                          {isLoadingCampaignLeads ? (
                            <p className="px-3 py-5 text-center text-xs text-slate-500">Loading eligible leads…</p>
                          ) : campaignLeadResults.length === 0 ? (
                            <p className="px-3 py-5 text-center text-xs text-slate-500">No eligible leads found. A valid email is required and No Campaign contacts are excluded.</p>
                          ) : (
                            <ul className="divide-y divide-slate-100">
                              {campaignLeadResults.map((lead) => {
                                const isSelected = campaignSelectedLeadIds.includes(lead.id);
                                return (
                                  <li key={lead.id}>
                                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-violet-50">
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        disabled={!isSelected && campaignSelectedLeadIds.length >= 5000}
                                        onChange={(event) => setCampaignSelectedLeadIds((current) => event.target.checked
                                          ? current.length < 5000 ? [...current, lead.id] : current
                                          : current.filter((id) => id !== lead.id))}
                                        className="rounded border-slate-300 text-violet-700 focus:ring-violet-500"
                                      />
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-xs font-medium text-slate-800">{lead.name || 'Unnamed lead'}</span>
                                        <span className="block truncate text-[11px] text-slate-500">{lead.email}</span>
                                      </span>
                                    </label>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                          <span>{campaignLeadTotal > 5000 ? 'Showing up to 5,000 eligible leads' : `${campaignLeadTotal} eligible leads`}</span>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => setCampaignLeadPage((page) => Math.max(1, page - 1))} disabled={campaignLeadPage === 1 || isLoadingCampaignLeads} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50">Previous</button>
                            <span>Page {campaignLeadPage} of {Math.max(1, Math.ceil(Math.min(campaignLeadTotal, 5000) / 50))}</span>
                            <button type="button" onClick={() => setCampaignLeadPage((page) => page + 1)} disabled={campaignLeadPage * 50 >= Math.min(campaignLeadTotal, 5000) || isLoadingCampaignLeads} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50">Next</button>
                          </div>
                        </div>
                      </div>
                          </div>
                          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
                            <div className="text-xs text-slate-600">
                              <span className="font-semibold text-slate-900">{campaignSelectedLeadIds.length.toLocaleString()} selected</span>
                              <span> · Maximum 5,000 recipients</span>
                            </div>
                            <button type="button" onClick={closeCampaignDialog} disabled={isSelectingCampaignMatches} className="rounded-lg bg-violet-700 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50">Done</button>
                          </footer>
                        </section>
                      </div>
                    )}
                  </fieldset>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="min-w-0">
                      <label htmlFor="campaign-name" className="mb-1 block text-xs font-semibold text-slate-600">Campaign name</label>
                      <input id="campaign-name" value={campaignName} maxLength={160} required onChange={(event) => setCampaignName(event.target.value)} className="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
                    </div>
                    <label htmlFor="campaign-template" className="block text-xs font-semibold text-slate-600">
                      Template
                      <select id="campaign-template" value={campaignTemplate} onChange={(event) => {
                        const template = campaignTemplates[event.target.value as keyof typeof campaignTemplates];
                        setCampaignTemplate(event.target.value as keyof typeof campaignTemplates);
                        setCampaignSubject(template.subject);
                        setCampaignBody(template.body);
                      }} className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100">
                        <option value="blank">Blank campaign</option>
                        <option value="welcome">Welcome</option>
                        <option value="update">Customer update</option>
                        <option value="seasonal">News announcement</option>
                      </select>
                    </label>
                    <label htmlFor="campaign-email-design" className="block text-xs font-semibold text-slate-600">
                      Email design
                      <select id="campaign-email-design" value={campaignEmailDesign} onChange={(event) => setCampaignEmailDesign(event.target.value as MailEmailDesign)} className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100">
                        <option value="plain">Plain email</option>
                        <option value="card">Designed card</option>
                      </select>
                    </label>
                    <div className="min-w-0">
                      <label htmlFor="campaign-subject" className="mb-1 block text-xs font-semibold text-slate-600">Email subject</label>
                      <input id="campaign-subject" value={campaignSubject} maxLength={180} required onChange={(event) => setCampaignSubject(event.target.value)} className="h-9 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
                    </div>
                    <label htmlFor="campaign-schedule" className="block text-xs font-semibold text-slate-600">
                      Schedule for
                      <input id="campaign-schedule" type="datetime-local" value={campaignScheduleAt} onChange={(event) => setCampaignScheduleAt(event.target.value)} className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
                    </label>
                  </div>
                  {campaignAudienceMode === 'all' && <details className="rounded-lg border border-slate-200 px-3 py-2">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-700">Optional Contact Leads filters</summary>
                    <p className="mb-2 mt-1 text-xs text-slate-500">Narrow the eligible contacts by country, lead status, or source. No Campaign contacts and invalid email addresses are always excluded.</p>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="text-xs font-medium text-slate-600">
                        Country
                        <select value={campaignAudienceFilter.country} onChange={(event) => setCampaignAudienceFilter((current) => ({ ...current, country: event.target.value }))} className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800">
                          <option value="">All countries</option>
                          {campaignCountries.map((country) => <option key={country} value={country}>{country}</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-medium text-slate-600">
                        Lead status
                        <select value={campaignAudienceFilter.status} onChange={(event) => setCampaignAudienceFilter((current) => ({ ...current, status: event.target.value }))} className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800">
                          <option value="">All statuses</option>
                          {campaignStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-medium text-slate-600">
                        Lead source
                        <select value={campaignAudienceFilter.source} onChange={(event) => setCampaignAudienceFilter((current) => ({ ...current, source: event.target.value }))} className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800">
                          <option value="">All sources</option>
                          {campaignSources.map((source) => <option key={source} value={source}>{source}</option>)}
                        </select>
                      </label>
                    </div>
                  </details>
                  }
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" checked={campaignTrackOpens} onChange={(event) => setCampaignTrackOpens(event.target.checked)} className="rounded border-slate-300 text-violet-700 focus:ring-violet-500" />
                    Enable approximate open tracking
                  </label>
                  <div>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <label htmlFor="campaign-body" className="block text-xs font-semibold text-slate-600">Message</label>
                      <div className="flex flex-wrap items-center gap-1">
                      <button type="button" onClick={() => setCampaignDialogMode('preview')} disabled={!campaignSubject.trim() && !campaignBody.trim()} className="rounded-md border border-violet-200 px-2 py-1 text-xs font-semibold text-violet-800 disabled:opacity-50">Preview email</button>
                      <button type="button" onClick={() => wrapCampaignSelection('**')} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700">Bold</button>
                      <button type="button" onClick={() => wrapCampaignSelection('*')} className="rounded-md border border-slate-300 px-2 py-1 text-xs italic text-slate-700">Italic</button>
                      <span className="px-1 text-xs text-slate-500">Insert:</span>
                      {campaignMergeTags.map(({ tag, label }) => (
                        <button key={tag} type="button" title={`Insert recipient ${label.toLowerCase()}`} onClick={() => setCampaignBody((current) => `${current}${tag}`)} className="rounded-md bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-800 hover:bg-violet-100">{label}</button>
                      ))}
                      </div>
                    </div>
                    <textarea ref={campaignBodyRef} id="campaign-body" value={campaignBody} maxLength={20000} required onChange={(event) => setCampaignBody(event.target.value)} className="h-[calc(100vh-28rem)] min-h-48 max-h-[60vh] w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm leading-5 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100" />
                  </div>
                  <div className="sticky bottom-0 z-10 -mx-2 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 px-2 py-2 shadow-[0_-8px_16px_-16px_rgba(15,23,42,0.6)] backdrop-blur">
                    <button type="submit" disabled={isCampaignSaving || isLoading} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      {isCampaignSaving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                      {isCampaignSaving ? 'Saving…' : 'Save draft'}
                    </button>
                    <button type="button" onClick={() => void openCampaignReview('schedule')} disabled={!editingCampaignId || !settings.verified || campaignAudienceCount === 0 || campaignAudienceCount > 5000 || isCampaignAction || isLoading || !campaignScheduleAt} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-50 disabled:opacity-50">
                      {isCampaignAction && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />} Review & schedule
                    </button>
                    <button type="button" onClick={() => void openCampaignReview('send')} disabled={!editingCampaignId || !settings.verified || campaignAudienceCount === 0 || campaignAudienceCount > 5000 || isCampaignAction || isLoading} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50">
                      {isCampaignAction && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />} Review & send
                    </button>
                    {role === 'admin' && (
                      <button type="button" onClick={() => void sendCampaignTest()} disabled={!settings.verified || !campaignSubject.trim() || !campaignBody.trim() || isCampaignAction || isLoading} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                        Send test to mailbox
                      </button>
                    )}
                  </div>
                  {!editingCampaignId && <p className="text-[11px] text-slate-500">Save the draft first to enable scheduling or sending.</p>}
                </form>
              </section>

              {role === 'admin' && (
                <details className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-700">Optional setup: automate scheduled and large campaigns</summary>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-600">Set this up once in Hostinger Cron Jobs to run every minute. It processes scheduled campaigns and sends in batches of up to 10. You can skip this for immediate campaigns.</p>
                    <button type="button" onClick={() => void generateCampaignWorkerCommand()} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Generate setup command</button>
                  </div>
                  {campaignWorkerCommand && (
                    <>
                      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-800">{campaignWorkerCommand}</pre>
                      <p className="mt-1 text-[11px] text-slate-500">Keep this command secret. Generating a new one invalidates the previous command.</p>
                    </>
                  )}
                </details>
              )}
            </div>
          )}
          {activeFolder === 'campaign-history' && campaignAccess && (
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
                            campaign.status === 'sent' ? 'bg-blue-50 text-blue-800'
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

      {campaignDialogMode && campaignDialogMode !== 'selection' && mode === 'mailbox' && activeFolder === 'campaigns' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 sm:p-6" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeCampaignDialog();
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="campaign-dialog-title" className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-5">
              <div>
                <h2 id="campaign-dialog-title" className="font-semibold text-slate-950">
                  {campaignDialogMode === 'preview' ? 'Email preview' : 'Review campaign recipients'}
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  {campaignDialogMode === 'preview'
                    ? 'Personalization is shown with sample contact details.'
                    : campaignReviewIntent === 'schedule'
                      ? `${campaignReviewTotal} eligible recipients · Schedule for ${new Date(campaignScheduleAt).toLocaleString()}`
                      : `${campaignReviewTotal} eligible recipients · This send cannot be undone.`}
                </p>
              </div>
              <button type="button" onClick={closeCampaignDialog} disabled={isCampaignAction || isLoadingCampaignReview} aria-label="Close dialog" className="rounded-lg px-2 py-1 text-xl leading-none text-slate-500 hover:bg-slate-100 disabled:opacity-50">×</button>
            </header>
            {showErrorMessage && errorMessage && (
              <p role="alert" className="mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 sm:mx-5">{errorMessage}</p>
            )}
            {campaignDialogMode === 'preview' ? (
              <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100 p-4 sm:p-6">
                {campaignEmailDesign === 'card' ? (
                  <article className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <header className="bg-[#123b68] px-6 py-5 text-white">
                      <p className="text-[11px] font-bold tracking-[0.18em] text-blue-100">AMBIENTA · CUSTOMER SUPPORT</p>
                      <h3 className="mt-2 text-lg font-semibold">{previewCampaignSubject}</h3>
                    </header>
                    <div className="px-6 py-6 text-sm leading-7 text-slate-700" dangerouslySetInnerHTML={{ __html: formatCampaignPreviewHtml(previewCampaignBody) }} />
                    <footer className="border-t border-slate-200 bg-slate-50 px-6 py-3 text-xs text-slate-500">Ambient Customer Support</footer>
                  </article>
                ) : (
                  <article className="mx-auto max-w-xl rounded-lg bg-white p-6 text-sm leading-7 text-slate-700 shadow-sm">
                    <h3 className="mb-4 text-base font-semibold text-slate-950">{previewCampaignSubject || '(no subject)'}</h3>
                    <div>{previewCampaignBody ? <span dangerouslySetInnerHTML={{ __html: formatCampaignPreviewHtml(previewCampaignBody) }} /> : '(No message yet)'}</div>
                  </article>
                )}
              </div>
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5">
                  <p className="mb-3 text-xs text-slate-600">
                    {campaignAudienceMode === 'selected'
                      ? 'These selected contacts are currently eligible. No Campaign status and email eligibility will be checked again when queued.'
                      : 'These are the contacts matching your audience filters. Consent and email eligibility will be checked again when queued.'}
                  </p>
                  {isLoadingCampaignReview ? (
                    <p className="py-8 text-center text-sm text-slate-500">Refreshing eligible recipients…</p>
                  ) : campaignReviewRecipients.length === 0 ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">No currently eligible recipients. Close this review and update your audience selection.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {campaignReviewRecipients.map((recipient) => (
                        <li key={recipient.id} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-800">{recipient.name || 'Unnamed lead'}</span>
                            <span className="block truncate text-xs text-slate-500">{recipient.email}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-600">
                    <span>{campaignReviewTotal.toLocaleString()} recipients total</span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => void loadCampaignReviewPage(campaignReviewPage - 1, campaignReviewIntent)} disabled={campaignReviewPage <= 1 || isLoadingCampaignReview} className="rounded-md border border-slate-300 px-2.5 py-1.5 disabled:opacity-50">Previous</button>
                      <span>Page {campaignReviewPage} of {Math.max(1, Math.ceil(campaignReviewTotal / 50))}</span>
                      <button type="button" onClick={() => void loadCampaignReviewPage(campaignReviewPage + 1, campaignReviewIntent)} disabled={campaignReviewPage * 50 >= campaignReviewTotal || isLoadingCampaignReview} className="rounded-md border border-slate-300 px-2.5 py-1.5 disabled:opacity-50">Next</button>
                    </div>
                  </div>
                </div>
                <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
                  <button type="button" onClick={closeCampaignDialog} disabled={isCampaignAction} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">Back to campaign</button>
                  <button
                    type="button"
                    onClick={() => void (campaignReviewIntent === 'schedule' ? scheduleCampaign() : launchCampaign())}
                    disabled={campaignReviewTotal === 0 || campaignReviewTotal > 5000 || isCampaignAction || isLoadingCampaignReview}
                    className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isCampaignAction && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                    {campaignReviewIntent === 'schedule' ? 'Confirm schedule' : `Confirm send to ${campaignReviewTotal.toLocaleString()}`}
                  </button>
                </footer>
              </>
            )}
            {campaignDialogMode === 'preview' && (
              <footer className="flex justify-end border-t border-slate-200 px-4 py-3 sm:px-5">
                <button type="button" onClick={closeCampaignDialog} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700">Close preview</button>
              </footer>
            )}
          </section>
        </div>
      )}

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
  searchLabel?: string;
  searchPlaceholder?: string;
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
  searchLabel = 'Search Hostinger mailbox messages',
  searchPlaceholder = 'Search this Hostinger folder',
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
        <label htmlFor="mailbox-search" className="sr-only">{searchLabel}</label>
        <input
          id="mailbox-search"
          value={searchInput}
          maxLength={128}
          disabled={disabled}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
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
  showAttachments: boolean;
  onRestore: (message: InboxMessage) => void;
  onDelete: (message: InboxMessage) => void;
  onSetSeen: (message: InboxMessage, seen: boolean) => void;
  onLoadDetails: (message: InboxMessage) => void;
}

const MailTrashFolder: React.FC<MailTrashFolderProps> = ({ messages, folderAvailable, showAttachments, onRestore, onDelete, onSetSeen, onLoadDetails }) => (
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
              {showAttachments && <MessageAttachmentActions message={message} onLoad={() => onLoadDetails(message)} />}
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
