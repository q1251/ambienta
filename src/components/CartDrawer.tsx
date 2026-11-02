import React from 'react';
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { CartItem } from '../types/pharmacy';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cartItems: CartItem[];
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemoveItem: (productId: string) => void;
  onOpenCheckout: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  cartItems,
  onUpdateQuantity,
  onRemoveItem,
  onOpenCheckout,
}) => {
  if (!isOpen) return null;

  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + item.item.price * item.quantity, 0);

  const handleCheckout = () => {
    onClose();
    onOpenCheckout();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/45 backdrop-blur-sm"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-[460px] flex-col bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[#e7e8e1] px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e8f2fb] text-[#174c80]">
              <ShoppingBag className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold tracking-tight text-slate-900">Your bag</h2>
              <p className="text-xs text-slate-500">{itemCount} {itemCount === 1 ? 'item' : 'items'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cart"
            className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {cartItems.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#e8f2fb] text-[#174c80]">
              <ShoppingBag className="h-7 w-7" />
            </span>
            <h3 className="mt-5 text-lg font-semibold tracking-tight text-slate-900">Your bag is waiting</h3>
            <p className="mt-2 max-w-xs text-sm leading-6 text-slate-500">
              Explore everyday wellness essentials and add something that feels right for you.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 rounded-full bg-[#174c80] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#123b68]"
            >
              Continue browsing
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5 sm:px-6">
              {cartItems.map(({ item, quantity }) => (
                <article key={item.id} className="flex gap-4 rounded-2xl border border-blue-100 bg-white p-3.5">
                  <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-[#f0f3ed]">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-slate-400">Image</div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#356a9e]">{item.category}</p>
                        <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-slate-900">{item.name}</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.id)}
                        aria-label={`Remove ${item.name}`}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-auto flex items-center justify-between pt-3">
                      <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-[#fbfbf8] p-1">
                        <button
                          type="button"
                          onClick={() => onUpdateQuantity(item.id, quantity - 1)}
                          aria-label={`Decrease ${item.name} quantity`}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-slate-600 transition hover:bg-white"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="min-w-5 text-center text-xs font-semibold text-slate-800">{quantity}</span>
                        <button
                          type="button"
                          onClick={() => onUpdateQuantity(item.id, quantity + 1)}
                          aria-label={`Increase ${item.name} quantity`}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-slate-600 transition hover:bg-white"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <span className="font-mono text-sm font-semibold text-slate-900">
                        ${(item.price * quantity).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className="space-y-4 border-t border-blue-100 bg-white px-5 py-5 sm:px-6">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-slate-600">Subtotal</span>
                <span className="font-mono text-lg font-semibold text-slate-900">${subtotal.toFixed(2)}</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-500">
                Delivery, discounts, and payment options are shown at checkout. Free express delivery on orders over $35.
              </p>
              <button
                type="button"
                onClick={handleCheckout}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-[#174c80] px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123b68]"
              >
                Continue to checkout
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
};
