import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, KeyRound, LogIn, UserPlus, Users, UserX } from 'lucide-react';

const availablePermissions = [
  { id: 'leads', label: 'Assigned leads' },
  { id: 'new_leads', label: 'View unassigned new leads' },
  { id: 'add_leads', label: 'Add contacts' },
  { id: 'import_leads', label: 'Import contacts (CSV)' },
  { id: 'export_leads', label: 'Export contacts (CSV)' },
  { id: 'orders', label: 'Orders' },
  { id: 'print_orders', label: 'Print orders' },
  { id: 'products', label: 'Products & stock' },
  { id: 'integrations', label: 'Email & campaigns' },
  { id: 'chat', label: 'Live chat' },
] as const;
type StaffPermission = (typeof availablePermissions)[number]['id'];
const permissionRequiresLeads = (permission: StaffPermission) =>
  permission === 'new_leads' || permission === 'add_leads'
  || permission === 'import_leads' || permission === 'export_leads';
const permissionRequiresOrders = (permission: StaffPermission) => permission === 'print_orders';

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

interface AgentProfile extends StaffAccount {
  updated_at: string;
  assignedLeads: Array<{
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    status: string;
    createdAt: string;
  }>;
}

interface StaffPresence {
  id: number;
  displayName: string;
  email: string;
  active: boolean;
  online: boolean;
  durationSeconds: number;
  currentSection: string | null;
  lastSeenAt: string | null;
}

interface PresenceResponse {
  admin: { online: boolean; durationSeconds: number; currentSection: string | null };
  staff: StaffPresence[];
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

const defaultPermissions: StaffPermission[] = ['leads'];

export const StaffManager: React.FC<StaffManagerProps> = ({ onEnterAccount }) => {
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [permissions, setPermissions] = useState<StaffPermission[]>(defaultPermissions);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [profileAccountId, setProfileAccountId] = useState<number | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<AgentProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [resetPasswordReveal, setResetPasswordReveal] = useState<{ accountId: number; password: string } | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPermissions, setEditPermissions] = useState<StaffPermission[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [presence, setPresence] = useState<PresenceResponse | null>(null);
  const [agentsMayClaimWhenAdminOnline, setAgentsMayClaimWhenAdminOnline] = useState(false);
  const [routingSaving, setRoutingSaving] = useState(false);

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

  const loadPresenceAndRouting = useCallback(async () => {
    try {
      const [presenceResponse, routingResponse] = await Promise.all([
        fetch('/api/data.php?resource=staff-presence', { credentials: 'same-origin', headers: { Accept: 'application/json' } }),
        fetch('/api/data.php?resource=crm-routing-settings', { credentials: 'same-origin', headers: { Accept: 'application/json' } }),
      ]);
      const presenceResult = await presenceResponse.json() as PresenceResponse & { message?: string };
      const routingResult = await routingResponse.json() as { agentsMayClaimWhenAdminOnline?: boolean; message?: string };
      if (!presenceResponse.ok || !Array.isArray(presenceResult.staff) || !presenceResult.admin
        || !routingResponse.ok || typeof routingResult.agentsMayClaimWhenAdminOnline !== 'boolean') {
        throw new Error(presenceResult.message || routingResult.message || 'Staff presence and chat routing could not be loaded.');
      }
      setPresence(presenceResult);
      setAgentsMayClaimWhenAdminOnline(routingResult.agentsMayClaimWhenAdminOnline);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Staff presence and chat routing could not be loaded.');
    }
  }, []);

  const togglePermission = (current: StaffPermission[], permission: StaffPermission, update: (next: StaffPermission[]) => void) => {
    if (permissionRequiresLeads(permission) && !current.includes('leads')) return;
    if (permissionRequiresOrders(permission) && !current.includes('orders')) return;
    if (permission === 'leads' && current.includes('leads')) {
      update(current.filter((value) => value !== 'leads' && value !== 'new_leads'
        && value !== 'add_leads' && value !== 'import_leads' && value !== 'export_leads'));
      return;
    }
    if (permission === 'orders' && current.includes('orders')) {
      update(current.filter((value) => value !== 'orders' && value !== 'print_orders'));
      return;
    }
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
      setPermissions(defaultPermissions);
      setCreateModalOpen(false);
      setMessage('Agent account created. The agent must replace this temporary password at first sign-in.');
      await loadAccounts();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'The agent account could not be created.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
    void loadPresenceAndRouting();
    const timer = window.setInterval(() => void loadPresenceAndRouting(), 15_000);
    return () => window.clearInterval(timer);
  }, [loadAccounts, loadPresenceAndRouting]);

  const updateChatRouting = async (enabled: boolean) => {
    setRoutingSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/data.php?resource=crm-routing-settings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ agentsMayClaimWhenAdminOnline: enabled }),
      });
      const result = await response.json() as { agentsMayClaimWhenAdminOnline?: boolean; message?: string };
      if (!response.ok || typeof result.agentsMayClaimWhenAdminOnline !== 'boolean') {
        throw new Error(result.message || 'The chat routing setting could not be saved.');
      }
      setAgentsMayClaimWhenAdminOnline(result.agentsMayClaimWhenAdminOnline);
      setMessage(enabled
        ? 'Chat-enabled agents can now claim shared-queue chats while you are online.'
        : 'Shared-queue chats now go to agents only while you are offline.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The chat routing setting could not be saved.');
    } finally {
      setRoutingSaving(false);
    }
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  };

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
      if (changes.resetPassword === true) {
        if (!result.temporaryPassword) throw new Error('The password was reset, but its one-time value was not returned. Reset it again before sharing credentials.');
        setResetPasswordReveal({ accountId: account.id, password: result.temporaryPassword });
        setMessage('Temporary password generated. Copy it now and share it through a secure channel.');
      } else {
        setResetPasswordReveal(null);
        setMessage(successMessage);
      }
      setEditingId(null);
      await loadAccounts();
      if (profileAccountId === account.id) await openProfile(account);
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

  const openProfile = async (account: StaffAccount) => {
    if (profileAccountId !== account.id) setResetPasswordReveal(null);
    setProfileAccountId(account.id);
    setSelectedProfile(null);
    setProfileError('');
    setProfileLoading(true);
    try {
      const response = await fetch(`/api/data.php?resource=staff&id=${encodeURIComponent(String(account.id))}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const result = await response.json() as { profile?: AgentProfile; message?: string };
      if (!response.ok || !result.profile || !Array.isArray(result.profile.assignedLeads)) {
        throw new Error(result.message || 'The agent profile could not be loaded.');
      }
      setSelectedProfile(result.profile);
    } catch (loadError) {
      setProfileError(loadError instanceof Error ? loadError.message : 'The agent profile could not be loaded.');
    } finally {
      setProfileLoading(false);
    }
  };

  const startEditing = (account: StaffAccount) => {
    setEditingId(account.id);
    setEditName(account.display_name);
    setEditEmail(account.email);
    setEditPermissions(account.permissions);
    setError('');
    setMessage('');
  };

  const closeEditModal = () => {
    if (saving) return;
    setEditingId(null);
    setError('');
  };

  useEffect(() => {
    if (editingId === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) closeEditModal();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingId, saving]);

  useEffect(() => {
    if (!createModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setCreateModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createModalOpen, saving]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-800">Access control</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{profileAccountId === null ? 'Agent management' : 'Agent profile'}</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">{profileAccountId === null ? 'Create accounts and select an agent to view their profile, manage access, update credentials, or enter their workspace.' : 'Review and manage this agent’s account, permissions, credentials, and assigned leads.'}</p>
        </div>
      </header>

      {(profileAccountId === null || editingId === null) && error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</p>}
      {(profileAccountId === null || editingId === null) && message && <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">{message}</p>}

      {profileAccountId !== null ? (
        <section className="space-y-6">
          <button type="button" onClick={() => { setProfileAccountId(null); setSelectedProfile(null); setProfileError(''); setEditingId(null); setResetPasswordReveal(null); }} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />Back to agents
          </button>
          {profileLoading && <p role="status" className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">Loading agent profile…</p>}
          {profileError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{profileError}</p>}
          {selectedProfile && (
            <>
              <header className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-800">Agent profile</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{selectedProfile.display_name || selectedProfile.email}</h2>
                  <p className="mt-1 text-sm text-slate-600">{selectedProfile.email} · {selectedProfile.is_active ? 'Active' : 'Inactive'} agent</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedProfile.is_active && <button type="button" disabled={saving} onClick={() => void enterAccount(selectedProfile)} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"><LogIn className="h-4 w-4" />Enter account</button>}
                  <button type="button" disabled={saving} onClick={() => void updateAccount(selectedProfile, { resetPassword: true }, 'A new one-time password was generated.')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><KeyRound className="h-4 w-4" />Reset password</button>
                  <button type="button" disabled={saving} onClick={() => void updateAccount(selectedProfile, { isActive: !selectedProfile.is_active }, `Agent ${selectedProfile.is_active ? 'deactivated' : 'activated'}.`)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><UserX className="h-4 w-4" />{selectedProfile.is_active ? 'Deactivate' : 'Activate'}</button>
                </div>
              </header>

              {resetPasswordReveal?.accountId === selectedProfile.id && (
                <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-950">Temporary password — shown once</p>
                  <p className="mt-1 text-xs text-amber-900">Copy and share this password through a secure channel. It will not be available after you leave this profile.</p>
                  <input
                    type="text"
                    aria-label="One-time temporary password"
                    readOnly
                    value={resetPasswordReveal.password}
                    onFocus={(event) => event.currentTarget.select()}
                    className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-sm text-slate-900"
                  />
                  <button type="button" onClick={() => setResetPasswordReveal(null)} className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-100">Hide password</button>
                </div>
              )}

              <>
                  <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5">
                    <div>
                      <h3 className="font-semibold text-slate-900">Account details & access</h3>
                      <p className="mt-1 text-sm text-slate-600">Edit the agent’s name, sign-in email, and section permissions.</p>
                    </div>
                    <button type="button" onClick={() => startEditing(selectedProfile)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Edit profile</button>
                    <div className="w-full border-t border-slate-100 pt-4">
                      <div className="flex flex-wrap gap-2">
                        {selectedProfile.permissions.map((permission) => <span key={permission} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium capitalize text-blue-900">{permission}</span>)}
                        {!selectedProfile.permissions.length && <span className="text-sm text-slate-500">No operational permissions</span>}
                      </div>
                    </div>
                  </section>
                  <div className="grid gap-4 md:grid-cols-2">
                    <section className="rounded-2xl border border-slate-200 bg-white p-5">
                      <h3 className="font-semibold text-slate-900">Account history</h3>
                      <p className="mt-3 flex items-center gap-2 text-sm text-slate-700"><CalendarDays className="h-4 w-4 text-blue-800" />Created {new Date(selectedProfile.created_at).toLocaleString()}</p>
                      <p className="mt-2 text-sm text-slate-600">Created by {selectedProfile.created_by}</p>
                      <p className="mt-1 text-sm text-slate-600">Last updated {new Date(selectedProfile.updated_at).toLocaleString()}</p>
                    </section>
                    <section className="rounded-2xl border border-slate-200 bg-white p-5">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-semibold text-slate-900">Assigned leads</h3>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{selectedProfile.assignedLeads.length}</span>
                      </div>
                      {selectedProfile.assignedLeads.length ? (
                        <div className="mt-3 max-h-64 overflow-auto divide-y divide-slate-100">
                          {selectedProfile.assignedLeads.map((lead) => (
                            <div key={lead.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                              <div><p className="text-sm font-medium text-slate-900">{lead.firstName} {lead.lastName}</p><p className="text-xs text-slate-500">{lead.email}</p></div>
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{lead.status}</span>
                            </div>
                          ))}
                        </div>
                      ) : <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No leads assigned yet. Assign leads from Contact Leads.</p>}
                    </section>
                  </div>
                </>
            </>
          )}
        </section>
      ) : (
      <>
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-slate-900">Chat routing</h2>
              <p className="mt-1 max-w-xl text-sm text-slate-600">New chats wait for you first. When you are offline, active chat-enabled agents can claim from the shared queue.</p>
            </div>
            <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-slate-800">
              <input
                type="checkbox"
                checked={agentsMayClaimWhenAdminOnline}
                disabled={routingSaving}
                onChange={(event) => void updateChatRouting(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-800 focus:ring-blue-700"
              />
              Allow agents to claim while I’m online
            </label>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            {agentsMayClaimWhenAdminOnline
              ? 'Enabled: agents with Live chat permission may claim unowned chats even while you are online.'
              : 'Disabled: agents can claim unowned chats only when you are offline. Chats already assigned to an agent stay with that agent until you take over or reassign.'}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Your presence</h2>
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-700">
            <span className={`h-2.5 w-2.5 rounded-full ${presence?.admin.online ? 'bg-blue-500' : 'bg-slate-300'}`} />
            {presence?.admin.online ? `Online · ${formatDuration(presence.admin.durationSeconds)}` : 'Offline'}
          </p>
          {presence?.admin.online && <p className="mt-1 text-xs capitalize text-slate-500">Current section: {presence.admin.currentSection || 'overview'}</p>}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Agent presence</h2>
          <p className="mt-1 text-xs text-slate-500">Live status refreshes every 15 seconds. Agents are considered offline after 90 seconds without an authenticated CRM heartbeat.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {presence?.staff.map((agent) => (
            <div key={agent.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{agent.displayName || agent.email}</p>
                <p className="truncate text-xs text-slate-500">{agent.email}</p>
              </div>
              <div className="text-right">
                <p className={`text-xs font-semibold ${agent.online ? 'text-blue-700' : 'text-slate-500'}`}>
                  {agent.online ? `Online · ${formatDuration(agent.durationSeconds)}` : agent.active ? 'Offline' : 'Inactive'}
                </p>
                <p className="mt-0.5 text-xs capitalize text-slate-500">{agent.online ? agent.currentSection || 'overview' : 'No current activity'}</p>
              </div>
            </div>
          ))}
          {presence?.staff.length === 0 && <p className="px-5 py-6 text-sm text-slate-500">No agent accounts have been created.</p>}
          {!presence && <p className="px-5 py-6 text-sm text-slate-500">Loading staff presence…</p>}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-slate-500" />
            <h2 className="font-semibold text-slate-900">Agents ({accounts.length})</h2>
          </div>
          <button type="button" onClick={() => { setError(''); setCreateModalOpen(true); }} className="inline-flex items-center gap-2 rounded-xl bg-blue-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-900">
            <UserPlus className="h-4 w-4" />Create agent
          </button>
        </div>
        <div className="divide-y divide-slate-100">
          {accounts.map((account) => (
            <div key={account.id} className="flex flex-wrap items-center gap-4 px-5 py-4 sm:flex-nowrap sm:gap-6">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{account.display_name || account.email}</p>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${account.is_active ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>{account.is_active ? 'Active' : 'Inactive'}</span>
                    </div>
                    <p className="mt-1 break-words text-xs text-slate-500">{account.email} · {account.assigned_lead_count} assigned leads · Created {account.created_at} by {account.created_by}</p>
                    <p className="mt-2 flex flex-wrap gap-1.5">
                      {account.permissions.map((permission) => <span key={permission} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium capitalize text-blue-900">{permission}</span>)}
                      {!account.permissions.length && <span className="text-xs text-slate-500">No operational permissions</span>}
                    </p>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    <button type="button" onClick={() => void openProfile(account)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">View profile</button>
                  </div>
            </div>
          ))}
          {!loading && accounts.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-500">No agent accounts yet.</p>}
          {loading && <p className="px-5 py-10 text-center text-sm text-slate-500">Loading agent accounts…</p>}
        </div>
      </section>
      </>
      )}
      {createModalOpen && profileAccountId === null && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) setCreateModalOpen(false);
          }}
        >
          <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="create-agent-title">
            <header className="border-b border-slate-200 px-5 py-4 sm:px-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-800">Agent management</p>
              <h2 id="create-agent-title" className="mt-1 text-xl font-semibold text-slate-950">Create agent account</h2>
              <p className="mt-1 text-sm text-slate-600">Choose account details and the operational sections this agent can access.</p>
            </header>
            <form onSubmit={createAccount} className="space-y-5 p-5 sm:p-6">
              {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">Display name
                  <input required autoFocus maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" />
                </label>
                <label className="block text-sm font-medium text-slate-700">Sign-in email
                  <input required type="email" autoComplete="off" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" />
                </label>
              </div>
              <label className="block text-sm font-medium text-slate-700">Temporary password
                <input required type="password" minLength={12} maxLength={1024} autoComplete="new-password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" />
              </label>
              <fieldset>
                <legend className="text-sm font-semibold text-slate-800">Operational permissions</legend>
                <p className="mt-1 text-xs text-slate-500">Staff administration and audit access remain superadmin-only.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {availablePermissions.map((permission) => (
                    <label key={permission.id} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-700">
                      <input type="checkbox" checked={permissions.includes(permission.id)} disabled={(permissionRequiresLeads(permission.id) && !permissions.includes('leads')) || (permissionRequiresOrders(permission.id) && !permissions.includes('orders'))} onChange={() => togglePermission(permissions, permission.id, setPermissions)} className="rounded border-slate-300 text-blue-800" />
                      {permission.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="text-xs leading-5 text-slate-500">The password is stored as a secure hash, and the agent will be required to change it at first sign-in. Share the temporary password out-of-band.</p>
              <footer className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button type="button" disabled={saving} onClick={() => setCreateModalOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={saving || !displayName.trim() || !email.trim() || temporaryPassword.length < 12} className="rounded-lg bg-blue-800 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-50">{saving ? 'Creating…' : 'Create agent'}</button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {editingId !== null && selectedProfile && editingId === selectedProfile.id && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditModal();
          }}
        >
          <section
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-agent-profile-title"
          >
            <header className="border-b border-slate-200 px-5 py-4 sm:px-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-800">Agent account</p>
              <h2 id="edit-agent-profile-title" className="mt-1 text-xl font-semibold text-slate-950">Edit profile</h2>
              <p className="mt-1 text-sm text-slate-600">Update the agent’s name, sign-in email, and operational permissions.</p>
            </header>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void updateAccount(
                  selectedProfile,
                  { displayName: editName, email: editEmail, permissions: editPermissions },
                  'Agent profile updated.'
                );
              }}
              className="space-y-5 p-5 sm:p-6"
            >
              {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">Display name
                  <input required autoFocus maxLength={120} value={editName} onChange={(event) => setEditName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" />
                </label>
                <label className="block text-sm font-medium text-slate-700">Sign-in email
                  <input required type="email" autoComplete="email" maxLength={254} value={editEmail} onChange={(event) => setEditEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" />
                </label>
              </div>
              <fieldset>
                <legend className="text-sm font-semibold text-slate-800">Operational permissions</legend>
                <p className="mt-1 text-xs text-slate-500">Staff administration and audit access remain superadmin-only.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {availablePermissions.map((permission) => (
                    <label key={permission.id} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-700">
                      <input type="checkbox" checked={editPermissions.includes(permission.id)} disabled={(permissionRequiresLeads(permission.id) && !editPermissions.includes('leads')) || (permissionRequiresOrders(permission.id) && !editPermissions.includes('orders'))} onChange={() => togglePermission(editPermissions, permission.id, setEditPermissions)} className="rounded border-slate-300 text-blue-800" />
                      {permission.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <footer className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button type="button" disabled={saving} onClick={closeEditModal} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={saving || !editName.trim() || !editEmail.trim()} className="rounded-lg bg-blue-800 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-50">{saving ? 'Saving…' : 'Save profile'}</button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
};
