import React, { useState } from 'react';
import { AlertCircle, Download, FileSpreadsheet, Upload, UserPlus } from 'lucide-react';
import { ContactLead } from '../../types/pharmacy';
import { generateSampleCsv, parseLeadsCsv } from '../../utils/pharmacyLogic';

type NewLead = Omit<ContactLead, 'id' | 'createdAt'>;

interface ContactLeadManagerProps {
  leads: ContactLead[];
  dataError?: string;
  onSaveLeads: (leads: NewLead[]) => Promise<void>;
}

export const ContactLeadManager: React.FC<ContactLeadManagerProps> = ({
  leads,
  dataError,
  onSaveLeads,
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
    void save([{ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), phone: phone.trim(), leadSource: 'Manual Entry' }]);
  };

  return (
    <section className="space-y-5">
      <header className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-bold text-slate-900">Contact leads</h2>
        <p className="mt-1 text-sm text-slate-600">
          Only names and contact details are stored here. Do not upload health, prescription, or insurance information.
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
              <thead><tr className="border-b text-slate-500"><th className="py-2">Name</th><th>Email</th><th>Phone</th></tr></thead>
              <tbody>
                {preview.map((lead, index) => <tr key={`${lead.email}-${index}`} className="border-b border-slate-100"><td className="py-2">{lead.firstName} {lead.lastName}</td><td>{lead.email}</td><td>{lead.phone || '—'}</td></tr>)}
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
          <button disabled={saving} className="rounded-md bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">{saving ? 'Saving…' : 'Save contact lead'}</button>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <h3 className="px-5 pt-4 text-base font-bold text-slate-900">Saved contacts ({leads.length})</h3>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="px-5 py-3">Name</th><th className="py-3">Email</th><th className="py-3">Phone</th><th className="py-3">Source</th></tr></thead>
          <tbody>
            {leads.map((lead) => <tr key={lead.id} className="border-t border-slate-100"><td className="px-5 py-3">{lead.firstName} {lead.lastName}</td><td>{lead.email}</td><td>{lead.phone || '—'}</td><td>{lead.leadSource}</td></tr>)}
            {!leads.length && <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-500">No contact leads are stored yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
};
