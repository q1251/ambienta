import React, { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowLeft, CalendarDays, Clock3, KeyRound, LogIn, Mail, ShoppingBag, Trash2, UserPlus, Users, UserX } from 'lucide-react';

const availablePermissions = [
  { id: 'leads', label: 'Assigned leads' },
  { id: 'new_leads', label: 'View unassigned new leads' },
  { id: 'add_leads', label: 'Add contacts' },
  { id: 'import_leads', label: 'Import contacts (CSV)' },
  { id: 'export_leads', label: 'Export contacts (CSV)' },
  { id: 'orders', label: 'Orders' },
  { id: 'print_orders', label: 'Print orders' },
  { id: 'products', label: 'Products & stock' },
  { id: 'integrations', label: 'Email' },
  { id: 'email_campaigns', label: 'Email campaigns' },
  { id: 'chat', label: 'Live chat' },
] as const;
type StaffPermission = (typeof availablePermissions)[number]['id'];
const permissionRequiresLeads = (permission: StaffPermission) =>
  permission === 'new_leads' || permission === 'add_leads'
  || permission === 'import_leads' || permission === 'export_leads';
const permissionRequiresOrders = (permission: StaffPermission) => permission === 'print_orders';
const permissionRequiresEmail = (permission: StaffPermission) => permission === 'email_campaigns';

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
  presence: {
    online: boolean;
    durationSeconds: number;
    lastSessionDurationSeconds: number;
    sessionStartedAt: string | null;
    lastSeenAt: string | null;
    currentSection: string | null;
  };
  assignedLeads: Array<{
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    status: string;
    createdAt: string;
  }>;
  sentEmails: Array<{
    id: number;
    recipientEmail: string;
    subject: string;
    bodyPreview: string;
    status: string;
    sentAt: string;
  }>;
  activity: Array<{
    id: number | string;
    action: string;
    entityType: string;
    entityId: string;
    details: Record<string, unknown> | null;
    createdAt: string;
    order: {
      orderNumber: string;
      customerName: string;
      totalAmount: number;
      status: string;
    } | null;
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
const demoAgentNames = new Set([
  'Agent One',
  'Agent Two',
  'Agent Three',
  'Agent Four',
  'Agent Five',
  'CRM QA Test Agent',
  'CRM QA Test Agent Updated',
]);

const formatTimestamp = (value: string) => {
  const timestamp = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toLocaleString();
};

const formatActivityAction = (action: string) => {
  const labels: Record<string, string> = {
    'staff.impersonation_started': 'Agent session opened by administrator',
    'staff.impersonation_ended': 'Agent session ended',
    'staff.updated': 'Agent account updated',
    'order.created_manually': 'Order created manually',
    'order.created': 'Order created',
    'order.status_changed': 'Order status changed',
    'order.payment_marked_paid': 'Order marked paid',
    'order.payment_captured': 'Order payment captured',
    'chat.replied': 'Replied to live chat',
    'chat.claimed': 'Claimed a live chat',
    'security.contact_details_blocked': 'Blocked contact-detail attempt',
  };
  return labels[action] || action.replace(/\./g, ' · ').replace(/_/g, ' ');
};

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
  const demoAccounts = accounts.filter((account) => demoAgentNames.has(account.display_name));

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
    if (permissionRequiresEmail(permission) && !current.includes('integrations')) return;
    if (permission === 'leads' && current.includes('leads')) {
      update(current.filter((value) => value !== 'leads' && value !== 'new_leads'
        && value !== 'add_leads' && value !== 'import_leads' && value !== 'export_leads'));
      return;
    }
    if (permission === 'orders' && current.includes('orders')) {
      update(current.filter((value) => value !== 'orders' && value !== 'print_orders'));
      return;
    }
    if (permission === 'integrations' && current.includes('integrations')) {
      update(current.filter((value) => value !== 'integrations' && value !== 'email_campaigns'));
      return;
    }
    update(current.includes(permission) ? current.filter((value) => value !== permission) : [...current, permission]);
  };

  const createAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const formData = new FormData(event.currentTarget);
    const formDisplayName = String(formData.get('displayName') ?? '').trim();
    const formEmail = String(formData.get('email') ?? '').trim();
    const formTemporaryPassword = String(formData.get('temporaryPassword') ?? '');
    setDisplayName(formDisplayName);
    setEmail(formEmail);
    setTemporaryPassword(formTemporaryPassword);
    setSaving(true);
    try {
      const response = await fetch('/api/data.php?resource=staff', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          displayName: formDisplayName,
          email: formEmail,
          temporaryPassword: formTemporaryPassword,
          permissions,
        }),
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

  const removeDemoAccounts = async () => {
    if (demoAccounts.length === 0) return;
    const assignedLeadCount = demoAccounts.reduce((total, account) => total + account.assigned_lead_count, 0);
    const names = demoAccounts.map((account) => account.display_name).join(', ');
    if (!window.confirm(
      `Permanently remove ${demoAccounts.length} demo agent accounts (${names})? Their ${assignedLeadCount} assigned leads will be unassigned. Lead records, email activity, and audit history will be kept; their open chats will return to the shared queue.`
    )) return;

    setError('');
    setMessage('');
    setSaving(true);
    try {
      const response = await fetch('/api/data.php?resource=staff', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids: demoAccounts.map((account) => account.id) }),
      });
      const result = await response.json() as {
        message?: string;
        deleted?: number;
        unassignedLeads?: number;
        returnedChats?: number;
      };
      if (!response.ok || typeof result.deleted !== 'number'
        || typeof result.unassignedLeads !== 'number' || typeof result.returnedChats !== 'number') {
        throw new Error(result.message || 'The demo agent accounts could not be removed.');
      }
      setMessage(
        `Removed ${result.deleted} demo agent accounts. ${result.unassignedLeads} leads are unassigned, and ${result.returnedChats} open chats were returned to the queue. Historical records were retained.`
      );
      await Promise.all([loadAccounts(), loadPresenceAndRouting()]);
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'The demo agent accounts could not be removed.');
    } finally {
      setSaving(false);
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
      if (!response.ok || !result.profile || !Array.isArray(result.profile.assignedLeads)
        || !result.profile.presence || !Array.isArray(result.profile.sentEmails) || !Array.isArray(result.profile.activity)) {
        throw new Error(result.message || 'The agent profile could not be loaded.');
      }
      setSelectedProfile(result.profile);
    } catch (loadError) {
      setProfileError(loadError instanceof Error ? loadError.message : 'The agent profile could not be loaded.');
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    if (profileAccountId === null) return;
    let active = true;
    let failureReported = false;
    const refreshProfile = async () => {
      try {
        const response = await fetch(`/api/data.php?resource=staff&id=${encodeURIComponent(String(profileAccountId))}`, {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        });
        const result = await response.json() as { profile?: AgentProfile; message?: string };
        if (!response.ok || !result.profile || !Array.isArray(result.profile.assignedLeads)
          || !result.profile.presence || !Array.isArray(result.profile.sentEmails) || !Array.isArray(result.profile.activity)) {
          throw new Error(result.message || 'The agent profile could not be refreshed.');
        }
        if (!active) return;
        setSelectedProfile(result.profile);
        setProfileError('');
        failureReported = false;
      } catch (loadError) {
        if (!active) return;
        setProfileError(loadError instanceof Error ? loadError.message : 'The agent profile could not be refreshed.');
        if (!failureReported) {
          console.error('Ambienta CRM agent profile could not be refreshed.', loadError);
          failureReported = true;
        }
      }
    };
    const timer = window.setInterval(() => void refreshProfile(), 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [profileAccountId]);

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
    <div className={profileAccountId === null
      ? 'space-y-6'
      : 'flex h-[calc(100dvh-11rem)] min-h-0 flex-col sm:h-[calc(100dvh-8rem)]'
    }>
      {profileAccountId === null && <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-800">Access control</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Agent management</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">Create accounts and select an agent to view their profile, manage access, update credentials, or enter their workspace.</p>
        </div>
      </header>}

      {(profileAccountId === null || editingId === null) && error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</p>}
      {(profileAccountId === null || editingId === null) && message && <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">{message}</p>}

      {profileAccountId !== null ? (
        <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pr-1">
          <button type="button" onClick={() => { setProfileAccountId(null); setSelectedProfile(null); setProfileError(''); setEditingId(null); setResetPasswordReveal(null); }} className="sticky top-0 z-10 inline-flex w-fit shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />Back to agents
          </button>
          {profileLoading && <p role="status" className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">Loading agent profile…</p>}
          {profileError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{profileError}</p>}
          {selectedProfile && (
            <>
              <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-800">Agent profile</p>
                  <h2 className="mt-0.5 text-xl font-semibold tracking-tight text-slate-950">{selectedProfile.display_name || selectedProfile.email}</h2>
                  <p className="mt-0.5 text-xs text-slate-600">{selectedProfile.email} · {selectedProfile.is_active ? 'Active' : 'Inactive'} agent</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedProfile.is_active && <button type="button" disabled={saving} onClick={() => void enterAccount(selectedProfile)} className="inline-flex items-center gap-1 rounded-lg bg-violet-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-800 disabled:opacity-50"><LogIn className="h-3.5 w-3.5" />Enter</button>}
                  <button type="button" disabled={saving} onClick={() => void updateAccount(selectedProfile, { resetPassword: true }, 'A new one-time password was generated.')} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><KeyRound className="h-3.5 w-3.5" />Reset password</button>
                  <button type="button" disabled={saving} onClick={() => void updateAccount(selectedProfile, { isActive: !selectedProfile.is_active }, `Agent ${selectedProfile.is_active ? 'deactivated' : 'activated'}.`)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><UserX className="h-3.5 w-3.5" />{selectedProfile.is_active ? 'Deactivate' : 'Activate'}</button>
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

              <section className="grid shrink-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current status</p>
                  <p className="mt-2 flex items-center gap-2 text-lg font-semibold text-slate-900">
                    <span className={`h-2.5 w-2.5 rounded-full ${selectedProfile.presence.online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    {selectedProfile.presence.online ? 'Online' : selectedProfile.is_active ? 'Offline' : 'Inactive'}
                  </p>
                  {selectedProfile.presence.online && selectedProfile.presence.currentSection
                    && <p className="mt-1 text-sm capitalize text-slate-500">Currently in {selectedProfile.presence.currentSection}</p>}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{selectedProfile.presence.online ? 'Online duration' : 'Last session length'}</p>
                  <p className="mt-2 flex items-center gap-2 text-lg font-semibold text-slate-900">
                    <Clock3 className="h-4 w-4 text-blue-800" />
                    {formatDuration(selectedProfile.presence.online
                      ? selectedProfile.presence.durationSeconds
                      : selectedProfile.presence.lastSessionDurationSeconds)}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {selectedProfile.presence.online && selectedProfile.presence.sessionStartedAt
                      ? `Since ${formatTimestamp(selectedProfile.presence.sessionStartedAt)}`
                      : selectedProfile.presence.lastSeenAt
                        ? `Last active ${formatTimestamp(selectedProfile.presence.lastSeenAt)}`
                        : 'No authenticated session recorded'}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sent emails</p>
                  <p className="mt-2 flex items-center gap-2 text-lg font-semibold text-slate-900">
                    <Mail className="h-4 w-4 text-blue-800" />{selectedProfile.sentEmails.length}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">Latest 500 tracked messages</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recorded actions</p>
                  <p className="mt-2 flex items-center gap-2 text-lg font-semibold text-slate-900">
                    <Activity className="h-4 w-4 text-blue-800" />{selectedProfile.activity.length}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">Latest 500 activity events</p>
                </div>
              </section>

              <>
                  <section className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
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
                  <div className="grid shrink-0 gap-3 md:grid-cols-2">
                    <section className="rounded-xl border border-slate-200 bg-white p-3">
                      <h3 className="font-semibold text-slate-900">Account history</h3>
                      <p className="mt-3 flex items-center gap-2 text-sm text-slate-700"><CalendarDays className="h-4 w-4 text-blue-800" />Created {formatTimestamp(selectedProfile.created_at)}</p>
                      <p className="mt-2 text-sm text-slate-600">Created by {selectedProfile.created_by}</p>
                      <p className="mt-1 text-sm text-slate-600">Last updated {formatTimestamp(selectedProfile.updated_at)}</p>
                    </section>
                    <section className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-semibold text-slate-900">Assigned leads</h3>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{selectedProfile.assignedLeads.length}</span>
                      </div>
                      {selectedProfile.assignedLeads.length ? (
                        <div className="mt-2 max-h-[min(28vh,18rem)] divide-y divide-slate-100 overflow-y-auto overscroll-contain pr-1">
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

                  <section className="shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">Emails sent</h3>
                        <p className="mt-1 text-sm text-slate-600">Direct messages and campaign deliveries attributed to this agent.</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{selectedProfile.sentEmails.length}</span>
                    </div>
                    {selectedProfile.sentEmails.length ? (
                      <div className="max-h-[min(34vh,24rem)] divide-y divide-slate-100 overflow-y-auto overscroll-contain">
                        {selectedProfile.sentEmails.map((email) => (
                          <article key={email.id} className="px-4 py-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-900">{email.subject || '(no subject)'}</p>
                                <p className="mt-1 break-all text-xs text-slate-600">To: {email.recipientEmail}</p>
                              </div>
                              <div className="shrink-0 text-right">
                                <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${email.status === 'Sent' ? 'bg-emerald-50 text-emerald-800' : email.status === 'Failed' ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'}`}>{email.status}</span>
                                <p className="mt-1 text-xs text-slate-500">{formatTimestamp(email.sentAt)}</p>
                              </div>
                            </div>
                            {email.bodyPreview && <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-600">{email.bodyPreview}{email.bodyPreview.length >= 360 ? '…' : ''}</p>}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="px-5 py-6 text-sm text-slate-500">No sent emails have been attributed to this agent yet. Email activity tracking begins with messages sent after this update.</p>
                    )}
                  </section>

                  <div className="grid shrink-0 gap-3 lg:grid-cols-2">
                    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                        <div>
                          <h3 className="font-semibold text-slate-900">Orders handled</h3>
                          <p className="mt-1 text-sm text-slate-600">Order actions recorded under this agent’s account.</p>
                        </div>
                        <ShoppingBag className="h-5 w-5 text-slate-500" />
                      </div>
                      {selectedProfile.activity.filter((item) => item.entityType === 'order').length ? (
                        <div className="max-h-[min(34vh,24rem)] divide-y divide-slate-100 overflow-y-auto overscroll-contain">
                          {selectedProfile.activity.filter((item) => item.entityType === 'order').map((item) => (
                            <article key={item.id} className="px-4 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{item.order?.orderNumber || `Order ${item.entityId}`}</p>
                                  <p className="mt-1 text-xs text-slate-600">{formatActivityAction(item.action)}{item.order ? ` · ${item.order.customerName}` : ''}</p>
                                  {item.order && <p className="mt-1 text-xs text-slate-500">{item.order.status} · ${item.order.totalAmount.toFixed(2)}</p>}
                                </div>
                                <time className="shrink-0 text-right text-xs text-slate-500">{formatTimestamp(item.createdAt)}</time>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : <p className="px-5 py-6 text-sm text-slate-500">No order actions have been recorded for this agent.</p>}
                    </section>

                    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                        <div>
                          <h3 className="font-semibold text-slate-900">Action history</h3>
                          <p className="mt-1 text-sm text-slate-600">Account, lead, chat, and other audited activity.</p>
                        </div>
                        <Activity className="h-5 w-5 text-slate-500" />
                      </div>
                      {selectedProfile.activity.length ? (
                        <div className="max-h-[min(34vh,24rem)] divide-y divide-slate-100 overflow-y-auto overscroll-contain">
                          {selectedProfile.activity.map((item) => (
                            <article key={`${item.entityType}-${item.id}`} className="px-4 py-3">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold capitalize text-slate-900">{formatActivityAction(item.action)}</p>
                                  {item.entityType === 'lead' && <p className="mt-1 text-xs text-slate-600">Lead record · {item.entityId}</p>}
                                  {item.order && <p className="mt-1 text-xs text-slate-600">{item.order.orderNumber} · {item.order.status}</p>}
                                </div>
                                <time className="shrink-0 text-right text-xs text-slate-500">{formatTimestamp(item.createdAt)}</time>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : <p className="px-5 py-6 text-sm text-slate-500">No audited actions have been recorded for this agent.</p>}
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-slate-500" />
            <h2 className="font-semibold text-slate-900">Agents ({accounts.length})</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {demoAccounts.length > 0 && (
              <button type="button" disabled={saving} onClick={() => void removeDemoAccounts()} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50">
                <Trash2 className="h-4 w-4" />Remove demo accounts ({demoAccounts.length})
              </button>
            )}
            <button type="button" onClick={() => { setError(''); setCreateModalOpen(true); }} className="inline-flex items-center gap-2 rounded-xl bg-blue-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-900">
              <UserPlus className="h-4 w-4" />Create agent
            </button>
          </div>
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
                  <input required name="displayName" autoFocus maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" />
                </label>
                <label className="block text-sm font-medium text-slate-700">Sign-in email
                  <input required name="email" type="email" autoComplete="off" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" />
                </label>
              </div>
              <label className="block text-sm font-medium text-slate-700">Temporary password
                <input required name="temporaryPassword" type="password" minLength={12} maxLength={1024} autoComplete="new-password" value={temporaryPassword} onChange={(event) => setTemporaryPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" />
                <span className="mt-1 block text-xs font-normal text-slate-500">Use at least 12 characters. The agent will be asked to change it at first sign-in.</span>
              </label>
              <fieldset>
                <legend className="text-sm font-semibold text-slate-800">Operational permissions</legend>
                <p className="mt-1 text-xs text-slate-500">Staff administration and audit access remain superadmin-only.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {availablePermissions.map((permission) => (
                    <label key={permission.id} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-700">
                      <input type="checkbox" checked={permissions.includes(permission.id)} disabled={(permissionRequiresLeads(permission.id) && !permissions.includes('leads')) || (permissionRequiresOrders(permission.id) && !permissions.includes('orders')) || (permissionRequiresEmail(permission.id) && !permissions.includes('integrations'))} onChange={() => togglePermission(permissions, permission.id, setPermissions)} className="rounded border-slate-300 text-blue-800" />
                      {permission.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="text-xs leading-5 text-slate-500">The password is stored as a secure hash, and the agent will be required to change it at first sign-in. Share the temporary password out-of-band.</p>
              <footer className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button type="button" disabled={saving} onClick={() => setCreateModalOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={saving} className="rounded-lg bg-blue-800 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-50">{saving ? 'Creating…' : 'Create agent'}</button>
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
                      <input type="checkbox" checked={editPermissions.includes(permission.id)} disabled={(permissionRequiresLeads(permission.id) && !editPermissions.includes('leads')) || (permissionRequiresOrders(permission.id) && !editPermissions.includes('orders')) || (permissionRequiresEmail(permission.id) && !editPermissions.includes('integrations'))} onChange={() => togglePermission(editPermissions, permission.id, setEditPermissions)} className="rounded border-slate-300 text-blue-800" />
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
