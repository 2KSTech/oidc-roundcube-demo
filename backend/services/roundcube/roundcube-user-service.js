/**
 * Roundcube User Service
 * 
 * Handles MariaDB operations for Roundcube's users table.
 * Used for demo session cleanup.
 */

const mysql = require('mysql2/promise');

class RoundcubeUserService {
  constructor() {
    this.pool = null;
    this.initialized = false;
  }

  /**
   * Initialize MariaDB connection pool
   */
  async initialize() {
    if (this.initialized) return;

    const config = {
      host: process.env.ROUNDCUBE_DB_HOST || 'localhost',
      port: parseInt(process.env.ROUNDCUBE_DB_PORT || '3306', 10),
      database: process.env.ROUNDCUBE_DB_NAME || 'roundcubedb',
      user: process.env.ROUNDCUBE_DB_USER || 'roundcube',
      password: process.env.ROUNDCUBE_DB_PASSWORD_RAW,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0
    };

    if (!config.password) {
      console.warn('[RoundcubeUserService] ROUNDCUBE_DB_PASSWORD_RAW not set - Roundcube user operations disabled');
      return;
    }

    try {
      this.pool = mysql.createPool(config);
      // Test connection
      await this.pool.query('SELECT 1');
      this.initialized = true;
      console.log('[RoundcubeUserService] MariaDB connection pool initialized');
    } catch (error) {
      console.error('[RoundcubeUserService] Failed to initialize MariaDB pool:', error.message);
      this.pool = null;
    }
  }

  /**
   * Check if user exists in users table
   * @param {string} username - Username (matches username field in Roundcube users table)
   * @returns {Promise<boolean>}
   */
  async userExists(username) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.pool) {
      return false;
    }

    try {
      const [rows] = await this.pool.query(
        'SELECT 1 FROM users WHERE username = ? LIMIT 1',
        [username]
      );
      return rows.length > 0;
    } catch (error) {
      console.error('[RoundcubeUserService] Error checking user existence:', error);
      return false;
    }
  }

  /**
   * Get all users from users table
   * @returns {Promise<Array>} Array of user records
   */
  async getAllUsers() {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.pool) {
      return [];
    }

    try {
      const [rows] = await this.pool.query(
        'SELECT user_id, username, mail_host FROM users ORDER BY username'
      );
      return rows;
    } catch (error) {
      console.error('[RoundcubeUserService] Error fetching Roundcube users:', error);
      return [];
    }
  }

  /**
   * Delete user from Roundcube database
   * Note: Due to foreign key constraints with ON DELETE CASCADE, deleting from users
   * table will automatically clean up related records in cache, contacts, identities, etc.
   * @param {string} username - Username (matches username field in Roundcube users table)
   * @returns {Promise<Object>} Result object with success flag
   */
  async deleteUser(username) {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.pool) {
      return {
        success: false,
        error: 'MariaDB pool not initialized'
      };
    }

    try {
      // Delete from users table - foreign key constraints will cascade delete
      // related records in cache, contacts, identities, etc.
      const [result] = await this.pool.query(
        'DELETE FROM users WHERE username = ?',
        [username]
      );

      return {
        success: true,
        deleted: result.affectedRows > 0,
        message: result.affectedRows > 0 
          ? `User ${username} deleted from Roundcube`
          : `User ${username} not found in Roundcube`
      };
    } catch (error) {
      console.error('[RoundcubeUserService] Error deleting user:', error);
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
      console.log('[RoundcubeUserService] MariaDB connection pool closed');
    }
  }
}

// Singleton instance
const roundcubeUserService = new RoundcubeUserService();

module.exports = roundcubeUserService;

