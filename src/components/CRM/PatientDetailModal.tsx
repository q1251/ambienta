import React, { useState } from 'react';
import {
  X,
  User,
  Shield,
  Clock,
  Plus,
  Lock,
  AlertTriangle,
  Mail,
  Calendar,
  Pill,
  CheckCircle,
  FileText,
} from 'lucide-react';
import { Patient, PharmacistNote, RefillRecord } from '../../types/pharmacy';
import { calculateDaysRemaining } from '../../utils/pharmacyLogic';

interface PatientDetailModalProps {
  patient: Patient | null;
  isOpen: boolean;
  onClose: () => void;
  onAddNote: (patientId: string, note: Omit<PharmacistNote, 'id' | 'createdAt'>) => void;
  onTriggerRefill: (patientId: string, rxNumber: string) => void;
  onOpenEmailComposer: (patient: Patient) => void;
}

export const PatientDetailModal: React.FC<PatientDetailModalProps> = ({
  patient,
  isOpen,
  onClose,
  onAddNote,
  onTriggerRefill,
  onOpenEmailComposer,
}) => {
  const [activeTab, setActiveTab] = useState<'refills' | 'notes' | 'info'>('refills');

  // New Note Form State
  const [noteContent, setNoteContent] = useState('');
  const [noteType, setNoteType] = useState<PharmacistNote['noteType']>('Clinical Evaluation');
  const [alertLevel, setAlertLevel] = useState<PharmacistNote['drugAlertLevel']>('None');
  const [isConfidential, setIsConfidential] = useState(false);
  const [showAddNoteForm, setShowAddNoteForm] = useState(false);

  if (!isOpen || !patient) return null;

  const handleCreateNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteContent.trim()) return;

    onAddNote(patient.id, {
      patientId: patient.id,
      authorName: 'Dr. Sarah Jenkins',
      authorTitle: 'PharmD, Clinical Specialist',
      noteType,
      content: noteContent.trim(),
      drugAlertLevel: alertLevel,
      isConfidential,
    });

    setNoteContent('');
    setShowAddNoteForm(false);
  };

  const getStatusBadge = (status: RefillRecord['status']) => {
    switch (status) {
      case 'Active':
        return 'text-blue-800 bg-blue-50 border-blue-200';
      case 'Due Soon':
        return 'text-amber-800 bg-amber-50 border-amber-200';
      case 'Renewal Required':
        return 'text-rose-800 bg-rose-50 border-rose-200';
      case 'Overdue':
        return 'text-red-900 bg-red-100 border-red-300 font-bold';
      default:
        return 'text-slate-700 bg-slate-50 border-slate-200';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-800 text-white flex items-center justify-center font-bold text-sm">
              {patient.firstName[0]}
              {patient.lastName[0]}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-slate-900">
                  {patient.firstName} {patient.lastName}
                </h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-sm bg-blue-100/70 text-blue-900 border border-blue-200">
                  {patient.healthCategory}
                </span>
              </div>
              <p className="text-xs text-slate-500 font-mono">
                DOB: {patient.dateOfBirth} · Policy: {patient.insurancePolicyNumber}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onOpenEmailComposer(patient)}
              className="px-3 py-1.5 text-xs font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-md border border-blue-200 transition-colors flex items-center gap-1.5"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Email Patient via Hostinger</span>
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sub-Tabs */}
        <div className="flex items-center px-6 border-b border-slate-200 gap-6 text-xs font-semibold text-slate-600 bg-white">
          <button
            onClick={() => setActiveTab('refills')}
            className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'refills'
                ? 'border-blue-700 text-blue-900'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            <Pill className="w-3.5 h-3.5" />
            Customer Refill History ({patient.refillHistory.length})
          </button>
          <button
            onClick={() => setActiveTab('notes')}
            className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'notes'
                ? 'border-blue-700 text-blue-900'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            Secure Pharmacist Notes ({patient.notes.length})
          </button>
          <button
            onClick={() => setActiveTab('info')}
            className={`py-3 border-b-2 flex items-center gap-1.5 transition-colors ${
              activeTab === 'info'
                ? 'border-blue-700 text-blue-900'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            Clinical Profile &amp; Allergies
          </button>
        </div>

        {/* Modal Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* TAB 1: REFILL HISTORY */}
          {activeTab === 'refills' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Comprehensive Medication &amp; Refill History
                  </h4>
                  <p className="text-xs text-slate-500">
                    Tracks dispenses, remaining refills, and renewal schedule dates
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3">Rx #</th>
                      <th className="py-2.5 px-3">Medication &amp; Strength</th>
                      <th className="py-2.5 px-3">Last Filled</th>
                      <th className="py-2.5 px-3">Next Due</th>
                      <th className="py-2.5 px-3 text-center">Remaining</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {patient.refillHistory.map((refill) => {
                      const daysLeft = calculateDaysRemaining(refill.nextRefillDue);
                      return (
                        <tr key={refill.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3 px-3 font-mono font-semibold text-slate-900">
                            {refill.rxNumber}
                          </td>
                          <td className="py-3 px-3">
                            <p className="font-semibold text-slate-900">{refill.medicationName}</p>
                            <p className="text-[11px] text-slate-500">
                              {refill.strength} · {refill.dosageForm} ({refill.quantity} units, {refill.daysSupply} days)
                            </p>
                            <p className="text-[11px] text-blue-800 mt-0.5">
                              Provider: {refill.providerDoctor || (refill as any).prescribingDoctor} ({refill.doctorClinic})
                            </p>
                          </td>
                          <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                            {refill.dateFilled}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span className="font-semibold text-slate-900">{refill.nextRefillDue}</span>
                            <span className="block text-[11px] text-slate-500">
                              {daysLeft > 0 ? `${daysLeft} days left` : daysLeft === 0 ? 'Due Today' : `${Math.abs(daysLeft)} days overdue`}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center font-mono font-bold text-slate-900">
                            {refill.remainingRefills}
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-sm border text-[11px] font-medium ${getStatusBadge(
                                refill.status
                              )}`}
                            >
                              {refill.status}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            <button
                              onClick={() => onTriggerRefill(patient.id, refill.rxNumber)}
                              className="px-2.5 py-1 text-xs font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md transition-colors"
                            >
                              Dispense Refill
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: SECURE PHARMACIST NOTES */}
          {activeTab === 'notes' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Clinical Pharmacist Documentation &amp; Audit Trail
                  </h4>
                  <p className="text-xs text-slate-500">
                    Tamper-evident clinical notes, drug allergy alerts, and dosage evaluations
                  </p>
                </div>
                <button
                  onClick={() => setShowAddNoteForm(!showAddNoteForm)}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors flex items-center gap-1.5 shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{showAddNoteForm ? 'Cancel Note' : 'Add Pharmacist Note'}</span>
                </button>
              </div>

              {/* Add Note Form */}
              {showAddNoteForm && (
                <form
                  onSubmit={handleCreateNote}
                  className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Note Classification
                      </label>
                      <select
                        value={noteType}
                        onChange={(e) => setNoteType(e.target.value as PharmacistNote['noteType'])}
                        className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-xs text-slate-900"
                      >
                        <option value="Clinical Evaluation">Clinical Evaluation</option>
                        <option value="Drug Interaction Alert">Drug Interaction Alert</option>
                        <option value="Dosage Modification">Dosage Modification</option>
                        <option value="Patient Consultation">Patient Consultation</option>
                        <option value="Refill Authorization">Refill Authorization</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Alert Severity
                      </label>
                      <select
                        value={alertLevel}
                        onChange={(e) =>
                          setAlertLevel(e.target.value as PharmacistNote['drugAlertLevel'])
                        }
                        className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-xs text-slate-900"
                      >
                        <option value="None">None (Routine Record)</option>
                        <option value="Advisory">Advisory (Caution)</option>
                        <option value="Severe Warning">Severe Warning (Interaction)</option>
                      </select>
                    </div>

                    <div className="flex items-center pt-5">
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                        <input
                          type="checkbox"
                          checked={isConfidential}
                          onChange={(e) => setIsConfidential(e.target.checked)}
                          className="rounded border-slate-300 text-blue-700 focus:ring-blue-700"
                        />
                        <span>Mark as Confidential / Sensitive</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Clinical Note Content <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      required
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      rows={3}
                      placeholder="Detail patient counseling, therapeutic drug monitoring, renal clearance checks, or physician communications..."
                      className="w-full bg-white border border-slate-300 rounded-md p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-700"
                    ></textarea>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-slate-500 font-mono">
                      Signed as: Dr. Sarah Jenkins, PharmD (Lead Clinical Specialist)
                    </span>
                    <button
                      type="submit"
                      className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md shadow-xs transition-colors"
                    >
                      Save Secure Note
                    </button>
                  </div>
                </form>
              )}

              {/* Notes Timeline List */}
              <div className="space-y-3">
                {patient.notes.map((note) => (
                  <div
                    key={note.id}
                    className={`p-4 rounded-xl border transition-colors ${
                      note.drugAlertLevel === 'Severe Warning'
                        ? 'border-rose-300 bg-rose-50/50'
                        : note.drugAlertLevel === 'Advisory'
                        ? 'border-amber-300 bg-amber-50/50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">{note.noteType}</span>
                        {note.isConfidential && (
                          <span className="flex items-center gap-1 text-[11px] font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded-sm border border-purple-200">
                            <Lock className="w-3 h-3" />
                            Confidential
                          </span>
                        )}
                        {note.drugAlertLevel !== 'None' && (
                          <span
                            className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-sm border ${
                              note.drugAlertLevel === 'Severe Warning'
                                ? 'text-rose-800 bg-rose-100 border-rose-300'
                                : 'text-amber-800 bg-amber-100 border-amber-300'
                            }`}
                          >
                            <AlertTriangle className="w-3 h-3" />
                            {note.drugAlertLevel}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {note.createdAt}
                      </span>
                    </div>

                    <p className="text-xs text-slate-700 leading-relaxed">{note.content}</p>

                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                      <span className="font-medium text-slate-800">
                        Author: {note.authorName} ({note.authorTitle})
                      </span>
                      <span className="text-slate-400 font-mono">Verified Clinical Audit ID: #{note.id}</span>
                    </div>
                  </div>
                ))}

                {patient.notes.length === 0 && (
                  <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-200">
                    <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                    <p className="text-xs text-slate-600">No clinical notes recorded yet.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: CLINICAL PROFILE & ALLERGIES */}
          {activeTab === 'info' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <h5 className="font-bold text-slate-900 border-b border-slate-200 pb-2">
                  Demographic &amp; Contact Details
                </h5>
                <div>
                  <span className="text-slate-400 block">Full Legal Name</span>
                  <span className="font-semibold text-slate-900">{patient.firstName} {patient.lastName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Email address</span>
                  <span className="font-mono text-slate-900">{patient.email}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Phone</span>
                  <span className="font-mono text-slate-900">{patient.phone}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Residential Address</span>
                  <span className="text-slate-800">{patient.address}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Lead Source</span>
                  <span className="text-blue-800 font-medium">{patient.leadSource}</span>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <h5 className="font-bold text-slate-900 border-b border-slate-200 pb-2">
                  Clinical Care &amp; Insurance
                </h5>
                <div>
                  <span className="text-slate-400 block">Target Health Category</span>
                  <span className="font-semibold text-blue-800">{patient.healthCategory}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Primary Physician</span>
                  <span className="text-slate-900 font-medium">{patient.primaryDoctor}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Insurance Provider</span>
                  <span className="text-slate-900">{patient.insuranceProvider}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Known Drug &amp; Environmental Allergies</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {patient.allergies.length > 0 ? (
                      patient.allergies.map((alg, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded-sm bg-rose-50 text-rose-800 border border-rose-200 font-semibold"
                        >
                          {alg}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-500">No known drug allergies (NKDA)</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
