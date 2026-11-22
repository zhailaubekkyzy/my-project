// server/services/inheritance.js - Data goes down: бизнес → продукт → AI-продавец («Бизнес-режим 2.0», шаг 1).
// The expert explains things once: what the AI-продавец has not filled in itself is taken from its product, and
// «о бизнесе» from its business. What the seller has itself always wins (owner's decision 22 Nov.: below, one may
// change one's own — a different price, an offer). Nothing is invented: empty stays empty.
const db = require('../db');

// Seller field ← product field (both as the expert typed them)
const FROM_PRODUCT = [
  ['offer', 'name'],
  ['description', 'description'],
  ['payment_url', 'payment_url'],
  ['access_url', 'access_url']
];

/**
 * A copy of the seller (project row) with what it inherits. Adds:
 *   inheritedProduct  — the product's details for the SI's knowledge (result, format, duration, installment, guarantee)
 *   inheritedBusiness — name, about, niche of the business
 * The original row is not changed and nothing is written to the database.
 */
async function withInherited(project) {
  if (!project) return project;
  const out = { ...project };
  const product = project.product_id
    ? await db.get(`SELECT * FROM products WHERE id = ? AND status = 'active'`, [project.product_id])
    : null;
  if (product) {
    for (const [own, from] of FROM_PRODUCT) {
      if (!out[own] && product[from]) out[own] = product[from];
    }
    // The price goes as a whole: the seller's own price (or «бесплатно» / «по запросу») wins
    if (!out.price_mode && !out.price_label) {
      if (product.price_mode && product.price_mode !== 'fixed') out.price_mode = product.price_mode;
      else if (product.price_label) out.price_label = product.price_label;
    }
    out.inheritedProduct = {
      name: product.name,
      result: product.result || '',
      format: product.format || '',
      duration: product.duration || '',
      installment: product.installment || '',
      guarantee: product.guarantee || ''
    };
  }
  const business = project.business_id ? await db.get('SELECT name, about, niche FROM businesses WHERE id = ?', [project.business_id]) : null;
  if (business && (business.about || business.name)) {
    out.inheritedBusiness = { name: business.name || '', about: business.about || '', niche: business.niche || '' };
  }
  return out;
}

module.exports = { withInherited, FROM_PRODUCT };
