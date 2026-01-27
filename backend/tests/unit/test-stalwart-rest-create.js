const axios = require('axios');
require('dotenv').config();

(async () => {
  try {
    // Get config from environment
    const apiUrl = process.env.DEMO_MAIL_API_URL 
      || process.env.DEMO_STALWART_API_URL 
      || (process.env.STALWART_URL ? `${process.env.STALWART_URL.replace(/\/$/, '')}/api` : null);
    
    const apiToken = process.env.DEMO_MAIL_API_TOKEN 
      || process.env.STALWART_API_KEY_AUTH_BEARER_TOKEN;
    
    const domain = process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';
    
    if (!apiUrl || !apiToken) {
      console.error('FAIL Missing API URL or token');
      process.exit(1);
    }
    
    console.log('Testing Stalwart REST API createPrincipal with OIDC directory...');
    console.log(`API URL: ${apiUrl}`);
    console.log(`Domain: ${domain}`);
    
    const http = axios.create({
      baseURL: apiUrl,
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true // Don't throw on any status
    });
    
    // Test data
    const timestamp = Date.now();
    const username = `test-rest-create-${timestamp}`;
    const email = `${username}@${domain}`;
    
    const principalData = {
      type: 'individual',
      name: username,
      emails: [email]
    };
    
    console.log(`\n📤 Attempting to create principal: ${email}`);
    console.log(`Payload:`, JSON.stringify(principalData, null, 2));
    
    const createRes = await http.post('/principal', principalData);
    
    console.log(`\n📥 Response Status: ${createRes.status}`);
    console.log(`Response Data:`, JSON.stringify(createRes.data, null, 2));
    
    // Interpret results
    if (createRes.status >= 200 && createRes.status < 300) {
      console.log(`\nOK SUCCESS: Principal created via REST API`);
      console.log(`   This means REST API creation WORKS even with OIDC directory`);
      
      // Try to fetch it back
      console.log(`\nINFO: Verifying: Fetching created principal...`);
      const fetchRes = await http.get(`/principal/${encodeURIComponent(email)}`);
      
      if (fetchRes.status === 200) {
        console.log(`OK Verification: Principal exists and can be fetched`);
      } else {
        console.log(`WARN:  Verification: Principal created but cannot be fetched by email (status: ${fetchRes.status})`);
      }
      
    } else if (createRes.status === 403 || createRes.status === 401) {
      console.log(`\nFAIL AUTH ERROR: ${createRes.status}`);
      console.log(`   Check your API token`);
      
    } else if (createRes.status === 400 || createRes.status === 422) {
      console.log(`\nFAIL VALIDATION ERROR: ${createRes.status}`);
      console.log(`   Request format may be wrong, or OIDC directory may not allow REST creation`);
      console.log(`   Error:`, createRes.data);
      
    } else if (createRes.status === 409) {
      console.log(`\nWARN:  CONFLICT: Principal already exists (409)`);
      console.log(`   This is actually OK - means the endpoint works`);
      
    } else {
      console.log(`\nFAIL UNEXPECTED STATUS: ${createRes.status}`);
      console.log(`   Response:`, createRes.data);
      console.log(`   This likely means OIDC directory does NOT allow REST API creation`);
    }
    
    process.exit(0);
    
  } catch (error) {
    console.error('FAIL ERROR:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
})();
