import React from 'react';
import { ShoppingBag, Sparkles } from 'lucide-react';
import { StoreCategory } from '../types/pharmacy';

interface NavbarProps {
  onNavigateHome: () => void;
  openCart: () => void;
  cartCount: number;
  onSelectCategory?: (category: StoreCategory | 'All Products') => void;
  selectedCategory?: StoreCategory | 'All Products';
}

export const Navbar: React.FC<NavbarProps> = ({
  onNavigateHome,
  openCart,
  cartCount,
  onSelectCategory,
  selectedCategory,
}) => {
  return (
    <header className="sticky top-0 z-40 border-b border-blue-100 bg-white/95 backdrop-blur-xl">
      {/* Top micro bar for pharmacy certification & admin link */}
      <div className="border-b border-blue-100 bg-[#f1f7fc] px-4 py-2 text-[10px] text-slate-600 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-600"></span>
            <span className="hidden sm:inline">Trusted pharmacy and wellness care</span>
            <span className="text-slate-400">·</span>
            <span>Free express delivery over $35</span>
          </div>

          <span className="hidden sm:inline">Thoughtful care for every day</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-[70px] items-center justify-between gap-4 sm:gap-8">
          {/* Brand Wordmark */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={onNavigateHome}
              className="flex items-center gap-2.5 text-left focus:outline-none cursor-pointer"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[#174c80] text-white shadow-sm">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <span                 className="block whitespace-nowrap text-lg font-semibold leading-tight tracking-[-0.04em] text-slate-900 sm:text-xl">
                  AuraCare Health
                </span>
                <span                                 className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-[#356a9e]">
                Pharmacy &amp; wellness
                </span>
              </div>
            </button>
          </div>

          {/* Quick Category Jump Bar */}
          <nav           className="hidden items-center gap-1 text-sm font-medium text-slate-600 lg:flex">
            {(['All Products', 'Sleep', 'Weight Loss', 'Energy & Focus', 'Daily Wellness'] as const).map((cat) => {
              const active = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => onSelectCategory?.(cat)}
                  className={`px-3 py-1.5 rounded-md transition-colors text-xs font-semibold cursor-pointer ${
                    active
                      ? 'bg-[#e8f2fb] text-[#123b68]'
                      : 'text-slate-600 hover:bg-[#f1f7fc] hover:text-slate-900'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </nav>

          {/* Right Action: Cart Drawer Trigger */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={openCart}
              className="relative flex items-center gap-2 rounded-full bg-[#174c80] px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#123b68]"
              aria-label="View Cart"
            >
              <ShoppingBag className="h-4 w-4 text-blue-100" />
              <span>Cart</span>
              {cartCount > 0 ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 font-mono text-[11px] font-bold text-[#123b68]">
                  {cartCount}
                </span>
              ) : (
                <span className="font-mono text-[11px] text-white/70">0</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
