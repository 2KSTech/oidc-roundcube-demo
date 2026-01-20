#!/usr/bin/env node

/**
 * WorkInPilot Application Diagnostic Tool
 * 
 * This script performs comprehensive diagnostics on the application:
 * - Environment variable validation
 * - Database connectivity checks
 * - Keycloak configuration verification
 * - Service integration validation
 * - File system checks
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

console.log('INFO: WorkInPilot Application Diagnostic Tool');
console.log('==========================================\n');

// Color codes for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function logSuccess(message) {
  console.log(`${colors.green}OK ${message}${colors.reset}`);
}

function logError(message) {
  console.log(`${colors.red}FAIL ${message}${colors.reset}`);
}

function logWarning(message) {
  console.log(`${colors.yellow}WARN:  ${message}${colors.reset}`);
}

function logInfo(message) {
  console.log(`${colors.blue}ℹ️  ${message}${colors.reset}`);
}

function logSection(title) {
  console.log(`\n${colors.bold}${title}${colors.reset}`);
  console.log('─'.repeat(title.length));
}

// 1. Environment Variables Check
logSection('Environment Variables Check');

const requiredEnvVars = [
  'KEYCLOAK_URL',
  'KEYCLOAK_REALM',
  'KEYCLOAK_CLIENT_ID',
  'KEYCLOAK_CLIENT_SECRET',
  'APP_URL',
  'SESSION_SECRET'
];

const optionalEnvVars = [
  'MAILCOW_URL',
  'MAILCOW_CLIENT_ID',
  'MAILCOW_CLIENT_SECRET',
  'DB_PATH',
  'NODE_ENV'
];

let envErrors = 0;
let envWarnings = 0;
let dbErrors = 0;
let dbWarnings = 0;

// Check required environment variables
requiredEnvVars.forEach(varName => {
  if (process.env[varName]) {
    logSuccess(`${varName} is configured`);
  } else {
    logError(`${varName} is missing`);
    envErrors++;
  }
});

// Check optional environment variables
optionalEnvVars.forEach(varName => {
  if (process.env[varName]) {
    logSuccess(`${varName} is configured`);
  } else {
    logWarning(`${varName} is not configured (optional)`);
    envWarnings++;
  }
});

// 2. File System Checks
logSection('File System Checks');

const requiredFiles = [
  'server.js',
  'package.json',
  'config/passport.js',
  'routes/auth.js',
  'routes/app.js',
  'middleware/auth.js'
];

const optionalFiles = [
  '.env'
];

let fileErrors = 0;
let fileWarnings = 0;

// Check required files
requiredFiles.forEach(filePath => {
  const fullPath = path.join(__dirname, filePath);
  if (fs.existsSync(fullPath)) {
    logSuccess(`${filePath} exists`);
  } else {
    logError(`${filePath} is missing`);
    fileErrors++;
  }
});

// Check optional files
optionalFiles.forEach(filePath => {
  const fullPath = path.join(__dirname, filePath);
  if (fs.existsSync(fullPath)) {
    logSuccess(`${filePath} exists`);
  } else {
    logWarning(`${filePath} is missing (optional)`);
    fileWarnings++;
  }
});

function finalizeSummary() {
  logSection('Diagnostic Summary');
  const totalErrors = envErrors + fileErrors + dbErrors;
  const totalWarnings = envWarnings + fileWarnings + dbWarnings;
  console.log(`\n${colors.bold}Summary:${colors.reset}`);
  console.log(`- Errors: ${totalErrors}`);
  console.log(`- Warnings: ${totalWarnings}`);
  if (totalErrors === 0) {
    logSuccess('Application appears to be properly configured!');
    console.log('\nTo start the application, run:');
    console.log('  npm start     # Production mode');
    console.log('  npm run dev   # Development mode');
  } else {
    logError('Please fix the errors above before starting the application.');
  }
  if (totalWarnings > 0) {
    logWarning('Some optional configurations are missing. Check warnings above.');
  }
  console.log('\nFor more information, see:');
  console.log('- SERVICE_INTEGRATION_README.md');
  console.log('- backend/config.env.example');
  console.log('- backend/README.md');
}

// 3. Database Connectivity Check
logSection('Database Connectivity Check');

const dbPath = process.env.DB_PATH || './database.sqlite';
const fullDbPath = path.isAbsolute(dbPath) ? dbPath : path.join(__dirname, dbPath);

if (fs.existsSync(fullDbPath)) {
  logSuccess(`Database file exists at ${dbPath}`);
  
  // Try to connect to database
  try {
    const db = new sqlite3.Database(fullDbPath);
    
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'", (err, row) => {
      if (err) {
        logError(`Database connection failed: ${err.message}`);
        dbErrors++;
        finalizeSummary();
      } else if (row) {
        logSuccess('Database connection successful');
        logSuccess('Users table exists');

        // Check for other important tables and aggregate results before summary
        const tables = ['user_activities', 'user_account', 'workinpilot_application', 'profiles', 'resumes', 'jobs', 'applications'];
        const critical = new Set(['user_activities', 'user_account']);
        let pending = tables.length;
        tables.forEach(tableName => {
          db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`, (terr, trow) => {
            if (trow) {
              logSuccess(`${tableName} table exists`);
            } else {
              if (critical.has(tableName)) {
                logError(`${tableName} table is missing`);
                dbErrors++;
              } else {
                logWarning(`${tableName} table is missing`);
                dbWarnings++;
              }
            }
            pending--;
            if (pending === 0) {
              db.close();
              finalizeSummary();
            }
          });
        });

        // Fire-and-forget: activity type CHECK constraint integrity (doesn't affect totals)
        db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_activities'", (cerr, crow) => {
          if (!cerr && crow && crow.sql) {
            const required = [
              'login','logout','profile_view','profile_edit','resume_created','resume_edited','job_applied','job_viewed',
              'application_initiated','course_enrolled','course_completed','interview_scheduled','interview_completed','skill_added','skill_updated',
              'service_access','application_prepared','email_test','email_sent'
            ];
            const missing = required.filter(t => !crow.sql.includes(`'${t}'`));
            if (missing.length === 0) {
              logSuccess('user_activities CHECK constraint includes all required activity types');
            } else {
              logWarning(`user_activities CHECK constraint missing: ${missing.join(', ')}`);
            }
          }
        });

      } else {
        logError('Users table is missing');
        dbErrors++;
        finalizeSummary();
      }
    });
  } catch (error) {
    logError(`Database connection error: ${error.message}`);
    dbErrors++;
    finalizeSummary();
  }
} else {
  logError(`Database file not found at ${dbPath}`);
  dbErrors++;
  finalizeSummary();
}

// 4. Keycloak Configuration Check
logSection('Keycloak Configuration Check');

if (process.env.KEYCLOAK_URL) {
  logSuccess(`Keycloak URL: ${process.env.KEYCLOAK_URL}`);
} else {
  logError('KEYCLOAK_URL not configured');
}

if (process.env.KEYCLOAK_REALM) {
  logSuccess(`Keycloak Realm: ${process.env.KEYCLOAK_REALM}`);
} else {
  logError('KEYCLOAK_REALM not configured');
}

if (process.env.KEYCLOAK_CLIENT_ID) {
  logSuccess(`Keycloak Client ID: ${process.env.KEYCLOAK_CLIENT_ID}`);
} else {
  logError('KEYCLOAK_CLIENT_ID not configured');
}

if (process.env.KEYCLOAK_CLIENT_SECRET) {
  logSuccess('Keycloak Client Secret is configured');
} else {
  logError('KEYCLOAK_CLIENT_SECRET not configured');
}

// 5. Service Integration Check
logSection('Service Integration Check');


// MailCow configuration
if (process.env.MAILCOW_URL && process.env.MAILCOW_CLIENT_ID && process.env.MAILCOW_CLIENT_SECRET) {
  logSuccess('MailCow integration is fully configured');
} else {
  logWarning('MailCow integration is partially configured');
  if (!process.env.MAILCOW_URL) logWarning('MAILCOW_URL not set');
  if (!process.env.MAILCOW_CLIENT_ID) logWarning('MAILCOW_CLIENT_ID not set');
  if (!process.env.MAILCOW_CLIENT_SECRET) logWarning('MAILCOW_CLIENT_SECRET not set');
}

// 6. Node.js and Dependencies Check
logSection('Node.js and Dependencies Check');

// Check Node.js version
const nodeVersion = process.version;
logInfo(`Node.js version: ${nodeVersion}`);

// Check if package.json exists and has required dependencies
const packageJsonPath = path.join(__dirname, 'package.json');
if (fs.existsSync(packageJsonPath)) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    const requiredDeps = [
      'express',
      'passport',
      'passport-keycloak-oauth2-oidc',
      'sqlite3',
      'ejs',
      'express-session',
      'dotenv'
    ];
    
    requiredDeps.forEach(dep => {
      if (packageJson.dependencies && packageJson.dependencies[dep]) {
        logSuccess(`${dep} is installed`);
      } else {
        logError(`${dep} is missing from dependencies`);
      }
    });
    
    // Check if node_modules exists
    const nodeModulesPath = path.join(__dirname, 'node_modules');
    if (fs.existsSync(nodeModulesPath)) {
      logSuccess('node_modules directory exists');
    } else {
      logError('node_modules directory is missing - run npm install');
    }
    
  } catch (error) {
    logError(`Error reading package.json: ${error.message}`);
  }
} else {
  logError('package.json not found');
}

// Summary is printed by finalizeSummary(), after DB checks complete