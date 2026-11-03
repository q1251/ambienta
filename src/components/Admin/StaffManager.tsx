import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, Users, UserX } from 'lucide-react';

interface StaffAccount {
  id: number;
  email: string;
  role: 'operator';
  is_active: boolean;
  created_by: string;
  created_at: string;
}

export const StaffManager: React.FC = () => {
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [email, setEmail] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/data.php?resource=staff', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const result = await response.json() as { staff?: StaffAccount[]; message?: string };
      if (!response.ok || !Array.isArray(result.staff)) {
        throw new Error(result.message || 'Staff accounts could not be loaded.');
      }
      setAccounts(result.staff);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Staff accounts could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);

  const createAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const response = await fetch('/api/data.php?resource=staff', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, temporaryPassword }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || 'The operator account could not be created.');
      setEmail('');
      setTemporaryPassword('');
      setMessage('Operator account created. Share the temporary password with the operator using a secure channel; they must change it on first sign-in.');
      await loadAccounts();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'The operator account could not be created.');
    } finally {
      setSaving(false);
    }
  };

  const setAccountActive = async (account: StaffAccount) => {
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/data.php?resource=staff', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: account.id, isActive: !account.is_active }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || 'The account could not be updated.');
      setMessage(`${account.email} ${account.is_active ? 'deactivated' : 'activated'}.`);
      await loadAccounts();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'The account could not be updated.');
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">Access control</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Staff accounts</h1>
        <p className="mt-2 text-sm text-slate-600">Operators can manage orders and products. Only the primary administrator can manage staff and view the audit log.</p>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</p>}
      {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-teal-800" />
          <h2 className="font-semibold text-slate-900">Create operator account</h2>
        </div>
        <form onSubmit={createAccount} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="block text-sm font-medium text-slate-700">
            Staff email
            <input type="email" required autoComplete="off" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Temporary password
            <input type="password" required minLength={12} autoComplete="new-password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          </label>
          <button type="submit" disabled={saving} className="rounded-xl bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50">{saving ? 'Creating…' : 'Create operator'}</button>
        </form>
        <p className="mt-3 text-xs leading-5 text-slate-500">Use a unique temporary password of at least 12 characters. It is stored as a hash; communicate it out-of-band. The operator must replace it at first sign-in.</p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <Users className="h-5 w-5 text-slate-500" />
          <h2 className="font-semibold text-slate-900">Operators</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {accounts.map((account) => (
            <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">{account.email}</p>
                <p className="mt-0.5 text-xs text-slate-500">Operator · Created {account.created_at} by {account.created_by}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${account.is_active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{account.is_active ? 'Active' : 'Inactive'}</span>
                <button type="button" onClick={() => void setAccountActive(account)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                  <UserX className="h-3.5 w-3.5" /> {account.is_active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          ))}
          {!loading && accounts.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-500">No operator accounts yet.</p>}
          {loading && <p className="px-5 py-10 text-center text-sm text-slate-500">Loading staff accounts…</p>}
        </div>
      </section>
    </div>
  );
};
