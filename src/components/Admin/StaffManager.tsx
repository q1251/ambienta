import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, LogIn, UserPlus, Users, UserX } from 'lucide-react';

const availablePermissions = [
  { id: 'leads', label: 'Leads' },
  { id: 'orders', label: 'Orders' },
  { id: 'products', label: 'Products' },
  { id: 'integrations', label: 'Integrations' },
] as const;
type StaffPermission = (typeof availablePermissions)[number]['id'];

interface StaffAccount {
  id: number;
  email: string;
  display_name: string;
  role: 'operator';
  permissions: StaffPermission[];
  is_active: boolean;
  created_by: string;
  created_at: string;
  assigned_lead_count: number;
}

interface StaffManagerProps {
  onEnterAccount: (session: {
    role: 'operator';
    email: string;
    displayName: string;
    permissions: StaffPermission[];
    impersonating: true;
    impersonatedBy: string;
  }) => void;
}

const defaultPermissions: StaffPermission[] = ['leads', 'orders', 'products', 'integrations'];

export const StaffManager: React.FC<StaffManagerProps> = ({ onEnterAccount }) => {
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [permissions, setPermissions] = useState<StaffPermission[]>(defaultPermissions);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPermissions, setEditPermissions] = useState<StaffPermission[]>([]);
  const [oneTimeCredentials, setOneTimeCredentials] = useState<Array<{ displayName: string; email: string; temporaryPassword: string }>>([]);
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
        throw new Error(result.message || 'Agent accounts could not be loaded.');
      }
      setAccounts(result.staff);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Agent accounts could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  const togglePermission = (current: StaffPermission[], permission: StaffPermission, update: (next: StaffPermission[]) => void) => {
    update(current.includes(permission) ? current.filter((value) => value !== permission) : [...current, permission]);
  };

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
        body: JSON.stringify({ displayName, email, temporaryPassword, permissions }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || 'The agent account could not be created.');
      setDisplayName('');
      setEmail('');
      setTemporaryPassword('');
      setMessage('Agent account created. The agent must replace this temporary password at first sign-in.');
      await loadAccounts();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'The agent account could not be created.');
    } finally {
      setSaving(false);
    }
  };

  const createDemoAgents = useCallback(async () => {
    setError('');
    setMessage('');
    setOneTimeCredentials([]);
    setSaving(true);
    try {
      const response = await fetch('/api/data.php?resource=staff', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ createDemoAgents: true }),
      });
      const result = await response.json() as {
        created?: Array<{ displayName: string; email: string; temporaryPassword: string }>;
        message?: string;
      };
      if (!response.ok || !Array.isArray(result.created)) {
        throw new Error(result.message || 'Demo agent accounts could not be created.');
      }
      setOneTimeCredentials(result.created);
      setMessage(result.message || 'Demo agent accounts are ready.');
      await loadAccounts();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Demo agent accounts could not be created.');
    } finally {
      setSaving(false);
    }
  }, [loadAccounts]);

  useEffect(() => { void createDemoAgents(); }, [createDemoAgents]);

  const updateAccount = async (account: StaffAccount, changes: Record<string, unknown>, successMessage: string) => {
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const response = await fetch('/api/data.php?resource=staff', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: account.id, ...changes }),
      });
      const result = await response.json() as { message?: string; temporaryPassword?: string | null };
      if (!response.ok) throw new Error(result.message || 'The agent account could not be updated.');
      if (result.temporaryPassword) {
        setOneTimeCredentials([{ displayName: account.display_name, email: account.email, temporaryPassword: result.temporaryPassword }]);
      }
      setMessage(successMessage);
      setEditingId(null);
      await loadAccounts();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'The agent account could not be updated.');
    } finally {
      setSaving(false);
    }
  };

  const enterAccount = async (account: StaffAccount) => {
    setError('');
    setSaving(true);
    try {
      const response = await fetch('/api/data.php?resource=staff-session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: 'enter', staffId: account.id }),
      });
      const result = await response.json() as {
        role?: 'operator';
        email?: string;
        displayName?: string;
        permissions?: StaffPermission[];
        impersonating?: true;
        impersonatedBy?: string;
        message?: string;
      };
      if (!response.ok || result.role !== 'operator' || !result.email) {
        throw new Error(result.message || 'The agent account could not be opened.');
      }
      onEnterAccount({
        role: result.role,
        email: result.email,
        displayName: result.displayName || result.email,
        permissions: result.permissions || [],
        impersonating: true,
        impersonatedBy: result.impersonatedBy || '',
      });
    } catch (enterError) {
      setError(enterError instanceof Error ? enterError.message : 'The agent account could not be opened.');
    } finally {
      setSaving(false);
    }
  };

  const startEditing = (account: StaffAccount) => {
    setEditingId(account.id);
    setEditName(account.display_name);
    setEditEmail(account.email);
    setEditPermissions(account.permissions);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">Access control</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Agent management</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">Create accounts, grant operational access, assign leads from the Leads table, reset credentials, and securely enter an agent workspace.</p>
        </div>
        <button type="button" disabled={saving} onClick={() => void createDemoAgents()} className="rounded-xl border border-teal-800 px-4 py-2.5 text-sm font-semibold text-teal-900 hover:bg-teal-50 disabled:opacity-50">
          {saving ? 'Working…' : 'Create five demo agents'}
        </button>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</p>}
      {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}

      {oneTimeCredentials.length > 0 && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="font-semibold text-amber-950">One-time temporary credentials</h2>
          <p className="mt-1 text-sm text-amber-900">Copy these now and deliver them securely. Passwords are never shown again and must be changed at first sign-in.</p>
          <div className="mt-4 space-y-3">
            {oneTimeCredentials.map((credential) => (
              <div key={credential.email} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white p-3 text-sm">
                <span className="font-medium text-slate-900">{credential.displayName} · {credential.email}</span>
                <code className="rounded bg-slate-100 px-2 py-1 text-slate-800">{credential.temporaryPassword}</code>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setOneTimeCredentials([])} className="mt-3 text-xs font-semibold text-amber-900 underline">Dismiss credentials</button>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-teal-800" />
          <h2 className="font-semibold text-slate-900">Create an agent account</h2>
        </div>
        <form onSubmit={createAccount} className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">Display name
            <input required maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          </label>
          <label className="block text-sm font-medium text-slate-700">Sign-in email
            <input type="email" required autoComplete="off" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          </label>
          <label className="block text-sm font-medium text-slate-700 md:col-span-2">Temporary password
            <input type="password" required minLength={12} autoComplete="new-password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          </label>
          <fieldset className="md:col-span-2">
            <legend className="text-sm font-semibold text-slate-800">Operational permissions</legend>
            <div className="mt-2 flex flex-wrap gap-4">
              {availablePermissions.map((permission) => (
                <label key={permission.id} className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={permissions.includes(permission.id)} onChange={() => togglePermission(permissions, permission.id, setPermissions)} className="rounded border-slate-300 text-teal-800" />
                  {permission.label}
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" disabled={saving} className="justify-self-start rounded-xl bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50">{saving ? 'Creating…' : 'Create agent'}</button>
        </form>
        <p className="mt-3 text-xs leading-5 text-slate-500">The password is hashed in the database; share it out-of-band. Staff administration and audit access remain superadmin-only.</p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <Users className="h-5 w-5 text-slate-500" />
          <h2 className="font-semibold text-slate-900">Agents ({accounts.length})</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {accounts.map((account) => (
            <div key={account.id} className="px-5 py-4">
              {editingId === account.id ? (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm font-medium text-slate-700">Display name<input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={120} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                    <label className="text-sm font-medium text-slate-700">Email<input type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} maxLength={254} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {availablePermissions.map((permission) => (
                      <label key={permission.id} className="inline-flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={editPermissions.includes(permission.id)} onChange={() => togglePermission(editPermissions, permission.id, setEditPermissions)} />
                        {permission.label}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={saving} onClick={() => void updateAccount(account, { displayName: editName, email: editEmail, permissions: editPermissions }, 'Agent account details and permissions updated.')} className="rounded-lg bg-teal-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Save changes</button>
                    <button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-[220px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{account.display_name || account.email}</p>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${account.is_active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{account.is_active ? 'Active' : 'Inactive'}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{account.email} · {account.assigned_lead_count} assigned leads · Created {account.created_at} by {account.created_by}</p>
                    <p className="mt-2 flex flex-wrap gap-1.5">
                      {account.permissions.map((permission) => <span key={permission} className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium capitalize text-teal-900">{permission}</span>)}
                      {!account.permissions.length && <span className="text-xs text-slate-500">No operational permissions</span>}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {account.is_active && <button type="button" disabled={saving} onClick={() => void enterAccount(account)} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-800 disabled:opacity-50"><LogIn className="h-3.5 w-3.5" />Enter account</button>}
                    <button type="button" disabled={saving} onClick={() => startEditing(account)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
                    <button type="button" disabled={saving} onClick={() => void updateAccount(account, { resetPassword: true }, 'A new one-time password was generated.')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><KeyRound className="h-3.5 w-3.5" />Reset password</button>
                    <button type="button" disabled={saving} onClick={() => void updateAccount(account, { isActive: !account.is_active }, `${account.email} ${account.is_active ? 'deactivated' : 'activated'}.`)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"><UserX className="h-3.5 w-3.5" />{account.is_active ? 'Deactivate' : 'Activate'}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!loading && accounts.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-500">No agent accounts yet.</p>}
          {loading && <p className="px-5 py-10 text-center text-sm text-slate-500">Loading agent accounts…</p>}
        </div>
      </section>
    </div>
  );
};
