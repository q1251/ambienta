import React, { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';

interface RequiredPasswordChangeProps {
  onComplete: () => void;
  onLogout: () => Promise<void>;
}

export const RequiredPasswordChange: React.FC<RequiredPasswordChangeProps> = ({ onComplete, onLogout }) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < 12) {
      setError('Use at least 12 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/auth.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: 'change-password', newPassword: password }),
      });
      const result = await response.json() as { updated?: boolean; message?: string };
      if (!response.ok || !result.updated) throw new Error(result.message || 'The password could not be changed.');
      setPassword('');
      setConfirmPassword('');
      onComplete();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The password could not be changed.');
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    setError('');
    setLoggingOut(true);
    try {
      await onLogout();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : 'Unable to sign out securely.');
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 shadow-xl sm:p-9">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-800"><KeyRound className="h-5 w-5" /></div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">Account security</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Set a personal password</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">This temporary password must be replaced before accessing operational records.</p>
        {error && <p role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-700">New password
            <input type="password" required minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3" />
          </label>
          <label className="block text-sm font-medium text-slate-700">Confirm new password
            <input type="password" required minLength={12} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3" />
          </label>
          <button type="submit" disabled={saving} className="w-full rounded-xl bg-teal-800 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50">{saving ? 'Updating…' : 'Update password'}</button>
        </form>
        <p className="mt-5 flex gap-2 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500"><ShieldCheck className="h-4 w-4 shrink-0 text-teal-800" /> Choose a unique password. Never reuse the temporary password or share passwords through email.</p>
        <button type="button" disabled={loggingOut} onClick={() => void signOut()} className="mt-4 text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50">{loggingOut ? 'Signing out…' : 'Sign out'}</button>
      </section>
    </main>
  );
};
