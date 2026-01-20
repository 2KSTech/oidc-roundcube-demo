/**
 * Tests for Mail Service Abstraction Layer
 * 
 * Verifies that:
 * 1. Mailcow code path still works (backward compatibility)
 * 2. Stalwart code path works (new functionality)
 * 3. Abstraction layer correctly routes to the right service
 * 4. No bugs in response structure handling (especially duplicate key bug fix)
 */

// Clear require cache to ensure fresh instances
const clearCache = () => {
  Object.keys(require.cache).forEach(key => {
    if (key.includes('mail-service') || key.includes('mailcow') || key.includes('stalwart')) {
      delete require.cache[key];
    }
  });
};

const mailServiceAbstraction = require('../../services/email/mail-service-abstraction');
const mailcowService = require('../../services/email/mailcow-service');
const stalwartService = require('../../services/email/stalwart-service');
const mailcowClient = require('../../services/email/mailcow-client');
const stalwartClient = require('../../services/email/stalwart-client');

describe('Mail Service Abstraction Layer', () => {
  
  describe('Service Detection', () => {
    test('should detect provider from environment variable', () => {
      const provider = mailServiceAbstraction.getProvider();
      expect(['mailcow', 'stalwart']).toContain(provider);
    });
    
    test('should load correct service instance based on provider', () => {
      const service = mailServiceAbstraction.service;
      expect(service).toBeDefined();
      expect(typeof service.isConfigured).toBe('function');
    });
  });

  describe('Mailcow Code Path', () => {
    test('mailcow-service should wrap mailcow-verification correctly', () => {
      expect(mailcowService.verifyMailboxExists).toBeDefined();
      expect(typeof mailcowService.verifyMailboxExists).toBe('function');
      expect(mailcowService.verifyAndEnableMailbox).toBeDefined();
      expect(typeof mailcowService.verifyAndEnableMailbox).toBe('function');
    });

    test('mailcow-client should have required methods', () => {
      expect(mailcowClient.getMailbox).toBeDefined();
      expect(typeof mailcowClient.getMailbox).toBe('function');
      expect(mailcowClient.isConfigured).toBeDefined();
      expect(typeof mailcowClient.isConfigured).toBe('function');
    });

    test('mailcow-service.verifyMailboxExists should return correct structure', async () => {
      // This test will fail if mailbox doesn't exist, but that's OK - we're testing the structure
      const result = await mailcowService.verifyMailboxExists('nonexistent@test.com');
      
      // Should return object with 'exists' boolean
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect('exists' in result).toBe(true);
      expect(typeof result.exists).toBe('boolean');
      
      // If exists is false, should have error or message
      if (!result.exists) {
        expect(result.error || result.message).toBeDefined();
      }
    });

    test('mailcow-service.verifyAndEnableMailbox should return correct structure', async () => {
      const result = await mailcowService.verifyAndEnableMailbox('nonexistent@test.com');
      
      // Should return object with 'success' boolean
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect('success' in result).toBe(true);
      expect(typeof result.success).toBe('boolean');
      
      // Should have message
      expect(result.message).toBeDefined();
      expect(typeof result.message).toBe('string');
    });
  });

  describe('Stalwart Code Path', () => {
    test('stalwart-service should have required methods', () => {
      expect(stalwartService.verifyMailboxExists).toBeDefined();
      expect(typeof stalwartService.verifyMailboxExists).toBe('function');
      expect(stalwartService.verifyAndEnableMailbox).toBeDefined();
      expect(typeof stalwartService.verifyAndEnableMailbox).toBe('function');
    });

    test('stalwart-client should have required methods', () => {
      expect(stalwartClient.getPrincipal).toBeDefined();
      expect(typeof stalwartClient.getPrincipal).toBe('function');
      expect(stalwartClient.isConfigured).toBeDefined();
      expect(typeof stalwartClient.isConfigured).toBe('function');
    });

    test('stalwart-client.getPrincipal should return correct structure (no duplicate keys)', async () => {
      const result = await stalwartClient.getPrincipal('nonexistent@test.com');
      
      // Should return object with 'success' boolean
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect('success' in result).toBe(true);
      expect(typeof result.success).toBe('boolean');
      
      // CRITICAL: Should NOT have duplicate 'status' key
      // If result has 'status' property, it should be a number (HTTP status code)
      if ('status' in result) {
        expect(typeof result.status).toBe('number');
        // Should NOT have both 'status' as number AND 'status' as data object
        const keys = Object.keys(result);
        const statusCount = keys.filter(k => k === 'status').length;
        expect(statusCount).toBe(1); // Only one 'status' key
      }
      
      // If successful, should have 'principal'
      if (result.success) {
        expect(result.principal).toBeDefined();
      }
    });

    test('stalwart-client.getMailboxStatus should return correct structure (BUG FIX VERIFICATION)', async () => {
      const result = await stalwartClient.getMailboxStatus('test@example.com');
      
      // Should return object with 'success' boolean
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect('success' in result).toBe(true);
      
      // CRITICAL BUG FIX: Should have 'data' property, NOT duplicate 'status'
      if (result.success) {
        expect(result.data).toBeDefined();
        expect(result.status).toBe(200); // HTTP status code should be 200
        // Should NOT have result.status as an object (that was the bug)
        expect(typeof result.status).toBe('number');
      }
    });

    test('stalwart-service.getUnseenCount should handle getMailboxStatus response correctly', async () => {
      const result = await stalwartService.getUnseenCount('testuser');
      
      // Should return object with 'success' boolean
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect('success' in result).toBe(true);
      
      // If successful, should have unseen_count
      if (result.success) {
        expect('unseen_count' in result).toBe(true);
        expect(typeof result.unseen_count).toBe('number');
      }
    });

    test('stalwart-service.verifyMailboxExists should return correct structure', async () => {
      const result = await stalwartService.verifyMailboxExists('nonexistent@test.com');
      
      // Should return object with 'exists' boolean
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect('exists' in result).toBe(true);
      expect(typeof result.exists).toBe('boolean');
    });

    test('stalwart-service.verifyAndEnableMailbox should return correct structure', async () => {
      const result = await stalwartService.verifyAndEnableMailbox('nonexistent@test.com');
      
      // Should return object with 'success' boolean
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect('success' in result).toBe(true);
      expect(typeof result.success).toBe('boolean');
      
      // Should have message
      expect(result.message).toBeDefined();
      expect(typeof result.message).toBe('string');
    });
  });

  describe('Abstraction Layer Interface', () => {
    test('abstraction layer should provide verifyMailboxExists', async () => {
      const result = await mailServiceAbstraction.verifyMailboxExists('test@example.com');
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect('exists' in result).toBe(true);
    });

    test('abstraction layer should provide verifyAndEnableMailbox', async () => {
      const result = await mailServiceAbstraction.verifyAndEnableMailbox('test@example.com');
      
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect('success' in result).toBe(true);
      expect(result.message).toBeDefined();
    });

    test('abstraction layer should provide sendMail', () => {
      expect(mailServiceAbstraction.sendMail).toBeDefined();
      expect(typeof mailServiceAbstraction.sendMail).toBe('function');
    });

    test('abstraction layer should provide getUnseenCount', () => {
      expect(mailServiceAbstraction.getUnseenCount).toBeDefined();
      expect(typeof mailServiceAbstraction.getUnseenCount).toBe('function');
    });

    test('abstraction layer should provide configureProxy', () => {
      expect(mailServiceAbstraction.configureProxy).toBeDefined();
      expect(typeof mailServiceAbstraction.configureProxy).toBe('function');
    });
  });

  describe('Response Structure Consistency', () => {
    test('verifyMailboxExists should return consistent structure across services', async () => {
      const mailcowResult = await mailcowService.verifyMailboxExists('test@example.com');
      const stalwartResult = await stalwartService.verifyMailboxExists('test@example.com');
      
      // Both should have 'exists' boolean
      expect('exists' in mailcowResult).toBe(true);
      expect('exists' in stalwartResult).toBe(true);
      expect(typeof mailcowResult.exists).toBe('boolean');
      expect(typeof stalwartResult.exists).toBe('boolean');
    });

    test('verifyAndEnableMailbox should return consistent structure across services', async () => {
      const mailcowResult = await mailcowService.verifyAndEnableMailbox('test@example.com');
      const stalwartResult = await stalwartService.verifyAndEnableMailbox('test@example.com');
      
      // Both should have 'success' boolean and 'message' string
      expect('success' in mailcowResult).toBe(true);
      expect('success' in stalwartResult).toBe(true);
      expect(typeof mailcowResult.success).toBe('boolean');
      expect(typeof stalwartResult.success).toBe('boolean');
      expect(typeof mailcowResult.message).toBe('string');
      expect(typeof stalwartResult.message).toBe('string');
    });
  });
});

