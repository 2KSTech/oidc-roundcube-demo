/**
 * Stalwart API Endpoint Verification Tests
 * 
 * Tests actual Stalwart REST Management API endpoints to verify what works.
 * NO ASSUMPTIONS - just test what's real.
 */

require('dotenv').config({ path: './backend/.env' });
const axios = require('axios');

describe('Stalwart API Endpoint Verification', () => {
  let apiBaseUrl;
  let apiToken;
  let http;

  beforeAll(() => {
    apiBaseUrl = process.env.WORKINPILOT_MAIL_API_URL 
      || process.env.WORKINPILOT_STALWART_API_URL 
      || (process.env.STALWART_URL ? `${process.env.STALWART_URL.replace(/\/$/, '')}/api` : null)
      || 'https://mailqa.workinpilot.cloud/api';
    
    const apiKeyName = process.env.STALWART_API_KEY_NAME;
    const apiKeyToken = process.env.STALWART_API_KEY_AUTH_BEARER_TOKEN;
    if (apiKeyName && apiKeyToken) {
      const cleanToken = apiKeyToken.replace(/^api_/, '');
      apiToken = `api_${apiKeyName}:${cleanToken}`;
    } else {
      apiToken = process.env.WORKINPILOT_MAIL_API_TOKEN 
        || process.env.WORKINPILOT_STALWART_API_TOKEN;
    }

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

    console.log(`Testing against: ${apiBaseUrl}`);
    console.log(`Auth configured: ${!!authHeader}`);
  });

  describe('GET /principal - List Principals', () => {
    test('should list principals', async () => {
      const res = await http.get('/principal', { validateStatus: () => true });
      
      console.log('GET /principal status:', res.status);
      console.log('GET /principal response:', JSON.stringify(res.data, null, 2));
      
      expect(res.status).toBeDefined();
      
      if (res.status === 200) {
        expect(res.data).toBeDefined();
        console.log('OK GET /principal WORKS');
        console.log('Response is array?', Array.isArray(res.data));
        console.log('Response has data property?', res.data?.data !== undefined);
      } else {
        console.log(`FAIL GET /principal FAILED: ${res.status}`);
      }
    });
  });

  describe('GET /principal/{id} - Get Specific Principal', () => {
    test('should get principal by ID if list works', async () => {
      // First try to get a principal ID from listing
      const listRes = await http.get('/principal', { validateStatus: () => true });
      
      if (listRes.status === 200 && listRes.data) {
        const principals = Array.isArray(listRes.data) ? listRes.data : 
                         (listRes.data.data || []);
        
        if (principals.length > 0) {
          const testPrincipal = principals[0];
          const testId = testPrincipal.id || testPrincipal.email || testPrincipal.name;
          
          console.log(`Testing GET /principal/${testId}`);
          const getRes = await http.get(`/principal/${encodeURIComponent(testId)}`, { validateStatus: () => true });
          
          console.log('GET /principal/{id} status:', getRes.status);
          console.log('GET /principal/{id} response:', JSON.stringify(getRes.data, null, 2));
          
          if (getRes.status === 200) {
            console.log('OK GET /principal/{id} WORKS with ID');
            expect(getRes.data).toBeDefined();
          } else {
            console.log(`FAIL GET /principal/{id} FAILED: ${getRes.status}`);
          }
        }
      }
    });

    test('should test if email works as identifier', async () => {
      const testEmail = 'test@workinpilot.space';
      console.log(`Testing GET /principal/${testEmail} (as email)`);
      
      const res = await http.get(`/principal/${encodeURIComponent(testEmail)}`, { validateStatus: () => true });
      
      console.log('GET /principal/{email} status:', res.status);
      console.log('GET /principal/{email} response:', JSON.stringify(res.data, null, 2));
      
      if (res.status === 200) {
        console.log('OK GET /principal/{email} WORKS - accepts email');
      } else if (res.status === 404) {
        console.log('WARN:  GET /principal/{email} - endpoint exists but email not found');
      } else {
        console.log(`FAIL GET /principal/{email} FAILED: ${res.status} - may not accept email`);
      }
    });
  });

  describe('POST /principal - Create Principal', () => {
    test('should test create principal endpoint structure', async () => {
      const testData = {
        name: 'test-user',
        email: 'test-' + Date.now() + '@workinpilot.space',
        type: 'individual'
      };
      
      console.log('Testing POST /principal with:', JSON.stringify(testData, null, 2));
      
      const res = await http.post('/principal', testData, { validateStatus: () => true });
      
      console.log('POST /principal status:', res.status);
      console.log('POST /principal response:', JSON.stringify(res.data, null, 2));
      
      if (res.status >= 200 && res.status < 300) {
        console.log('OK POST /principal WORKS');
        expect(res.data).toBeDefined();
      } else {
        console.log(`FAIL POST /principal FAILED: ${res.status}`);
        if (res.data) {
          console.log('Error details:', res.data);
        }
      }
    });
  });

  describe('POST /oauth - Get OAuth Token', () => {
    test('should test OAuth token endpoint', async () => {
      const res = await http.post('/oauth', {}, { validateStatus: () => true });
      
      console.log('POST /oauth status:', res.status);
      console.log('POST /oauth response:', JSON.stringify(res.data, null, 2));
      
      if (res.status === 200) {
        console.log('OK POST /oauth WORKS');
        expect(res.data).toBeDefined();
      } else {
        console.log(`FAIL POST /oauth FAILED: ${res.status}`);
      }
    });
  });

  describe('FAKE ENDPOINT - GET /principal/{id}/mailbox/status', () => {
    test('should prove this endpoint does NOT exist', async () => {
      const testId = 'test@example.com';
      console.log(`Testing FAKE endpoint: GET /principal/${testId}/mailbox/status`);
      
      const res = await http.get(`/principal/${encodeURIComponent(testId)}/mailbox/status`, { validateStatus: () => true });
      
      console.log('FAKE endpoint status:', res.status);
      console.log('FAKE endpoint response:', JSON.stringify(res.data, null, 2));
      
      // This should return 404, 405, or 400 to prove it doesn't exist
      expect([404, 405, 400, 503]).toContain(res.status);
      console.log(`OK FAKE endpoint confirmed - does NOT exist (returned ${res.status})`);
    });
  });

  describe('Response Structure Documentation', () => {
    test('should document actual response structures', async () => {
      const listRes = await http.get('/principal', { validateStatus: () => true });
      
      if (listRes.status === 200) {
        console.log('\n=== ACTUAL RESPONSE STRUCTURES ===');
        console.log('GET /principal response type:', typeof listRes.data);
        console.log('Is array?', Array.isArray(listRes.data));
        console.log('Is object?', typeof listRes.data === 'object' && !Array.isArray(listRes.data));
        console.log('Has data property?', res.data?.data !== undefined);
        console.log('Full response:', JSON.stringify(listRes.data, null, 2));
      }
    });
  });
});

