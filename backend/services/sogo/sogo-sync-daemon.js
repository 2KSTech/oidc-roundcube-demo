/**
 * SOGo Sync Daemon
 * 
 * Background service that periodically scans Keycloak for all users
 * and ensures they exist in SOGo's sogo_users table.
 * 
 * Only runs when:
 * - WORKINPILOT_SSO_MAIL_CLIENT_NAME=sogo AND WORKINPILOT_MAIL_PROVIDER=stalwart
 * - OR SOGO_SYNC_ENABLED=true
 */

const keycloakAdmin = require('../../config/keycloak-admin');
const sogoUserService = require('./sogo-user-service');
const mailServiceConfig = require('../../config/mail-service-config');

class SogoSyncDaemon {
  constructor() {
    this.running = false;
    this.timer = null;
    this.isTicking = false;
    this.intervalMs = parseInt(
      process.env.SOGO_SYNC_INTERVAL_MS || '300000', // Default: 5 minutes
      10
    );
    this.lastSyncTime = null;
    this.stats = {
      totalScanned: 0,
      totalCreated: 0,
      totalUpdated: 0,
      totalErrors: 0,
      lastRun: null
    };
  }

  /**
   * Check if SOGo sync should be enabled
   * Requires BOTH:
   * 1. SOGo webmail client selected (WORKINPILOT_SSO_MAIL_CLIENT_NAME=sogo)
   * 2. Stalwart mail provider selected (WORKINPILOT_MAIL_PROVIDER=stalwart)
   * 
   * OR can be explicitly enabled via SOGO_SYNC_ENABLED=true
   */
  shouldRun() {
    // Check explicit enable flag first (values should be lowercase)
    const explicitEnabled = (process.env.SOGO_SYNC_ENABLED || '').toLowerCase() === 'true';
    if (explicitEnabled) {
      return true;
    }
    
    // Otherwise require both conditions (provider value normalized to lowercase in mailServiceConfig)
    const sogoSelected = mailServiceConfig.isSogoSelected();
    const stalwartSelected = mailServiceConfig.getProvider() === 'stalwart';
    
    return sogoSelected && stalwartSelected;
  }

  /**
   * Start the daemon
   */
  start() {
    if (this.running) {
      console.log('[SogoSyncDaemon] Already running');
      return false;
    }

    // Only start if conditions are met
    if (!this.shouldRun()) {
      console.log('[SogoSyncDaemon] SOGo sync conditions not met (requires sogo client + stalwart provider, or SOGO_SYNC_ENABLED=true), daemon will not start');
      return false;
    }

    this.running = true;
    console.log(`[SogoSyncDaemon] Starting with interval ${this.intervalMs}ms`);

    // Run immediately on start
    this.tick().catch(err => {
      console.error('[SogoSyncDaemon] Initial tick error:', err);
    });

    // Then run on interval
    this.timer = setInterval(async () => {
      if (this.isTicking) {
        console.log('[SogoSyncDaemon] Previous tick still running, skipping');
        return;
      }
      this.tick().catch(err => {
        console.error('[SogoSyncDaemon] Tick error:', err);
      });
    }, this.intervalMs);

    return true;
  }

  /**
   * Stop the daemon
   */
  stop() {
    if (!this.running) return false;
    
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[SogoSyncDaemon] Stopped');
    return true;
  }

  /**
   * Perform sync operation
   */
  async tick() {
    if (!this.shouldRun()) {
      console.log('[SogoSyncDaemon] SOGo sync conditions not met, skipping sync');
      return;
    }

    if (this.isTicking) {
      console.log('[SogoSyncDaemon] Already ticking, skipping');
      return;
    }

    this.isTicking = true;
    this.stats.lastRun = new Date();

    try {
      console.log('[SogoSyncDaemon] Starting sync...');
      
      // Fetch all users from Keycloak
      const keycloakUsers = await keycloakAdmin.getAllUsers();
      console.log(`[SogoSyncDaemon] Found ${keycloakUsers.length} users in Keycloak`);

      let created = 0;
      let updated = 0;
      let errors = 0;

      // Sync each user to SOGo
      for (const kcUser of keycloakUsers) {
        try {
          // Skip disabled users
          if (kcUser.enabled === false) {
            continue;
          }

          const username = kcUser.username;
          const email = kcUser.email || `${username}@${process.env.WORKINPILOT_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space'}`;
          const firstName = kcUser.firstName || '';
          const lastName = kcUser.lastName || '';

          const result = await sogoUserService.ensureUserInSogo({
            keycloakId: kcUser.id,
            username,
            email,
            firstName,
            lastName
          });

          if (result.success) {
            if (result.action === 'created') {
              created++;
            } else {
              updated++;
            }
          } else {
            errors++;
            console.error(`[SogoSyncDaemon] Failed to sync user ${username}:`, result.error);
          }
        } catch (error) {
          errors++;
          console.error(`[SogoSyncDaemon] Error syncing user ${kcUser.username}:`, error.message);
        }
      }

      this.stats.totalScanned += keycloakUsers.length;
      this.stats.totalCreated += created;
      this.stats.totalUpdated += updated;
      this.stats.totalErrors += errors;
      this.lastSyncTime = new Date();

      console.log(`[SogoSyncDaemon] Sync complete: ${created} created, ${updated} updated, ${errors} errors`);
    } catch (error) {
      console.error('[SogoSyncDaemon] Sync error:', error);
      this.stats.totalErrors++;
    } finally {
      this.isTicking = false;
    }
  }

  /**
   * Get daemon status
   */
  getStatus() {
    return {
      running: this.running,
      shouldRun: this.shouldRun(),
      intervalMs: this.intervalMs,
      lastSyncTime: this.lastSyncTime,
      isTicking: this.isTicking,
      stats: { ...this.stats }
    };
  }
}

// Singleton instance
const sogoSyncDaemon = new SogoSyncDaemon();

module.exports = sogoSyncDaemon;

