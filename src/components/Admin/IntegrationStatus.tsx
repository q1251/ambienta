import React from 'react';
import { CreditCard, Mail, ShieldAlert } from 'lucide-react';

export const IntegrationStatus: React.FC = () => (
  <div className="space-y-6">
    <header>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">Connections</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Integrations</h1>
      <p className="mt-2 text-sm text-slate-600">These connections are intentionally inactive until credentials and provider verification are completed.</p>
    </header>
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-slate-100 p-3 text-slate-600"><Mail className="h-5 w-5" /></div>
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-900">Hostinger email</h2>
            <span className="mt-2 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">Not connected</span>
            <p className="mt-3 text-sm leading-6 text-slate-600">Sending, mailbox sync, replies, delivery reports, and open tracking are unavailable. Email controls are not exposed as if they were live.</p>
            <p className="mt-2 text-xs text-slate-500">Setup requires secure server-side SMTP/IMAP credentials, sender verification, consent handling, and provider-level delivery event support.</p>
          </div>
        </div>
      </section>
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
      <p>Never send credentials in chat or commit them to source control. Configure provider secrets through the protected deployment environment, then validate test transactions and webhook signatures before enabling any connection.</p>
    </div>
  </div>
);
