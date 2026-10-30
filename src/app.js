'use strict';

const express = require('express');
const path = require('node:path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const mongoose = require('mongoose');

const authRoutes = require('./routes/authRoutes');
const incidentRoutes = require('./routes/incidentRoutes');
const errorHandler = require('./middleware/errorHandler');
const { connectDB } = require('./db/mongodb');

const app = express();

// Enable CORS with credentials for cookies and authorization headers
app.use(cors({
  origin: true,
  credentials: true
}));

// Body parsers and cookie middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static assets from public directory
app.use(express.static(path.resolve(__dirname, '../public')));

// Liveness & health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    database: 'MongoDB',
    service: 'spider-sense-backend',
    timestamp: new Date().toISOString()
  });
});

// Clean frontend page routes
app.get(['/', '/index', '/index.html'], (req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/index.html'));
});

app.get(['/admin', '/admin.html'], (req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/admin.html'));
});

app.get(['/login', '/login.html'], (req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/login.html'));
});

app.get(['/register', '/register.html'], (req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/register.html'));
});

// Ensure MongoDB is connected for API requests (skip during automated tests)
app.use('/api', async (req, res, next) => {
  if (process.env.NODE_ENV !== 'test') {
    try {
      if (mongoose.connection && mongoose.connection.readyState !== 1) {
        await connectDB();
      }
    } catch (err) {
      console.warn('[MongoDB Middleware] Notice:', err.message);
    }
  }
  next();
});

// Domain API routes
app.use('/api/auth', authRoutes);
app.use('/api/incidents', incidentRoutes);

// Catch-all 404 handler for undefined API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, error: `API route not found: ${req.method} ${req.originalUrl}` });
});

// Catch-all fallback for client-side routing
app.use((req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/index.html'));
});

// Centralized error handling middleware
app.use(errorHandler);

module.exports = app;
