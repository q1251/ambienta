import React, { useState } from 'react';
import {
  Users,
  Send,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  FileText,
  Mail,
  Filter,
} from 'lucide-react';
import { Patient, HealthCategory, EmailLog, HostingerConfig } from '../../types/pharmacy';
import { filterPatientsByHealthCategory, interpolateEmailTemplate } from '../../utils/pharmacyLogic';

interface BulkHealthCategoryCampaignViewProps {
  patients: Patient[];
  onDispatchBulkCampaign: (logs: EmailLog[]) => void;
  hostingerConfig: HostingerConfig;
}

const CATEGORY_TEMPLATES: Record<
  string,
  { subject: string; body: string }
> = {
  'Sleep': {
    subject: 'Restorative Sleep Care & Nighttime Wellness Advisory',
    body:
      'Dear {{patient_name}},\n\nQuality sleep is foundational to immune resilience and daytime vitality. Our clinical pharmacy team is following up on your restorative sleep regimen with {{medication}}.\n\nReply directly to this Hostinger message if you need a refill prepared or have questions about dosage.\n\nWarm regards,\nAmbients Sleep & Wellness Team',
  },
  'Weight Loss': {
    subject: 'Metabolic Vitality & Weight Balance Health Check-in',
    body:
      'Dear {{patient_name}},\n\nConsistent metabolic support and steady hydration are essential to reaching your wellness milestones with {{medication}}.\n\nOur dispensary team is standing by to prepare your scheduled renewal or provide coaching on administration timing.\n\nIn good health,\nAmbients Metabolic Vitality Team',
  },
  'Diabetes Care': {
    subject: 'Clinical Wellness Update: Continuous Glucose & Refill Care',
    body:
      'Dear {{patient_name}},\n\nOur clinical pharmacy team is checking in on your ongoing diabetes care regimen. Regular monitoring and uninterrupted therapy with {{medication}} are critical for maintaining glycemic stability.\n\nIf you need an early refill or need a consultation on dietary adherence with {{primary_doctor}}, our pharmacists are available.\n\nWarm regards,\nAmbients Pharmacy Clinical Diabetes Team',
  },
  'Cardiology / Hypertension': {
    subject: 'Cardiovascular Care Advisory: Blood Pressure Log & Medication Review',
    body:
      'Dear {{patient_name}},\n\nHeart health is best protected through consistent daily medication adherence. Please continue taking your {{medication}} as directed.\n\nShould you notice any fluctuations in your morning blood pressure readings or require an updated 90-day supply, reply directly to this Hostinger message.\n\nDr. Sarah Jenkins, PharmD\nAmbients Cardiovascular Dispensary',
  },
  'Asthma & Respiratory': {
    subject: 'Respiratory Season Alert: Inhaler Supply & Seasonal Preparedness',
    body:
      'Dear {{patient_name}},\n\nWith changes in weather and air allergens, ensure your rescue and maintenance inhalers ({{medication}}) have sufficient doses remaining.\n\nReply anytime to queue your next refill.\n\nMidwest Respiratory Care | Ambients Pharmacy',
  },
  'Senior Wellness': {
    subject: 'Comprehensive Senior Care: Medication Sync & Delivery Check',
    body:
      'Dear {{patient_name}},\n\nOur pharmacy offers coordinated monthly blister packs and doorstep delivery for all your maintenance medications including {{medication}}.\n\nLet us know if you or your care partner would like our team to coordinate automatic renewals with {{primary_doctor}}.\n\nAmbients Senior Clinical Care',
  },
  'Dermatology & Topicals': {
    subject: 'Topical Therapy Guidance & Refill Status',
    body:
      'Dear {{patient_name}},\n\nWe hope your topical regimen with {{medication}} is progressing comfortably. Remember to apply sun protection as counseled.\n\nReply directly to this email if you need a refill tube prepared.\n\nAmbients Compounding & Dermatology',
  },
};

export const BulkHealthCategoryCampaignView: React.FC<BulkHealthCategoryCampaignViewProps> = ({
  patients,
  onDispatchBulkCampaign,
  hostingerConfig,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<HealthCategory | 'All Patients'>(
    'Sleep'
  );
  const [subject, setSubject] = useState(CATEGORY_TEMPLATES['Sleep'].subject);
  const [body, setBody] = useState(CATEGORY_TEMPLATES['Sleep'].body);
  const [isSending, setIsSending] = useState(false);
  const [campaignResult, setCampaignResult] = useState<string | null>(null);

  const matchedPatients = filterPatientsByHealthCategory(patients, selectedCategory);

  const handleCategoryChange = (cat: HealthCategory | 'All Patients') => {
    setSelectedCategory(cat);
    if (cat in CATEGORY_TEMPLATES) {
      setSubject(CATEGORY_TEMPLATES[cat].subject);
      setBody(CATEGORY_TEMPLATES[cat].body);
    } else {
      setSubject(`Healthcare Update for Ambients Patients`);
      setBody(
        `Dear {{patient_name}},\n\nWe are pleased to provide this quarterly clinical wellness reminder regarding your medication and wellness care.\n\nAmbients Clinical Team`
      );
    }
  };

  const handleDispatch = (e: React.FormEvent) => {
    e.preventDefault();
    if (matchedPatients.length === 0) return;

    setIsSending(true);
    setTimeout(() => {
      const logs: EmailLog[] = matchedPatients.map((p) => {
        const primaryRx = p.refillHistory[0];
        const vars = {
          patient_name: `${p.firstName} ${p.lastName}`,
          medication: primaryRx?.medicationName || 'Prescribed Therapy',
          rx_number: primaryRx?.rxNumber || 'RX-ON-FILE',
          renewal_date: primaryRx?.nextRefillDue || 'Upcoming',
          primary_doctor: p.primaryDoctor,
        };

        return {
          id: `bulk-log-${Date.now()}-${p.id}`,
          recipientEmail: p.email,
          recipientName: `${p.firstName} ${p.lastName}`,
          subject: interpolateEmailTemplate(subject, vars),
          body: interpolateEmailTemplate(body, vars),
          status: 'Draft',
          sentAt: new Date().toLocaleString(),
          emailType: 'bulk_campaign',
          healthCategory: p.healthCategory,
          rxNumber: primaryRx?.rxNumber,
        };
      });

      onDispatchBulkCampaign(logs);
      setCampaignResult(
        `Created ${matchedPatients.length} personalized drafts for the "${selectedCategory}" segment. Connect a secure mail backend to send them.`
      );
      setIsSending(false);
    }, 700);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-teal-800 uppercase tracking-wider mb-1">
            <Users className="w-3.5 h-3.5 text-teal-700" />
            <span>Health Segment Targeting</span>
          </div>
          <h3 className="text-base font-bold text-slate-900">
            Bulk Email Campaigns by Health Category
          </h3>
          <p className="text-xs text-slate-500">
            Prepare condition-specific email drafts for review before a mail backend is connected
          </p>
        </div>

        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs">
          <span className="text-slate-500">Active Audience:</span>
          <span className="font-bold text-teal-800 font-mono">
            {matchedPatients.length} Patients
          </span>
        </div>
      </div>

      {campaignResult && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
            <span>{campaignResult}</span>
          </div>
          <button
            onClick={() => setCampaignResult(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Campaign Builder */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <form onSubmit={handleDispatch} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Target Health Category Segment
              </label>
              <select
                value={selectedCategory}
                onChange={(e) =>
                  handleCategoryChange(e.target.value as HealthCategory | 'All Patients')
                }
                className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
              >
                <option value="Sleep">Sleep</option>
                <option value="Weight Loss">Weight Loss</option>
                <option value="Energy & Focus">Energy &amp; Focus</option>
                <option value="Diabetes Care">Diabetes Care</option>
                <option value="Cardiology / Hypertension">Cardiology / Hypertension</option>
                <option value="Asthma & Respiratory">Asthma &amp; Respiratory</option>
                <option value="Senior Wellness">Senior Wellness</option>
                <option value="Digestive Health">Digestive Health</option>
                <option value="Daily Wellness">Daily Wellness</option>
                <option value="All Patients">All Active Patients (Universal Broadcast)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Campaign Subject Line
              </label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Email Message Body (Personalized per recipient)
                </label>
                <span className="text-[11px] text-slate-400">
                  Tokens: {'{{patient_name}}'}, {'{{medication}}'}, {'{{primary_doctor}}'}
                </span>
              </div>
              <textarea
                required
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-md p-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 leading-relaxed font-sans"
              ></textarea>
            </div>

            <div className="pt-2 flex items-center justify-between border-t border-slate-100">
              <span className="text-[11px] text-slate-500 font-mono">
                Mailbox: {hostingerConfig.emailAccount} · server integration not configured
              </span>

              <button
                type="submit"
                disabled={isSending || matchedPatients.length === 0}
                className="px-5 py-2.5 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-md shadow-xs transition-colors flex items-center gap-2"
              >
                <Send className="w-3.5 h-3.5" />
                <span>
                  {isSending
                    ? 'Preparing drafts...'
                    : `Create ${matchedPatients.length} drafts`}
                </span>
              </button>
            </div>
          </form>
        </div>

        {/* Live Segment Recipient Preview */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Audience Preview ({matchedPatients.length})
              </h4>
              <span className="text-[11px] text-teal-800 font-medium">
                Segment: {selectedCategory}
              </span>
            </div>

            {matchedPatients.length > 0 ? (
              <div className="divide-y divide-slate-100 max-h-[380px] overflow-y-auto border border-slate-200 rounded-lg">
                {matchedPatients.map((p) => (
                  <div key={p.id} className="p-3 text-xs space-y-0.5 hover:bg-slate-50">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">
                        {p.firstName} {p.lastName}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {p.refillHistory?.[0]?.rxNumber || 'No Rx'}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-500">{p.email}</p>
                    <p className="text-[11px] text-teal-800">
                      Med: {p.refillHistory?.[0]?.medicationName || 'Clinical Care'}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 bg-slate-50 rounded-lg border border-slate-200 text-slate-500 text-xs">
                <AlertCircle className="w-6 h-6 mx-auto text-slate-400 mb-1" />
                <p>No patients currently categorized in {selectedCategory}.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
