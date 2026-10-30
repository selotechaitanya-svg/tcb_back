'use strict';

/**
 * Role-Based Access Control middleware factory
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required before verifying permissions.'
      });
    }

    const userRole = req.user.role;

    // Strict role check
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: `Access denied. Forbidden: Role '${userRole}' is not authorized for this resource. Required: ${allowedRoles.join(' or ')}.`
      });
    }

    next();
  };
};

const requireHero = requireRole('Hero');
const requireCitizen = requireRole('Citizen');

module.exports = {
  requireRole,
  requireHero,
  requireCitizen
};
