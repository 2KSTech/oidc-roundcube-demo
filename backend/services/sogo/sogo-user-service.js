/**
 * SOGo User Service
 * 
 * Handles PostgreSQL operations for SOGo's sogo_users table.
 * Ensures Keycloak users are automatically inserted into SOGo's user source
 * for OIDC authentication to work properly.
 */

const { Pool } = require('pg');
const crypto = require('crypto');

class SogoUserService {
  constructor() {
    this.pool = null;
    this.initialized = false;
  }

  /**
   * Initialize PostgreSQL connection pool
   */
  async initialize() {
    if (this.initialized) return;

    const config = {
      host: process.env.SOGO_DB_HOST || 'localhost',
      port: parseInt(process.env.SOGO_DB_PORT || '5432', 10),
      database: process.env.SOGO_DB_NAME || 'sogo',
      user: process.env.SOGO_DB_USER || 'sogo',
      password: process.env.SOGO_DB_PASSWORD_RAW, // Raw text password (MD5 hashing done internally for sogo_users table)
      max: 5, // Connection pool size
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };

    if (!config.password) {
      console.warn('[SogoUserService] SOGO_DB_PASSWORD_RAW not set - SOGo user sync disabled');
      return;
    }

    try {
      this.pool = new Pool(config);
      // Test connection
      await this.pool.query('SELECT 1');
      this.initialized = true;
      console.log('[SogoUserService] PostgreSQL connection pool initialized');
    } catch (error) {
      console.error('[SogoUserService] Failed to initialize PostgreSQL pool:', error.message);
      this.pool = null;
    }
  }

  /**
   * Generate MD5 hash for password (SOGo requirement)
   * Note: For OIDC users, password is not used for auth, but SOGo requires the field.
   * The password stored in sogo_users.c_password is MD5 hashed, but this is separate
   * from SOGO_DB_PASSWORD_RAW which is the raw text password for connecting to PostgreSQL.
   */
  generatePasswordHash(password = null) {
    // Use a random password if not provided (OIDC users don't use password auth)
    const pwd = password || crypto.randomBytes(16).toString('hex');
    return crypto.createHash('md5').update(pwd).digest('hex');
  }

  /**
   * Ensure user exists in sogo_users table
   * Uses INSERT ... ON CONFLICT (c_uid) DO UPDATE to handle race conditions.
   * 
   * See "Locking Strategy Discussion" section in proposal for pros/cons of this approach
   * vs row-level locking.
   * 
   * @param {Object} userData - User data from Keycloak
   * @param {string} userData.keycloakId - Keycloak user ID
   * @param {string} userData.username - Username (used as c_uid)
   * @param {string} userData.email - Email address
   * @param {string} [userData.firstName] - First name
   * @param {string} [userData.lastName] - Last name
   * @returns {Promise<Object>} Result object with success flag
   */
  async ensureUserInSogo(userData) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.pool) {
      return {
        success: false,
        error: 'PostgreSQL pool not initialized'
      };
    }

    const { username, email, firstName, lastName, keycloakId } = userData;
    
    // Use username as c_uid (primary key) - this should match what SOGo expects
    const cUid = username;
    const cName = email || `${username}@${process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space'}`;
    const mail = email || cName;
    const cCn = [firstName, lastName].filter(Boolean).join(' ') || username;
    
    // Generate a dummy password hash (not used for OIDC auth, but required by schema)
    const cPassword = this.generatePasswordHash();

    const query = `
      INSERT INTO sogo_users (c_uid, c_name, c_password, mail, c_cn, kind, multiple_bookings)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (c_uid) 
      DO UPDATE SET
        c_name = EXCLUDED.c_name,
        mail = EXCLUDED.mail,
        c_cn = EXCLUDED.c_cn,
        c_password = CASE 
          WHEN sogo_users.c_password IS NULL THEN EXCLUDED.c_password 
          ELSE sogo_users.c_password 
        END
      RETURNING c_uid, c_name, mail, c_cn;
    `;

    try {
      const result = await this.pool.query(query, [
        cUid,
        cName,
        cPassword,
        mail,
        cCn,
        null, // kind - can be set later if needed
        0     // multiple_bookings - default
      ]);

      if (result.rows.length > 0) {
        return {
          success: true,
          action: result.rows[0].c_uid === cUid ? 'created' : 'updated',
          user: result.rows[0]
        };
      }

      return {
        success: false,
        error: 'No rows returned from insert'
      };
    } catch (error) {
      console.error('[SogoUserService] Error ensuring user in SOGo:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if user exists in sogo_users table
   * @param {string} cUid - User ID (username)
   * @returns {Promise<boolean>}
   */
  async userExistsInSogo(cUid) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.pool) {
      return false;
    }

    try {
      const result = await this.pool.query(
        'SELECT 1 FROM sogo_users WHERE c_uid = $1 LIMIT 1',
        [cUid]
      );
      return result.rows.length > 0;
    } catch (error) {
      console.error('[SogoUserService] Error checking user existence:', error);
      return false;
    }
  }

  /**
   * Get all users from sogo_users table
   * @returns {Promise<Array>} Array of user records
   */
  async getAllSogoUsers() {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.pool) {
      return [];
    }

    try {
      const result = await this.pool.query(
        'SELECT c_uid, c_name, mail, c_cn FROM sogo_users ORDER BY c_uid'
      );
      return result.rows;
    } catch (error) {
      console.error('[SogoUserService] Error fetching SOGo users:', error);
      return [];
    }
  }



  /**
   * Delete user from sogo_users table
   * @param {string} cUid - User ID (username)
   * @returns {Promise<Object>} Result object with success flag
   */
  async deleteUser(cUid) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.pool) {
      return {
        success: false,
        error: 'PostgreSQL pool not initialized'
      };
    }

    try {
      const result = await this.pool.query(
        'DELETE FROM sogo_users WHERE c_uid = $1',
        [cUid]
      );

      return {
        success: true,
        deleted: result.rowCount > 0,
        message: result.rowCount > 0 
          ? `User ${cUid} deleted from SOGo`
          : `User ${cUid} not found in SOGo`
      };
    } catch (error) {
      console.error('[SogoUserService] Error deleting user:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }





  /**
   * Close connection pool (for graceful shutdown)
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.initialized = false;
      console.log('[SogoUserService] PostgreSQL connection pool closed');
    }
  }
}

// Singleton instance
const sogoUserService = new SogoUserService();

module.exports = sogoUserService;

