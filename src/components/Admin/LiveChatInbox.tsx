import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Circle, LoaderCircle, MessageCircle, RefreshCw, RotateCcw, Search, Send, UserRound, X } from 'lucide-react';

type ConversationStatus = 'open' | 'closed';
type ConversationFilter = ConversationStatus | 'all';

interface ChatConversation {
  id: number;
  visitorName: string;
  visitorEmail: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
  lastMessage: string | null;
  lastSender: 'visitor' | 'staff' | null;
  unreadCount: number;
}

interface ChatMessage {
  id: number;
  sender: 'visitor' | 'staff';
  senderName: string;
  body: string;
  createdAt: string;
}

interface ChatConversationDetail {
  id: number;
  visitorName: string;
  visitorEmail: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
}

interface ChatInboxResponse {
  conversations?: ChatConversation[];
  conversation?: ChatConversationDetail;
  messages?: ChatMessage[];
  message?: string;
}

const formatDate = (value: string) => new Date(value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z')).toLocaleString([], {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export const LiveChatInbox: React.FC = () => {
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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const runAction = async (action: 'reply' | 'close' | 'reopen') => {
    if (!selectedId) return;
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
        }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || 'The chat update could not be saved.');
      if (action === 'reply') setReply('');
      setActionMessage(action === 'reply' ? 'Reply sent.' : action === 'close' ? 'Conversation closed.' : 'Conversation reopened.');
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
    <div className="mx-auto flex min-h-[calc(100vh-132px)] max-w-[1500px] flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">Customer support</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Live chat</h1>
          <p className="mt-2 text-sm text-slate-600">Reply to conversations started from the storefront chat widget.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">
          <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" /></span>
          {filter === 'open' ? `${openCount} open` : `${conversations.length} shown`} <span className="text-slate-300">·</span> {unreadCount} unread
        </div>
      </header>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
        Chat is for general support only. Do not request or share health information, prescription details, or payment card data here.
      </div>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</p>}
      {actionMessage && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{actionMessage}</p>}

      <section className="grid min-h-[560px] flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className={`flex min-h-[500px] flex-col border-b border-slate-200 lg:border-b-0 lg:border-r ${selectedId !== null ? 'hidden lg:flex' : 'flex'}`}>
          <div className="space-y-3 border-b border-slate-100 p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <label className="sr-only" htmlFor="chat-search">Search conversations</label>
              <input id="chat-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email" className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-teal-700" />
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
              <button key={conversation.id} type="button" onClick={() => { setSelectedId(conversation.id); setActionMessage(''); }} className={`w-full border-b border-slate-100 px-4 py-4 text-left transition hover:bg-slate-50 ${selectedId === conversation.id ? 'bg-teal-50/70' : ''}`}>
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"><UserRound className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">{conversation.visitorName}</span>
                      <time className="shrink-0 text-[10px] text-slate-400">{formatDate(conversation.updatedAt)}</time>
                    </span>
                    {conversation.visitorEmail && <span className="mt-0.5 block truncate text-[11px] text-slate-500">{conversation.visitorEmail}</span>}
                    <span className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-500">{conversation.lastSender === 'staff' ? 'You: ' : ''}{conversation.lastMessage || 'New conversation'}</span>
                      {conversation.unreadCount > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-teal-700 px-1.5 text-[10px] font-bold text-white">{conversation.unreadCount}</span>}
                    </span>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <div className={`min-w-0 flex-col ${selectedId !== null ? 'flex' : 'hidden lg:flex'}`}>
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
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-800"><UserRound className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-slate-950">{selectedConversation.visitorName}</h2>
                    <p className="truncate text-xs text-slate-500">{selectedConversation.visitorEmail || 'No email provided'} · Started {formatDate(selectedConversation.createdAt)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${selectedConversation.status === 'open' ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                    {selectedConversation.status === 'open' ? <Circle className="h-2 w-2 fill-current" /> : <Check className="h-3 w-3" />}
                    {selectedConversation.status}
                  </span>
                  {selectedConversation.status === 'open' ? (
                    <button type="button" disabled={saving} onClick={() => void runAction('close')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><X className="h-3.5 w-3.5" />Close</button>
                  ) : (
                    <button type="button" disabled={saving} onClick={() => void runAction('reopen')} className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-900 hover:bg-teal-100 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />Reopen</button>
                  )}
                </div>
              </header>
              <div className="flex-1 space-y-4 overflow-y-auto bg-[#f7f9fb] p-4 sm:p-6">
                {messages.map((message) => (
                  <div key={message.id} className={`flex ${message.sender === 'staff' ? 'justify-end' : 'justify-start'}`}>
                    <article className={`max-w-[min(76%,620px)] rounded-2xl px-4 py-3 ${message.sender === 'staff' ? 'rounded-br-md bg-[#123b68] text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-800 shadow-sm'}`}>
                      <p className={`mb-1.5 text-[10px] font-semibold ${message.sender === 'staff' ? 'text-blue-100' : 'text-teal-800'}`}>{message.sender === 'staff' ? message.senderName : selectedConversation.visitorName}</p>
                      <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
                      <time className={`mt-2 block text-right text-[10px] ${message.sender === 'staff' ? 'text-blue-100' : 'text-slate-400'}`}>{formatDate(message.createdAt)}</time>
                    </article>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <footer className="border-t border-slate-200 bg-white p-4 sm:px-6">
                {selectedConversation.status === 'open' ? (
                  <form onSubmit={(event) => { event.preventDefault(); if (reply.trim()) void runAction('reply'); }} className="flex items-end gap-3">
                    <label className="sr-only" htmlFor="crm-chat-reply">Reply to customer</label>
                    <textarea id="crm-chat-reply" required maxLength={2000} rows={2} value={reply} onChange={(event) => setReply(event.target.value)} placeholder={`Reply to ${selectedConversation.visitorName}…`} className="max-h-36 min-h-12 flex-1 resize-y rounded-xl border border-slate-200 px-3.5 py-3 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/10" />
                    <button type="submit" disabled={saving || !reply.trim()} className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#123b68] px-4 text-sm font-semibold text-white hover:bg-[#0b2f52] disabled:cursor-not-allowed disabled:opacity-50">
                      {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}<span className="hidden sm:inline">Send</span>
                    </button>
                  </form>
                ) : (
                  <p className="rounded-xl bg-slate-50 px-4 py-3 text-center text-xs text-slate-600">This chat is closed. Reopen it to send another reply.</p>
                )}
                <p className="mt-2 text-[10px] text-slate-400">Messages are plain text. Avoid including sensitive customer or health information.</p>
              </footer>
            </>
          )}
        </div>
      </section>
    </div>
  );
};
