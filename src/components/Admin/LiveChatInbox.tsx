import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Circle, Clock3, Eye, Globe2, LoaderCircle, MapPin, MessageCircle, RefreshCw, RotateCcw, Search, Send, UserRound, Users, X } from 'lucide-react';

type ConversationStatus = 'open' | 'closed';
type ConversationFilter = ConversationStatus | 'all';
type ConversationOwnerType = 'queue' | 'admin' | 'agent';

interface ChatConversation {
  id: number;
  visitorName: string;
  visitorEmail: string;
  visitorPhone: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
  lastMessage: string | null;
  lastSender: 'visitor' | 'staff' | 'system' | null;
  unreadCount: number;
  ownerType: ConversationOwnerType;
  ownerStaffId: number | null;
  ownerName: string;
  canClaim: boolean;
}

interface ChatMessage {
  id: number;
  sender: 'visitor' | 'staff' | 'system';
  senderName: string;
  body: string;
  createdAt: string;
}

interface ChatConversationDetail {
  id: number;
  visitorName: string;
  visitorEmail: string;
  visitorPhone: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
  ownerType: ConversationOwnerType;
  ownerStaffId: number | null;
  ownerName: string;
  canClaim: boolean;
}

interface ChatInboxResponse {
  conversations?: ChatConversation[];
  conversation?: ChatConversationDetail;
  messages?: ChatMessage[];
  adminOnline?: boolean;
  agentsMayClaimWhenAdminOnline?: boolean;
  assignableAgents?: Array<{ id: number; displayName: string }>;
  message?: string;
}

type LiveChatView = 'inbox' | 'visitors';
type VisitorFilter = 'active' | 'recent';

interface VisitorSession {
  id: string;
  visitorId: string;
  currentPath: string;
  referrerDomain: string;
  countryCode: string | null;
  language: string;
  firstSeen: string;
  lastSeen: string;
  active: boolean;
  pageCount: number;
  durationSeconds: number;
  currentTitle: string;
  currentProduct: string | null;
  chatId: number | null;
  chatStatus: ConversationStatus | null;
  chatOwner: string | null;
  chatEngaged: boolean;
}

interface VisitorPageView {
  path: string;
  title: string;
  productId: string | null;
  productName: string | null;
  dwellSeconds: number;
  viewedAt: string;
}

interface VisitorSessionResponse {
  sessions?: VisitorSession[];
  session?: Omit<VisitorSession, 'pageCount'>;
  pages?: VisitorPageView[];
  summary?: {
    activeSessions: number;
    activeVisitors: number;
    recentSessions: number;
    recentVisitors: number;
  };
  message?: string;
}

const countryName = (countryCode: string | null) => {
  if (!countryCode) return 'Unavailable';
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(countryCode) || countryCode;
  } catch {
    return countryCode;
  }
};

const formatDate = (value?: string | null) => {
  if (!value) return 'Recent';
  try {
    const raw = String(value);
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const date = new Date(normalized + (normalized.endsWith('Z') || normalized.includes('+') ? '' : 'Z'));
    if (isNaN(date.getTime())) {
      const fallback = new Date(raw);
      if (!isNaN(fallback.getTime())) {
        return fallback.toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
      }
      return raw;
    }
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return value || 'Recent';
  }
};

interface LiveChatInboxProps {
  role: 'admin' | 'operator';
}

const formatDuration = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};

export const LiveChatInbox: React.FC<LiveChatInboxProps> = ({ role }) => {
  const [filter, setFilter] = useState<ConversationFilter>('open');
  const [search, setSearch] = useState('');
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<ChatConversationDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [view, setView] = useState<LiveChatView>('inbox');
  const [visitorFilter, setVisitorFilter] = useState<VisitorFilter>('active');
  const [visitorSessions, setVisitorSessions] = useState<VisitorSession[]>([]);
  const [visitorSummary, setVisitorSummary] = useState<VisitorSessionResponse['summary']>();
  const [selectedVisitorSessionId, setSelectedVisitorSessionId] = useState<string | null>(null);
  const [selectedVisitorSession, setSelectedVisitorSession] = useState<VisitorSessionResponse['session']>();
  const [visitorPages, setVisitorPages] = useState<VisitorPageView[]>([]);
  const [visitorLoading, setVisitorLoading] = useState(false);
  const [adminOnline, setAdminOnline] = useState(false);
  const [assignableAgents, setAssignableAgents] = useState<ChatInboxResponse['assignableAgents']>([]);
  const [assignAgentId, setAssignAgentId] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      const parameters = new URLSearchParams({ resource: 'chat-admin', status: filter });
      if (search.trim()) parameters.set('q', search.trim());
      const response = await fetch(`/api/data.php?${parameters.toString()}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const result = await response.json() as ChatInboxResponse;
      if (!response.ok || !Array.isArray(result.conversations)) {
        throw new Error(result.message || 'The chat inbox could not be loaded.');
      }
      setConversations(result.conversations);
      setAdminOnline(result.adminOnline === true);
      setAssignableAgents(result.assignableAgents || []);
      setError('');
      setLoadingList(false);
      setSelectedId((current) => {
        if (current !== null && result.conversations?.some((conversation) => conversation.id === current)) return current;
        return result.conversations?.[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The chat inbox could not be loaded.');
      setLoadingList(false);
    }
  }, [filter, search]);

  useEffect(() => {
    setLoadingList(true);
    void loadConversations();
    const timer = window.setInterval(() => void loadConversations(), 8000);
    return () => window.clearInterval(timer);
  }, [loadConversations]);

  const loadSelectedConversation = useCallback(async (conversationId: number) => {
    try {
      const parameters = new URLSearchParams({ resource: 'chat-admin', conversation: String(conversationId) });
      const response = await fetch(`/api/data.php?${parameters.toString()}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const result = await response.json() as ChatInboxResponse;
      if (!response.ok || !result.conversation || !Array.isArray(result.messages)) {
        throw new Error(result.message || 'This conversation could not be loaded.');
      }
      setSelectedConversation(result.conversation);
      setMessages(result.messages);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'This conversation could not be loaded.');
    }
  }, []);

  const loadVisitorSessions = useCallback(async () => {
    try {
      const parameters = new URLSearchParams({ resource: 'visitor-sessions', status: visitorFilter });
      const response = await fetch(`/api/data.php?${parameters.toString()}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const result = await response.json() as VisitorSessionResponse;
      if (!response.ok || !Array.isArray(result.sessions) || !result.summary) {
        throw new Error(result.message || 'Visitor sessions could not be loaded.');
      }
      setVisitorSessions(result.sessions);
      setVisitorSummary(result.summary);
      setSelectedVisitorSessionId((current) => {
        if (current && result.sessions?.some((session) => session.id === current)) return current;
        return result.sessions?.[0]?.id ?? null;
      });
      setError('');
      setVisitorLoading(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Visitor sessions could not be loaded.');
      setVisitorLoading(false);
    }
  }, [visitorFilter]);

  const loadVisitorSessionDetails = useCallback(async (sessionId: string) => {
    try {
      const parameters = new URLSearchParams({ resource: 'visitor-sessions', session: sessionId });
      const response = await fetch(`/api/data.php?${parameters.toString()}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const result = await response.json() as VisitorSessionResponse;
      if (!response.ok || !result.session || !Array.isArray(result.pages)) {
        throw new Error(result.message || 'The visitor session details could not be loaded.');
      }
      setSelectedVisitorSession(result.session);
      setVisitorPages(result.pages);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The visitor session details could not be loaded.');
    }
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setSelectedConversation(null);
      setMessages([]);
      return;
    }
    void loadSelectedConversation(selectedId);
    const timer = window.setInterval(() => void loadSelectedConversation(selectedId), 5000);
    return () => window.clearInterval(timer);
  }, [selectedId, loadSelectedConversation]);

  useEffect(() => {
    setAssignAgentId('');
  }, [selectedId]);

  useEffect(() => {
    if (view !== 'visitors') return;
    setVisitorLoading(true);
    void loadVisitorSessions();
    const timer = window.setInterval(() => void loadVisitorSessions(), 10_000);
    return () => window.clearInterval(timer);
  }, [view, loadVisitorSessions]);

  useEffect(() => {
    if (view !== 'visitors' || selectedVisitorSessionId === null) {
      setSelectedVisitorSession(undefined);
      setVisitorPages([]);
      return;
    }
    void loadVisitorSessionDetails(selectedVisitorSessionId);
    const timer = window.setInterval(() => void loadVisitorSessionDetails(selectedVisitorSessionId), 10_000);
    return () => window.clearInterval(timer);
  }, [view, selectedVisitorSessionId, loadVisitorSessionDetails]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const runAction = async (action: 'reply' | 'close' | 'reopen' | 'claim' | 'takeover' | 'assign') => {
    if (!selectedId) return;
    if (action === 'assign' && !assignAgentId) {
      setError('Choose an active agent with Live chat permission before assigning this conversation.');
      return;
    }
    setSaving(true);
    setError('');
    setActionMessage('');
    try {
      const response = await fetch('/api/data.php?resource=chat-admin', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          action,
          conversation: selectedId,
          ...(action === 'reply' ? { message: reply } : {}),
          ...(action === 'assign' ? { staffId: Number(assignAgentId) } : {}),
        }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || 'The chat update could not be saved.');
      if (action === 'reply') setReply('');
      setActionMessage(
        action === 'reply' ? 'Reply sent.'
          : action === 'close' ? 'Conversation closed.'
            : action === 'reopen' ? 'Conversation reopened.'
              : action === 'claim' ? 'You now own this conversation.'
                : action === 'takeover' ? 'You took over the conversation. The handoff is visible in the chat.'
                  : 'Conversation assigned. The handoff is visible in the chat.'
      );
      await Promise.all([loadConversations(), loadSelectedConversation(selectedId)]);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The chat update could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const openCount = conversations.filter((conversation) => conversation.status === 'open').length;
  const unreadCount = conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-800">Customer support</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Live chat</h1>
          <p className="mt-2 text-sm text-slate-600">{role === 'admin' ? 'Monitor incoming chats, assign an agent, or take ownership with a visible handoff.' : 'Claim available chats or continue conversations assigned to you.'}</p>
        </div>
        {view === 'inbox' ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">
            <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" /></span>
            {filter === 'open' ? `${openCount} open` : `${conversations.length} shown`} <span className="text-slate-300">·</span> {unreadCount} unread
            {role === 'admin' && <><span className="text-slate-300">·</span><span>{adminOnline ? 'You are online' : 'You are offline'}</span></>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">
            <span><strong className="text-slate-900">{visitorSummary?.activeVisitors ?? '—'}</strong> live visitors</span>
            <span><strong className="text-slate-900">{visitorSummary?.activeSessions ?? '—'}</strong> active sessions</span>
            <span><strong className="text-slate-900">{visitorSummary?.recentVisitors ?? '—'}</strong> visitors · 24h</span>
          </div>
        )}
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</p>}
      {actionMessage && <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{actionMessage}</p>}

      <nav aria-label="Live chat workspace" className="flex w-fit items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
        <button type="button" onClick={() => setView('inbox')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${view === 'inbox' ? 'bg-[#123b68] text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          <MessageCircle className="h-4 w-4" />Inbox
        </button>
        <button type="button" onClick={() => setView('visitors')} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${view === 'visitors' ? 'bg-[#123b68] text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
          <Users className="h-4 w-4" />Visitors
        </button>
      </nav>

      {view === 'inbox' ? (
      <section className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className={`min-h-0 flex-col border-b border-slate-200 lg:flex lg:border-b-0 lg:border-r ${selectedId !== null ? 'hidden' : 'flex'}`}>
          <div className="space-y-3 border-b border-slate-100 p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <label className="sr-only" htmlFor="chat-search">Search conversations</label>
              <input id="chat-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email" className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-700" />
            </div>
            <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
              {(['open', 'closed', 'all'] as const).map((value) => (
                <button key={value} type="button" onClick={() => setFilter(value)} className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold capitalize ${filter === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{value}</button>
              ))}
              <button type="button" onClick={() => void loadConversations()} aria-label="Refresh conversations" className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-slate-900"><RefreshCw className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingList && conversations.length === 0 ? (
              <div role="status" className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />Loading chats…</div>
            ) : conversations.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <MessageCircle className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm font-medium text-slate-700">No conversations here</p>
                <p className="mt-1 text-xs text-slate-500">New storefront messages will appear in this inbox.</p>
              </div>
            ) : conversations.map((conversation) => (
              <button key={conversation.id} type="button" onClick={() => { setSelectedId(conversation.id); setActionMessage(''); }} className={`w-full border-b border-slate-100 px-4 py-4 text-left transition hover:bg-slate-50 ${selectedId === conversation.id ? 'bg-blue-50/70' : ''}`}>
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"><UserRound className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">{conversation.visitorName}</span>
                      <time className="shrink-0 text-[10px] text-slate-400">{formatDate(conversation.updatedAt)}</time>
                    </span>
                    {conversation.visitorEmail && <span className="mt-0.5 block truncate text-[11px] text-slate-500">{conversation.visitorEmail}</span>}
                    {conversation.visitorPhone && <span className="mt-0.5 block truncate text-[11px] text-slate-500">{conversation.visitorPhone}</span>}
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${conversation.ownerType === 'queue' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                      {conversation.ownerType === 'queue' ? 'Shared queue' : `Handled by ${conversation.ownerName}`}
                    </span>
                    <span className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500">{conversation.lastSender === 'staff' ? 'You: ' : ''}{conversation.lastMessage || 'New conversation'}</span>
                      {conversation.unreadCount > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-blue-700 px-1.5 text-[10px] font-bold text-white">{conversation.unreadCount}</span>}
                    </span>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <div className={`min-h-0 min-w-0 flex-col ${selectedId !== null ? 'flex' : 'hidden lg:flex'}`}>
          {selectedId === null || !selectedConversation ? (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><MessageCircle className="h-7 w-7" /></span>
              <p className="mt-4 text-sm font-semibold text-slate-800">Select a conversation</p>
              <p className="mt-1 text-xs text-slate-500">Choose a chat from the list to read and reply.</p>
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <button type="button" onClick={() => setSelectedId(null)} aria-label="Back to conversations" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"><X className="h-4 w-4" /></button>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-800"><UserRound className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-slate-950">{selectedConversation.visitorName}</h2>
                    <p className="truncate text-xs text-slate-500">
                      {[selectedConversation.visitorEmail || 'No email provided', selectedConversation.visitorPhone || 'No phone provided'].join(' · ')} · Started {formatDate(selectedConversation.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="max-w-40 truncate text-[11px] font-medium text-slate-500">{selectedConversation.ownerType === 'queue' ? 'Unassigned · shared queue' : `Handled by ${selectedConversation.ownerName}`}</span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${selectedConversation.status === 'open' ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>
                    {selectedConversation.status === 'open' ? <Circle className="h-2 w-2 fill-current" /> : <Check className="h-3 w-3" />}
                    {selectedConversation.status}
                  </span>
                  {role === 'operator' && selectedConversation.canClaim && (
                    <button type="button" disabled={saving} onClick={() => void runAction('claim')} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-800 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-900 disabled:opacity-50">Claim chat</button>
                  )}
                  {role === 'admin' && selectedConversation.ownerType !== 'admin' && (
                    <button type="button" disabled={saving} onClick={() => void runAction('takeover')} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50">Take over</button>
                  )}
                  {role === 'admin' && assignableAgents && assignableAgents.length > 0 && (
                    <div className="flex items-center gap-1">
                      <label className="sr-only" htmlFor="chat-assign-agent">Assign chat to agent</label>
                      <select id="chat-assign-agent" value={assignAgentId} onChange={(event) => setAssignAgentId(event.target.value)} className="max-w-36 rounded-lg border border-slate-200 px-2 py-2 text-xs">
                        <option value="">Assign to…</option>
                        {assignableAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.displayName}</option>)}
                      </select>
                      <button type="button" disabled={saving || !assignAgentId} onClick={() => void runAction('assign')} className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Assign</button>
                    </div>
                  )}
                  {(role === 'admin' || selectedConversation.ownerType === 'agent') && (selectedConversation.status === 'open' ? (
                    <button type="button" disabled={saving} onClick={() => void runAction('close')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><X className="h-3.5 w-3.5" />Close</button>
                  ) : (
                    <button type="button" disabled={saving} onClick={() => void runAction('reopen')} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-900 hover:bg-blue-100 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />Reopen</button>
                  ))}
                </div>
              </header>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[#f7f9fb] p-4 sm:p-6">
                {messages.map((message) => (
                  message.sender === 'system' ? (
                    <p key={message.id} className="mx-auto w-fit max-w-full rounded-full bg-slate-200/70 px-4 py-1.5 text-center text-xs text-slate-600">{message.body} · {formatDate(message.createdAt)}</p>
                  ) : (
                    <div key={message.id} className={`flex ${message.sender === 'staff' ? 'justify-end' : 'justify-start'}`}>
                      <article className={`max-w-[min(76%,620px)] rounded-2xl px-4 py-3 ${message.sender === 'staff' ? 'rounded-br-md bg-[#123b68] text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-800 shadow-sm'}`}>
                        <p className={`mb-1.5 text-[10px] font-semibold ${message.sender === 'staff' ? 'text-blue-100' : 'text-blue-800'}`}>{message.sender === 'staff' ? message.senderName : selectedConversation.visitorName}</p>
                        <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
                        <time className={`mt-2 block text-right text-[10px] ${message.sender === 'staff' ? 'text-blue-100' : 'text-slate-400'}`}>{formatDate(message.createdAt)}</time>
                      </article>
                    </div>
                  )
                ))}
                <div ref={messagesEndRef} />
              </div>
              <footer className="border-t border-slate-200 bg-white p-4 sm:px-6">
                {selectedConversation.status === 'open' && (role === 'admin' || selectedConversation.ownerType === 'agent') ? (
                  <form onSubmit={(event) => { event.preventDefault(); if (reply.trim()) void runAction('reply'); }} className="flex items-end gap-3">
                    <label className="sr-only" htmlFor="crm-chat-reply">Reply to customer</label>
                    <textarea id="crm-chat-reply" required maxLength={2000} rows={2} value={reply} onChange={(event) => setReply(event.target.value)} placeholder={`Reply to ${selectedConversation.visitorName}…`} className="max-h-36 min-h-12 flex-1 resize-y rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-700/10" />
                    <button type="submit" disabled={saving || !reply.trim()} className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#123b68] px-4 text-sm font-semibold text-white hover:bg-[#0b2f52] disabled:cursor-not-allowed disabled:opacity-50">
                      {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}<span className="hidden sm:inline">Send</span>
                    </button>
                  </form>
                ) : selectedConversation.status === 'open' ? (
                  <p className="rounded-xl bg-amber-50 px-4 py-3 text-center text-xs text-amber-900">This conversation is in the shared queue. Claim it before replying.</p>
                ) : (
                  <p className="rounded-xl bg-slate-50 px-4 py-3 text-center text-xs text-slate-600">This chat is closed. Reopen it to send another reply.</p>
                )}
                <p className="mt-2 text-[10px] text-slate-400">Messages are plain text. Avoid including sensitive customer or health information.</p>
              </footer>
            </>
          )}
        </div>
      </section>
      ) : (
        <section className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className={`min-h-0 flex-col border-b border-slate-200 lg:flex lg:border-b-0 lg:border-r ${selectedVisitorSessionId ? 'hidden' : 'flex'}`}>
            <div className="flex items-center gap-1 border-b border-slate-100 p-4">
              {(['active', 'recent'] as const).map((value) => (
                <button key={value} type="button" onClick={() => setVisitorFilter(value)} className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold ${visitorFilter === value ? 'bg-blue-50 text-blue-900' : 'text-slate-500 hover:bg-slate-50'}`}>
                  {value === 'active' ? 'Active now' : 'Last 24 hours'}
                </button>
              ))}
              <button type="button" onClick={() => void loadVisitorSessions()} aria-label="Refresh visitor sessions" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><RefreshCw className="h-3.5 w-3.5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {visitorLoading && visitorSessions.length === 0 ? (
                <div role="status" className="flex items-center justify-center gap-2 p-8 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />Loading visitors…</div>
              ) : visitorSessions.length === 0 ? (
                <div className="px-6 py-12 text-center">
                  <Users className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-3 text-sm font-medium text-slate-700">No visitors in this period</p>
                  <p className="mt-1 text-xs text-slate-500">Visitors appear after their storefront page reports a session.</p>
                </div>
              ) : visitorSessions.map((session) => (
                <button key={session.id} type="button" onClick={() => setSelectedVisitorSessionId(session.id)} className={`w-full border-b border-slate-100 px-4 py-4 text-left transition hover:bg-slate-50 ${selectedVisitorSessionId === session.id ? 'bg-blue-50/70' : ''}`}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${session.active ? 'bg-blue-500' : 'bg-slate-300'}`} />
                      <span className="truncate text-sm font-semibold text-slate-900">Visitor {session.visitorId}</span>
                    </span>
                    <time className="shrink-0 text-[10px] text-slate-400">{formatDate(session.lastSeen)}</time>
                  </span>
                  <span className="mt-2 flex items-center gap-1.5 truncate pl-4 text-xs text-slate-700"><Eye className="h-3.5 w-3.5 shrink-0 text-slate-400" />{session.currentTitle}</span>
                  {session.currentProduct && <span className="mt-1 block truncate pl-9 text-[11px] text-blue-800">Viewing {session.currentProduct}</span>}
                  <span className="mt-1 flex items-center justify-between pl-4 text-[11px] text-slate-500">
                    <span>{formatDuration(session.durationSeconds)} on site · {session.pageCount} pages</span>
                    {session.chatId && <span className={session.chatEngaged ? 'text-blue-700' : 'text-amber-700'}>{session.chatEngaged ? `Chat · ${session.chatOwner}` : 'Waiting for staff'}</span>}
                  </span>
                  <span className="mt-1 flex items-center gap-1.5 truncate pl-4 text-[11px] text-slate-500"><Globe2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />{countryName(session.countryCode)}{session.referrerDomain ? ` · from ${session.referrerDomain}` : ''}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className={`min-h-0 min-w-0 flex-col ${selectedVisitorSessionId ? 'flex' : 'hidden lg:flex'}`}>
            {!selectedVisitorSessionId ? (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Users className="h-7 w-7" /></span>
                <p className="mt-4 text-sm font-semibold text-slate-800">Select a visitor session</p>
                <p className="mt-1 text-xs text-slate-500">See pages visited, referral domain, and available location.</p>
              </div>
            ) : !selectedVisitorSession ? (
              <div role="status" className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />Loading session details…</div>
            ) : (
              <>
                <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-4 py-5 sm:px-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <button type="button" onClick={() => setSelectedVisitorSessionId(null)} aria-label="Back to visitor sessions" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"><X className="h-4 w-4" /></button>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-800"><UserRound className="h-5 w-5" /></span>
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-slate-950">Visitor {selectedVisitorSession.visitorId}</h2>
                      <p className="mt-0.5 text-xs text-slate-500">Session started {formatDate(selectedVisitorSession.firstSeen)}</p>
                    </div>
                  </div>
                  {role === 'admin' && selectedVisitorSession.chatId && (
                    <button
                      type="button"
                      onClick={() => {
                        setFilter('all');
                        setSelectedId(selectedVisitorSession.chatId);
                        setView('inbox');
                      }}
                      className="rounded-lg bg-[#123b68] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0b2f52]"
                    >
                      Open customer chat
                    </button>
                  )}
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${selectedVisitorSession.active ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>
                    <Circle className="h-2 w-2 fill-current" />{selectedVisitorSession.active ? 'Active now' : 'Inactive'}
                  </span>
                </header>
                <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 sm:p-6">
                  <div className="rounded-xl bg-slate-50 p-3.5">
                    <p className="flex items-center gap-2 text-[11px] font-medium text-slate-500"><MapPin className="h-3.5 w-3.5" />Approximate country</p>
                    <p className="mt-1.5 text-sm font-semibold text-slate-900">{countryName(selectedVisitorSession.countryCode)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3.5">
                    <p className="flex items-center gap-2 text-[11px] font-medium text-slate-500"><Globe2 className="h-3.5 w-3.5" />Referral domain</p>
                    <p className="mt-1.5 truncate text-sm font-semibold text-slate-900">{selectedVisitorSession.referrerDomain || 'Direct / unavailable'}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3.5">
                    <p className="flex items-center gap-2 text-[11px] font-medium text-slate-500"><Eye className="h-3.5 w-3.5" />Current page</p>
                    <p className="mt-1.5 break-words text-sm font-semibold text-slate-900">{selectedVisitorSession.currentTitle}</p>
                    <p className="mt-1 break-all text-xs text-slate-500">{selectedVisitorSession.currentPath}</p>
                    {selectedVisitorSession.currentProduct && <p className="mt-1 text-xs font-medium text-blue-800">Product: {selectedVisitorSession.currentProduct}</p>}
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3.5">
                    <p className="flex items-center gap-2 text-[11px] font-medium text-slate-500"><Clock3 className="h-3.5 w-3.5" />Session duration · language</p>
                    <p className="mt-1.5 text-sm font-semibold text-slate-900">{formatDuration(selectedVisitorSession.durationSeconds)} · {selectedVisitorSession.language || 'Unknown'}</p>
                    <p className="mt-1 text-xs text-slate-500">Last seen {formatDate(selectedVisitorSession.lastSeen)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3.5">
                    <p className="flex items-center gap-2 text-[11px] font-medium text-slate-500"><MessageCircle className="h-3.5 w-3.5" />Chat engagement</p>
                    <p className="mt-1.5 text-sm font-semibold text-slate-900">{selectedVisitorSession.chatId ? (selectedVisitorSession.chatEngaged ? `Engaged · ${selectedVisitorSession.chatOwner}` : 'Chat waiting for staff') : 'No chat started'}</p>
                    {selectedVisitorSession.chatStatus && <p className="mt-1 text-xs capitalize text-slate-500">{selectedVisitorSession.chatStatus} conversation</p>}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">Pages & products viewed</h3>
                    <span className="text-xs text-slate-500">{visitorPages.length} recent page views</span>
                  </div>
                  {visitorPages.length ? (
                    <ol className="space-y-0">
                      {visitorPages.map((page, index) => (
                        <li key={`${page.path}-${page.viewedAt}-${index}`} className="relative flex gap-3 pb-5 last:pb-0">
                          {index < visitorPages.length - 1 && <span className="absolute bottom-0 left-[7px] top-4 w-px bg-slate-200" />}
                          <span className="relative mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-blue-600 bg-white" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-slate-800">{page.title || page.path}</span>
                            <span className="mt-0.5 block break-all text-xs text-slate-500">{page.path}</span>
                            {page.productName && <span className="mt-1 block text-xs font-medium text-blue-800">Product: {page.productName}</span>}
                            <time className="mt-1 block text-[11px] text-slate-400">{formatDate(page.viewedAt)} · {formatDuration(page.dwellSeconds)}</time>
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="text-sm text-slate-500">No page history is available for this session.</p>}
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
};
