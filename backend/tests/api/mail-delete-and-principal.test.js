// Focused tests to prove implemented features work without hitting external services

// Utility to clear cached modules between provider switches
const clearCache = () => {
  Object.keys(require.cache).forEach((k) => {
    if (k.includes('mail-service') || k.includes('stalwart') || k.includes('mailcow')) {
      delete require.cache[k];
    }
  });
};

describe('Mail service features - focused proofs', () => {
  beforeEach(() => {
    jest.resetModules();
    clearCache();
  });

  test('deleteMailbox() via abstraction calls provider implementation (stalwart)', async () => {
    process.env.DEMO_MAIL_PROVIDER = 'stalwart';
    process.env.DEMO_MAIL_API_URL = 'http://localhost:8082/api';
    process.env.DEMO_MAIL_API_TOKEN = 'test-token';

    // Load the real stalwart-client singleton and monkey-patch its methods
    const stalwartClient = require('../../services/email/stalwart-client');
    // Ensure configured
    expect(stalwartClient.isConfigured()).toBe(true);

    // Mock getPrincipal and deletePrincipal behavior
    stalwartClient.getPrincipal = jest.fn().mockResolvedValue({
      success: true,
      status: 200,
      principal: { name: 'user@workinpilot.space' }
    });
    stalwartClient.deletePrincipal = jest.fn().mockResolvedValue({ success: true, status: 200 });

    const mailService = require('../../services/email/mail-service-abstraction');
    const result = await mailService.deleteMailbox('user@workinpilot.space');

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(stalwartClient.getPrincipal).toHaveBeenCalledWith('user@workinpilot.space');
    expect(stalwartClient.deletePrincipal).toHaveBeenCalledWith('user@workinpilot.space');
  });

  test('stalwart-client.getPrincipal unwraps { data: {...} } correctly', async () => {
    process.env.DEMO_MAIL_PROVIDER = 'stalwart';
    process.env.DEMO_MAIL_API_URL = 'http://localhost:8082/api';
    process.env.DEMO_MAIL_API_TOKEN = 'test-token';

    const client = require('../../services/email/stalwart-client');
    expect(client.isConfigured()).toBe(true);

    // Monkey-patch axios instance to return wrapped response
    client.http = {
      get: jest.fn().mockResolvedValue({ status: 200, data: { data: { name: 'john.doe' } } })
    };

    const res = await client.getPrincipal('john.doe');
    expect(res.success).toBe(true);
    expect(res.principal).toBeDefined();
    expect(res.principal.name).toBe('john.doe');
  });
});


