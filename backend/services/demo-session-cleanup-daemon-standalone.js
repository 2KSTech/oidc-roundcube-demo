#!/usr/bin/env node
/**
 * Standalone Demo Session Cleanup Daemon Runner
 * 
 * This script can be run independently of the main backend server.
 * It will start the cleanup daemon and handle graceful shutdown.
 * 
 * Usage:
 *   node backend/services/demo-session-cleanup-daemon-standalone.js
 * 
 * Environment variables required:
 *   - DEMO_MAX_SESSION_DURATION_MIN (default: 15)
 *   - DEMO_CLEANUP_INTERVAL_MS (default: 60000)
 *   - KEYCLOAK_URL
 *   - KEYCLOAK_REALM
 *   - KEYCLOAK_ADMIN_CLIENT_ID
 *   - KEYCLOAK_ADMIN_CLIENT_SECRET
 *   - DEMO_SSO_MAIL_CLIENT_NAME (sogo or roundcube)
 *   - DEMO_MAIL_PROVIDER (stalwart)
 *   - ROUNDCUBE_DB_* or SOGO_DB_* (depending on webmail client)
 */

// Load environment variables
// Try multiple locations: current working directory, backend/.env, and project root
const path = require('path');
const fs = require('fs');

// PID file management
const PID_FILE = path.join(__dirname, '..', 'demo-cleanup-daemon.pid');

/**
 * Create PID file for this daemon process
 */
function createPidFile() {
  try {
    fs.writeFileSync(PID_FILE, process.pid.toString(), 'utf8');
    console.log(`[Standalone] PID file created: ${PID_FILE} (PID: ${process.pid})`);
  } catch (error) {
    console.error(`[Standalone] Failed to create PID file: ${error.message}`);
    throw error;
  }
}

/**
 * Remove PID file on shutdown
 */
function removePidFile() {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
      console.log(`[Standalone] PID file removed: ${PID_FILE}`);
    }
  } catch (error) {
    console.error(`[Standalone] Failed to remove PID file: ${error.message}`);
  }
}

// Try loading from different locations
const envPaths = [
  path.join(process.cwd(), '.env'),                    // Current working directory
  path.join(__dirname, '../.env'),                    // backend/.env
  path.join(__dirname, '../../.env'),                 // Project root
];

let envLoaded = false;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
    console.log(`[Standalone] Loaded .env from: ${envPath}`);
    envLoaded = true;
    break;
  }
}

// If no .env file found, try default dotenv behavior (uses CWD)
if (!envLoaded) {
  require('dotenv').config();
  console.log(`[Standalone] Attempted to load .env from current working directory: ${process.cwd()}`);
  console.log(`[Standalone] If environment variables are not loading, ensure .env file exists or set them as system environment variables`);
}

// Validate required environment variables
const requiredEnvVars = [
  'KEYCLOAK_URL',
  'KEYCLOAK_REALM',
  'KEYCLOAK_ADMIN_CLIENT_ID',
  'KEYCLOAK_ADMIN_CLIENT_SECRET',
  'DEMO_MAX_SESSION_DURATION_MIN'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('[Standalone] FAIL Missing required environment variables:');
  missingVars.forEach(varName => {
    console.error(`  - ${varName}`);
  });
  console.error('\n[Standalone] Please ensure these are set in your .env file or as system environment variables.');
  console.error(`[Standalone] Current working directory: ${process.cwd()}`);
  console.error(`[Standalone] Tried .env locations:`);
  envPaths.forEach(p => console.error(`  - ${p}`));
  process.exit(1);
}

const demoSessionCleanupDaemon = require('./demo-session-cleanup-daemon');

console.log('[Standalone] Starting Demo Session Cleanup Daemon...');
console.log('[Standalone] Press Ctrl+C to stop');

// Start the daemon
(async () => {
  const started = await demoSessionCleanupDaemon.start();

  if (started) {
    console.log('[Standalone] Daemon started successfully');
    console.log('[Standalone] Status:', JSON.stringify(demoSessionCleanupDaemon.getStatus(), null, 2));

    // Create PID file to indicate daemon is running
    createPidFile();
  } else {
    console.error('[Standalone] Failed to start daemon. Check configuration.');
    process.exit(1);
  }
})();

// Handle graceful shutdown
let shuttingDown = false;

const shutdown = async () => {
  if (shuttingDown) {
    console.log('[Standalone] Shutdown already in progress...');
    return;
  }
  shuttingDown = true;

  console.log('\n[Standalone] Shutting down gracefully...');
  demoSessionCleanupDaemon.stop();

  // Remove PID file
  removePidFile();

  // Expire all sessions before shutdown
  await demoSessionCleanupDaemon.expireAllSessions();

  // Close database connections
  try {
    const sogoUserService = require('./sogo/sogo-user-service');
    await sogoUserService.close();
  } catch (error) {
    // Ignore if not initialized
  }

  try {
    const roundcubeUserService = require('./roundcube/roundcube-user-service');
    await roundcubeUserService.close();
  } catch (error) {
    // Ignore if not initialized
  }

  console.log('[Standalone] Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Keep process alive
process.on('uncaughtException', (error) => {
  console.error('[Standalone] Uncaught exception:', error);
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Standalone] Unhandled rejection at:', promise, 'reason:', reason);
  shutdown();
});

