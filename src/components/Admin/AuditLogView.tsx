import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';

interface AuditEntry {
  id: number | string;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: unknown;
  created_at: string;
}

const permissionLabels: Record<string, string> = {
  leads: 'Assigned leads',
  new_leads: 'View unassigned new leads',
  add_leads: 'Add contacts',
  import_leads: 'Import contacts',
  export_leads: 'Export contacts',
  view_lead_emails: 'View lead email addresses',
  view_lead_phone_numbers: 'View lead phone numbers',
  orders: 'Orders',
  print_orders: 'Print orders',
  products: 'Products & stock',
  integrations: 'Email',
  email_campaigns: 'Email campaigns',
  chat: 'Live chat',
};

const humanize = (value: string): string => value
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[._-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^./, (character) => character.toUpperCase());

const formatAuditDetails = (details: unknown): Array<{ label: string; value: string }> => {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return [];

  const values = details as Record<string, unknown>;
  const formatted: Array<{ label: string; value: string }> = [];
  if (values.from !== undefined || values.to !== undefined) {
    formatted.push({
      label: 'Changed',
      value: `${String(values.from ?? '—')} → ${String(values.to ?? '—')}`,
    });
  }

  for (const [key, value] of Object.entries(values)) {
    if (key === 'from' || key === 'to' || value === null || value === undefined) continue;
    if (typeof value === 'boolean') {
      const changedLabel = key.match(/^(.+)Changed$/);
      formatted.push({
        label: changedLabel ? humanize(changedLabel[1]) : humanize(key),
        value: changedLabel ? (value ? 'Changed' : 'Unchanged') : (value ? 'Yes' : 'No'),
      });
      continue;
    }
    if (Array.isArray(value)) {
      const items = value.map((item) => {
        if (typeof item !== 'string') return String(item);
        return key === 'permissions' ? (permissionLabels[item] ?? humanize(item)) : item;
      });
      formatted.push({ label: humanize(key), value: items.join(', ') || 'None' });
      continue;
    }
    if (typeof value === 'object') {
      formatted.push({ label: humanize(key), value: JSON.stringify(value) });
      continue;
    }
    formatted.push({ label: humanize(key), value: String(value) });
  }

  return formatted;
};

export const AuditLogView: React.FC = () => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const loadEntries = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch('/api/data.php?resource=audit', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const result = await response.json() as { entries?: AuditEntry[]; message?: string };
      if (!response.ok || !Array.isArray(result.entries)) {
        throw new Error(result.message || 'The audit log could not be loaded.');
      }
      setEntries(result.entries);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The audit log could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  return (
    <section className="space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-800">
            <ShieldCheck className="h-4 w-4" />
            <span>Administrative activity</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900">Audit log</h2>
          <p className="mt-1 text-sm text-slate-600">Recent administrative and staff activity. The log retains the latest 200 events.</p>
        </div>
        <button
          type="button"
          onClick={() => void loadEntries()}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </header>

      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}

      <div className="w-full max-h-[calc(100vh-16rem)] min-h-72 overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1000px] table-fixed divide-y divide-slate-200 text-left text-sm">
          <colgroup>
            <col className="w-[170px]" />
            <col className="w-[190px]" />
            <col className="w-[180px]" />
            <col className="w-[175px]" />
            <col />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Record</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{entry.created_at}</td>
                <td className="px-4 py-3 text-slate-700">{entry.actor_email}</td>
                <td className="px-4 py-3 font-medium capitalize text-slate-900">{humanize(entry.action)}</td>
                <td className="break-all px-4 py-3 text-slate-700">{humanize(entry.entity_type)} · {entry.entity_id}</td>
                <td className="px-4 py-3 text-slate-600">
                  {formatAuditDetails(entry.details).length > 0 ? (
                    <dl className="space-y-1.5 break-words">
                      {formatAuditDetails(entry.details).map((detail, index) => (
                        <div key={`${detail.label}-${index}`}>
                          <dt className="inline font-semibold text-slate-700">{detail.label}: </dt>
                          <dd className="inline">{detail.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : '—'}
                </td>
              </tr>
            ))}
            {!isLoading && !error && entries.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">No recorded changes yet.</td></tr>
            )}
            {isLoading && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-500">Loading audit events…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
