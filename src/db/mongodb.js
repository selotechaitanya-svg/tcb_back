'use strict';

const mongoose = require('mongoose');
const config = require('../config/config');

let isConnecting = false;

const connectDB = async () => {
  if (!config.mongoUri) {
    console.warn('[MongoDB] MONGODB_URI is not configured; skipping database connection.');
    return null;
  }

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (isConnecting) {
    return;
  }

  try {
    isConnecting = true;
    console.log('[MongoDB] Connecting to cluster...');
    const conn = await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 45000
    });
    console.log(`[MongoDB] Connected successfully to host: ${conn.connection.host}, database: ${conn.connection.name}`);
    isConnecting = false;
    return conn;
  } catch (error) {
    isConnecting = false;
    console.error(`[MongoDB] Connection error: ${error.message}`);
    // Auto retry after 5 seconds
    setTimeout(() => {
      console.log('[MongoDB] Retrying cluster connection...');
      connectDB().catch(() => {});
    }, 5000);
    throw error;
  }
};

module.exports = {
  connectDB
};
