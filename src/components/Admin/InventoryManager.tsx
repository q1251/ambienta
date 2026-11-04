import React, { useEffect, useRef, useState } from 'react';
import {
  Package,
  Plus,
  AlertTriangle,
  Search,
  DollarSign,
  TrendingUp,
  Percent,
  CheckCircle2,
  Trash2,
  Edit2,
  X,
  Upload,
  Download,
  FileSpreadsheet,
  Layers,
  ArrowUpDown,
  Eye,
  EyeOff,
  Star,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { CatalogItem } from '../../types/pharmacy';
import { generateProductTemplateCsv, parseProductsCsv } from '../../utils/productCsv';
import type { ProductCsvItem } from '../../utils/productCsv';

interface InventoryManagerProps {
  catalogItems: CatalogItem[];
  categories: string[];
  catalogError?: string;
  onAddCategory: (name: string) => Promise<string>;
  onBulkAddProducts: (products: ProductCsvItem[]) => Promise<CatalogItem[]>;
  onAddProduct: (item: CatalogItem) => Promise<CatalogItem>;
  onUploadProductImages: (files: File[]) => Promise<string[]>;
  onUpdateProduct: (item: CatalogItem) => Promise<CatalogItem>;
  onDeleteProduct: (productId: string) => Promise<void>;
  onBulkPriceAdjust: (category: string, percentChange: number) => Promise<void>;
}

interface PendingProductImage {
  file: File;
  previewUrl: string;
}

const getProductImages = (item: CatalogItem): string[] =>
  item.images?.length ? item.images : item.image ? [item.image] : [];

export const InventoryManager: React.FC<InventoryManagerProps> = ({
  catalogItems,
  categories,
  catalogError,
  onAddCategory,
  onBulkAddProducts,
  onAddProduct,
  onUploadProductImages,
  onUpdateProduct,
  onDeleteProduct,
  onBulkPriceAdjust,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [stockStatusFilter, setStockStatusFilter] = useState('All');

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [previewItem, setPreviewItem] = useState<CatalogItem | null>(null);
  const [previewImageIndex, setPreviewImageIndex] = useState(0);
  const [isBulkPriceModalOpen, setIsBulkPriceModalOpen] = useState(false);
  const [isProductCsvOpen, setIsProductCsvOpen] = useState(false);
  const [bulkCategory, setBulkCategory] = useState('All');
  const [bulkPercent, setBulkPercent] = useState<number>(5);
  const [notification, setNotification] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [productCsv, setProductCsv] = useState('');
  const [newCategory, setNewCategory] = useState('');

  // New product form state
  const [name, setName] = useState('');
  const [category, setCategory] = useState<CatalogItem['category']>('Sleep');
  const [price, setPrice] = useState<string>('19.99');
  const [copayPrice, setCopayPrice] = useState<string>('5.00');
  const [costPrice, setCostPrice] = useState<string>('8.50');
  const [stockCount, setStockCount] = useState<string>('50');
  const [minThreshold, setMinThreshold] = useState<string>('15');
  const [dosage, setDosage] = useState('');
  const [sku, setSku] = useState('');
  const [ndcCode, setNdcCode] = useState('');
  const [description, setDescription] = useState('');
  const [rxRequired, setRxRequired] = useState(false);
  const [isFeatured, setIsFeatured] = useState(false);
  const [isPublished, setIsPublished] = useState(true);
  const [newProductImages, setNewProductImages] = useState<PendingProductImage[]>([]);
  const [editingProductImages, setEditingProductImages] = useState<PendingProductImage[]>([]);
  const previewUrls = useRef(new Set<string>());
  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  const productCsvPreview = parseProductsCsv(
    productCsv,
    catalogItems.map((item) => item.sku),
    categories,
  );

  const handleProductImageSelection = (
    event: React.ChangeEvent<HTMLInputElement>,
    existingCount: number,
    pending: PendingProductImage[],
    setPending: React.Dispatch<React.SetStateAction<PendingProductImage[]>>,
  ) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    const remainingSlots = Math.max(0, 10 - existingCount - pending.length);
    if (files.length > remainingSlots) {
      setActionError(`A product can have up to 10 images. You can add ${remainingSlots} more.`);
      return;
    }

    const invalidFile = files.find((file) => {
      const allowedType = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type);
      return !allowedType || file.size > 5 * 1024 * 1024 || file.size === 0;
    });
    if (invalidFile) {
      setActionError('Choose JPEG, PNG, WebP, or GIF images no larger than 5 MB each.');
      return;
    }

    setActionError('');
    const selectedImages = files.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      return { file, previewUrl };
    });
    setPending((current) => [...current, ...selectedImages]);
  };

  const removePendingProductImage = (
    image: PendingProductImage,
    setPending: React.Dispatch<React.SetStateAction<PendingProductImage[]>>,
  ) => {
    URL.revokeObjectURL(image.previewUrl);
    previewUrls.current.delete(image.previewUrl);
    setPending((current) => current.filter((entry) => entry.previewUrl !== image.previewUrl));
  };

  const clearPendingProductImages = (
    pending: PendingProductImage[],
    setPending: React.Dispatch<React.SetStateAction<PendingProductImage[]>>,
  ) => {
    pending.forEach((image) => {
      URL.revokeObjectURL(image.previewUrl);
      previewUrls.current.delete(image.previewUrl);
    });
    setPending([]);
  };

  const closeAddModal = () => {
    clearPendingProductImages(newProductImages, setNewProductImages);
    setIsAddModalOpen(false);
  };

  const closeEditModal = () => {
    clearPendingProductImages(editingProductImages, setEditingProductImages);
    setEditingItem(null);
  };

  // Stats calculation
  const totalProducts = catalogItems.length;
  const lowStockCount = catalogItems.filter(
    (i) => i.stockCount <= i.minStockThreshold && i.stockCount > 0
  ).length;
  const outOfStockCount = catalogItems.filter((i) => i.stockCount <= 0).length;
  const totalInventoryValuation = catalogItems.reduce(
    (sum, i) => sum + i.price * i.stockCount,
    0
  );

  // Filtered list
  const filteredProducts = catalogItems.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.ndcCode && item.ndcCode.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = categoryFilter === 'All' || item.category === categoryFilter;

    let matchesStock = true;
    if (stockStatusFilter === 'Low') {
      matchesStock = item.stockCount <= item.minStockThreshold && item.stockCount > 0;
    } else if (stockStatusFilter === 'Out') {
      matchesStock = item.stockCount <= 0;
    } else if (stockStatusFilter === 'InStock') {
      matchesStock = item.stockCount > item.minStockThreshold;
    }

    return matchesSearch && matchesCategory && matchesStock;
  });

  const handleStockAdjust = async (item: CatalogItem, delta: number) => {
    const newCount = Math.max(0, item.stockCount + delta);
    setActionError('');
    setIsSaving(true);
    try {
      await onUpdateProduct({
        ...item,
        stockCount: newCount,
        inStock: newCount > 0,
        lastRestocked: delta > 0 ? new Date().toISOString().slice(0, 10) : item.lastRestocked,
      });
      setNotification(`Updated stock for ${item.name} to ${newCount} units.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Inventory update could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleListing = async (item: CatalogItem, field: 'isActive' | 'isFeatured') => {
    const currentlyEnabled = field === 'isActive' ? item.isActive !== false : item.isFeatured === true;
    setActionError('');
    setIsSaving(true);
    try {
      const savedItem = await onUpdateProduct({ ...item, [field]: !currentlyEnabled });
      setNotification(
        field === 'isActive'
          ? `${savedItem.name} is now ${savedItem.isActive === false ? 'hidden from' : 'visible on'} the storefront.`
          : `${savedItem.name} ${savedItem.isFeatured ? 'added to' : 'removed from'} featured products.`,
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The storefront setting could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const parsedPrice = Number(price);
    const parsedStock = Number(stockCount);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0 || !Number.isInteger(parsedStock) || parsedStock < 0) {
      setActionError('Enter a non-negative price and whole-number stock count.');
      return;
    }

    const newItem: CatalogItem = {
      id: `prod-${crypto.randomUUID()}`,
      name: name.trim(),
      category,
      price: parsedPrice,
      copayPrice: Number(copayPrice) || 0,
      costPrice: Number(costPrice) || 0,
      stockCount: parsedStock,
      minStockThreshold: Number(minThreshold) || 10,
      dosage: dosage.trim() || 'Standard Clinical Unit',
      sku: sku.trim() || `SKU-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      ndcCode: ndcCode.trim() || undefined,
      description: description.trim() || 'Verified pharmaceutical formulation.',
      rxRequired,
      isActive: isPublished,
      isFeatured,
      inStock: parsedStock > 0,
      image: undefined,
      images: [],
      lastRestocked: new Date().toISOString().slice(0, 10),
    };

    setActionError('');
    setIsSaving(true);
    try {
      const uploadedImages = newProductImages.length
        ? await onUploadProductImages(newProductImages.map(({ file }) => file))
        : [];
      const images = uploadedImages;
      await onAddProduct({ ...newItem, image: images[0], images });
      setNotification(`Successfully added product: ${newItem.name}`);
      setIsAddModalOpen(false);
      clearPendingProductImages(newProductImages, setNewProductImages);
      setName('');
      setDescription('');
      setDosage('');
      setSku('');
      setNdcCode('');
      setIsFeatured(false);
      setIsPublished(true);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The product could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    setActionError('');
    setIsSaving(true);
    try {
      const uploadedImages = editingProductImages.length
        ? await onUploadProductImages(editingProductImages.map(({ file }) => file))
        : [];
      const images = [...(editingItem.images ?? []), ...uploadedImages];
      await onUpdateProduct({ ...editingItem, image: images[0], images });
      setNotification(`Saved changes for ${editingItem.name}.`);
      setEditingItem(null);
      clearPendingProductImages(editingProductImages, setEditingProductImages);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The product update could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyBulkPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError('');
    setIsSaving(true);
    try {
      await onBulkPriceAdjust(bulkCategory, bulkPercent);
      setNotification(
        `Applied ${bulkPercent > 0 ? `+${bulkPercent}%` : `${bulkPercent}%`} price adjustment to ${
          bulkCategory === 'All' ? 'all catalog products' : bulkCategory
        }.`
      );
      setIsBulkPriceModalOpen(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Bulk price changes could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    setActionError('');
    setIsSaving(true);
    try {
      const savedCategory = await onAddCategory(newCategory);
      setCategory(savedCategory);
      setNewCategory('');
      setNotification(`Added product category: ${savedCategory}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The category could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleBulkProductImport = async () => {
    setActionError('');
    setIsSaving(true);
    try {
      const saved = await onBulkAddProducts(productCsvPreview.products);
      setNotification(`Imported ${saved.length} product${saved.length === 1 ? '' : 's'} successfully.`);
      setProductCsv('');
      setIsProductCsvOpen(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The product import could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleProductCsvFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setProductCsv(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => setActionError('The selected CSV file could not be read.');
    reader.readAsText(file);
    event.target.value = '';
  };

  const downloadProductTemplate = () => {
    const url = URL.createObjectURL(new Blob([generateProductTemplateCsv()], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ambients-products-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const previewImages = previewItem ? getProductImages(previewItem) : [];
  const activePreviewImage = previewImages[Math.min(previewImageIndex, Math.max(0, previewImages.length - 1))];

  return (
    <div className="space-y-4">
      {catalogError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{catalogError}</p>}
      {/* Top Controls Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-teal-800 uppercase tracking-wider mb-1">
            <Package className="w-3.5 h-3.5 text-teal-700" />
            <span>Dispensary Catalog &amp; Formulations</span>
          </div>
          <h3 className="text-base font-bold text-slate-900">
            Product catalog
          </h3>
          <p className="text-xs text-slate-500">
            Manage product details, storefront placement, pricing, and catalog presentation
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsProductCsvOpen(true)}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md transition-colors flex items-center gap-1.5 shadow-xs"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-teal-700" />
            <span>Bulk CSV Upload</span>
          </button>
          <button
            onClick={() => setIsBulkPriceModalOpen(true)}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md transition-colors flex items-center gap-1.5 shadow-xs"
          >
            <Percent className="w-3.5 h-3.5 text-teal-700" />
            <span>Bulk Price Adjust</span>
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-md transition-colors flex items-center gap-1.5 shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Upload New Product</span>
          </button>
        </div>
      </div>

      {notification && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span className="font-semibold">{notification}</span>
          </div>
          <button
            onClick={() => setNotification(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-bold"
          >
            Dismiss
          </button>
        </div>
      )}
      {actionError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{actionError}</p>}

      <form onSubmit={handleAddCategory} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="min-w-56 flex-1 text-xs font-semibold text-slate-700">
          Product categories
          <span className="mt-1 block text-[11px] font-normal text-slate-500">Categories are shared with the public storefront.</span>
        </label>
        <label className="min-w-48 flex-[2] text-xs font-medium text-slate-700">
          Add a category
          <input
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            maxLength={80}
            placeholder="e.g. Skin & Hair"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <button disabled={isSaving || !newCategory.trim()} className="rounded-md bg-teal-800 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
          Add category
        </button>
        <span className="w-full text-[11px] text-slate-500">{categories.join(' · ') || 'No categories configured.'}</span>
      </form>

      {/* Inventory KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Total Catalog Products</span>
            <Package className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900">{totalProducts}</div>
          <p className="text-[11px] text-slate-400 mt-1">Active formulations</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Low Stock Warnings</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-700">{lowStockCount}</div>
          <p className="text-[11px] text-slate-400 mt-1">Below threshold units</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Out of Stock</span>
            <Package className="w-4 h-4 text-rose-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-rose-700">{outOfStockCount}</div>
          <p className="text-[11px] text-slate-400 mt-1">Requires supplier order</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 text-xs mb-1">
            <span>Retail Inventory Value</span>
            <DollarSign className="w-4 h-4 text-teal-600" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900">
            ${totalInventoryValuation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">On-shelf valuation</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by product name, SKU (e.g. RX-MET-500ER), or NDC code..."
            className="w-full bg-slate-50 border border-slate-300 rounded-md pl-9 pr-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-700"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-xs text-slate-800"
          >
            <option value="All">All Categories</option>
            {categories.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>

          <select
            value={stockStatusFilter}
            onChange={(e) => setStockStatusFilter(e.target.value)}
            className="bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-xs text-slate-800"
          >
            <option value="All">All Stock Levels</option>
            <option value="InStock">Normal Stock</option>
            <option value="Low">Low Stock (&le; threshold)</option>
            <option value="Out">Out of Stock</option>
          </select>
        </div>
      </div>

      {/* Inventory & Price Adjustments Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="hidden overflow-x-auto 2xl:block">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4">Product &amp; SKU</th>
                <th className="py-3 px-3">Category</th>
                <th className="py-3 px-3">Price &amp; Copay</th>
                <th className="py-3 px-3 text-center">Stock Level</th>
                <th className="py-3 px-3 text-center">Quick Stock Adjust</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-3 text-center">Storefront</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredProducts.map((item) => {
                const isLow = item.stockCount <= item.minStockThreshold && item.stockCount > 0;
                const isOut = item.stockCount <= 0;

                return (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        {item.image ? (
                          <img
                            src={item.image}
                            alt={item.name}
                            className="w-10 h-10 rounded-md object-cover border border-slate-200 shrink-0"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-md bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-800 shrink-0">
                            <Package className="w-5 h-5" />
                          </div>
                        )}
                        <div>
                          <p className="font-bold text-slate-900">{item.name}</p>
                          <p className="text-[11px] text-slate-500 font-mono">
                            SKU: {item.sku} {item.ndcCode ? `· ${item.ndcCode}` : ''}
                          </p>
                          <p className="text-[11px] text-slate-400">{item.dosage}</p>
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-3">
                      <span className="font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded-sm border border-teal-200 whitespace-nowrap">
                        {item.category}
                      </span>
                      {item.rxRequired && (
                        <span className="block text-[10px] text-amber-700 font-medium mt-1">
                          Rx Required
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-3 font-mono">
                      <div>
                        <span className="text-slate-400 text-[11px] block">Retail Price:</span>
                        <span className="font-bold text-slate-900">${item.price.toFixed(2)}</span>
                      </div>
                      {item.copayPrice !== undefined && item.copayPrice > 0 && (
                        <div className="mt-0.5 text-[11px] text-teal-700">
                          Copay: ${item.copayPrice.toFixed(2)}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-3 text-center font-mono">
                      <span
                        className={`text-sm font-bold ${
                          isOut ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-slate-900'
                        }`}
                      >
                        {item.stockCount}
                      </span>
                      <span className="block text-[10px] text-slate-400">
                        Min: {item.minStockThreshold}
                      </span>
                    </td>

                    <td className="py-3 px-3 text-center">
                      <div className="inline-flex items-center gap-1 bg-slate-100 p-1 rounded-md border border-slate-200">
                        <button
                          disabled={isSaving}
                          onClick={() => handleStockAdjust(item, -10)}
                          title="Decrease 10"
                          className="px-2 py-0.5 text-[11px] font-mono font-bold bg-white text-slate-700 hover:bg-slate-200 rounded shadow-2xs"
                        >
                          -10
                        </button>
                        <button
                          disabled={isSaving}
                          onClick={() => handleStockAdjust(item, -1)}
                          title="Decrease 1"
                          className="px-2 py-0.5 text-[11px] font-mono font-bold bg-white text-slate-700 hover:bg-slate-200 rounded shadow-2xs"
                        >
                          -1
                        </button>
                        <button
                          disabled={isSaving}
                          onClick={() => handleStockAdjust(item, 1)}
                          title="Increase 1"
                          className="px-2 py-0.5 text-[11px] font-mono font-bold bg-white text-slate-700 hover:bg-slate-200 rounded shadow-2xs"
                        >
                          +1
                        </button>
                        <button
                          disabled={isSaving}
                          onClick={() => handleStockAdjust(item, 10)}
                          title="Increase 10"
                          className="px-2 py-0.5 text-[11px] font-mono font-bold bg-white text-slate-700 hover:bg-slate-200 rounded shadow-2xs"
                        >
                          +10
                        </button>
                      </div>
                    </td>

                    <td className="py-3 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-sm text-[11px] font-semibold border ${
                          isOut
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : isLow
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        }`}
                      >
                        {isOut ? 'Out of Stock' : isLow ? 'Low Stock' : 'In Stock'}
                      </span>
                    </td>

                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => void handleToggleListing(item, 'isFeatured')}
                          title={item.isFeatured ? 'Remove from featured products' : 'Feature this product'}
                          aria-label={item.isFeatured ? `Unfeature ${item.name}` : `Feature ${item.name}`}
                          aria-pressed={item.isFeatured === true}
                          className={`rounded-md p-1.5 transition-colors ${item.isFeatured ? 'bg-amber-50 text-amber-600 hover:bg-amber-100' : 'text-slate-400 hover:bg-slate-100 hover:text-amber-600'}`}
                        >
                          <Star className={`h-4 w-4 ${item.isFeatured ? 'fill-current' : ''}`} />
                        </button>
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => void handleToggleListing(item, 'isActive')}
                          title={item.isActive === false ? 'Show on storefront' : 'Hide from storefront'}
                          aria-label={item.isActive === false ? `Show ${item.name} on storefront` : `Hide ${item.name} from storefront`}
                          aria-pressed={item.isActive !== false}
                          className={`rounded-md p-1.5 transition-colors ${item.isActive === false ? 'bg-slate-100 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700' : 'bg-emerald-50 text-emerald-700 hover:bg-amber-50 hover:text-amber-700'}`}
                        >
                          {item.isActive === false ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                      <div className="mt-1 flex justify-center gap-1">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.isActive === false ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>
                          {item.isActive === false ? 'Hidden' : 'Published'}
                        </span>
                        {item.isFeatured && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Featured</span>}
                      </div>
                    </td>

                    <td className="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => {
                          setPreviewImageIndex(0);
                          setPreviewItem(item);
                        }}
                        className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-teal-800"
                        title="Preview storefront card"
                        aria-label={`Preview ${item.name} storefront card`}
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => {
                          clearPendingProductImages(editingProductImages, setEditingProductImages);
                          setEditingItem({ ...item, images: getProductImages(item) });
                        }}
                        className="p-1.5 text-slate-500 hover:text-teal-800 hover:bg-slate-100 rounded-md transition-colors"
                        title="Edit Price & Details"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => {
                          if (window.confirm(`Archive "${item.name}"? It will disappear from the storefront, but old order records will remain.`)) {
                            setActionError('');
                            setIsSaving(true);
                            void onDeleteProduct(item.id)
                              .then(() => setNotification(`Archived ${item.name}.`))
                              .catch((error: unknown) => setActionError(error instanceof Error ? error.message : 'The product could not be archived.'))
                              .finally(() => setIsSaving(false));
                          }
                        }}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                        title="Delete Product"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 p-3 2xl:hidden sm:grid-cols-2 sm:p-4">
          {filteredProducts.map((item) => {
            const isLow = item.stockCount <= item.minStockThreshold && item.stockCount > 0;
            const isOut = item.stockCount <= 0;
            return (
              <article key={item.id} className="min-w-0 rounded-xl border border-[#e5e8e1] bg-white p-4 transition hover:border-[#c8d4c8]">
                <div className="flex items-start gap-3">
                  {item.image
                    ? <img src={item.image} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-slate-200 object-cover" referrerPolicy="no-referrer" />
                    : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[#edf2ed] text-[#456953]"><Package className="h-6 w-6" /></span>}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-bold leading-5 text-slate-900">{item.name}</p>
                    <p className="mt-1 truncate font-mono text-[11px] text-slate-500">{item.sku}{item.ndcCode ? ` · ${item.ndcCode}` : ''}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-md bg-[#edf2ed] px-2 py-1 text-[10px] font-semibold text-[#456953]">{item.category}</span>
                      {item.rxRequired && <span className="rounded-md bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">Rx required</span>}
                      {item.isFeatured && <span className="rounded-md bg-[#f7f1e4] px-2 py-1 text-[10px] font-semibold text-[#8a6c2d]">Featured</span>}
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Retail</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">${item.price.toFixed(2)}</p>
                    {item.copayPrice !== undefined && item.copayPrice > 0 && <p className="mt-0.5 text-[11px] text-slate-500">Copay ${item.copayPrice.toFixed(2)}</p>}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Stock</p>
                    <p className={`mt-1 text-sm font-bold ${isOut ? 'text-rose-700' : isLow ? 'text-amber-700' : 'text-slate-900'}`}>{item.stockCount} <span className="text-[10px] font-medium text-slate-500">/ min {item.minStockThreshold}</span></p>
                    <p className={`mt-0.5 text-[11px] font-medium ${isOut ? 'text-rose-700' : isLow ? 'text-amber-700' : 'text-emerald-700'}`}>{isOut ? 'Out of stock' : isLow ? 'Low stock' : 'In stock'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Listing</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{item.isActive === false ? 'Hidden' : 'Published'}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{item.dosage || 'Catalog item'}</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-[#f7f8f6] p-1">
                    {([-1, 1] as const).map((change) => (
                      <button key={change} type="button" disabled={isSaving} onClick={() => handleStockAdjust(item, change)} aria-label={`${change < 0 ? 'Decrease' : 'Increase'} stock for ${item.name}`} className="rounded-md px-2.5 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-white hover:text-[#315649] disabled:opacity-40">{change < 0 ? '−1' : '+1'}</button>
                    ))}
                    <span className="mx-0.5 h-4 w-px bg-slate-200" />
                    {([-10, 10] as const).map((change) => (
                      <button key={change} type="button" disabled={isSaving} onClick={() => handleStockAdjust(item, change)} aria-label={`${change < 0 ? 'Decrease' : 'Increase'} stock by ten for ${item.name}`} className="rounded-md px-2 py-1.5 text-[11px] font-bold text-slate-500 transition hover:bg-white hover:text-[#315649] disabled:opacity-40">{change < 0 ? '−10' : '+10'}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" disabled={isSaving} onClick={() => void handleToggleListing(item, 'isFeatured')} aria-label={item.isFeatured ? `Unfeature ${item.name}` : `Feature ${item.name}`} aria-pressed={item.isFeatured === true} className={`rounded-lg p-2 transition hover:bg-[#f7f1e4] ${item.isFeatured ? 'text-amber-600' : 'text-slate-400 hover:text-amber-600'}`}><Star className={`h-4 w-4 ${item.isFeatured ? 'fill-current' : ''}`} /></button>
                    <button type="button" disabled={isSaving} onClick={() => void handleToggleListing(item, 'isActive')} aria-label={item.isActive === false ? `Show ${item.name} on storefront` : `Hide ${item.name} from storefront`} aria-pressed={item.isActive !== false} className={`rounded-lg p-2 transition hover:bg-[#edf2ed] ${item.isActive === false ? 'text-slate-400' : 'text-emerald-700'}`}>{item.isActive === false ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
                    <button type="button" disabled={isSaving} onClick={() => { setPreviewImageIndex(0); setPreviewItem(item); }} aria-label={`Preview ${item.name} storefront card`} className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-[#315649]"><Eye className="h-4 w-4" /></button>
                    <button type="button" disabled={isSaving} onClick={() => { clearPendingProductImages(editingProductImages, setEditingProductImages); setEditingItem({ ...item, images: getProductImages(item) }); }} aria-label={`Edit ${item.name}`} className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-[#315649]"><Edit2 className="h-4 w-4" /></button>
                    <button type="button" disabled={isSaving} onClick={() => {
                      if (window.confirm(`Archive "${item.name}"? It will disappear from the storefront, but old order records will remain.`)) {
                        setActionError('');
                        setIsSaving(true);
                        void onDeleteProduct(item.id)
                          .then(() => setNotification(`Archived ${item.name}.`))
                          .catch((error: unknown) => setActionError(error instanceof Error ? error.message : 'The product could not be archived.'))
                          .finally(() => setIsSaving(false));
                      }
                    }} aria-label={`Archive ${item.name}`} className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {filteredProducts.length === 0 && (
          <div className="text-center py-12 text-slate-500 text-xs">
            No products match the selected criteria.
          </div>
        )}
      </div>

      {previewItem && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-label={`${previewItem.name} storefront preview`} onClick={() => setPreviewItem(null)}>
          <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="font-semibold text-slate-900">Storefront preview</h3>
                <p className="text-xs text-slate-500">Product card appearance</p>
              </div>
              <button type="button" onClick={() => setPreviewItem(null)} aria-label="Close preview" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5">
              <div className="relative mb-4 aspect-[4/3] overflow-hidden rounded-2xl bg-slate-100">
                {activePreviewImage ? (
                  <img src={activePreviewImage} alt={previewItem.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-400"><Package className="h-12 w-12" /></div>
                )}
                {previewImages.length > 1 && (
                  <>
                    <button type="button" aria-label="Previous preview image" onClick={() => setPreviewImageIndex((index) => (index - 1 + previewImages.length) % previewImages.length)} className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-sm">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="Next preview image" onClick={() => setPreviewImageIndex((index) => (index + 1) % previewImages.length)} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-sm">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </>
                )}
                {previewItem.isFeatured && <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-amber-700 shadow-sm"><Star className="h-3 w-3 fill-current" /> Featured</span>}
                {previewItem.isActive === false && <span className="absolute right-3 top-3 rounded-full bg-slate-900/80 px-2.5 py-1 text-[11px] font-semibold text-white">Hidden</span>}
              </div>
              {previewImages.length > 1 && (
                <div className="mb-4 flex gap-2 overflow-x-auto">
                  {previewImages.map((image, index) => (
                    <button key={`${image}-${index}`} type="button" onClick={() => setPreviewImageIndex(index)} aria-label={`Preview image ${index + 1}`} aria-pressed={index === previewImageIndex} className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2 ${index === previewImageIndex ? 'border-teal-700' : 'border-transparent'}`}>
                      <img src={image} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs font-medium text-teal-800">{previewItem.category}{previewItem.rxRequired ? ' · Prescription required' : ''}</p>
              <h4 className="mt-1 text-lg font-semibold leading-snug text-slate-900">{previewItem.name}</h4>
              <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-600">{previewItem.description || 'Product description will appear here.'}</p>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                <span className="text-lg font-semibold text-slate-900">${previewItem.price.toFixed(2)}</span>
                <span className="text-xs text-slate-500">{previewItem.dosage || 'Product details'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {isProductCsvOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Bulk product CSV upload</h3>
                <p className="mt-1 text-xs text-slate-500">Validate every row before importing; the server saves the batch atomically.</p>
              </div>
              <button type="button" onClick={() => setIsProductCsvOpen(false)} aria-label="Close CSV import" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div className="flex flex-wrap gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">
                  <Upload className="h-4 w-4" /> Choose CSV
                  <input type="file" accept=".csv,text/csv" className="sr-only" onChange={handleProductCsvFile} />
                </label>
                <button type="button" onClick={downloadProductTemplate} className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50">
                  <Download className="h-4 w-4" /> Download template
                </button>
              </div>
              <label htmlFor="product-csv" className="block text-sm font-medium text-slate-700">Or paste CSV</label>
              <textarea
                id="product-csv"
                value={productCsv}
                onChange={(event) => setProductCsv(event.target.value)}
                rows={6}
                placeholder={'name,category,sku,price,stock_count\nVitamin C,Daily Wellness,SKU-VIT-C,19.99,50'}
                className="w-full rounded-md border border-slate-300 p-3 font-mono text-xs"
              />
              {productCsvPreview.errors.length > 0 && (
                <div role="alert" className="space-y-1 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                  {productCsvPreview.errors.map((error) => <p key={error}>{error}</p>)}
                  <p className="pt-1 font-semibold">Fix all errors before importing. No rows will be imported while errors remain.</p>
                </div>
              )}
              {productCsvPreview.products.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Price</th><th className="px-3 py-2">Stock</th></tr></thead>
                    <tbody>{productCsvPreview.products.map((product) => (
                      <tr key={product.sku} className="border-t border-slate-100">
                        <td className="px-3 py-2">{product.name}</td><td className="px-3 py-2 font-mono">{product.sku}</td><td className="px-3 py-2">{product.category}</td><td className="px-3 py-2">${product.price.toFixed(2)}</td><td className="px-3 py-2">{product.stockCount}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
                <button type="button" onClick={() => setIsProductCsvOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
                <button
                  type="button"
                  disabled={isSaving || productCsvPreview.products.length === 0 || productCsvPreview.errors.length > 0}
                  onClick={() => void handleBulkProductImport()}
                  className="rounded-md bg-teal-800 px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSaving ? 'Importing…' : `Import ${productCsvPreview.products.length} products`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: ADD / UPLOAD PRODUCT MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Add a product</h3>
                <p className="text-xs text-slate-500">Create the product listing and choose its storefront placement.</p>
              </div>
              <button
                onClick={closeAddModal}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 border-b border-slate-200 pb-2">
                  <h4 className="font-bold text-slate-900">Product details</h4>
                  <p className="mt-1 text-[11px] text-slate-500">The information customers see in the catalog.</p>
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Medication / Product Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Amoxicillin Trihydrate 500mg"
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Category <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as CatalogItem['category'])}
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900"
                  >
                    {categories.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Dosage &amp; Packaging <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={dosage}
                    onChange={(e) => setDosage(e.target.value)}
                    placeholder="e.g. 500 mg, 30 Oral Capsules"
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">SKU Code</label>
                  <input
                    type="text"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="e.g. RX-AMX-500"
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">National Drug Code (NDC)</label>
                  <input
                    type="text"
                    value={ndcCode}
                    onChange={(e) => setNdcCode(e.target.value)}
                    placeholder="e.g. NDC 0093-3109-01"
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900 font-mono"
                  />
                </div>

                <div className="sm:col-span-2 border-b border-slate-200 pb-2 pt-2">
                  <h4 className="font-bold text-slate-900">Pricing</h4>
                  <p className="mt-1 text-[11px] text-slate-500">Set the customer-facing price and optional copay estimate.</p>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Retail Price ($) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Insurance Copay Estimate ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={copayPrice}
                    onChange={(e) => setCopayPrice(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900 font-mono"
                  />
                </div>

                <div className="sm:col-span-2 border-b border-slate-200 pb-2 pt-2">
                  <h4 className="font-bold text-slate-900">Stock settings</h4>
                  <p className="mt-1 text-[11px] text-slate-500">Maintain the existing stock count and alert threshold.</p>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Initial Stock Count (Units) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    value={stockCount}
                    onChange={(e) => setStockCount(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Low Stock Alert Threshold
                  </label>
                  <input
                    type="number"
                    value={minThreshold}
                    onChange={(e) => setMinThreshold(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900 font-mono"
                  />
                </div>

                <div className="sm:col-span-2 border-b border-slate-200 pb-2 pt-2">
                  <h4 className="font-bold text-slate-900">Storefront listing</h4>
                  <p className="mt-1 text-[11px] text-slate-500">Choose the image and how this product appears to customers.</p>
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Product images</label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    disabled={newProductImages.length >= 10}
                    onChange={(event) => handleProductImageSelection(event, 0, newProductImages, setNewProductImages)}
                    className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 file:mr-3 file:rounded-md file:border-0 file:bg-teal-50 file:px-3 file:py-1.5 file:font-semibold file:text-teal-800"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">Upload up to 10 JPEG, PNG, WebP, or GIF images; 5 MB maximum per image.</p>
                  {newProductImages.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {newProductImages.map((image) => (
                        <div key={image.previewUrl} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200">
                          <img src={image.previewUrl} alt={image.file.name} className="h-full w-full object-cover" />
                          <button type="button" onClick={() => removePendingProductImage(image, setNewProductImages)} aria-label={`Remove ${image.file.name}`} className="absolute right-1 top-1 rounded-full bg-slate-950/75 p-1 text-white hover:bg-rose-700">
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Product description
                  </label>
                  <textarea
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Therapeutic class, indication, administration advisory..."
                    className="w-full bg-white border border-slate-300 rounded-md p-3 text-slate-900"
                  ></textarea>
                </div>

                <div className="sm:col-span-2 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                  <label className="flex items-start gap-2 font-semibold text-slate-800">
                    <input type="checkbox" checked={rxRequired} onChange={(e) => setRxRequired(e.target.checked)} className="mt-0.5 rounded text-teal-700 focus:ring-teal-700" />
                    <span>Prescription required</span>
                  </label>
                  <label className="flex items-start gap-2 font-semibold text-slate-800">
                    <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} className="mt-0.5 rounded text-teal-700 focus:ring-teal-700" />
                    <span>Show on storefront</span>
                  </label>
                  <label className="flex items-start gap-2 font-semibold text-slate-800 sm:col-span-2">
                    <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} className="mt-0.5 rounded text-teal-700 focus:ring-teal-700" />
                    <span>Feature this product in the storefront</span>
                  </label>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeAddModal}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-md shadow-xs"
                >
                  {isSaving ? 'Saving…' : 'Save product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: EDIT PRODUCT DETAILS & PRICING */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Edit product: {editingItem.name}
                </h3>
                <p className="text-xs text-slate-500 font-mono">SKU: {editingItem.sku}</p>
              </div>
              <button
                onClick={closeEditModal}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="col-span-full border-b border-slate-200 pb-2">
                  <h4 className="font-bold text-slate-900">Product details</h4>
                  <p className="mt-1 text-[11px] text-slate-500">Name, category, identifiers, image, and customer-facing description.</p>
                </div>
                <div className="col-span-full">
                  <label className="block font-semibold text-slate-700 mb-1">Product Title</label>
                  <input
                    type="text"
                    required
                    value={editingItem.name}
                    onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900"
                  />
                </div>

                <div className="col-span-full">
                  <label className="block font-semibold text-slate-700 mb-1">Category</label>
                  <select
                    value={editingItem.category}
                    onChange={(event) => setEditingItem({ ...editingItem, category: event.target.value })}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900"
                  >
                    {categories.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Dosage &amp; Packaging</label>
                  <input
                    type="text"
                    value={editingItem.dosage}
                    onChange={(event) => setEditingItem({ ...editingItem, dosage: event.target.value })}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">SKU</label>
                  <input
                    type="text"
                    value={editingItem.sku}
                    onChange={(event) => setEditingItem({ ...editingItem, sku: event.target.value })}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-slate-900"
                  />
                </div>
                <div className="col-span-full">
                  <label className="block font-semibold text-slate-700 mb-1">National Drug Code (NDC)</label>
                  <input
                    type="text"
                    value={editingItem.ndcCode || ''}
                    onChange={(event) => setEditingItem({ ...editingItem, ndcCode: event.target.value || undefined })}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-slate-900"
                  />
                </div>
                <div className="col-span-full">
                  <label className="block font-semibold text-slate-700 mb-1">Product images</label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    disabled={getProductImages(editingItem).length + editingProductImages.length >= 10}
                    onChange={(event) => handleProductImageSelection(event, getProductImages(editingItem).length, editingProductImages, setEditingProductImages)}
                    className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 file:mr-3 file:rounded-md file:border-0 file:bg-teal-50 file:px-3 file:py-1.5 file:font-semibold file:text-teal-800"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">Up to 10 images per product; JPEG, PNG, WebP, or GIF, maximum 5 MB each.</p>
                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {getProductImages(editingItem).map((image, index) => (
                      <div key={`${image}-${index}`} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200">
                        <img src={image} alt={`${editingItem.name} image ${index + 1}`} className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => {
                            const images = getProductImages(editingItem).filter((_, imageIndex) => imageIndex !== index);
                            setEditingItem({ ...editingItem, images, image: images[0] });
                          }}
                          aria-label={`Remove product image ${index + 1}`}
                          className="absolute right-1 top-1 rounded-full bg-slate-950/75 p-1 text-white hover:bg-rose-700"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {editingProductImages.map((image) => (
                      <div key={image.previewUrl} className="relative aspect-square overflow-hidden rounded-lg border border-teal-300">
                        <img src={image.previewUrl} alt={image.file.name} className="h-full w-full object-cover" />
                        <button type="button" onClick={() => removePendingProductImage(image, setEditingProductImages)} aria-label={`Remove ${image.file.name}`} className="absolute right-1 top-1 rounded-full bg-slate-950/75 p-1 text-white hover:bg-rose-700">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="col-span-full">
                  <label className="block font-semibold text-slate-700 mb-1">Product description</label>
                  <textarea
                    rows={3}
                    value={editingItem.description}
                    onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                    className="w-full rounded-md border border-slate-300 bg-white p-3 text-slate-900"
                  />
                </div>

                <div className="col-span-full border-b border-slate-200 pb-2 pt-2">
                  <h4 className="font-bold text-slate-900">Pricing</h4>
                  <p className="mt-1 text-[11px] text-slate-500">Adjust customer-facing price information.</p>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Retail Price ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={editingItem.price}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, price: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Estimated Copay ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingItem.copayPrice || 0}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        copayPrice: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900 font-mono"
                  />
                </div>

                <div className="col-span-full border-b border-slate-200 pb-2 pt-2">
                  <h4 className="font-bold text-slate-900">Stock settings</h4>
                  <p className="mt-1 text-[11px] text-slate-500">Existing stock counts and threshold controls are unchanged.</p>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Stock Count (Units)
                  </label>
                  <input
                    type="number"
                    required
                    value={editingItem.stockCount}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        stockCount: parseInt(e.target.value) || 0,
                        inStock: (parseInt(e.target.value) || 0) > 0,
                      })
                    }
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Min Stock Threshold
                  </label>
                  <input
                    type="number"
                    value={editingItem.minStockThreshold}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        minStockThreshold: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900 font-mono"
                  />
                </div>

                <div className="col-span-full border-b border-slate-200 pb-2 pt-2">
                  <h4 className="font-bold text-slate-900">Storefront placement</h4>
                  <p className="mt-1 text-[11px] text-slate-500">Choose whether customers can find this product and if it is featured.</p>
                </div>
                <div className="col-span-full grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                  <label className="flex items-start gap-2 font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={editingItem.isActive !== false}
                      onChange={(event) => setEditingItem({ ...editingItem, isActive: event.target.checked })}
                      className="mt-0.5 rounded text-teal-700 focus:ring-teal-700"
                    />
                    <span>Show on storefront</span>
                  </label>
                  <label className="flex items-start gap-2 font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={editingItem.isFeatured === true}
                      onChange={(event) => setEditingItem({ ...editingItem, isFeatured: event.target.checked })}
                      className="mt-0.5 rounded text-teal-700 focus:ring-teal-700"
                    />
                    <span>Featured product</span>
                  </label>
                  <label className="col-span-full flex items-start gap-2 font-semibold text-slate-800">
                    <input
                      type="checkbox"
                      checked={editingItem.rxRequired}
                      onChange={(event) => setEditingItem({ ...editingItem, rxRequired: event.target.checked })}
                      className="mt-0.5 rounded text-teal-700 focus:ring-teal-700"
                    />
                    <span>Prescription required</span>
                  </label>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-md shadow-xs"
                >
                  {isSaving ? 'Saving…' : 'Update Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: BULK PRICE ADJUSTMENT */}
      {isBulkPriceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Bulk Price Adjustments</h3>
                <p className="text-xs text-slate-500">Apply percentage shifts across product categories</p>
              </div>
              <button
                onClick={() => setIsBulkPriceModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleApplyBulkPrice} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Target Category</label>
                <select
                  value={bulkCategory}
                  onChange={(e) => setBulkCategory(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900"
                >
                  <option value="All">All Categories (Universal Catalog)</option>
                  {categories.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Percentage Adjustment (%):
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    step="1"
                    value={bulkPercent}
                    onChange={(e) => setBulkPercent(parseFloat(e.target.value) || 0)}
                    className="w-32 bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900 font-mono text-center text-sm font-bold"
                  />
                  <span className="text-slate-500">
                    {bulkPercent >= 0 ? `+${bulkPercent}% Price Increase` : `${bulkPercent}% Price Discount`}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-600">
                Example: A $20.00 medication adjusted by {bulkPercent > 0 ? `+${bulkPercent}%` : `${bulkPercent}%`} will become ${(20 * (1 + bulkPercent / 100)).toFixed(2)}.
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsBulkPriceModalOpen(false)}
                  className="px-4 py-2 font-medium text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-md shadow-xs"
                >
                  {isSaving ? 'Saving…' : 'Apply to Catalog'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
