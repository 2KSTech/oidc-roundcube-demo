// Centralized environment variable loader
// Supports both .env files (local development) and GitHub Secrets (CI/CD)

const path = require('path');

function loadEnvironment() {
  // Try to load .env file for local development
  try {
    require('dotenv').config({ path: path.join(__dirname, '../.env') });
  } catch (error) {
    console.log('No .env file found, using environment variables from system/GitHub Secrets');
  }

  // Validate required environment variables
  const requiredEnvVars = {
    // Keycloak Configuration
    KEYCLOAK_URL: 'Keycloak server URL',
    KEYCLOAK_REALM: 'Keycloak realm',
    KEYCLOAK_CLIENT_ID: 'Keycloak client ID',
    KEYCLOAK_CLIENT_SECRET: 'Keycloak client secret'
  };

  const missingVars = [];
  const envConfig = {};

  for (const [varName, description] of Object.entries(requiredEnvVars)) {
    if (!process.env[varName]) {
      missingVars.push({ varName, description });
    } else {
      envConfig[varName] = process.env[varName];
    }
  }

  if (missingVars.length > 0) {
    console.error('FAIL Missing required environment variables:');
    missingVars.forEach(({ varName, description }) => {
      console.error(`  ${varName}: ${description}`);
    });
    
    if (process.env.NODE_ENV === 'production') {
      console.error('In production, these should be set as GitHub Secrets or environment variables');
    } else {
      console.error('For local development, create a .env file with these variables');
    }
    
    throw new Error('Missing required environment variables');
  }

  // Log configuration (without sensitive data)
  console.log('OK Environment loaded successfully');
  console.log('Environment variables found:', Object.keys(envConfig).length);
  
  return envConfig;
}

module.exports = { loadEnvironment }; 