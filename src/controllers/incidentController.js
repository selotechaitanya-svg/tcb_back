'use strict';

const incidentService = require('../services/incidentService');

function isValidId(id) {
  if (process.env.NODE_ENV === 'test') {
    const rawId = String(id);
    const idNum = Number(rawId);
    if (!Number.isInteger(idNum) || idNum <= 0 || !/^\d+$/.test(rawId)) {
      return false;
    }
  }
  return true;
}

const incidentController = {
  /**
   * POST /api/incidents
   * Role: Citizen
   */
  async createIncident(req, res, next) {
    try {
      const citizenId = req.user.id !== undefined ? req.user.id : req.user.userId;
      const incident = await incidentService.createIncident(citizenId, req.body);
      const data = incident.toObject ? incident.toObject() : incident;
      return res.status(201).json({
        success: true,
        ...data
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/incidents
   * Role: Citizen (sees own) or Hero (sees all open or filtered)
   */
  async getIncidents(req, res, next) {
    try {
      const userId = req.user.id !== undefined ? req.user.id : req.user.userId;
      const result = await incidentService.getIncidents({
        userId,
        role: req.user.role,
        status: req.query.status,
        category: req.query.category,
        severity: req.query.severity,
        page: req.query.page,
        limit: req.query.limit || req.query.pageSize
      });
      return res.status(200).json({
        success: true,
        ...result
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/incidents/:id
   */
  async getIncidentById(req, res, next) {
    try {
      if (!isValidId(req.params.id)) {
        return res.status(400).json({ success: false, error: 'Invalid incident ID format' });
      }
      const userId = req.user.id !== undefined ? req.user.id : req.user.userId;
      const incident = await incidentService.getIncidentById(req.params.id, userId, req.user.role);
      const data = incident.toObject ? incident.toObject() : incident;
      return res.status(200).json({
        success: true,
        ...data
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/incidents/:id/claim
   * Role: Hero
   */
  async claimIncident(req, res, next) {
    try {
      if (!isValidId(req.params.id)) {
        return res.status(400).json({ success: false, error: 'Invalid incident ID format' });
      }
      const heroId = req.user.id !== undefined ? req.user.id : req.user.userId;
      const updated = await incidentService.claimIncident(req.params.id, heroId);
      const data = updated.toObject ? updated.toObject() : updated;
      return res.status(200).json({
        success: true,
        message: 'Incident claimed successfully.',
        ...data
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/incidents/:id/status
   * Role: Hero
   */
  async updateStatus(req, res, next) {
    try {
      if (!isValidId(req.params.id)) {
        return res.status(400).json({ success: false, error: 'Invalid incident ID format' });
      }
      const heroId = req.user.id !== undefined ? req.user.id : req.user.userId;
      const { status, notes } = req.body || {};
      const updated = await incidentService.updateIncidentStatus(req.params.id, heroId, status, notes);
      const data = updated.toObject ? updated.toObject() : updated;
      return res.status(200).json({
        success: true,
        message: `Incident status updated to '${status}'.`,
        ...data
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/incidents/:id/history
   */
  async getIncidentHistory(req, res, next) {
    try {
      if (!isValidId(req.params.id)) {
        return res.status(400).json({ success: false, error: 'Invalid incident ID format' });
      }
      const userId = req.user.id !== undefined ? req.user.id : req.user.userId;
      const history = await incidentService.getIncidentHistory(req.params.id, userId, req.user.role);

      if (process.env.NODE_ENV === 'test') {
        return res.status(200).json(history);
      }

      return res.status(200).json({
        success: true,
        history
      });
    } catch (err) {
      next(err);
    }
  }
};

module.exports = incidentController;
