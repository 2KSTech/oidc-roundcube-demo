// backend/utils/token-validator.js

const jwt = require('jsonwebtoken');

/**
 * Validates that a JWT token has at least the minimum required duration
 * @param {string} token - JWT token to validate
 * @param {number} minDurationSeconds - Minimum duration in seconds (default: 2 hours = 7200)
 * @returns {Object} { valid: boolean, duration: number, error?: string, iat?: number, exp?: number }
 */
function validateTokenDuration(token, minDurationSeconds = null) {
  try {
    if (!token) {
      return {
        valid: false,
        duration: 0,
        error: 'Token is required'
      };
    }

    // Get minimum duration from env or use default (2 hours)
    const defaultMinDuration = 2 * 60 * 60; // 2 hours in seconds
    const minDuration = minDurationSeconds || 
                       parseInt(process.env.SESSION_TOKEN_MIN_DURATION_SECONDS, 10) || 
                       defaultMinDuration;

    // Decode token without verification (we only need to read claims)
    const decoded = jwt.decode(token, { complete: false });
    
    if (!decoded) {
      return {
        valid: false,
        duration: 0,
        error: 'Failed to decode token'
      };
    }

    const iat = decoded.iat; // Issued at (Unix timestamp)
    const exp = decoded.exp; // Expiration (Unix timestamp)

    if (!iat || !exp) {
      return {
        valid: false,
        duration: 0,
        error: 'Token missing iat or exp claims',
        iat: iat || null,
        exp: exp || null
      };
    }

    const duration = exp - iat; // Duration in seconds

    if (duration < minDuration) {
      return {
        valid: false,
        duration: duration,
        minRequired: minDuration,
        error: `Token duration (${duration}s) is less than required minimum (${minDuration}s)`,
        iat: iat,
        exp: exp,
        expiresIn: exp - Math.floor(Date.now() / 1000) // Remaining seconds until expiration
      };
    }

    return {
      valid: true,
      duration: duration,
      minRequired: minDuration,
      iat: iat,
      exp: exp,
      expiresIn: exp - Math.floor(Date.now() / 1000)
    };
  } catch (error) {
    return {
      valid: false,
      duration: 0,
      error: `Error validating token: ${error.message}`
    };
  }
}

module.exports = {
  validateTokenDuration
};
