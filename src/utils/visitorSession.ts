interface StoredSession {
  token: string;
  lastActivity: number;
}

const visitorStorageKey = 'ambienta-visitor-id';
const sessionStorageKey = 'ambienta-visitor-session';
const sessionTimeoutMs = 30 * 60 * 1000;

let memoryVisitorToken = '';
let memorySession: StoredSession | null = null;

const createToken = (): string => {
  const bytes = window.crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const getVisitorToken = (): string => {
  try {
    const saved = window.localStorage.getItem(visitorStorageKey);
    if (saved && /^[a-f0-9]{64}$/.test(saved)) {
      memoryVisitorToken = saved;
      return saved;
    }
  } catch {
    // Keep an in-memory visitor identity when persistent storage is unavailable.
  }

  if (!memoryVisitorToken || !/^[a-f0-9]{64}$/.test(memoryVisitorToken)) {
    memoryVisitorToken = createToken();
  }
  try {
    window.localStorage.setItem(visitorStorageKey, memoryVisitorToken);
  } catch {
    // The visitor session remains trackable for this page lifetime.
  }
  return memoryVisitorToken;
};

export const getVisitorSessionToken = (): string => {
  let saved = memorySession;
  try {
    const raw = window.sessionStorage.getItem(sessionStorageKey);
    if (raw) saved = JSON.parse(raw) as StoredSession;
  } catch {
    // Fall back to the in-memory session when storage is unavailable or malformed.
  }

  if (saved && typeof saved.token === 'string' && /^[a-f0-9]{64}$/.test(saved.token)
    && Number.isFinite(saved.lastActivity) && Date.now() - saved.lastActivity < sessionTimeoutMs) {
    saved.lastActivity = Date.now();
    memorySession = saved;
    try {
      window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(saved));
    } catch {
      // The visitor session remains trackable for this page lifetime.
    }
    return saved.token;
  }

  const session: StoredSession = { token: createToken(), lastActivity: Date.now() };
  memorySession = session;
  try {
    window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(session));
  } catch {
    // The visitor session remains trackable for this page lifetime.
  }
  return session.token;
};
