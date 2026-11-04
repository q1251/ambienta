import React, { useEffect } from 'react';

interface StoredSession {
  token: string;
  lastActivity: number;
}

const visitorStorageKey = 'ambienta-visitor-id';
const sessionStorageKey = 'ambienta-visitor-session';
const sessionTimeoutMs = 30 * 60 * 1000;

const createToken = (): string => {
  const bytes = window.crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const getVisitorToken = (): string => {
  const saved = window.localStorage.getItem(visitorStorageKey);
  if (saved && /^[a-f0-9]{64}$/.test(saved)) return saved;
  const token = createToken();
  window.localStorage.setItem(visitorStorageKey, token);
  return token;
};

const getSessionToken = (): string => {
  let saved: StoredSession | null = null;
  try {
    const raw = window.sessionStorage.getItem(sessionStorageKey);
    if (raw) saved = JSON.parse(raw) as StoredSession;
  } catch {
    saved = null;
  }
  if (saved && typeof saved.token === 'string' && /^[a-f0-9]{64}$/.test(saved.token)
    && Number.isFinite(saved.lastActivity) && Date.now() - saved.lastActivity < sessionTimeoutMs) {
    saved.lastActivity = Date.now();
    window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(saved));
    return saved.token;
  }
  const session: StoredSession = { token: createToken(), lastActivity: Date.now() };
  window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(session));
  return session.token;
};

const getReferrerDomain = (): string => {
  if (!document.referrer) return '';
  try {
    const referrer = new URL(document.referrer);
    return referrer.origin === window.location.origin ? '' : referrer.hostname;
  } catch {
    return '';
  }
};

export const VisitorSessionTracker: React.FC = () => {
  useEffect(() => {
    let failureReported = false;
    let lastPath = '';
    let currentProductId = '';
    const visibleProducts = new Map<Element, { id: string; ratio: number }>();
    const observedProducts = new Set<Element>();
    const refreshCurrentProduct = () => {
      const mostVisible = [...visibleProducts.values()].sort((a, b) => b.ratio - a.ratio)[0]?.id || '';
      if (mostVisible !== currentProductId) {
        currentProductId = mostVisible;
        void heartbeat();
      }
    };
    const productObserver = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.productId || '';
        if (entry.isIntersecting && id) {
          visibleProducts.set(entry.target, { id, ratio: entry.intersectionRatio });
        } else {
          visibleProducts.delete(entry.target);
        }
      }
      refreshCurrentProduct();
    }, { threshold: [0.3, 0.6, 0.9] });

    const heartbeat = async () => {
      try {
        const path = window.location.pathname.slice(0, 500) || '/';
        const response = await fetch('/api/data.php?resource=visitor-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            sessionToken: getSessionToken(),
            visitorToken: getVisitorToken(),
            path,
            title: document.title.slice(0, 180),
            productId: currentProductId,
            referrerDomain: getReferrerDomain(),
            language: navigator.language.slice(0, 35),
          }),
          keepalive: true,
        });
        if (!response.ok) {
          const result = await response.json() as { message?: string };
          throw new Error(result.message || `Visitor session update failed (${response.status}).`);
        }
        lastPath = path;
        failureReported = false;
      } catch (error) {
        if (!failureReported) {
          console.error('Ambients visitor session could not be updated.', error);
          failureReported = true;
        }
      }
    };

    const handlePageChange = () => {
      if (window.location.pathname !== lastPath) void heartbeat();
    };
    const observeProducts = () => {
      const currentElements = new Set(document.querySelectorAll('[data-product-id]'));
      for (const element of observedProducts) {
        if (currentElements.has(element)) continue;
        productObserver?.unobserve(element);
        observedProducts.delete(element);
        visibleProducts.delete(element);
      }
      currentElements.forEach((element) => {
        if (observedProducts.has(element)) return;
        observedProducts.add(element);
        productObserver?.observe(element);
      });
      refreshCurrentProduct();
    };
    const handleVisibility = () => {
      if (!document.hidden) void heartbeat();
    };

    observeProducts();
    const mutationObserver = new MutationObserver(observeProducts);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), 30_000);
    window.addEventListener('popstate', handlePageChange);
    window.addEventListener('hashchange', handlePageChange);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(timer);
      mutationObserver.disconnect();
      productObserver?.disconnect();
      window.removeEventListener('popstate', handlePageChange);
      window.removeEventListener('hashchange', handlePageChange);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return null;
};
