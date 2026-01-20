/**
 * Mailcow Service Wrapper
 * 
 * Wraps existing mailcow functionality behind the mail service abstraction layer.
 * This wrapper does NOT modify existing mailcow code - it just provides a unified interface.
 */

const mailcowClient = require('./mailcow-client.js');
const mailcowVerification = require('./mailcow-verification.js');
const mailboxProxyConfig = require('./mailbox-proxy-config.js');
const nodemailer = require('nodemailer');
const mailServiceConfig = require('../../config/mail-service-config');

class MailcowService {
  constructor() {
    this.mailcowClient = mailcowClient;
    this.mailcowVerification = mailcowVerification;
    this.mailboxProxyConfig = mailboxProxyConfig;
    this.config = mailServiceConfig;
  }

  isConfigured() {
    return this.mailcowClient.isConfigured();
  }

  /**
   * Verify that a mailbox exists for the user
   * @param {string} email - Email address to verify
   * @returns {Promise<Object>}
   */
  async verifyMailboxExists(email) {
    return await this.mailcowVerification.verifyMailboxExists(email);
  }

  /**
   * Verify and enable mailbox (complete onboarding flow)
   * @param {string} email - Email address to verify
   * @returns {Promise<Object>}
   */
  async verifyAndEnableMailbox(email) {
    return await this.mailcowVerification.verifyAndEnableMailbox(email);
  }

  /**
   * Send email via SMTP
   * Uses mailcow SMTP with admin credentials
   * 
   * @param {Object} options - Email options
   * @returns {Promise<Object>}
   */
  async sendMail(options) {
    try {
      const intEmailDomain = process.env.WORKINPILOT_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';
      const smtpHost = this.config.getSmtpHost();
      const smtpPort = this.config.getSmtpPort();
      const senderEmail = options.from || `mailadmin@${intEmailDomain}`;
      const adminPassword = process.env.NEXTCLOUD_ADMIN_PW;

      if (!adminPassword) {
        return {
          success: false,
          error: 'Admin password not configured',
          message: 'NEXTCLOUD_ADMIN_PW environment variable not set'
        };
      }

      if (!smtpHost || !smtpPort) {
        return {
          success: false,
          error: 'SMTP not configured',
          message: 'SMTP host and port must be configured'
        };
      }

      console.log(`[MailcowService] Sending email via SMTP: ${smtpHost}:${smtpPort}`);

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465, // Use TLS for port 465, STARTTLS for 587
        auth: {
          user: senderEmail,
          pass: adminPassword
        },
        tls: {
          rejectUnauthorized: false // Allow self-signed certificates
        },
        authMethod: 'PLAIN'
      });

      const mailOptions = {
        from: senderEmail,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        attachments: options.attachments || [],
        cc: options.cc,
        bcc: options.bcc,
        priority: options.priority || 'normal'
      };

      const result = await transporter.sendMail(mailOptions);

      return {
        success: true,
        messageId: result.messageId,
        response: result.response
      };
    } catch (error) {
      console.error('[MailcowService] Error sending email:', error);
      return {
        success: false,
        error: error.message || 'Failed to send email',
        code: error.code
      };
    }
  }

  /**
   * Get unseen mail count for a user
   * This is handled by mail-notifier service, but we provide the interface
   * 
   * @param {string} username - Username to check
   * @param {string} [accessToken] - OAuth access token (not used for Mailcow)
   * @returns {Promise<Object>}
   */
  async getUnseenCount(username, accessToken = null) {
    // Mailcow unseen count is handled by mail-notifier service via docker exec
    // This method is provided for interface consistency
    // Actual implementation should route through mail-notifier API
    return {
      success: false,
      error: 'Not implemented',
      message: 'Mailcow unseen count is handled by mail-notifier service'
    };
  }

  /**
   * Configure email proxy for a user
   * @param {number} userId - User ID
   * @param {string} personalEmail - User's personal email address
   * @param {string} username - Username
   * @param {boolean} enableProxy - Whether to enable or disable proxy
   * @returns {Promise<Object>}
   */
  async configureProxy(userId, personalEmail, username, enableProxy = true) {
    return await this.mailboxProxyConfig.configureUserProxy(userId, personalEmail, username, enableProxy);
  }

  /**
   * Delete a mailbox/user account
   * @param {string} email
   * @returns {Promise<Object>}
   */
  async deleteMailbox(email) {
    try {
      if (!this.mailcowClient.isConfigured()) {
        return { success: false, error: 'Mailcow client not configured' };
      }

      const mailboxResult = await this.mailcowClient.getMailbox(email);
      if (!mailboxResult.success) {
        return { success: true, message: `Mailbox not found (may already be deleted): ${email}` };
      }

      const mailboxId = mailboxResult.mailbox?.id || mailboxResult.mailbox?.username || email;
      const deleteResult = await this.mailcowClient.http.post('/v1/delete/mailbox', [mailboxId], { validateStatus: () => true });

      if (deleteResult.status >= 200 && deleteResult.status < 300) {
        return { success: true, message: `Mailbox deleted: ${email}` };
      }
      return { success: false, error: `Mailbox deletion failed: HTTP ${deleteResult.status}`, status: deleteResult.status };
    } catch (error) {
      return { success: false, error: error.message || 'Failed to delete mailbox' };
    }
  }
}

module.exports = new MailcowService();

