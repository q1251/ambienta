import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, Copy, Download, Mail, MessageSquare, Package, Pencil, Phone, Search, Send, Upload, UserPlus, X } from 'lucide-react';
import { ContactLead, ContactLeadInput, ContactLeadUpdate, LeadActivityInput, LeadProfile, LeadStatus } from '../../types/pharmacy';
import { generateSampleCsv, getLeadCountry, parseLeadsCsv } from '../../utils/pharmacyLogic';
import { CountryFlag, CountrySelect, PhoneCountryInput } from './PhoneCountryInput';
import { getLeadCountryCode } from '../../utils/countryOptions';

type NewLead = ContactLeadInput;

interface ContactLeadManagerProps {
  role?: 'admin' | 'operator';
  canSendEmail?: boolean;
  leads: ContactLead[];
  dataError?: string;
  onOpenEmailCampaigns?: () => void;
  onSaveLeads: (leads: NewLead[]) => Promise<void>;
  onLoadLeadProfile?: (leadId: number) => Promise<LeadProfile>;
  onUpdateLead?: (leadId: number, update: ContactLeadUpdate) => Promise<ContactLead>;
  onAddLeadActivity?: (leadId: number, activity: LeadActivityInput) => Promise<LeadProfile['activities'][number]>;
}

interface AgentOption {
  id: number;
  email: string;
  display_name: string;
  is_active: boolean;
  permissions: string[];
}

export const ContactLeadManager: React.FC<ContactLeadManagerProps> = ({
  role,
  canSendEmail = false,
  leads,
  dataError,
  onOpenEmailCampaigns,
  onSaveLeads,
  onLoadLeadProfile,
  onUpdateLead,
  onAddLeadActivity,
}) => {
  const [mode, setMode] = useState<'csv' | 'manual' | null>(null);
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<NewLead[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [requestError, setRequestError] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [profileFirstName, setProfileFirstName] = useState('');
  const [profileLastName, setProfileLastName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileCountry, setProfileCountry] = useState('');
  const [editingLead, setEditingLead] = useState<ContactLead | null>(null);
  const [editLeadError, setEditLeadError] = useState('');
  const [editLeadSaving, setEditLeadSaving] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<'All' | LeadStatus>('All');
  const [leadTab, setLeadTab] = useState<'all' | 'uncalled_repeat_buyers'>('all');
  const [profile, setProfile] = useState<LeadProfile | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(() => {
    const value = Number(new URLSearchParams(window.location.search).get('leadId'));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  });
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [profileSaving, setProfileSaving] = useState(false);
  const [contactDetailsEditing, setContactDetailsEditing] = useState(false);
  const [activityNote, setActivityNote] = useState('');
  const [activitySaving, setActivitySaving] = useState(false);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailComposerOpen, setEmailComposerOpen] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [copiedField, setCopiedField] = useState('');
  const profileRequestId = useRef(0);
  const initialProfileLoadStarted = useRef(false);
  const isSuperadmin = role === 'admin';
  const canEditSelectedLead = isSuperadmin || profile?.lead.assignedStaffId != null;
  useEffect(() => {
    if (!isSuperadmin) return;
    let active = true;
    fetch('/api/data.php?resource=staff', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    }).then(async (response) => {
      const result = await response.json() as { staff?: AgentOption[]; message?: string };
      if (!response.ok || !Array.isArray(result.staff)) {
        throw new Error(result.message || 'Agent accounts could not be loaded for lead assignment.');
      }
      if (active) setAgents(result.staff.filter((agent) => agent.is_active && agent.permissions.includes('leads')));
    }).catch((error: unknown) => {
      if (active) setRequestError(error instanceof Error ? error.message : 'Agent accounts could not be loaded for lead assignment.');
    });
    return () => { active = false; };
  }, [isSuperadmin]);

  const assignLead = async (lead: ContactLead, value: string) => {
    if (!onUpdateLead) return;
    setRequestError('');
    try {
      await onUpdateLead(lead.id, { assignedStaffId: value ? Number(value) : null });
      setSuccess(`Lead assignment updated for ${lead.firstName} ${lead.lastName}.`);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'The lead assignment could not be saved.');
    }
  };
  useEffect(() => {
    if (!mode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setMode(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, saving]);
  useEffect(() => {
    if (!editingLead) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !editLeadSaving) setEditingLead(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingLead, editLeadSaving]);
  const eligibleCount = leads.filter((lead) => lead.marketingConsent).length;
  const isUncalledRepeatBuyer = (lead: ContactLead) => (lead.callCount ?? 0) === 0 && (lead.activeOrderCount ?? 0) >= 2;
  const uncalledRepeatBuyers = leads.filter(isUncalledRepeatBuyer);
  const filteredLeads = leads.filter((lead) => {
    const matchesStage = stageFilter === 'All' || lead.status === stageFilter;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${lead.firstName} ${lead.lastName} ${lead.email} ${lead.phone}`.toLowerCase().includes(query);
    const matchesTab = leadTab === 'all' || isUncalledRepeatBuyer(lead);
    return matchesStage && matchesSearch && matchesTab;
  });

  const parse = (value: string) => {
    setCsv(value);
    const result = parseLeadsCsv(value);
    setPreview(result.leads);
    setErrors(result.errors);
    setRequestError('');
  };

  const save = async (rows: NewLead[]) => {
    setSaving(true);
    setRequestError('');
    setSuccess('');
    try {
      await onSaveLeads(rows);
      setSuccess(`Saved ${rows.length} contact lead${rows.length === 1 ? '' : 's'}.`);
      setPreview([]);
      setCsv('');
      setFirstName('');
      setLastName('');
      setEmail('');
      setPhone('');
      setCountry('');
      setMarketingConsent(false);
      setMode(null);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Unable to save contact leads.');
    } finally {
      setSaving(false);
    }
  };

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => parse(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => setRequestError('The selected CSV file could not be read.');
    reader.readAsText(file);
    event.target.value = '';
  };

  const downloadSample = () => {
    const url = URL.createObjectURL(new Blob([generateSampleCsv()], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ambients-contact-leads.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadContacts = () => {
    const escapeCsv = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = [
      ['first_name', 'last_name', 'email', 'phone', 'country', 'lead_source', 'status', 'marketing_consent', 'created_at'],
      ...leads.map((lead) => [
        lead.firstName,
        lead.lastName,
        lead.email,
        lead.phone,
        lead.country || getLeadCountry(lead.phone),
        lead.leadSource,
        lead.status,
        lead.marketingConsent ? 'yes' : 'no',
        lead.createdAt,
      ]),
    ];
    const contents = rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ambients-contacts.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleManualSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void save([{
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      country: country.trim() || getLeadCountry(phone),
      leadSource: 'Manual Entry',
      status: 'Cold',
      marketingConsent,
    }]);
  };

  const openProfile = async (lead: ContactLead, beginEditing = false) => {
    if (!onLoadLeadProfile) return;
    const requestId = ++profileRequestId.current;
    const url = new URL(window.location.href);
    url.searchParams.set('leadId', String(lead.id));
    window.history.replaceState(window.history.state, '', url);
    setSelectedLeadId(lead.id);
    setProfile(null);
    setProfileError('');
    setProfileSaving(false);
    setContactDetailsEditing(beginEditing);
    setActivitySaving(false);
    setActivityNote('');
    setEmailSubject('');
    setEmailBody('');
    setProfileLoading(true);
    try {
      const loadedProfile = await onLoadLeadProfile(lead.id);
      if (requestId === profileRequestId.current) {
        setProfile(loadedProfile);
        setProfileFirstName(loadedProfile.lead.firstName);
        setProfileLastName(loadedProfile.lead.lastName);
        setProfileEmail(loadedProfile.lead.email);
        setProfilePhone(loadedProfile.lead.phone);
        setProfileCountry(loadedProfile.lead.country || getLeadCountry(loadedProfile.lead.phone));
      }
    } catch (error) {
      if (requestId === profileRequestId.current) {
        setProfileError(error instanceof Error ? error.message : 'The contact profile could not be loaded.');
      }
    } finally {
      if (requestId === profileRequestId.current) setProfileLoading(false);
    }
  };

  React.useEffect(() => {
    if (initialProfileLoadStarted.current || selectedLeadId === null || profile || profileLoading || !onLoadLeadProfile) return;
    const lead = leads.find((item) => item.id === selectedLeadId);
    if (!lead) return;
    initialProfileLoadStarted.current = true;
    void openProfile(lead);
  }, [selectedLeadId, profile, profileLoading, leads, onLoadLeadProfile]);

  const closeProfile = () => {
    profileRequestId.current += 1;
    const url = new URL(window.location.href);
    url.searchParams.delete('leadId');
    window.history.replaceState(window.history.state, '', url);
    setSelectedLeadId(null);
    setProfile(null);
    setProfileError('');
    setContactDetailsEditing(false);
    setProfileLoading(false);
    setProfileSaving(false);
    setActivitySaving(false);
  };

  const updateProfile = async (update: ContactLeadUpdate): Promise<boolean> => {
    if (!profile || !canEditSelectedLead || !onUpdateLead) return false;
    const requestId = profileRequestId.current;
    const leadId = profile.lead.id;
    setProfileSaving(true);
    setProfileError('');
    try {
      const lead = await onUpdateLead(leadId, update);
      if (requestId !== profileRequestId.current) return false;
      setProfile((current) => current?.lead.id === leadId ? { ...current, lead } : current);
      if (update.firstName !== undefined) setProfileFirstName(lead.firstName);
      if (update.lastName !== undefined) setProfileLastName(lead.lastName);
      if (update.email !== undefined) setProfileEmail(lead.email);
      if (update.phone !== undefined) setProfilePhone(lead.phone);
      if (update.country !== undefined) setProfileCountry(lead.country || '');
      if ((update.firstName !== undefined || update.lastName !== undefined || update.email !== undefined || update.status !== undefined || update.phone !== undefined || update.country !== undefined) && onLoadLeadProfile) {
        try {
          const refreshed = await onLoadLeadProfile(lead.id);
          if (requestId === profileRequestId.current) setProfile(refreshed);
        } catch (error) {
          if (requestId !== profileRequestId.current) return false;
          const reason = error instanceof Error ? ` ${error.message}` : '';
          setProfileError(`The change was saved, but the activity timeline could not be refreshed. Reload the profile to see the latest history.${reason}`);
        }
      }
      return true;
    } catch (error) {
      if (requestId !== profileRequestId.current) return false;
      setProfileError(error instanceof Error ? error.message : 'The contact profile could not be updated.');
      return false;
    } finally {
      if (requestId === profileRequestId.current) setProfileSaving(false);
    }
  };

  const saveContactDetails = (event: React.FormEvent) => {
    event.preventDefault();
    void updateProfile({
      firstName: profileFirstName.trim(),
      lastName: profileLastName.trim(),
      email: profileEmail.trim(),
      phone: profilePhone.trim(),
      country: profileCountry.trim(),
    }).then((saved) => {
      if (saved) setContactDetailsEditing(false);
    });
  };

  const openLeadEditor = (lead: ContactLead) => {
    setEditingLead(lead);
    setProfileFirstName(lead.firstName);
    setProfileLastName(lead.lastName);
    setProfileEmail(lead.email);
    setProfilePhone(lead.phone);
    setProfileCountry(lead.country || getLeadCountry(lead.phone));
    setEditLeadError('');
  };

  const saveLeadFromTable = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingLead || !onUpdateLead) return;
    setEditLeadSaving(true);
    setEditLeadError('');
    try {
      await onUpdateLead(editingLead.id, {
        firstName: profileFirstName.trim(),
        lastName: profileLastName.trim(),
        email: profileEmail.trim(),
        phone: profilePhone.trim(),
        country: profileCountry.trim(),
      });
      setEditingLead(null);
      setSuccess('Lead contact details saved.');
    } catch (error) {
      setEditLeadError(error instanceof Error ? error.message : 'The contact details could not be saved.');
    } finally {
      setEditLeadSaving(false);
    }
  };

  const cancelContactDetailsEdit = () => {
    if (!profile) return;
    setProfileFirstName(profile.lead.firstName);
    setProfileLastName(profile.lead.lastName);
    setProfileEmail(profile.lead.email);
    setProfilePhone(profile.lead.phone);
    setProfileCountry(profile.lead.country || getLeadCountry(profile.lead.phone));
    setContactDetailsEditing(false);
  };

  const saveActivity = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || !canEditSelectedLead || !onAddLeadActivity) return;
    const requestId = profileRequestId.current;
    const leadId = profile.lead.id;
    setActivitySaving(true);
    setProfileError('');
    try {
      const saved = await onAddLeadActivity(leadId, {
        type: 'note',
        note: activityNote.trim(),
      });
      if (requestId !== profileRequestId.current) return;
      setProfile((current) => current?.lead.id === leadId ? { ...current, activities: [saved, ...current.activities] } : current);
      setActivityNote('');
    } catch (error) {
      if (requestId !== profileRequestId.current) return;
      setProfileError(error instanceof Error ? error.message : 'The activity could not be saved.');
    } finally {
      if (requestId === profileRequestId.current) setActivitySaving(false);
    }
  };

  const statusActivities = profile?.activities.filter((activity) => activity.type === 'status_change') ?? [];
  const noteActivities = profile?.activities.filter((activity) => activity.type === 'note') ?? [];

  const phoneLink = (value: string) => value.replace(/[^\d+]/g, '');

  const copyLeadValue = async (event: React.MouseEvent<HTMLButtonElement>, leadId: number, field: 'name' | 'email' | 'phone', value: string) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(`${leadId}-${field}`);
      window.setTimeout(() => setCopiedField((current) => current === `${leadId}-${field}` ? '' : current), 1600);
    } catch (error) {
      setRequestError(error instanceof Error ? `Could not copy ${field}: ${error.message}` : `Could not copy ${field}.`);
    }
  };

  const copyButton = (lead: ContactLead, field: 'name' | 'email' | 'phone', value: string) => {
    const key = `${lead.id}-${field}`;
    const copied = copiedField === key;
    return (
      <button
        type="button"
        onClick={(event) => void copyLeadValue(event, lead.id, field, value)}
        aria-label={`${copied ? 'Copied' : 'Copy'} ${field} for ${lead.firstName} ${lead.lastName}`}
        title={copied ? 'Copied' : `Copy ${field}`}
        className="ml-1 inline-flex shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    );
  };

  const sendLeadEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || !canSendEmail) return;
    setEmailError('');
    setEmailSending(true);
    try {
      const response = await fetch('/api/data.php?resource=email-send', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientEmail: profile.lead.email,
          subject: emailSubject.trim(),
          body: emailBody.trim(),
        }),
      });
      const result = await response.json() as { sent?: boolean; message?: string };
      if (!response.ok || result.sent !== true) {
        throw new Error(result.message || 'The email could not be sent through Hostinger.');
      }
      setEmailComposerOpen(false);
      setEmailSubject('');
      setEmailBody('');
      setSuccess(result.message || 'Hostinger accepted the email for sending.');
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : 'The email could not be sent through Hostinger.');
    } finally {
      setEmailSending(false);
    }
  };

  if (selectedLeadId !== null) {
    const selectedLead = leads.find((lead) => lead.id === selectedLeadId);
    return (
      <section className="space-y-6">
        <button
          type="button"
          onClick={closeProfile}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" /> Back to contact leads
        </button>

        <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">Lead profile</p>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-950">
                {profile ? `${profile.lead.firstName} ${profile.lead.lastName}` : selectedLead ? `${selectedLead.firstName} ${selectedLead.lastName}` : 'Lead profile'}
              </h2>
              <a className="mt-1 inline-block break-all text-sm text-teal-800 hover:underline" href={`mailto:${profile?.lead.email || selectedLead?.email || ''}`}>
                {profile?.lead.email || selectedLead?.email}
              </a>
            </div>
            {profile && <span className="rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-900">{profile.lead.status}</span>}
          </div>
        </header>

        {profileLoading && <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">Loading contact profile and order history…</p>}
        {profileError && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <p>{profileError}</p>
            {selectedLead && <button type="button" onClick={() => void openProfile(selectedLead)} className="mt-2 font-semibold underline">Try again</button>}
          </div>
        )}

        {profile && (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-bold text-slate-900">Contact details</h3>
                <button
                  type="button"
                  aria-expanded={contactDetailsEditing}
                  disabled={!isSuperadmin}
                  title={isSuperadmin ? undefined : 'Only a superadmin can edit contact details.'}
                  onClick={() => contactDetailsEditing ? cancelContactDetailsEdit() : setContactDetailsEditing(true)}
                  className="inline-flex items-center gap-2 rounded-md border border-teal-700 px-3 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-500 disabled:hover:bg-white"
                >
                  {contactDetailsEditing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                  {isSuperadmin
                    ? contactDetailsEditing ? 'Cancel editing' : 'Edit contact details'
                    : 'Edit contact details (admin only)'}
                </button>
              </div>
              <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <div><p className="text-xs font-medium uppercase text-slate-500">Email</p><p className="mt-1 break-all text-sm text-slate-900">{profile.lead.email}</p></div>
                <div>
                  <p className="text-xs font-medium uppercase text-slate-500">Phone</p>
                  {profile.lead.phone
                    ? <a href={`tel:${phoneLink(profile.lead.phone)}`} className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-800 hover:underline"><Phone className="h-4 w-4" />{profile.lead.phone}</a>
                    : <p className="mt-1 text-sm text-slate-500">No phone number saved</p>}
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-slate-500">Country</p>
                  <p className="mt-1 text-sm text-slate-900">{profile.lead.country || getLeadCountry(profile.lead.phone)}</p>
                </div>
                <div><p className="text-xs font-medium uppercase text-slate-500">Source</p><p className="mt-1 text-sm text-slate-900">{profile.lead.leadSource}</p></div>
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase text-slate-500">Added</p>
                      <p className="mt-1 text-sm text-slate-900">{new Date(profile.lead.createdAt).toLocaleDateString()}</p>
                    </div>
                    <button type="button" disabled={!canEditSelectedLead || !canSendEmail} title={!canEditSelectedLead ? 'Assign this new lead before contacting them from the CRM.' : !canSendEmail ? 'Your account does not have permission to send email.' : undefined} onClick={() => { setEmailError(''); setEmailComposerOpen(true); }} className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-teal-800 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline">
                      <Mail className="h-4 w-4" /> Compose email
                    </button>
                  </div>
                </div>
              </div>
              {isSuperadmin && contactDetailsEditing && (
                <form onSubmit={saveContactDetails} className="mt-5 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
                  <label className="text-sm font-medium text-slate-700">First name<input required maxLength={100} value={profileFirstName} onChange={(event) => setProfileFirstName(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label>
                  <label className="text-sm font-medium text-slate-700">Last name<input required maxLength={100} value={profileLastName} onChange={(event) => setProfileLastName(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label>
                  <label className="text-sm font-medium text-slate-700">Email<input required type="email" maxLength={254} value={profileEmail} onChange={(event) => setProfileEmail(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label>
                  <label className="block text-sm font-medium text-slate-700">Phone<span className="mt-1 block"><PhoneCountryInput value={profilePhone} onChange={setProfilePhone} disabled={profileSaving} /></span></label>
                  <label className="block text-sm font-medium text-slate-700">Country<span className="mt-1 block"><CountrySelect value={profileCountry} onChange={setProfileCountry} disabled={profileSaving} /></span></label>
                  <div className="flex items-end sm:col-span-2">
                    <button type="submit" disabled={profileSaving || !onUpdateLead} className="rounded-md bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                      {profileSaving ? 'Saving contact details…' : 'Save contact details'}
                    </button>
                    <button type="button" disabled={profileSaving} onClick={cancelContactDetailsEdit} className="ml-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              <div className="mt-5 grid items-start gap-5 border-t border-slate-100 pt-5 lg:grid-cols-2">
                <div>
                  <form onSubmit={(event) => void saveActivity(event)} className="space-y-3">
                  <label className="block text-sm font-medium text-slate-700">Add an internal comment
                    <textarea required maxLength={2000} rows={3} value={activityNote} onChange={(event) => setActivityNote(event.target.value)} disabled={!canEditSelectedLead} placeholder={canEditSelectedLead ? 'Add an internal comment. Do not enter health, prescription, payment, or other sensitive information.' : 'Unassigned new leads are view-only until the administrator assigns them.'} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 disabled:bg-slate-50" />
                  </label>
                  <button type="submit" disabled={!canEditSelectedLead || activitySaving || !onAddLeadActivity || !activityNote.trim()} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    <MessageSquare className="h-4 w-4" />
                    {activitySaving ? 'Saving…' : 'Add comment'}
                  </button>
                  </form>
                  <div className="mt-6">
                    <h4 className="mb-3 text-sm font-bold text-slate-900">Comment history</h4>
                    {noteActivities.length ? (
                      <ol className="space-y-3">
                        {noteActivities.map((activity) => (
                          <li key={activity.id} className="border-l-2 border-slate-200 pl-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-900">Comment added</p>
                              <time className="text-xs text-slate-500">{new Date(activity.createdAt).toLocaleString()}</time>
                            </div>
                            <p className="mt-1 text-xs text-slate-600">By {activity.actorName || activity.actorEmail}</p>
                            {activity.note && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{activity.note}</p>}
                          </li>
                        ))}
                      </ol>
                    ) : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No comments have been recorded yet.</p>}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="block text-sm font-medium text-slate-700">Status
                    <select
                      disabled={!canEditSelectedLead || profileSaving || !onUpdateLead}
                      value={profile.lead.status}
                      onChange={(event) => void updateProfile({ status: event.target.value as LeadStatus })}
                      className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"
                    >
                      {(['New', 'Cold', 'Contacted', 'Qualified', 'Customer', 'Inactive'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </label>
                  <p aria-live="polite" className="text-xs text-slate-500">{!canEditSelectedLead ? 'Unassigned new leads are view-only until the administrator assigns them.' : profileSaving ? 'Saving stage…' : 'Stage changes save immediately and are added to the staff history below.'}</p>
                  <div className="pt-3">
                    <h4 className="mb-3 text-sm font-bold text-slate-900">Status history</h4>
                    {statusActivities.length ? (
                      <ol className="space-y-3">
                        {statusActivities.map((activity) => (
                          <li key={activity.id} className="border-l-2 border-teal-200 pl-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-900">Stage changed: {activity.fromStatus || 'Unknown'} → {activity.toStatus || 'Unknown'}</p>
                              <time className="text-xs text-slate-500">{new Date(activity.createdAt).toLocaleString()}</time>
                            </div>
                            <p className="mt-1 text-xs text-slate-600">By {activity.actorName || activity.actorEmail}</p>
                            {activity.note && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{activity.note}</p>}
                          </li>
                        ))}
                      </ol>
                    ) : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No stage changes have been recorded yet.</p>}
                  </div>
                </div>

                <label className="flex items-start gap-2 border-t border-slate-100 pt-4 text-sm text-slate-700 lg:col-span-2">
                  <input type="checkbox" disabled={!canEditSelectedLead || profileSaving || !onUpdateLead} checked={profile.lead.marketingConsent} onChange={(event) => void updateProfile({ marketingConsent: event.target.checked })} className="mt-1" />
                  <span><span className="font-medium">Explicit marketing opt-in recorded.</span> Only mark this when the contact has actually consented to marketing email.</span>
                </label>
              </div>
            </section>

            {emailComposerOpen && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="lead-email-title">
                <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
                  <div className="flex items-start justify-between border-b border-slate-200 p-5">
                    <div>
                      <h3 id="lead-email-title" className="flex items-center gap-2 text-lg font-bold text-slate-900"><Mail className="h-5 w-5 text-teal-800" />Compose email</h3>
                      <p className="mt-1 text-sm text-slate-600">Send through the connected Hostinger account. The message will be logged in CRM email activity.</p>
                    </div>
                    <button type="button" disabled={emailSending} onClick={() => setEmailComposerOpen(false)} aria-label="Close email composer" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X className="h-5 w-5" /></button>
                  </div>
                  <form onSubmit={(event) => void sendLeadEmail(event)} className="space-y-4 p-5">
                    <label className="block text-sm font-medium text-slate-700">To
                      <input type="email" readOnly value={profile.lead.email} className="mt-1 block w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-slate-600" />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">Subject
                      <input required maxLength={180} value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" />
                    </label>
                    <label className="block text-sm font-medium text-slate-700">Message
                      <textarea required maxLength={10000} rows={7} value={emailBody} onChange={(event) => setEmailBody(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" />
                    </label>
                    {!profile.lead.marketingConsent && (
                      <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        This contact has not opted in to marketing. Do not use this composer for promotional outreach unless valid consent is recorded.
                      </p>
                    )}
                    {emailError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{emailError}</p>}
                    <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                      <button type="button" disabled={emailSending} onClick={() => setEmailComposerOpen(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                      <button type="submit" disabled={emailSending || !emailSubject.trim() || !emailBody.trim()} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                        <Send className="h-4 w-4" /> {emailSending ? 'Sending…' : 'Send via Hostinger'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-bold text-slate-900"><Package className="h-4 w-4 text-teal-800" />Orders and tracking</h3>
                  <p className="mt-1 text-sm text-slate-600">{profile.lead.orderCount || 0} order{profile.lead.orderCount === 1 ? '' : 's'} linked to this email</p>
                </div>
                {profile.lead.lastOrderAt && <p className="text-xs text-slate-500">Last order {new Date(profile.lead.lastOrderAt).toLocaleDateString()}</p>}
              </div>
              {profile.orders.length ? (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600"><tr><th className="px-3 py-2">Order</th><th className="px-3 py-2">Placed</th><th className="px-3 py-2">Items</th><th className="px-3 py-2">Total</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Tracking</th></tr></thead>
                    <tbody>{profile.orders.map((order) => (
                      <tr key={order.id} className="border-t border-slate-100">
                        <td className="px-3 py-3 font-medium">{order.orderNumber}</td>
                        <td className="px-3 py-3">{new Date(order.placedAt).toLocaleDateString()}</td>
                        <td className="px-3 py-3">{order.medicationName}</td>
                        <td className="px-3 py-3">${order.totalAmount.toFixed(2)}</td>
                        <td className="px-3 py-3">{order.status}</td>
                        <td className="px-3 py-3">{order.trackingNumber ? `${order.carrier || 'Carrier'} · ${order.trackingNumber}` : 'Not available'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No orders are associated with this email address yet.</p>}
              {(profile.lead.orderCount || 0) > profile.orders.length && <p className="mt-2 text-xs text-slate-500">Showing the 100 most recent orders.</p>}
            </section>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-5">
      {dataError && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{dataError}</p>}
      {requestError && <p role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{requestError}</p>}
      {success && <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{success}</p>}
      {!isSuperadmin && <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">Existing lead contact details are read-only for your role. A superadmin can edit them from the table or lead profile.</p>}

      {mode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setMode(null);
        }}>
          <section role="dialog" aria-modal="true" aria-labelledby="lead-modal-title" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
            <header className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 id="lead-modal-title" className="text-lg font-bold text-slate-900">{mode === 'csv' ? 'Import contacts from CSV' : 'Add contact'}</h3>
                <p className="mt-1 text-sm text-slate-500">{mode === 'csv' ? 'Upload a CSV file or paste contact rows to preview before saving.' : 'Enter the contact details below.'}</p>
              </div>
              <button type="button" onClick={() => setMode(null)} disabled={saving} aria-label="Close dialog" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50">
                <X className="h-5 w-5" />
              </button>
            </header>
            {mode === 'csv' ? (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">
                    <Upload className="h-4 w-4" /> Choose CSV
                    <input type="file" accept=".csv,text/csv" className="sr-only" onChange={handleFile} />
                  </label>
                  <button type="button" onClick={downloadSample} className="inline-flex items-center gap-2 text-sm font-medium text-teal-800 underline">
                    <Download className="h-4 w-4" /> Download contact-only template
                  </button>
                </div>
                <label htmlFor="contact-leads-csv" className="mt-4 block text-sm font-medium text-slate-700">Or paste CSV</label>
                <textarea
                  id="contact-leads-csv"
                  value={csv}
                  onChange={(event) => parse(event.target.value)}
                  rows={5}
                  placeholder={'first_name,last_name,email,phone\nJane,Doe,jane@example.com,555-0100'}
                  className="mt-2 w-full rounded-md border border-slate-300 p-3 font-mono text-sm"
                />
                {errors.map((error) => <p key={error} className="mt-2 flex items-center gap-2 text-sm text-rose-700"><AlertCircle className="h-4 w-4" />{error}</p>)}
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead><tr className="border-b text-slate-500"><th className="py-2">Name</th><th>Email</th><th>Phone</th><th>Country</th><th>Marketing consent</th></tr></thead>
                    <tbody>
                      {preview.map((lead, index) => <tr key={`${lead.email}-${index}`} className="border-b border-slate-100"><td className="py-2">{lead.firstName} {lead.lastName}</td><td>{lead.email}</td><td>{lead.phone || '—'}</td><td>{lead.country || getLeadCountry(lead.phone)}</td><td>{lead.marketingConsent ? 'Opted in' : 'Not opted in'}</td></tr>)}
                    </tbody>
                  </table>
                </div>
                <button type="button" disabled={!preview.length || saving} onClick={() => void save(preview)} className="mt-4 rounded-md bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                  {saving ? 'Saving…' : `Save ${preview.length} leads`}
                </button>
              </div>
            ) : (
              <form onSubmit={handleManualSubmit} className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">First name<input required value={firstName} onChange={(event) => setFirstName(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label>
                <label className="text-sm font-medium text-slate-700">Last name<input required value={lastName} onChange={(event) => setLastName(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label>
                <label className="text-sm font-medium text-slate-700">Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label>
                <label className="block text-sm font-medium text-slate-700">Phone (optional)<span className="mt-1 block"><PhoneCountryInput value={phone} onChange={setPhone} /></span></label>
                <label className="block text-sm font-medium text-slate-700">Country (optional)<span className="mt-1 block"><CountrySelect value={country} onChange={setCountry} /></span></label>
                <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-2">
                  <input type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} className="mt-1" />
                  <span>Contact explicitly opted in to marketing emails. Leave unchecked unless consent was actually given.</span>
                </label>
                <button disabled={saving} className="rounded-md bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">{saving ? 'Saving…' : 'Save contact lead'}</button>
              </form>
            )}
          </section>
        </div>
      )}

      {editingLead && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !editLeadSaving) setEditingLead(null);
          }}
        >
          <section role="dialog" aria-modal="true" aria-labelledby="edit-lead-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
            <header className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 id="edit-lead-title" className="text-lg font-bold text-slate-900">Edit lead contact</h3>
                <p className="mt-1 text-sm text-slate-500">Update contact details for {editingLead.firstName} {editingLead.lastName}.</p>
              </div>
              <button type="button" disabled={editLeadSaving} onClick={() => setEditingLead(null)} aria-label="Close edit lead dialog" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50">
                <X className="h-5 w-5" />
              </button>
            </header>
            {editLeadError && <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{editLeadError}</p>}
            <form onSubmit={saveLeadFromTable} className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">First name<input required maxLength={100} value={profileFirstName} onChange={(event) => setProfileFirstName(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-slate-700">Last name<input required maxLength={100} value={profileLastName} onChange={(event) => setProfileLastName(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-slate-700">Email<input required type="email" maxLength={254} value={profileEmail} onChange={(event) => setProfileEmail(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label>
              <label className="block text-sm font-medium text-slate-700">Phone<span className="mt-1 block"><PhoneCountryInput value={profilePhone} onChange={setProfilePhone} disabled={editLeadSaving} /></span></label>
              <label className="block text-sm font-medium text-slate-700">Country<span className="mt-1 block"><CountrySelect value={profileCountry} onChange={setProfileCountry} disabled={editLeadSaving} /></span></label>
              <div className="flex items-end justify-end gap-2 sm:col-span-2">
                <button type="button" disabled={editLeadSaving} onClick={() => setEditingLead(null)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={editLeadSaving || !onUpdateLead} className="rounded-md bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {editLeadSaving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap gap-2 border-b border-slate-200 px-5 pt-4" role="group" aria-label="Lead groups">
          <button
            type="button"
            aria-pressed={leadTab === 'all'}
            onClick={() => setLeadTab('all')}
            className={`rounded-t-md border-b-2 px-3 py-2 text-sm font-semibold ${leadTab === 'all' ? 'border-teal-700 text-teal-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            All leads ({leads.length})
          </button>
          <button
            type="button"
            aria-pressed={leadTab === 'uncalled_repeat_buyers'}
            onClick={() => setLeadTab('uncalled_repeat_buyers')}
            className={`rounded-t-md border-b-2 px-3 py-2 text-sm font-semibold ${leadTab === 'uncalled_repeat_buyers' ? 'border-teal-700 text-teal-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            title="Leads with no recorded call and at least two non-cancelled orders"
          >
            Active ({uncalledRepeatBuyers.length})
          </button>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4 px-5 pt-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Saved contacts ({leads.length})</h3>
            <p className="mt-1 text-xs text-slate-500">{eligibleCount} explicitly opted-in contact{eligibleCount === 1 ? '' : 's'} eligible for bulk email</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setRequestError(''); setMode('csv'); }} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Upload className="h-4 w-4" /> CSV import
            </button>
            <button type="button" onClick={() => { setRequestError(''); setMode('manual'); }} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-900">
              <UserPlus className="h-4 w-4" /> Add contact
            </button>
            <button type="button" onClick={downloadContacts} disabled={!leads.length} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
              <Download className="h-4 w-4" /> Download contacts
            </button>
            {isSuperadmin && onOpenEmailCampaigns && (
              <button type="button" onClick={onOpenEmailCampaigns} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Mail className="h-4 w-4" /> Bulk email campaigns
              </button>
            )}
            <label className="relative">
              <span className="sr-only">Search leads</span>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contacts" className="rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm" />
            </label>
            <select aria-label="Filter by lead stage" value={stageFilter} onChange={(event) => setStageFilter(event.target.value as 'All' | LeadStatus)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="All">All stages</option>
              {(['New', 'Cold', 'Contacted', 'Qualified', 'Customer', 'Inactive'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3 hidden overflow-x-auto min-[1800px]:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600"><tr><th className="px-5 py-3">Name</th><th className="py-3">Email</th><th className="py-3">Phone</th><th className="py-3">Country</th><th className="py-3">Status</th><th className="py-3">{leadTab === 'uncalled_repeat_buyers' ? 'Active orders' : 'Orders'}</th><th className="py-3">Source</th>{isSuperadmin && <th className="py-3">Assigned agent</th>}<th className="py-3 pr-5 text-right">Actions</th></tr></thead>
            <tbody>
              {filteredLeads.map((lead) => (
                <tr
                  key={lead.id}
                  className={`border-t border-slate-100 hover:bg-slate-50 ${onLoadLeadProfile ? 'cursor-pointer focus-visible:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-teal-700' : ''}`}
                  tabIndex={onLoadLeadProfile ? 0 : undefined}
                  aria-label={onLoadLeadProfile ? `Open profile for ${lead.firstName} ${lead.lastName}` : undefined}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return;
                    void openProfile(lead);
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      void openProfile(lead);
                    }
                  }}
                >
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center">
                      <span className={onLoadLeadProfile ? 'font-semibold text-teal-800' : ''}>{lead.firstName} {lead.lastName}</span>
                      {copyButton(lead, 'name', `${lead.firstName} ${lead.lastName}`)}
                    </span>
                  </td>
                  <td className="py-3">
                    <span className="inline-flex items-center">
                      {lead.email}
                      {copyButton(lead, 'email', lead.email)}
                    </span>
                  </td>
                  <td className="py-3">
                    <span className="inline-flex items-center">
                      {lead.phone
                        ? <a href={`tel:${phoneLink(lead.phone)}`} onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1 text-teal-800 hover:underline"><Phone className="h-3.5 w-3.5" />{lead.phone}</a>
                        : <span className="text-slate-400">Not provided</span>}
                      {lead.phone && copyButton(lead, 'phone', lead.phone)}
                    </span>
                  </td>
                  <td className="py-3">
                    <span className="inline-flex items-center gap-2">
                      <CountryFlag countryCode={getLeadCountryCode(lead.country ?? '', lead.phone)} />
                      {lead.country && lead.country !== 'Not specified' ? lead.country : getLeadCountry(lead.phone)}
                    </span>
                  </td>
                  <td className="py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{lead.status}</span></td>
                  <td className="py-3">{leadTab === 'uncalled_repeat_buyers' ? lead.activeOrderCount || 0 : lead.orderCount || 0}</td>
                  <td className="py-3">{lead.leadSource}</td>
                  {isSuperadmin && (
                    <td className="py-3 pr-3">
                      <select
                        aria-label={`Assign ${lead.firstName} ${lead.lastName}`}
                        value={lead.assignedStaffId ?? ''}
                        onChange={(event) => void assignLead(lead, event.target.value)}
                        className="max-w-40 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs"
                      >
                        <option value="">Unassigned</option>
                        {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.display_name || agent.email}</option>)}
                      </select>
                    </td>
                  )}
                  <td className="py-3 pr-5 text-right">
                    <button
                      type="button"
                      disabled={!isSuperadmin}
                      title={isSuperadmin ? `Edit ${lead.firstName} ${lead.lastName}` : 'Only a superadmin can edit contact details.'}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (isSuperadmin) openLeadEditor(lead);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-teal-700 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-500 disabled:hover:bg-white"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                  </td>
                </tr>
              ))}
              {!filteredLeads.length && <tr><td colSpan={isSuperadmin ? 9 : 8} className="px-5 py-8 text-center text-slate-500">{!leads.length ? 'No contact leads are stored yet.' : leadTab === 'uncalled_repeat_buyers' ? 'No uncalled repeat buyers match these filters.' : 'No contacts match these filters.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 p-3 min-[1800px]:hidden sm:grid-cols-2 sm:p-4">
          {filteredLeads.map((lead) => (
            <article key={lead.id} className="min-w-0 rounded-xl border border-[#e5e8e1] bg-white p-4 transition hover:border-[#c8d4c8] sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <button type="button" disabled={!onLoadLeadProfile} onClick={() => void openProfile(lead)} className="block max-w-full truncate text-left text-sm font-bold text-[#315649] hover:underline disabled:cursor-default disabled:no-underline">
                    {lead.firstName} {lead.lastName}
                  </button>
                  <div className="mt-1 flex min-w-0 items-center">
                    <a href={`mailto:${lead.email}`} onClick={(event) => event.stopPropagation()} className="truncate text-xs text-slate-600 hover:text-[#315649] hover:underline">{lead.email}</a>
                    {copyButton(lead, 'email', lead.email)}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-[#edf2ed] px-2.5 py-1 text-[11px] font-semibold text-[#456953]">{lead.status}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-4 text-xs">
                <div className="min-w-0">
                  <p className="font-semibold uppercase tracking-wide text-slate-400">Phone</p>
                  {lead.phone
                    ? <div className="mt-1 flex min-w-0 items-center"><a href={`tel:${phoneLink(lead.phone)}`} className="truncate font-medium text-slate-700 hover:text-[#315649]">{lead.phone}</a>{copyButton(lead, 'phone', lead.phone)}</div>
                    : <p className="mt-1 text-slate-500">Not provided</p>}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold uppercase tracking-wide text-slate-400">Country</p>
                  <p className="mt-1 truncate text-slate-700">{lead.country && lead.country !== 'Not specified' ? lead.country : getLeadCountry(lead.phone)}</p>
                </div>
                <div>
                  <p className="font-semibold uppercase tracking-wide text-slate-400">{leadTab === 'uncalled_repeat_buyers' ? 'Active orders' : 'Orders'}</p>
                  <p className="mt-1 font-semibold text-slate-800">{leadTab === 'uncalled_repeat_buyers' ? lead.activeOrderCount || 0 : lead.orderCount || 0}</p>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold uppercase tracking-wide text-slate-400">Source</p>
                  <p className="mt-1 truncate text-slate-700">{lead.leadSource}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                {isSuperadmin ? (
                  <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-slate-500">
                    <span className="shrink-0">Assigned to</span>
                    <select
                      aria-label={`Assign ${lead.firstName} ${lead.lastName}`}
                      value={lead.assignedStaffId ?? ''}
                      onChange={(event) => void assignLead(lead, event.target.value)}
                      className="min-w-0 max-w-44 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700"
                    >
                      <option value="">Unassigned</option>
                      {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.display_name || agent.email}</option>)}
                    </select>
                  </label>
                ) : <span className="text-xs text-slate-500">{lead.assignedStaffName || 'Assigned to you'}</span>}
                <button
                  type="button"
                  disabled={!isSuperadmin}
                  title={isSuperadmin ? `Edit ${lead.firstName} ${lead.lastName}` : 'Only a superadmin can edit contact details.'}
                  onClick={() => { if (isSuperadmin) openLeadEditor(lead); }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-[#bdcdbf] hover:bg-[#f5f8f4] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
              </div>
            </article>
          ))}
          {!filteredLeads.length && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500 sm:col-span-2">
              {!leads.length ? 'No contact leads are stored yet.' : leadTab === 'uncalled_repeat_buyers' ? 'No uncalled repeat buyers match these filters.' : 'No contacts match these filters.'}
            </p>
          )}
        </div>
      </div>

    </section>
  );
};
