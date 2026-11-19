import { CatalogItem } from '../types/pharmacy';
import { parseCsvRows } from './csv';
import { calculatePackagePrice } from './productPricing';

export type ProductCsvItem = Omit<CatalogItem, 'id' | 'inStock' | 'lastRestocked'>;

export interface ProductCsvParseResult {
  products: ProductCsvItem[];
  errors: string[];
}

export function parseProductsCsv(
  csvText: string,
  existingSkus: string[] = [],
  existingCategories: string[] = [],
): ProductCsvParseResult {
  if (!csvText.trim()) return { products: [], errors: ['CSV content is empty.'] };

  let rows: string[][];
  try {
    rows = parseCsvRows(csvText);
  } catch (error) {
    return {
      products: [],
      errors: [error instanceof Error ? error.message : 'CSV could not be parsed.'],
    };
  }
  if (rows.length < 2) {
    return { products: [], errors: ['CSV must have a header row and at least one product.'] };
  }
  if (rows.length > 501) {
    return { products: [], errors: ['A product import can contain at most 500 rows.'] };
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const column = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const columns = {
    name: column('name', 'product_name'),
    category: column('category'),
    sku: column('sku'),
    price: column('price', 'selling_price'),
    stock: column('stock', 'stock_count', 'quantity'),
    description: column('description'),
    dosage: column('dosage', 'packaging'),
    minStock: column('min_stock_threshold', 'minimum_stock', 'reorder_level'),
    rxRequired: column('rx_required', 'prescription_required'),
    cost: column('cost_price', 'cost'),
    copay: column('copay_price', 'copay'),
    ndc: column('ndc_code', 'ndc'),
    image: column('image', 'image_url'),
    pricePerPill: column('price_per_pill'),
    pillsPerPackage: column('pills_per_package', 'pill_count'),
    storefrontPriceMode: column('storefront_price_mode'),
  };
  const required = ['name', 'category', 'sku', 'price', 'stock'] as const;
  const missing = required.filter((key) => columns[key] === -1);
  if (missing.length) {
    return { products: [], errors: [`CSV header must include: ${missing.join(', ')}.`] };
  }

  const seenSkus = new Set(existingSkus.map((sku) => sku.trim().toLowerCase()).filter(Boolean));
  const knownCategories = new Set(existingCategories.map((category) => category.toLowerCase()));
  const products: ProductCsvItem[] = [];
  const errors: string[] = [];
  const value = (cells: string[], index: number) => index < 0 ? '' : (cells[index] || '').trim();
  const byteLength = (text: string) => new TextEncoder().encode(text).length;
  const parseOptionalPrice = (raw: string, label: string, rowNumber: number) => {
    if (!raw) return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 99999999.99) {
      errors.push(`Row ${rowNumber}: ${label} must be between 0 and 99,999,999.99.`);
      return undefined;
    }
    return parsed;
  };

  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index];
    const rowNumber = index + 1;
    const name = value(cells, columns.name);
    const category = value(cells, columns.category);
    const sku = value(cells, columns.sku);
    const rawPrice = value(cells, columns.price);
    const rawStock = value(cells, columns.stock);
    let price = Number(rawPrice);
    const stockCount = Number(rawStock);

    if (!name || byteLength(name) > 180 || !category || byteLength(category) > 80 || !sku || byteLength(sku) > 80) {
      errors.push(`Row ${rowNumber}: name, category, and SKU are required (max 180, 80, and 80 characters).`);
      continue;
    }
    if (!knownCategories.has(category.toLowerCase())) {
      errors.push(`Row ${rowNumber}: category "${category}" does not exist. Add it in Categories before importing.`);
      continue;
    }
    if (seenSkus.has(sku.toLowerCase())) {
      errors.push(`Row ${rowNumber}: SKU "${sku}" is duplicated in this file or already exists.`);
      continue;
    }
    if (!rawStock || !Number.isInteger(stockCount) || stockCount < 0 || stockCount > 100000000) {
      errors.push(`Row ${rowNumber}: stock must be a non-negative whole number.`);
      continue;
    }

    const rawPricePerPill = value(cells, columns.pricePerPill);
    const pricePerPill = parseOptionalPrice(rawPricePerPill, 'Price per pill', rowNumber);
    const rawPillsPerPackage = value(cells, columns.pillsPerPackage);
    const pillsPerPackage = rawPillsPerPackage ? Number(rawPillsPerPackage) : undefined;
    if (
      (rawPricePerPill && pricePerPill === undefined)
      || (rawPillsPerPackage && (!Number.isInteger(pillsPerPackage) || pillsPerPackage! < 1 || pillsPerPackage! > 100000000))
    ) {
      if (rawPillsPerPackage && (!Number.isInteger(pillsPerPackage) || pillsPerPackage! < 1 || pillsPerPackage! > 100000000)) {
        errors.push(`Row ${rowNumber}: pills_per_package must be a whole number between 1 and 100,000,000.`);
      }
      continue;
    }
    if ((pricePerPill === undefined) !== (pillsPerPackage === undefined)) {
      errors.push(`Row ${rowNumber}: provide both price_per_pill and pills_per_package, or leave both blank.`);
      continue;
    }
    if (pricePerPill !== undefined && pillsPerPackage !== undefined) {
      const packagePrice = calculatePackagePrice(pricePerPill, pillsPerPackage);
      if (packagePrice === null) {
        errors.push(`Row ${rowNumber}: the calculated package price must not exceed 99,999,999.99.`);
        continue;
      }
      price = packagePrice;
    } else if (!rawPrice || !Number.isFinite(price) || price < 0 || price > 99999999.99) {
      errors.push(`Row ${rowNumber}: price must be a non-negative number unless per-pill pricing is provided.`);
      continue;
    }

    const rawStorefrontPriceMode = value(cells, columns.storefrontPriceMode) || 'package';
    if (!['package', 'per_pill'].includes(rawStorefrontPriceMode)) {
      errors.push(`Row ${rowNumber}: storefront_price_mode must be "package" or "per_pill".`);
      continue;
    }
    if (rawStorefrontPriceMode === 'per_pill' && pricePerPill === undefined) {
      errors.push(`Row ${rowNumber}: per-pill storefront pricing requires price_per_pill and pills_per_package.`);
      continue;
    }

    const rawRxRequired = value(cells, columns.rxRequired).toLowerCase();
    if (rawRxRequired && !['yes', 'no', 'true', 'false', '1', '0'].includes(rawRxRequired)) {
      errors.push(`Row ${rowNumber}: rx_required must be yes/no, true/false, or 1/0.`);
      continue;
    }
    const rawMinimum = value(cells, columns.minStock);
    const minStockThreshold = rawMinimum ? Number(rawMinimum) : 0;
    if (!Number.isInteger(minStockThreshold) || minStockThreshold < 0 || minStockThreshold > 100000000) {
      errors.push(`Row ${rowNumber}: minimum stock must be a non-negative whole number.`);
      continue;
    }
    const description = value(cells, columns.description);
    const dosage = value(cells, columns.dosage);
    const ndcCode = value(cells, columns.ndc);
    const image = value(cells, columns.image);
    if (
      byteLength(description) > 3000 || byteLength(dosage) > 120
      || byteLength(ndcCode) > 32 || byteLength(image) > 500
    ) {
      errors.push(`Row ${rowNumber}: description, dosage, NDC, or image URL exceeds its maximum length.`);
      continue;
    }

    const rawCost = value(cells, columns.cost);
    const costPrice = parseOptionalPrice(rawCost, 'Cost price', rowNumber);
    const rawCopay = value(cells, columns.copay);
    const copayPrice = parseOptionalPrice(rawCopay, 'Copay price', rowNumber);
    if ((rawCost && costPrice === undefined) || (rawCopay && copayPrice === undefined)) continue;

    products.push({
      name,
      category,
      sku,
      price,
      stockCount,
      description,
      dosage,
      minStockThreshold,
      rxRequired: ['yes', 'true', '1'].includes(rawRxRequired),
      ...(costPrice !== undefined ? { costPrice } : {}),
      ...(copayPrice !== undefined ? { copayPrice } : {}),
      ...(pricePerPill !== undefined ? { pricePerPill } : {}),
      ...(pillsPerPackage !== undefined ? { pillsPerPackage } : {}),
      storefrontPriceMode: rawStorefrontPriceMode as 'package' | 'per_pill',
      ndcCode: ndcCode || undefined,
      image: image || undefined,
    });
    seenSkus.add(sku.toLowerCase());
  }
  return { products, errors };
}

export function generateProductTemplateCsv(): string {
  return [
    'name,category,sku,price,stock_count,description,dosage,min_stock_threshold,rx_required,cost_price,copay_price,ndc_code,image_url,price_per_pill,pills_per_package,storefront_price_mode',
    '"Daily Wellness Sample","Daily Wellness",SKU-SAMPLE-001,11.70,50,"Product description","30 tablets",10,no,8.50,5.00,,,0.39,30,package',
  ].join('\n');
}
