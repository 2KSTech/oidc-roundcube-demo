/**
 * Demo Session Cleanup Daemon
 *
 * Background service that periodically scans Keycloak users and expires demo sessions
 * by deleting users that were created more than DEMO_MAX_SESSION_DURATION_MIN minutes ago.
 *
 * For each expired user:
 * 1. Deletes from Stalwart (FIRST - mailbox via HTTP API using username like working test)
 * 2. Deletes from Keycloak (SECOND - after Stalwart to avoid auth issues)
 * 3. Deletes from Roundcube DB (uses email as identifier since Roundcube stores emails in username column)
 *
 * This daemon only handles Roundcube demo cleanup. SOGo cleanup is handled by a separate daemon.
 * Only runs when DEMO_MAX_SESSION_DURATION_MIN is set.
 *
 * Key Technical Details:
 * - Roundcube DB stores email addresses in the 'username' column (not usernames!)
 * - Stalwart deletion uses HTTP API with username (like working tmp_stalwart_proof.js)
 * - "Principal not found" in Stalwart is treated as success (nothing to clean up)
 * - Order matters: Stalwart FIRST, then Keycloak, then Roundcube (avoids auth issues)
 * - Extensive logging distinguishes between actual deletions vs "already deleted" scenarios
 *
 * Stalwart Response Interpretation:
 * - OK "Principal deleted: name" = Actually deleted an existing account
 * - [?] "Principal not found (may already be deleted)" = Account never existed or already cleaned up
 * - FAIL Error messages = Actual failure requiring investigation
 */

const keycloakAdmin = require('../config/keycloak-admin');
const mailService = require('./email/mail-service-abstraction');
const roundcubeUserService = require('./roundcube/roundcube-user-service');

// HTTP client for API calls (similar to working test script)
const http = require('http');
const https = require('https');

/**
 * Helper function to make HTTP DELETE request to Stalwart API endpoint
 * (Similar to the working test script approach)
 */
async function deleteStalwartMailboxViaAPI(email) {
    return new Promise((resolve, reject) => {
        // Get API base URL from environment (similar to test script)
        const apiBase = process.env.API_BASE || process.env.APP_URL || 'http://localhost:3010';
        console.log(`[DemoSessionCleanupDaemon] API_BASE from env: ${process.env.API_BASE}`);
        console.log(`[DemoSessionCleanupDaemon] APP_URL from env: ${process.env.APP_URL}`);
        console.log(`[DemoSessionCleanupDaemon] Using API base: ${apiBase}`);

        // Construct the URL (matching the working test script - uses identifier parameter)
        const url = `${apiBase}/api/test/oidc-stalwart/stalwart/delete-mailbox/${encodeURIComponent(email)}`;
        console.log(`[DemoSessionCleanupDaemon] API URL constructed: ${url}`);
        console.log(`[DemoSessionCleanupDaemon] Making HTTP DELETE request to: ${url}`);

        const protocol = url.startsWith('https:') ? https : http;
        const req = protocol.request(url, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        }, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    console.log(`[DemoSessionCleanupDaemon] Stalwart API response:`, JSON.stringify(result, null, 2));
                    resolve(result);
                } catch (parseError) {
                    console.error(`[DemoSessionCleanupDaemon] Failed to parse Stalwart API response:`, parseError);
                    resolve({ success: false, error: `Parse error: ${parseError.message}` });
                }
            });
        });

        req.on('error', (error) => {
            console.error(`[DemoSessionCleanupDaemon] Stalwart API request error:`, error);
            reject(error);
        });

        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Stalwart API request timeout'));
        });

        req.end();
    });
}

class DemoSessionCleanupDaemon {
    constructor() {
        this.running = false;
        this.timer = null;
        this.isTicking = false;
        this.intervalMs = parseInt(
            process.env.DEMO_CLEANUP_INTERVAL_MS || '60000', // Default: 1 minute
            10
        );
        this.maxSessionDurationMin = parseInt(
            process.env.DEMO_MAX_SESSION_DURATION_MIN || '15',
            10
        );
        this.lastCleanupTime = null;
        this.stats = {
            totalScanned: 0,
            totalExpired: 0,
            totalDeleted: 0,
            totalErrors: 0,
            lastRun: null
        };
    }

    /**
     * Check if cleanup daemon should run
     */
    shouldRun() {
        // Only run if DEMO_MAX_SESSION_DURATION_MIN is set (non-zero)
        return this.maxSessionDurationMin > 0;
    }

    /**
     * Start the daemon
     */
    async start() {
        if (this.running) {
            console.log('[DemoSessionCleanupDaemon] Already running');
            return false;
        }

        // Only start if conditions are met
        if (!this.shouldRun()) {
            console.log('[DemoSessionCleanupDaemon] DEMO_MAX_SESSION_DURATION_MIN not set or is 0, daemon will not start');
            return false;
        }

        // Test connectivity to required services before starting
        console.log('[DemoSessionCleanupDaemon] Testing connectivity to required services...');
        try {
            await keycloakAdmin.getAllUsers();
            console.log('[DemoSessionCleanupDaemon] Keycloak connectivity test passed');
        } catch (error) {
            console.error('[DemoSessionCleanupDaemon] Keycloak connectivity test failed:', error.message);
            console.error('[DemoSessionCleanupDaemon] Daemon will not start due to connectivity issues');
            return false;
        }

        this.running = true;
        console.log(`[DemoSessionCleanupDaemon] Starting with interval ${this.intervalMs}ms, max session duration ${this.maxSessionDurationMin} minutes`);

        // Run immediately on start
        this.tick().catch(err => {
            console.error('[DemoSessionCleanupDaemon] Initial tick error:', err);
        });

        // Then run on interval
        this.timer = setInterval(async () => {
            if (this.isTicking) {
                console.log('[DemoSessionCleanupDaemon] Previous tick still running, skipping');
                return;
            }
            this.tick().catch(err => {
                console.error('[DemoSessionCleanupDaemon] Tick error:', err);
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
        console.log('[DemoSessionCleanupDaemon] Stopped');
        return true;
    }

    /**
     * Expire all active sessions (for graceful shutdown)
     */
    async expireAllSessions() {
        if (!this.shouldRun()) {
            console.log('[DemoSessionCleanupDaemon] DEMO_MAX_SESSION_DURATION_MIN not set, skipping expiration');
            return;
        }

        console.log('[DemoSessionCleanupDaemon] ** FORCE EXPIRING ALL DEMO SESSIONS (shutdown cleanup)...');

        try {
            // Get all users from Keycloak
            const keycloakUsers = await keycloakAdmin.getAllUsers();
            console.log(`[DemoSessionCleanupDaemon] * Found ${keycloakUsers.length} total users for shutdown cleanup`);

            const enabledUsers = keycloakUsers.filter(u => u.enabled !== false);
            const disabledUsers = keycloakUsers.filter(u => u.enabled === false);
            console.log(`[DemoSessionCleanupDaemon] User breakdown: ${enabledUsers.length} enabled, ${disabledUsers.length} disabled (will process enabled only)`);

            let expired = 0;
            let errors = 0;

            // Check each user and expire if needed
            for (const kcUser of keycloakUsers) {
                try {
                    console.log(`[DemoSessionCleanupDaemon] [SHUTDOWN] Processing user: ${kcUser.username} (enabled: ${kcUser.enabled})`);

                    // Skip disabled users
                    if (kcUser.enabled === false) {
                        console.log(`[DemoSessionCleanupDaemon] [SHUTDOWN] Skipping disabled user: ${kcUser.username}`);
                        continue;
                    }

                    // Get full user details to check createdTimestamp
                    console.log(`[DemoSessionCleanupDaemon] [SHUTDOWN] Getting full details for: ${kcUser.username}`);
                    const fullUser = await keycloakAdmin.getUserById(kcUser.id);
                    const createdTimestamp = fullUser.createdTimestamp;

                    console.log(`[DemoSessionCleanupDaemon] [SHUTDOWN] User ${fullUser.username}: createdTimestamp=${createdTimestamp}`);

                    if (!createdTimestamp) {
                        console.log(`[DemoSessionCleanupDaemon] [SHUTDOWN] Skipping user ${fullUser.username} - no createdTimestamp`);
                        continue;
                    }

                    // Check if user should be expired (treat all as expired for shutdown)
                    console.log(`[DemoSessionCleanupDaemon] [SHUTDOWN] Calling shouldExpireUser with force=true for ${fullUser.username}`);
                    const shouldExpire = await this.shouldExpireUser(fullUser, true); // force=true for shutdown

                    console.log(`[DemoSessionCleanupDaemon] [SHUTDOWN] Force expire result for ${fullUser.username}: ${shouldExpire}`);

                    if (shouldExpire) {
                        console.log(`[DemoSessionCleanupDaemon] [SHUTDOWN] *** FORCE DELETING USER: ${fullUser.username} ***`);
                        const result = await this.deleteUser(fullUser);
                        console.log(`[DemoSessionCleanupDaemon] [SHUTDOWN] Force delete result for ${fullUser.username}:`, JSON.stringify(result, null, 2));
                        if (result.success) {
                            expired++;
                            console.log(`[DemoSessionCleanupDaemon] [SHUTDOWN] OK Successfully force-deleted user: ${fullUser.username}`);
                        } else {
                            errors++;
                            console.error(`[DemoSessionCleanupDaemon] [SHUTDOWN] FAIL Failed to force-delete user ${fullUser.username}:`, result.error);
                        }
                    } else {
                        console.log(`[DemoSessionCleanupDaemon] [SHUTDOWN] User ${fullUser.username} should NOT be force-expired (unexpected)`);
                    }
                } catch (error) {
                    errors++;
                    console.error(`[DemoSessionCleanupDaemon] [SHUTDOWN] Error processing user ${kcUser.username}:`, error.message);
                    console.error(`[DemoSessionCleanupDaemon] [SHUTDOWN] Error stack:`, error.stack);
                }
            }

            console.log(`[DemoSessionCleanupDaemon] [SHUTDOWN] ** Force cleanup complete: ${expired} force-expired, ${errors} errors`);
        } catch (error) {
            console.error('[DemoSessionCleanupDaemon] [SHUTDOWN] Error during shutdown cleanup:', error);
            console.error('[DemoSessionCleanupDaemon] [SHUTDOWN] Shutdown error stack:', error.stack);
        }
    }

    /**
     * Perform cleanup operation
     */
    async tick() {
        if (!this.shouldRun()) {
            console.log('[DemoSessionCleanupDaemon] DEMO_MAX_SESSION_DURATION_MIN not set, skipping cleanup');
            return;
        }

        if (this.isTicking) {
            console.log('[DemoSessionCleanupDaemon] Already ticking, skipping');
            return;
        }

        this.isTicking = true;
        this.stats.lastRun = new Date();

        try {
            console.log('[DemoSessionCleanupDaemon] * Starting cleanup cycle...');
            console.log(`[DemoSessionCleanupDaemon] Max session duration: ${this.maxSessionDurationMin} minutes`);

            // Fetch all users from Keycloak
            console.log('[DemoSessionCleanupDaemon] * Fetching all users from Keycloak...');
            const keycloakUsers = await keycloakAdmin.getAllUsers();
            console.log(`[DemoSessionCleanupDaemon] * Found ${keycloakUsers.length} total users in Keycloak`);

            // Log user summary
            const enabledUsers = keycloakUsers.filter(u => u.enabled !== false);
            const disabledUsers = keycloakUsers.filter(u => u.enabled === false);
            console.log(`[DemoSessionCleanupDaemon] User breakdown: ${enabledUsers.length} enabled, ${disabledUsers.length} disabled`);

            let expired = 0;
            let deleted = 0;
            let errors = 0;

            // Check each user for expiration
            for (const kcUser of keycloakUsers) {
                try {
                    console.log(`[DemoSessionCleanupDaemon] Processing user: ${kcUser.username} (enabled: ${kcUser.enabled})`);

                    // Skip disabled users
                    if (kcUser.enabled === false) {
                        console.log(`[DemoSessionCleanupDaemon] Skipping disabled user: ${kcUser.username}`);
                        continue;
                    }

                    // Get full user details to check createdTimestamp
                    console.log(`[DemoSessionCleanupDaemon] Getting full details for user: ${kcUser.username}`);
                    const fullUser = await keycloakAdmin.getUserById(kcUser.id);
                    console.log(`[DemoSessionCleanupDaemon] Full user details: username=${fullUser.username}, email=${fullUser.email}, createdTimestamp=${fullUser.createdTimestamp}`);

                    const shouldExpire = await this.shouldExpireUser(fullUser);
                    console.log(`[DemoSessionCleanupDaemon] User ${fullUser.username} shouldExpire result: ${shouldExpire}`);

                    if (shouldExpire) {
                        expired++;
                        console.log(`[DemoSessionCleanupDaemon] *** DELETING EXPIRED USER: ${fullUser.username} ***`);
                        const result = await this.deleteUser(fullUser);
                        console.log(`[DemoSessionCleanupDaemon] Delete result for ${fullUser.username}:`, JSON.stringify(result, null, 2));
                        if (result.success) {
                            deleted++;
                            console.log(`[DemoSessionCleanupDaemon] OK Successfully deleted user: ${fullUser.username}`);
                        } else {
                            errors++;
                            console.error(`[DemoSessionCleanupDaemon] FAIL Failed to delete user ${fullUser.username}:`, result.error);
                        }
                    } else {
                        console.log(`[DemoSessionCleanupDaemon] User ${fullUser.username} will NOT be expired`);
                    }
                } catch (error) {
                    errors++;
                    console.error(`[DemoSessionCleanupDaemon] Error processing user ${kcUser.username}:`, error.message);
                    console.error(`[DemoSessionCleanupDaemon] Error stack:`, error.stack);
                }
            }

            this.stats.totalScanned += keycloakUsers.length;
            this.stats.totalExpired += expired;
            this.stats.totalDeleted += deleted;
            this.stats.totalErrors += errors;
            this.lastCleanupTime = new Date();

            console.log(`[DemoSessionCleanupDaemon] 🏁 Cleanup cycle complete:`);
            console.log(`  - Users scanned: ${keycloakUsers.length}`);
            console.log(`  - Users expired: ${expired}`);
            console.log(`  - Users deleted: ${deleted}`);
            console.log(`  - Errors encountered: ${errors}`);
            console.log(`  - Cycle duration: ${(new Date() - this.stats.lastRun) / 1000}s`);
            console.log(`  - Next cycle in: ${this.intervalMs / 1000}s`);
        } catch (error) {
            console.error('[DemoSessionCleanupDaemon] Cleanup error:', error);
            this.stats.totalErrors++;
        } finally {
            this.isTicking = false;
        }
    }

    /**
     * Check if a user should be expired
     * @param {Object} kcUser - Full Keycloak user object with createdTimestamp
     * @param {boolean} force - Force expiration (for shutdown)
     * @returns {Promise<boolean>}
     */
    async shouldExpireUser(kcUser, force = false) {
        console.log(`[DemoSessionCleanupDaemon] shouldExpireUser called for ${kcUser.username} with force=${force}`);

        if (force) {
            console.log(`[DemoSessionCleanupDaemon] FORCE MODE: User ${kcUser.username} will be expired (shutdown cleanup)`);
            return true;
        }

        const createdTimestamp = kcUser.createdTimestamp;
        console.log(`[DemoSessionCleanupDaemon] User ${kcUser.username} createdTimestamp: ${createdTimestamp}`);

        if (!createdTimestamp) {
            console.log(`[DemoSessionCleanupDaemon] User ${kcUser.username} has no createdTimestamp - cannot expire`);
            return false;
        }

        // Calculate age in minutes
        const createdDate = new Date(createdTimestamp);
        const now = new Date();
        const ageMinutes = (now - createdDate) / (1000 * 60);

        console.log(`[DemoSessionCleanupDaemon] User ${kcUser.username}:`);
        console.log(`  - Created: ${createdDate.toISOString()}`);
        console.log(`  - Now: ${now.toISOString()}`);
        console.log(`  - Age: ${ageMinutes.toFixed(2)} minutes`);
        console.log(`  - Max duration: ${this.maxSessionDurationMin} minutes`);
        console.log(`  - Is old enough: ${ageMinutes > this.maxSessionDurationMin}`);

        // Check if user exists in Roundcube DB (this daemon only handles roundcube demo cleanup)
        // Note: Roundcube stores email addresses in the 'username' column (not usernames!)
        // So we must use kcUser.email for Roundcube operations, not kcUser.username
        let existsInWebmail = false;
        const userEmail = kcUser.email || `${kcUser.username}@${process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space'}`;

        try {
            console.log(`[DemoSessionCleanupDaemon] Checking if user ${kcUser.username} (email: ${userEmail}) exists in Roundcube...`);
            existsInWebmail = await roundcubeUserService.userExists(userEmail);
            console.log(`[DemoSessionCleanupDaemon] User ${userEmail} exists in Roundcube: ${existsInWebmail}`);
        } catch (error) {
            console.error(`[DemoSessionCleanupDaemon] Error checking roundcube existence for ${userEmail}:`, error.message);
            console.error(`[DemoSessionCleanupDaemon] Roundcube check error stack:`, error.stack);
            return false;
        }

        const shouldExpire = existsInWebmail && ageMinutes > this.maxSessionDurationMin;
        console.log(`[DemoSessionCleanupDaemon] FINAL DECISION for ${kcUser.username}:`);
        console.log(`  - existsInWebmail: ${existsInWebmail}`);
        console.log(`  - ageMinutes > maxDuration: ${ageMinutes > this.maxSessionDurationMin}`);
        console.log(`  - SHOULD EXPIRE: ${shouldExpire}`);

        // Only expire if user exists in Roundcube DB and is older than max duration
        return shouldExpire;
    }

    /**
     * Delete user from all systems (Keycloak, Stalwart, webmail DB)
     * @param {Object} kcUser - Keycloak user object
     * @returns {Promise<Object>} Result object
     */
    async deleteUser(kcUser) {
        const username = kcUser.username;
        const email = kcUser.email || `${username}@${process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space'}`;
        const results = {
            keycloak: null,
            stalwart: null,
            webmail: null
        };

        console.log(`[DemoSessionCleanupDaemon] * Starting deletion process for user: ${username}`);
        console.log(`[DemoSessionCleanupDaemon] User details: username=${username}, email=${email}, id=${kcUser.id}`);

        // CRITICAL: Delete Stalwart FIRST, before Keycloak, in case Keycloak deletion affects Stalwart access
        // 1. Delete from Stalwart (FIRST - most critical for security)
        if (mailService.getProvider() === 'stalwart') {
            console.log(`[DemoSessionCleanupDaemon] * Step 1: Deleting mailbox from Stalwart (FIRST - before Keycloak)...`);
            console.log(`[DemoSessionCleanupDaemon] Using identifier: ${username} (username - based on working test pattern)`);
            console.log(`[DemoSessionCleanupDaemon] Alternative identifier: ${email} (email)`);

            // Try direct HTTP API call first (like working tmp_stalwart_proof.js)
            try {
                console.log(`[DemoSessionCleanupDaemon] Making direct HTTP API call to Stalwart (like working test script)...`);
                console.log(`[DemoSessionCleanupDaemon] Using username: ${username} (matching working test script pattern)`);
                const apiResult = await deleteStalwartMailboxViaAPI(username); // Use username like test script
                console.log(`[DemoSessionCleanupDaemon] Stalwart API result:`, JSON.stringify(apiResult, null, 2));

                if (apiResult.success) {
                    if (apiResult.message && apiResult.message.includes('not found')) {
                        console.log(`[DemoSessionCleanupDaemon] [?] Mailbox ${username} not found in Stalwart (may never have been created or already deleted)`);
                    } else {
                        console.log(`[DemoSessionCleanupDaemon] OK Mailbox ${username} deleted from Stalwart successfully`);
                    }
                    results.stalwart = apiResult;
                } else {
                    console.warn(`[DemoSessionCleanupDaemon] [?] Direct API Stalwart deletion failed: ${apiResult.error}`);

                    // Fallback: Try with email
                    console.log(`[DemoSessionCleanupDaemon] * Fallback: Trying Stalwart API with email: ${email}`);
                    const emailResult = await deleteStalwartMailboxViaAPI(email);
                    console.log(`[DemoSessionCleanupDaemon] Stalwart API email fallback result:`, JSON.stringify(emailResult, null, 2));

                    if (emailResult.success) {
                        if (emailResult.message && emailResult.message.includes('not found')) {
                            console.log(`[DemoSessionCleanupDaemon] [?] Mailbox ${email} not found in Stalwart (email fallback)`);
                        } else {
                            console.log(`[DemoSessionCleanupDaemon] OK Mailbox ${email} deleted from Stalwart successfully (email fallback)`);
                        }
                        results.stalwart = emailResult;
                    } else {
                        console.warn(`[DemoSessionCleanupDaemon] [?] Stalwart email fallback also failed: ${emailResult.error}`);
                        // Still set the result so we don't retry endlessly
                        results.stalwart = emailResult;
                    }
                }
            } catch (error) {
                console.error(`[DemoSessionCleanupDaemon] FAIL Failed Stalwart API deletion:`, error.message);
                console.error(`[DemoSessionCleanupDaemon] Stalwart API error stack:`, error.stack);
                results.stalwart = { success: false, error: error.message };
            }
        } else {
            console.log(`[DemoSessionCleanupDaemon] * Step 1: Skipping Stalwart (provider: ${mailService.getProvider()})`);
        }

        // 2. Delete from Keycloak (SECOND - after Stalwart to avoid auth issues)

        // 3. Delete from Keycloak (SECOND - after Stalwart to avoid auth issues)
        console.log(`[DemoSessionCleanupDaemon] * Step 3: Deleting user ${username} from Keycloak...`);
        try {
            await keycloakAdmin.deleteUser(kcUser.id);
            results.keycloak = { success: true };
            console.log(`[DemoSessionCleanupDaemon] OK Keycloak deletion successful for ${username}`);
        } catch (error) {
            console.error(`[DemoSessionCleanupDaemon] FAIL Failed to delete ${username} from Keycloak:`, error.message);
            console.error(`[DemoSessionCleanupDaemon] Keycloak error stack:`, error.stack);
            results.keycloak = { success: false, error: error.message };
        }

        // 4. Delete from Roundcube DB (this daemon only handles roundcube demo cleanup)
        // Note: Roundcube stores email addresses in the 'username' column (not usernames!)
        // So we must use email for Roundcube operations, not username
        console.log(`[DemoSessionCleanupDaemon] * Step 3: Deleting user from Roundcube DB...`);
        console.log(`[DemoSessionCleanupDaemon] Using identifier: ${email} (email - Roundcube uses email in username column)`);
        console.log(`[DemoSessionCleanupDaemon] Alternative identifier: ${username} (username)`);

        try {
            console.log(`[DemoSessionCleanupDaemon] Calling roundcubeUserService.deleteUser(${email})...`);
            const roundcubeResult = await roundcubeUserService.deleteUser(email);
            console.log(`[DemoSessionCleanupDaemon] Roundcube deleteUser result:`, JSON.stringify(roundcubeResult, null, 2));
            results.webmail = roundcubeResult;

            if (roundcubeResult.success) {
                console.log(`[DemoSessionCleanupDaemon] OK User ${email} deleted from Roundcube successfully`);
                if (roundcubeResult.deleted === false) {
                    console.warn(`[DemoSessionCleanupDaemon] [?] Roundcube reported: User not found (may already be deleted)`);
                }
            } else {
                console.warn(`[DemoSessionCleanupDaemon] [?] Roundcube deletion failed: ${roundcubeResult.error || roundcubeResult.message}`);
                console.warn(`[DemoSessionCleanupDaemon] Roundcube result details:`, JSON.stringify(roundcubeResult, null, 2));

                // Try with username if email failed (though this is unlikely to work based on DB schema)
                if (!roundcubeResult.success && email !== username) {
                    console.log(`[DemoSessionCleanupDaemon] * Retrying Roundcube deletion with username: ${username} (fallback)`);
                    try {
                        const retryResult = await roundcubeUserService.deleteUser(username);
                        console.log(`[DemoSessionCleanupDaemon] Roundcube retry with username result:`, JSON.stringify(retryResult, null, 2));
                        if (retryResult.success) {
                            console.log(`[DemoSessionCleanupDaemon] OK User ${username} deleted from Roundcube on retry`);
                            results.webmail = retryResult;
                        } else {
                            console.warn(`[DemoSessionCleanupDaemon] [?] Roundcube retry also failed: ${retryResult.error || retryResult.message}`);
                        }
                    } catch (retryError) {
                        console.error(`[DemoSessionCleanupDaemon] FAIL Roundcube retry error:`, retryError.message);
                    }
                }
            }
        } catch (error) {
            console.error(`[DemoSessionCleanupDaemon] FAIL Failed to delete ${email} from Roundcube:`, error.message);
            console.error(`[DemoSessionCleanupDaemon] Roundcube error stack:`, error.stack);
            results.webmail = { success: false, error: error.message };
        }

        // Consider success if at least Keycloak deletion succeeded
        const allSuccess = results.keycloak?.success &&
            (results.stalwart === null || results.stalwart?.success) &&
            (results.webmail?.success !== false);

        console.log(`[DemoSessionCleanupDaemon] * Deletion summary for ${username}:`);
        console.log(`  - Keycloak: ${results.keycloak?.success ? 'OK' : 'FAIL'}`);
        console.log(`  - Stalwart: ${results.stalwart === null ? 'NA' : (results.stalwart?.success ? 'OK' : 'FAIL')}`);
        console.log(`  - Roundcube: ${results.webmail?.success ? 'OK' : 'FAIL'}`);
        console.log(`  - Overall success: ${allSuccess ? 'OK' : 'FAIL'}`);

        return {
            success: allSuccess,
            results,
            message: allSuccess
                ? 'User deleted successfully from all systems'
                : 'User deletion completed with some errors (check details)'
        };
    }

    /**
     * Get daemon status
     */
    getStatus() {
        return {
            running: this.running,
            shouldRun: this.shouldRun(),
            intervalMs: this.intervalMs,
            maxSessionDurationMin: this.maxSessionDurationMin,
            lastCleanupTime: this.lastCleanupTime,
            isTicking: this.isTicking,
            stats: { ...this.stats }
        };
    }
}

// Singleton instance
const demoSessionCleanupDaemon = new DemoSessionCleanupDaemon();

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[DemoSessionCleanupDaemon] SIGTERM received, expiring all sessions...');
    demoSessionCleanupDaemon.stop();
    await demoSessionCleanupDaemon.expireAllSessions();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[DemoSessionCleanupDaemon] SIGINT received, expiring all sessions...');
    demoSessionCleanupDaemon.stop();
    await demoSessionCleanupDaemon.expireAllSessions();
    process.exit(0);
});

module.exports = demoSessionCleanupDaemon;


