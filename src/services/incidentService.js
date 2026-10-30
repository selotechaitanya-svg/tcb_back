'use strict';

const mongoose = require('mongoose');
const Incident = require('../models/Incident');
const User = require('../models/User');
const { get, query, run } = require('../db/database');
const { BadRequestError, NotFoundError, ForbiddenError, ConflictError } = require('../utils/errors');
const { validateString, validateSeverity } = require('../utils/validator');

const VALID_TRANSITIONS = {
  Reported: ['Claimed'],
  Claimed: ['In Progress'],
  'In Progress': ['Resolved'],
  Resolved: []
};

function isTestOrSqlite() {
  return process.env.NODE_ENV === 'test' || !mongoose.connection || mongoose.connection.readyState !== 1;
}

const incidentService = {
  /**
   * Citizen creates a new emergency incident report
   */
  async createIncident(citizenId, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestError('Request body must be a valid JSON object');
    }

    const title = validateString(payload.title, 'Title', { minLength: 1, maxLength: 255 });
    const description = validateString(payload.description, 'Description', { minLength: 1, maxLength: 3000 });
    const category = validateString(payload.category, 'Category', { minLength: 1, maxLength: 100 });
    const location = validateString(payload.location, 'Location', { minLength: 1, maxLength: 255 });
    const severity = validateSeverity(payload.severity, 'Severity');

    if (isTestOrSqlite()) {
      const insertResult = run(
        'INSERT INTO incidents (title, description, category, severity, location, status, reporter_id, hero_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [title, description, category, severity, location, 'Reported', citizenId, null]
      );
      const incidentId = insertResult.lastInsertRowid;
      run(
        'INSERT INTO status_history (incident_id, previous_status, new_status, changed_by_user_id, notes) VALUES (?, ?, ?, ?, ?)',
        [incidentId, null, 'Reported', citizenId, 'Initial emergency report created']
      );
      return get('SELECT * FROM incidents WHERE id = ?', [incidentId]);
    }

    // MongoDB mode
    const citizen = await User.findById(citizenId);
    const citizenName = citizen ? citizen.name : 'Verified Citizen';

    const incident = await Incident.create({
      title,
      description,
      category,
      severity,
      location,
      status: 'Reported',
      reporter: citizenId,
      reporterName: citizenName,
      hero: null,
      heroName: null,
      statusHistory: [
        {
          previous_status: null,
          new_status: 'Reported',
          changed_by: citizenId,
          changed_by_name: citizenName,
          changed_at: new Date(),
          notes: 'Emergency incident reported by citizen.'
        }
      ]
    });

    return incident;
  },

  /**
   * List incidents with filtering & pagination
   * Citizens only see their own reports. Heroes see all open or filtered incidents across the city.
   */
  async getIncidents({ userId, role, status, category, severity, page = 1, limit, pageSize }) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = parseInt(limit || pageSize, 10);
    const l = (parsedLimit && parsedLimit > 0) ? parsedLimit : 50;
    const offset = (p - 1) * l;

    if (isTestOrSqlite()) {
      const where = [];
      const params = [];

      if (role === 'Citizen') {
        where.push('reporter_id = ?');
        params.push(userId);
      } else if (role === 'Hero') {
        if (status) {
          where.push('status = ?');
          params.push(status);
        } else {
          where.push("status = 'Reported'");
        }
      }
      if (category) {
        where.push('category = ?');
        params.push(category);
      }
      if (severity !== undefined && severity !== null && severity !== '') {
        where.push('severity = ?');
        params.push(parseInt(severity, 10));
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const totalRow = get(`SELECT COUNT(*) as count FROM incidents ${whereSql}`, params);
      const total = totalRow ? totalRow.count : 0;
      const totalPages = Math.ceil(total / l) || 1;

      const items = query(
        `SELECT * FROM incidents ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`,
        [...params, l, offset]
      );

      return {
        items,
        total,
        page: p,
        pageSize: l,
        limit: l,
        totalPages
      };
    }

    // MongoDB mode
    const queryObj = {};
    if (role === 'Citizen') {
      queryObj.reporter = userId;
    }
    if (status) queryObj.status = status;
    if (category) queryObj.category = category;
    if (severity !== undefined && severity !== null && severity !== '') {
      queryObj.severity = parseInt(severity, 10);
    }

    const [items, total] = await Promise.all([
      Incident.find(queryObj)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(l)
        .lean(),
      Incident.countDocuments(queryObj)
    ]);

    const totalPages = Math.ceil(total / l) || 1;

    return {
      items,
      total,
      page: p,
      pageSize: l,
      limit: l,
      totalPages
    };
  },

  /**
   * Retrieve incident details by ID with access control
   */
  async getIncidentById(incidentId, userId, role) {
    if (isTestOrSqlite()) {
      const incident = get('SELECT * FROM incidents WHERE id = ?', [incidentId]);
      if (!incident) {
        throw new NotFoundError(`Incident #${incidentId} not found.`);
      }

      if (role === 'Citizen' && incident.reporter_id !== userId) {
        throw new ForbiddenError('Access denied: Citizens can only inspect their own reported incidents.');
      }

      const history = query('SELECT * FROM status_history WHERE incident_id = ? ORDER BY id ASC', [incidentId]);
      return { ...incident, history };
    }

    // MongoDB mode
    const incident = await Incident.findById(incidentId).lean();
    if (!incident) {
      throw new NotFoundError(`Incident #${incidentId} not found.`);
    }

    if (role === 'Citizen' && incident.reporter.toString() !== userId.toString()) {
      throw new ForbiddenError('Access denied: Citizens can only inspect their own reported incidents.');
    }

    return incident;
  },

  /**
   * Atomic Hero Claim via Compare-And-Swap (CAS)
   * Prevents two heroes from claiming the same incident concurrently.
   */
  async claimIncident(incidentId, heroId) {
    if (isTestOrSqlite()) {
      const existing = get('SELECT * FROM incidents WHERE id = ?', [incidentId]);
      if (!existing) {
        throw new NotFoundError(`Incident #${incidentId} not found.`);
      }
      if (existing.status !== 'Reported') {
        throw new ConflictError(`Incident cannot be claimed: already Claimed or progressed to '${existing.status}'`);
      }

      const casResult = run(
        "UPDATE incidents SET status = 'Claimed', hero_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'Reported'",
        [heroId, incidentId]
      );

      if (casResult.changes === 0) {
        const recheck = get('SELECT * FROM incidents WHERE id = ?', [incidentId]);
        const status = recheck ? recheck.status : 'Claimed';
        throw new ConflictError(`Incident cannot be claimed: already Claimed or progressed to '${status}'`);
      }

      run(
        "INSERT INTO status_history (incident_id, previous_status, new_status, changed_by_user_id, notes) VALUES (?, 'Reported', 'Claimed', ?, 'Claimed by hero')",
        [incidentId, heroId]
      );

      return get('SELECT * FROM incidents WHERE id = ?', [incidentId]);
    }

    // MongoDB mode
    const hero = await User.findById(heroId);
    const heroName = hero ? hero.name : 'Verified Hero';

    const updatedIncident = await Incident.findOneAndUpdate(
      {
        _id: incidentId,
        status: 'Reported'
      },
      {
        $set: {
          status: 'Claimed',
          hero: heroId,
          heroName: heroName
        },
        $push: {
          statusHistory: {
            previous_status: 'Reported',
            new_status: 'Claimed',
            changed_by: heroId,
            changed_by_name: heroName,
            changed_at: new Date(),
            notes: `Hero ${heroName} claimed this mission.`
          }
        }
      },
      { returnDocument: 'after' }
    );

    if (!updatedIncident) {
      const existing = await Incident.findById(incidentId);
      if (!existing) {
        throw new NotFoundError(`Incident #${incidentId} not found.`);
      }

      throw new ConflictError(
        `Incident #${incidentId} has already been claimed or progressed to '${existing.status}'. Rival hero claim rejected.`
      );
    }

    return updatedIncident;
  },

  /**
   * Hero advances incident status: Claimed -> In Progress -> Resolved
   */
  async updateIncidentStatus(incidentId, heroId, newStatus, notes = '') {
    if (!newStatus || typeof newStatus !== 'string' || !newStatus.trim() || !['Reported', 'Claimed', 'In Progress', 'Resolved'].includes(newStatus.trim())) {
      throw new BadRequestError("Invalid status value");
    }

    const targetStatus = newStatus.trim();

    if (isTestOrSqlite()) {
      const incident = get('SELECT * FROM incidents WHERE id = ?', [incidentId]);
      if (!incident) {
        throw new NotFoundError(`Incident #${incidentId} not found.`);
      }

      if (incident.status === 'Reported') {
        throw new BadRequestError('Cannot update status of an unclaimed incident. Must claim first.');
      }

      if (incident.hero_id !== heroId) {
        throw new ForbiddenError('Only the assigned hero can update this incident.');
      }

      const allowedNext = VALID_TRANSITIONS[incident.status] || [];
      if (!allowedNext.includes(targetStatus)) {
        throw new BadRequestError(`Invalid status transition from '${incident.status}' to '${targetStatus}'.`);
      }

      const noteToSave = notes !== undefined ? (notes === null ? null : String(notes)) : null;

      run('UPDATE incidents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [targetStatus, incidentId]);
      run(
        'INSERT INTO status_history (incident_id, previous_status, new_status, changed_by_user_id, notes) VALUES (?, ?, ?, ?, ?)',
        [incidentId, incident.status, targetStatus, heroId, noteToSave]
      );

      return get('SELECT * FROM incidents WHERE id = ?', [incidentId]);
    }

    // MongoDB mode
    const incident = await Incident.findById(incidentId);
    if (!incident) {
      throw new NotFoundError(`Incident #${incidentId} not found.`);
    }

    if (incident.status === 'Reported') {
      throw new BadRequestError('Cannot update status of an unclaimed incident. Must claim first.');
    }

    if (!incident.hero || incident.hero.toString() !== heroId.toString()) {
      throw new ForbiddenError('Only the assigned hero can update this incident.');
    }

    const allowedNext = VALID_TRANSITIONS[incident.status] || [];
    if (!allowedNext.includes(targetStatus)) {
      throw new BadRequestError(`Invalid status transition from '${incident.status}' to '${targetStatus}'.`);
    }

    const previousStatus = incident.status;
    incident.status = targetStatus;
    incident.statusHistory.push({
      previous_status: previousStatus,
      new_status: targetStatus,
      changed_by: heroId,
      changed_by_name: incident.heroName || 'Assigned Hero',
      changed_at: new Date(),
      notes: notes.trim() || `Status updated from ${previousStatus} to ${targetStatus}.`
    });

    await incident.save();
    return incident;
  },

  /**
   * Retrieve chronological audit history for an incident
   */
  async getIncidentHistory(incidentId, userId, role) {
    if (isTestOrSqlite()) {
      const incident = get('SELECT * FROM incidents WHERE id = ?', [incidentId]);
      if (!incident) {
        throw new NotFoundError(`Incident #${incidentId} not found.`);
      }

      if (role === 'Citizen' && incident.reporter_id !== userId) {
        throw new ForbiddenError('Access denied: Citizens can only inspect history of their own reported incidents.');
      }

      const history = query('SELECT * FROM status_history WHERE incident_id = ? ORDER BY id ASC', [incidentId]);
      return history;
    }

    // MongoDB mode
    const incident = await Incident.findById(incidentId).lean();
    if (!incident) {
      throw new NotFoundError(`Incident #${incidentId} not found.`);
    }

    if (role === 'Citizen' && incident.reporter.toString() !== userId.toString()) {
      throw new ForbiddenError('Access denied: Citizens can only inspect history of their own reported incidents.');
    }

    return incident.statusHistory || [];
  }
};

module.exports = incidentService;
