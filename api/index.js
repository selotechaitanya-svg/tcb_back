'use strict';

const app = require('../src/app');
const { connectDB } = require('../src/db/mongodb');

// Eagerly connect to MongoDB on cold start
connectDB().catch(err => {
  console.warn('[Vercel Serverless] MongoDB connection warning:', err.message);
});

module.exports = app;
