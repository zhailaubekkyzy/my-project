// server/services/receipt-service.js - Payment receipts and the contact a client shares in the chat.
//
// SmartFlow takes no payments: the client pays by the expert's own link, then sends a receipt
// (photo or PDF) in the chat. Only the client and the people of the business see it. The owner or
// the assistant checks it: "Подтвердить оплату" → the client is "Купили", and only then the access
// link of the SI-seller (projects.access_url, if the expert gave one) goes to the client.
// The SI never decides about payments and never gives the access link.
//
// Contact: Telegram's own "Поделиться контактом" (WebApp.requestContact). The answer is signed by
// Telegram like the login data, so the phone number is checked on the server, never trusted as typed.
const crypto = require('crypto');
const db = require('../db');
const authService = require('./auth-service');
const telegramBot = require('./telegram-bot');
const businessService = require('./business-service');
const funnelService = require('./funnel-service');
const chatService = require('./chat-service');

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPTS_PER_CLIENT = 20;

class ReceiptError extends Error {
  constructor(message, status = 400, code = 'INVALID_RECEIPT') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Real JPEG / PNG / WebP / PDF only, by the file's own first bytes
function detectReceiptType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.slice(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

const toReceipt = (r) => ({
  id: r.id,
  mimeType: r.mime_type,
  sizeBytes: Number(r.size_bytes) || 0,
  status: r.status,
  createdAt: r.created_at,
  reviewedAt: r.reviewed_at || null
});

async function peopleOf(project, client) {
  const people = client.business_id ? await businessService.activeMemberIds(client.business_id) : [];
  if (!people.includes(project.owner_id)) people.unshift(project.owner_id);
  return people;
}

/**
 * The client sends a receipt. It waits for a person: "Мне написали" + a bot message to the owner
 * and the assistant. The SI keeps talking (it is not paused).
 */
async function saveReceipt(project, client, buffer, userId) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new ReceiptError('Файл не получен. Выберите чек ещё раз.', 400, 'EMPTY_FILE');
  if (buffer.length > MAX_RECEIPT_BYTES) throw new ReceiptError('Файл больше 5 МБ. Сделайте снимок экрана с чеком.', 413, 'RECEIPT_TOO_LARGE');
  const mimeType = detectReceiptType(buffer);
  if (!mimeType) throw new ReceiptError('Можно отправить фото (JPEG, PNG, WebP) или PDF.', 400, 'INVALID_RECEIPT');
  const count = await db.get('SELECT COUNT(*) AS count FROM payment_receipts WHERE client_id = ?', [client.id]);
  if (Number(count.count) >= MAX_RECEIPTS_PER_CLIENT) {
    throw new ReceiptError('Чеков уже слишком много. Нажмите «Связаться с человеком».', 429, 'TOO_MANY_RECEIPTS');
  }

  const id = `rcp_${crypto.randomUUID().replace(/-/g, '')}`;
  await db.run(
    `INSERT INTO payment_receipts (id, business_id, project_id, client_id, uploaded_by, mime_type, size_bytes, data_base64)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, client.business_id || null, project.id, client.id, userId, mimeType, buffer.length, buffer.toString('base64')]
  );
  await chatService.saveMessage(client, { type: 'client' }, '🧾 Отправил(а) чек об оплате');
  await db.run(
    `INSERT INTO direct_inquiries (id, project_id, client_id, business_id, lead_name, lead_username, reason, urgency, status, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'urgent', 'waiting', 0)`,
    [`inq_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, project.id, client.id, client.business_id || null,
      client.name || 'Клиент Telegram', client.username || null, 'Прислал(а) чек об оплате — проверьте и подтвердите']
  );
  await chatService.clientEvent(project, client, 'receipt_sent', { type: 'client', userId });

  for (const personId of await peopleOf(project, client)) {
    await telegramBot.notifyUser(
      personId,
      `🧾 ${client.name || 'Клиент'} прислал(а) чек об оплате.\nSI-продавец: «${project.name}».\n\nПроверьте поступление денег и подтвердите оплату в карточке клиента.`,
      { buttonText: 'Открыть', startParam: `I_${project.id}` }
    );
  }
  return toReceipt(await db.get('SELECT * FROM payment_receipts WHERE id = ?', [id]));
}

async function receiptsOf(clientId) {
  const rows = await db.all(
    'SELECT id, mime_type, size_bytes, status, created_at, reviewed_at FROM payment_receipts WHERE client_id = ? ORDER BY created_at DESC, id DESC',
    [clientId]
  );
  return rows.map(toReceipt);
}

async function receiptFile(clientId, receiptId) {
  const row = await db.get('SELECT mime_type, data_base64 FROM payment_receipts WHERE id = ? AND client_id = ?', [receiptId, clientId]);
  return row ? { mimeType: row.mime_type, buffer: Buffer.from(row.data_base64, 'base64') } : null;
}

/**
 * A person of the business checks the receipt.
 * confirm → "Купили"; the client gets a message in the chat (with the access link, if the expert
 * gave one) and from the bot. reject → the client is told kindly, a person will write.
 * member: { userId, role: 'owner' | 'assistant' }
 */
async function reviewReceipt(project, client, receiptId, action, member) {
  if (action !== 'confirm' && action !== 'reject') throw new ReceiptError('Неизвестное действие', 400, 'BAD_ACTION');
  const receipt = await db.get('SELECT * FROM payment_receipts WHERE id = ? AND client_id = ?', [receiptId, client.id]);
  if (!receipt) throw new ReceiptError('Чек не найден', 404, 'NOT_FOUND');
  if (receipt.status !== 'new') throw new ReceiptError('Этот чек уже проверен', 409, 'ALREADY_REVIEWED');

  const confirm = action === 'confirm';
  await db.run(
    `UPDATE payment_receipts SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'new'`,
    [confirm ? 'confirmed' : 'rejected', member.userId, receipt.id]
  );
  await db.run(
    `UPDATE direct_inquiries SET status = 'answered', updated_at = CURRENT_TIMESTAMP WHERE client_id = ? AND status = 'waiting' AND reason LIKE 'Прислал(а) чек%'`,
    [client.id]
  );

  const author = { type: member.role === 'assistant' ? 'assistant' : 'owner', userId: member.userId };
  let text;
  const en = (await require('./i18n').langOfClient(client)) === 'en';
  if (confirm) {
    await chatService.markOutcome(project, client, 'paid', member);
    text = project.access_url
      ? (en ? `Payment confirmed, thank you! 🎉 Your access: ${project.access_url}` : `Оплата подтверждена, спасибо! 🎉 Ваш доступ: ${project.access_url}`)
      : (en ? 'Payment confirmed, thank you! 🎉 We will soon write how to get access.' : 'Оплата подтверждена, спасибо! 🎉 Скоро напишем, как получить доступ.');
  } else {
    await funnelService.recordEvent(client, 'receipt_rejected', author);
    text = en
      ? 'We could not confirm the payment by this receipt yet. We will write here what needs clarifying.'
      : 'Пока не получилось подтвердить оплату по этому чеку. Мы напишем вам здесь, что нужно уточнить.';
  }
  const message = await chatService.saveMessage(client, author, text);
  if (String(client.external_client_id || '').startsWith('usr_')) {
    await telegramBot.notifyUser(
      client.external_client_id,
      confirm
        ? { ru: `✅ Оплата подтверждена: «${project.name}».`, en: `✅ Payment confirmed: «${project.name}».` }
        : { ru: `🧾 По вашему чеку для «${project.name}» есть вопрос.`, en: `🧾 There is a question about your receipt for «${project.name}».` },
      { buttonText: { ru: 'Открыть чат', en: 'Open chat' }, startParam: project.slug }
    );
  }
  return { receipt: toReceipt(await db.get('SELECT * FROM payment_receipts WHERE id = ?', [receipt.id])), message, funnelStatus: client.funnel_status };
}

/**
 * The client shared their contact with Telegram's own button. response: the signed string
 * from WebApp.requestContact. The contact must be of the signed-in person.
 */
async function shareContact(project, client, userId, response) {
  const check = authService.verifyTelegramInitData(String(response || ''), 24 * 3600);
  if (!check.valid) throw new ReceiptError('Telegram не подтвердил контакт. Обновите Telegram и попробуйте ещё раз.', 400, 'CONTACT_NOT_SIGNED');
  let contact = null;
  try { contact = JSON.parse(new URLSearchParams(String(response)).get('contact') || 'null'); } catch (e) {}
  const telegramId = await telegramBot.telegramIdOfUser(userId);
  if (!contact || !contact.phone_number || !telegramId || String(contact.user_id) !== String(telegramId)) {
    throw new ReceiptError('Это не ваш контакт.', 400, 'CONTACT_NOT_OWN');
  }
  const phone = String(contact.phone_number).replace(/[^\d+]/g, '').slice(0, 20);
  const phoneShown = phone.startsWith('+') ? phone : `+${phone}`;
  await db.run('UPDATE clients SET contact_phone = ?, contact_consent_at = CURRENT_TIMESTAMP WHERE id = ?', [phoneShown, client.id]);
  if (!(await funnelService.hasEvent(client.id, 'contact_shared'))) {
    await chatService.clientEvent(project, client, 'contact_shared', { type: 'client', userId });
  }
  return { phone: phoneShown };
}

module.exports = {
  MAX_RECEIPT_BYTES,
  ReceiptError,
  detectReceiptType,
  saveReceipt,
  receiptsOf,
  receiptFile,
  reviewReceipt,
  shareContact
};
