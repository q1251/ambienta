import React, { useState } from 'react';
import { X, Search, CheckCircle, Clock, PackageCheck, Truck, AlertCircle } from 'lucide-react';
import { OnlineOrder } from '../types/pharmacy';

interface OrderTrackerModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: OnlineOrder[];
}

export const OrderTrackerModal: React.FC<OrderTrackerModalProps> = ({
  isOpen,
  onClose,
  orders,
}) => {
  const [searchCode, setSearchCode] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<OnlineOrder | null>(
    orders.length > 0 ? orders[0] : null
  );

  if (!isOpen) return null;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchCode.trim()) return;
    const found = orders.find(
      (o) =>
        o.orderNumber.toLowerCase().includes(searchCode.toLowerCase()) ||
        (o.rxNumber && o.rxNumber.toLowerCase().includes(searchCode.toLowerCase())) ||
        o.patientName.toLowerCase().includes(searchCode.toLowerCase())
    );
    if (found) {
      setSelectedOrder(found);
    }
  };

  const getStepStatus = (currentStatus: OnlineOrder['status'], stepIdx: number) => {
    if (currentStatus === 'Cancelled') return 'pending';
    const statusRank: Record<OnlineOrder['status'], number> = {
      Pending: 0,
      Submitted: 0,
      'Pharmacist Review': 1,
      Dispensing: 2,
      'Ready for Pickup': 3,
      Shipped: 3,
      Delivered: 4,
      Completed: 5,
      Cancelled: -1,
    };
    const currentIdx = statusRank[currentStatus];
    if (currentIdx > stepIdx) return 'completed';
    if (currentIdx === stepIdx) return 'active';
    return 'pending';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Track Refill &amp; Medication Orders</h3>
            <p className="text-xs text-slate-500">Live dispensary preparation &amp; courier status</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Search Bar */}
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchCode}
                onChange={(e) => setSearchCode(e.target.value)}
                placeholder="Search by Order # (e.g. ORD-RX-20261102-1), Rx #, or Name..."
                className="w-full bg-slate-50 border border-slate-300 rounded-md pl-9 pr-3 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-teal-700"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-md transition-colors"
            >
              Lookup
            </button>
          </form>

          {/* Quick Order Tabs */}
          {orders.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {orders.map((ord) => (
                <button
                  key={ord.id}
                  onClick={() => setSelectedOrder(ord)}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition-colors border ${
                    selectedOrder?.id === ord.id
                      ? 'bg-teal-800 text-white border-teal-800 font-semibold'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {ord.orderNumber}
                </button>
              ))}
            </div>
          )}

          {selectedOrder ? (
            <div className="space-y-6">
              {/* Order Info Card */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
                  <div>
                    <span className="text-xs text-slate-400 font-mono">Order Number</span>
                    <h4 className="text-sm font-bold text-slate-900 font-mono">{selectedOrder.orderNumber}</h4>
                  </div>
                  <div className="text-left sm:text-right">
                    <span className="text-xs text-slate-400">Placed On</span>
                    <p className="text-xs font-medium text-slate-700">{selectedOrder.placedAt}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 text-xs text-slate-700">
                  <div>
                    <span className="text-slate-400 block">Patient Name</span>
                    <span className="font-semibold text-slate-900">{selectedOrder.patientName}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Medication</span>
                    <span className="font-semibold text-slate-900">{selectedOrder.medicationName}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Rx Number</span>
                    <span className="font-mono text-slate-900">{selectedOrder.rxNumber || 'Transfer Request'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Fulfillment Method</span>
                    <span className="font-medium text-slate-900">{selectedOrder.deliveryMethod}</span>
                  </div>
                  {selectedOrder.deliveryAddress && (
                    <div className="sm:col-span-2">
                      <span className="text-slate-400 block">Destination</span>
                      <span className="text-slate-800">{selectedOrder.deliveryAddress}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Progress Stepper */}
              <div className="space-y-4">
                <h5 className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                  Live Preparation Timeline
                </h5>

                <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    { label: 'Pending', desc: 'Order received' },
                    { label: 'Pharmacist Review', desc: 'Safety screening' },
                    { label: 'Dispensing', desc: 'Preparation' },
                    {
                      label: selectedOrder.deliveryMethod === 'Pharmacy Pickup' ? 'Ready for Pickup' : 'Shipped',
                      desc: selectedOrder.deliveryMethod === 'Pharmacy Pickup' ? 'Awaiting collection' : 'In transit',
                    },
                    { label: 'Delivered', desc: 'Order received' },
                    { label: 'Completed', desc: 'Order closed' },
                  ].map((step, idx) => {
                    const status = getStepStatus(selectedOrder.status, idx);
                    return (
                      <div key={idx} className="space-y-1.5">
                        <div
                          className={`h-2 rounded-full transition-colors ${
                            status === 'completed'
                              ? 'bg-emerald-600'
                              : status === 'active'
                              ? 'bg-teal-600 animate-pulse'
                              : 'bg-slate-200'
                          }`}
                        />
                        <p className="text-xs font-bold text-slate-900">{step.label}</p>
                        <p className="text-[11px] text-slate-500">{step.desc}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Pharmacist Verification Note */}
              <div className="flex items-start gap-3 p-3 bg-teal-50/70 border border-teal-200 rounded-lg text-xs text-teal-900">
                <PackageCheck className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Clinical Dispensary Check</p>
                  <p className="text-teal-800 mt-0.5">
                    Order is inspected by a licensed pharmacist for dosage adherence, refill schedule, and patient allergy checks prior to courier dispatch.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <AlertCircle className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-xs text-slate-600">No matching orders found. Try a different search.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
