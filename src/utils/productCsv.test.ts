import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProductsCsv } from './productCsv';

test('parseProductsCsv parses optional data and commas in quoted descriptions', () => {
  const csv = [
    'name,category,sku,price,stock_count,description,dosage,min_stock_threshold,rx_required,cost_price,copay_price,ndc_code,image_url',
    '"Daily Wellness, Vitamin C","Daily Wellness",SKU-C-001,19.99,50,"Vitamin C, daily support","60 capsules",8,no,8.5,5,,',
  ].join('\n');

  const result = parseProductsCsv(csv, [], ['Daily Wellness']);
  assert.deepEqual(result.errors, []);
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].name, 'Daily Wellness, Vitamin C');
  assert.equal(result.products[0].description, 'Vitamin C, daily support');
  assert.equal(result.products[0].rxRequired, false);
  assert.equal(result.products[0].minStockThreshold, 8);
});

test('parseProductsCsv rejects unknown categories, duplicate SKUs, and invalid stock', () => {
  const csv = [
    'name,category,sku,price,stock_count',
    'One,Daily Wellness,SKU-001,10,5',
    'Two,Daily Wellness,SKU-001,12,4',
    'Three,Daily Wellness,SKU-003,12,2.5',
    'Four,New Category,SKU-004,12,5',
  ].join('\n');

  const result = parseProductsCsv(csv, [], ['Daily Wellness']);
  assert.equal(result.products.length, 1);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors[0], /duplicated/);
  assert.match(result.errors[1], /whole number/);
  assert.match(result.errors[2], /does not exist/);
});

test('parseProductsCsv rejects malformed quoting and duplicate existing SKUs', () => {
  const malformed = parseProductsCsv('name,category,sku,price,stock_count\n"unclosed,Daily Wellness,SKU-1,10,1');
  assert.match(malformed.errors[0], /unclosed quoted/);

  const duplicate = parseProductsCsv(
    'name,category,sku,price,stock_count\nOne,Daily Wellness,SKU-1,10,1',
    ['sku-1'],
    ['Daily Wellness'],
  );
  assert.match(duplicate.errors[0], /duplicated/);
});
