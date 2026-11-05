import React, { useState } from 'react';
import {
  X,
  CreditCard,
  CheckCircle2,
  Lock,
  Truck,
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
import { CartItem, OnlineOrder, PaymentMethod, OrderItem } from '../types/pharmacy';

type StorePaymentMethod = Exclude<PaymentMethod, 'Cash on Delivery / Pickup'>;

const PaymentBrandMark: React.FC<{ method: StorePaymentMethod }> = ({ method }) => {
  if (method === 'Credit / Debit Card') {
    return (
      <span aria-hidden="true" className="flex items-center gap-1">
        <span className="font-black italic tracking-tight text-[#1434CB]">VISA</span>
        <span className="relative flex h-5 w-7 items-center">
          <span className="absolute left-0 h-4 w-4 rounded-full bg-[#EB001B]" />
          <span className="absolute right-0 h-4 w-4 rounded-full bg-[#F79E1B] mix-blend-multiply" />
        </span>
      </span>
    );
  }

  if (method === 'PayPal') {
    return (
      <span aria-hidden="true" className="flex items-center gap-1">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-[#003087] text-sm font-black italic leading-none text-white">P</span>
        <span className="font-bold tracking-tight text-[#003087]">PayPal</span>
      </span>
    );
  }

  if (method === 'Cryptocurrency (USDC / BTC / ETH / SOL)') {
    return (
      <span aria-hidden="true" className="flex items-center gap-1">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#F7931A] text-sm font-bold text-white">₿</span>
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#627EEA]" fill="currentColor">
          <path d="M12 1.8 5.8 12 12 15.7 18.2 12 12 1.8Zm0 14.9-6.2-3.7L12 22.2l6.2-9.2-6.2 3.7Z" />
        </svg>
        <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#2775CA] text-[9px] font-bold text-[#2775CA]">$</span>
      </span>
    );
  }

  return null;
};

interface CheckoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  onOrderSuccess: (order: OnlineOrder) => Promise<OnlineOrder>;
  onClearCart: () => void;
}

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
  const [deliveryMethod, setDeliveryMethod] = useState<'Regular Shipping' | 'Express Shipping'>('Regular Shipping');

  // Coupon code
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discountPercent: number; freeShipping?: boolean } | null>(null);
  const [couponError, setCouponError] = useState('');

  // Payment tab
  const [paymentMethod, setPaymentMethod] = useState<StorePaymentMethod>('Credit / Debit Card');
  const [paymentError, setPaymentError] = useState('');

  // Order state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<OnlineOrder | null>(null);

  if (!isOpen) return null;

  // Pricing calculations
  const subtotal = cartItems.reduce((acc, ci) => acc + ci.item.price * ci.quantity, 0);
  const rawShipping = deliveryMethod === 'Express Shipping' && subtotal < 35 ? 12.0 : 0.0;
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

  const handleProcessCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cartItems.length === 0) return;
    setIsSubmitting(true);

    try {
      const orderNum = `ORD-${Date.now().toString().slice(-6)}`;
      const fullDeliveryAddress = `${streetAddress}, ${city}, ${state} ${zip}`;

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
        paymentStatus: 'Awaiting Payment',
        status: 'Pending',
        placedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        internalNotes: [
          `Payment due via ${paymentMethod}`,
          'Payment link to be sent by email after order review.',
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
                Secure, straightforward checkout
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
                Order received
              </span>
              <h2 className="text-2xl font-bold text-slate-900">Thank You for Your Order!</h2>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Your order has been received. Payment instructions will be sent to {completedOrder.email} after review.
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
                  <h4 className="font-bold text-sm text-slate-900">Shipping Method</h4>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setDeliveryMethod('Regular Shipping')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      deliveryMethod === 'Regular Shipping'
                        ? 'border-teal-700 bg-teal-50/80 text-teal-950 ring-1 ring-teal-700'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <Mail className="w-4 h-4 text-teal-700" />
                      <span className="font-mono font-bold text-emerald-700">FREE</span>
                    </div>
                    <span className="font-bold block text-slate-900">Regular Shipping</span>
                    <span className="text-[10px] text-slate-500">Standard delivery</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeliveryMethod('Express Shipping')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      deliveryMethod === 'Express Shipping'
                        ? 'border-teal-700 bg-teal-50/80 text-teal-950 ring-1 ring-teal-700'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <Truck className="w-4 h-4 text-teal-700" />
                      <span className="font-mono font-bold text-teal-800">{subtotal >= 35 || appliedCoupon?.freeShipping ? 'FREE' : '$12'}</span>
                    </div>
                    <span className="font-bold block text-slate-900">Express Shipping</span>
                    <span className="text-[10px] text-slate-500">Priority delivery</span>
                  </button>
                </div>

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
              </div>

              {/* Section 3: Payment Method (WooCommerce style tabs) */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                  <span className="w-5 h-5 rounded-full bg-teal-800 text-white flex items-center justify-center text-xs font-bold">
                    3
                  </span>
                  <h4 className="font-bold text-sm text-slate-900">Payment Method</h4>
                </div>

                {/* Tabs */}
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {([
                    ['Credit / Debit Card', 'Card'],
                    ['PayPal', 'PayPal'],
                    ['Cryptocurrency (USDC / BTC / ETH / SOL)', 'Crypto'],
                  ] as const).map(([method, label]) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      aria-pressed={paymentMethod === method}
                      className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border bg-white px-2 py-2 text-[11px] font-semibold transition-all ${
                        method === 'Credit / Debit Card'
                          ? paymentMethod === method
                            ? 'border-[#1434CB] bg-blue-50 ring-2 ring-[#1434CB]/15'
                            : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/50'
                          : method === 'PayPal'
                            ? paymentMethod === method
                              ? 'border-[#003087] bg-blue-50 ring-2 ring-[#003087]/15'
                              : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/50'
                            : method === 'Cryptocurrency (USDC / BTC / ETH / SOL)'
                              ? paymentMethod === method
                                ? 'border-[#627EEA] bg-indigo-50 ring-2 ring-[#627EEA]/15'
                                : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50'
                              : paymentMethod === method
                                ? 'border-slate-500 bg-slate-100 ring-2 ring-slate-500/15'
                                : 'border-slate-200 hover:border-slate-400 hover:bg-slate-50'
                      }`}
                    >
                      <PaymentBrandMark method={method} />
                      <span className={
                        method === 'Credit / Debit Card' ? 'text-[#1434CB]'
                          : method === 'PayPal' ? 'text-[#003087]'
                            : 'text-[#334155]'
                      }>{label}</span>
                      {method === 'Cryptocurrency (USDC / BTC / ETH / SOL)' && (
                        <span className="text-[9px] font-medium tracking-wide text-slate-500">BTC · ETH · USDC · SOL</span>
                      )}
                    </button>
                  ))}
                </div>
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-700">
                  {`We’ll email payment instructions and a secure ${paymentMethod === 'Credit / Debit Card' ? 'card' : paymentMethod} payment link to ${email || 'the email address above'}. Enter your payment details on the provider’s secure page.`}
                </p>
                {paymentError && <p role="alert" className="text-xs font-medium text-rose-700">{paymentError}</p>}

                <div className="flex items-start gap-2 rounded-xl border border-teal-200 bg-teal-50 p-4 text-xs text-teal-950">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-teal-800" />
                  <p>Payment instructions and your secure payment link will arrive by email after your order is reviewed. You’ll enter your payment details directly on the provider’s secure page.</p>
                </div>
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
                    <span>Placing your order…</span>
                  ) : (
                    <>
                      <span>Place Order (${totalAmount.toFixed(2)})</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                <div className="flex items-center justify-center gap-4 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-teal-700" />
                    <span>Secure order review</span>
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5 text-teal-700" />
                    <span>Order details protected</span>
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
