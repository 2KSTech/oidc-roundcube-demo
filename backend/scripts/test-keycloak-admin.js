// Test program: create a Keycloak user via Admin API and update their email
// Uses repo's backend/.env via env-loader

const path = require('path');

async function main() {
  // Ensure environment is loaded (from backend/.env if present)
  const { loadEnvironment } = require('../config/env-loader');
  try {
    loadEnvironment();
  } catch (err) {
    console.error('Failed to load environment:', err.message);
    process.exit(1);
  }

  // Validate required admin env variables for this test
  const required = ['KEYCLOAK_URL', 'KEYCLOAK_REALM', 'KEYCLOAK_ADMIN_CLIENT_ID', 'KEYCLOAK_ADMIN_CLIENT_SECRET'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('Missing required admin env variables for this test:', missing.join(', '));
    process.exit(2);
  }

  const {
    addUser,
    updateUserEmail,
    getUserById,
  } = require('../config/keycloak-admin');

  // Generate test data similar to Cypress
  const ts = Date.now();
  const username = process.env.TEST_USERNAME || process.env.CYPRESS_TEST_USERNAME || `test${ts}`;
  const firstName = process.env.TEST_FIRST_NAME || process.env.CYPRESS_FIRST_NAME || username;
  const lastName = process.env.TEST_LAST_NAME || process.env.CYPRESS_LAST_NAME || 'User';
  const domain = process.env.TEST_EMAIL_DOMAIN || 'workinpilot.xyz';
  const email = process.env.TEST_EMAIL || process.env.CYPRESS_TEST_EMAIL || `${username}@${domain}`;
  const defaultTestSecret = process.env.TEST_SECRET || process.env.CYPRESS_TEST_PASSWORD;

  // Create user representation for Keycloak Admin API
  const userRep = {
    username,
    firstName,
    lastName,
    email,
    enabled: true,
    emailVerified: false,
    credentials: [
      {
        type: 'password',
        value: defaultTestSecret,
        temporary: false,
      },
    ],
  };

  console.log('--- Keycloak Admin Test: Create user then update email ---');
  console.log('Realm:', process.env.KEYCLOAK_REALM);
  console.log('Username:', username);
  console.log('Initial email:', email);

  // 1) Create a user
  let createdUserId = null;
  try {
    createdUserId = await addUser(userRep);
  } catch (err) {
    console.error('Create user failed:', err.message);
    process.exit(3);
  }

  console.log('Created userId:', createdUserId || '(not returned, will fetch by ID via response)');

  // Fetch user to assert creation
  let createdUser;
  try {
    // If createdUserId is null (no Location header), we cannot resolve by username
    // without an extra search API; but typically Location is returned when 201
    if (!createdUserId) {
      throw new Error('User ID not returned by Keycloak (Location header missing)');
    }
    createdUser = await getUserById(createdUserId);
  } catch (err) {
    console.error('Fetch created user failed:', err.message);
    process.exit(4);
  }

  console.assert(!!createdUser && createdUser.username === username, 'ASSERT: created user username matches');
  console.assert(!!createdUser && createdUser.email === email, 'ASSERT: created user email matches');
  console.log('OK Assertions after create passed');

  // 2) Update email using helper
  const updatedEmail = `${username}updated@${domain}`;
  console.log('Updated email (expected):', updatedEmail);
  try {
    await updateUserEmail(createdUserId, updatedEmail, true);
  } catch (err) {
    console.error('Update user email failed:', err.message);
    process.exit(5);
  }

  // Fetch again and assert
  let updatedUser;
  try {
    updatedUser = await getUserById(createdUserId);
  } catch (err) {
    console.error('Fetch updated user failed:', err.message);
    process.exit(6);
  }

  console.assert(!!updatedUser && updatedUser.email === updatedEmail, 'ASSERT: updated user email matches');
  console.assert(!!updatedUser && updatedUser.emailVerified === true, 'ASSERT: updated user emailVerified=true');
  console.log('Updated email (actual):', updatedUser && updatedUser.email);
  console.log('OK Assertions after update passed');

  console.log('--- All done ---');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(10);
});


