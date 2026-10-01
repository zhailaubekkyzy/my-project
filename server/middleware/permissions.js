// server/middleware/permissions.js - Unified Project Access Control Middleware
const projectService = require('../services/project-service');

/**
 * Middleware factory to enforce specific actions on a project
 * @param {string} action - 'funnel:read', 'funnel:write', 'analytics:read', 'conversations:read', 'conversations:write', '*'
 */
function requireProjectPermission(action = 'funnel:read') {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.userId) {
        return res.status(401).json({
          error: 'unauthorized',
          code: 'AUTH_REQUIRED',
          message: 'Требуется авторизация'
        });
      }

      const projectId = req.params.projectId || req.params.id || req.body.projectId || req.query.projectId;
      if (!projectId) {
        return res.status(400).json({
          error: 'bad_request',
          message: 'Идентификатор проекта (projectId) не указан в запросе'
        });
      }

      const access = await projectService.checkProjectAccess(req.user.userId, projectId, action);

      if (!access.allowed) {
        return res.status(403).json({
          error: 'forbidden',
          code: 'ACCESS_DENIED',
          message: 'У вас нет доступа к запрошенному проекту или действию',
          reason: access.reason,
          requiredAction: action
        });
      }

      // Attach validated project and user's project role to request
      req.project = access.project;
      req.projectRole = access.role;
      req.projectPermissions = access.permissions;

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  requireProjectPermission
};
