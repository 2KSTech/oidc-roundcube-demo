/**
 * Keycloak Token Refresh Utility
 * 
 * Provides functions to:
 * - Check if access tokens are expired or expiring soon
 * - Refresh access tokens using refresh tokens
 * - Get fresh access tokens (with automatic refresh if needed)
 */

const jwt = require('jsonwebtoken');
const axios = require('axios');

/**
 * Check if a JWT token is expired or will expire soon
 * @param {string} token - JWT token to check
 * @param {number} bufferSeconds - Buffer time in seconds before considering token "expiring soon" (default: 60)
 * @returns {Object} { expired: boolean, expiringSoon: boolean, expiresAt: number, expiresIn: number, error?: string }
 */
function checkTokenExpiration(token, bufferSeconds = 60) {
  try {
    if (!token) {
      return {
        expired: true,
        expiringSoon: true,
        expiresAt: null,
        expiresIn: 0,
        error: 'Token is missing'
      };
    }

    const decoded = jwt.decode(token, { complete: false });
    
    if (!decoded) {
      return {
        expired: true,
        expiringSoon: true,
        expiresAt: null,
        expiresIn: 0,
        error: 'Failed to decode token'
      };
    }

    const exp = decoded.exp; // Expiration timestamp (Unix seconds)
    
    if (!exp) {
      return {
        expired: true,
        expiringSoon: true,
        expiresAt: null,
        expiresIn: 0,
        error: 'Token missing exp claim'
      };
    }

    const now = Math.floor(Date.now() / 1000); // Current time in Unix seconds
    const expiresIn = exp - now; // Seconds until expiration
    const expired = expiresIn <= 0;
    const expiringSoon = expiresIn <= bufferSeconds;

    return {
      expired,
      expiringSoon,
      expiresAt: exp,
      expiresIn: expiresIn > 0 ? expiresIn : 0,
      iat: decoded.iat,
      duration: decoded.exp && decoded.iat ? decoded.exp - decoded.iat : null
    };
  } catch (error) {
    return {
      expired: true,
      expiringSoon: true,
      expiresAt: null,
      expiresIn: 0,
      error: `Error checking token expiration: ${error.message}`
    };
  }
}

/**
 * Refresh Keycloak access token using refresh token
 * @param {string} refreshToken - Refresh token
 * @returns {Promise<Object>} { success: boolean, accessToken?: string, refreshToken?: string, expiresIn?: number, idToken?: string, error?: string }
 */
async function refreshKeycloakToken(refreshToken) {
  try {
    if (!refreshToken) {
      return {
        success: false,
        error: 'Refresh token is required'
      };
    }

    const keycloakUrl = process.env.KEYCLOAK_URL;
    const realm = process.env.KEYCLOAK_REALM;
    const clientId = process.env.KEYCLOAK_CLIENT_ID;
    const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;

    if (!keycloakUrl || !realm || !clientId || !clientSecret) {
      return {
        success: false,
        error: 'Keycloak configuration missing'
      };
    }

    const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;

    console.log('[KeycloakTokenRefresh] Refreshing access token...');

    const response = await axios.post(tokenUrl, new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true
    });

    if (response.status === 200 && response.data.access_token) {
      const newRefreshToken = response.data.refresh_token || refreshToken; // Use new refresh token if provided, otherwise reuse old one
      
      console.log('[KeycloakTokenRefresh] OK Token refreshed successfully');
      console.log('[KeycloakTokenRefresh] New access token expires in:', response.data.expires_in, 'seconds');
      
      return {
        success: true,
        accessToken: response.data.access_token,
        refreshToken: newRefreshToken,
        expiresIn: response.data.expires_in,
        idToken: response.data.id_token
      };
    } else {
      console.error('[KeycloakTokenRefresh] FAIL Token refresh failed:', response.status, response.data);
      return {
        success: false,
        error: `Token refresh failed: ${response.status}`,
        status: response.status,
        data: response.data
      };
    }
  } catch (error) {
    console.error('[KeycloakTokenRefresh] Error refreshing token:', error);
    return {
      success: false,
      error: error.message || 'Failed to refresh token'
    };
  }
}

/**
 * Get a fresh access token, refreshing if necessary
 * This is the main function to use - it checks expiration and refreshes automatically
 * 
 * @param {string} accessToken - Current access token
 * @param {string} refreshToken - Refresh token (optional, but required if access token is expired/expiring)
 * @param {number} bufferSeconds - Buffer time before considering token expiring (default: 60)
 * @returns {Promise<Object>} { success: boolean, accessToken: string, refreshToken?: string, wasRefreshed: boolean, error?: string }
 */
async function getFreshAccessToken(accessToken, refreshToken = null, bufferSeconds = 60) {
  try {
    if (!accessToken) {
      return {
        success: false,
        accessToken: null,
        wasRefreshed: false,
        error: 'Access token is required'
      };
    }

    // Check if token is expired or expiring soon
    const expirationCheck = checkTokenExpiration(accessToken, bufferSeconds);
    
    if (!expirationCheck.expired && !expirationCheck.expiringSoon) {
      // Token is still fresh, return as-is
      return {
        success: true,
        accessToken: accessToken,
        refreshToken: refreshToken,
        wasRefreshed: false,
        expiresIn: expirationCheck.expiresIn
      };
    }

    // Token is expired or expiring soon - need to refresh
    if (!refreshToken) {
      return {
        success: false,
        accessToken: accessToken, // Return original even though expired
        wasRefreshed: false,
        error: expirationCheck.expired 
          ? 'Access token is expired and no refresh token available'
          : 'Access token is expiring soon and no refresh token available',
        expirationCheck
      };
    }

    console.log('[KeycloakTokenRefresh] Access token is expired or expiring soon, refreshing...');
    console.log('[KeycloakTokenRefresh] Expiration status:', {
      expired: expirationCheck.expired,
      expiringSoon: expirationCheck.expiringSoon,
      expiresIn: expirationCheck.expiresIn
    });

    const refreshResult = await refreshKeycloakToken(refreshToken);
    
    if (refreshResult.success) {
      return {
        success: true,
        accessToken: refreshResult.accessToken,
        refreshToken: refreshResult.refreshToken,
        wasRefreshed: true,
        expiresIn: refreshResult.expiresIn
      };
    } else {
      // Refresh failed - return original token (even though expired) with error
      return {
        success: false,
        accessToken: accessToken,
        refreshToken: refreshToken,
        wasRefreshed: false,
        error: `Failed to refresh token: ${refreshResult.error}`,
        refreshError: refreshResult
      };
    }
  } catch (error) {
    console.error('[KeycloakTokenRefresh] Error in getFreshAccessToken:', error);
    return {
      success: false,
      accessToken: accessToken,
      refreshToken: refreshToken,
      wasRefreshed: false,
      error: error.message || 'Failed to get fresh access token'
    };
  }
}

/**
 * Get fresh access token from request (checks session and user object)
 * Convenience function that extracts tokens from req and returns fresh token
 * 
 * @param {Object} req - Express request object
 * @param {number} bufferSeconds - Buffer time before considering token expiring (default: 60)
 * @returns {Promise<Object>} { success: boolean, accessToken: string, refreshToken?: string, wasRefreshed: boolean, error?: string }
 */
async function getFreshAccessTokenFromRequest(req, bufferSeconds = 60) {
  // Try to get access token from various sources (in order of preference)
  const accessToken = req.session?.keycloakAccessToken 
    || req.user?.accessToken 
    || req.user?.access_token;
  
  // Try to get refresh token from various sources
  const refreshToken = req.session?.keycloakRefreshToken
    || req.user?.refreshToken
    || req.user?.refresh_token;

  return await getFreshAccessToken(accessToken, refreshToken, bufferSeconds);
}

module.exports = {
  checkTokenExpiration,
  refreshKeycloakToken,
  getFreshAccessToken,
  getFreshAccessTokenFromRequest
};

