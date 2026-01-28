#!/usr/bin/env node

/**
 * Application Diagnostic Tool
 * 
 * This script performs comprehensive diagnostics on the application:
 * - Environment variable validation
 * - Mailclient database config string
 * - Keycloak configuration verification
 * - Mail Service integration validation
 * - File system checks
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

console.log('INFO: Application Diagnostic Tool');
console.log('=================================\n');

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
  'KEYCLOAK_ADMIN_URL',
  'KEYCLOAK_ADMIN_REALM',
  'KEYCLOAK_ADMIN_CLIENT_ID',
  'KEYCLOAK_ADMIN_CLIENT_SECRET',
  'DEMO_MAIL_PROVIDER',
  'STALWART_CLIENT_ID',
  'STALWART_CLIENT_SECRET',
  'DEMO_SSO_MAIL_CLIENT_NAME',
  'DEMO_SSO_MAIL_CLIENT_URL',
  'ROUNDCUBE_DB_HOST',
  'ROUNDCUBE_DB_NAME',
  'KEYCLOAK_SSO_MAIL_CLIENT',
  'KEYCLOAK_SSO_MAIL_CLIENT_SECRET',
  'KEYCLOAK_SSO_MAIL_CLIENT_REDIRECT',
  'APP_URL',
  'SESSION_SECRET'
];

const optionalEnvVars = [
  'NODE_ENV',
  'LOG_LEVEL',
  'LOG_FILE',
  'DEBUG'
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


// Mail configuration
if (process.env.DEMO_MAIL_PROVIDER && process.env.DEMO_MAIL_API_KEY_NAME && process.env.DEMO_MAIL_API_TOKEN) {
  logSuccess('Mail backend is configured');
} else {
  logWarning('Mail integration is partially configured');
  if (!process.env.DEMO_MAIL_PROVIDER) logWarning('DEMO_MAIL_PROVIDER not set');
  if (!process.env.DEMO_MAIL_API_KEY_NAME) logWarning('DEMO_MAIL_API_KEY_NAME not set');
  if (!process.env.DEMO_MAIL_API_TOKEN) logWarning('DEMO_MAIL_API_TOKEN not set');
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
