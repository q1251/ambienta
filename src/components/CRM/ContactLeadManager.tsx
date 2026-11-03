import React, { useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Download, FileSpreadsheet, Mail, MessageSquare, Package, Phone, Search, Upload, UserPlus } from 'lucide-react';
import { ContactLead, ContactLeadInput, ContactLeadUpdate, LeadActivityInput, LeadProfile, LeadStatus } from '../../types/pharmacy';
import { generateSampleCsv, parseLeadsCsv } from '../../utils/pharmacyLogic';

type NewLead = ContactLeadInput;

interface ContactLeadManagerProps {
  leads: ContactLead[];
  dataError?: string;
  onSaveLeads: (leads: NewLead[]) => Promise<void>;
  onLoadLeadProfile?: (leadId: number) => Promise<LeadProfile>;
  onUpdateLead?: (leadId: number, update: ContactLeadUpdate) => Promise<ContactLead>;
  onAddLeadActivity?: (leadId: number, activity: LeadActivityInput) => Promise<LeadProfile['activities'][number]>;
}

export const ContactLeadManager: React.FC<ContactLeadManagerProps> = ({
  leads,
  dataError,
  onSaveLeads,
  onLoadLeadProfile,
  onUpdateLead,
  onAddLeadActivity,
}) => {
  const [mode, setMode] = useState<'csv' | 'manual'>('csv');
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
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<'All' | LeadStatus>('All');
  const [profile, setProfile] = useState<LeadProfile | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [activityNote, setActivityNote] = useState('');
  const [activitySaving, setActivitySaving] = useState(false);
  const profileRequestId = useRef(0);
  const eligibleCount = leads.filter((lead) => lead.marketingConsent).length;
  const filteredLeads = leads.filter((lead) => {
    const matchesStage = stageFilter === 'All' || lead.status === stageFilter;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${lead.firstName} ${lead.lastName} ${lead.email} ${lead.phone}`.toLowerCase().includes(query);
    return matchesStage && matchesSearch;
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
      setMarketingConsent(false);
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

  const handleManualSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void save([{
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      leadSource: 'Manual Entry',
      status: 'Cold',
      marketingConsent,
    }]);
  };

  const openProfile = async (lead: ContactLead) => {
    if (!onLoadLeadProfile) return;
    const requestId = ++profileRequestId.current;
    setSelectedLeadId(lead.id);
    setProfile(null);
    setProfileError('');
    setProfileSaving(false);
    setActivitySaving(false);
    setActivityNote('');
    setProfileLoading(true);
    try {
      const loadedProfile = await onLoadLeadProfile(lead.id);
      if (requestId === profileRequestId.current) {
        setProfile(loadedProfile);
      }
    } catch (error) {
      if (requestId === profileRequestId.current) {
        setProfileError(error instanceof Error ? error.message : 'The contact profile could not be loaded.');
      }
    } finally {
      if (requestId === profileRequestId.current) setProfileLoading(false);
    }
  };

  const closeProfile = () => {
    profileRequestId.current += 1;
    setSelectedLeadId(null);
    setProfile(null);
    setProfileError('');
    setProfileLoading(false);
    setProfileSaving(false);
    setActivitySaving(false);
  };

  const updateProfile = async (update: ContactLeadUpdate) => {
    if (!profile || !onUpdateLead) return;
    const requestId = profileRequestId.current;
    const leadId = profile.lead.id;
    setProfileSaving(true);
    setProfileError('');
    try {
      const lead = await onUpdateLead(leadId, update);
      if (requestId !== profileRequestId.current) return;
      setProfile((current) => current?.lead.id === leadId ? { ...current, lead } : current);
      if ((update.status !== undefined || update.phone !== undefined) && onLoadLeadProfile) {
        try {
          const refreshed = await onLoadLeadProfile(lead.id);
          if (requestId === profileRequestId.current) setProfile(refreshed);
        } catch (error) {
          if (requestId !== profileRequestId.current) return;
          const reason = error instanceof Error ? ` ${error.message}` : '';
          setProfileError(`The change was saved, but the activity timeline could not be refreshed. Reload the profile to see the latest history.${reason}`);
        }
      }
    } catch (error) {
      if (requestId !== profileRequestId.current) return;
      setProfileError(error instanceof Error ? error.message : 'The contact profile could not be updated.');
    } finally {
      if (requestId === profileRequestId.current) setProfileSaving(false);
    }
  };

  const saveActivity = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || !onAddLeadActivity) return;
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
              <h3 className="text-base font-bold text-slate-900">Contact details</h3>
              <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <div><p className="text-xs font-medium uppercase text-slate-500">Email</p><p className="mt-1 break-all text-sm text-slate-900">{profile.lead.email}</p></div>
                <div>
                  <p className="text-xs font-medium uppercase text-slate-500">Phone</p>
                  {profile.lead.phone
                    ? <a href={`tel:${phoneLink(profile.lead.phone)}`} className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-800 hover:underline"><Phone className="h-4 w-4" />{profile.lead.phone}</a>
                    : <p className="mt-1 text-sm text-slate-500">No phone number saved</p>}
                </div>
                <div><p className="text-xs font-medium uppercase text-slate-500">Source</p><p className="mt-1 text-sm text-slate-900">{profile.lead.leadSource}</p></div>
                <div><p className="text-xs font-medium uppercase text-slate-500">Added</p><p className="mt-1 text-sm text-slate-900">{new Date(profile.lead.createdAt).toLocaleDateString()}</p></div>
              </div>
              <div className="mt-5 grid gap-5 border-t border-slate-100 pt-5 lg:grid-cols-2">
                <form onSubmit={(event) => void saveActivity(event)} className="space-y-3">
                  <label className="block text-sm font-medium text-slate-700">Add an internal comment
                    <textarea required maxLength={2000} rows={3} value={activityNote} onChange={(event) => setActivityNote(event.target.value)} placeholder="Add an internal comment. Do not enter health, prescription, payment, or other sensitive information." className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" />
                  </label>
                  <button type="submit" disabled={activitySaving || !onAddLeadActivity || !activityNote.trim()} className="inline-flex items-center gap-2 rounded-md bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    <MessageSquare className="h-4 w-4" />
                    {activitySaving ? 'Saving…' : 'Add comment'}
                  </button>
                </form>

                <div className="space-y-3">
                  <label className="block text-sm font-medium text-slate-700">Pipeline stage
                    <select
                      disabled={profileSaving || !onUpdateLead}
                      value={profile.lead.status}
                      onChange={(event) => void updateProfile({ status: event.target.value as LeadStatus })}
                      className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2"
                    >
                      {(['Cold', 'Contacted', 'Qualified', 'Customer', 'Inactive'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </label>
                  <p aria-live="polite" className="text-xs text-slate-500">{profileSaving ? 'Saving stage…' : 'Stage changes save immediately and are added to the staff history below.'}</p>
                </div>

                <label className="flex items-start gap-2 border-t border-slate-100 pt-4 text-sm text-slate-700 lg:col-span-2">
                  <input type="checkbox" disabled={profileSaving || !onUpdateLead} checked={profile.lead.marketingConsent} onChange={(event) => void updateProfile({ marketingConsent: event.target.checked })} className="mt-1" />
                  <span><span className="font-medium">Explicit marketing opt-in recorded.</span> Only mark this when the contact has actually consented to marketing email.</span>
                </label>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6">
              <h3 className="flex items-center gap-2 text-base font-bold text-slate-900"><MessageSquare className="h-4 w-4 text-teal-800" />Lead history</h3>
              <div className="mt-4">
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

                <h4 className="mb-3 mt-6 text-sm font-bold text-slate-900">Comment history</h4>
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
            </section>

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
      <header className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-bold text-slate-900">Contact leads</h2>
        <p className="mt-1 text-sm text-slate-600">
            Track contact stages and order fulfillment history. Only contacts with recorded marketing opt-in are eligible for future bulk outreach. Do not upload health, prescription, or insurance information.
        </p>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => setMode('csv')} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${mode === 'csv' ? 'bg-teal-800 text-white' : 'bg-slate-100 text-slate-700'}`}>
            <FileSpreadsheet className="h-4 w-4" /> CSV import
          </button>
          <button type="button" onClick={() => setMode('manual')} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${mode === 'manual' ? 'bg-teal-800 text-white' : 'bg-slate-100 text-slate-700'}`}>
            <UserPlus className="h-4 w-4" /> Add contact
          </button>
        </div>
      </header>

      {dataError && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{dataError}</p>}
      {requestError && <p role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{requestError}</p>}
      {success && <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{success}</p>}
      {leads.some((lead) => lead.leadSource === 'Synthetic Demo') && (
        <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          Demo records use reserved example.com addresses and fictional phone numbers. They are not real people and are not opted in to marketing.
        </p>
      )}

      {mode === 'csv' ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
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
              <thead><tr className="border-b text-slate-500"><th className="py-2">Name</th><th>Email</th><th>Phone</th><th>Marketing consent</th></tr></thead>
              <tbody>
                {preview.map((lead, index) => <tr key={`${lead.email}-${index}`} className="border-b border-slate-100"><td className="py-2">{lead.firstName} {lead.lastName}</td><td>{lead.email}</td><td>{lead.phone || '—'}</td><td>{lead.marketingConsent ? 'Opted in' : 'Not opted in'}</td></tr>)}
              </tbody>
            </table>
          </div>
          <button type="button" disabled={!preview.length || saving} onClick={() => void save(preview)} className="mt-4 rounded-md bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? 'Saving…' : `Save ${preview.length} leads`}
          </button>
        </div>
      ) : (
        <form onSubmit={handleManualSubmit} className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">First name<input required value={firstName} onChange={(event) => setFirstName(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Last name<input required value={lastName} onChange={(event) => setLastName(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">Phone (optional)<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" /></label>
          <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-2">
            <input type="checkbox" checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} className="mt-1" />
            <span>Contact explicitly opted in to marketing emails. Leave unchecked unless consent was actually given.</span>
          </label>
          <button disabled={saving} className="rounded-md bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">{saving ? 'Saving…' : 'Save contact lead'}</button>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-end justify-between gap-4 px-5 pt-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Saved contacts ({leads.length})</h3>
            <p className="mt-1 text-xs text-slate-500">{eligibleCount} explicitly opted-in contact{eligibleCount === 1 ? '' : 's'} eligible for bulk email</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled title="Mail is not connected; sending is disabled until credentials are configured privately." className="inline-flex cursor-not-allowed items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-400">
              <Mail className="h-4 w-4" /> Bulk email unavailable
            </button>
            <label className="relative">
              <span className="sr-only">Search leads</span>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contacts" className="rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm" />
            </label>
            <select aria-label="Filter by lead stage" value={stageFilter} onChange={(event) => setStageFilter(event.target.value as 'All' | LeadStatus)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="All">All stages</option>
              {(['Cold', 'Contacted', 'Qualified', 'Customer', 'Inactive'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600"><tr><th className="px-5 py-3">Name</th><th className="py-3">Email</th><th className="py-3">Phone</th><th className="py-3">Stage</th><th className="py-3">Orders</th><th className="py-3">Marketing consent</th><th className="py-3">Source</th></tr></thead>
            <tbody>
              {filteredLeads.map((lead) => (
                <tr
                  key={lead.id}
                  className={`border-t border-slate-100 hover:bg-slate-50 ${onLoadLeadProfile ? 'cursor-pointer' : ''}`}
                  role={onLoadLeadProfile ? 'button' : undefined}
                  tabIndex={onLoadLeadProfile ? 0 : undefined}
                  aria-label={onLoadLeadProfile ? `Open profile for ${lead.firstName} ${lead.lastName}` : undefined}
                  onClick={() => void openProfile(lead)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      void openProfile(lead);
                    }
                  }}
                >
                  <td className="px-5 py-3">
                    <span className={onLoadLeadProfile ? 'font-semibold text-teal-800 underline-offset-2 hover:underline' : ''}>
                      {lead.firstName} {lead.lastName}
                    </span>
                  </td>
                  <td className="py-3">{lead.email}</td>
                  <td className="py-3">
                    {lead.phone
                      ? <a href={`tel:${phoneLink(lead.phone)}`} onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1 text-teal-800 hover:underline"><Phone className="h-3.5 w-3.5" />{lead.phone}</a>
                      : <span className="text-slate-400">Not provided</span>}
                  </td>
                  <td className="py-3"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{lead.status}</span></td>
                  <td className="py-3">{lead.orderCount || 0}</td>
                  <td className="py-3">{lead.marketingConsent ? 'Opted in' : 'Not opted in'}</td>
                  <td className="py-3">{lead.leadSource}</td>
                </tr>
              ))}
              {!filteredLeads.length && <tr><td colSpan={7} className="px-5 py-8 text-center text-slate-500">{leads.length ? 'No contacts match these filters.' : 'No contact leads are stored yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

    </section>
  );
};
