import React, { useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { HostingerMailIntegration } from './HostingerMailIntegration';

interface IntegrationStatusProps {
  role: 'admin' | 'operator';
}

export const IntegrationStatus: React.FC<IntegrationStatusProps> = ({ role }) => {
  const [stripeConfigured, setStripeConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void fetch('/api/data.php?resource=payment-config', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    }).then(async (response) => {
      const result = await response.json() as { stripeConfigured?: boolean };
      if (!response.ok) throw new Error('Stripe payment configuration could not be checked.');
      if (active) setStripeConfigured(result.stripeConfigured === true);
    }).catch(() => {
      if (active) setStripeConfigured(false);
    });
    return () => { active = false; };
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">Connections</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Integrations</h1>
        <p className="mt-2 text-sm text-slate-600">Manage external services connected to the storefront and operations.</p>
      </header>
      <HostingerMailIntegration role={role} mode="settings" />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-slate-100 p-3 text-slate-600"><CreditCard className="h-5 w-5" /></div>
            <div className="min-w-0">
              <h2 className="font-semibold text-slate-900">Stripe card payments</h2>
              <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${stripeConfigured ? 'bg-teal-50 text-teal-800' : 'bg-amber-50 text-amber-800'}`}>
                {stripeConfigured === null ? 'Checking configuration' : stripeConfigured ? 'Ready · manual capture' : 'Setup required'}
              </span>
              <p className="mt-3 text-sm leading-6 text-slate-600">Customers enter their card details on Stripe Checkout. Stripe authorizes the amount; an administrator can capture it from the order after review. The site never receives or stores card numbers or security codes.</p>
              {!stripeConfigured && (
                <p className="mt-2 text-xs leading-5 text-slate-500">Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET as repository deployment secrets, then deploy. Configure Stripe to send checkout.session.completed and checkout.session.expired events to /api/data.php?resource=stripe-webhook.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
