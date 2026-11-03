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
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-teal-800">
            <ShieldCheck className="h-4 w-4" />
            <span>Administrative activity</span>
          </div>
          <h2 className="text-xl font-bold text-slate-900">Audit log</h2>
          <p className="mt-1 text-sm text-slate-600">Recent catalog and order changes. The log retains the latest 200 events.</p>
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

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
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
                <td className="px-4 py-3 font-medium text-slate-900">{entry.action.replace(/\./g, ' ')}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-700">{entry.entity_type} · {entry.entity_id}</td>
                <td className="max-w-sm px-4 py-3 font-mono text-xs text-slate-600">
                  {entry.details == null ? '—' : JSON.stringify(entry.details)}
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
