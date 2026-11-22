// server/services/product-service.js - Products of a business («Бизнес-режим 2.0», шаг 1, решения владелицы 22 нояб.).
// A business describes its products once (in its Мозг); an AI-продавец is tied to a product (projects.product_id) and
// takes from it what it does not have itself (server/services/inheritance.js). Only the owner of the business
// creates and changes products; no made-up data: every field is what the expert typed, empty stays empty.
const crypto = require('crypto');
const db = require('../db');
const businessService = require('./business-service');
const profileService = require('./profile-service');

const MAX_PRODUCTS = 30;
const PRICE_MODES = ['fixed', 'free', 'on_request'];

class ProductError extends Error {
  constructor(message, status = 400, code = 'PRODUCT') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const newId = () => `prd_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
const text = (v, max) => String(v === undefined || v === null ? '' : v).replace(/\r/g, '').trim().slice(0, max);

function toProduct(r) {
  return {
    id: r.id,
    businessId: r.business_id,
    name: r.name,
    description: r.description || '',
    result: r.result || '',
    format: r.format || '',
    duration: r.duration || '',
    priceMode: r.price_mode || 'fixed',
    priceLabel: r.price_label || '',
    installment: r.installment || '',
    guarantee: r.guarantee || '',
    paymentUrl: r.payment_url || '',
    accessUrl: r.access_url || '',
    status: r.status,
    position: Number(r.position) || 0
  };
}

// Only fields the expert sent; links are checked like everywhere (https only, no scripts)
function clean(input = {}, partial = false) {
  const out = {};
  const has = (k) => !partial || Object.prototype.hasOwnProperty.call(input, k);
  if (has('name')) {
    out.name = text(input.name, 120);
    if (!out.name) throw new ProductError('Напишите название продукта', 400, 'NO_NAME');
  }
  if (has('description')) out.description = text(input.description, 3000);
  if (has('result')) out.result = text(input.result, 1000);
  if (has('format')) out.format = text(input.format, 200);
  if (has('duration')) out.duration = text(input.duration, 200);
  if (has('priceMode')) out.price_mode = PRICE_MODES.includes(input.priceMode) ? input.priceMode : 'fixed';
  if (has('priceLabel')) out.price_label = text(input.priceLabel, 80) || null;
  if (has('installment')) out.installment = text(input.installment, 300);
  if (has('guarantee')) out.guarantee = text(input.guarantee, 500);
  for (const [key, col] of [['paymentUrl', 'payment_url'], ['accessUrl', 'access_url']]) {
    if (!has(key)) continue;
    const raw = text(input[key], 300);
    if (raw && !profileService.cleanUrl(raw)) throw new ProductError('Ссылка должна начинаться с https://', 400, 'BAD_URL');
    out[col] = raw ? profileService.cleanUrl(raw) : null;
  }
  return out;
}

async function requireOwnBusiness(ownerId, businessId) {
  const b = await businessService.ownBusiness(ownerId, businessId);
  if (!b) throw new ProductError('Бизнес не найден', 404, 'NOT_FOUND');
  return b;
}

async function list(ownerId, businessId, { archived = false } = {}) {
  const b = await requireOwnBusiness(ownerId, businessId);
  const rows = await db.all(
    `SELECT * FROM products WHERE business_id = ? ${archived ? '' : "AND status = 'active'"} ORDER BY position, created_at, id`,
    [b.id]
  );
  return rows.map(toProduct);
}

async function create(ownerId, businessId, input) {
  const b = await requireOwnBusiness(ownerId, businessId);
  const data = clean(input);
  const n = await db.get(`SELECT COUNT(*) AS n FROM products WHERE business_id = ? AND status = 'active'`, [b.id]);
  if (Number(n.n) >= MAX_PRODUCTS) throw new ProductError(`В одном бизнесе — до ${MAX_PRODUCTS} продуктов`, 409, 'LIMIT');
  const id = newId();
  const keys = Object.keys(data);
  await db.run(
    `INSERT INTO products (id, business_id, position, ${keys.join(', ')}) VALUES (?, ?, ?, ${keys.map(() => '?').join(', ')})`,
    [id, b.id, Number(n.n) || 0, ...keys.map(k => data[k])]
  );
  return toProduct(await db.get('SELECT * FROM products WHERE id = ?', [id]));
}

async function productOf(ownerId, productId) {
  const p = await db.get('SELECT * FROM products WHERE id = ?', [String(productId || '')]);
  if (!p || !(await businessService.ownBusiness(ownerId, p.business_id))) throw new ProductError('Продукт не найден', 404, 'NOT_FOUND');
  return p;
}

async function update(ownerId, productId, input) {
  const p = await productOf(ownerId, productId);
  const data = clean(input, true);
  const keys = Object.keys(data);
  if (keys.length) {
    await db.run(`UPDATE products SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [...keys.map(k => data[k]), p.id]);
  }
  return toProduct(await db.get('SELECT * FROM products WHERE id = ?', [p.id]));
}

// Archive, not delete: AI-продавцы tied to it keep their own fields and stop taking from it
async function archive(ownerId, productId) {
  const p = await productOf(ownerId, productId);
  await db.run(`UPDATE products SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [p.id]);
  return { archived: true };
}

/**
 * Ties an AI-продавец to a product of the same business (or unties with null). Only the owner.
 */
async function attachToSeller(ownerId, projectId, productId) {
  const project = await db.get('SELECT * FROM projects WHERE id = ? AND owner_id = ?', [String(projectId || ''), ownerId]);
  if (!project) throw new ProductError('AI-продавец не найден', 404, 'NOT_FOUND');
  if (productId) {
    const p = await productOf(ownerId, productId);
    if (p.status !== 'active') throw new ProductError('Продукт в архиве', 409, 'ARCHIVED');
    if (project.business_id && p.business_id !== project.business_id) throw new ProductError('Продукт из другого бизнеса', 409, 'OTHER_BUSINESS');
  }
  await db.run('UPDATE projects SET product_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [productId || null, project.id]);
  return { productId: productId || null };
}

module.exports = { ProductError, MAX_PRODUCTS, list, create, update, archive, attachToSeller, toProduct };
