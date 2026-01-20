const mailcowClient = require('./mailcow-client.js');

class MailcowVerificationService {
  constructor() {
    this.mailcowClient = mailcowClient;
  }

  // Verify that a mailbox exists for the user (since MailCow syncs with Keycloak)
  async verifyMailboxExists(email) {
    try {
      console.log(`[mailcow-verification - verifyMailboxExists] Verifying mailbox exists: ${email}`);
      
      if (!this.mailcowClient.isConfigured()) {
        console.log('MailCow client not configured');
        return {
          exists: false,
          error: 'MailCow client not configured'
        };
      }
      
      const result = await this.mailcowClient.getMailbox(email);
      
      if (result.success && result.status === 200 && result.mailbox && result.mailbox.username) {
        console.log(`[mailcow-verification - verifyMailboxExists] Mailbox verification successful: ${email} -> ${result.mailbox.username}`);
        return {
          exists: true,
          mailbox: result.mailbox,
          username: result.mailbox.username
        };
      } else if (result.status === 404) {
        console.log(`Mailbox not found: ${email}`);
        return {
          exists: false,
          message: 'Mailbox not found in MailCow'
        };
      } else {
        console.log(`Mailbox verification failed: ${email} - ${result.error}`);
        return {
          exists: false,
          error: result.error || 'Unknown error'
        };
      }
      
    } catch (error) {
      console.error('Error verifying mailbox:', error);
      return {
        exists: false,
        error: error.message
      };
    }
  }

  // Complete verification process
  async verifyAndEnableMailbox(email) {
    console.log('[mailcow-verification - verifyAndEnableMailbox] === Starting mailbox verification ===');
    console.log(`Email: ${email}`);
    
    const verifyResult = await this.verifyMailboxExists(email);
    
    if (verifyResult.exists) {
      console.log('[mailcow-verification - verifyAndEnableMailbox] === Mailbox verification completed successfully ===');
      return {
        success: true,
        message: 'Mailbox verified successfully',
        mailbox: verifyResult.mailbox,
        username: verifyResult.username
      };
    } else {
      console.log('[mailcow-verification - verifyAndEnableMailbox] === Mailbox verification failed ===');
      return {
        success: false,
        message: verifyResult.message || verifyResult.error || 'Mailbox verification failed',
        error: verifyResult.error
      };
    }
  }
}

module.exports = new MailcowVerificationService();
