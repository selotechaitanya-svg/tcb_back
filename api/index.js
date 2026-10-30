'use strict';

const app = require('../src/app');
const { connectDB } = require('../src/db/mongodb');

// Serverless function handler for Vercel
module.exports = async (req, res) => {
  try {
    await connectDB();
  } catch (err) {
    console.warn('[Vercel Serverless] MongoDB connection warning:', err.message);
  }
  return app(req, res);
};
