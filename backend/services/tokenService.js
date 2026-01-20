/**
 * Token Service
 * 
 * Manages ID, Access, and Refresh tokens for logged-in users.
 * Tokens are issued by Keycloak at login/registration and stored here.
 * 
 * Storage:
 * - Access and ID tokens: Session storage (req.session)
 * - Refresh token: Encrypted in-memory storage
 * 
 * Features:
 * - Automatic token refresh when access token expires or is about to expire (< 1 minute)
 * - Detailed logging of token attributes (audience, scope, iat, exp, duration, remaining seconds)
 * - Token invalidation on logout
 */

const crypto = require('crypto');

class TokenService {
  constructor() {
    // In-memory storage for encrypted refresh tokens
    // Key: username/keycloakId, Value: encrypted refresh token
    this.refreshTokenStore = new Map();
    
    // Encryption key for refresh tokens (from environment or generate)
    // In production, this should be a stable secret from environment
    this.encryptionKey = process.env.TOKEN_SERVICE_ENCRYPTION_KEY || 
      crypto.randomBytes(32).toString('hex');
    
    // Keycloak configuration
    this.keycloakUrl = process.env.KEYCLOAK_URL;
    this.keycloakRealm = process.env.KEYCLOAK_REALM;
    this.keycloakClientId = process.env.KEYCLOAK_CLIENT_ID;
    this.keycloakClientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
    
    // Minimum remaining validity in seconds before refresh (default: 60 seconds)
    this.minValiditySeconds = 60;
    
    console.log('[TokenService] Initialized');
  }

  /**
   * Decode JWT token without verification (for reading claims)
   * @param {string} token - JWT token string
   * @returns {Object|null} Decoded token payload or null if invalid
   */
  _decodeToken(token) {
    if (!token || typeof token !== 'string') {
      return null;
    }
    
    try {
      // JWT tokens have 3 parts: header.payload.signature
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }
      
      // Decode payload (second part) - base64url decode
      const payload = parts[1];
      // Replace URL-safe base64 characters
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      // Add padding if needed
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
      const decoded = Buffer.from(padded, 'base64').toString('utf-8');
      
      return JSON.parse(decoded);
    } catch (error) {
      console.error('[TokenService] Error decoding token:', error.message);
      return null;
    }
  }

  /**
   * Extract and log token attributes
   * @param {string} token - JWT token
   * @param {string} tokenType - Type of token (access, id, refresh)
   * @returns {Object|null} Token info object or null
   */
  _logTokenAttributes(token, tokenType = 'unknown') {
    if (!token) {
      console.log(`[TokenService] ${tokenType} token: MISSING`);
      return null;
    }
    
    const decoded = this._decodeToken(token);
    if (!decoded) {
      console.log(`[TokenService] ${tokenType} token: INVALID (cannot decode)`);
      return null;
    }
    
    const now = Math.floor(Date.now() / 1000);
    const iat = decoded.iat || null;
    const exp = decoded.exp || null;
    const duration = exp && iat ? exp - iat : null;
    const remaining = exp ? Math.max(0, exp - now) : null;
    const isExpired = exp ? now >= exp : null;
    const audience = decoded.aud || decoded.audience || 'N/A';
    const scope = decoded.scope || decoded.scp || 'N/A';
    const subject = decoded.sub || 'N/A';
    
    console.log(`[TokenService] ${tokenType.toUpperCase()} Token Attributes:`);
    console.log(`  - Subject (sub): ${subject}`);
    console.log(`  - Audience: ${Array.isArray(audience) ? audience.join(', ') : audience}`);
    console.log(`  - Scope: ${scope}`);
    console.log(`  - Issued At (iat): ${iat ? new Date(iat * 1000).toISOString() : 'N/A'}`);
    console.log(`  - Expires At (exp): ${exp ? new Date(exp * 1000).toISOString() : 'N/A'}`);
    console.log(`  - Duration: ${duration ? `${duration}s (${Math.round(duration / 60)}m)` : 'N/A'}`);
    console.log(`  - Remaining: ${remaining !== null ? `${remaining}s (${Math.round(remaining / 60)}m)` : 'N/A'}`);
    console.log(`  - Status: ${isExpired === null ? 'UNKNOWN' : isExpired ? 'EXPIRED' : 'VALID'}`);
    
    return {
      subject,
      audience,
      scope,
      iat,
      exp,
      duration,
      remaining,
      isExpired,
      decoded
    };
  }

  /**
   * Encrypt refresh token for storage
   * @param {string} refreshToken - Plain refresh token
   * @returns {string} Encrypted token
   */
  _encryptRefreshToken(refreshToken) {
    if (!refreshToken) {
      return null;
    }
    
    try {
      const algorithm = 'aes-256-gcm';
      const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(algorithm, key, iv);
      
      let encrypted = cipher.update(refreshToken, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      // Combine IV, authTag, and encrypted data
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      console.error('[TokenService] Error encrypting refresh token:', error.message);
      return null;
    }
  }

  /**
   * Decrypt refresh token from storage
   * @param {string} encryptedToken - Encrypted token string
   * @returns {string|null} Decrypted token or null on error
   */
  _decryptRefreshToken(encryptedToken) {
    if (!encryptedToken) {
      return null;
    }
    
    try {
      const parts = encryptedToken.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted token format');
      }
      
      const [ivHex, authTagHex, encrypted] = parts;
      const algorithm = 'aes-256-gcm';
      const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('[TokenService] Error decrypting refresh token:', error.message);
      return null;
    }
  }

  /**
   * Check if access token is valid and won't expire within minValiditySeconds
   * @param {string} accessToken - Access token to check
   * @returns {boolean} True if token is valid and has sufficient remaining time
   */
  _isAccessTokenValid(accessToken) {
    if (!accessToken) {
      return false;
    }
    
    const decoded = this._decodeToken(accessToken);
    if (!decoded || !decoded.exp) {
      return false;
    }
    
    const now = Math.floor(Date.now() / 1000);
    const remaining = decoded.exp - now;
    
    // Token must be valid and have at least minValiditySeconds remaining
    return remaining > this.minValiditySeconds;
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken - Refresh token
   * @returns {Promise<Object|null>} { accessToken, refreshToken, idToken } or null on error
   */
  async _refreshAccessToken(refreshToken) {
    if (!refreshToken) {
      console.error('[TokenService] Cannot refresh: refresh token is missing');
      return null;
    }
    
    if (!this.keycloakUrl || !this.keycloakRealm || !this.keycloakClientId || !this.keycloakClientSecret) {
      console.error('[TokenService] Cannot refresh: Keycloak configuration is missing');
      return null;
    }
    
    try {
      const tokenUrl = `${this.keycloakUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/token`;
      
      console.log('[TokenService] Refreshing access token...');
      
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.keycloakClientId,
          client_secret: this.keycloakClientSecret,
          refresh_token: refreshToken
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[TokenService] Token refresh failed: ${response.status} - ${errorText}`);
        return null;
      }
      
      const tokenData = await response.json();
      
      console.log('[TokenService] Token refresh successful');
      
      // Log new token attributes
      if (tokenData.access_token) {
        this._logTokenAttributes(tokenData.access_token, 'access');
      }
      if (tokenData.id_token) {
        this._logTokenAttributes(tokenData.id_token, 'id');
      }
      if (tokenData.refresh_token) {
        console.log('[TokenService] New refresh token received');
      }
      
      return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || refreshToken, // Use new refresh token if provided, otherwise keep old one
        idToken: tokenData.id_token
      };
    } catch (error) {
      console.error('[TokenService] Error refreshing token:', error.message);
      return null;
    }
  }

  /**
   * Initialize token service for a user (called after login/registration)
   * @param {string} username - Username or keycloakId
   * @param {Object} tokens - Token object from passport.js
   * @param {string} tokens.accessToken - Access token
   * @param {string} tokens.refreshToken - Refresh token
   * @param {string} tokens.idToken - ID token
   * @param {Object} session - Express session object (req.session)
   * @returns {boolean} True if initialization successful
   */
  initializeUserTokens(username, tokens, session) {
    if (!username) {
      console.error('[TokenService] Cannot initialize: username is required');
      return false;
    }
    
    if (!tokens || !tokens.accessToken) {
      console.error('[TokenService] Cannot initialize: tokens are missing');
      return false;
    }
    
    if (!session) {
      console.error('[TokenService] Cannot initialize: session is required');
      return false;
    }
    
    try {
      console.log(`[TokenService] Initializing tokens for user: ${username}`);
      
      // Log token attributes
      this._logTokenAttributes(tokens.accessToken, 'access');
      if (tokens.idToken) {
        this._logTokenAttributes(tokens.idToken, 'id');
      }
      if (tokens.refreshToken) {
        console.log('[TokenService] Refresh token received (encrypted for storage)');
      }
      
      // Store access and ID tokens in session
      if (!session.tokenService) {
        session.tokenService = {};
      }
      session.tokenService[username] = {
        accessToken: tokens.accessToken,
        idToken: tokens.idToken || null
      };
      
      // Store encrypted refresh token in memory
      if (tokens.refreshToken) {
        const encrypted = this._encryptRefreshToken(tokens.refreshToken);
        if (encrypted) {
          this.refreshTokenStore.set(username, encrypted);
          console.log(`[TokenService] Refresh token stored (encrypted) for user: ${username}`);
        } else {
          console.error('[TokenService] Failed to encrypt refresh token');
          return false;
        }
      }
      
      console.log(`[TokenService] Token initialization complete for user: ${username}`);
      return true;
    } catch (error) {
      console.error('[TokenService] Error initializing tokens:', error.message);
      return false;
    }
  }

  /**
   * Get valid access token for a user (refreshes if needed)
   * @param {string} username - Username or keycloakId
   * @param {Object} session - Express session object (req.session)
   * @returns {Promise<string|null>} Valid access token or null on error
   */
  async getValidAccessToken(username, session) {
    if (!username) {
      console.error('[TokenService] Cannot get access token: username is required');
      return null;
    }
    
    if (!session) {
      console.error('[TokenService] Cannot get access token: session is required');
      return null;
    }
    
    try {
      console.log(`[TokenService] Getting valid access token for user: ${username}`);
      
      // Get access token from session
      const sessionTokens = session.tokenService?.[username];
      if (!sessionTokens || !sessionTokens.accessToken) {
        console.error(`[TokenService] No access token found in session for user: ${username}`);
        return null;
      }
      
      let accessToken = sessionTokens.accessToken;
      
      // Check if token is valid and has sufficient remaining time
      if (this._isAccessTokenValid(accessToken)) {
        console.log(`[TokenService] Access token is valid for user: ${username}`);
        this._logTokenAttributes(accessToken, 'access');
        return accessToken;
      }
      
      // Token is expired or about to expire, refresh it
      console.log(`[TokenService] Access token needs refresh for user: ${username}`);
      
      // Get encrypted refresh token
      const encryptedRefreshToken = this.refreshTokenStore.get(username);
      if (!encryptedRefreshToken) {
        console.error(`[TokenService] No refresh token found for user: ${username}`);
        return null;
      }
      
      // Decrypt refresh token
      const refreshToken = this._decryptRefreshToken(encryptedRefreshToken);
      if (!refreshToken) {
        console.error(`[TokenService] Failed to decrypt refresh token for user: ${username}`);
        return null;
      }
      
      // Refresh tokens
      const newTokens = await this._refreshAccessToken(refreshToken);
      if (!newTokens || !newTokens.accessToken) {
        console.error(`[TokenService] Failed to refresh access token for user: ${username}`);
        return null;
      }
      
      // Update session with new tokens
      sessionTokens.accessToken = newTokens.accessToken;
      if (newTokens.idToken) {
        sessionTokens.idToken = newTokens.idToken;
      }
      
      // Update encrypted refresh token if a new one was provided
      if (newTokens.refreshToken && newTokens.refreshToken !== refreshToken) {
        const encrypted = this._encryptRefreshToken(newTokens.refreshToken);
        if (encrypted) {
          this.refreshTokenStore.set(username, encrypted);
          console.log(`[TokenService] Updated refresh token for user: ${username}`);
        }
      }
      
      console.log(`[TokenService] Successfully refreshed access token for user: ${username}`);
      return newTokens.accessToken;
    } catch (error) {
      console.error(`[TokenService] Error getting valid access token for user ${username}:`, error.message);
      return null;
    }
  }

  /**
   * Invalidate all tokens for a user (called on logout)
   * @param {string} username - Username or keycloakId
   * @param {Object} session - Express session object (req.session)
   * @returns {boolean} True if invalidation successful
   */
  invalidateTokens(username, session) {
    if (!username) {
      console.error('[TokenService] Cannot invalidate: username is required');
      return false;
    }
    
    try {
      console.log(`[TokenService] Invalidating tokens for user: ${username}`);
      
      // Remove from session
      if (session && session.tokenService) {
        delete session.tokenService[username];
        console.log(`[TokenService] Removed tokens from session for user: ${username}`);
      }
      
      // Remove encrypted refresh token from memory
      if (this.refreshTokenStore.has(username)) {
        this.refreshTokenStore.delete(username);
        console.log(`[TokenService] Removed refresh token from memory for user: ${username}`);
      }
      
      console.log(`[TokenService] Token invalidation complete for user: ${username}`);
      return true;
    } catch (error) {
      console.error(`[TokenService] Error invalidating tokens for user ${username}:`, error.message);
      return false;
    }
  }
}

// Export singleton instance
module.exports = new TokenService();
