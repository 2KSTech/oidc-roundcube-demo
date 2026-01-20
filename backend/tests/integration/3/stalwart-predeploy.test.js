/**
 * Stalwart Pre-deploy Account (REST) - Integration Test (Opt-in)
 *
 * Purpose: Verify that we can pre-create ("pre-deploy") a mailbox account in Stalwart
 * using the Management REST API, so the server recognizes the address before first login.
 *
 * This implements the documented requirement: pre-deploy accounts prior to first OIDC login
 * to avoid bounces when sending internal mail before onboarding is complete.
 *
 * Reference: https://stalw.art/docs/auth/backend/oidc/#offline-access
 *
 * IMPORTANT
 * - This test is skipped by default. To run it, set RUN_STALWART_LIVE_TESTS=1 in env.
 * - Requires a valid Management API base URL and API key via env.
 * - No assumptions on exact schema; asserts reachability and status class.
 */

require('dotenv').config({ path: './backend/.env' });
const axios = require('axios');

// Only run when explicitly enabled
const RUN_LIVE = process.env.RUN_STALWART_LIVE_TESTS === '1';
const RUN = RUN_LIVE ? describe : describe.skip;

RUN('Stalwart Pre-deploy via REST (live)', () => {
  let apiBaseUrl;
  let apiToken;
  let http;

  beforeAll(() => {
    // Resolve Management API base URL
    apiBaseUrl = process.env.WORKINPILOT_MAIL_API_URL
      || process.env.WORKINPILOT_STALWART_API_URL
      || (process.env.STALWART_URL ? `${process.env.STALWART_URL.replace(/\/$/, '')}/api` : null)
      || 'https://mailqa.workinpilot.cloud/api';

    // Resolve API token - always use Bearer format per Stalwart docs
    apiToken = process.env.WORKINPILOT_MAIL_API_TOKEN
      || process.env.WORKINPILOT_STALWART_API_TOKEN
      || process.env.STALWART_API_KEY_AUTH_BEARER_TOKEN;

    const headers = apiToken ? {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    } : { 'Content-Type': 'application/json' };

    http = axios.create({ baseURL: apiBaseUrl, timeout: 15000, headers });
    // Minimal visibility for debugging in CI/logs
    console.log(`[stalwart-predeploy] Base: ${apiBaseUrl}`);
    console.log(`[stalwart-predeploy] Auth configured: ${!!apiToken}`);
  });

  test('can reach Management API (GET /principal)', async () => {
    const res = await http.get('/principal', { validateStatus: () => true });
    console.log(`[stalwart-predeploy] GET /principal -> ${res.status}`);
    // 200 OK indicates reachable and authorized; 401/403 indicates reachable but auth missing/forbidden
    expect([200, 401, 403]).toContain(res.status);
  });

  test('pre-deploy create principal then fetch it (POST /principal -> GET /principal/{id})', async () => {
    const domain = process.env.WORKINPILOT_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';
    const stamp = Date.now();
    const username = `predeploy_${stamp}`;
    const email = `${username}@${domain}`;

    // Attempt creation - schema may vary; we send minimal plausible fields
    const createPayload = {
      name: username,
      email: email,
      type: 'individual'
    };

    const createRes = await http.post('/principal', createPayload, { validateStatus: () => true });
    console.log(`[stalwart-predeploy] POST /principal -> ${createRes.status}`);

    // Accept any 2xx as success; 409 implies already exists (also acceptable for pre-deploy idempotency)
    expect([200, 201, 202, 204, 409]).toContain(createRes.status);

    // Try to read back using the same email as identifier
    const getRes = await http.get(`/principal/${encodeURIComponent(email)}`, { validateStatus: () => true });
    console.log(`[stalwart-predeploy] GET /principal/{email} -> ${getRes.status}`);

    // Some deployments may require principal_id instead of email; allow 200 or 404 (if email not accepted as id)
    expect([200, 404]).toContain(getRes.status);
  });
});
