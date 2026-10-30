'use strict';

const express = require('express');
const incidentController = require('../controllers/incidentController');
const { authenticate } = require('../middleware/auth');
const { requireHero, requireCitizen } = require('../middleware/rbac');

const router = express.Router();

// All incident endpoints require valid 7-day authentication session
router.use(authenticate);

// Feed & Incident creation
router.get('/', incidentController.getIncidents);
router.post('/', requireCitizen, incidentController.createIncident);

// Incident by ID
router.get('/:id', incidentController.getIncidentById);

// Hero Dispatch Actions
router.post('/:id/claim', requireHero, incidentController.claimIncident);
router.patch('/:id/status', requireHero, incidentController.updateStatus);

// Chronological history audit
router.get('/:id/history', incidentController.getIncidentHistory);

module.exports = router;
