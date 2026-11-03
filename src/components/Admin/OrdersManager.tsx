import React, { useState, useEffect } from 'react';
import {
  Search,
  Truck,
  Printer,
  Download,
  Plus,
  Eye,
  X,
} from 'lucide-react';
import { OnlineOrder, CatalogItem } from '../../types/pharmacy';
import type { OrderPagination, OrderSearch } from './AdminLayout';

interface OrdersManagerProps {
  orders: OnlineOrder[];
  pagination: OrderPagination;
  isLoading: boolean;
  onLoadOrders: (search: OrderSearch) => void;
  onUpdateOrderStatus: (orderId: string, newStatus: OnlineOrder['status']) => Promise<void>;
  onUpdateOrderTracking: (orderId: string, carrier: string, trackingNumber: string) => Promise<void>;
  onAddOrderInternalNote: (orderId: string, note: string) => Promise<string>;
  onCreateManualOrder: (data: {
    customerName: string;
    email: string;
    phone: string;
    deliveryMethod: OnlineOrder['deliveryMethod'];
    deliveryAddress: string;
    productId: string;
    quantity: number;
  }) => Promise<OnlineOrder>;
  catalogItems?: CatalogItem[];
}

const allowedStatusTransitions: Record<OnlineOrder['status'], OnlineOrder['status'][]> = {
  Submitted: ['Pharmacist Review', 'Dispensing', 'Cancelled'],
  'Pharmacist Review': ['Dispensing', 'Cancelled'],
  Dispensing: ['Ready for Pickup', 'Shipped', 'Cancelled'],
  'Ready for Pickup': ['Completed', 'Cancelled'],
  Shipped: ['Completed'],
  Completed: [],
  Cancelled: [],
};

export const OrdersManager: React.FC<OrdersManagerProps> = ({
  orders,
  pagination,
  isLoading,
  onLoadOrders,
  onUpdateOrderStatus,
  onUpdateOrderTracking,
  onAddOrderInternalNote,
  onCreateManualOrder,
  catalogItems = [],
}) => {
  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<OnlineOrder | null>(null);

  // Tracking form inside drawer
  const [carrierInput, setCarrierInput] = useState('');
  const [trackingInput, setTrackingInput] = useState('');
  const [newInternalNote, setNewInternalNote] = useState('');
  const [orderSaveError, setOrderSaveError] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);

  // Manual Order Modal
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualCustomerName, setManualCustomerName] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualProductId, setManualProductId] = useState('');
  const [manualQuantity, setManualQuantity] = useState('1');
  const [manualOrderError, setManualOrderError] = useState('');
  const [isSavingManualOrder, setIsSavingManualOrder] = useState(false);
  const [manualDelivery, setManualDelivery] = useState<'Express Courier' | 'Pharmacy Pickup' | 'Discreet Mail'>('Pharmacy Pickup');
  const [manualAddress, setManualAddress] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onLoadOrders({ query: searchQuery.trim(), status: statusFilter, page: currentPage });
    }, searchQuery ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [searchQuery, statusFilter, currentPage, reloadCounter, onLoadOrders]);

  const filteredOrders = orders;

  // Open detail drawer and sync inputs
  const handleOpenDetail = (order: OnlineOrder) => {
    setSelectedOrder(order);
    setCarrierInput(order.carrier || '');
    setTrackingInput(order.trackingNumber || '');
    setNewInternalNote('');
  };

  // Update tracking details
  const handleSaveTracking = async () => {
    if (!selectedOrder) return;
    setOrderSaveError('');
    try {
      await onUpdateOrderTracking(selectedOrder.id, carrierInput, trackingInput);
    } catch (error) {
      setOrderSaveError(error instanceof Error ? error.message : 'Order tracking could not be saved.');
      return;
    }
    // Update local modal state
    setSelectedOrder({
      ...selectedOrder,
      carrier: carrierInput,
      trackingNumber: trackingInput,
    });
  };

  const handleStatusChange = async (orderId: string, status: OnlineOrder['status']) => {
    setOrderSaveError('');
    try {
      await onUpdateOrderStatus(orderId, status);
      setReloadCounter((counter) => counter + 1);
    } catch (error) {
      setOrderSaveError(error instanceof Error ? error.message : 'Order status could not be saved.');
    }
  };

  // Add internal staff note
  const handleAddNote = async () => {
    if (!selectedOrder || !newInternalNote.trim()) return;
    setOrderSaveError('');
    setIsSavingNote(true);
    try {
      const noteText = await onAddOrderInternalNote(selectedOrder.id, newInternalNote.trim());
      setSelectedOrder({
        ...selectedOrder,
        internalNotes: [noteText, ...(selectedOrder.internalNotes || [])],
      });
      setNewInternalNote('');
    } catch (error) {
      setOrderSaveError(error instanceof Error ? error.message : 'Order note could not be saved.');
    } finally {
      setIsSavingNote(false);
    }
  };

  // Export to CSV
  const handleExportCsv = () => {
    const headers = [
      'Order Number',
      'Date',
      'Customer',
      'Email',
      'Phone',
      'Items',
      'Total ($)',
      'Payment Method',
      'Payment Status',
      'Transaction ID',
      'Delivery Method',
      'Fulfillment Status',
      'Carrier',
      'Tracking Number',
    ];

    const rows = filteredOrders.map((o) => [
      `"${o.orderNumber}"`,
      `"${o.placedAt}"`,
      `"${o.patientName}"`,
      `"${o.email}"`,
      `"${o.phone}"`,
      `"${o.medicationName}"`,
      o.totalAmount.toFixed(2),
      `"${o.paymentMethod || 'Not specified'}"`,
      `"${o.paymentStatus || 'Unknown'}"`,
      `"${o.transactionId || ''}"`,
      `"${o.deliveryMethod}"`,
      `"${o.status}"`,
      `"${o.carrier || ''}"`,
      `"${o.trackingNumber || ''}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `ambients_orders_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Submit manual phone/walk-in order
  const handleCreateManualOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualOrderError('');
    const quantity = Number(manualQuantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50 || !manualProductId) {
      setManualOrderError('Select a product and enter a whole-number quantity from 1 to 50.');
      return;
    }
    setIsSavingManualOrder(true);
    try {
      await onCreateManualOrder({
        customerName: manualCustomerName.trim(),
        email: manualEmail.trim(),
        phone: manualPhone.trim(),
        deliveryMethod: manualDelivery,
        deliveryAddress: manualDelivery === 'Pharmacy Pickup' ? '' : manualAddress.trim(),
        productId: manualProductId,
        quantity,
      });
      setIsManualModalOpen(false);
      setManualCustomerName('');
      setManualEmail('');
      setManualPhone('');
      setManualAddress('');
      setManualQuantity('1');
      setManualProductId('');
      setStatusFilter('All');
      setCurrentPage(1);
      setReloadCounter((counter) => counter + 1);
    } catch (createError) {
      setManualOrderError(createError instanceof Error ? createError.message : 'The order could not be saved.');
    } finally {
      setIsSavingManualOrder(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Main Order Workspace */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        {/* Workspace Toolbar */}
        <div className="p-5 border-b border-slate-200 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900">
                Order management
              </h3>
            </div>
            <p className="text-xs text-slate-500">
              Search and filter saved orders across all pages. Payment remains unverified until a real provider is connected.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setManualProductId(catalogItems[0]?.id || '');
                setManualOrderError('');
                setIsManualModalOpen(true);
              }}
              className="px-3 py-1.5 bg-teal-800 hover:bg-teal-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create order</span>
            </button>

            <button
              onClick={handleExportCsv}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-300"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export this page</span>
            </button>
          </div>
        </div>

        {orderSaveError && <p role="alert" className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-900">{orderSaveError}</p>}

        {/* Filter & Search Bar */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 text-xs">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search order number, customer, email, or product..."
              className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-700"
            />
          </div>

          {/* Quick Filter Badges */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1">
              <span className="text-slate-400 text-[11px] font-semibold">Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="bg-transparent text-slate-800 font-medium focus:outline-none text-xs cursor-pointer"
              >
                <option value="All">All Statuses</option>
                <option value="Submitted">Submitted</option>
                <option value="Pharmacist Review">Pharmacist Review</option>
                <option value="Dispensing">Dispensing</option>
                <option value="Ready for Pickup">Ready for Pickup</option>
                <option value="Shipped">Shipped</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>

            <span className="text-slate-400 text-[11px] font-mono">
              {pagination.total === 0 ? '0 orders' : `${(pagination.page - 1) * pagination.limit + 1}–${Math.min(pagination.page * pagination.limit, pagination.total)} of ${pagination.total}`}
            </span>
          </div>
        </div>

        {/* Orders Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">Order # &amp; Date</th>
                <th className="py-3 px-4">Customer Details</th>
                <th className="py-3 px-4">Items Ordered</th>
                <th className="py-3 px-4">Amount &amp; payment</th>
                <th className="py-3 px-4">Fulfillment Mode</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={7} className="py-12 text-center text-slate-500">Loading orders…</td></tr>
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    No orders match this search and status filter.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((ord) => (
                  <tr key={ord.id} className="hover:bg-slate-50 transition-colors">
                    {/* Order # and Date */}
                    <td className="py-3.5 px-4 font-mono">
                      <span className="font-bold text-slate-900 block">{ord.orderNumber}</span>
                      <span className="text-[11px] text-slate-400 font-sans">{ord.placedAt}</span>
                    </td>

                    {/* Customer */}
                    <td className="py-3.5 px-4">
                      <p className="font-semibold text-slate-900">{ord.patientName}</p>
                      <p className="text-[11px] font-mono text-slate-500">{ord.email}</p>
                      <p className="text-[11px] text-slate-400">{ord.phone}</p>
                    </td>

                    {/* Items */}
                    <td className="py-3.5 px-4 max-w-xs">
                      <p className="font-medium text-slate-900 truncate">{ord.medicationName}</p>
                      <span className="text-[11px] text-slate-500">
                        {ord.items && ord.items.length > 0 ? (
                          <span>{ord.items.length} line item(s)</span>
                        ) : (
                          <span>Single product order</span>
                        )}
                      </span>
                    </td>

                    {/* Amount and payment state */}
                    <td className="py-3.5 px-4">
                      <div className="font-mono font-bold text-slate-900 text-sm">
                        ${ord.totalAmount.toFixed(2)}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-slate-500">{ord.paymentMethod || 'Not specified'}</span>
                        <span className={`rounded px-1 text-[10px] font-bold ${ord.paymentStatus === 'Paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                          {ord.paymentStatus || 'Unknown'}
                        </span>
                      </div>
                    </td>

                    {/* Delivery */}
                    <td className="py-3.5 px-4">
                      <span className="font-medium text-slate-800 block">{ord.deliveryMethod}</span>
                      {ord.trackingNumber ? (
                        <span className="text-[10px] font-mono text-teal-800 bg-teal-50 px-1 rounded">
                          {ord.trackingNumber}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">No tracking yet</span>
                      )}
                    </td>

                    {/* Status Badge */}
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                          ord.status === 'Submitted'
                            ? 'bg-amber-50 text-amber-800 border-amber-300'
                            : ord.status === 'Pharmacist Review'
                            ? 'bg-sky-50 text-sky-800 border-sky-300'
                            : ord.status === 'Dispensing'
                            ? 'bg-purple-50 text-purple-800 border-purple-300'
                            : ord.status === 'Ready for Pickup'
                            ? 'bg-blue-50 text-blue-800 border-blue-300'
                            : ord.status === 'Shipped' || ord.status === 'Completed'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                            : 'bg-rose-50 text-rose-800 border-rose-300'
                        }`}
                      >
                        {ord.status}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-1.5">
                      <select
                        value={ord.status}
                        onChange={(e) => {
                          const nextStatus = e.target.value as OnlineOrder['status'];
                          if (nextStatus === 'Cancelled' && ord.status !== 'Cancelled'
                            && !window.confirm(`Cancel order ${ord.orderNumber}? Its reserved inventory will be returned to stock.`)) {
                            e.currentTarget.value = ord.status;
                            return;
                          }
                          void handleStatusChange(ord.id, nextStatus);
                        }}
                        className="bg-white border border-slate-300 rounded px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-700 cursor-pointer"
                      >
                        <option value={ord.status}>{ord.status}</option>
                        {allowedStatusTransitions[ord.status].map((status) => <option key={status} value={status}>{status}</option>)}
                      </select>

                      <button
                        onClick={() => handleOpenDetail(ord)}
                        className="p-1.5 text-slate-500 hover:text-teal-800 hover:bg-slate-100 rounded cursor-pointer transition-colors"
                        title="View Full Order Breakdown"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-500">Page {pagination.page} of {Math.max(1, pagination.pages)} · {pagination.total} total orders</p>
          <div className="flex gap-2">
            <button type="button" disabled={pagination.page <= 1 || isLoading} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40">Previous</button>
            <button type="button" disabled={pagination.page >= pagination.pages || isLoading} onClick={() => setCurrentPage((page) => page + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>

      {/* Comprehensive Order Detail Modal / Drawer */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
            {/* Header */}
            <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-teal-700 flex items-center justify-center font-bold text-white text-xs">
                  ORD
                </div>
                <div>
                  <h3 className="font-bold text-base text-white flex items-center gap-2">
                    <span>Order #{selectedOrder.orderNumber}</span>
                    <span className="text-xs font-mono font-bold bg-teal-900 text-teal-300 px-2 py-0.5 rounded border border-teal-700">
                      {selectedOrder.status}
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">Placed on {selectedOrder.placedAt}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Slip</span>
                </button>
                <button
                  onClick={() => setSelectedOrder(null)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs">
              {/* Top Details Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Customer Info */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1.5">
                  <span className="font-bold text-slate-800 text-xs block">Customer Information</span>
                  <p className="font-semibold text-slate-900">{selectedOrder.patientName}</p>
                  <p className="text-slate-600 font-mono text-[11px]">{selectedOrder.email}</p>
                  <p className="text-slate-500">{selectedOrder.phone}</p>
                  <div className="pt-2 border-t border-slate-200">
                    <span className="text-[11px] text-slate-400 block">Delivery Address:</span>
                    <p className="text-slate-800">{selectedOrder.deliveryAddress || 'Pickup Counter'}</p>
                  </div>
                </div>

                {/* Payment & Audit Info */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1.5">
                  <span className="font-bold text-slate-800 text-xs block">Payment status</span>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Method:</span>
                    <span className="font-bold text-slate-900">{selectedOrder.paymentMethod || 'Not specified'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Payment Status:</span>
                    <span className="font-bold text-amber-800">{selectedOrder.paymentStatus || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Transaction ID:</span>
                    <span className="font-mono text-slate-700">{selectedOrder.transactionId || 'Not available'}</span>
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-3">
                <span className="font-bold text-slate-800 text-xs block">Order Line Items</span>
                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                  {selectedOrder.items && selectedOrder.items.length > 0 ? (
                    selectedOrder.items.map((item, idx) => (
                      <div key={idx} className="p-3 bg-white flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          {item.image ? (
                            <img
                              src={item.image}
                              alt={item.name}
                              className="w-10 h-10 rounded-md object-cover border border-slate-200"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-md bg-teal-50 text-teal-800 flex items-center justify-center font-bold text-xs">
                              Item
                            </div>
                          )}
                          <div>
                            <p className="font-semibold text-slate-900">{item.name}</p>
                            <p className="text-[11px] text-slate-400">
                              {item.dosage || 'Dispensary Item'} · Qty: {item.quantity}
                            </p>
                          </div>
                        </div>
                        <span className="font-mono font-bold text-slate-900">
                          ${(item.unitPrice * item.quantity).toFixed(2)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="p-3 bg-white flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{selectedOrder.medicationName}</span>
                      <span className="font-mono font-bold text-slate-900">
                        ${selectedOrder.totalAmount.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Subtotals & Totals */}
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1 text-slate-600">
                  <div className="flex justify-between">
                    <span>Product Subtotal:</span>
                    <span className="font-mono text-slate-900 font-semibold">
                      ${(selectedOrder.subtotal || selectedOrder.totalAmount).toFixed(2)}
                    </span>
                  </div>
                  {selectedOrder.discountAmount ? (
                    <div className="flex justify-between text-emerald-700">
                      <span>Discount ({selectedOrder.couponCode}):</span>
                      <span className="font-mono font-semibold">-${selectedOrder.discountAmount.toFixed(2)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <span>Shipping Fee ({selectedOrder.deliveryMethod}):</span>
                    <span className="font-mono text-slate-900 font-semibold">
                      ${(selectedOrder.shippingFee || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="border-t border-slate-300 pt-1.5 flex justify-between font-bold text-slate-900 text-sm">
                    <span>Order total (not payment confirmation):</span>
                    <span className="font-mono text-teal-900">${selectedOrder.totalAmount.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Fulfillment & Tracking Section */}
              <div className="bg-teal-50/50 p-4 rounded-xl border border-teal-200 space-y-3">
                <span className="font-bold text-teal-950 text-xs flex items-center gap-1.5">
                  <Truck className="w-4 h-4 text-teal-700" />
                  <span>Fulfillment &amp; Tracking</span>
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Shipping Carrier
                    </label>
                    <input
                      type="text"
                      value={carrierInput}
                      onChange={(e) => setCarrierInput(e.target.value)}
                      placeholder="e.g. CareCourier Express, FedEx, USPS"
                      className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-900 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Tracking Number
                    </label>
                    <input
                      type="text"
                      value={trackingInput}
                      onChange={(e) => setTrackingInput(e.target.value)}
                      placeholder="e.g. CCE-99210-IL"
                      className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-900 text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleSaveTracking}
                    className="px-3 py-1.5 bg-teal-800 hover:bg-teal-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Save Tracking
                  </button>
                </div>
              </div>

              {/* Internal Notes Log */}
              <div className="space-y-2">
                <span className="font-bold text-slate-800 text-xs block">Internal Staff Notes</span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newInternalNote}
                    onChange={(e) => setNewInternalNote(e.target.value)}
                    placeholder="Fulfillment note only; do not include clinical or health details"
                    maxLength={2000}
                    className="flex-1 bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={handleAddNote}
                    disabled={isSavingNote || !newInternalNote.trim()}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    {isSavingNote ? 'Saving…' : 'Add Note'}
                  </button>
                </div>

                {selectedOrder.internalNotes && selectedOrder.internalNotes.length > 0 && (
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1.5">
                    {selectedOrder.internalNotes.map((note, idx) => (
                      <p key={idx} className="text-[11px] text-slate-600 border-b border-slate-200/60 pb-1 last:border-0 last:pb-0">
                        {note}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual Phone/Walk-in Order Modal */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 space-y-4 text-xs font-sans">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="font-bold text-base text-slate-900">
                Create a manual order
              </h3>
              <button
                onClick={() => setIsManualModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateManualOrder} className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Customer Name</label>
                <input
                  type="text"
                  required
                  value={manualCustomerName}
                  onChange={(e) => setManualCustomerName(e.target.value)}
                  placeholder="e.g. Ronald Davis"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={manualEmail}
                    onChange={(e) => setManualEmail(e.target.value)}
                    placeholder="ronald@caremail.com"
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    required
                    value={manualPhone}
                    onChange={(e) => setManualPhone(e.target.value)}
                    placeholder="+1 (555) 302-8819"
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block font-semibold text-slate-700">Product
                  <select required value={manualProductId} onChange={(event) => setManualProductId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900">
                    <option value="">Select a product</option>
                    {catalogItems.filter((item) => item.inStock).map((item) => <option key={item.id} value={item.id}>{item.name} · ${item.price.toFixed(2)} · {item.stockCount} in stock</option>)}
                  </select>
                </label>
                <label className="block font-semibold text-slate-700">Quantity
                  <input type="number" min="1" max="50" step="1" required value={manualQuantity} onChange={(event) => setManualQuantity(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-slate-900" />
                </label>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Fulfillment Mode</label>
                <select
                  value={manualDelivery}
                  onChange={(e) => setManualDelivery(e.target.value as typeof manualDelivery)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900"
                >
                  <option value="Pharmacy Pickup">Dispensary Desk Pickup</option>
                  <option value="Express Courier">Express Courier</option>
                  <option value="Discreet Mail">Discreet Mail</option>
                </select>
              </div>
              {manualDelivery !== 'Pharmacy Pickup' && (
                <label className="block font-semibold text-slate-700">Delivery address
                  <textarea required maxLength={500} value={manualAddress} onChange={(event) => setManualAddress(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900" />
                </label>
              )}
              <p className="rounded-lg bg-amber-50 p-3 text-amber-900">Order prices come from the live catalog. Payment remains pending; creating an order does not charge the customer.</p>
              {manualOrderError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-900">{manualOrderError}</p>}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsManualModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingManualOrder}
                  className="px-5 py-2 text-xs font-bold text-white bg-teal-800 hover:bg-teal-700 rounded-lg shadow-xs cursor-pointer"
                >
                  {isSavingManualOrder ? 'Saving…' : 'Create order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
