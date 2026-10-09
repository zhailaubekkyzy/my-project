// server/routes/brain.js - SI-brain: the signed-in expert's materials.
// Materials are private: only their owner sees or changes them; clients never get them,
// the SI only uses pieces of them inside its replies.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const brainService = require('../services/brain-service');

router.use(requireAuth);

// The file itself is the request body (any Content-Type: the server checks the bytes)
const rawFile = express.raw({ type: () => true, limit: brainService.MAX_FILE_BYTES });
function readFileBody(req, res, next) {
  rawFile(req, res, (err) => {
    if (!err) return next();
    const tooLarge = err.status === 413;
    res.status(tooLarge ? 413 : 400).json({
      error: 'bad_request',
      code: tooLarge ? 'FILE_TOO_LARGE' : 'UNREADABLE',
      message: tooLarge ? 'Файл больше 10 МБ. Разделите его на части.' : 'Не удалось получить файл. Попробуйте ещё раз.'
    });
  });
}

function sendBrainError(res, err, next) {
  if (err instanceof brainService.BrainError) {
    return res.status(err.status).json({ error: 'bad_request', code: err.code, message: err.message });
  }
  next(err);
}

const idList = (value) => String(value || '').split(',').map(s => s.trim()).filter(Boolean);

/**
 * GET /api/brain/materials
 */
router.get('/materials', async (req, res, next) => {
  try {
    res.json({ materials: await brainService.listMaterials(req.user.userId) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/brain/materials?name=<file name>&title=<title>&consultants=<id,id>
 * Body: the file (PDF, .docx, .txt/.md). Pasted text is sent the same way as a .txt file.
 */
router.post('/materials', readFileBody, async (req, res, next) => {
  try {
    const material = await brainService.addMaterial(req.user.userId, {
      buffer: Buffer.isBuffer(req.body) ? req.body : null,
      filename: String(req.query.name || '').slice(0, 200),
      title: String(req.query.title || '').slice(0, 200),
      consultantIds: idList(req.query.consultants)
    });
    res.status(201).json({ material });
  } catch (err) {
    sendBrainError(res, err, next);
  }
});

/**
 * PUT /api/brain/materials/:materialId/consultants  { consultantIds: [...] }
 * Which of my SI-consultants know this material (the list replaces the old one).
 */
router.put('/materials/:materialId/consultants', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.consultantIds) ? req.body.consultantIds : [];
    const material = await brainService.setConsultants(req.user.userId, req.params.materialId, ids);
    if (!material) return res.status(404).json({ error: 'not_found', message: 'Материал не найден' });
    res.json({ material });
  } catch (err) {
    sendBrainError(res, err, next);
  }
});

/**
 * DELETE /api/brain/materials/:materialId
 */
router.delete('/materials/:materialId', async (req, res, next) => {
  try {
    const deleted = await brainService.deleteMaterial(req.user.userId, req.params.materialId);
    if (!deleted) return res.status(404).json({ error: 'not_found', message: 'Материал не найден' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
