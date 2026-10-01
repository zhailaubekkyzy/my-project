// server/middleware/auth.js - Authentication Middleware
const authService = require('../services/auth-service');

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'unauthorized',
      code: 'AUTH_REQUIRED',
      message: 'Требуется авторизация в Telegram Mini App'
    });
  }

  const token = authHeader.split(' ')[1];
  const decoded = authService.verifySessionToken(token);

  if (!decoded) {
    return res.status(401).json({
      error: 'unauthorized',
      code: 'SESSION_EXPIRED',
      message: 'Сессия истекла или токен недействителен. Пожалуйста, выполните повторный вход.'
    });
  }

  req.user = decoded;
  next();
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const decoded = authService.verifySessionToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }
  next();
}

module.exports = {
  requireAuth,
  optionalAuth
};
