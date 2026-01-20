const mailcowClient = require('./mailcow-client.js');
const database = require('../databaseService.js');

class MailboxProxyConfigService {
  constructor() {
    this.mailcowClient = mailcowClient;
    this.database = database;
  }

  /**
   * Configure email proxy for a user
   * @param {number} userId - User ID
   * @param {string} personalEmail - User's personal email address
   * @param {boolean} enableProxy - Whether to enable or disable proxy
   * @returns {Promise<Object>} Configuration result
   */
  async configureUserProxy(userId, personalEmail, username, enableProxy = true) {
    try {
      // this garbage may take years to clean up.  do a re-write instead
      console.log(`[MailboxProxy] INFO: Starting proxy configuration for user ${userId}`);
      console.log(`[MailboxProxy]   Personal email: ${personalEmail}`);
      console.log(`[MailboxProxy]   Enable proxy: ${enableProxy}`);
      
      if (!this.mailcowClient.isConfigured()) {
        return {
          success: false,
          error: 'MailCow client not configured',
          message: 'Email proxy service unavailable'
        };
      }

      if (!personalEmail || !this.isValidEmail(personalEmail)) {
        return {
          success: false,
          error: 'Invalid personal email address',
          message: 'Please provide a valid email address'
        };
      }

      const intEmailDomain = process.env.WORKINPILOT_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';
      const internalEmail = `${username}@${intEmailDomain}`;

      const results = {
        bccMap: null,
        recipientMap: null,
        appPassword: null,
        settings: null
      };

      if (enableProxy) {
        // Check if internal and personal emails are the same
        if (internalEmail.toLowerCase() === personalEmail.toLowerCase()) {
          console.log(`[MailboxProxy - configureUserProxy] Internal and personal emails are the same (${internalEmail}) - skipping address mapping`);
          
          // Verify no existing maps are needed
          console.log(`[MailboxProxy - configureUserProxy] Verifying no maps exist for same email addresses...`);
          const existingBccMaps = await this.mailcowClient.getAllBccMaps();
          const existingRecipientMaps = await this.mailcowClient.getAllRecipientMaps();
          
          console.log(`[MailboxProxy] Existing BCC maps:`, existingBccMaps.success ? existingBccMaps.data?.length || 0 : 'Failed to check');
          console.log(`[MailboxProxy] Existing recipient maps:`, existingRecipientMaps.success ? existingRecipientMaps.data?.length || 0 : 'Failed to check');
          
          results.bccMap = { success: true, skipped: true, reason: 'Same email addresses' };
          results.recipientMap = { success: true, skipped: true, reason: 'Same email addresses' };
        } else {
          // Step 1: Create BCC map (internal → personal)
          console.log(`[MailboxProxy - configureUserProxy] Step 1: Creating BCC map: ${internalEmail} → ${personalEmail}`);
          results.bccMap = await this.mailcowClient.addBccMap(internalEmail, personalEmail, true);
        
          console.log(`[MailboxProxy - configureUserProxy] BCC map result:`, {
            success: results.bccMap.success,
            status: results.bccMap.status,
            error: results.bccMap.error
          });
        
          if (!results.bccMap.success) {
            console.error(`[MailboxProxy - configureUserProxy] FAIL BCC map creation failed:`, results.bccMap.error);
            return {
              success: false,
              error: 'Failed to create BCC map',
              message: 'Unable to forward emails to personal address',
              details: results.bccMap.error
            };
          }
        
          console.log(`[MailboxProxy] OK: BCC map created successfully`);

          // Step 2: Create recipient map (personal → internal)
          console.log(`[MailboxProxy]   Step 2: Creating recipient map: ${personalEmail} → ${internalEmail}`);
          results.recipientMap = await this.mailcowClient.addRecipientMap(personalEmail, internalEmail, true);
          
          console.log(`[MailboxProxy]   Recipient map result:`, {
            success: results.recipientMap.success,
            status: results.recipientMap.status,
            error: results.recipientMap.error
          });
          
          if (!results.recipientMap.success) {
            console.error(`[MailboxProxy] FAIL Recipient map creation failed:`, results.recipientMap.error);
            // Try to clean up BCC map
            await this.cleanupBccMap(internalEmail, personalEmail);
            return {
              success: false,
              error: 'Failed to create recipient map',
              message: 'Unable to receive emails from personal address',
              details: results.recipientMap.error
            };
          }          
          console.log(`[MailboxProxy] OK: Recipient map created successfully`);
          
          // Verify maps were actually created
          console.log(`[MailboxProxy] INFO: Verifying maps were created...`);
          const verifyBccMaps = await this.mailcowClient.getAllBccMaps();
          const verifyRecipientMaps = await this.mailcowClient.getAllRecipientMaps();
          
          if (verifyBccMaps.success && verifyBccMaps.data) {
            const bccMaps = Array.isArray(verifyBccMaps.data) ? verifyBccMaps.data : Object.values(verifyBccMaps.data);
            const userBccMap = bccMaps.find(map => map.local_dest === internalEmail);
            console.log(`[MailboxProxy] OK: BCC map verification:`, userBccMap ? `Found ${userBccMap.local_dest} -> ${userBccMap.bcc_dest}` : 'NOT FOUND');
          } else{
            console.error(`[MailboxProxy - configureUserProxy] FAIL BCC map verification failed:`, verifyBccMaps.error);
          }
          
          if (verifyRecipientMaps.success && verifyRecipientMaps.data) {
            const recipientMaps = Array.isArray(verifyRecipientMaps.data) ? verifyRecipientMaps.data : Object.values(verifyRecipientMaps.data);
            const userRecipientMap = recipientMaps.find(map => map.recipient_map_old === personalEmail);
            console.log(`[MailboxProxy] OK: Recipient map verification:`, userRecipientMap ? `Found ${userRecipientMap.recipient_map_old} -> ${userRecipientMap.recipient_map_new}` : 'NOT FOUND');
          } else {
            console.error(`[MailboxProxy - configureUserProxy] FAIL Recipient map verification failed:`, verifyRecipientMaps.error);
          }
        }

        // only restore this code if SMTP or other password-based protocol is primary

        // // Step 3: Set app password (using admin password for MVP)
        // console.log(`[MailboxProxy]   Step 3: Setting app password for ${internalEmail}`);
        // results.appPassword = await this.setAppPassword(internalEmail);
        
        // console.log(`[MailboxProxy] INFO: App password result:`, {
        //   success: results.appPassword.success,
        //   error: results.appPassword.error,
        //   message: results.appPassword.message
        // });
        
        // if (!results.appPassword.success) {
        //   console.error(`[MailboxProxy] FAIL App password setting failed:`, results.appPassword.error);
        //   // Clean up maps
        //   await this.cleanupBccMap(internalEmail, personalEmail);
        //   await this.cleanupRecipientMap(personalEmail, internalEmail);
        //   return {
        //     success: false,
        //     error: 'Failed to set app password',
        //     message: 'Unable to configure email authentication',
        //     details: results.appPassword.error
        //   };
        // }
        // console.log(`[MailboxProxy] OK App password set successfully`);
        
      } else {
        // Disable proxy - clean up existing maps
        console.log(`[MailboxProxy] Disabling proxy for ${internalEmail}`);
        await this.cleanupBccMap(internalEmail, personalEmail);
        await this.cleanupRecipientMap(personalEmail, internalEmail);
      }

      // Step 4: Update user settings
      console.log(`[MailboxProxy] Updating user settings: wip_email_proxy = ${enableProxy}`);
      if (typeof this.database.upsertUserSettings === 'function') {
        await this.database.upsertUserSettings(userId, { wip_email_proxy: enableProxy });
      }

      console.log(`[MailboxProxy] Proxy configuration completed successfully for user ${userId}`);
      return {
        success: true,
        message: enableProxy ? 'Email proxy enabled successfully' : 'Email proxy disabled successfully',
        results: results,
        internalEmail,
        personalEmail,
        enabled: enableProxy
      };

    } catch (error) {
      console.error(`[MailboxProxy] Configuration error for user ${userId}:`, error);
      return {
        success: false,
        error: 'Configuration failed',
        message: 'An unexpected error occurred during email proxy setup',
        details: error.message
      };
    }
  }

  /**
   * Get internal email address for a user
   * @param {number} userId - User ID
   * @returns {Promise<string|null>} Internal email address
   */
  async getInternalEmail(userId) {
    const userAccount = await this.database.getUserAccount(userId);
    return userAccount?.email;
  }

  /**
   * Set app password for a user (MVP: uses admin password)
   * @param {string} internalEmail - Internal email address
   * @returns {Promise<Object>} Result of password setting
   */
  async setAppPassword(internalEmail) {
    // YEAH this aint happning - our auth is by OIDC IdP
    try {
      console.log(`[MailboxProxy]   SKIPPING app password setup for ${internalEmail}`);
      // console.log(`[MailboxProxy] INFO: Starting app password setup for ${internalEmail}`);
      
      const adminPassword = process.env.NEXTCLOUD_ADMIN_PW;
      if (!adminPassword) {
        console.error(`[MailboxProxy]   NEXTCLOUD_ADMIN_PW not configured`);
        return {
          success: false,
          error: 'Admin password not configured',
          message: 'NEXTCLOUD_ADMIN_PW environment variable not set'
        };
      }

      // In production with smtp mailboxes will be user-specific passwords
      const attr = {
        password: adminPassword,  // Password (yeah, whatever)
        password2: adminPassword, // Confirmation password
        active: '1'
      };
      
      const items = [internalEmail];
      
      console.log(`[MailboxProxy]  Calling MailCow addAppPw API with:`, {
        username: internalEmail,
        appName: "WorkInPilot",
        hasPassword: 'true'
      });
      
      const result = await this.mailcowClient.addAppPw(internalEmail, "WorkInPilot", adminPassword);
      
      console.log(`[MailboxProxy]   MailCow addAppPw response:`, {
        success: result.success,
        status: result.status,
        error: result.error,
        data: result.data
      });
      
      // Check for actual errors in response data
      if (result.data && Array.isArray(result.data)) {
        const errorMsg = result.data.find(item => item.type === 'danger');
        if (errorMsg) {
          console.error(`[MailboxProxy] FAIL MailCow API error:`, errorMsg.msg);
          return {
            success: false,
            error: 'MailCow API error',
            message: `Failed to create app password: ${errorMsg.msg}`,
            details: errorMsg
          };
        }
      }
      
      // if (result.success) {
      //   console.log(`[MailboxProxy]   Verifying app password was created...`);
        
      //   // Verify app password actually exists
      //   const verifyResult = await this.mailcowClient.getAllAppPasswords(internalEmail);
      //   console.log(`[MailboxProxy] INFO: App password verification:`, {
      //     success: verifyResult.success,
      //     status: verifyResult.status,
      //     data: verifyResult.data
      //   });
      //   if (verifyResult.success && verifyResult.data && Array.isArray(verifyResult.data)) {
      //     const workinpilotApp = verifyResult.data.find(app => app.app_name === 'WorkInPilot');
      //     if (workinpilotApp) {
      //       console.log(`[MailboxProxy] OK App password verified: WorkInPilot app exists`);
      //       return {
      //         success: true,
      //         message: 'App password configured and verified',
      //         password: adminPassword
      //       };
      //     } else {
      //       console.error(`[MailboxProxy] FAIL App password verification failed: WorkInPilot app not found`);
      //       return {
      //         success: false,
      //         error: 'App password verification failed',
      //         message: 'App password was not created successfully'
      //       };
      //     }
      //   } else {
      //     console.error(`[MailboxProxy] FAIL App password verification failed:`, verifyResult.error);
      //     return {
      //       success: false,
      //       error: 'App password verification failed',
      //       message: 'Unable to verify app password creation'
      //     };
      //   }
      // } else {
      //   return {
      //     success: false,
      //     error: result.error || 'Failed to set password',
      //     message: 'Unable to configure email authentication'
      //   };
      // }
    } catch (error) {
      console.error(`[MailboxProxy] Error setting app password for ${internalEmail}:`, error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to configure email authentication'
      };
    } finally {
      console.log(`[MailboxProxy]   App password setup SKIPPED for ${internalEmail}`);
      return {
        success: true,
        message: 'App password SKIPPED for OIDC IdP verified user',
        data: result.data
      };
    }
  }

  /**
   * Clean up BCC map
   * @param {string} internalEmail - Internal email
   * @param {string} personalEmail - Personal email
   */
  async cleanupBccMap(internalEmail, personalEmail) {
    try {
      // Note: MailCow API doesn't have a direct delete endpoint for BCC maps
      // We would need to implement this based on the specific API available
      console.log(`[MailboxProxy] Cleanup BCC map: ${internalEmail} → ${personalEmail}`);
      // TODO: Implement BCC map deletion when API is available
    } catch (error) {
      console.error(`[MailboxProxy] Error cleaning up BCC map:`, error);
    }
  }

  /**
   * Clean up recipient map
   * @param {string} personalEmail - Personal email
   * @param {string} internalEmail - Internal email
   */
  async cleanupRecipientMap(personalEmail, internalEmail) {
    try {
      // Note: MailCow API doesn't have a direct delete endpoint for recipient maps
      // We would need to implement this based on the specific API available
      console.log(`[MailboxProxy] Cleanup recipient map: ${personalEmail} → ${internalEmail}`);
      // TODO: Implement recipient map deletion when API is available
    } catch (error) {
      console.error(`[MailboxProxy] Error cleaning up recipient map:`, error);
    }
  }

  /**
   * Validate email address format
   * @param {string} email - Email address to validate
   * @returns {boolean} Whether email is valid
   */
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Get proxy status for a user
   * @param {number} userId - User ID
   * @returns {Promise<Object>} Proxy status information
   */
  async getProxyStatus(userId) {
    try {
      const settings = await this.database.getUserSettings(userId);
      const userAccount = await this.database.getUserAccount(userId);
      const internalEmail = userAccount?.email;
      console.log(`[MailboxProxy - getProxyStatus] Get proxy status for user ${userId}:`, {
        enabled: settings?.wip_email_proxy ?? true,
        internalEmail,
        personalEmail: userAccount?.personal_email,
        configured: !!(internalEmail && userAccount?.personal_email)
      });
      return {
        enabled: settings?.wip_email_proxy ?? true, // Default to true
        internalEmail,
        personalEmail: userAccount?.personal_email,
        configured: !!(internalEmail && userAccount?.personal_email)
      };
    } catch (error) {
      console.error(`[MailboxProxy - getProxyStatus] Error getting proxy status for user ${userId}:`, error);
      return {
        enabled: true,
        internalEmail: null,
        personalEmail: null,
        configured: false,
        error: error.message
      };
    }
  }
}

module.exports = new MailboxProxyConfigService();
