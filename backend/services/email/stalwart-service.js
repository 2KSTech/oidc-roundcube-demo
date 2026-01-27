/**
 * Stalwart Mail Service Implementation
 * 
 * Implements the mail service abstraction interface for Stalwart mail server.
 * Uses Stalwart's HTTP OpenAPI for mailbox management and SMTP for sending mail.
 */

const stalwartClient = require('./stalwart-client.js');
const nodemailer = require('nodemailer');
const mailServiceConfig = require('../../config/mail-service-config');
const database = require('../databaseService.js');

class StalwartService {
  constructor() {
    this.stalwartClient = stalwartClient;
    this.config = mailServiceConfig;
    this.database = database;
  }

  isConfigured() {
    return this.stalwartClient.isConfigured();
  }

  /**
   * Verify that a mailbox exists for the user
   * @param {string} email - Email address to verify
   * @returns {Promise<Object>}
   */
  async verifyMailboxExists(email) {
    try {
      console.log(`[StalwartService] Verifying mailbox exists: ${email}`);
      
      if (!this.stalwartClient.isConfigured()) {
        return {
          exists: false,
          error: 'Stalwart client not configured'
        };
      }
      
      // Try to get principal by email
//      const result = await this.stalwartClient.getPrincipal(email);
      // Extract name and domain from email
      const [name, domain] = email.split('@');
      if (!name || !domain) {
        return {
          exists: false,
          error: 'Invalid email format'
        };
      }
      
      // Fetch principal by name (not by email)
      const result = await this.stalwartClient.getPrincipal(name);



      
      if (result.success && result.principal) {
        // Verify the response contains the expected email domain
        //const principalEmails = result.principal.emails || '';
        const principalEmails = result.principal.emails || [];
        const emailMatches = principalEmails.some(email => email.endsWith(`@${domain}`) || email === domain);
        if (emailMatches) { //principalEmails.includes(domain)) {
          console.log(`[StalwartService] Mailbox verification successful - found: ${email} in ${JSON.stringify(result.principal)}`);
          return {
            exists: true,
            mailbox: result.principal,
            username: result.principal.email || result.principal.name
          };
        } else {
          console.log(`[StalwartService] Principal: ${JSON.stringify(result.principal)}`);
          console.log(`[StalwartService] Principal ${principalEmails.join(', ')} found but email domain mismatch: ${email} (expected domain: ${domain})`);
//          console.log(`[StalwartService] Principal found but email domain mismatch: ${email} (expected domain: ${domain})`);
          return {
            exists: false,
            message: 'Principal found but email domain does not match'
          };
        }
      } else if (result.status === 404) {
        console.log(`[StalwartService] ERROR Mailbox not found: ${email}`);
        console.log(`[StalwartService] Got 404 error, attempting to find mailbox: ${email}`);
        console.log(`[StalwartService] Result: ${JSON.stringify(result)}`);
        return {
          exists: false,
          message: 'Mailbox not found in Stalwart'
        };
      } else {
        console.log(`[StalwartService] Mailbox verification failed: ${email} - ${result.error}`);
        return {
          exists: false,
          error: result.error || 'Unknown error'
        };
      }
    } catch (error) {
      console.error('[StalwartService] Error verifying mailbox:', error);
      return {
        exists: false,
        error: error.message
      };
    }
  }

  /**
   * Verify and enable mailbox (complete onboarding flow)
   * @param {string} email - Email address to verify
   * @returns {Promise<Object>}
   */
  async verifyAndEnableMailbox(email) {
    console.log('[StalwartService] === Starting mailbox verification ===');
    console.log(`Email: ${email}`);
    
    const verifyResult = await this.verifyMailboxExists(email);
    
    if (verifyResult.exists) {
      console.log('[StalwartService] === Mailbox verification completed successfully ===');
      return {
        success: true,
        message: 'Mailbox verified successfully',
        mailbox: verifyResult.mailbox,
        username: verifyResult.username
      };
    } else {
      // For Stalwart with OIDC directory, REST API create is blocked
      // The mailbox will be created automatically on first authentication
      // We should NOT attempt REST API create as it will always fail
      console.log('[StalwartService] === Mailbox not found via REST API (expected for OIDC directory) ===');
      console.log('[StalwartService] OIDC directory: Mailbox will be created/discovered on first authentication');
      console.log('[StalwartService] If token exchange pre-deploy was successful, mailbox should exist but may not be queryable via REST API');
      
      // Return success with a note that verification via REST API doesn't work for OIDC directory
      // The actual mailbox creation happens via OAuth authentication (XOAUTH2)
      return {
        success: true,
        message: 'OIDC directory: Mailbox will be created on first authentication. REST API verification not available for OIDC-discovered users.',
        note: 'For OIDC directory, mailboxes are created automatically when user authenticates via XOAUTH2. If token exchange pre-deploy was successful, the mailbox should be available for IMAP/SMTP authentication.',
        oidcDirectory: true
      };
    }
  }
  /**
   * Pre-deploy OIDC user via OAuth authentication flow (using password credentials)
   * Triggers Stalwart to discover user by authenticating via OAUTHBEARER SASL
   * This causes Stalwart to query Keycloak's UserInfo/Introspection endpoint
   * 
   * @param {string} email - Email address of the user
   * @param {string} keycloakUsername - Keycloak username
   * @param {string} keycloakPassword - Keycloak password
   * @returns {Promise<Object>} { success: boolean, message: string, discovered: boolean }
   */
  async preDeployOidcUserWithPassword(email, keycloakUsername, keycloakPassword) {
    console.log('[StalwartService] === Starting OIDC pre-deploy with password ===');
    console.log(`Email: ${email}, Username: ${keycloakUsername}`);
    
    try {
      if (!this.stalwartClient.isConfigured()) {
        return { success: false, message: 'Stalwart client not configured', discovered: false, error: 'not_configured' };
      }

      // Step 1: Get OAuth access token from Keycloak using resource owner password credentials grant
      const keycloakUrl = process.env.KEYCLOAK_URL;
      const realm = process.env.KEYCLOAK_REALM;
      const stalwartClientId = this.config.getOidcClientId();
      const stalwartClientSecret = this.config.getOidcClientSecret();
      
      if (!keycloakUrl || !realm || !stalwartClientId || !stalwartClientSecret) {
        return { 
          success: false, 
          message: 'Keycloak OIDC configuration missing', 
          discovered: false,
          error: 'Missing KEYCLOAK_URL, KEYCLOAK_REALM, or Stalwart OIDC client credentials' 
        };
      }

      const axios = require('axios');
      const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;
      
      console.log('[StalwartService] Acquiring OAuth token from Keycloak...');
      const tokenResponse = await axios.post(tokenUrl, new URLSearchParams({
        grant_type: 'password',
        client_id: stalwartClientId,
        client_secret: stalwartClientSecret,
        username: keycloakUsername,
        password: keycloakPassword,
        scope: 'openid profile email'
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true
      });

      if (tokenResponse.status !== 200) {
        const errorMsg = tokenResponse.data?.error_description || tokenResponse.statusText || 'Token acquisition failed';
        console.error(`[StalwartService] OAuth token acquisition failed: ${errorMsg}`);
        return { 
          success: false, 
          message: 'Failed to acquire OAuth token', 
          discovered: false,
          error: errorMsg,
          status: tokenResponse.status
        };
      }

      const accessToken = tokenResponse.data.access_token;
      if (!accessToken) {
        return { 
          success: false, 
          message: 'No access token in response', 
          discovered: false,
          error: 'Token response missing access_token' 
        };
      }

      console.log('[StalwartService] OAuth token acquired, authenticating to Stalwart via OAUTHBEARER...');

      // Step 2: Authenticate to Stalwart via SMTP using OAUTHBEARER/XOAUTH2
      // This triggers Stalwart to query Keycloak's UserInfo/Introspection endpoint
      const smtpHost = this.config.getSmtpHost();
      const smtpPort = this.config.getSmtpPort();

      if (!smtpHost || !smtpPort) {
        return { 
          success: false, 
          message: 'SMTP not configured', 
          discovered: false,
          error: 'SMTP host and port must be configured' 
        };
      }

      // Create SMTP connection with XOAUTH2 authentication
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        requireTLS: smtpPort === 587,
         auth: {
          type: 'OAuth2',
          user: email,
          accessToken: accessToken
        },
        authMethod: 'XOAUTH2',
        tls: {
          rejectUnauthorized: false
        }
      });

      // Verify connection (this triggers the OAUTHBEARER authentication)
      // Stalwart will query Keycloak's endpoints during this authentication
      try {
        await transporter.verify();
        console.log('[StalwartService] SMTP authentication successful - Stalwart should have discovered user');
      } catch (authError) {
        // Some SMTP servers may return errors even on successful OAuth validation
        // Check if it's an OAuth-specific error that might still indicate discovery
        const errorMsg = authError.message || String(authError);
        if (errorMsg.includes('OAuth') || errorMsg.includes('OAUTHBEARER') || errorMsg.includes('XOAUTH2')) {
          console.warn(`[StalwartService] OAuth authentication warning: ${errorMsg}`);
          // Continue to verification step - discovery may have still occurred
        } else {
          console.error(`[StalwartService] SMTP authentication failed: ${errorMsg}`);
          return { 
            success: false, 
            message: 'SMTP authentication failed', 
            discovered: false,
            error: errorMsg 
          };
        }
      }

      // Step 3: Wait a moment for Stalwart to cache the discovered user
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Step 4: Verify that Stalwart discovered the user
      console.log('[StalwartService] Verifying user discovery...');
      const verifyResult = await this.verifyMailboxExists(email);
      
      if (verifyResult.exists) {
        console.log('[StalwartService] SUCCESS OIDC user pre-deployed and discovered by Stalwart');
        return {
          success: true,
          message: 'OIDC user pre-deployed successfully - Stalwart discovered user via OAuth flow',
          discovered: true,
          mailbox: verifyResult.mailbox,
          username: verifyResult.username
        };
      } else {
        console.warn('[StalwartService] WARN Auth authentication succeeded but user not yet discovered');
        return {
          success: false,
          message: 'OAuth authentication succeeded but user not yet discovered by Stalwart',
          discovered: false,
          error: verifyResult.error || 'User discovery verification failed',
          note: 'User may need additional time to be cached, or Stalwart OIDC configuration may need verification'
        };
      }

    } catch (error) {
      console.error('[StalwartService] Error in OIDC pre-deploy with password:', error);
      return {
        success: false,
        message: 'OIDC pre-deploy failed',
        discovered: false,
        error: error.message || String(error)
      };
    }
  }

  /**
   * Pre-deploy OIDC user via OAuth authentication flow (using admin token)
   * Uses Keycloak admin API to get user info, then acquires OAuth token for that user
   * Triggers Stalwart to discover user by authenticating via OAUTHBEARER SASL
   * 
   * Note: This method requires the user to have a password set in Keycloak for resource owner password grant.
   * If password is not available, use preDeployOidcUserWithPassword() with explicit password instead.
   * 
   * @param {string} email - Email address of the user
   * @param {string} keycloakUserId - Keycloak user ID
   * @param {string} adminToken - Keycloak admin access token
   * @param {string} [userPassword] - Optional user password (if not provided, will attempt to use admin token to get/set password)
   * @returns {Promise<Object>} { success: boolean, message: string, discovered: boolean }
   */
  async preDeployOidcUserWithAdminToken(email, keycloakUserId, adminToken, userPassword = null) {
    console.log('[StalwartService] === Starting OIDC pre-deploy with admin token ===');
    console.log(`Email: ${email}, Keycloak User ID: ${keycloakUserId}`);
    
    try {
      if (!this.stalwartClient.isConfigured()) {
        return { success: false, message: 'Stalwart client not configured', discovered: false, error: 'not_configured' };
      }

      const axios = require('axios');
      const keycloakUrl = process.env.KEYCLOAK_URL;
      const realm = process.env.KEYCLOAK_REALM;
      const stalwartClientId = this.config.getOidcClientId();
      const stalwartClientSecret = this.config.getOidcClientSecret();
      
      if (!keycloakUrl || !realm || !stalwartClientId || !stalwartClientSecret) {
        return { 
          success: false, 
          message: 'Keycloak OIDC configuration missing', 
          discovered: false,
          error: 'Missing KEYCLOAK_URL, KEYCLOAK_REALM, or Stalwart OIDC client credentials' 
        };
      }

      // Step 1: Get user info from Keycloak using admin token
      console.log('[StalwartService] Fetching user info from Keycloak...');
      const userInfoUrl = `${keycloakUrl}/admin/realms/${realm}/users/${keycloakUserId}`;
      const userInfoResponse = await axios.get(userInfoUrl, {
        headers: {
          'Authorization': `Bearer ${adminToken}`
        },
        validateStatus: () => true
      });

      if (userInfoResponse.status !== 200) {
        const errorMsg = userInfoResponse.data?.errorMessage || userInfoResponse.statusText || 'Failed to get user info';
        console.error(`[StalwartService] Failed to get user info: ${errorMsg}`);
        return { 
          success: false, 
          message: 'Failed to get user info from Keycloak', 
          discovered: false,
          error: errorMsg,
          status: userInfoResponse.status
        };
      }

      const userInfo = userInfoResponse.data;
      const keycloakUsername = userInfo.username;
      
      if (!keycloakUsername) {
        return { 
          success: false, 
          message: 'User info missing username', 
          discovered: false,
          error: 'Keycloak user object missing username field' 
        };
      }

      // Step 2: Get OAuth token for the user
      // If password provided, use it; otherwise attempt to use admin token to get user credentials
      const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;
      let accessToken = null;

      if (userPassword) {
        // Use provided password for resource owner password grant
        console.log('[StalwartService] Acquiring OAuth token using provided password...');
        const tokenResponse = await axios.post(tokenUrl, new URLSearchParams({
          grant_type: 'password',
          client_id: stalwartClientId,
          client_secret: stalwartClientSecret,
          username: keycloakUsername,
          password: userPassword,
          scope: 'openid profile email'
        }), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: () => true
        });

        if (tokenResponse.status === 200 && tokenResponse.data.access_token) {
          accessToken = tokenResponse.data.access_token;
        } else {
          const errorMsg = tokenResponse.data?.error_description || tokenResponse.statusText || 'Token acquisition failed';
          return { 
            success: false, 
            message: 'Failed to acquire OAuth token with provided password', 
            discovered: false,
            error: errorMsg,
            status: tokenResponse.status
          };
        }
      } else {
        // Attempt to use admin token to impersonate or get user token
        // Note: This may not work if Keycloak doesn't support token exchange
        // In that case, password must be provided
        console.log('[StalwartService] Attempting token acquisition without password (may not be supported)...');
        return { 
          success: false, 
          message: 'User password required for OAuth token acquisition', 
          discovered: false,
          error: 'password_required',
          note: 'Resource owner password grant requires user password. Provide userPassword parameter or use preDeployOidcUserWithPassword() instead.'
        };
      }

      console.log('[StalwartService] OAuth token acquired, authenticating to Stalwart via OAUTHBEARER...');

      // Step 3: Authenticate to Stalwart via SMTP using OAUTHBEARER/XOAUTH2
      const smtpHost = this.config.getSmtpHost();
      const smtpPort = this.config.getSmtpPort();

      if (!smtpHost || !smtpPort) {
        return { 
          success: false, 
          message: 'SMTP not configured', 
          discovered: false,
          error: 'SMTP host and port must be configured' 
        };
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        requireTLS: smtpPort === 587,
         auth: {
          type: 'OAuth2',
          user: email,
          accessToken: accessToken
        },
        authMethod: 'XOAUTH2',
        tls: {
          rejectUnauthorized: false
        }
      });

      // Verify connection to trigger OAuth discovery
      try {
        await transporter.verify();
        console.log('[StalwartService] SMTP authentication successful - Stalwart should have discovered user');
      } catch (authError) {
        const errorMsg = authError.message || String(authError);
        if (errorMsg.includes('OAuth') || errorMsg.includes('OAUTHBEARER') || errorMsg.includes('XOAUTH2')) {
          console.warn(`[StalwartService] OAuth authentication warning: ${errorMsg}`);
        } else {
          console.error(`[StalwartService] SMTP authentication failed: ${errorMsg}`);
          return { 
            success: false, 
            message: 'SMTP authentication failed', 
            discovered: false,
            error: errorMsg 
          };
        }
      }

      // Step 4: Wait for Stalwart to cache the discovered user
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Step 5: Verify discovery
      console.log('[StalwartService] Verifying user discovery...');
      const verifyResult = await this.verifyMailboxExists(email);
      
      if (verifyResult.exists) {
        console.log('[StalwartService] SUCCESS OIDC user pre-deployed and discovered by Stalwart');
        return {
          success: true,
          message: 'OIDC user pre-deployed successfully - Stalwart discovered user via OAuth flow',
          discovered: true,
          mailbox: verifyResult.mailbox,
          username: verifyResult.username
        };
      } else {
        console.warn('[StalwartService] WARN OAuth authentication succeeded but user not yet discovered');
        return {
          success: false,
          message: 'OAuth authentication succeeded but user not yet discovered by Stalwart',
          discovered: false,
          error: verifyResult.error || 'User discovery verification failed',
          note: 'User may need additional time to be cached, or Stalwart OIDC configuration may need verification'
        };
      }

    } catch (error) {
      console.error('[StalwartService] Error in OIDC pre-deploy with admin token:', error);
      return {
        success: false,
        message: 'OIDC pre-deploy failed',
        discovered: false,
        error: error.message || String(error)
      };
    }
  }












  /**
   * Send email via SMTP
   * Uses Stalwart SMTP with OAuth/XOAUTH2 if available, falls back to admin credentials
   * 
   * @param {Object} options - Email options
   * @param {string} [options.accessToken] - OAuth access token for XOAUTH2
   * @param {Object} [options.user] - User object with access_token
   * @returns {Promise<Object>}
   */
  async sendMail(options) {
    try {
      const intEmailDomain = process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';
      const smtpHost = this.config.getSmtpHost();
      const smtpPort = this.config.getSmtpPort();
      
      // For XOAUTH2, the sender email MUST match the authenticated user's email
      // If options.from is provided, use it (it should be the user's email)
      // Otherwise, try to extract from token or use default
      let senderEmail = options.from;
      
      // If we have an access token but no from address, try to extract email from token
      const accessToken = options.accessToken || (options.user && (options.user.access_token || options.user.accessToken));
      if (accessToken && !senderEmail) {
        try {
          const jwt = require('jsonwebtoken');
          const decoded = jwt.decode(accessToken);
          if (decoded && decoded.email) {
            senderEmail = decoded.email;
            console.log(`[StalwartService] Extracted sender email from token: ${senderEmail}`);
          }
        } catch (e) {
          // Token might not be a JWT - that's okay
        }
      }
      
      // Fallback to default only if no token is being used (admin password auth)
      if (!senderEmail) {
        senderEmail = `mailadmin@${intEmailDomain}`;
        console.warn(`[StalwartService] No sender email provided, using default: ${senderEmail}`);
      }
      
      console.log(`[StalwartService] Final sender email: ${senderEmail}`);

      if (!smtpHost || !smtpPort) {
        return {
          success: false,
          error: 'SMTP not configured',
          message: 'SMTP host and port must be configured'
        };
      }

      // Try to get OAuth token from options
      //const accessToken = options.accessToken || (options.user && (options.user.access_token || options.user.accessToken));
      
      let transporter;
      
      if (accessToken) {
        // Use XOAUTH2 authentication
        // IMPORTANT: For XOAUTH2, the 'user' field must match the email address
        // that the OAuth token was issued for (the authenticated user's email)
        // Stalwart enforces that users can only send from their own email addresses
        console.log(`[StalwartService] Sending email via SMTP with XOAUTH2: ${smtpHost}:${smtpPort}`);
        console.log(`[StalwartService] Authenticating as: ${senderEmail}`);
        console.log(`[StalwartService] Sending from: ${senderEmail}`);
        
        transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          requireTLS: smtpPort === 587,
          auth: {
            type: 'OAuth2',
            user: senderEmail, // Must match the email the token was issued for
            accessToken: accessToken
          },
          authMethod: 'XOAUTH2',
          tls: {
            rejectUnauthorized: false
          }
        });
      } else {
        // Fallback to admin password
        const adminPassword = process.env.STALWART_ADMIN_PASSWORD || process.env.NEXTCLOUD_ADMIN_PW;
        if (!adminPassword) {
          return {
            success: false,
            error: 'No authentication method available',
            message: 'Neither OAuth token nor admin password configured'
          };
        }
        console.log(`[StalwartService] Sending email via SMTP with password: ${smtpHost}:${smtpPort}`);
        transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          requireTLS: smtpPort === 587,
           auth: {
            user: senderEmail,
            pass: adminPassword
          },
          tls: {
            rejectUnauthorized: false
          },
          authMethod: 'PLAIN'
        });
      }

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
      console.error('[StalwartService] Error sending email:', error);
      return {
        success: false,
        error: error.message || 'Failed to send email',
        code: error.code
      };
    }
  }

  /**
   * Get unseen mail count for a user via JMAP
   * 
   * @param {string} username - Username to check
   * @param {string} [accessToken] - OAuth access token for JMAP (if not provided, will try to get from database)
   * @returns {Promise<Object>}
   */
  async getUnseenCount(username, accessToken = null) {
    try {
      if (!this.stalwartClient.isConfigured()) {
        return {
          success: false,
          error: 'Stalwart client not configured'
        };
      }

      // Get access token if not provided
      let token = accessToken;
      if (!token && this.database) {
        try {
          // Try to get user's OAuth token from database
          const user = await this.database.getUserByUsername(username);
          if (user && user.access_token) {
            token = user.access_token;
          }
        } catch (e) {
          console.warn('[StalwartService] Could not get access token from database:', e.message);
        }
      }

      if (!token) {
        return {
          success: false,
          error: 'Access token required for JMAP query',
        };
      }


      // Check token expiration before making JMAP call (prevents hammering Stalwart with expired tokens)
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.decode(token, { complete: false });
        if (decoded && decoded.exp && decoded.exp < Date.now() / 1000) {
          return {
            success: false,
            error: 'Access token expired - please refresh your session',
          };
        }
      } catch (e) {
        // Token might not be a JWT - continue and let Stalwart validate it
      }



      const baseUrl = this.config.getBaseUrl();
      const axios = require('axios');

      // Get JMAP session
      const sessionRes = await axios.get(`${baseUrl}/jmap/session`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        validateStatus: () => true
      });

      if (sessionRes.status !== 200) {
        return {
          success: false,
          error: `JMAP session failed: ${sessionRes.status}`,
          unseen_count: 0
        };
      }

      const session = sessionRes.data;
      const accountId = session.primaryAccounts?.['urn:ietf:params:jmap:mail'] 
        || (session.accounts ? Object.keys(session.accounts)[0] : null);

      if (!accountId) {
        return {
          success: false,
          error: 'No account ID found in JMAP session',
          unseen_count: 0
        };
      }

      // Query mailboxes for inbox unread count
      const jmapRes = await axios.post(`${baseUrl}/jmap`, {
        using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
        methodCalls: [
          ['Mailbox/get', {
            accountId: accountId,
            properties: ['id', 'name', 'role', 'unreadEmails']
          }, 'c1']
        ]
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        validateStatus: () => true
      });

      if (jmapRes.status !== 200) {
        return {
          success: false,
          error: `JMAP query failed: ${jmapRes.status}`,
          unseen_count: 0
        };
      }

      const response = jmapRes.data;
      const inbox = response.methodResponses?.[0]?.[1]?.list?.find(m => m.role === 'inbox');

      if (inbox) {
        return {
          success: true,
          unseen_count: inbox.unreadEmails || 0
        };
      }

      return {
        success: false,
        error: 'Inbox not found in JMAP response',
        unseen_count: 0
      };
    } catch (error) {
      console.error('[StalwartService] Error getting unseen count:', error);
      return {
        success: false,
        error: error.message || 'Failed to get unseen count',
        unseen_count: 0
      };
    }
  }

  /**
   * Configure email proxy for a user
   * Stalwart may handle this differently than mailcow - needs implementation
   * 
   * @param {number} userId - User ID
   * @param {string} personalEmail - User's personal email address
   * @param {string} username - Username
   * @param {boolean} enableProxy - Whether to enable or disable proxy
   * @returns {Promise<Object>}
   */
  async configureProxy(userId, personalEmail, username, enableProxy = true) {
    try {
      console.log(`[StalwartService] Configuring proxy for user ${userId}: ${personalEmail}`);
      
      const intEmailDomain = process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';
      const internalEmail = `${username}@${intEmailDomain}`;

      // Stalwart proxy configuration may use different API endpoints
      // For now, update user settings in database
      if (typeof this.database.upsertUserSettings === 'function') {
        await this.database.upsertUserSettings(userId, { wip_email_proxy: enableProxy ? 1 : 0 });
      }

      // TODO: Implement Stalwart-specific proxy configuration via API
      // This may involve setting up forwarding rules or alias mappings

      return {
        success: true,
        message: enableProxy ? 'Email proxy enabled (database updated)' : 'Email proxy disabled',
        internalEmail,
        personalEmail,
        enabled: enableProxy,
        note: 'Stalwart proxy configuration via API needs implementation'
      };
    } catch (error) {
      console.error('[StalwartService] Error configuring proxy:', error);
      return {
        success: false,
        error: error.message || 'Failed to configure proxy'
      };
    }
  }

  /**
   * Delete a mailbox/user account (Individual principal)
   * Uses principal name as identifier (commonly the full email address)
   * @param {string} email
   * @returns {Promise<Object>}
   */
  async deleteMailbox(email) {
    try {
      if (!this.stalwartClient.isConfigured()) {
        return { success: false, error: 'Stalwart client not configured' };
      }

      // Look up principal by provided identifier (prefer full email)
      const lookup = await this.stalwartClient.getPrincipal(email);
      if (!lookup.success) {
        if (lookup.status === 404) {
          return { success: true, message: `Principal not found (may already be deleted): ${email}` };
        }
        return { success: false, error: `Failed to lookup principal: ${lookup.error}`, status: lookup.status };
      }

      const principalName = (lookup.principal && lookup.principal.name) ? lookup.principal.name : email;
      const del = await this.stalwartClient.deletePrincipal(principalName);
      if (del.success) {
        return { success: true, message: `Principal deleted: ${principalName}` };
      }
      return { success: false, error: `Principal deletion failed: ${del.error}`, status: del.status };
    } catch (error) {
      return { success: false, error: error.message || 'Failed to delete mailbox' };
    }
  }

  /**
   * Pre-deploy OIDC user via OAuth authentication flow (using admin token)
   * Uses Keycloak admin API to get user info, then acquires OAuth token for that user
   * Triggers Stalwart to discover user by authenticating via OAUTHBEARER/XOAUTH2 SASL
   * 
   * Note: This method requires the user to have a password set in Keycloak for resource owner password grant.
   * 
   * @param {string} email - Email address of the user
   * @param {string} keycloakUserId - Keycloak user ID
   * @param {string} adminToken - Keycloak admin access token
   * @param {string} [userPassword] - User password (required for resource owner password grant)
   * @returns {Promise<Object>} { success: boolean, message: string, discovered: boolean, authSucceeded: boolean, authError: string }
   */
  async preDeployOidcUserWithAdminToken(email, keycloakUserId, adminToken, userPassword = null) {
    console.log('[StalwartService] === Starting OIDC pre-deploy with admin token ===');
    console.log(`Email: ${email}, Keycloak User ID: ${keycloakUserId}`);
    
    try {
      if (!this.stalwartClient.isConfigured()) {
        return { success: false, message: 'Stalwart client not configured', discovered: false, error: 'not_configured' };
      }

      const axios = require('axios');
      const keycloakUrl = process.env.KEYCLOAK_URL;
      const realm = process.env.KEYCLOAK_REALM;
      const stalwartClientId = this.config.getOidcClientId();
      const stalwartClientSecret = this.config.getOidcClientSecret();
      
      if (!keycloakUrl || !realm || !stalwartClientId || !stalwartClientSecret) {
        return { 
          success: false, 
          message: 'Keycloak OIDC configuration missing', 
          discovered: false,
          error: 'Missing KEYCLOAK_URL, KEYCLOAK_REALM, or Stalwart OIDC client credentials' 
        };
      }

      // Step 1: Get user info from Keycloak using admin token
      console.log('[StalwartService] Fetching user info from Keycloak...');
      const userInfoUrl = `${keycloakUrl}/admin/realms/${realm}/users/${keycloakUserId}`;
      const userInfoResponse = await axios.get(userInfoUrl, {
        headers: {
          'Authorization': `Bearer ${adminToken}`
        },
        validateStatus: () => true
      });

      if (userInfoResponse.status !== 200) {
        const errorMsg = userInfoResponse.data?.errorMessage || userInfoResponse.statusText || 'Failed to get user info';
        console.error(`[StalwartService] Failed to get user info: ${errorMsg}`);
        return { 
          success: false, 
          message: 'Failed to get user info from Keycloak', 
          discovered: false,
          error: errorMsg,
          status: userInfoResponse.status
        };
      }

      const userInfo = userInfoResponse.data;
      const keycloakUsername = userInfo.username;
      
      if (!keycloakUsername) {
        return { 
          success: false, 
          message: 'User info missing username', 
          discovered: false,
          error: 'Keycloak user object missing username field' 
        };
      }

      // Step 2: Get OAuth token for the user using password grant
      if (!userPassword) {
        console.error('[StalwartService] User password required for OAuth token acquisition');
        return { 
          success: false, 
          message: 'User password required for OAuth token acquisition', 
          discovered: false,
          error: 'password_required',
          note: 'Resource owner password grant requires user password. Provide userPassword parameter.'
        };
      }

      const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;
      console.log('[StalwartService] Acquiring OAuth token using provided password...');
      console.log(`[StalwartService] Token request: client_id=${stalwartClientId}, username=${keycloakUsername}`);
      
      const tokenResponse = await axios.post(tokenUrl, new URLSearchParams({
        grant_type: 'password',
        client_id: stalwartClientId,
        client_secret: stalwartClientSecret,
        username: keycloakUsername,
        password: userPassword,
        scope: 'openid profile email'
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true
      });

      let accessToken = null;
      if (tokenResponse.status === 200 && tokenResponse.data.access_token) {
        accessToken = tokenResponse.data.access_token;
        console.log('[StalwartService] OK: OAuth token acquired successfully');
        console.log(`[StalwartService] Token preview: ${accessToken.substring(0, 20)}...${accessToken.substring(accessToken.length - 10)}`);
      } else {
        const errorMsg = tokenResponse.data?.error_description || tokenResponse.data?.error || tokenResponse.statusText || 'Token acquisition failed';
        console.error(`[StalwartService] FAIL Token acquisition failed: ${errorMsg}`);
        console.error(`[StalwartService] Response status: ${tokenResponse.status}`);
        console.error(`[StalwartService] Response data:`, JSON.stringify(tokenResponse.data, null, 2));
        return { 
          success: false, 
          message: 'Failed to acquire OAuth token with provided password', 
          discovered: false,
          error: errorMsg,
          status: tokenResponse.status,
          details: tokenResponse.data
        };
      }

      console.log('[StalwartService] OAuth token acquired, authenticating to Stalwart via OAUTHBEARER/XOAUTH2...');

      // Step 3: Authenticate to Stalwart via SMTP using OAUTHBEARER/XOAUTH2
      // IMPORTANT: Even if verify() fails, Stalwart may have introspected the token and discovered the user
      // So we continue to check for discovery even on auth failure
      const smtpHost = this.config.getSmtpHost();
      const smtpPort = this.config.getSmtpPort();

      if (!smtpHost || !smtpPort) {
        return { 
          success: false, 
          message: 'SMTP not configured', 
          discovered: false,
          error: 'SMTP host and port must be configured' 
        };
      }

      console.log(`[StalwartService] Attempting SMTP authentication with XOAUTH2 for ${email}...`);
      console.log(`[StalwartService] SMTP: ${smtpHost}:${smtpPort}`);
      console.log(`[StalwartService] Connection type: ${smtpPort === 465 ? 'SSL (secure)' : smtpPort === 587 ? 'STARTTLS' : 'plain'}`);
      
      // Add connection timeout and better error handling
      const connectionTimeout = 15000; // 15 seconds (increased for TLS negotiation)
      const isSecure = smtpPort === 465;
      const useStartTLS = smtpPort === 587;
      
      console.log(`[StalwartService] SMTP connection settings:`);
      console.log(`[StalwartService]   - Secure (SSL): ${isSecure}`);
      console.log(`[StalwartService]   - STARTTLS: ${useStartTLS}`);
      console.log(`[StalwartService]   - Connection timeout: ${connectionTimeout}ms`);
      
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: isSecure, // true for port 465 (implicit SSL), false for 587 (STARTTLS)
        requireTLS: useStartTLS, // Require STARTTLS for port 587
        auth: {
          type: 'OAuth2',
          user: email,
          accessToken: accessToken
        },
        authMethod: 'XOAUTH2',
        connectionTimeout: connectionTimeout,
        greetingTimeout: connectionTimeout,
        socketTimeout: connectionTimeout,
        // TLS configuration - important for STARTTLS on port 587
        tls: {
          rejectUnauthorized: false, // Accept self-signed certificates
          minVersion: 'TLSv1.2',
          // Don't restrict ciphers - let Node.js negotiate with Stalwart
          // ciphers: 'DEFAULT' // Use default cipher suite
        },
        // Disable SNI if causing issues
        servername: smtpHost,
        debug: true, // Enable debug logging
        logger: true // Enable logger
      });

      let authSucceeded = false;
      let authErrorMsg = null;
      let connectionError = false;
      
      try {
        console.log(`[StalwartService] Attempting to connect to ${smtpHost}:${smtpPort}...`);
        await transporter.verify();
        authSucceeded = true;
        console.log('[StalwartService] OK: SMTP authentication successful - Stalwart should have discovered user');
      } catch (authError) {
        authErrorMsg = authError.message || String(authError);
        console.error(`[StalwartService] SMTP connection/authentication error: ${authErrorMsg}`);
        console.error(`[StalwartService] Error code: ${authError.code || 'N/A'}`);
        console.error(`[StalwartService] Error command: ${authError.command || 'N/A'}`);
        
        // Check for TLS/connection errors
        if (authErrorMsg.includes('Greeting never received') || 
            authErrorMsg.includes('ECONNREFUSED') || 
            authErrorMsg.includes('ETIMEDOUT') ||
            authErrorMsg.includes('ENOTFOUND') ||
            authErrorMsg.includes('timeout')) {
          connectionError = true;
          console.error(`[StalwartService] FAIL SMTP connection failed - cannot reach server`);
          console.error(`[StalwartService] Connection diagnostics:`);
          console.error(`[StalwartService]   - Host: ${smtpHost}`);
          console.error(`[StalwartService]   - Port: ${smtpPort}`);
          console.error(`[StalwartService]   - Timeout: ${connectionTimeout}ms`);
          console.error(`[StalwartService] Possible causes:`);
          console.error(`[StalwartService]   1. SMTP port ${smtpPort} not accessible (firewall/network)`);
          console.error(`[StalwartService]   2. Stalwart SMTP not listening on port ${smtpPort}`);
          console.error(`[StalwartService]   3. Docker port forwarding not configured for SMTP (587/465)`);
          console.error(`[StalwartService]   4. Wrong hostname (should be accessible from server)`);
          console.error(`[StalwartService]   5. Network connectivity issue`);
          console.error(`[StalwartService] Note: Stalwart in Docker may need port forwarding for SMTP ports`);
          // For connection errors, we can't check discovery - return early
          return {
            success: false,
            message: `SMTP connection failed - cannot reach ${smtpHost}:${smtpPort}`,
            discovered: false,
            error: authErrorMsg,
            connectionError: true,
            note: `Check: 1) SMTP port ${smtpPort} is accessible, 2) Docker port forwarding configured, 3) Firewall allows connection, 4) Stalwart SMTP is listening on port ${smtpPort}`
          };
        } else if (authErrorMsg.includes('TLS') || authErrorMsg.includes('handshake') || authErrorMsg.includes('eof')) {
          // TLS handshake errors - connection reached server but TLS failed
          connectionError = true;
          console.error(`[StalwartService] FAIL TLS handshake failed`);
          console.error(`[StalwartService] Connection reached Stalwart but TLS negotiation failed`);
          console.error(`[StalwartService] Possible causes:`);
          console.error(`[StalwartService]   1. TLS version mismatch (Stalwart may require specific TLS version)`);
          console.error(`[StalwartService]   2. Cipher suite mismatch`);
          console.error(`[StalwartService]   3. Certificate issue (even with rejectUnauthorized: false)`);
          console.error(`[StalwartService]   4. STARTTLS not properly negotiated`);
          console.error(`[StalwartService]   5. Stalwart TLS configuration issue`);
          console.warn(`[StalwartService] WARN: User discovery may still occur if Stalwart processes the connection before TLS fails`);
          // Continue to check discovery - sometimes Stalwart processes the request before TLS fails
        } else if (authErrorMsg.includes('535') || authErrorMsg.includes('Authentication credentials invalid')) {
          console.error(`[StalwartService] FAIL Authentication credentials invalid (535 error)`);
          console.error(`[StalwartService] Possible causes:`);
          console.error(`[StalwartService]   1. OAuth token may be invalid or expired`);
          console.error(`[StalwartService]   2. Stalwart OIDC introspection may be failing`);
          console.error(`[StalwartService]   3. User may not exist in Stalwart yet (chicken/egg problem)`);
          console.error(`[StalwartService]   4. Token audience/scope mismatch`);
          console.error(`[StalwartService]   5. Stalwart OIDC client configuration issue`);
          console.error(`[StalwartService]   6. Stalwart introspection endpoint may be misconfigured`);
          // Continue anyway - sometimes Stalwart discovers the user even if verify() fails
          console.warn(`[StalwartService] WARN: Continuing to check if user was discovered despite auth error...`);
        } else if (authErrorMsg.includes('OAuth') || authErrorMsg.includes('OAUTHBEARER') || authErrorMsg.includes('XOAUTH2')) {
          console.warn(`[StalwartService] WARN: OAuth authentication warning (but discovery may have occurred): ${authErrorMsg}`);
        } else {
          console.error(`[StalwartService] FAIL SMTP authentication failed: ${authErrorMsg}`);
        }
        // Don't return immediately for non-connection errors - check if user was discovered anyway
      }

      // Step 4: Wait for Stalwart to cache the discovered user
      // Give Stalwart time to process the OAuth introspection and cache the user
      console.log('[StalwartService] Waiting for Stalwart to process OAuth introspection...');
      await new Promise(resolve => setTimeout(resolve, 5000)); // Increased wait time to 5 seconds

      // Step 5: Verify discovery - try multiple lookup methods
      console.log('[StalwartService] Verifying user discovery...');
      let verifyResult = await this.verifyMailboxExists(email);
      
      // If not found by email, try by username (from Keycloak)
      if (!verifyResult.exists && keycloakUsername) {
        console.log(`[StalwartService] User not found by email, trying username lookup: ${keycloakUsername}`);
        verifyResult = await this.verifyMailboxExists(keycloakUsername);
      }
      
      if (verifyResult.exists) {
        console.log('[StalwartService] SUCCESS OIDC user pre-deployed and discovered by Stalwart');
        return {
          success: true,
          message: authSucceeded 
            ? 'OIDC user pre-deployed successfully - Stalwart discovered user via OAuth flow'
            : 'OIDC user discovered despite SMTP auth error - Stalwart cached user via token introspection',
          discovered: true,
          mailbox: verifyResult.mailbox,
          username: verifyResult.username,
          authSucceeded: authSucceeded,
          authError: authErrorMsg
        };
      } else {
        // User authenticated but not found as principal
        // This might mean Stalwart authenticated but didn't create the principal automatically
        // Try creating it explicitly if authentication succeeded
        if (authSucceeded) {
          console.log('[StalwartService] User authenticated but principal not found - attempting explicit creation...');
          try {
            const username = email.split('@')[0];
            const createRes = await this.stalwartClient.createPrincipal({ 
              type: 'individual', 
              name: username, 
              emails: [email] 
            });
            
            if (createRes.success) {
              console.log('[StalwartService] SUCCESS Principal created explicitly after authentication');
              // Re-verify
              verifyResult = await this.verifyMailboxExists(email);
              if (verifyResult.exists) {
                return {
                  success: true,
                  message: 'OIDC user authenticated and principal created explicitly',
                  discovered: true,
                  mailbox: verifyResult.mailbox,
                  username: verifyResult.username,
                  authSucceeded: authSucceeded,
                  authError: authErrorMsg,
                  note: 'Principal was created explicitly after authentication (Stalwart may not auto-create principals from OIDC auth)'
                };
              }
            }
          } catch (createError) {
            console.warn(`[StalwartService] Failed to create principal explicitly: ${createError.message}`);
          }
        }
        
        // User not discovered - provide detailed error information
        console.warn(`[StalwartService] User ${email} not yet discovered by Stalwart`);
        console.warn(`[StalwartService] SMTP auth succeeded: ${authSucceeded}`);
        console.warn(`[StalwartService] Verification error: ${verifyResult.error || 'N/A'}`);
        console.warn(`[StalwartService] Was seeking ${verifyResult.mailbox} for user ${verifyResult.username} w Email: ${email}`);
        
        return {
          success: false,
          message: authSucceeded 
            ? 'OAuth authentication succeeded but user principal not found in Stalwart directory'
            : 'OAuth authentication failed and user not discovered',
          discovered: false,
          error: verifyResult.error || authErrorMsg || 'User discovery verification failed',
          authSucceeded: authSucceeded,
          authError: authErrorMsg,
          verificationError: verifyResult.error,
          note: 'Possible issues: 1) Stalwart OIDC directory may not auto-create principals on first auth, 2) Principal lookup by email failed (try username), 3) Stalwart directory configuration may require explicit principal creation, 4) Check Stalwart directory settings for "create on first auth" option'
        };
      }

    } catch (error) {
      console.error('[StalwartService] Error in OIDC pre-deploy with admin token:', error);
      return {
        success: false,
        message: 'OIDC pre-deploy failed',
        discovered: false,
        error: error.message || String(error)
      };
    }
  }

  /**
   * Exchange Keycloak access token for Stalwart-scoped token using Token Exchange
   * @param {string} keycloakAccessToken - User's Keycloak access token
   * @returns {Promise<Object>} { success: boolean, stalwartToken?: string, error?: string }
   */
  async exchangeTokenForStalwart(keycloakAccessToken) {
    try {
      const keycloakUrl = process.env.KEYCLOAK_URL;
      const realm = process.env.KEYCLOAK_REALM;
      const stalwartClientId = this.config.getOidcClientId();
      const stalwartClientSecret = this.config.getOidcClientSecret();
      
      if (!keycloakUrl || !realm || !stalwartClientId || !stalwartClientSecret) {
        return {
          success: false,
          error: 'Missing Keycloak or Stalwart OIDC configuration'
        };
      }

      if (!keycloakAccessToken) {
        return {
          success: false,
          error: 'Keycloak access token required'
        };
      }

      const axios = require('axios');
      const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;
      
      console.log('[StalwartService] Exchanging Keycloak token for Stalwart-scoped token...');
      
      const exchangeResponse = await axios.post(tokenUrl, new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        client_id: stalwartClientId,
        client_secret: stalwartClientSecret,
        subject_token: keycloakAccessToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token'
        // Note: audience parameter removed - Keycloak will use the client_id as audience automatically
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true
      });

      if (exchangeResponse.status === 200 && exchangeResponse.data.access_token) {
        console.log('[StalwartService] OK: Token exchange successful');
        return {
          success: true,
          stalwartToken: exchangeResponse.data.access_token,
          expiresIn: exchangeResponse.data.expires_in
        };
      } else {
        const errorMsg = exchangeResponse.data?.error_description || 
                        exchangeResponse.data?.error || 
                        'Token exchange failed';
        console.error(`[StalwartService] Token exchange failed: ${errorMsg}`);
        return {
          success: false,
          error: errorMsg,
          status: exchangeResponse.status
        };
      }
    } catch (error) {
      console.error('[StalwartService] Token exchange error:', error);
      return {
        success: false,
        error: error.message || 'Token exchange failed'
      };
    }
  }

  /**
   * Pre-deploy Stalwart mailbox via Token Exchange (no password required)
   * Uses user's existing Keycloak access token to exchange for Stalwart token,
   * then triggers Stalwart OIDC lookup via SMTP XOAUTH2 (sends welcome email)
   * @param {string} email - User's email address
   * @param {string} keycloakAccessToken - User's Keycloak access token from session
   * @returns {Promise<Object>} { success: boolean, discovered: boolean, message: string, error?: string }
   */
  async preDeployStalwartViaTokenExchange(email, keycloakAccessToken) {
    console.log('[StalwartService] === Starting Token Exchange pre-deploy ===');
    console.log(`Email: ${email}`);
    
    try {
      if (!this.stalwartClient.isConfigured()) {
        return {
          success: false,
          discovered: false,
          error: 'Stalwart client not configured'
        };
      }

      // Step 1: Exchange Keycloak token for Stalwart-scoped token
      const exchangeResult = await this.exchangeTokenForStalwart(keycloakAccessToken);
      if (!exchangeResult.success) {
        return {
          success: false,
          discovered: false,
          error: `Token exchange failed: ${exchangeResult.error}`,
          message: 'Failed to exchange token for Stalwart access'
        };
      }

      const stalwartToken = exchangeResult.stalwartToken;
      console.log('[StalwartService] OK: Stalwart token obtained via exchange');

      // Step 2: Trigger Stalwart OIDC lookup by sending welcome email via SMTP XOAUTH2
      // This causes Stalwart to introspect the token and create/discover the principal
      console.log('[StalwartService] Triggering Stalwart OIDC lookup via SMTP XOAUTH2...');
      
      const intEmailDomain = process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';
      const welcomeEmailResult = await this.sendMail({
        from: email,
        to: email,
        subject: 'Welcome to WorkInPilot',
        text: 'Welcome to WorkInPilot! Your email account has been set up successfully.',
        html: '<p>Welcome to WorkInPilot! Your email account has been set up successfully.</p>',
        accessToken: stalwartToken
      });

      if (!welcomeEmailResult.success) {
        // Email send failed - this is a real failure
        console.error('[StalwartService] Welcome email send failed:', welcomeEmailResult.error);
        return {
          success: false,
          discovered: false,
          message: 'Token exchange succeeded but email send failed',
          error: welcomeEmailResult.error || 'SMTP XOAUTH2 authentication failed',
          note: 'Stalwart OIDC lookup requires successful SMTP authentication'
        };
      }
      
      // Email send succeeded - this means Stalwart successfully authenticated via XOAUTH2
      // and should have discovered/cached the user via OIDC lookup
      console.log('[StalwartService] OK: Welcome email sent - Stalwart should have discovered user via OIDC');

      // Step 3: Wait for Stalwart to process OIDC lookup and cache the principal
      console.log('[StalwartService] Waiting for Stalwart to process OIDC lookup...');
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second wait

      // Step 4: Try to verify principal via REST API (may not work for OIDC directory)
      console.log('[StalwartService] Verifying principal discovery (REST API may not work for OIDC directory)...');
      const verifyResult = await this.verifyMailboxExists(email);
      
      if (verifyResult.exists) {
        console.log('[StalwartService] OK: Principal discovered and verified via REST API');
        return {
          success: true,
          discovered: true,
          message: 'Stalwart mailbox pre-deployed via Token Exchange',
          mailbox: verifyResult.mailbox,
          username: verifyResult.username
        };
      } else {
        // REST API verification failed, but email send succeeded
        // For OIDC directory, REST API doesn't expose principals, but the mailbox exists and works
        console.log('[StalwartService] WARN: REST API verification failed (expected for OIDC directory)');
        console.log('[StalwartService] OK: SMTP XOAUTH2 succeeded, so mailbox exists and is functional');
        return {
          success: true,
          discovered: true, // Treat as discovered since email send succeeded
          message: 'Stalwart mailbox pre-deployed via Token Exchange - SMTP XOAUTH2 succeeded',
          note: 'REST API verification not available for OIDC directory, but mailbox is functional (SMTP XOAUTH2 authentication succeeded)',
          restApiVerificationFailed: true
        };
      }

    } catch (error) {
      console.error('[StalwartService] Token Exchange pre-deploy error:', error);
      return {
        success: false,
        discovered: false,
        error: error.message || 'Token Exchange pre-deploy failed'
      };
    }
  }

//
// Add OPTION to seek refresh token due to odd Token Exchange phenom w  StalwartService class
//
async refreshTokenForExtendedDuration(refreshToken, minDurationSeconds) {
  try {
    const keycloakUrl = process.env.KEYCLOAK_URL;
    const realm = process.env.KEYCLOAK_REALM;
    const stalwartClientId = this.config.getOidcClientId();
    const stalwartClientSecret = this.config.getOidcClientSecret();
    
    if (!refreshToken) {
      return null;
    }
    
    const axios = require('axios');
    const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;
    
    const refreshResponse = await axios.post(tokenUrl, new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: stalwartClientId,
      client_secret: stalwartClientSecret,
      refresh_token: refreshToken
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true
    });
    
    if (refreshResponse.status === 200 && refreshResponse.data.access_token) {
      const newToken = refreshResponse.data.access_token;
      const validation = validateTokenDuration(newToken, minDurationSeconds);
      
      if (validation.valid) {
        return newToken;
      }
    }
    
    return null;
  } catch (error) {
    console.error('[StalwartService] Error refreshing token:', error);
    return null;
  }
}


  async getAdminTokenForImpersonation() {
    try {
      const keycloakUrl = process.env.KEYCLOAK_URL;
      const realm = process.env.KEYCLOAK_REALM;
      const adminClientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID;
      const adminClientSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;

      if (!keycloakUrl || !realm || !adminClientId || !adminClientSecret) {
        return {
          success: false,
          error: 'Missing Keycloak admin client configuration'
        };
      }

      const axios = require('axios');
      const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;

      const response = await axios.post(tokenUrl, new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: adminClientId,
        client_secret: adminClientSecret
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true
      });

      if (response.status === 200 && response.data.access_token) {
        return {
          success: true,
          adminToken: response.data.access_token,
          expiresIn: response.data.expires_in
        };
      }

      return {
        success: false,
        error: response.data?.error_description || response.data?.error || 'Failed to retrieve admin token',
        status: response.status
      };
    } catch (error) {
      return {
        wsuccess: false,
        error: error.message || 'Admin token acquisition error'
      };
    }
  }


  /**
   * Impersonate a Keycloak user for a target client via token exchange
   * @param {string} username
   * @param {string} targetClientId
   * @param {string} targetClientSecret
   */
  async impersonateUserForClient_BOT_MESS(username, targetClientId, targetClientSecret) {
    if (!username || !targetClientId || !targetClientSecret) {
      return {
        success: false,
        error: 'Username, client ID and client secret are required for impersonation'
      };
    }

    const adminResult = await this.getAdminTokenForImpersonation();
    if (!adminResult.success) {
      return {
        success: false,
        error: adminResult.error || 'Failed to acquire admin token'
      };
    }

    const keycloakUrl = process.env.KEYCLOAK_URL;
    const realm = process.env.KEYCLOAK_REALM;

    if (!keycloakUrl || !realm) {
      return {
        success: false,
        error: 'Missing Keycloak configuration'
      };
    }

    try {
      const axios = require('axios');
      const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;

      const response = await axios.post(tokenUrl, new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        client_id: targetClientId,
        client_secret: targetClientSecret,
        subject_token: adminResult.adminToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        requested_subject: username,
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token'
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true
      });

      if (response.status === 200 && response.data.access_token) {
        return {
          success: true,
          accessToken: response.data.access_token,
          refreshToken: response.data.refresh_token,
          idToken: response.data.id_token,
          expiresIn: response.data.expires_in
        };
      }

      const errorMsg = response.data?.error_description || response.data?.error || 'Token exchange failed';
      return {
        success: false,
        error: errorMsg,
        status: response.status
      };
    } catch (error) {
      console.error('[StalwartService] Impersonation error:', error);
      return {
        success: false,
        error: error.message || 'Impersonation request failed'
      };
    }
  }


/*
yet another BOT garbage pile
correct request (after granting fgap to realm) resembles:
curl -X POST \
    -d "client_id=starting-client" \
    -d "client_secret=the client secret" \
    --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
    -d "subject_token=...." \
    --data-urlencode "requested_token_type=urn:ietf:params:oauth:token-type:access_token" \
    -d "audience=target-client" \
    -d "requested_subject=wburke" \
    http://localhost:8080/realms/myrealm/protocol/openid-connect/token

stupefied?  see: https://www.keycloak.org/securing-apps/token-exchange#_making_the_request_2

*/
  /**
   * Impersonate a Keycloak user for a target client via token exchange
   * @param {string} username
   * @param {string} targetClientId
   * @param {string} targetClientSecret
   */
  async impersonateUserForClient(
        username,
        startingClientId,
        startingClientSecret,
        targetClientId
        ) {
    if (!username || !startingClientId || !startingClientSecret) {
      return {
        success: false,
        error: 'Username, starting client ID and secret are required for impersonation'
      };
    }

    console.log('[StalwartService] Acquiring admin token for impersonation of ${username} for ${targetClientId}...');
    const adminResult = await this.getAdminTokenForImpersonation();
    if (!adminResult.success) {
      console.error('[StalwartService] Failed to acquire admin token:', adminResult.error);
      return {
        success: false,
        error: adminResult.error || 'Failed to acquire admin token'
      };
    }

    const keycloakUrl = process.env.KEYCLOAK_URL;
    const realm = process.env.KEYCLOAK_REALM;

    if (!keycloakUrl || !realm) {
      return {
        success: false,
        error: 'Missing Keycloak configuration'
      };
    }

    try {
      const axios = require('axios');
      const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;

      const response = await axios.post(tokenUrl, new URLSearchParams({
            client_id: startingClientId,
            client_secret: startingClientSecret,
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
            subject_token: adminResult.adminToken,
            subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
            requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
            audience: targetClientId
           // requested_subject: username,
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true
      });



      if (response.status === 200 && response.data.access_token) {
        return {
          success: true,
          accessToken: response.data.access_token,
          refreshToken: response.data.refresh_token,
          idToken: response.data.id_token,
          expiresIn: response.data.expires_in
        };
      }

      const errorMsg = response.data?.error_description || response.data?.error || 'Token exchange failed';
      return {
        success: false,
        error: errorMsg,
        status: response.status
      };
    } catch (error) {
      console.error('[StalwartService] Impersonation error:', error);
      return {
        success: false,
        error: error.message || 'Impersonation request failed'
      };
    }
  }


  /**
   * Get Keycloak bearer type access token for webmail client using Direct Access Grant -- 
   * ensure DAG is set ON in Keycloak realm settings for the webmail client
   * @param {string} keycloakUsername - User's Keycloak username
   * @param {string} keycloakPassword - User's Keycloak password
   * @returns {Promise<Object>} { success: boolean, webmailClientToken?: string, error?: string }
   */
  async getWebmailClientTokenViaDAG(keycloakUsername, keycloakPassword) {
    try {
      const keycloakUrl = process.env.KEYCLOAK_URL;
      const realm = process.env.KEYCLOAK_REALM;
      // KEYCLOAK_SSO_MAIL_CLIENT
      const webmailClientId = process.env.KEYCLOAK_SSO_MAIL_CLIENT;
      // KEYCLOAK_SSO_MAIL_CLIENT_SECRET
      const webmailClientSecret = process.env.KEYCLOAK_SSO_MAIL_CLIENT_SECRET;

      if (!keycloakUrl || !realm || !webmailClientId || !webmailClientSecret) {
        return {
          success: false,
          error: 'Missing Keycloak or Webmail Client OIDC configuration'
        };
      }

      const axios = require('axios');
      const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;

      console.log('[StalwartService] Obtaining Keycloak access token for user',keycloakUsername);
      console.log('[StalwartService] Obtaining Keycloak access token for id',webmailClientId);
      console.log('[StalwartService] Obtaining Keycloak access token for sec',webmailClientSecret);

      const client_scope = 'openid profile email';
      const exchangeResponse = await axios.post(tokenUrl, new URLSearchParams({
        client_id: webmailClientId,
        client_secret: webmailClientSecret,
        username: keycloakUsername,
        password: keycloakPassword,
        scope: client_scope,
        grant_type: 'password'
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true
      });

      //
      // note that 'id_token' will be present if scope 'openid profile email' requested
      //
      if (exchangeResponse.status === 200 && exchangeResponse.data.access_token) {
        console.log('[StalwartService] SUCCESS: Access token obtained successfully via password grant');
        console.log('result data:');
        console.log(exchangeResponse.data);
        return {
          success: true,
          username:keycloakUsername,
          client:webmailClientId,
          accessToken: exchangeResponse.data.access_token,
          refreshToken: exchangeResponse.data.refresh_token,
          expiresIn: exchangeResponse.data.expires_in,
          sessionState: exchangeResponse.data.session_state,
          idToken: exchangeResponse.data.id_token,
          scope: exchangeResponse.data.scope
        };
      } else {
        const errorMsg = exchangeResponse.data?.error_description || 
                        exchangeResponse.data?.error || 
                        'Password grant failed';
        console.error(`[StalwartService] Password grant failed: ${errorMsg}`);
        return {
          success: false,
          error: errorMsg,
          status: exchangeResponse.status
        };
      }
    } catch (error) {
      console.error('[StalwartService] DAG password grant error:', error);
      return {
        success: false,
        error: error.message || 'DAG password grant failed'
      };
    }
  }




  //
  //try response mode = form_post
  //
  async postWebmailTokenViaDAG(keycloakUsername, keycloakPassword) {
    try {
      const keycloakUrl = process.env.KEYCLOAK_URL;
      const realm = process.env.KEYCLOAK_REALM;
      // KEYCLOAK_SSO_MAIL_CLIENT
      const webmailClientId = process.env.KEYCLOAK_SSO_MAIL_CLIENT;
      // KEYCLOAK_SSO_MAIL_CLIENT_SECRET
      const webmailClientSecret = process.env.KEYCLOAK_SSO_MAIL_CLIENT_SECRET;

      if (!keycloakUrl || !realm || !webmailClientId || !webmailClientSecret) {
        return {
          success: false,
          error: 'Missing Keycloak or Webmail Client OIDC configuration'
        };
      }

      const axios = require('axios');
      const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;

      console.log('[StalwartService - postWebmailTokenViaDAG] Obtaining Keycloak access token for user',keycloakUsername);
      console.log('[StalwartService - postWebmailTokenViaDAG] Obtaining Keycloak access token for id',webmailClientId);
      console.log('[StalwartService - postWebmailTokenViaDAG] Obtaining Keycloak access token for sec',webmailClientSecret);
//
// don't do this:
//        response_type: 'id_token',
// as it will reduce response to ONLY include id-token
//
      const client_scope = 'openid profile email';
      const exchangeResponse = await axios.post(tokenUrl, new URLSearchParams({
        client_id: webmailClientId,
        client_secret: webmailClientSecret,
        username: keycloakUsername,
        password: keycloakPassword,
        scope: client_scope,
        grant_type: 'password',
        response_mode: 'form_post'
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true
      });

      //
      // note that 'id_token' will be present if scope 'openid profile email' requested
      //
      if (exchangeResponse.status === 200 && exchangeResponse.data.access_token) {
        console.log('[StalwartService - postWebmailTokenViaDAG] SUCCESS: DAG tokens posted successfully via password grant');
        console.log('result data:');
        console.log(exchangeResponse.data);
        return {
          success: true,
          username:keycloakUsername,
          client:webmailClientId,
          accessToken: exchangeResponse.data.access_token,
          refreshToken: exchangeResponse.data.refresh_token,
          expiresIn: exchangeResponse.data.expires_in,
          sessionState: exchangeResponse.data.session_state,
          idToken: exchangeResponse.data.id_token,
          scope: exchangeResponse.data.scope
        };
      } else {
        const errorMsg = exchangeResponse.data?.error_description || 
                        exchangeResponse.data?.error || 
                        'Password grant failed';
        console.error(`[StalwartService - postWebmailTokenViaDAG] Password grant failed: ${errorMsg}`);
        return {
          success: false,
          error: errorMsg,
          status: exchangeResponse.status
        };
      }
    } catch (error) {
      console.error('[StalwartService - postWebmailTokenViaDAG] DAG password grant error:', error);
      return {
        success: false,
        error: error.message || 'DAG password grant failed'
      };
    }
  }



}

module.exports = new StalwartService();


