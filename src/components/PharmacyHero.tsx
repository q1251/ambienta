import React from 'react';
import { ArrowDown, ArrowRight, Award, Heart, Moon, Search, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import heroImage from '../assets/images/wellness_vitamins_display_1793621456102.jpg';
import { StoreCategory } from '../types/pharmacy';

interface PharmacyHeroProps {
  selectedCategory: StoreCategory | 'All Products';
  categories: StoreCategory[];
  onSelectCategory: (cat: StoreCategory | 'All Products') => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const PharmacyHero: React.FC<PharmacyHeroProps> = ({
  selectedCategory,
  categories,
  onSelectCategory,
  searchQuery,
  setSearchQuery,
}) => {
  const categoryIcon = (name: StoreCategory) => {
    switch (name) {
      case 'Sleep': return <Moon className="h-4 w-4" />;
      case 'Weight Loss': return <Heart className="h-4 w-4" />;
      case 'Energy & Focus': return <Zap className="h-4 w-4" />;
      case 'Heart & Circulation': return <Heart className="h-4 w-4" />;
      case 'Daily Wellness': return <ShieldCheck className="h-4 w-4" />;
      default: return <Sparkles className="h-4 w-4" />;
    }
  };

  const scrollToCatalog = () => {
    document.getElementById('store-catalog')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="relative isolate min-h-[620px] overflow-hidden bg-[#123b68] text-white sm:min-h-[640px] lg:min-h-[700px]">
      <img
        src={heroImage}
        alt="Wellness supplements and botanical ingredients arranged in a bright, calming setting"
        className="absolute inset-0 -z-20 h-full w-full object-cover object-[62%_center] sm:object-center"
      />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(8,38,73,0.78)_0%,rgba(8,38,73,0.84)_48%,rgba(8,38,73,0.94)_100%)] sm:hidden" />
      <div className="absolute inset-0 -z-10 hidden bg-[linear-gradient(90deg,rgba(8,38,73,0.96)_0%,rgba(12,54,98,0.88)_36%,rgba(19,67,113,0.52)_63%,rgba(18,59,104,0.12)_100%)] sm:block" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,rgba(10,42,76,0.34)_0%,transparent_46%)]" />

      <div className="mx-auto flex min-h-[620px] max-w-[1440px] items-center px-4 py-10 sm:min-h-[640px] sm:px-8 sm:py-12 lg:min-h-[700px] lg:px-12 lg:py-16">
        <div className="w-full max-w-[740px]">
          <div className="mb-5 inline-flex max-w-full items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-white shadow-sm backdrop-blur-md sm:mb-6 sm:px-3.5 sm:py-2 sm:text-xs">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[#174c80] sm:h-6 sm:w-6">
              <Award className="h-3.5 w-3.5" />
            </span>
            Everyday wellness, thoughtfully selected
          </div>

          <h1 className="max-w-[700px] text-[clamp(2.4rem,10vw,3.8rem)] font-semibold leading-[1.02] tracking-[-0.065em] text-white sm:text-[clamp(3.2rem,6.4vw,5.5rem)] sm:leading-[0.98]">
            A healthier you,
            <span className="mt-1 block font-serif font-normal italic tracking-[-0.06em] text-[#cce7ff]">
              starts with care.
            </span>
          </h1>

          <p className="mt-4 max-w-xl text-sm leading-6 text-blue-50/95 sm:mt-6 sm:text-lg sm:leading-8">
            Find trusted pharmacy and wellness essentials for your daily routine, with helpful service at every step.
          </p>

          <div className="mt-6 flex flex-col items-stretch gap-2 sm:mt-8 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <button
              onClick={scrollToCatalog}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#123b68] shadow-lg shadow-blue-950/20 transition hover:-translate-y-0.5 hover:bg-blue-50 sm:w-auto sm:px-6 sm:py-3.5"
            >
              Shop wellness essentials
              <ArrowRight className="h-4 w-4" />
            </button>
            <span className="inline-flex items-center justify-center gap-2 px-2 py-2 text-xs font-medium text-white sm:justify-start sm:py-3 sm:text-sm">
              <ShieldCheck className="h-4 w-4 text-[#cce7ff]" />
              Here when you need us
            </span>
          </div>

          <div className="mt-6 max-w-xl sm:mt-9">
            <label htmlFor="wellness-search" className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-100 sm:text-xs sm:tracking-[0.14em]">
              Find pharmacy &amp; wellness essentials
            </label>
            <div className="flex items-center rounded-2xl border border-white/70 bg-white p-1.5 shadow-lg shadow-blue-950/15 transition focus-within:ring-4 focus-within:ring-white/20">
              <Search className="ml-3 h-5 w-5 shrink-0 text-[#52708d]" />
              <input
                id="wellness-search"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') scrollToCatalog();
                }}
                placeholder="Search vitamins, sleep, wellness..."
                className="min-w-0 flex-1 border-0 bg-transparent px-2 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 sm:px-3"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="shrink-0 rounded-xl px-2 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900 sm:px-3"
                >
                  Clear
                </button>
              ) : (
                <button
                  type="button"
                  onClick={scrollToCatalog}
                  aria-label="Browse products"
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e8f2fb] text-[#174c80] transition hover:bg-[#d9eafb]"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          <div className="mt-6 sm:mt-7">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-100 sm:text-xs">
              Browse by category
            </p>
            <div
              role="group"
              aria-label="Browse product categories"
              className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0"
            >
              <button
                type="button"
                onClick={() => onSelectCategory('All Products')}
                className={`shrink-0 snap-start rounded-full px-4 py-2 text-xs font-semibold transition ${
                  selectedCategory === 'All Products'
                    ? 'bg-white text-[#123b68]'
                    : 'border border-white/45 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20'
                }`}
              >
                All products
              </button>
              {categories.map((name) => (
                <button
                  type="button"
                  key={name}
                  onClick={() => onSelectCategory(name)}
                  className={`inline-flex shrink-0 snap-start items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                    selectedCategory === name
                      ? 'bg-white text-[#123b68]'
                      : 'border border-white/45 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20'
                  }`}
                >
                  {categoryIcon(name)}
                  {name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-5 right-6 hidden items-center gap-2 rounded-full border border-white/35 bg-white/15 px-4 py-2 text-xs font-medium text-white backdrop-blur-md lg:flex">
        <Sparkles className="h-4 w-4 text-[#cce7ff]" />
        Wellness for your everyday
      </div>
    </section>
  );
};
