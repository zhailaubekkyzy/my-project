// server/middleware/staff.js - Support panel access: only the owner (ADMIN_USERS) and the team.
const { requireAuth } = require('./auth');
const supportService = require('../services/support-service');

/**
 * minRole: 'support' (owner and team) or 'owner' (owner only).
 * Sets req.staff = { userId, role }.
 */
function requireStaff(minRole = 'support') {
  return [requireAuth, async (req, res, next) => {
    try {
      const role = await supportService.staffRoleOf(req.user.userId);
      if (!role || (minRole === 'owner' && role !== 'owner')) {
        return res.status(403).json({
          error: 'forbidden',
          code: 'STAFF_ONLY',
          message: minRole === 'owner' ? 'Это может только владелица.' : 'Панель поддержки доступна только команде SmartFlow.'
        });
      }
      req.staff = { userId: req.user.userId, role };
      next();
    } catch (err) {
      next(err);
    }
  }];
}

module.exports = { requireStaff };
