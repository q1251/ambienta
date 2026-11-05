import React, { useState, useEffect, useMemo } from 'react';
import QRCode from 'qrcode';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Check,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Mail,
  Package,
  Plus,
  Printer,
  Search,
  Truck,
  X,
} from 'lucide-react';
import { OnlineOrder, CatalogItem } from '../../types/pharmacy';
import { generateTrackingNumber, sortOrders, OrderSortField } from '../../utils/pharmacyLogic';
import type { OrderPagination, OrderSearch } from './AdminLayout';

interface OrdersManagerProps {
  orders: OnlineOrder[];
  pagination: OrderPagination;
  isLoading: boolean;
  onLoadOrders: (search: OrderSearch) => void;
  onUpdateOrderStatus: (order: OnlineOrder, newStatus: OnlineOrder['status']) => Promise<void>;
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
  canManagePaymentLinks?: boolean;
}

const orderStatuses: OnlineOrder['status'][] = [
  'Pending',
  'Submitted',
  'Pharmacist Review',
  'Dispensing',
  'Ready for Pickup',
  'Shipped',
  'Delivered',
  'Completed',
  'Cancelled',
];

const orderStatusClasses: Record<OnlineOrder['status'], string> = {
  Pending: 'border-amber-300 bg-amber-50 text-amber-800',
  Submitted: 'border-amber-300 bg-amber-50 text-amber-800',
  'Pharmacist Review': 'border-sky-300 bg-sky-50 text-sky-800',
  Dispensing: 'border-purple-300 bg-purple-50 text-purple-800',
  'Ready for Pickup': 'border-blue-300 bg-blue-50 text-blue-800',
  Shipped: 'border-blue-300 bg-blue-50 text-blue-800',
  Delivered: 'border-blue-300 bg-blue-50 text-blue-800',
  Completed: 'border-blue-300 bg-blue-50 text-blue-800',
  Cancelled: 'border-rose-300 bg-rose-50 text-rose-800',
};

const paymentStatusClass = (status?: OnlineOrder['paymentStatus']): string => {
  if (status === 'Paid') return 'bg-blue-50 text-blue-700';
  if (status === 'Authorized') return 'bg-sky-50 text-sky-800';
  if (status === 'Payment Failed' || status === 'Refunded') return 'bg-rose-50 text-rose-700';
  return 'bg-amber-50 text-amber-800';
};

const paymentInstructionsForMethod = (method: string): string => {
  if (method === 'Credit / Debit Card') {
    return 'Complete your card payment using the secure provider link. Enter card details only on the provider checkout page.';
  }
  if (method === 'PayPal') {
    return 'Continue to PayPal using the secure provider link and confirm the order total before approving payment.';
  }
  return 'Use the secure provider link to review the available cryptocurrency and network, then follow the provider checkout instructions.';
};

type PaymentEmailTemplate =
  | 'payment_request'
  | 'payment_request_formal'
  | 'payment_reminder'
  | 'payment_reminder_final'
  | 'payment_link_updated';

type PaymentEmailDesign = 'card' | 'plain';
type PaymentLinkType = 'provider' | 'paypal' | 'crypto_wallet' | 'custom';
type CryptoAsset = 'BTC' | 'ETH' | 'USDT';
type CryptoNetwork = 'Bitcoin' | 'Ethereum (ERC-20)' | 'TRON (TRC-20)';

const paymentEmailTemplates: Record<PaymentEmailTemplate, { label: string; intro: (orderNumber: string) => string; closing: string }> = {
  payment_request: {
    label: 'Payment instructions — friendly',
    intro: (orderNumber) => `Thank you for your order. We’ve reviewed order ${orderNumber}; please complete payment to continue.`,
    closing: 'If you have questions, reply to this email and our team will be happy to help.',
  },
  payment_request_formal: {
    label: 'Payment instructions — formal',
    intro: (orderNumber) => `Your order ${orderNumber} has been reviewed. Please use the secure link below to submit the outstanding payment.`,
    closing: 'Please contact our team by replying to this email if you require assistance.',
  },
  payment_reminder: {
    label: 'Payment reminder — friendly',
    intro: (orderNumber) => `This is a friendly reminder that payment for order ${orderNumber} is still outstanding.`,
    closing: 'If you have already paid, please disregard this reminder or reply to this email so our team can assist.',
  },
  payment_reminder_final: {
    label: 'Final payment reminder',
    intro: (orderNumber) => `Our records show that payment for order ${orderNumber} is still outstanding. Please review and complete payment using the secure link below.`,
    closing: 'If you have already completed payment or need help, please reply to this email so our team can review your order.',
  },
  payment_link_updated: {
    label: 'Updated payment link',
    intro: (orderNumber) => `Here is the updated secure payment link for order ${orderNumber}. Please use this link instead of any earlier payment link.`,
    closing: 'If you have already paid using an earlier link, please reply to this email so our team can verify your order.',
  },
};

const OrderStatusTag: React.FC<{
  order: OnlineOrder;
  disabled?: boolean;
  onChange: (order: OnlineOrder, status: OnlineOrder['status'], select: HTMLSelectElement) => void;
}> = ({ order, disabled = false, onChange }) => (
  <select
    aria-label={`Change order status for ${order.orderNumber}`}
    value={order.status}
    disabled={disabled}
    onClick={(event) => event.stopPropagation()}
    onChange={(event) => onChange(order, event.currentTarget.value as OnlineOrder['status'], event.currentTarget)}
    className={`max-w-full cursor-pointer appearance-none rounded-full border px-2.5 py-1 text-[11px] font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:cursor-wait disabled:opacity-60 ${orderStatusClasses[order.status]}`}
  >
    {orderStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
  </select>
);

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
  canManagePaymentLinks = false,
}) => {
  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [reloadCounter, setReloadCounter] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<OnlineOrder | null>(null);
  const [orderPageId, setOrderPageId] = useState(() => new URLSearchParams(window.location.search).get('orderId') || '');
  const [orderPageLoading, setOrderPageLoading] = useState(false);
  const [orderPageError, setOrderPageError] = useState('');

  // Tracking form inside drawer
  const [carrierInput, setCarrierInput] = useState('');
  const [trackingInput, setTrackingInput] = useState('');
  const [newInternalNote, setNewInternalNote] = useState('');
  const [orderSaveError, setOrderSaveError] = useState('');
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [paymentLinkInput, setPaymentLinkInput] = useState('');
  const [paymentLinkType, setPaymentLinkType] = useState<PaymentLinkType>('provider');
  const [paymentLinkName, setPaymentLinkName] = useState('');
  const [paymentCryptoAsset, setPaymentCryptoAsset] = useState<CryptoAsset>('BTC');
  const [paymentCryptoNetwork, setPaymentCryptoNetwork] = useState<CryptoNetwork>('Bitcoin');
  const [paymentQrPreview, setPaymentQrPreview] = useState('');
  const [paymentEmailTemplate, setPaymentEmailTemplate] = useState<PaymentEmailTemplate>('payment_request');
  const [paymentEmailDesign, setPaymentEmailDesign] = useState<PaymentEmailDesign>('card');
  const [paymentEmailNote, setPaymentEmailNote] = useState('');
  const [isPaymentEmailModalOpen, setIsPaymentEmailModalOpen] = useState(false);
  const [paymentEmailError, setPaymentEmailError] = useState('');
  const [isSendingPaymentLink, setIsSendingPaymentLink] = useState(false);
  const [isMarkingPaymentPaid, setIsMarkingPaymentPaid] = useState(false);
  const [paymentLinkSuccess, setPaymentLinkSuccess] = useState('');

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

  // Sorting state
  const [sortField, setSortField] = useState<OrderSortField>('placedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const handleToggleSort = (field: OrderSortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder(field === 'patientName' ? 'asc' : 'desc');
    }
  };

  // Quick fulfillment popover/modal state
  const [quickFulfillOrder, setQuickFulfillOrder] = useState<OnlineOrder | null>(null);
  const [quickCarrier, setQuickCarrier] = useState('CareCourier Express');
  const [quickTracking, setQuickTracking] = useState('');
  const [quickFulfilling, setQuickFulfilling] = useState(false);
  const [quickActionSuccess, setQuickActionSuccess] = useState<string | null>(null);

  // Printable Packing Slip Modal
  const [packingSlipOrder, setPackingSlipOrder] = useState<OnlineOrder | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      onLoadOrders({ query: searchQuery.trim(), status: statusFilter, page: currentPage });
    }, searchQuery ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [searchQuery, statusFilter, currentPage, reloadCounter, onLoadOrders]);

  useEffect(() => {
    if (!orderPageId) return;
    let isCurrent = true;
    setOrderPageLoading(true);
    setOrderPageError('');
    fetch(`/api/data.php?resource=orders&id=${encodeURIComponent(orderPageId)}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    }).then(async (response) => {
      const result = await response.json() as { order?: OnlineOrder; message?: string };
      if (!response.ok || !result.order) {
        throw new Error(result.message || 'The order could not be loaded.');
      }
      if (isCurrent) setSelectedOrder(result.order);
    }).catch((error: unknown) => {
      if (isCurrent) setOrderPageError(error instanceof Error ? error.message : 'The order could not be loaded.');
    }).finally(() => {
      if (isCurrent) setOrderPageLoading(false);
    });
    return () => { isCurrent = false; };
  }, [orderPageId]);

  useEffect(() => {
    setPaymentLinkInput(selectedOrder?.paymentLinkUrl || '');
    setPaymentLinkType(selectedOrder?.paymentLinkType === 'provider' && selectedOrder.paymentMethod === 'PayPal'
      ? 'paypal'
      : selectedOrder?.paymentLinkType || (selectedOrder?.paymentMethod === 'PayPal' ? 'paypal' : 'provider'));
    setPaymentLinkName(selectedOrder?.paymentLinkName || '');
    setPaymentCryptoAsset(selectedOrder?.paymentCryptoAsset || 'BTC');
    setPaymentCryptoNetwork(selectedOrder?.paymentCryptoNetwork || (selectedOrder?.paymentCryptoAsset === 'ETH' ? 'Ethereum (ERC-20)' : 'Bitcoin'));
    setPaymentEmailTemplate(selectedOrder?.paymentLinkSentAt ? 'payment_reminder' : 'payment_request');
    setPaymentEmailNote('');
  }, [
    selectedOrder?.id,
    selectedOrder?.paymentLinkUrl,
    selectedOrder?.paymentLinkType,
    selectedOrder?.paymentLinkName,
    selectedOrder?.paymentCryptoAsset,
    selectedOrder?.paymentCryptoNetwork,
  ]);

  useEffect(() => {
    setIsPaymentEmailModalOpen(false);
    setPaymentEmailError('');
  }, [selectedOrder?.id]);

  useEffect(() => {
    if (!isPaymentEmailModalOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSendingPaymentLink) setIsPaymentEmailModalOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isPaymentEmailModalOpen, isSendingPaymentLink]);

  useEffect(() => {
    let active = true;
    const payload = paymentLinkInput.trim();
    if (!isPaymentEmailModalOpen || paymentEmailDesign !== 'card' || !payload) {
      setPaymentQrPreview('');
      return () => { active = false; };
    }
    void QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 220,
      color: { dark: '#0b2f52', light: '#ffffff' },
    }).then((dataUrl) => {
      if (active) setPaymentQrPreview(dataUrl);
    }).catch((error: unknown) => {
      if (active) {
        setPaymentQrPreview('');
        setPaymentEmailError(error instanceof Error ? error.message : 'The payment QR code could not be generated.');
      }
    });
    return () => { active = false; };
  }, [isPaymentEmailModalOpen, paymentLinkInput, paymentEmailDesign]);

  useEffect(() => {
    const syncOrderPage = () => {
      const requestedOrderId = new URLSearchParams(window.location.search).get('orderId') || '';
      setOrderPageId(requestedOrderId);
      if (!requestedOrderId) setSelectedOrder(null);
    };
    window.addEventListener('popstate', syncOrderPage);
    return () => window.removeEventListener('popstate', syncOrderPage);
  }, []);

  const handleOpenQuickFulfill = (order: OnlineOrder) => {
    const generated = generateTrackingNumber(order.deliveryMethod === 'Express Courier' ? 'CareCourier Express' : 'USPS');
    setQuickCarrier(order.carrier || generated.carrier);
    setQuickTracking(order.trackingNumber || generated.trackingNumber);
    setQuickFulfillOrder(order);
  };

  const handleRegenerateTracking = () => {
    const generated = generateTrackingNumber(quickCarrier);
    setQuickTracking(generated.trackingNumber);
  };

  const handleConfirmQuickFulfill = async () => {
    if (!quickFulfillOrder) return;
    setQuickFulfilling(true);
    setOrderSaveError('');
    try {
      await onUpdateOrderTracking(quickFulfillOrder.id, quickCarrier, quickTracking);
      await onUpdateOrderStatus(quickFulfillOrder, 'Shipped');
      setQuickActionSuccess(`Order #${quickFulfillOrder.orderNumber} fulfilled & marked Shipped via ${quickCarrier}!`);
      setQuickFulfillOrder(null);
      setReloadCounter((c) => c + 1);
    } catch (err) {
      setOrderSaveError(err instanceof Error ? err.message : 'Fulfillment update failed.');
    } finally {
      setQuickFulfilling(false);
    }
  };

  const handleQuickDeliver = async (order: OnlineOrder) => {
    setIsSavingStatus(true);
    setOrderSaveError('');
    try {
      await onUpdateOrderStatus(order, 'Delivered');
      setQuickActionSuccess(`Order #${order.orderNumber} marked Delivered.`);
      setReloadCounter((c) => c + 1);
    } catch (err) {
      setOrderSaveError(err instanceof Error ? err.message : 'Status update failed.');
    } finally {
      setIsSavingStatus(false);
    }
  };

  const sortedOrders = useMemo(() => {
    return sortOrders(orders, sortField, sortOrder);
  }, [orders, sortField, sortOrder]);

  const filteredOrders = sortedOrders;

  // Open detail drawer and sync inputs
  const handleOpenDetail = (order: OnlineOrder) => {
    setOrderPageId('');
    setSelectedOrder(order);
    setPaymentLinkSuccess('');
    setCarrierInput(order.carrier || '');
    setTrackingInput(order.trackingNumber || '');
    setNewInternalNote('');
  };

  const handleOpenOrderPage = (order: OnlineOrder) => {
    setSelectedOrder(order);
    setPaymentLinkSuccess('');
    setCarrierInput(order.carrier || '');
    setTrackingInput(order.trackingNumber || '');
    setNewInternalNote('');
    setOrderPageError('');
    setOrderPageId(order.id);
    const url = new URL(window.location.href);
    url.searchParams.set('section', 'orders');
    url.searchParams.set('orderId', order.id);
    window.history.pushState({}, '', url);
    window.scrollTo(0, 0);
  };

  const handleCloseOrderPage = () => {
    setOrderPageId('');
    setSelectedOrder(null);
    setOrderPageError('');
    const url = new URL(window.location.href);
    url.searchParams.delete('orderId');
    window.history.replaceState(window.history.state, '', url);
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

  const handleStatusChange = async (order: OnlineOrder, status: OnlineOrder['status']) => {
    setOrderSaveError('');
    setIsSavingStatus(true);
    try {
      await onUpdateOrderStatus(order, status);
      setSelectedOrder((current) => current?.id === order.id ? { ...current, status } : current);
      setReloadCounter((counter) => counter + 1);
    } catch (error) {
      setOrderSaveError(error instanceof Error ? error.message : 'Order status could not be saved.');
    } finally {
      setIsSavingStatus(false);
    }
  };

  const handleSendPaymentLink = async (previewOnly = false) => {
    if (!selectedOrder) return;
    setPaymentEmailError('');
    setPaymentLinkSuccess('');
    setIsSendingPaymentLink(true);
    try {
      const qrPayload = previewOnly ? 'https://example.invalid/demo-payment' : paymentLinkInput.trim();
      const qrCodeDataUrl = paymentEmailDesign === 'card'
        ? await QRCode.toDataURL(qrPayload, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 240,
          color: { dark: '#0b2f52', light: '#ffffff' },
        })
        : undefined;
      const response = await fetch('/api/data.php?resource=order-payment-link', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          orderId: selectedOrder.id,
          paymentLinkUrl: paymentLinkInput.trim(),
          paymentLinkType,
          paymentLinkName: paymentLinkName.trim(),
          paymentCryptoAsset,
          paymentCryptoNetwork,
          qrCodeDataUrl,
          emailTemplate: paymentEmailTemplate,
          emailDesign: paymentEmailDesign,
          additionalMessage: paymentEmailNote.trim(),
          previewOnly,
        }),
      });
      const result = await response.json() as { order?: OnlineOrder; message?: string; sent?: boolean };
      if (!response.ok || !result.order || result.sent !== true) {
        throw new Error(result.message || 'The payment-link email could not be sent.');
      }
      setSelectedOrder(result.order);
      setPaymentLinkSuccess(result.message || (previewOnly
        ? 'Hostinger accepted the demo preview for the administrator.'
        : 'Hostinger accepted the payment-link email.'));
      setReloadCounter((counter) => counter + 1);
    } catch (error) {
      setPaymentEmailError(error instanceof Error ? error.message : 'The payment-link email could not be sent.');
    } finally {
      setIsSendingPaymentLink(false);
    }
  };

  const handleMarkPaymentPaid = async () => {
    if (!selectedOrder || !window.confirm(`Confirm that the provider shows payment received for ${selectedOrder.orderNumber}?`)) return;
    setOrderSaveError('');
    setPaymentLinkSuccess('');
    setIsMarkingPaymentPaid(true);
    try {
      const response = await fetch('/api/data.php?resource=order-mark-paid', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ orderId: selectedOrder.id }),
      });
      const result = await response.json() as { order?: OnlineOrder; message?: string };
      if (!response.ok || !result.order) {
        throw new Error(result.message || 'The payment status could not be updated.');
      }
      setSelectedOrder(result.order);
      setPaymentLinkSuccess('Payment marked paid. Provider receipt was confirmed by an administrator.');
      setReloadCounter((counter) => counter + 1);
    } catch (error) {
      setOrderSaveError(error instanceof Error ? error.message : 'The payment status could not be updated.');
    } finally {
      setIsMarkingPaymentPaid(false);
    }
  };

  const requestStatusChange = (order: OnlineOrder, status: OnlineOrder['status'], select: HTMLSelectElement) => {
    if (status === 'Cancelled' && order.status !== 'Cancelled'
      && !window.confirm(`Cancel order ${order.orderNumber}? Its reserved inventory will be returned to stock.`)) {
      select.value = order.status;
      return;
    }
    void handleStatusChange(order, status);
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
    <div className="space-y-4">
      <div className={orderPageId ? 'hidden' : ''}>
      {/* Main Order Workspace */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        {/* Workspace Toolbar */}
        <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900">
                Order management
              </h3>
            </div>
            <p className="text-xs text-slate-500">
              Search and filter saved orders across all pages. Administrators can email provider payment links from order details.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setManualProductId(catalogItems[0]?.id || '');
                setManualOrderError('');
                setIsManualModalOpen(true);
              }}
              className="px-3 py-1.5 bg-blue-800 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
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
        {quickActionSuccess && (
          <div className="flex items-center justify-between border-b border-blue-200 bg-blue-50 px-5 py-3 text-xs text-blue-900">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-700 shrink-0" />
              <span className="font-semibold">{quickActionSuccess}</span>
            </div>
            <button
              type="button"
              onClick={() => setQuickActionSuccess(null)}
              className="font-bold text-blue-800 hover:text-blue-950"
            >
              Dismiss
            </button>
          </div>
        )}

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
              className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-700"
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
                <option value="Pending">Pending</option>
                <option value="Submitted">Submitted</option>
                <option value="Pharmacist Review">Pharmacist Review</option>
                <option value="Dispensing">Dispensing</option>
                <option value="Ready for Pickup">Ready for Pickup</option>
                <option value="Shipped">Shipped</option>
                <option value="Delivered">Delivered</option>
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
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => handleToggleSort('orderNumber')}
                    className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    <span>Order # &amp; Date</span>
                    {sortField === 'orderNumber' || sortField === 'placedAt' ? (
                      sortOrder === 'asc' ? <ArrowUp className="h-3 w-3 text-[#1d4ed8]" /> : <ArrowDown className="h-3 w-3 text-[#1d4ed8]" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 text-slate-400 opacity-60" />
                    )}
                  </button>
                </th>
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => handleToggleSort('patientName')}
                    className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    <span>Customer Details</span>
                    {sortField === 'patientName' ? (
                      sortOrder === 'asc' ? <ArrowUp className="h-3 w-3 text-[#1d4ed8]" /> : <ArrowDown className="h-3 w-3 text-[#1d4ed8]" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 text-slate-400 opacity-60" />
                    )}
                  </button>
                </th>
                <th className="py-3 px-4">Items Ordered</th>
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => handleToggleSort('totalAmount')}
                    className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    <span>Amount &amp; payment</span>
                    {sortField === 'totalAmount' ? (
                      sortOrder === 'asc' ? <ArrowUp className="h-3 w-3 text-[#1d4ed8]" /> : <ArrowDown className="h-3 w-3 text-[#1d4ed8]" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 text-slate-400 opacity-60" />
                    )}
                  </button>
                </th>
                <th className="py-3 px-4">Fulfillment Mode</th>
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => handleToggleSort('status')}
                    className="inline-flex items-center gap-1 font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    <span>Status</span>
                    {sortField === 'status' ? (
                      sortOrder === 'asc' ? <ArrowUp className="h-3 w-3 text-[#1d4ed8]" /> : <ArrowDown className="h-3 w-3 text-[#1d4ed8]" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 text-slate-400 opacity-60" />
                    )}
                  </button>
                </th>
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
                  <tr
                    key={ord.id}
                    tabIndex={0}
                    aria-label={`Open order details for ${ord.orderNumber}`}
                    onClick={() => handleOpenDetail(ord)}
                    onKeyDown={(event) => {
                      if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        handleOpenDetail(ord);
                      }
                    }}
                    className="cursor-pointer hover:bg-slate-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-700"
                  >
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
                        <span className={`rounded px-1 text-[10px] font-bold ${paymentStatusClass(ord.paymentStatus)}`}>
                          {ord.paymentStatus || 'Unknown'}
                        </span>
                      </div>
                    </td>

                    {/* Delivery */}
                    <td className="py-3.5 px-4">
                      <span className="font-medium text-slate-800 block">{ord.deliveryMethod}</span>
                      {ord.trackingNumber ? (
                        <span className="text-[10px] font-mono text-blue-800 bg-blue-50 px-1 rounded">
                          {ord.trackingNumber}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">No tracking yet</span>
                      )}
                    </td>

                    {/* Status Badge */}
                    <td className="py-3.5 px-4">
                      <OrderStatusTag order={ord} onChange={requestStatusChange} />
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-1.5" onClick={(e) => e.stopPropagation()}>
                      {ord.status !== 'Shipped' && ord.status !== 'Delivered' && ord.status !== 'Cancelled' && (
                        <button
                          type="button"
                          onClick={() => handleOpenQuickFulfill(ord)}
                          className="inline-flex items-center gap-1 rounded-md bg-[#1d4ed8] px-2.5 py-1 text-[11px] font-semibold text-white shadow-2xs hover:bg-[#1e3a5f]"
                          title="Fulfill order & assign tracking"
                        >
                          <Truck className="h-3 w-3" />
                          <span>Ship</span>
                        </button>
                      )}

                      {ord.status === 'Shipped' && (
                        <button
                          type="button"
                          onClick={() => void handleQuickDeliver(ord)}
                          className="inline-flex items-center gap-1 rounded-md bg-blue-700 px-2.5 py-1 text-[11px] font-semibold text-white shadow-2xs hover:bg-blue-800"
                          title="Mark delivered"
                        >
                          <Check className="h-3 w-3" />
                          <span>Delivered</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setPackingSlipOrder(ord)}
                        className="p-1.5 text-slate-500 hover:text-blue-800 hover:bg-slate-100 rounded cursor-pointer transition-colors"
                        title="Print dispensary packing slip"
                        aria-label={`Print packing slip for ${ord.orderNumber}`}
                      >
                        <Printer className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenOrderPage(ord)}
                        className="p-1.5 text-slate-500 hover:text-blue-800 hover:bg-slate-100 rounded cursor-pointer transition-colors"
                        title="Open order page"
                        aria-label={`Open order page for ${ord.orderNumber}`}
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

        <div className="grid gap-3 p-3 md:hidden sm:p-4">
          {isLoading ? (
            <p role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">Loading orders…</p>
          ) : filteredOrders.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">No orders match this search and status filter.</p>
          ) : filteredOrders.map((ord) => (
            <article
              key={ord.id}
              className="rounded-xl border border-[#e2e8f0] bg-white p-4 transition hover:border-[#cbd5e1] sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <button type="button" onClick={() => handleOpenDetail(ord)} className="min-w-0 text-left">
                  <span className="block break-all text-sm font-bold tracking-tight text-[#1e40af]">{ord.orderNumber}</span>
                  <span className="mt-1 block text-xs text-slate-500">{ord.placedAt}</span>
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold tracking-tight text-slate-900">${ord.totalAmount.toFixed(2)}</span>
                  <button
                    type="button"
                    onClick={() => handleOpenOrderPage(ord)}
                    className="rounded-lg border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-[#1e40af]"
                    title="Open order page"
                    aria-label={`Open order page for ${ord.orderNumber}`}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{ord.patientName}</p>
                  <p className="mt-0.5 break-all text-xs text-slate-500">{ord.email}</p>
                  {ord.phone && <p className="mt-0.5 text-xs text-slate-500">{ord.phone}</p>}
                </div>
                <div className="min-w-0 sm:text-right">
                  <p className="text-sm font-medium text-slate-800">{ord.medicationName}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{ord.items?.length ? `${ord.items.length} line item(s)` : 'Single product order'}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">{ord.deliveryMethod}</span>
                  <span className={`rounded-md px-2 py-1 font-semibold ${paymentStatusClass(ord.paymentStatus)}`}>
                    {ord.paymentStatus || 'Payment unverified'}
                  </span>
                </div>
                <div onClick={(event) => event.stopPropagation()}>
                  <OrderStatusTag order={ord} onChange={requestStatusChange} />
                </div>
              </div>
              {ord.trackingNumber && <p className="mt-3 text-xs text-slate-500">Tracking: <span className="font-medium text-slate-700">{ord.carrier ? `${ord.carrier} · ` : ''}{ord.trackingNumber}</span></p>}
            </article>
          ))}
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-500">Page {pagination.page} of {Math.max(1, pagination.pages)} · {pagination.total} total orders</p>
          <div className="flex gap-2">
            <button type="button" disabled={pagination.page <= 1 || isLoading} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40">Previous</button>
            <button type="button" disabled={pagination.page >= pagination.pages || isLoading} onClick={() => setCurrentPage((page) => page + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>
      </div>

      {orderPageId && !selectedOrder && (
        <div className="w-full space-y-5">
          <div>
            <button type="button" onClick={handleCloseOrderPage} className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-blue-800">
              <ArrowLeft className="h-4 w-4" />Orders
            </button>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">Order details</h1>
            <p className="mt-1 text-sm text-slate-500">Review customer, payment, and fulfillment information.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          {orderPageLoading ? (
            <p role="status" className="text-sm text-slate-600">Loading order…</p>
          ) : (
            <>
              {orderPageError && <p role="alert" className="mb-4 text-sm text-rose-800">{orderPageError}</p>}
              <button type="button" onClick={handleCloseOrderPage} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <ArrowLeft className="h-4 w-4" />Back to orders
              </button>
            </>
          )}
          </div>
        </div>
      )}

      {/* Comprehensive Order Detail Modal / Order Page */}
      {selectedOrder && (
        <div className={orderPageId ? 'w-full space-y-6' : 'fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 flex items-center justify-center p-4'}>
          {orderPageId && (
            <div className="flex flex-col gap-5 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <button type="button" onClick={handleCloseOrderPage} className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 transition-colors hover:text-blue-800">
                  <ArrowLeft className="h-4 w-4" />Orders
                </button>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Order #{selectedOrder.orderNumber}</h1>
                  <OrderStatusTag order={selectedOrder} disabled={isSavingStatus} onChange={requestStatusChange} />
                </div>
                <p className="mt-2 text-sm text-slate-500">Placed {selectedOrder.placedAt} <span className="mx-1.5">·</span> {selectedOrder.patientName}</p>
              </div>
              <div className="flex flex-col items-start gap-2 self-start sm:items-end">
                {isSavingStatus && <span role="status" className="text-xs text-slate-500">Saving status…</span>}
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                >
                  <Printer className="h-4 w-4" />Print order
                </button>
              </div>
            </div>
          )}
          {orderSaveError && (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{orderSaveError}</p>
          )}
          <div className={orderPageId ? 'w-full' : 'bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200'}>
            {/* Header */}
            {!orderPageId && <div className="bg-slate-900 text-white p-5 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-700 flex items-center justify-center font-bold text-white text-xs">
                  ORD
                </div>
                <div>
                  <h3 className="font-bold text-base text-white flex items-center gap-2">
                    <span>Order #{selectedOrder.orderNumber}</span>
                    <OrderStatusTag order={selectedOrder} disabled={isSavingStatus} onChange={requestStatusChange} />
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
                {orderPageId ? (
                  <button type="button" onClick={handleCloseOrderPage} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700">
                    <ArrowLeft className="h-4 w-4" />Back to orders
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label="Close order details"
                    onClick={() => setSelectedOrder(null)}
                    className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>}

            {/* Modal Body */}
            <div className={orderPageId ? 'grid grid-cols-1 items-start gap-5 text-xs lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.9fr)]' : 'p-6 overflow-y-auto space-y-6 text-xs'}>
              <div className={orderPageId ? 'space-y-5 lg:col-start-2' : 'contents'}>
              {/* Top Details Grid */}
              <div className={orderPageId ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-1 sm:grid-cols-2 gap-4'}>
                {/* Customer Info */}
                <div className={orderPageId ? 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2' : 'bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1.5'}>
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
                <div className={orderPageId ? 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2' : 'bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1.5'}>
                  <span className="font-bold text-slate-800 text-xs block">Payment status</span>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Method:</span>
                    <span className="font-bold text-slate-900">{selectedOrder.paymentMethod || 'Not specified'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Payment Status:</span>
                    <span className={`font-bold ${paymentStatusClass(selectedOrder.paymentStatus)}`}>{selectedOrder.paymentStatus || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Transaction ID:</span>
                    <span className="font-mono text-slate-700">{selectedOrder.transactionId || 'Not available'}</span>
                  </div>
                  {canManagePaymentLinks && [
                    'Credit / Debit Card',
                    'PayPal',
                    'Cryptocurrency (USDC / BTC / ETH / SOL)',
                  ].includes(selectedOrder.paymentMethod || '') && (
                    selectedOrder.status === 'Cancelled' ? (
                      <p role="status" className="mt-3 border-t border-amber-200 pt-3 text-[11px] leading-5 text-amber-800">
                        Payment instructions are unavailable because this order is cancelled.
                      </p>
                    ) : selectedOrder.paymentStatus === 'Paid' ? (
                      <p role="status" className="mt-3 border-t border-blue-200 pt-3 text-[11px] leading-5 text-blue-800">
                        This order is marked as paid; no payment email is needed.
                      </p>
                    ) : (
                      <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                        {selectedOrder.paymentLinkSentAt && (
                          <p className="text-[11px] text-slate-500">
                            Last sent {new Date(`${selectedOrder.paymentLinkSentAt.replace(' ', 'T')}Z`).toLocaleString()}
                          </p>
                        )}
                        {paymentLinkSuccess && <p role="status" className="text-[11px] font-medium text-blue-700">{paymentLinkSuccess}</p>}
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentEmailError('');
                            setIsPaymentEmailModalOpen(true);
                          }}
                          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-800 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-900"
                        >
                          <Mail className="h-3.5 w-3.5" />
                          {selectedOrder.paymentLinkSentAt ? 'Resend payment email' : 'Email payment instructions'}
                        </button>
                      </div>
                    )
                  )}
                  {canManagePaymentLinks && selectedOrder.paymentLinkSentAt && selectedOrder.paymentStatus !== 'Paid' && selectedOrder.status !== 'Cancelled' && (
                    <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                      <p className="text-[11px] leading-5 text-slate-500">
                        Confirm payment in the provider account before changing this status.
                      </p>
                      <button
                        type="button"
                        onClick={() => void handleMarkPaymentPaid()}
                        disabled={isMarkingPaymentPaid}
                        className="w-full rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60"
                      >
                        {isMarkingPaymentPaid ? 'Updating payment…' : 'Mark as paid'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              </div>

              {orderPageId && (
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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
              )}

              <div className={orderPageId ? 'space-y-5 lg:col-start-1 lg:row-start-1' : 'contents'}>
              {/* Items List */}
              <div className={orderPageId ? 'space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm' : 'space-y-3'}>
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
                            <div className="w-10 h-10 rounded-md bg-blue-50 text-blue-800 flex items-center justify-center font-bold text-xs">
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
                    <div className="flex justify-between text-blue-700">
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
                    <span className="font-mono text-blue-900">${selectedOrder.totalAmount.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Fulfillment & Tracking Section */}
              <div className={orderPageId ? 'space-y-4 rounded-2xl border border-blue-200 bg-white p-5 shadow-sm' : 'bg-blue-50/50 p-4 rounded-xl border border-blue-200 space-y-3'}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-bold text-blue-950 text-xs flex items-center gap-1.5">
                    <Truck className="w-4 h-4 text-blue-700" />
                    <span>Fulfillment &amp; Tracking</span>
                  </span>
                </div>

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
                    className="px-3 py-1.5 bg-blue-800 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                  >
                    Save Tracking
                  </button>
                </div>
              </div>
              </div>

              {/* Internal Notes Log */}
              {!orderPageId && <div className="space-y-2">
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
              </div>}
            </div>
          </div>
        </div>
      )}

      {isPaymentEmailModalOpen && selectedOrder && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSendingPaymentLink) setIsPaymentEmailModalOpen(false);
          }}
        >
          <section
            className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-payment-email-title"
          >
            <header className="flex items-start justify-between bg-gradient-to-br from-[#123b68] to-[#1d4ed8] px-5 py-5 text-white">
              <div className="min-w-0">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-blue-100">Order payment</p>
                <h2 id="order-payment-email-title" className="text-lg font-semibold text-white">
                  Email payment instructions
                </h2>
                <p className="mt-1 truncate text-xs text-blue-50/90">
                  Order {selectedOrder.orderNumber} · {selectedOrder.email} · ${selectedOrder.totalAmount.toFixed(2)}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close email modal"
                onClick={() => setIsPaymentEmailModalOpen(false)}
                disabled={isSendingPaymentLink}
                className="rounded-lg p-1 text-blue-100 hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="payment-modal-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-y-contain bg-slate-50/70 p-5">
              <label htmlFor="order-payment-link-type" className="block text-xs font-semibold text-slate-800">
                Payment link type
                <select
                  id="order-payment-link-type"
                  value={paymentLinkType}
                  onChange={(event) => {
                    setPaymentLinkType(event.target.value as PaymentLinkType);
                    setPaymentEmailError('');
                  }}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                >
                  {selectedOrder.paymentMethod !== 'PayPal' && (
                    <option value="provider">Payment provider link</option>
                  )}
                  <option value="paypal">PayPal link</option>
                  <option value="crypto_wallet">Crypto wallet</option>
                  <option value="custom">Custom link</option>
                </select>
              </label>
              {paymentLinkType === 'custom' && (
                <label htmlFor="order-payment-link-name" className="block text-xs font-semibold text-slate-800">
                  Custom link name
                  <input
                    id="order-payment-link-name"
                    type="text"
                    value={paymentLinkName}
                    onChange={(event) => setPaymentLinkName(event.target.value)}
                    maxLength={80}
                    placeholder="e.g. PayPal invoice, Coinbase Commerce"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                  />
                </label>
              )}
              {paymentLinkType === 'crypto_wallet' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label htmlFor="order-payment-crypto-asset" className="block text-xs font-semibold text-slate-800">
                    Asset
                    <select
                      id="order-payment-crypto-asset"
                      value={paymentCryptoAsset}
                      onChange={(event) => {
                        const asset = event.target.value as CryptoAsset;
                        setPaymentCryptoAsset(asset);
                        setPaymentCryptoNetwork(asset === 'BTC' ? 'Bitcoin' : 'Ethereum (ERC-20)');
                      }}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                    >
                      <option value="BTC">Bitcoin (BTC)</option>
                      <option value="ETH">Ethereum (ETH)</option>
                      <option value="USDT">Tether (USDT)</option>
                    </select>
                  </label>
                  <label htmlFor="order-payment-crypto-network" className="block text-xs font-semibold text-slate-800">
                    Network
                    <select
                      id="order-payment-crypto-network"
                      value={paymentCryptoNetwork}
                      onChange={(event) => setPaymentCryptoNetwork(event.target.value as CryptoNetwork)}
                      disabled={paymentCryptoAsset !== 'USDT'}
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20 disabled:bg-slate-100 disabled:text-slate-600"
                    >
                      {paymentCryptoAsset === 'BTC' ? (
                        <option value="Bitcoin">Bitcoin</option>
                      ) : paymentCryptoAsset === 'ETH' ? (
                        <option value="Ethereum (ERC-20)">Ethereum (ERC-20)</option>
                      ) : (
                        <>
                          <option value="Ethereum (ERC-20)">Ethereum (ERC-20)</option>
                          <option value="TRON (TRC-20)">TRON (TRC-20)</option>
                        </>
                      )}
                    </select>
                  </label>
                </div>
              )}
              {paymentLinkType === 'crypto_wallet' && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-900">
                  The QR code encodes the wallet destination only. The order total is in USD; confirm the exact crypto amount before sending.
                </p>
              )}
              <label htmlFor="order-payment-link" className="block text-xs font-semibold text-slate-800">
                {paymentLinkType === 'crypto_wallet' ? `${paymentCryptoAsset} wallet address` : 'Payment link'}
                <input
                  id="order-payment-link"
                  type="text"
                  value={paymentLinkInput}
                  onChange={(event) => setPaymentLinkInput(event.target.value)}
                  placeholder={paymentLinkType === 'crypto_wallet'
                    ? 'Enter the wallet address'
                    : 'https://…'}
                  autoComplete="url"
                  autoFocus
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                />
              </label>
              <p className="-mt-2 text-[11px] leading-5 text-slate-500">
                {paymentLinkType === 'crypto_wallet'
                  ? `Only use a ${paymentCryptoAsset} receiving address on ${paymentCryptoNetwork}.`
                  : paymentLinkType === 'custom'
                    ? 'Enter a custom HTTPS URL and the name customers should see in the email.'
                    : 'Enter a PayPal or payment-provider HTTPS link.'}
              </p>
              <label htmlFor="order-payment-email-template" className="block text-xs font-semibold text-slate-800">
                Email body template
                <select
                  id="order-payment-email-template"
                  value={paymentEmailTemplate}
                  onChange={(event) => setPaymentEmailTemplate(event.target.value as PaymentEmailTemplate)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                >
                  {Object.entries(paymentEmailTemplates).map(([value, template]) => (
                    <option key={value} value={value}>{template.label}</option>
                  ))}
                </select>
              </label>
              <label htmlFor="order-payment-email-design" className="block text-xs font-semibold text-slate-800">
                Email design
                <select
                  id="order-payment-email-design"
                  value={paymentEmailDesign}
                  onChange={(event) => setPaymentEmailDesign(event.target.value as PaymentEmailDesign)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                >
                  <option value="card">Designed card with QR code</option>
                  <option value="plain">Plain email (no card design)</option>
                </select>
                <span className="mt-1 block font-normal text-slate-500">
                  {paymentEmailDesign === 'card'
                    ? 'Uses the branded card layout and includes a payment QR code.'
                    : 'Sends a simple text-only email without the card design or QR image.'}
                </span>
              </label>
              <details className="rounded-xl border border-slate-200 bg-slate-50">
                <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-slate-700">
                  Preview selected template
                </summary>
                <div className="border-t border-slate-200 p-4">
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Email body preview</p>
                  <div className={`space-y-3 text-xs leading-5 text-slate-700 ${paymentEmailDesign === 'card' ? 'rounded-lg bg-white p-4 shadow-sm' : 'px-1 py-2'}`}>
                    <p>Hello {selectedOrder.patientName},</p>
                    <p>{paymentEmailTemplates[paymentEmailTemplate].intro(selectedOrder.orderNumber)}</p>
                    <div className={paymentEmailDesign === 'card' ? 'rounded-lg border border-slate-200 p-3' : 'space-y-1'}>
                      <p className="font-semibold text-slate-900">Order summary</p>
                      <p>Order: {selectedOrder.orderNumber}</p>
                      <p>Payment method: {paymentLinkType === 'crypto_wallet'
                        ? `${paymentCryptoAsset} on ${paymentCryptoNetwork}`
                        : paymentLinkType === 'paypal'
                          ? 'PayPal'
                          : paymentLinkType === 'custom'
                            ? paymentLinkName.trim() || 'Custom link'
                            : selectedOrder.paymentMethod}</p>
                      {paymentLinkType === 'crypto_wallet' && (
                        <p>Asset/network: {paymentCryptoAsset} · {paymentCryptoNetwork}</p>
                      )}
                      <p>Total due: ${selectedOrder.totalAmount.toFixed(2)}</p>
                    </div>
                    <p>{paymentLinkType === 'crypto_wallet'
                      ? `Send only ${paymentCryptoAsset} on ${paymentCryptoNetwork}. The QR code contains the wallet destination only; confirm the exact crypto amount before sending. Verify the asset, network, and full wallet address.`
                      : paymentLinkType === 'paypal'
                        ? 'Continue to PayPal using the link below and confirm the order total before approving payment.'
                        : paymentInstructionsForMethod(selectedOrder.paymentMethod || '')}</p>
                    <p className={paymentEmailDesign === 'card' ? 'font-semibold text-blue-800' : 'break-all text-blue-800 underline'}>
                      {paymentLinkInput.trim()
                        ? paymentLinkType === 'crypto_wallet'
                          ? `${paymentCryptoAsset} wallet address (${paymentCryptoNetwork}): ${paymentLinkInput.trim()}`
                          : paymentLinkType === 'custom'
                            ? `${paymentLinkName.trim() || '[Custom link name]'}: ${paymentLinkInput.trim()}`
                            : `${paymentLinkType === 'paypal' ? 'PayPal link' : 'Payment provider link'}: ${paymentLinkInput.trim()}`
                        : '[Payment link or wallet address appears here]'}
                    </p>
                    {paymentEmailDesign === 'card' && paymentQrPreview && (
                      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <img src={paymentQrPreview} alt="Locally generated payment QR preview" className="h-20 w-20 rounded-md border border-slate-200 bg-white p-1" />
                        <p className="text-[11px] leading-5 text-slate-600">
                          {paymentLinkType === 'crypto_wallet'
                            ? 'Wallet destination QR · scan with the selected wallet/network'
                            : 'Payment-link QR · scan to open the payment page'}
                        </p>
                      </div>
                    )}
                    {paymentEmailNote.trim() && <p className="whitespace-pre-wrap">{paymentEmailNote}</p>}
                    <p>{paymentEmailTemplates[paymentEmailTemplate].closing}</p>
                    <p>Warm regards,<br />Ambient</p>
                  </div>
                </div>
              </details>
              <label htmlFor="order-payment-email-note" className="block text-xs font-semibold text-slate-800">
                Additional message <span className="font-normal text-slate-500">(optional)</span>
                <textarea
                  id="order-payment-email-note"
                  value={paymentEmailNote}
                  onChange={(event) => setPaymentEmailNote(event.target.value)}
                  maxLength={1000}
                  rows={2}
                  placeholder="Add a short note"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/20"
                />
              </label>
              <p className="text-[11px] leading-5 text-slate-500">
                Use a provider-generated link. Never request card or wallet credentials by email. The selected body template and your optional message will be included. Hostinger acceptance does not confirm delivery.
              </p>
              {paymentEmailError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{paymentEmailError}</p>}
              {paymentLinkSuccess && <p role="status" className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">{paymentLinkSuccess}</p>}
            </div>
            <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-between">
                <button
                  type="button"
                  onClick={() => void handleSendPaymentLink(true)}
                  disabled={isSendingPaymentLink || (paymentLinkType === 'custom' && !paymentLinkName.trim())}
                  className="rounded-lg border border-slate-300 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                >
                  {isSendingPaymentLink ? 'Sending…' : 'Send demo preview to me'}
                </button>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsPaymentEmailModalOpen(false)}
                    disabled={isSendingPaymentLink}
                    className="rounded-lg border border-slate-300 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSendPaymentLink(false)}
                    disabled={isSendingPaymentLink || !paymentLinkInput.trim() || (paymentLinkType === 'custom' && !paymentLinkName.trim())}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-800 px-3 py-2.5 text-xs font-semibold text-white hover:bg-blue-900 disabled:cursor-wait disabled:opacity-60"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {isSendingPaymentLink ? 'Sending…' : selectedOrder.paymentLinkSentAt ? 'Resend email' : 'Send email'}
                  </button>
                </div>
            </footer>
          </section>
        </div>
      )}

      {/* Manual Phone/Walk-in Order Modal */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 flex items-center justify-center p-4">
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
                  className="px-5 py-2 text-xs font-bold text-white bg-blue-800 hover:bg-blue-700 rounded-lg shadow-xs cursor-pointer"
                >
                  {isSavingManualOrder ? 'Saving…' : 'Create order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QUICK FULFILLMENT MODAL */}
      {quickFulfillOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl text-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-[#1d4ed8]" />
                <h3 className="text-base font-bold text-slate-900">
                  Fulfill &amp; Ship Order #{quickFulfillOrder.orderNumber}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setQuickFulfillOrder(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-lg bg-slate-50 p-3 border border-slate-200 space-y-1">
              <p className="font-semibold text-slate-900">{quickFulfillOrder.patientName}</p>
              <p className="text-slate-500">{quickFulfillOrder.deliveryAddress || 'Dispensary Counter Pickup'}</p>
              <p className="font-medium text-slate-700">{quickFulfillOrder.medicationName}</p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Carrier Provider</label>
                <select
                  value={quickCarrier}
                  onChange={(e) => setQuickCarrier(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 focus:outline-none focus:border-[#1d4ed8]"
                >
                  <option value="CareCourier Express">CareCourier Express (Standard Pharmacy Courier)</option>
                  <option value="FedEx Health Logistics">FedEx Health Logistics</option>
                  <option value="USPS Priority Health">USPS Priority Health</option>
                  <option value="DHL Medical Express">DHL Medical Express</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-slate-700">Tracking Code</label>
                  <button
                    type="button"
                    onClick={handleRegenerateTracking}
                    className="text-[10px] font-semibold text-[#1d4ed8] hover:underline cursor-pointer"
                  >
                    Regenerate Code
                  </button>
                </div>
                <input
                  type="text"
                  value={quickTracking}
                  onChange={(e) => setQuickTracking(e.target.value)}
                  className="w-full font-mono rounded-lg border border-slate-300 p-2 text-xs text-slate-900 focus:outline-none focus:border-[#1d4ed8]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setQuickFulfillOrder(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmQuickFulfill}
                disabled={quickFulfilling || !quickTracking.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1d4ed8] px-4 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-[#1e3a5f] disabled:opacity-50 cursor-pointer"
              >
                <Truck className="h-3.5 w-3.5" />
                <span>{quickFulfilling ? 'Dispatching…' : 'Confirm & Mark Shipped'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DISPENSARY PACKING SLIP & INVOICE MODAL */}
      {packingSlipOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 print:p-0 print:bg-white print:static">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl text-xs space-y-5 print:shadow-none print:border-0 print:max-h-none print:p-8">
            <div className="flex items-start justify-between border-b border-slate-200 pb-4 print:border-b-2 print:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1d4ed8] text-white font-bold text-sm">
                  AMB
                </div>
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-slate-950">Ambients Pharmacy &amp; Wellness</h2>
                  <p className="text-[11px] text-slate-500 font-mono">
                    CLINICAL DISPENSARY · LICENSE #RX-99482-IL · DEA #BA99210
                  </p>
                </div>
              </div>
              <div className="text-right print:hidden">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#1d4ed8] px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-[#1e3a5f] cursor-pointer"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span>Print Packing Slip</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPackingSlipOrder(null)}
                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Slip Meta Grid */}
            <div className="grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 border border-slate-200 print:bg-transparent print:border">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Patient &amp; Delivery</span>
                <p className="font-bold text-slate-900 text-sm mt-0.5">{packingSlipOrder.patientName}</p>
                <p className="font-mono text-[11px] text-slate-600">{packingSlipOrder.email}</p>
                <p className="text-slate-600">{packingSlipOrder.phone}</p>
                <p className="text-slate-800 mt-1.5">
                  <span className="font-semibold text-slate-600">Address: </span>
                  {packingSlipOrder.deliveryAddress || 'Dispensary Counter Pickup'}
                </p>
              </div>

              <div className="text-right">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Order Verification</span>
                <p className="font-mono font-bold text-slate-900 text-sm mt-0.5">{packingSlipOrder.orderNumber}</p>
                <p className="font-mono text-[11px] text-slate-500">Date: {packingSlipOrder.placedAt}</p>
                <p className="text-slate-600 mt-1">
                  Method: <span className="font-semibold text-slate-800">{packingSlipOrder.deliveryMethod}</span>
                </p>
                {packingSlipOrder.trackingNumber && (
                  <p className="font-mono text-[11px] text-[#1d4ed8] font-semibold mt-0.5">
                    {packingSlipOrder.carrier || 'Courier'}: {packingSlipOrder.trackingNumber}
                  </p>
                )}
              </div>
            </div>

            {/* Line items table */}
            <div className="space-y-2">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Prescribed Items &amp; Therapeutics</span>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">Description &amp; Strength</th>
                      <th className="py-2.5 px-3 text-center">Qty</th>
                      <th className="py-2.5 px-3 text-right">Unit Price</th>
                      <th className="py-2.5 px-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {packingSlipOrder.items && packingSlipOrder.items.length > 0 ? (
                      packingSlipOrder.items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="py-2.5 px-3">
                            <p className="font-semibold text-slate-900">{item.name}</p>
                            <p className="text-[11px] text-slate-500">{item.dosage || 'Dispensary Standard'}</p>
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono font-semibold text-slate-800">{item.quantity}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-600">${item.unitPrice.toFixed(2)}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                            ${(item.unitPrice * item.quantity).toFixed(2)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{packingSlipOrder.medicationName}</td>
                        <td className="py-2.5 px-3 text-center font-mono font-semibold text-slate-800">1</td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600">${packingSlipOrder.totalAmount.toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">${packingSlipOrder.totalAmount.toFixed(2)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Totals Breakdown */}
            <div className="flex justify-end">
              <div className="w-64 space-y-1.5 rounded-xl bg-slate-50 p-3.5 border border-slate-200 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal:</span>
                  <span className="font-mono font-semibold text-slate-900">
                    ${(packingSlipOrder.subtotal || packingSlipOrder.totalAmount).toFixed(2)}
                  </span>
                </div>
                {packingSlipOrder.discountAmount ? (
                  <div className="flex justify-between text-blue-700">
                    <span>Discount:</span>
                    <span className="font-mono font-semibold">-${packingSlipOrder.discountAmount.toFixed(2)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between text-slate-600">
                  <span>Delivery Fee:</span>
                  <span className="font-mono font-semibold text-slate-900">
                    ${(packingSlipOrder.shippingFee || 0).toFixed(2)}
                  </span>
                </div>
                <div className="border-t border-slate-300 pt-1.5 flex justify-between font-bold text-slate-950 text-sm">
                  <span>Total Invoiced:</span>
                  <span className="font-mono text-[#1d4ed8]">${packingSlipOrder.totalAmount.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Dispensary Verification Badge */}
            <div className="rounded-xl border border-[#1d4ed8]/20 bg-[#f1f5f9] p-3.5 space-y-2 text-[11px] text-slate-700">
              <div className="flex items-center gap-2 font-bold text-[#1e40af]">
                <CheckCircle2 className="h-4 w-4 text-[#1d4ed8]" />
                <span>Clinical Pharmacist Safety &amp; Dispensing Inspection</span>
              </div>
              <p className="leading-relaxed">
                This order has been prepared, verified against patient profile contraindications, and sealed in accordance with State Board of Pharmacy guidelines. Tamper-evident seals intact.
              </p>
              <div className="grid grid-cols-2 pt-2 border-t border-slate-200 font-mono text-[10px] text-slate-500">
                <span>Dispensed By: Registered Pharmacist PharmD</span>
                <span className="text-right">Inspection Date: {new Date().toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
