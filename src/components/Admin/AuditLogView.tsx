import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search, ShieldCheck, X } from 'lucide-react';

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

const auditActionLabel = (entry: AuditEntry): string => {
  const action = entry.action.startsWith(`${entry.entity_type}.`)
    ? entry.action.slice(entry.entity_type.length + 1)
    : entry.action;
  return humanize(action);
};

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
      if (changedLabel) {
        formatted.push({
          label: '',
          value: `${humanize(changedLabel[1])} ${value ? 'changed' : 'unchanged'}`,
        });
        continue;
      }
      formatted.push({
        label: humanize(key),
        value: value ? 'Yes' : 'No',
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
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [recordFilter, setRecordFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

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

  const actions = [...new Set(entries.map((entry) => entry.action))].sort();
  const recordTypes = [...new Set(entries.map((entry) => entry.entity_type))].sort();
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredEntries = entries.filter((entry) => {
    const entryDate = entry.created_at.slice(0, 10);
    if (actionFilter && entry.action !== actionFilter) return false;
    if (recordFilter && entry.entity_type !== recordFilter) return false;
    if (fromDate && entryDate < fromDate) return false;
    if (toDate && entryDate > toDate) return false;
    if (!normalizedQuery) return true;

    const details = entry.details == null ? '' : JSON.stringify(entry.details);
    return [
      entry.actor_email,
      humanize(entry.action),
      humanize(entry.entity_type),
      entry.entity_id,
      details,
    ].join(' ').toLocaleLowerCase().includes(normalizedQuery);
  });
  const hasFilters = Boolean(searchQuery || actionFilter || recordFilter || fromDate || toDate);
  const clearFilters = () => {
    setSearchQuery('');
    setActionFilter('');
    setRecordFilter('');
    setFromDate('');
    setToDate('');
  };

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

      <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-3 lg:grid-cols-6">
        <label className="relative col-span-2 block lg:col-span-2">
          <span className="sr-only">Search audit activity</span>
          <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto h-4 w-4 text-slate-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search audit activity…"
            className="h-[42px] w-full rounded-lg border border-slate-300 py-2.5 pl-9 pr-3 text-sm text-slate-800 outline-none focus:border-blue-700 focus:ring-2 focus:ring-blue-100"
          />
        </label>
        <label className="col-span-2 block lg:col-span-2">
          <span className="sr-only">Filter by action</span>
          <select
            aria-label="Filter by action"
            value={actionFilter}
            onChange={(event) => setActionFilter(event.target.value)}
            className="h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800"
          >
            <option value="">All actions</option>
            {actions.map((action) => <option key={action} value={action}>{humanize(action)}</option>)}
          </select>
        </label>
        <label className="col-span-2 block lg:col-span-2">
          <span className="sr-only">Filter by record type</span>
          <select
            aria-label="Filter by record type"
            value={recordFilter}
            onChange={(event) => setRecordFilter(event.target.value)}
            className="h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800"
          >
            <option value="">All records</option>
            {recordTypes.map((recordType) => <option key={recordType} value={recordType}>{humanize(recordType)}</option>)}
          </select>
        </label>
        <label className="col-span-1 block text-xs font-semibold text-slate-600 lg:col-span-3">
          <span className="mb-1 block">From</span>
          <input
            aria-label="From date"
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(event) => setFromDate(event.target.value)}
            className="h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-800"
          />
        </label>
        <label className="col-span-1 block text-xs font-semibold text-slate-600 lg:col-span-3">
          <span className="mb-1 block">To</span>
          <input
            aria-label="To date"
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(event) => setToDate(event.target.value)}
            className="h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-800"
          />
        </label>
        <div className="col-span-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-2 lg:col-span-6">
          <p role="status" className="whitespace-nowrap text-sm text-slate-600">
            {filteredEntries.length} of {entries.length} events
          </p>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50">
              <X className="h-4 w-4" />
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="w-full max-h-[calc(100vh-16rem)] overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] table-fixed divide-y divide-slate-200 text-left text-sm">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[30%]" />
            <col className="w-[36%]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Activity</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredEntries.map((entry) => (
              <tr key={entry.id}>
                <td className="px-4 py-3 align-top">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="font-semibold text-slate-900">{auditActionLabel(entry)}</span>
                    <time className="whitespace-nowrap text-xs text-slate-500">{entry.created_at}</time>
                  </div>
                  <p className="mt-1 break-all text-xs text-slate-500">{humanize(entry.entity_type)} · {entry.entity_id}</p>
                </td>
                <td className="break-all px-4 py-3 align-top text-slate-700">{entry.actor_email}</td>
                <td className="px-4 py-3 text-slate-600">
                  {formatAuditDetails(entry.details).length > 0 ? (
                    <dl className="space-y-1.5 break-words">
                      {formatAuditDetails(entry.details).map((detail, index) => (
                        <div key={`${detail.label}-${index}`}>
                          {detail.label && <dt className="inline font-semibold text-slate-700">{detail.label}: </dt>}
                          <dd className="inline">{detail.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : '—'}
                </td>
              </tr>
            ))}
            {!isLoading && !error && entries.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-10 text-center text-slate-500">No recorded changes yet.</td></tr>
            )}
            {!isLoading && !error && entries.length > 0 && filteredEntries.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-10 text-center text-slate-500">No activity matches these search and filter criteria.</td></tr>
            )}
            {isLoading && (
              <tr><td colSpan={3} className="px-4 py-10 text-center text-slate-500">Loading audit events…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
