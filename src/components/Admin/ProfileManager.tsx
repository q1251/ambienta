import React, { useState } from 'react';
import { KeyRound, ShieldCheck, UserRound } from 'lucide-react';

interface ProfileManagerProps {
  role: 'admin' | 'operator';
  email: string;
  displayName: string;
  onProfileUpdated: (email: string, displayName: string) => void;
}

export const ProfileManager: React.FC<ProfileManagerProps> = ({
  role,
  email: initialEmail,
  displayName: initialDisplayName,
  onProfileUpdated,
}) => {
  const [email, setEmail] = useState(initialEmail);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (newPassword && newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    if (newPassword && newPassword.length < 12) {
      setError('Use at least 12 characters for the new password.');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/auth.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: 'update-profile', email, displayName, currentPassword, newPassword }),
      });
      const result = await response.json() as { updated?: boolean; email?: string; displayName?: string; message?: string };
      if (!response.ok || !result.updated || !result.email || !result.displayName) {
        throw new Error(result.message || 'The profile could not be updated.');
      }
      setEmail(result.email);
      setDisplayName(result.displayName);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage('Your profile was updated.');
      onProfileUpdated(result.email, result.displayName);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The profile could not be updated.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">Account settings</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Profile &amp; security</h1>
        <p className="mt-2 text-sm text-slate-600">Update the name and email shown for your {role === 'admin' ? 'administrator' : 'operator'} account, or set a new password.</p>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</p>}
      {message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}

      <form onSubmit={saveProfile} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-7">
        <section>
          <div className="mb-4 flex items-center gap-2">
            <UserRound className="h-5 w-5 text-teal-800" />
            <h2 className="font-semibold text-slate-900">Account details</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">Display name
              <input required maxLength={120} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
            </label>
            <label className="block text-sm font-medium text-slate-700">Sign-in email
              <input required type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
            </label>
          </div>
        </section>

        <section className="border-t border-slate-100 pt-5">
          <div className="mb-4 flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-teal-800" />
            <h2 className="font-semibold text-slate-900">Change password</h2>
          </div>
          <label className="mb-4 block text-sm font-medium text-slate-700">New password <span className="font-normal text-slate-500">(leave blank to keep current)</span>
            <input type="password" minLength={12} maxLength={1024} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          </label>
          <label className="mb-4 block text-sm font-medium text-slate-700">Confirm new password
            <input type="password" minLength={12} maxLength={1024} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          </label>
          <label className="block text-sm font-medium text-slate-700">Current password <span className="font-normal text-slate-500">(required to save changes)</span>
            <input type="password" required maxLength={1024} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
          </label>
        </section>

        <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex gap-2 text-xs leading-5 text-slate-500"><ShieldCheck className="h-4 w-4 shrink-0 text-teal-800" /> Passwords are stored as secure hashes. Email changes take effect for your next sign-in.</p>
          <button type="submit" disabled={saving} className="shrink-0 rounded-xl bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50">{saving ? 'Saving…' : 'Save profile'}</button>
        </div>
      </form>
    </div>
  );
};
