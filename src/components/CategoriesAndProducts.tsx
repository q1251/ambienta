import React from 'react';
import { Search, Sparkles, AlertCircle, ShoppingCart, Star, CheckCircle, Moon, Flame, Zap, Heart, ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { CatalogItem, StoreCategory } from '../types/pharmacy';

interface CategoriesAndProductsProps {
  catalogItems: CatalogItem[];
  categories: StoreCategory[];
  onSelectItem: (item: CatalogItem) => void;
  selectedCategory: StoreCategory | 'All Products';
  onSelectCategory: (category: StoreCategory | 'All Products') => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const CategoriesAndProducts: React.FC<CategoriesAndProductsProps> = ({
  catalogItems,
  categories,
  onSelectItem,
  selectedCategory,
  onSelectCategory,
  searchQuery,
  setSearchQuery,
}) => {
  const [imageIndexes, setImageIndexes] = React.useState<Record<string, number>>({});
  const storeCategories: (StoreCategory | 'All Products')[] = ['All Products', ...categories];
  const filteredItems = catalogItems.filter((item) => {
    const matchesCategory =
      selectedCategory === 'All Products' || item.category === selectedCategory;
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.dosage.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  }).sort((a, b) => Number(b.isFeatured === true) - Number(a.isFeatured === true) || a.name.localeCompare(b.name));

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'Sleep':
        return <Moon className="w-3.5 h-3.5 text-indigo-500" />;
      case 'Weight Loss':
        return <Flame className="w-3.5 h-3.5 text-amber-500" />;
      case 'Energy & Focus':
        return <Zap className="w-3.5 h-3.5 text-yellow-500" />;
      case 'Heart & Circulation':
        return <Heart className="w-3.5 h-3.5 text-rose-500" />;
      default:
        return <ShieldCheck className="w-3.5 h-3.5 text-blue-700" />;
    }
  };

  return (
    <section id="store-catalog" className="min-h-screen bg-[#f4f8fc] py-16 sm:py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header & Search */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#174c80]">
              <Sparkles className="h-3.5 w-3.5 text-blue-700" />
              <span>Small rituals. Better days.</span>
            </div>
            <h2 className="text-3xl font-semibold tracking-[-0.05em] text-slate-900 sm:text-4xl">
              {selectedCategory === 'All Products'
                ? 'All Health & Wellness Products'
                : `${selectedCategory} Formulations`}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Showing {filteredItems.length} clinical-grade wellness {filteredItems.length === 1 ? 'item' : 'items'} available for rapid delivery
            </p>
          </div>

          {/* Quick in-catalog search */}
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products, ingredients..."
              className="w-full rounded-2xl border border-blue-100 bg-white py-3 pl-10 pr-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-700/20"
            />
          </div>
        </div>

        {/* Category Navigation Bar */}
        <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-8 no-scrollbar">
          {storeCategories.map((cat) => {
            const count =
              cat === 'All Products'
                ? catalogItems.length
                : catalogItems.filter((i) => i.category === cat).length;
            const isSelected = selectedCategory === cat;

            return (
              <button
                key={cat}
                onClick={() => onSelectCategory(cat)}
                className={`px-4 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-all flex items-center gap-2 cursor-pointer ${
                  isSelected
                    ? 'bg-[#174c80] text-white shadow-sm'
                    : 'border border-blue-100 bg-white text-slate-700 hover:border-blue-300 hover:bg-[#f8fbff]'
                }`}
              >
                {cat !== 'All Products' && getCategoryIcon(cat)}
                <span>{cat}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${
                    isSelected ? 'bg-white/15 text-blue-100' : 'bg-[#edf4fb] text-slate-500'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Product Cards Grid */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredItems.map((item) => {
            const isOutOfStock = !item.inStock || item.stockCount <= 0;
            const isLowStock = item.stockCount <= item.minStockThreshold && !isOutOfStock;
            const images = item.images?.length ? item.images : item.image ? [item.image] : [];
            const imageIndex = Math.min(imageIndexes[item.id] ?? 0, Math.max(images.length - 1, 0));
            const selectedImage = images[imageIndex];

            return (
              <div
                key={item.id}
                data-product-id={item.id}
                data-product-name={item.name}
                className="group flex flex-col justify-between overflow-hidden rounded-[24px] border border-blue-100 bg-white shadow-[0_8px_24px_-18px_rgba(23,76,128,0.2)] transition duration-300 hover:-translate-y-1 hover:border-blue-300 hover:shadow-[0_24px_50px_-25px_rgba(23,76,128,0.25)]"
              >
                <div>
                  {/* Product Image */}
                  <div className="relative aspect-[4/3] w-full overflow-hidden border-b border-blue-50 bg-[#edf4fb]">
                    {selectedImage ? (
                      <img
                        src={selectedImage}
                        alt={item.name}
                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[#e8f2fb] text-blue-800">
                        {getCategoryIcon(item.category)}
                      </div>
                    )}

                    {images.length > 1 && (
                      <>
                        <button
                          type="button"
                          aria-label={`Previous ${item.name} image`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setImageIndexes((current) => ({ ...current, [item.id]: (imageIndex - 1 + images.length) % images.length }));
                          }}
                          className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-sm transition hover:bg-white"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Next ${item.name} image`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setImageIndexes((current) => ({ ...current, [item.id]: (imageIndex + 1) % images.length }));
                          }}
                          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-sm transition hover:bg-white"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-slate-950/30 px-2 py-1">
                          {images.map((image, index) => (
                            <button
                              key={`${image}-${index}`}
                              type="button"
                              aria-label={`Show ${item.name} image ${index + 1}`}
                              aria-pressed={index === imageIndex}
                              onClick={(event) => {
                                event.stopPropagation();
                                setImageIndexes((current) => ({ ...current, [item.id]: index }));
                              }}
                              className={`h-1.5 w-1.5 rounded-full transition ${index === imageIndex ? 'bg-white' : 'bg-white/55 hover:bg-white/80'}`}
                            />
                          ))}
                        </div>
                      </>
                    )}

                    {/* Stock Overlay */}
                    {isOutOfStock ? (
                      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center">
                        <span className="text-white text-xs font-bold px-3 py-1 bg-rose-600 rounded shadow-xs">
                          Temporarily Out of Stock
                        </span>
                      </div>
                    ) : (
                      <div className="absolute top-2.5 left-2.5">
                        <span className="bg-white/90 backdrop-blur-xs text-slate-800 text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-200/60 shadow-2xs flex items-center gap-1">
                          {getCategoryIcon(item.category)}
                          {item.category}
                        </span>
                      </div>
                    )}

                    {item.isFeatured && (
                      <div className="absolute bottom-2.5 left-2.5">
                        <span className="inline-flex items-center gap-1 rounded-md border border-amber-200/80 bg-white/95 px-2 py-1 text-[10px] font-bold text-amber-800 shadow-sm">
                          <Star className="h-3 w-3 fill-current" />
                          Featured
                        </span>
                      </div>
                    )}

                    {item.rxRequired && !isOutOfStock && (
                      <div className="absolute top-2.5 right-2.5">
                        <span className="bg-amber-100/90 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-md border border-amber-300/80 shadow-2xs">
                          Clinical Grade
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Body Content */}
                  <div className="space-y-3 p-5">
                    {/* Ratings */}
                    <div className="flex items-center gap-1 text-[11px] text-amber-500">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      <span className="font-bold text-slate-800">4.9</span>
                      <span className="text-slate-400 text-[10px]">(Verified Buyer Review)</span>
                    </div>

                    <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-[-0.02em] text-slate-900 transition-colors group-hover:text-[#174c80]">
                      {item.name}
                    </h3>

                    <p className="line-clamp-2 text-xs leading-relaxed text-slate-500">
                      {item.description}
                    </p>

                    <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                      <span className="font-medium text-slate-600 truncate max-w-[150px]">
                        {item.dosage}
                      </span>
                      {isLowStock ? (
                        <span className="text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded text-[10px]">
                          Only {item.stockCount} left
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-medium flex items-center gap-0.5 text-[10px]">
                          <CheckCircle className="w-3 h-3 text-emerald-600" />
                          In Stock
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Footer: Price & Add to Cart */}
                <div className="flex items-center justify-between border-t border-blue-50 bg-[#f8fbff] px-5 py-4">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wider block">
                      Price
                    </span>
                    <span className="font-mono text-lg font-bold tracking-tight text-slate-900">
                      ${item.price.toFixed(2)}
                    </span>
                  </div>

                  <button
                    disabled={isOutOfStock}
                    onClick={() => onSelectItem(item)}
                    className="flex items-center gap-1.5 rounded-full bg-[#174c80] px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#123b68] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" />
                    <span>{isOutOfStock ? 'Sold Out' : 'Add to Cart'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty State */}
        {filteredItems.length === 0 && (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200 p-8 shadow-xs max-w-md mx-auto">
            <AlertCircle className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <h4 className="text-base font-bold text-slate-900">No products found</h4>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              We couldn't find any items matching "{searchQuery}" under {selectedCategory}. Try another search term or clear the filter.
            </p>
            <button
              onClick={() => {
                setSearchQuery('');
                onSelectCategory('All Products');
              }}
              className="mt-4 rounded-lg bg-[#174c80] px-4 py-2 text-xs font-semibold text-white hover:bg-[#123b68]"
            >
              Reset Filters
            </button>
          </div>
        )}
      </div>
    </section>
  );
};
