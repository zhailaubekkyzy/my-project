// server/routes/public.js - Public Endpoints for Leads & AI Seller Chat
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const projectService = require('../services/project-service');

/**
 * GET /api/public/funnels/:slug
 * Public landing and AI seller profile for leads.
 * Strictly protected: NEVER exposes private prompts, internal owner IDs, or CRM data.
 */
router.get('/funnels/:slug', async (req, res, next) => {
  try {
    const publicProfile = await projectService.getPublicProjectBySlug(req.params.slug);
    if (!publicProfile) {
      return res.status(404).json({ error: 'not_found', message: 'Страница AI-продавца не найдена или деактивирована' });
    }

    res.json(publicProfile);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/public/funnels/:slug/chat
 * Lead communicates with the AI Seller.
 * Automatically saves dialogue to expert's CRM in the database.
 */
router.post('/funnels/:slug/chat', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const {
      clientId: externalClientId,
      name = 'Клиент Telegram',
      username,
      avatarUrl,
      message,
      isVoice = false,
      voiceDuration,
      voiceTranscription
    } = req.body;

    const project = await db.get('SELECT * FROM projects WHERE slug = ? AND status = ?', [slug, 'active']);
    if (!project) {
      return res.status(404).json({ error: 'not_found', message: 'Проект не найден' });
    }

    const textContent = message || voiceTranscription || '';
    if (!textContent.trim()) {
      return res.status(400).json({ error: 'bad_request', message: 'Сообщение не может быть пустым' });
    }

    // 1. Find or create lead in CRM for this project
    let lead = null;
    if (externalClientId) {
      lead = await db.get(
        'SELECT * FROM clients WHERE project_id = ? AND external_client_id = ?',
        [project.id, externalClientId]
      );
    }

    if (!lead) {
      const newLeadId = `cli_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const assignedExternalId = externalClientId || `anon_${Date.now()}`;

      await db.run(
        `INSERT INTO clients (id, project_id, external_client_id, name, username, avatar_url, status, funnel_step, deal_value, tags, last_message, is_demo)
         VALUES (?, ?, ?, ?, ?, ?, 'new', 'step-1', 0, '["Новый лид"]', ?, 0)`,
        [
          newLeadId,
          project.id,
          assignedExternalId,
          name,
          username || null,
          avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=100&q=80',
          textContent
        ]
      );

      lead = await db.get('SELECT * FROM clients WHERE id = ?', [newLeadId]);
    }

    // 2. Save user message to database
    const userMsgId = `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await db.run(
      `INSERT INTO conversations (id, project_id, client_id, sender, text, is_voice, voice_duration, voice_transcription)
       VALUES (?, ?, ?, 'client', ?, ?, ?, ?)`,
      [
        userMsgId,
        project.id,
        lead.id,
        textContent,
        isVoice ? 1 : 0,
        voiceDuration || null,
        voiceTranscription || null
      ]
    );

    // 3. AI Seller Engine Logic
    const aiSettings = projectService.safeJsonParse(project.custom_ai_settings);
    let aiResponseText = '';

    const lower = textContent.toLowerCase();
    if (lower.includes('цена') || lower.includes('стоимость') || lower.includes('тариф') || lower.includes('сколько')) {
      const prices = projectService.safeJsonParse(project.pricing_options, []);
      const priceList = prices.map(p => `• **${p.name}** — ${p.price.toLocaleString('ru-RU')} ₽`).join('\n');
      aiResponseText = `Вот актуальные форматы работы и тарифы:\n\n${priceList || '• Консультация — 15 000 ₽'}\n\nКакой формат лучше всего подходит под вашу задачу?`;
    } else if (lower.includes('дорого')) {
      aiResponseText = aiSettings.objectionsHandling?.дорого || 'Инвестиции в продукт окупаются уже в первые недели за счет системных инструментов и отсутствия ошибок.';
    } else if (lower.includes('созвон') || lower.includes('записаться') || lower.includes('сессия')) {
      aiResponseText = 'Отлично! Вы можете забронировать удобный слот для стратегического разбора. В какой день вам удобнее: четверг в 14:00 или пятница в 11:30?';
    } else {
      aiResponseText = `Благодарю за вопрос! В рамках нашей методологии мы как раз разбираем этот шаг системно. Подскажите, какая сейчас у вас главная цель по доходу или масштабированию?`;
    }

    // 4. Save AI response to database
    const aiMsgId = `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await db.run(
      `INSERT INTO conversations (id, project_id, client_id, sender, text, is_voice, voice_duration, voice_transcription)
       VALUES (?, ?, ?, 'ai', ?, 0, NULL, NULL)`,
      [aiMsgId, project.id, lead.id, aiResponseText]
    );

    // 5. Update CRM lead state
    await db.run(
      `UPDATE clients SET last_message = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?`,
      [`[AI]: ${aiResponseText}`, lead.id]
    );

    res.json({
      clientId: lead.id,
      externalClientId: lead.external_client_id,
      reply: {
        id: aiMsgId,
        sender: 'ai',
        text: aiResponseText,
        createdAt: new Date().toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/public/funnels/:slug/human-request
 * Lead calls for human intervention ("Кто написал лично 👤")
 */
router.post('/funnels/:slug/human-request', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { clientId, reason = 'Клиент нажал кнопку "Связаться с человеком"', leadName, leadUsername } = req.body;

    const project = await db.get('SELECT * FROM projects WHERE slug = ?', [slug]);
    if (!project) {
      return res.status(404).json({ error: 'not_found', message: 'Проект не найден' });
    }

    const inquiryId = `inq_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    await db.run(
      `INSERT INTO direct_inquiries (id, project_id, client_id, lead_name, lead_username, reason, urgency, status, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, 'urgent', 'waiting', 0)`,
      [
        inquiryId,
        project.id,
        clientId || 'cli_anonymous',
        leadName || 'Клиент Telegram',
        leadUsername || null,
        reason
      ]
    );

    if (clientId) {
      await db.run(
        `UPDATE clients SET status = 'human_needed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?`,
        [clientId, project.id]
      );
    }

    res.json({
      success: true,
      inquiryId,
      message: 'Запрос успешно передан эксперту. Эксперт подключится в ближайшее время!'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
