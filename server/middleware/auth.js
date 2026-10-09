// server/middleware/auth.js - Authentication Middleware
const authService = require('../services/auth-service');
const supportService = require('../services/support-service');

const BLOCKED_RESPONSE = {
  error: 'forbidden',
  code: 'USER_BLOCKED',
  message: 'Доступ к SmartFlow приостановлен. Если это ошибка — напишите в поддержку @smartflow_ai_support_bot.'
};

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

  if (supportService.isBlocked(decoded.userId)) {
    return res.status(403).json(BLOCKED_RESPONSE);
  }

  req.user = decoded;
  next();
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const decoded = authService.verifySessionToken(token);
    if (decoded && !supportService.isBlocked(decoded.userId)) {
      req.user = decoded;
    }
  }
  next();
}

module.exports = {
  BLOCKED_RESPONSE,
  requireAuth,
  optionalAuth
};
