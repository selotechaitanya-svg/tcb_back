'use strict';

const express = require('express');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { requireHero, requireCitizen } = require('../middleware/rbac');

const router = express.Router();

// Email existence check (used by Sign In to auto-redirect unregistered emails to Sign Up)
router.post('/check-email', authController.checkEmail);

// Email OTP flows
router.post('/request-otp', authController.requestOtp);
router.post('/send-otp', authController.requestOtp); // backward-compatible alias
router.post('/verify-otp', authController.verifyOtp);

// Standard password auth
router.post('/login', authController.login);
router.post('/register', authController.register);

// Session inspection & logout
router.get('/me', authenticate, authController.getMe);
router.post('/logout', authController.logout);

// Role verification test routes
router.get('/hero-test', authenticate, requireHero, (req, res) => {
  res.status(200).json({ success: true, message: 'Authorized: Hero role confirmed', user: req.user });
});

router.get('/citizen-test', authenticate, requireCitizen, (req, res) => {
  res.status(200).json({ success: true, message: 'Authorized: Citizen role confirmed', user: req.user });
});

module.exports = router;
