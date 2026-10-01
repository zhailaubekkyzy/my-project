// server/routes/conversations.js - Messages and CRM Chat History
const express = require('express');
const router = express.Router({ mergeParams: true });
const crypto = require('crypto');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireProjectPermission } = require('../middleware/permissions');

router.use(requireAuth);

/**
 * GET /api/projects/:projectId/clients/:clientId/messages
 * Retrieve full chat history (requires conversations:read)
 */
router.get('/:clientId/messages', requireProjectPermission('conversations:read'), async (req, res, next) => {
  try {
    const messages = await db.all(
      `SELECT * FROM conversations
       WHERE project_id = ? AND client_id = ?
       ORDER BY created_at ASC`,
      [req.project.id, req.params.clientId]
    );

    res.json(messages);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/:projectId/clients/:clientId/messages
 * Send message from expert/human takeover (requires conversations:write)
 */
router.post('/:clientId/messages', requireProjectPermission('conversations:write'), async (req, res, next) => {
  try {
    const { text, isVoice, voiceDuration, voiceTranscription } = req.body;
    if (!text && !voiceTranscription) {
      return res.status(400).json({ error: 'bad_request', message: 'Текст сообщения не может быть пустым' });
    }

    const messageId = `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const finalContent = text || voiceTranscription;

    await db.run(
      `INSERT INTO conversations (id, project_id, client_id, sender, text, is_voice, voice_duration, voice_transcription)
       VALUES (?, ?, ?, 'expert_human', ?, ?, ?, ?)`,
      [
        messageId,
        req.project.id,
        req.params.clientId,
        finalContent,
        isVoice ? 1 : 0,
        voiceDuration || null,
        voiceTranscription || null
      ]
    );

    // Update client's last message and activity
    await db.run(
      `UPDATE clients SET last_message = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ? AND project_id = ?`,
      [`[Вы]: ${finalContent}`, req.params.clientId, req.project.id]
    );

    const created = await db.get('SELECT * FROM conversations WHERE id = ?', [messageId]);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
