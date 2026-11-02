import React from 'react';
import { ArrowDown, ArrowRight, Award, Heart, Moon, Search, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import heroImage from '../assets/images/wellness_vitamins_display_1793621456102.jpg';
import { StoreCategory } from '../types/pharmacy';

interface PharmacyHeroProps {
  selectedCategory: StoreCategory | 'All Products';
  onSelectCategory: (cat: StoreCategory | 'All Products') => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const PharmacyHero: React.FC<PharmacyHeroProps> = ({
  selectedCategory,
  onSelectCategory,
  searchQuery,
  setSearchQuery,
}) => {
  const storeCategories: { name: StoreCategory; icon: React.ReactNode }[] = [
    { name: 'Sleep', icon: <Moon className="h-4 w-4" /> },
    { name: 'Weight Loss', icon: <Heart className="h-4 w-4" /> },
    { name: 'Energy & Focus', icon: <Zap className="h-4 w-4" /> },
    { name: 'Heart & Circulation', icon: <Heart className="h-4 w-4" /> },
    { name: 'Digestive Health', icon: <Sparkles className="h-4 w-4" /> },
    { name: 'Daily Wellness', icon: <ShieldCheck className="h-4 w-4" /> },
  ];

  const scrollToCatalog = () => {
    document.getElementById('store-catalog')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="relative isolate min-h-[720px] overflow-hidden bg-[#123b68] text-white sm:min-h-[690px] lg:min-h-[720px]">
      <img
        src={heroImage}
        alt="Wellness supplements and botanical ingredients arranged in a bright, calming setting"
        className="absolute inset-0 -z-20 h-full w-full object-cover object-center"
      />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(8,38,73,0.96)_0%,rgba(12,54,98,0.88)_36%,rgba(19,67,113,0.52)_63%,rgba(18,59,104,0.12)_100%)]" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,rgba(10,42,76,0.34)_0%,transparent_46%)]" />

      <div className="mx-auto flex min-h-[720px] max-w-[1440px] items-center px-5 py-12 sm:min-h-[690px] sm:px-8 lg:min-h-[720px] lg:px-12">
        <div className="max-w-[740px]">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3.5 py-2 text-xs font-semibold tracking-wide text-white shadow-sm backdrop-blur-md">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[#174c80]">
              <Award className="h-3.5 w-3.5" />
            </span>
            Everyday wellness, thoughtfully selected
          </div>

          <h1 className="max-w-[700px] text-[clamp(2.8rem,6.4vw,5.5rem)] font-semibold leading-[0.98] tracking-[-0.065em] text-white">
            A healthier you,
            <span className="mt-1 block font-serif font-normal italic tracking-[-0.06em] text-[#cce7ff]">
              starts with care.
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-base leading-7 text-blue-50/95 sm:text-lg sm:leading-8">
            Find trusted pharmacy and wellness essentials for your daily routine, with helpful service at every step.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              onClick={scrollToCatalog}
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-[#123b68] shadow-lg shadow-blue-950/20 transition hover:-translate-y-0.5 hover:bg-blue-50"
            >
              Shop wellness essentials
              <ArrowRight className="h-4 w-4" />
            </button>
            <span className="inline-flex items-center gap-2 px-2 py-3 text-sm font-medium text-white">
              <ShieldCheck className="h-4 w-4 text-[#cce7ff]" />
              Here when you need us
            </span>
          </div>

          <div className="mt-9 max-w-xl">
            <label htmlFor="wellness-search" className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-blue-100">
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
                placeholder="Search vitamins, sleep, daily wellness..."
                className="min-w-0 flex-1 border-0 bg-transparent px-3 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
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

          <div className="mt-7 flex flex-wrap gap-2">
            <button
              onClick={() => onSelectCategory('All Products')}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                selectedCategory === 'All Products'
                  ? 'bg-white text-[#123b68]'
                  : 'border border-white/45 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20'
              }`}
            >
              All products
            </button>
            {storeCategories.map((category) => (
              <button
                key={category.name}
                onClick={() => onSelectCategory(category.name)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                  selectedCategory === category.name
                    ? 'bg-white text-[#123b68]'
                    : 'border border-white/45 bg-white/10 text-white backdrop-blur-sm hover:bg-white/20'
                }`}
              >
                {category.icon}
                {category.name}
              </button>
            ))}
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
