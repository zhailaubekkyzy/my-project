// server/services/faq.js - «Вопросы и ответы» в карточке SI-продавца и шаблона (решение владелицы 22 нояб.).
// Видны всем, как FAQ на маркетплейсах. SI отвечает по ним; чего нет ни здесь, ни в сведениях — передаёт
// вопрос эксперту, и человек ждёт его ответа в чате (si-engine, маркер [[ЭКСПЕРТУ: …]]).
const MAX_ITEMS = 15;

function parse(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

/** Only pairs with both a question and an answer; limits kept. */
function normalizeFaq(raw) {
  const out = [];
  for (const item of parse(raw)) {
    if (out.length >= MAX_ITEMS || !item || typeof item !== 'object') continue;
    const q = String(item.q || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const a = String(item.a || '').replace(/\r/g, '').trim().slice(0, 1000);
    if (q && a) out.push({ q, a });
  }
  return out;
}

module.exports = { MAX_ITEMS, normalizeFaq };
