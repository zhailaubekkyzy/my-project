// server/routes/niches.js - Ниши Маркетплейса: разделы и ниши с числом SI-продавцов и шаблонов (без входа,
// как сам Маркетплейс). Создаёт нишу сервер, когда человек сохраняет карточку или шаблон (niche-service.resolve).
const express = require('express');
const router = express.Router();
const nicheService = require('../services/niche-service');

/** GET /api/niches — { sections: [{ id, label, icon }], niches: [{ id, section, name, experts, templates }] } */
router.get('/', async (req, res, next) => {
  try {
    res.json(await nicheService.catalog());
  } catch (err) {
    next(err);
  }
});

module.exports = router;
