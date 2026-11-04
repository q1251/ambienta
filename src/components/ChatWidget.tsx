import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, Headset, LoaderCircle, MessageCircle, Send, X } from 'lucide-react';

interface ChatSession {
  conversationId: number;
  token: string;
}

interface ChatMessage {
  id: number;
  sender: 'visitor' | 'staff';
  senderName: string;
  body: string;
  createdAt: string;
}

interface ChatResponse {
  conversation?: { id: number; status: 'open' | 'closed' };
  messages?: ChatMessage[];
  token?: string;
  message?: string;
}

const storageKey = 'ambienta-live-chat';

const readStoredSession = (): ChatSession | null => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const session = JSON.parse(raw) as Partial<ChatSession>;
    if (Number.isInteger(session.conversationId) && typeof session.token === 'string' && /^[a-f0-9]{64}$/.test(session.token)) {
      return { conversationId: session.conversationId as number, token: session.token };
    }
  } catch {
    return null;
  }
  return null;
};

export const ChatWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [session, setSession] = useState<ChatSession | null>(readStoredSession);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationStatus, setConversationStatus] = useState<'open' | 'closed'>('open');
  const [visitorName, setVisitorName] = useState('');
  const [visitorEmail, setVisitorEmail] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [firstMessage, setFirstMessage] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const messageEndRef = useRef<HTMLDivElement>(null);

  const forgetSession = () => {
    setSession(null);
    setMessages([]);
    setConversationStatus('open');
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      setError('This browser could not save the chat session. Keep this page open to continue chatting.');
    }
  };

  const loadConversation = useCallback(async (savedSession: ChatSession) => {
    try {
      const response = await fetch('/api/data.php?resource=chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          action: 'read',
          conversation: savedSession.conversationId,
          token: savedSession.token,
          website: '',
        }),
      });
      const result = await response.json() as ChatResponse;
      if (response.status === 404) {
        setSession(null);
        setMessages([]);
        setConversationStatus('open');
        try {
          window.localStorage.removeItem(storageKey);
        } catch {
          setError('The previous chat could not be restored. Start a new conversation.');
        }
        return;
      }
      if (!response.ok || !result.conversation || !Array.isArray(result.messages)) {
        throw new Error(result.message || 'The chat could not be refreshed. Please try again.');
      }
      setMessages(result.messages);
      setConversationStatus(result.conversation.status);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The chat could not be refreshed. Please try again.');
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !session) return;
    void loadConversation(session);
    const timer = window.setInterval(() => void loadConversation(session), 5000);
    return () => window.clearInterval(timer);
  }, [isOpen, session, loadConversation]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isOpen]);

  const startConversation = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/data.php?resource=chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          action: 'start',
          name: visitorName,
          email: visitorEmail,
          phone: visitorPhone,
          message: firstMessage,
          website: '',
        }),
      });
      const result = await response.json() as ChatResponse;
      if (!response.ok || !result.conversation || !result.token || !Array.isArray(result.messages)) {
        throw new Error(result.message || 'Your conversation could not be started. Please try again.');
      }
      const savedSession = { conversationId: result.conversation.id, token: result.token };
      setSession(savedSession);
      setMessages(result.messages);
      setConversationStatus(result.conversation.status);
      setFirstMessage('');
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(savedSession));
      } catch {
        setError('Your chat is open, but this browser cannot save it for later. Keep this page open.');
      }
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Your conversation could not be started. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session || !reply.trim() || conversationStatus !== 'open') return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/data.php?resource=chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          action: 'message',
          conversation: session.conversationId,
          token: session.token,
          message: reply,
          website: '',
        }),
      });
      const result = await response.json() as ChatResponse;
      if (!response.ok || !Array.isArray(result.messages)) {
        throw new Error(result.message || 'Your message could not be sent. Please try again.');
      }
      setMessages(result.messages);
      setReply('');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Your message could not be sent. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-[70] flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {isOpen && (
        <section aria-label="Ambients live chat" className="flex h-[min(620px,calc(100dvh-110px))] w-[min(390px,calc(100vw-32px))] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_80px_-22px_rgba(15,35,55,0.42)]">
          <header className="flex items-center justify-between bg-[#123b68] px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15"><Headset className="h-5 w-5" /></span>
              <div>
                <p className="text-sm font-semibold">Ambients support</p>
                <p className="mt-0.5 text-xs text-blue-100">We’re here to help with your order</p>
              </div>
            </div>
            <button type="button" onClick={() => setIsOpen(false)} aria-label="Close chat" className="rounded-full p-2 text-blue-100 hover:bg-white/10 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </header>

          {!session ? (
            <form onSubmit={(event) => void startConversation(event)} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Start a conversation</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">Leave a message and our team will reply here. Email and phone are optional.</p>
              </div>
              <label className="grid gap-1.5 text-xs font-medium text-slate-700">
                Your name
                <input required maxLength={100} value={visitorName} onChange={(event) => setVisitorName(event.target.value)} autoComplete="name" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/10" />
              </label>
              <label className="grid gap-1.5 text-xs font-medium text-slate-700">
                Email <span className="font-normal text-slate-400">(optional)</span>
                <input type="email" maxLength={254} value={visitorEmail} onChange={(event) => setVisitorEmail(event.target.value)} autoComplete="email" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/10" />
              </label>
              <label className="grid gap-1.5 text-xs font-medium text-slate-700">
                Phone <span className="font-normal text-slate-400">(optional)</span>
                <input type="tel" maxLength={40} value={visitorPhone} onChange={(event) => setVisitorPhone(event.target.value)} autoComplete="tel" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/10" />
              </label>
              <label className="grid gap-1.5 text-xs font-medium text-slate-700">
                Message
                <textarea required maxLength={2000} rows={4} value={firstMessage} onChange={(event) => setFirstMessage(event.target.value)} placeholder="How can we help?" className="resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/10" />
              </label>
              <p className="text-[11px] leading-4 text-amber-800">Please don’t share medical details, prescriptions, or payment information in chat.</p>
              {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
              <button type="submit" disabled={busy} className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[#123b68] px-4 py-3 text-sm font-semibold text-white hover:bg-[#0b2f52] disabled:cursor-not-allowed disabled:opacity-60">
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send message
              </button>
            </form>
          ) : (
            <>
              <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/80 p-4">
                <div className="mx-auto max-w-[280px] rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-center text-[11px] leading-4 text-amber-900">Please don’t send medical details, prescription information, or payment details here.</div>
                {messages.map((message) => (
                  <div key={message.id} className={`flex ${message.sender === 'visitor' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[84%] rounded-2xl px-3.5 py-2.5 ${message.sender === 'visitor' ? 'rounded-br-md bg-[#123b68] text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-800 shadow-sm'}`}>
                      <p className={`mb-1 text-[10px] font-semibold ${message.sender === 'visitor' ? 'text-blue-100' : 'text-teal-800'}`}>{message.sender === 'visitor' ? 'You' : message.senderName}</p>
                      <p className="whitespace-pre-wrap break-words text-sm leading-5">{message.body}</p>
                      <time className={`mt-1 block text-right text-[10px] ${message.sender === 'visitor' ? 'text-blue-100' : 'text-slate-400'}`}>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
                    </div>
                  </div>
                ))}
                {messages.length === 0 && <p className="py-8 text-center text-xs text-slate-500">Your conversation is ready. Send us a message.</p>}
                <div ref={messageEndRef} />
              </div>
              {error && <p role="alert" className="mx-4 mt-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{error}</p>}
              {conversationStatus === 'closed' ? (
                <div className="border-t border-slate-200 bg-white p-4 text-center">
                  <p className="text-sm font-medium text-slate-700">This conversation has been closed.</p>
                  <button type="button" onClick={forgetSession} className="mt-2 text-xs font-semibold text-teal-800 hover:underline">Start a new chat</button>
                </div>
              ) : (
                <form onSubmit={(event) => void sendReply(event)} className="flex items-end gap-2 border-t border-slate-200 bg-white p-3">
                  <label className="sr-only" htmlFor="public-chat-reply">Your message</label>
                  <textarea id="public-chat-reply" required maxLength={2000} rows={2} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a message…" className="max-h-28 min-h-11 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-teal-700" />
                  <button type="submit" aria-label="Send message" disabled={busy || !reply.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#123b68] text-white hover:bg-[#0b2f52] disabled:opacity-50">
                    {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      )}

      <button type="button" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen} aria-label={isOpen ? 'Close support chat' : 'Open support chat'} className="group flex h-14 items-center gap-2 rounded-full bg-[#123b68] px-5 text-white shadow-[0_10px_30px_-8px_rgba(18,59,104,0.65)] transition hover:-translate-y-0.5 hover:bg-[#0b2f52]">
        {isOpen ? <ArrowDown className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
        <span className="text-sm font-semibold">{isOpen ? 'Minimize' : 'Chat with us'}</span>
      </button>
    </div>
  );
};
