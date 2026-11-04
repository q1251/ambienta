import React, { useEffect, useState } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';

interface CheckoutResult {
  orderNumber: string;
  totalAmount: number;
  paymentStatus: 'Authorized' | 'Paid';
}

export const StripeCheckoutResult: React.FC = () => {
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('checkout_result');
    const cancelled = params.get('checkout_cancelled') === '1';
    const orderId = params.get('order_id');
    if (!sessionId && !cancelled) return;

    let active = true;
    setIsOpen(true);
    const request = sessionId
      ? fetch(`/api/data.php?resource=checkout-result&session_id=${encodeURIComponent(sessionId)}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      : fetch('/api/data.php?resource=checkout-cancel', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ orderId }),
      });

    void request.then(async (response) => {
      const payload = await response.json() as CheckoutResult & { message?: string };
      if (!response.ok) throw new Error(payload.message || 'The checkout status could not be confirmed.');
      if (!active) return;
      if (sessionId) setResult(payload);
      else setMessage('Checkout was cancelled. No card payment was captured.');
    }).catch((error: unknown) => {
      if (active) setMessage(error instanceof Error ? error.message : 'The checkout status could not be confirmed.');
    });

    return () => { active = false; };
  }, []);

  const close = () => {
    setIsOpen(false);
    window.history.replaceState({}, '', window.location.pathname);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="stripe-checkout-title">
      <section className="relative w-full max-w-md rounded-2xl bg-white p-7 text-center shadow-2xl">
        <button type="button" onClick={close} aria-label="Close payment status" className="absolute right-4 top-4 rounded-lg p-2 text-slate-500 hover:bg-slate-100">
          <X className="h-4 w-4" />
        </button>
        {result ? (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12 text-teal-700" />
            <h1 id="stripe-checkout-title" className="mt-4 text-xl font-bold text-slate-950">Card authorized</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Order <span className="font-semibold text-slate-900">{result.orderNumber}</span> is confirmed for ${result.totalAmount.toFixed(2)}. The payment is authorized, not captured yet; the pharmacy will review the order and capture it.
            </p>
          </>
        ) : message ? (
          <>
            <XCircle className="mx-auto h-12 w-12 text-amber-600" />
            <h1 id="stripe-checkout-title" className="mt-4 text-xl font-bold text-slate-950">Payment not confirmed</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p>
          </>
        ) : (
          <>
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-teal-700" />
            <h1 id="stripe-checkout-title" className="mt-4 text-xl font-bold text-slate-950">Confirming card authorization…</h1>
            <p className="mt-2 text-sm text-slate-600">Please keep this page open for a moment.</p>
          </>
        )}
        <button type="button" onClick={close} className="mt-6 w-full rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-900">
          Return to store
        </button>
      </section>
    </div>
  );
};
