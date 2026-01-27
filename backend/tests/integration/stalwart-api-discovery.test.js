/**
 * Stalwart API Discovery Tests
 * 
 * These tests actually connect to the real Stalwart instance to discover:
 * 1. What endpoints actually exist
 * 2. What responses look like
 * 3. What works and what doesn't
 * 
 * NO ASSUMPTIONS - just test what's real
 */

require('dotenv').config({ path: './backend/.env' });
const axios = require('axios');

describe('Stalwart API Discovery', () => {
  let apiBaseUrl;
  let apiToken;
  let http;

  beforeAll(() => {
    // Get actual configuration from environment
    apiBaseUrl = process.env.DEMO_MAIL_API_URL 
      || process.env.DEMO_STALWART_API_URL 
      || process.env.STALWART_URL 
      || 'https://mailqa.workinpilot.cloud/api';
    
    apiToken = process.env.DEMO_MAIL_API_TOKEN 
      || process.env.DEMO_STALWART_API_TOKEN 
      || process.env.STALWART_API_KEY_AUTH_BEARER_TOKEN;

    // Create HTTP client with auth
    const authHeader = apiToken 
      ? (apiToken.startsWith('api_') ? apiToken : `Bearer ${apiToken}`)
      : null;

    http = axios.create({
      baseURL: apiBaseUrl,
      timeout: 10000,
      headers: authHeader ? { 
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      } : {}
    });
  });

  describe('API Base Connection', () => {
    test('should be able to connect to Stalwart API', async () => {
      // Try to get version or status endpoint
      try {
        const res = await http.get('/version', { validateStatus: () => true });
        console.log('Version endpoint response:', res.status, res.data);
      } catch (error) {
        console.log('Version endpoint error:', error.message);
      }
    });

    test('should list available endpoints by trying root', async () => {
      try {
        const res = await http.get('/', { validateStatus: () => true });
        console.log('Root endpoint response:', res.status, res.data);
      } catch (error) {
        console.log('Root endpoint error:', error.message);
      }
    });
  });

  describe('Principal Endpoints (REST Management API)', () => {
    test('GET /principal - should list principals', async () => {
      try {
        const res = await http.get('/principal', { validateStatus: () => true });
        console.log('GET /principal response:', res.status);
        console.log('Response data:', JSON.stringify(res.data, null, 2));
        expect(res.status).toBeDefined();
      } catch (error) {
        console.log('GET /principal error:', error.message);
        console.log('Error response:', error.response?.data);
      }
    });

    test('GET /principal/{id} - should get specific principal', async () => {
      // First try to list principals to get an ID
      try {
        const listRes = await http.get('/principal', { validateStatus: () => true });
        if (listRes.status === 200 && listRes.data) {
          const principals = Array.isArray(listRes.data) ? listRes.data : 
                           (listRes.data.data || []);
          if (principals.length > 0) {
            const testId = principals[0].id || principals[0].email || principals[0].name;
            console.log('Testing GET /principal/' + testId);
            const getRes = await http.get(`/principal/${encodeURIComponent(testId)}`, { validateStatus: () => true });
            console.log('GET /principal/{id} response:', getRes.status);
            console.log('Response data:', JSON.stringify(getRes.data, null, 2));
          }
        }
      } catch (error) {
        console.log('GET /principal/{id} error:', error.message);
        console.log('Error response:', error.response?.data);
      }
    });

    test('FAKE ENDPOINT TEST - /principal/{id}/mailbox/status - should fail (does not exist)', async () => {
      // This is the endpoint I made up - test that it actually doesn't exist
      try {
        const res = await http.get('/principal/test@example.com/mailbox/status', { validateStatus: () => true });
        console.log('FAKE ENDPOINT response:', res.status);
        console.log('Response data:', JSON.stringify(res.data, null, 2));
        // This should return 404 or 405, confirming it doesn't exist
        expect([404, 405, 400]).toContain(res.status);
      } catch (error) {
        console.log('FAKE ENDPOINT error (expected):', error.message);
        expect(error.response?.status).toBeDefined();
      }
    });
  });

  describe('JMAP API Discovery', () => {
    test('should discover JMAP endpoint location', async () => {
      // JMAP might be at /jmap or /api/jmap or different base
      const jmapPaths = ['/jmap', '/api/jmap', '/jmap/session', '/.well-known/jmap'];
      
      for (const path of jmapPaths) {
        try {
          const res = await http.get(path, { validateStatus: () => true });
          console.log(`JMAP path ${path} response:`, res.status);
          if (res.status === 200) {
            console.log('JMAP response data:', JSON.stringify(res.data, null, 2));
          }
        } catch (error) {
          // Expected for most paths
        }
      }
    });

    test('should test JMAP Mailbox/get method if JMAP is available', async () => {
      // This is a real JMAP method that should exist
      // But we need to discover where JMAP endpoint is first
      // This is a placeholder to remind us to test JMAP when we find it
      console.log('JMAP Mailbox/get test - needs JMAP endpoint discovery first');
    });
  });

  describe('OAuth Endpoints', () => {
    test('POST /oauth - should get OAuth token', async () => {
      try {
        const res = await http.post('/oauth', {}, { validateStatus: () => true });
        console.log('POST /oauth response:', res.status);
        console.log('Response data:', JSON.stringify(res.data, null, 2));
      } catch (error) {
        console.log('POST /oauth error:', error.message);
        console.log('Error response:', error.response?.data);
      }
    });
  });

  describe('Response Structure Discovery', () => {
    test('should document actual response structure from /principal', async () => {
      try {
        const res = await http.get('/principal', { validateStatus: () => true });
        if (res.status === 200) {
          console.log('=== ACTUAL PRINCIPAL LIST RESPONSE STRUCTURE ===');
          console.log('Status:', res.status);
          console.log('Is array?', Array.isArray(res.data));
          console.log('Has data property?', res.data?.data !== undefined);
          console.log('Full response:', JSON.stringify(res.data, null, 2));
        }
      } catch (error) {
        console.log('Error:', error.message);
      }
    });
  });
});

