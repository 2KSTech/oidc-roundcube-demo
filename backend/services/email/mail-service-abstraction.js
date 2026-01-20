/**
 * Mail Service Abstraction Layer
 * 
 * Provides a unified interface for mail operations across different mail service providers.
 * This abstraction ensures clean separation between mailcow and stalwart implementations.
 */

const mailServiceConfig = require('../../config/mail-service-config');

class MailServiceAbstraction {
  constructor() {
    this.config = mailServiceConfig;
    this.provider = this.config.getProvider();
    this.service = null;
    this.initializeService();
  }

  initializeService() {
    try {
      if (this.provider === 'mailcow') {
        this.service = require('./mailcow-service');
      } else if (this.provider === 'stalwart') {
        this.service = require('./stalwart-service');
      } else {
        throw new Error(`Unknown mail service provider: ${this.provider}`);
      }
      
      console.log(`[MailServiceAbstraction] Initialized with provider: ${this.provider}`);
    } catch (error) {
      console.error(`[MailServiceAbstraction] Failed to initialize service "${this.provider}":`, error);
      // Fallback to mailcow if service fails to load
      if (this.provider !== 'mailcow') {
        console.warn(`[MailServiceAbstraction] Falling back to mailcow service`);
        this.provider = 'mailcow';
        this.service = require('./mailcow-service');
      } else {
        throw error;
      }
    }
  }

  /**
   * Verify that a mailbox exists for the user
   * Used during pre-registration/onboarding
   * 
   * @param {string} email - Email address to verify
   * @returns {Promise<Object>} { exists: boolean, mailbox?: Object, username?: string, error?: string }
   */
  async verifyMailboxExists(email) {
    console.log(`[MailServiceAbstraction] verifyMailboxExists(${email}) - Provider: ${this.provider}`);
    return await this.service.verifyMailboxExists(email);
  }

  /**
   * Verify and enable mailbox (complete onboarding flow)
   * 
   * @param {string} email - Email address to verify
   * @returns {Promise<Object>} { success: boolean, message: string, mailbox?: Object, username?: string, error?: string }
   */
  async verifyAndEnableMailbox(email) {
    console.log(`[MailServiceAbstraction] verifyAndEnableMailbox(${email}) - Provider: ${this.provider}`);
    return await this.service.verifyAndEnableMailbox(email);
  }

  /**
   * Send email via SMTP
   * Used for HiringManager and Support emails
   * 
   * @param {Object} options - Email options
   * @param {string} options.from - Sender email address
   * @param {string|string[]} options.to - Recipient email address(es)
   * @param {string} options.subject - Email subject
   * @param {string} options.text - Email body (plain text)
   * @param {string} [options.html] - Email body (HTML)
   * @param {Array} [options.attachments] - Email attachments
   * @param {string|string[]} [options.cc] - CC recipients
   * @param {string|string[]} [options.bcc] - BCC recipients
   * @param {Object} [options.user] - User object for authentication (if needed for OAuth)
   * @returns {Promise<Object>} { success: boolean, messageId?: string, error?: string }
   */
  async sendMail(options) {
    console.log(`[MailServiceAbstraction] sendMail(${options.to}) - Provider: ${this.provider}`);
    return await this.service.sendMail(options);
  }

  /**
   * Get unseen mail count for a user
   * Used by mail-notifier service
   * 
   * @param {string} username - Username to check
   * @param {string} [accessToken] - OAuth access token (for Stalwart/JMAP)
   * @returns {Promise<Object>} { success: boolean, unseen_count?: number, error?: string }
   */
  async getUnseenCount(username, accessToken = null) {
    console.log(`[MailServiceAbstraction] getUnseenCount(${username}) - Provider: ${this.provider}`);
    return await this.service.getUnseenCount(username, accessToken);
  }

  /**
   * Configure email proxy for a user
   * Maps internal email to personal email
   * 
   * @param {number} userId - User ID
   * @param {string} personalEmail - User's personal email address
   * @param {string} username - Username
   * @param {boolean} enableProxy - Whether to enable or disable proxy
   * @returns {Promise<Object>} { success: boolean, message: string, error?: string }
   */
  async configureProxy(userId, personalEmail, username, enableProxy = true) {
    console.log(`[MailServiceAbstraction] configureProxy(${userId}, ${personalEmail}, ${enableProxy}) - Provider: ${this.provider}`);
    return await this.service.configureProxy(userId, personalEmail, username, enableProxy);
  }

  /**
   * Delete a mailbox/user account
   * @param {string} email
   * @returns {Promise<Object>}
   */
  async deleteMailbox(email) {
    console.log(`[MailServiceAbstraction] deleteMailbox(${email}) - Provider: ${this.provider}`);
    return await this.service.deleteMailbox(email);
  }

  /**
   * Get provider name
   * @returns {string} Current provider name
   */
  getProvider() {
    return this.provider;
  }

  /**
   * Check if service is configured
   * @returns {boolean}
   */
  isConfigured() {
    return this.config.isConfigured() && (this.service && this.service.isConfigured ? this.service.isConfigured() : true);
  }

  /**
   * Get service configuration (for debugging/diagnostics)
   * @returns {Object}
   */
  getConfig() {
    return {
      provider: this.provider,
      ...this.config.getConfig(),
      serviceConfigured: this.isConfigured()
    };
  }
}

// Export singleton instance
module.exports = new MailServiceAbstraction();

