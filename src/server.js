'use strict';

const app = require('./app');
const config = require('./config/config');
const { connectDB } = require('./db/mongodb');

async function startServer() {
  // Start HTTP listener immediately so website is 100% available
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🕷️  Spider-Sense NYC Emergency Network Backend Online`);
    console.log(`🌐 Server running at: http://localhost:${config.port}`);
    console.log(`🏙️  Citizen Portal:   http://localhost:${config.port}/`);
    console.log(`🦸 Hero Admin Room:  http://localhost:${config.port}/admin`);
    console.log(`🔑 Sign In:          http://localhost:${config.port}/login`);
    console.log(`📝 Sign Up:          http://localhost:${config.port}/register`);
    console.log(`=======================================================`);
  });

  // Connect to MongoDB asynchronously with resilient retry
  connectDB().then((connection) => {
    if (connection) console.log('[Database] MongoDB connection established successfully.');
  }).catch((err) => {
    console.warn('[Database] MongoDB connection in progress or retrying in background:', err.message);
  });

  const handleShutdown = (signal) => {
    console.log(`[Spider-Sense] Received ${signal}. Shutting down gracefully...`);
    server.close(() => {
      console.log('[Spider-Sense] HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
