import React from 'react';
import { CreditCard, ShieldAlert } from 'lucide-react';
import { HostingerMailIntegration } from './HostingerMailIntegration';

interface IntegrationStatusProps {
  role: 'admin' | 'operator';
}

export const IntegrationStatus: React.FC<IntegrationStatusProps> = ({ role }) => (
  <div className="space-y-6">
    <header>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">Connections</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Integrations</h1>
      <p className="mt-2 text-sm text-slate-600">Manage provider connections and verify their server-side credentials.</p>
    </header>
    <HostingerMailIntegration role={role} />
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-slate-100 p-3 text-slate-600"><CreditCard className="h-5 w-5" /></div>
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-900">Payments</h2>
            <span className="mt-2 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">Hosted provider not connected</span>
            <p className="mt-3 text-sm leading-6 text-slate-600">Checkout supports cash on delivery/pickup only. Card, PayPal, and cryptocurrency checkout are disabled. The app does not collect card details or mark an order paid without provider confirmation.</p>
            <p className="mt-2 text-xs text-slate-500">PayPal credentials, webhook verification, product eligibility review, refunds, and end-to-end sandbox testing are still required.</p>
          </div>
        </div>
      </section>
    </div>
    <div className="flex gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-6 text-blue-950">
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
      <p>Never share mailbox passwords in chat or source control. The Hostinger password entered above is encrypted on the server and stored outside the public website. Payment provider secrets must be configured through the protected deployment environment before checkout can be enabled.</p>
    </div>
  </div>
);
