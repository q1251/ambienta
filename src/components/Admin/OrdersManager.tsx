import React, { useState, useMemo } from 'react';
import {
  ClipboardList,
  Search,
  Filter,
  CreditCard,
  QrCode,
  Truck,
  Building,
  Mail,
  CheckCircle2,
  Clock,
  AlertCircle,
  ExternalLink,
  Printer,
  Download,
  Plus,
  ChevronDown,
  ArrowUpDown,
  Send,
  Eye,
  X,
  FileText,
  DollarSign,
  TrendingUp,
  Package,
} from 'lucide-react';
import { OnlineOrder, PaymentMethod, EmailLog, CatalogItem, StoreCategory } from '../../types/pharmacy';

interface OrdersManagerProps {
  orders: OnlineOrder[];
  onUpdateOrderStatus: (orderId: string, newStatus: OnlineOrder['status']) => void;
  onUpdateOrderTracking?: (orderId: string, carrier: string, trackingNumber: string) => void;
  onAddOrderInternalNote?: (orderId: string, note: string) => void;
  onSendEmailNotification?: (log: EmailLog) => void;
  onAddManualOrder?: (order: OnlineOrder) => void;
  catalogItems?: CatalogItem[];
}

export const OrdersManager: React.FC<OrdersManagerProps> = ({
  orders,
  onUpdateOrderStatus,
  onUpdateOrderTracking,
  onAddOrderInternalNote,
  onSendEmailNotification,
  onAddManualOrder,
  catalogItems = [],
}) => {
  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [paymentFilter, setPaymentFilter] = useState<string>('All');
  const [selectedOrder, setSelectedOrder] = useState<OnlineOrder | null>(null);

  // Tracking form inside drawer
  const [carrierInput, setCarrierInput] = useState('');
  const [trackingInput, setTrackingInput] = useState('');
  const [newInternalNote, setNewInternalNote] = useState('');
  const [emailSentAlert, setEmailSentAlert] = useState<string | null>(null);

  // Manual Order Modal
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualCustomerName, setManualCustomerName] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualItemName, setManualItemName] = useState('Deep Sleep Botanical Night Calm Formula');
  const [manualAmount, setManualAmount] = useState('24.00');
  const [manualPaymentMethod, setManualPaymentMethod] = useState<PaymentMethod>('Credit / Debit Card');
  const [manualDelivery, setManualDelivery] = useState<'Express Courier' | 'Pharmacy Pickup' | 'Discreet Mail'>('Pharmacy Pickup');

  // KPI Calculations
  const totalRevenue = useMemo(() => {
    return orders.reduce((acc, o) => acc + (o.paymentStatus === 'Refunded' ? 0 : o.totalAmount), 0);
  }, [orders]);

  const cardRevenue = useMemo(() => {
    return orders
      .filter((o) => o.paymentMethod === 'Credit / Debit Card')
      .reduce((acc, o) => acc + o.totalAmount, 0);
  }, [orders]);

  const paypalRevenue = useMemo(() => {
    return orders
      .filter((o) => o.paymentMethod === 'PayPal')
      .reduce((acc, o) => acc + o.totalAmount, 0);
  }, [orders]);

  const cryptoRevenue = useMemo(() => {
    return orders
      .filter((o) => o.paymentMethod === 'Cryptocurrency (USDC / BTC / ETH / SOL)')
      .reduce((acc, o) => acc + o.totalAmount, 0);
  }, [orders]);

  const pendingReviewCount = useMemo(() => {
    return orders.filter((o) => o.status === 'Submitted' || o.status === 'Pharmacist Review').length;
  }, [orders]);

  // Filtered Orders
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const matchesSearch =
        o.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        o.medicationName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (o.transactionId && o.transactionId.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (o.cryptoDetails?.txHash && o.cryptoDetails.txHash.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesStatus = statusFilter === 'All' || o.status === statusFilter;
      const matchesPayment =
        paymentFilter === 'All' ||
        (paymentFilter === 'Card' && o.paymentMethod === 'Credit / Debit Card') ||
        (paymentFilter === 'PayPal' && o.paymentMethod === 'PayPal') ||
        (paymentFilter === 'Crypto' && o.paymentMethod === 'Cryptocurrency (USDC / BTC / ETH / SOL)') ||
        (paymentFilter === 'Pickup' && o.paymentMethod === 'Cash on Delivery / Pickup');

      return matchesSearch && matchesStatus && matchesPayment;
    });
  }, [orders, searchQuery, statusFilter, paymentFilter]);

  // Open detail drawer and sync inputs
  const handleOpenDetail = (order: OnlineOrder) => {
    setSelectedOrder(order);
    setCarrierInput(order.carrier || 'CareCourier Express');
    setTrackingInput(order.trackingNumber || '');
    setNewInternalNote('');
    setEmailSentAlert(null);
  };

  // Update tracking details
  const handleSaveTracking = () => {
    if (!selectedOrder) return;
    if (onUpdateOrderTracking) {
      onUpdateOrderTracking(selectedOrder.id, carrierInput, trackingInput);
    }
    // Update local modal state
    setSelectedOrder({
      ...selectedOrder,
      carrier: carrierInput,
      trackingNumber: trackingInput,
    });
  };

  // Add internal staff note
  const handleAddNote = () => {
    if (!selectedOrder || !newInternalNote.trim()) return;
    const noteText = `[${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} Staff]: ${newInternalNote.trim()}`;
    if (onAddOrderInternalNote) {
      onAddOrderInternalNote(selectedOrder.id, noteText);
    }
    setSelectedOrder({
      ...selectedOrder,
      internalNotes: [noteText, ...(selectedOrder.internalNotes || [])],
    });
    setNewInternalNote('');
  };

  // Save a tracking email draft until a mail provider is connected.
  const handleSendHostingerEmail = () => {
    if (!selectedOrder) return;
    const emailLog: EmailLog = {
      id: `mail-${Date.now()}`,
      recipientEmail: selectedOrder.email,
      recipientName: selectedOrder.patientName,
      subject: `Order Update #${selectedOrder.orderNumber}: Dispensed & Shipped`,
      body: `Hello ${selectedOrder.patientName},\n\nYour order (${selectedOrder.orderNumber}) containing ${selectedOrder.medicationName} has been processed by our dispensary team.\nCarrier: ${carrierInput || selectedOrder.carrier || 'CareCourier'}\nTracking Number: ${trackingInput || selectedOrder.trackingNumber || 'Available upon pickup'}\n\nWarm regards,\nAuraCare Dispensary Team`,
      status: 'Draft',
      sentAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      emailType: 'order_confirmation',
    };

    if (onSendEmailNotification) {
      onSendEmailNotification(emailLog);
    }
    setEmailSentAlert(`Tracking email draft saved for ${selectedOrder.email}. No email was sent.`);
    setTimeout(() => setEmailSentAlert(null), 4000);
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
      `"${o.paymentMethod || 'Card'}"`,
      `"${o.paymentStatus || 'Paid'}"`,
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
    link.setAttribute('download', `auracare_orders_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Submit manual phone/walk-in order
  const handleCreateManualOrder = (e: React.FormEvent) => {
    e.preventDefault();
    const orderNum = `ORD-MAN-${Date.now().toString().slice(-5)}`;
    const parsedAmount = parseFloat(manualAmount) || 24.0;

    const newOrder: OnlineOrder = {
      id: `ord-man-${Date.now()}`,
      orderNumber: orderNum,
      patientName: manualCustomerName || 'Walk-in Client',
      email: manualEmail || 'desk.client@auracarehealth.com',
      phone: manualPhone || '+1 (555) 000-0000',
      medicationName: manualItemName,
      items: [
        {
          productId: 'custom-manual',
          name: manualItemName,
          category: 'Daily Wellness',
          quantity: 1,
          unitPrice: parsedAmount,
        },
      ],
      subtotal: parsedAmount,
      shippingFee: 0.0,
      discountAmount: 0.0,
      totalAmount: parsedAmount,
      orderType: 'Store Purchase',
      deliveryMethod: manualDelivery,
      deliveryAddress: manualDelivery === 'Pharmacy Pickup' ? 'Dispensary Counter 1' : 'Local Address on File',
      paymentMethod: manualPaymentMethod,
      paymentStatus: 'Paid',
      transactionId: `MAN-${Date.now().toString().slice(-6)}`,
      status: 'Submitted',
      placedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      carrier: manualDelivery === 'Pharmacy Pickup' ? 'Counter Pickup' : 'CareCourier Express',
      trackingNumber: `DESK-${Math.floor(1000 + Math.random() * 9000)}`,
      notes: 'Manually logged by dispensary staff',
      internalNotes: ['Created manually via Admin CRM Desk'],
    };

    if (onAddManualOrder) {
      onAddManualOrder(newOrder);
    }
    setIsManualModalOpen(false);
    setManualCustomerName('');
    setManualEmail('');
    setManualPhone('');
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & KPI Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Gross Revenue */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Total Gross Revenue</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-xl font-bold font-mono text-slate-900">${totalRevenue.toFixed(2)}</div>
          <p className="text-[11px] text-slate-400">All settled channels</p>
        </div>

        {/* Total Orders */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Total Orders Placed</span>
            <ClipboardList className="w-4 h-4 text-teal-600" />
          </div>
          <div className="text-xl font-bold font-mono text-slate-900">{orders.length}</div>
          <p className="text-[11px] text-slate-400">Dispensary queue &amp; archive</p>
        </div>

        {/* Card Payments */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Credit / Debit Cards</span>
            <CreditCard className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-xl font-bold font-mono text-slate-900">${cardRevenue.toFixed(2)}</div>
          <p className="text-[11px] text-slate-400">
            {orders.filter((o) => o.paymentMethod === 'Credit / Debit Card').length} card transactions
          </p>
        </div>

        {/* PayPal Payments */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>PayPal Gateway</span>
            <span className="font-bold text-sky-600 text-xs">PP</span>
          </div>
          <div className="text-xl font-bold font-mono text-slate-900">${paypalRevenue.toFixed(2)}</div>
          <p className="text-[11px] text-slate-400">
            {orders.filter((o) => o.paymentMethod === 'PayPal').length} PayPal transactions
          </p>
        </div>

        {/* Crypto Payments */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-slate-500 text-xs">
            <span>Crypto (USDC/BTC)</span>
            <QrCode className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xl font-bold font-mono text-slate-900">${cryptoRevenue.toFixed(2)}</div>
          <p className="text-[11px] text-slate-400">
            {orders.filter((o) => o.paymentMethod === 'Cryptocurrency (USDC / BTC / ETH / SOL)').length} on-chain orders
          </p>
        </div>
      </div>

      {/* Main Order Workspace */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        {/* Workspace Toolbar */}
        <div className="p-5 border-b border-slate-200 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900">
                Dispensary &amp; Store Orders Management
              </h3>
              {pendingReviewCount > 0 && (
                <span className="bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-bold px-2 py-0.5 rounded-full">
                  {pendingReviewCount} require review
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Orders from this browser session, with local fulfillment and payment review
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsManualModalOpen(true)}
              className="px-3 py-1.5 bg-teal-800 hover:bg-teal-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Phone/Walk-in Order</span>
            </button>

            <button
              onClick={handleExportCsv}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-300"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 text-xs">
          {/* Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by order #, customer, email, product, or tx hash..."
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
                onChange={(e) => setStatusFilter(e.target.value)}
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

            {/* Payment Filter */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1">
              <span className="text-slate-400 text-[11px] font-semibold">Payment:</span>
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                className="bg-transparent text-slate-800 font-medium focus:outline-none text-xs cursor-pointer"
              >
                <option value="All">All Payment Modes</option>
                <option value="Card">Credit / Debit Card</option>
                <option value="PayPal">PayPal</option>
                <option value="Crypto">Cryptocurrency</option>
                <option value="Pickup">Pickup / Cash</option>
              </select>
            </div>

            <span className="text-slate-400 text-[11px] font-mono">
              Showing {filteredOrders.length} of {orders.length}
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
                <th className="py-3 px-4">Amount &amp; Gateway</th>
                <th className="py-3 px-4">Fulfillment Mode</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    No orders matching your search or filters.
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

                    {/* Financials & Gateway */}
                    <td className="py-3.5 px-4">
                      <div className="font-mono font-bold text-slate-900 text-sm">
                        ${ord.totalAmount.toFixed(2)}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {ord.paymentMethod === 'Credit / Debit Card' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                            <CreditCard className="w-2.5 h-2.5" />
                            <span>Card {ord.cardLast4 ? `••${ord.cardLast4}` : ''}</span>
                          </span>
                        ) : ord.paymentMethod === 'PayPal' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200">
                            <span className="font-bold italic">PP</span>
                            <span>PayPal</span>
                          </span>
                        ) : ord.paymentMethod === 'Cryptocurrency (USDC / BTC / ETH / SOL)' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                            <QrCode className="w-2.5 h-2.5" />
                            <span>{ord.cryptoDetails?.currency || 'Crypto'}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                            <span>Pickup</span>
                          </span>
                        )}
                        <span
                          className={`text-[10px] font-bold px-1 rounded ${
                            ord.paymentStatus === 'Paid'
                              ? 'text-emerald-700 bg-emerald-50'
                              : 'text-amber-700 bg-amber-50'
                          }`}
                        >
                          {ord.paymentStatus || 'Paid'}
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
                        onChange={(e) =>
                          onUpdateOrderStatus(ord.id, e.target.value as OnlineOrder['status'])
                        }
                        className="bg-white border border-slate-300 rounded px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-700 cursor-pointer"
                      >
                        <option value="Submitted">Submitted</option>
                        <option value="Pharmacist Review">Review</option>
                        <option value="Dispensing">Dispensing</option>
                        <option value="Ready for Pickup">Pickup Ready</option>
                        <option value="Shipped">Shipped</option>
                        <option value="Completed">Completed</option>
                        <option value="Cancelled">Cancelled</option>
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

            {/* Email dispatch alert banner */}
            {emailSentAlert && (
              <div className="bg-emerald-50 text-emerald-800 px-5 py-2 text-xs border-b border-emerald-200 flex items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>{emailSentAlert}</span>
              </div>
            )}

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
                  <span className="font-bold text-slate-800 text-xs block">Payment Audit Trail</span>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Method:</span>
                    <span className="font-bold text-slate-900">{selectedOrder.paymentMethod}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Payment Status:</span>
                    <span className="font-bold text-emerald-700">{selectedOrder.paymentStatus || 'Paid'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Transaction ID:</span>
                    <span className="font-mono text-teal-800 font-semibold">{selectedOrder.transactionId || 'N/A'}</span>
                  </div>
                  {selectedOrder.cryptoDetails && (
                    <div className="pt-1.5 border-t border-slate-200 text-[11px] space-y-0.5">
                      <span className="text-amber-800 font-semibold block">On-Chain Crypto Record:</span>
                      <p className="text-slate-600">Network: {selectedOrder.cryptoDetails.network}</p>
                      <p className="font-mono text-slate-500 truncate">Tx: {selectedOrder.cryptoDetails.txHash}</p>
                    </div>
                  )}
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
                    <span>Total Settled:</span>
                    <span className="font-mono text-teal-900">${selectedOrder.totalAmount.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Fulfillment & Tracking Section */}
              <div className="bg-teal-50/50 p-4 rounded-xl border border-teal-200 space-y-3">
                <span className="font-bold text-teal-950 text-xs flex items-center gap-1.5">
                  <Truck className="w-4 h-4 text-teal-700" />
                  <span>Fulfillment &amp; Email Draft</span>
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
                  <button
                    type="button"
                    onClick={handleSendHostingerEmail}
                    className="px-3 py-1.5 bg-white hover:bg-slate-100 text-teal-800 border border-teal-300 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Send className="w-3 h-3" />
                    <span>Save Tracking Email Draft</span>
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
                    placeholder="Add clinical or fulfillment note..."
                    className="flex-1 bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={handleAddNote}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Add Note
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
                Log New Phone or Walk-in Order
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

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Product Description</label>
                <input
                  type="text"
                  required
                  value={manualItemName}
                  onChange={(e) => setManualItemName(e.target.value)}
                  placeholder="e.g. Deep Sleep Night Calm Formula"
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Amount ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={manualAmount}
                    onChange={(e) => setManualAmount(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payment Method</label>
                  <select
                    value={manualPaymentMethod}
                    onChange={(e) => setManualPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900"
                  >
                    <option value="Credit / Debit Card">Credit / Debit Card</option>
                    <option value="PayPal">PayPal</option>
                    <option value="Cryptocurrency (USDC / BTC / ETH / SOL)">Cryptocurrency</option>
                    <option value="Cash on Delivery / Pickup">Cash / Counter POS</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Fulfillment Mode</label>
                <select
                  value={manualDelivery}
                  onChange={(e) => setManualDelivery(e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900"
                >
                  <option value="Pharmacy Pickup">Dispensary Desk Pickup</option>
                  <option value="Express Courier">Express Courier</option>
                  <option value="Discreet Mail">Discreet Mail</option>
                </select>
              </div>

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
                  className="px-5 py-2 text-xs font-bold text-white bg-teal-800 hover:bg-teal-700 rounded-lg shadow-xs cursor-pointer"
                >
                  Record Order to CRM
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
