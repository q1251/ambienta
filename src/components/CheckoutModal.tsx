import React, { useState } from 'react';
import {
  X,
  CreditCard,
  QrCode,
  CheckCircle2,
  Lock,
  Copy,
  Check,
  Truck,
  Building,
  Mail,
  Tag,
  ShieldCheck,
  Printer,
  Sparkles,
  ArrowRight,
  ChevronRight,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { CartItem, OnlineOrder, PaymentMethod, CryptoPaymentDetails, OrderItem } from '../types/pharmacy';

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  onOrderSuccess: (order: OnlineOrder) => Promise<OnlineOrder>;
  onClearCart: () => void;
}

const CRYPTO_CONFIGS: Record<
  'USDC' | 'BTC' | 'ETH' | 'SOL',
  { name: string; symbol: string; network: string; address: string; ratePerUsd: number; qrColor: string }
> = {
  USDC: {
    name: 'USD Coin',
    symbol: 'USDC',
    network: 'Ethereum (ERC-20) / Polygon / Solana',
    address: '0x71C694294E968f9a2D5d71bB9d09c48b26124d9B',
    ratePerUsd: 1.0,
    qrColor: '#2775CA',
  },
  BTC: {
    name: 'Bitcoin',
    symbol: 'BTC',
    network: 'Bitcoin Native SegWit',
    address: 'bc1q9w3x7g65m3h2m9f8z0p82q9k8v7z0q7l4u82p0',
    ratePerUsd: 0.000014,
    qrColor: '#F7931A',
  },
  ETH: {
    name: 'Ethereum',
    symbol: 'ETH',
    network: 'Ethereum Mainnet',
    address: '0x71C694294E968f9a2D5d71bB9d09c48b26124d9B',
    ratePerUsd: 0.00038,
    qrColor: '#627EEA',
  },
  SOL: {
    name: 'Solana',
    symbol: 'SOL',
    network: 'Solana Mainnet-Beta',
    address: '7XwK8fG9sQ9t3z1bM5h2r4k8v7x0p82q9k8v7z0q7l4u',
    ratePerUsd: 0.0068,
    qrColor: '#14F195',
  },
};

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  onClose,
  cartItems,
  onOrderSuccess,
  onClearCart,
}) => {
  // Customer details
  const [patientName, setPatientName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');

  // Delivery method
  const [deliveryMethod, setDeliveryMethod] = useState<'Express Courier' | 'Pharmacy Pickup' | 'Discreet Mail'>('Express Courier');

  // Coupon code
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discountPercent: number; freeShipping?: boolean } | null>(null);
  const [couponError, setCouponError] = useState('');

  // Payment tab
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash on Delivery / Pickup');
  const [paymentError, setPaymentError] = useState('');

  // Card form state
  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');

  // Crypto state
  const [selectedCrypto, setSelectedCrypto] = useState<'USDC' | 'BTC' | 'ETH' | 'SOL'>('USDC');
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [cryptoTxHash, setCryptoTxHash] = useState('');

  // Order state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<OnlineOrder | null>(null);

  if (!isOpen) return null;

  // Pricing calculations
  const subtotal = cartItems.reduce((acc, ci) => acc + ci.item.price * ci.quantity, 0);
  const rawShipping = deliveryMethod === 'Express Courier' && subtotal < 35 ? 12.0 : 0.0;
  const shippingFee = appliedCoupon?.freeShipping ? 0.0 : rawShipping;
  const discountAmount = appliedCoupon ? (subtotal * appliedCoupon.discountPercent) / 100 : 0.0;
  const totalAmount = Math.max(0, subtotal - discountAmount + shippingFee);

  const handleClose = () => {
    setCompletedOrder(null);
    setPaymentError('');
    onClose();
  };

  // Apply Coupon
  const handleApplyCoupon = (e: React.FormEvent) => {
    e.preventDefault();
    setCouponError('');
    const clean = couponInput.trim().toUpperCase();
    if (!clean) return;

    if (clean === 'AURA10' || clean === 'SAVE10') {
      setAppliedCoupon({ code: clean, discountPercent: 10 });
      setCouponInput('');
    } else if (clean === 'FREESHIP') {
      setAppliedCoupon({ code: clean, discountPercent: 0, freeShipping: true });
      setCouponInput('');
    } else if (clean === 'CRYPTO5') {
      setAppliedCoupon({ code: clean, discountPercent: 5 });
      setCouponInput('');
    } else {
      setCouponError('Invalid coupon code. Try AURA10 or FREESHIP');
    }
  };

  const handleCopyCrypto = () => {
    const config = CRYPTO_CONFIGS[selectedCrypto];
    navigator.clipboard.writeText(config.address);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleProcessCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cartItems.length === 0) return;
    if (paymentMethod !== 'Cash on Delivery / Pickup') {
      setPaymentError('This payment method is not connected yet. No payment has been processed.');
      return;
    }

    setIsSubmitting(true);

    try {
      const orderNum = `ORD-${Date.now().toString().slice(-6)}`;
      const fullDeliveryAddress =
        deliveryMethod === 'Pharmacy Pickup'
          ? 'Ambients Dispensary Desk - Counter 1 (Ready in 30 mins)'
          : `${streetAddress}, ${city}, ${state} ${zip}`;

      const primaryItem = cartItems[0].item;
      const medicationSummary =
        cartItems.length === 1
          ? primaryItem.name
          : `${primaryItem.name} + ${cartItems.length - 1} item(s)`;

      const orderItems: OrderItem[] = cartItems.map((ci) => ({
        productId: ci.item.id,
        name: ci.item.name,
        category: ci.item.category,
        quantity: ci.quantity,
        unitPrice: ci.item.price,
        image: ci.item.image,
        dosage: ci.item.dosage,
        rxRequired: ci.item.rxRequired,
      }));

      const newOrder: OnlineOrder = {
        id: `ord-${Date.now()}`,
        orderNumber: orderNum,
        patientName,
        email,
        phone,
        medicationName: medicationSummary,
        items: orderItems,
        subtotal,
        shippingFee,
        discountAmount,
        couponCode: appliedCoupon?.code,
        totalAmount,
        orderType: 'Store Purchase',
        deliveryMethod,
        deliveryAddress: fullDeliveryAddress,
        paymentMethod,
        paymentStatus: 'Pending Verification',
        status: 'Pending',
        placedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        internalNotes: [
          `Payment due via ${paymentMethod}`,
          'Order saved for administrator review.',
        ],
      };

      const savedOrder = await onOrderSuccess(newOrder);
      onClearCart();
      setCompletedOrder(savedOrder);
      setIsSubmitting(false);
    } catch (error) {
      setIsSubmitting(false);
      setPaymentError(error instanceof Error ? error.message : 'Unable to place your order.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 font-sans">
      <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Modal Top Bar */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center font-bold text-white shadow-xs">
              Rx
            </div>
            <div>
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <span>Wellness Store Checkout</span>
                <span className="rounded border border-white/15 bg-white/10 px-2 py-0.5 text-[11px] font-medium text-slate-200">
                  Order checkout
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Place an order for admin review
              </p>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: Either Receipt or Checkout Form */}
        {completedOrder ? (
          <div className="p-6 sm:p-10 overflow-y-auto space-y-6 text-center">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div className="space-y-1">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-teal-700 bg-teal-50 px-3 py-1 rounded-full border border-teal-200">
                Order received · Payment due on delivery or pickup
              </span>
              <h2 className="text-2xl font-bold text-slate-900">Thank You for Your Order!</h2>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Order <span className="font-mono font-bold text-slate-800">{completedOrder.orderNumber}</span> has been added to the admin order queue. No payment or email has been processed.
              </p>
            </div>

            {/* Receipt Summary Card */}
            <div className="max-w-xl mx-auto bg-slate-50 border border-slate-200 rounded-xl p-5 text-left text-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <span className="text-slate-400 block text-[11px]">Recipient</span>
                  <span className="font-bold text-slate-900">{completedOrder.patientName}</span>
                </div>
                <div className="text-right">
                  <span className="text-slate-400 block text-[11px]">Payment Mode</span>
                  <span className="font-bold text-teal-800">{completedOrder.paymentMethod}</span>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-2">
                <span className="font-semibold text-slate-700 block">Ordered Items:</span>
                {completedOrder.items?.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-slate-200">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-slate-400 font-bold">{item.quantity}x</span>
                      <span className="font-medium text-slate-900">{item.name}</span>
                    </div>
                    <span className="font-mono font-bold text-slate-800">
                      ${(item.unitPrice * item.quantity).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Delivery and Transaction Hash */}
              <div className="grid grid-cols-2 gap-3 pt-2 text-[11px] border-t border-slate-200">
                <div>
                  <span className="text-slate-500 block">Delivery Method:</span>
                  <span className="font-semibold text-slate-800">{completedOrder.deliveryMethod}</span>
                  <span className="text-slate-500 block truncate">{completedOrder.deliveryAddress}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Payment status:</span>
                  <span className="font-semibold text-amber-800">{completedOrder.paymentStatus}</span>
                  {completedOrder.transactionId && (
                    <span className="font-mono text-teal-800 break-all">{completedOrder.transactionId}</span>
                  )}
                  {completedOrder.trackingNumber && (
                    <span className="text-slate-500 block">
                      Tracking ID: <span className="font-mono text-slate-700">{completedOrder.trackingNumber}</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Financial Totals */}
              <div className="border-t border-slate-200 pt-3 space-y-1 text-slate-600">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span className="font-mono font-semibold">${completedOrder.subtotal?.toFixed(2)}</span>
                </div>
                {completedOrder.discountAmount ? (
                  <div className="flex justify-between text-emerald-700">
                    <span>Discount ({completedOrder.couponCode}):</span>
                    <span className="font-mono font-semibold">-${completedOrder.discountAmount.toFixed(2)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <span>Shipping:</span>
                  <span className="font-mono font-semibold">
                    {completedOrder.shippingFee === 0 ? 'FREE' : `$${completedOrder.shippingFee?.toFixed(2)}`}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-bold text-slate-900 pt-2 border-t border-slate-200">
                  <span>Total due:</span>
                  <span className="text-base font-mono text-teal-900">${completedOrder.totalAmount.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => window.print()}
                className="px-4 py-2.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer transition-colors"
              >
                <Printer className="w-4 h-4" />
                <span>Print Packing Slip</span>
              </button>
              <button
                onClick={handleClose}
                className="px-6 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-xs font-bold text-white shadow-xs cursor-pointer transition-colors"
              >
                Return to Pharmacy Store
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleProcessCheckout} className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
            {/* Left 7 Columns: Checkout Details & Payment Method */}
            <div className="lg:col-span-7 p-6 space-y-6">
              {/* Section 1: Customer Contact */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                  <span className="w-5 h-5 rounded-full bg-teal-800 text-white flex items-center justify-center text-xs font-bold">
                    1
                  </span>
                  <h4 className="font-bold text-sm text-slate-900">Customer &amp; Shipping Contact</h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Full Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-teal-700"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Email Address <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-teal-700"
                    />
                  </div>
                </div>

                <div className="text-xs">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Phone Number <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-teal-700"
                  />
                </div>
              </div>

              {/* Section 2: Fulfillment & Shipping Address */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                  <span className="w-5 h-5 rounded-full bg-teal-800 text-white flex items-center justify-center text-xs font-bold">
                    2
                  </span>
                  <h4 className="font-bold text-sm text-slate-900">Fulfillment Mode</h4>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setDeliveryMethod('Express Courier')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      deliveryMethod === 'Express Courier'
                        ? 'border-teal-700 bg-teal-50/80 text-teal-950 ring-1 ring-teal-700'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <Truck className="w-4 h-4 text-teal-700" />
                      <span className="font-mono font-bold text-teal-800">$12</span>
                    </div>
                    <span className="font-bold block text-slate-900">Express Courier</span>
                    <span className="text-[10px] text-slate-500">Same-day discreet</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeliveryMethod('Discreet Mail')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      deliveryMethod === 'Discreet Mail'
                        ? 'border-teal-700 bg-teal-50/80 text-teal-950 ring-1 ring-teal-700'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <Mail className="w-4 h-4 text-teal-700" />
                      <span className="font-mono font-bold text-emerald-700">FREE</span>
                    </div>
                    <span className="font-bold block text-slate-900">Discreet Mail</span>
                    <span className="text-[10px] text-slate-500">2-3 business days</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeliveryMethod('Pharmacy Pickup')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      deliveryMethod === 'Pharmacy Pickup'
                        ? 'border-teal-700 bg-teal-50/80 text-teal-950 ring-1 ring-teal-700'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <Building className="w-4 h-4 text-teal-700" />
                      <span className="font-mono font-bold text-emerald-700">FREE</span>
                    </div>
                    <span className="font-bold block text-slate-900">Dispensary Desk</span>
                    <span className="text-[10px] text-slate-500">Ready in 30 mins</span>
                  </button>
                </div>

                {deliveryMethod !== 'Pharmacy Pickup' ? (
                  <div className="space-y-2 text-xs pt-1">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Street Address <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={streetAddress}
                        onChange={(e) => setStreetAddress(e.target.value)}
                        placeholder="Street, Suite or Apt #"
                        className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-teal-700"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">City</label>
                        <input
                          type="text"
                          required
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">State</label>
                        <input
                          type="text"
                          required
                          value={state}
                          onChange={(e) => setState(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">ZIP</label>
                        <input
                          type="text"
                          required
                          value={zip}
                          onChange={(e) => setZip(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-teal-50/60 rounded-xl border border-teal-200 text-xs text-teal-900 flex items-start gap-2.5">
                    <Building className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold block">Counter Pickup Location:</span>
                      <p className="text-[11px] text-teal-800">
                        Ambients Clinical Dispensary, 400 Central Health Boulevard, Suite 100.
                        Bring ID or order barcode confirmation upon arrival.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 3: Payment Method (WooCommerce style tabs) */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                  <span className="w-5 h-5 rounded-full bg-teal-800 text-white flex items-center justify-center text-xs font-bold">
                    3
                  </span>
                  <h4 className="font-bold text-sm text-slate-900">Payment Gateway</h4>
                </div>

                {/* Tabs */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <button
                    type="button"
                    disabled
                    title="Connect a secure card processor to enable card checkout"
                    className="flex cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 font-semibold text-slate-400"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Card · Setup</span>
                  </button>

                  <button
                    type="button"
                    disabled
                    title="Connect PayPal to enable PayPal checkout"
                    className="flex cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 font-semibold text-slate-400"
                  >
                    <span className="font-bold italic">P</span>
                    <span>PayPal · Setup</span>
                  </button>

                  <button
                    type="button"
                    disabled
                    title="Connect a crypto payment provider to enable cryptocurrency checkout"
                    className="flex cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 font-semibold text-slate-400"
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    <span>Crypto · Setup</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMethod('Cash on Delivery / Pickup')}
                    className={`py-2 px-2.5 rounded-lg border font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      paymentMethod === 'Cash on Delivery / Pickup'
                        ? 'border-teal-700 bg-teal-800 text-white shadow-xs'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Building className="w-3.5 h-3.5" />
                    <span>Pay on delivery/pickup</span>
                  </button>
                </div>
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                  Card, PayPal, and cryptocurrency payments are not connected in this build. They are disabled until secure providers are configured; this checkout does not collect card credentials or claim a payment was made.
                </p>
                {paymentError && <p role="alert" className="text-xs font-medium text-rose-700">{paymentError}</p>}

                {/* Card Payment Panel */}
                {paymentMethod === 'Credit / Debit Card' && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-700">Enter Card Information</span>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono">
                        <Lock className="w-3 h-3 text-emerald-600" />
                        <span>SSL Secure Checkout</span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Card Number
                      </label>
                      <input
                        type="text"
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value)}
                        placeholder="4242 4242 4242 4242"
                        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Expiration (MM/YY)
                        </label>
                        <input
                          type="text"
                          value={cardExpiry}
                          onChange={(e) => setCardExpiry(e.target.value)}
                          placeholder="08/28"
                          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          Security CVV
                        </label>
                        <input
                          type="password"
                          maxLength={4}
                          value={cardCvv}
                          onChange={(e) => setCardCvv(e.target.value)}
                          placeholder="883"
                          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Name on Card
                      </label>
                      <input
                        type="text"
                        value={cardHolder}
                        onChange={(e) => setCardHolder(e.target.value)}
                        placeholder="Eleanor Vance"
                        className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900"
                      />
                    </div>
                  </div>
                )}

                {/* PayPal Panel */}
                {paymentMethod === 'PayPal' && (
                  <div className="bg-sky-50/70 border border-sky-200 rounded-xl p-5 text-xs text-sky-950 space-y-3 text-center">
                    <div className="w-10 h-10 rounded-full bg-white border border-sky-300 flex items-center justify-center mx-auto text-sky-700 font-bold italic text-base">
                      PayPal
                    </div>
                    <div>
                      <span className="font-bold text-sm block">Express PayPal Checkout</span>
                      <p className="text-[11px] text-sky-800 max-w-sm mx-auto">
                        Fast and secure payment with your PayPal account or PayPal Credit. You will confirm your payment directly upon submitting the order.
                      </p>
                    </div>
                    <div className="p-2.5 bg-white rounded-lg border border-sky-200 text-left text-[11px] flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Protected by PayPal Purchase Protection for pharmacy healthcare orders.</span>
                    </div>
                  </div>
                )}

                {/* Cryptocurrency Panel */}
                {paymentMethod === 'Cryptocurrency (USDC / BTC / ETH / SOL)' && (
                  <div className="bg-slate-900 text-white rounded-xl p-4 sm:p-5 space-y-4 text-xs">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="font-bold text-slate-200 flex items-center gap-1.5">
                        <QrCode className="w-4 h-4 text-teal-400" />
                        <span>Decentralized Crypto Payment</span>
                      </span>
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                        Zero Processing Surcharge
                      </span>
                    </div>

                    {/* Crypto Select buttons */}
                    <div className="grid grid-cols-4 gap-1.5">
                      {(['USDC', 'BTC', 'ETH', 'SOL'] as const).map((curr) => (
                        <button
                          key={curr}
                          type="button"
                          onClick={() => setSelectedCrypto(curr)}
                          className={`py-1.5 px-2 rounded-lg text-center font-bold text-xs cursor-pointer transition-all ${
                            selectedCrypto === curr
                              ? 'bg-teal-600 text-white shadow-xs'
                              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          {curr}
                        </button>
                      ))}
                    </div>

                    {/* Details Box */}
                    <div className="bg-slate-950 p-3.5 rounded-lg border border-slate-800 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">Total Due in {selectedCrypto}:</span>
                        <span className="font-mono font-bold text-teal-300 text-sm">
                          {(totalAmount * CRYPTO_CONFIGS[selectedCrypto].ratePerUsd).toFixed(
                            selectedCrypto === 'BTC' ? 6 : selectedCrypto === 'ETH' ? 4 : 2
                          )}{' '}
                          {selectedCrypto}
                        </span>
                      </div>

                      <div>
                        <span className="text-[11px] text-slate-400 block mb-1">
                          Official Dispensary Deposit Address ({CRYPTO_CONFIGS[selectedCrypto].network}):
                        </span>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 bg-slate-900 border border-slate-700 px-2 py-1 rounded text-[11px] font-mono text-slate-300 truncate">
                            {CRYPTO_CONFIGS[selectedCrypto].address}
                          </code>
                          <button
                            type="button"
                            onClick={handleCopyCrypto}
                            className="bg-teal-700 hover:bg-teal-600 text-white px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            {copiedAddress ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{copiedAddress ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                      </div>

                      {/* Mock QR graphic */}
                      <div className="flex items-center gap-3 pt-1">
                        <div className="w-16 h-16 bg-white p-1 rounded-md shrink-0 flex items-center justify-center">
                          <div className="w-full h-full bg-slate-900 flex items-center justify-center text-teal-400 font-mono text-[9px] text-center p-1 font-bold leading-tight">
                            QR CODE [{selectedCrypto}]
                          </div>
                        </div>
                        <div className="text-[11px] text-slate-400 leading-relaxed">
                          Scan with your web3 wallet or exchange app. Transaction is automatically verified and confirmed on the blockchain ledger.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Pickup Panel */}
                {paymentMethod === 'Cash on Delivery / Pickup' && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-950 space-y-2">
                    <span className="font-bold block">Pay in Person at Counter or Upon Delivery</span>
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      Your order will be added to the admin review queue. Payment and fulfillment will be confirmed by the team.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Right 5 Columns: Sticky Order Summary & Direct Place Order */}
            <div className="lg:col-span-5 bg-slate-50 p-6 flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <h4 className="font-bold text-sm text-slate-900">Order Summary</h4>
                  <span className="text-xs font-mono font-bold text-teal-800 bg-teal-100/60 px-2 py-0.5 rounded-full">
                    {cartItems.reduce((acc, ci) => acc + ci.quantity, 0)} Items
                  </span>
                </div>

                {/* Line items list */}
                <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                  {cartItems.map((ci) => (
                    <div
                      key={ci.item.id}
                      className="bg-white p-2.5 rounded-lg border border-slate-200 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        {ci.item.image ? (
                          <img
                            src={ci.item.image}
                            alt={ci.item.name}
                            className="w-10 h-10 rounded-md object-cover border border-slate-200 shrink-0"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-md bg-teal-50 text-teal-800 flex items-center justify-center font-bold text-xs shrink-0">
                            Item
                          </div>
                        )}
                        <div className="truncate">
                          <p className="font-semibold text-slate-900 truncate">{ci.item.name}</p>
                          <p className="text-[11px] text-slate-400">
                            Qty: <span className="font-mono font-bold text-slate-700">{ci.quantity}</span> × ${ci.item.price.toFixed(2)}
                          </p>
                        </div>
                      </div>
                      <span className="font-mono font-bold text-slate-900 shrink-0">
                        ${(ci.item.price * ci.quantity).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Coupon Code Input */}
                <div className="pt-2">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Tag className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value)}
                        placeholder="Coupon: AURA10 or FREESHIP"
                        className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono uppercase text-slate-800"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleApplyCoupon}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-lg cursor-pointer transition-colors"
                    >
                      Apply
                    </button>
                  </div>
                  {couponError && <p className="text-[11px] text-rose-600 mt-1">{couponError}</p>}
                  {appliedCoupon && (
                    <div className="mt-1.5 flex items-center justify-between bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded-md text-[11px]">
                      <span className="font-semibold">
                        Coupon Applied: <span className="font-mono font-bold">{appliedCoupon.code}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setAppliedCoupon(null)}
                        className="text-emerald-700 hover:text-rose-600 cursor-pointer text-xs"
                      >
                        × Remove
                      </button>
                    </div>
                  )}
                </div>

                {/* Financial Breakdown */}
                <div className="border-t border-slate-200 pt-3 space-y-1.5 text-xs text-slate-600">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span className="font-mono text-slate-900 font-semibold">${subtotal.toFixed(2)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Discount ({appliedCoupon?.code}):</span>
                      <span className="font-mono font-semibold">-${discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Shipping ({deliveryMethod}):</span>
                    <span className="font-mono text-slate-900 font-semibold">
                      {shippingFee === 0 ? <span className="text-emerald-700 font-bold">FREE</span> : `$${shippingFee.toFixed(2)}`}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-500 text-[11px]">
                    <span>Sales tax:</span>
                    <span className="font-mono">Not calculated in preview</span>
                  </div>
                  <div className="border-t border-slate-300 pt-2 flex justify-between items-baseline text-slate-900">
                    <span className="font-bold text-sm">Grand Total Due:</span>
                    <span className="font-mono text-xl font-black text-teal-900">${totalAmount.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Submit Button & Guarantees */}
              <div className="space-y-3 pt-4 border-t border-slate-200">
                <button
                  type="submit"
                  disabled={isSubmitting || cartItems.length === 0}
                  className="w-full py-3.5 bg-teal-700 hover:bg-teal-800 active:scale-[0.99] text-white font-bold text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <span>Securing Transaction &amp; Fulfilling...</span>
                  ) : (
                    <>
                      <span>Place Order &amp; Confirm (${totalAmount.toFixed(2)})</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                <div className="flex items-center justify-center gap-4 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-teal-700" />
                    <span>Admin review required</span>
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5 text-teal-700" />
                    <span>Order saved for admin review</span>
                  </span>
                </div>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
