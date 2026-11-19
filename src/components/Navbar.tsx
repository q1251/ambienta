import React from 'react';
import { ChevronDown, ShoppingCart } from 'lucide-react';
import { StoreCategory } from '../types/pharmacy';

interface NavbarProps {
  onNavigateHome: () => void;
  openCart: () => void;
  cartCount: number;
  categories: StoreCategory[];
  onSelectCategory?: (category: StoreCategory | 'All Products') => void;
  selectedCategory?: StoreCategory | 'All Products';
}

export const Navbar: React.FC<NavbarProps> = ({
  onNavigateHome,
  openCart,
  cartCount,
  categories,
  onSelectCategory,
  selectedCategory,
}) => {
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = React.useState(false);

  const selectCategory = (category: StoreCategory | 'All Products') => {
    onSelectCategory?.(category);
    setIsCategoryMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-blue-100 bg-white/95 backdrop-blur-xl">
      {/* Top micro bar for pharmacy certification & admin link */}
      <div className="border-b border-blue-100 bg-[#f1f7fc] px-4 py-1.5 text-[10px] text-slate-600 sm:px-6 sm:py-2 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-600"></span>
            <span className="hidden sm:inline">Trusted pharmacy and wellness care</span>
            <span className="hidden text-slate-400 sm:inline">·</span>
            <span>Free express delivery over $35</span>
          </div>

          <span className="hidden md:inline">Thoughtful care for every day</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-16 items-center justify-between gap-2 sm:gap-4">
          {/* Brand Wordmark */}
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={onNavigateHome}
              className="flex items-center gap-2 text-left focus:outline-none cursor-pointer sm:gap-2.5"
            >
              <img src="/ambients-mark.svg" alt="" className="h-9 w-9 rounded-xl shadow-sm sm:h-10 sm:w-10 sm:rounded-[14px]" />
              <div>
                <span className="block whitespace-nowrap text-base font-semibold leading-tight tracking-[-0.04em] text-slate-900 sm:text-xl">
                  Ambient
                </span>
                <span className="hidden text-[9px] font-semibold uppercase tracking-[0.16em] text-[#356a9e] sm:block">
                  Pharmacy &amp; wellness
                </span>
              </div>
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              aria-label="Browse product categories"
              aria-expanded={isCategoryMenuOpen}
              aria-controls="navbar-categories"
              onClick={() => setIsCategoryMenuOpen((open) => !open)}
              className="inline-flex items-center gap-1.5 rounded-full border border-blue-100 px-2.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-[#f1f7fc] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174c80] sm:gap-2 sm:px-3.5"
            >
              <span className="sm:hidden">Browse</span>
              <span className="hidden sm:inline">Categories</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${isCategoryMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Right Action: Cart Drawer Trigger */}
            <button
              type="button"
              onClick={openCart}
              className="relative flex items-center gap-2 rounded-full bg-[#174c80] px-2.5 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#123b68] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174c80] sm:px-4"
              aria-label="View cart"
            >
              <ShoppingCart className="h-4 w-4 text-blue-100" />
              <span className="hidden sm:inline">Cart</span>
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

      {isCategoryMenuOpen && (
        <nav
          id="navbar-categories"
          aria-label="Product categories"
          className="border-t border-blue-100 bg-white px-4 py-3 shadow-lg sm:px-6 sm:py-4 lg:px-8"
        >
          <div className="mx-auto grid max-h-[60vh] max-w-7xl grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-5">
            {(['All Products', ...categories] as const).map((category) => {
              const active = selectedCategory === category;
              return (
                <button
                  key={category}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => selectCategory(category)}
                  className={`min-h-10 rounded-lg px-3 py-2 text-left text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#174c80] ${
                    active
                      ? 'bg-[#e8f2fb] text-[#123b68]'
                      : 'text-slate-600 hover:bg-[#f1f7fc] hover:text-slate-900'
                  }`}
                >
                  {category}
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </header>
  );
};
