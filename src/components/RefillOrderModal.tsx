import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, Upload, AlertCircle, FileText, Truck, Building } from 'lucide-react';
import { OnlineOrder, Patient } from '../types/pharmacy';

interface RefillOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefillRxNumber?: string;
  prefillMedicationName?: string;
  patients: Patient[];
  onOrderCreated: (order: OnlineOrder) => void;
}

export const RefillOrderModal: React.FC<RefillOrderModalProps> = ({
  isOpen,
  onClose,
  prefillRxNumber,
  prefillMedicationName,
  patients,
  onOrderCreated,
}) => {
  const [rxNumber, setRxNumber] = useState(prefillRxNumber || '');
  const [patientName, setPatientName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [medicationName, setMedicationName] = useState(prefillMedicationName || '');
  const [deliveryMethod, setDeliveryMethod] = useState<'Express Courier' | 'Pharmacy Pickup' | 'Discreet Mail'>('Express Courier');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [uploadedSlipName, setUploadedSlipName] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [createdOrderCode, setCreatedOrderCode] = useState('');

  // Prefill when props change or when matched patient is found
  useEffect(() => {
    if (prefillRxNumber) {
      setRxNumber(prefillRxNumber);
      const matched = patients.find((p) =>
        p.refillHistory.some((r) => r.rxNumber.toLowerCase() === prefillRxNumber.toLowerCase())
      );
      if (matched) {
        setPatientName(`${matched.firstName} ${matched.lastName}`);
        setEmail(matched.email);
        setPhone(matched.phone);
        setAddress(matched.address);
        const rx = matched.refillHistory.find(
          (r) => r.rxNumber.toLowerCase() === prefillRxNumber.toLowerCase()
        );
        if (rx) {
          setMedicationName(rx.medicationName);
        }
      }
    } else if (prefillMedicationName) {
      setMedicationName(prefillMedicationName);
    }
  }, [prefillRxNumber, prefillMedicationName, patients]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const orderNumber = `ORD-RX-${Date.now().toString().slice(-6)}`;
    const newOrder: OnlineOrder = {
      id: `ord-${Date.now()}`,
      orderNumber,
      patientName: patientName || 'Client',
      email: email || 'patient@example.org',
      phone: phone || '+1 (555) 000-0000',
      rxNumber: rxNumber || 'RX-NEW-TRANSFER',
      medicationName: medicationName || 'Medication Order',
      orderType: 'Medication Refill',
      deliveryMethod,
      deliveryAddress: deliveryMethod !== 'Pharmacy Pickup' ? address : 'Local Pharmacy Pickup Desk',
      totalAmount: deliveryMethod === 'Express Courier' ? 12.0 : 0.0,
      status: 'Pharmacist Review',
      placedAt: '2026-11-02 04:15 AM',
      notes: notes || undefined,
    };

    setCreatedOrderCode(orderNumber);
    setIsSubmitted(true);
    onOrderCreated(newOrder);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setUploadedSlipName(e.target.files[0].name);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Online Medication Refill Request</h3>
            <p className="text-xs text-slate-500">Fast clinical verification &amp; dispensing dispatch</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isSubmitted ? (
          <div className="p-8 text-center space-y-4">
            <div className="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-700 mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="text-xl font-bold text-slate-900">Refill Order Successfully Placed</h4>
            <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
              Your refill order <span className="font-mono font-bold text-slate-900">{createdOrderCode}</span> has been received and routed to on-duty pharmacist <span className="font-medium text-slate-900">Dr. Sarah Jenkins, PharmD</span>.
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-left text-xs space-y-1.5 text-slate-700 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500 font-sans">Rx Number:</span>
                <span>{rxNumber || 'RX-ON-FILE'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-sans">Medication:</span>
                <span>{medicationName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-sans">Method:</span>
                <span>{deliveryMethod}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-sans">Status:</span>
                <span className="text-teal-700 font-semibold">Under Pharmacist Review</span>
              </div>
            </div>

            <div className="pt-2 flex justify-center gap-3">
              <button
                onClick={() => {
                  setIsSubmitted(false);
                  onClose();
                }}
                className="px-5 py-2.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-md transition-colors shadow-xs"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Rx Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={rxNumber}
                  onChange={(e) => setRxNumber(e.target.value)}
                  placeholder="e.g. RX-884219"
                  className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Medication Name &amp; Strength <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={medicationName}
                  onChange={(e) => setMedicationName(e.target.value)}
                  placeholder="e.g. Metformin ER 500mg"
                  className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Patient Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  placeholder="Eleanor Vance"
                  className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Email for Confirmation <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="eleanor@example.com"
                  className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Phone Number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 349-1102"
                  className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
                />
              </div>
            </div>

            {/* Delivery Method Selection */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Fulfillment Preference
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setDeliveryMethod('Express Courier')}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    deliveryMethod === 'Express Courier'
                      ? 'border-teal-700 bg-teal-50 text-teal-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold">
                    <Truck className="w-3.5 h-3.5 text-teal-700" />
                    <span>Express Courier</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">Same-day delivery ($12 or copay)</p>
                </button>

                <button
                  type="button"
                  onClick={() => setDeliveryMethod('Pharmacy Pickup')}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    deliveryMethod === 'Pharmacy Pickup'
                      ? 'border-teal-700 bg-teal-50 text-teal-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold">
                    <Building className="w-3.5 h-3.5 text-teal-700" />
                    <span>Pharmacy Pickup</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">Ready at counter in 2 hrs ($0)</p>
                </button>

                <button
                  type="button"
                  onClick={() => setDeliveryMethod('Discreet Mail')}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    deliveryMethod === 'Discreet Mail'
                      ? 'border-teal-700 bg-teal-50 text-teal-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold">
                    <FileText className="w-3.5 h-3.5 text-teal-700" />
                    <span>Standard Mail</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">2-day discreet shipping ($0)</p>
                </button>
              </div>
            </div>

            {deliveryMethod !== 'Pharmacy Pickup' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Delivery Address <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street address, apartment or suite, city, state, zip"
                  className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
                />
              </div>
            )}

            {/* Optional Medication Slip Upload */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Optional: Upload Medication Label or Slip Photo
              </label>
              <div className="border border-dashed border-slate-300 rounded-lg p-3 text-center bg-slate-50 hover:bg-slate-100 transition-colors">
                <input
                  type="file"
                  id="medication-file-upload"
                  accept="image/*,.pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <label
                  htmlFor="medication-file-upload"
                  className="cursor-pointer flex flex-col items-center gap-1"
                >
                  <Upload className="w-5 h-5 text-slate-400" />
                  <span className="text-xs font-medium text-teal-700">
                    {uploadedSlipName ? uploadedSlipName : 'Click to attach photo or PDF'}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    PNG, JPG, or PDF up to 10MB
                  </span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Notes for Pharmacist
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Allergy reminders, preferred delivery time window, doctor updates..."
                className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700 resize-none"
              ></textarea>
            </div>

            {/* Actions */}
            <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-md shadow-xs transition-colors"
              >
                Submit Refill Request
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
