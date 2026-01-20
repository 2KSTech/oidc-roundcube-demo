/**
 * Stalwart Mail Server HTTP API Client
 * 
 * Similar to mailcow-client.js, but for Stalwart's OpenAPI REST API.
 * Reference: https://github.com/stalwartlabs/stalwart/blob/main/api/v1/openapi.yml
 */

const axios = require('axios');
const mailServiceConfig = require('../../config/mail-service-config');

class StalwartClient {
  constructor() {
    this.config = mailServiceConfig;
    const explicitApiUrl = this.config.getApiUrl();
    this.apiBaseUrl = explicitApiUrl || 'http://localhost:8082/api';
    this.apiToken = this.config.getApiToken();
    
    // Stalwart Management API expects Bearer token
    const authHeader = this.apiToken 
      ? `Bearer ${this.apiToken}`
      : null;
    
    this.http = axios.create({
      baseURL: this.apiBaseUrl,
      timeout: 7000,
      headers: authHeader ? { 
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      } : {}
    });
  }

  isConfigured() {
    return !!(this.apiBaseUrl && this.apiToken);
  }

  /**
   * Get OAuth token (for API authentication)
   * @returns {Promise<Object>}
   */
  async getOAuthToken() {
    try {
      if (!this.isConfigured()) {
        return { success: false, status: 0, error: 'Stalwart client not configured' };
      }
      const res = await this.http.post('/oauth', {}, { validateStatus: () => true });
      if (res.status === 200 && res.data && res.data.data) {
        return { success: true, status: 200, token: res.data.data };
      }
      return { success: false, status: res.status, error: 'Unexpected response', data: res.data };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }

  /**
   * Get principal (mailbox/user) by email or ID
   * @param {string} identifier - Email address or principal ID
   * @returns {Promise<Object>}
   *
  async getPrincipal(identifier) {
    try {
      if (!this.isConfigured()) {
        return { success: false, status: 0, error: 'Stalwart client not configured' };
      }
      const encoded = encodeURIComponent(identifier);
      const res = await this.http.get(`/principal/${encoded}`, { validateStatus: () => true });
      if (res.status === 200 && res.data) {
        return { success: true, status: 200, principal: (res.data && res.data.data) ? res.data.data : res.data };
      }
      if (res.status === 404) {
        return { success: false, status: 404, error: 'Principal not found' };
      }
      return { success: false, status: res.status, error: 'Unexpected response', data: res.data };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }
   */
async getPrincipal(identifier) {
  try {
    if (!this.isConfigured()) {
      return { success: false, status: 0, error: 'Stalwart client not configured' };
    }
    const encoded = encodeURIComponent(identifier);
    const res = await this.http.get(`/principal/${encoded}`, { validateStatus: () => true });
    
    // Handle HTTP 404 status
    if (res.status === 404) {
      return { success: false, status: 404, error: 'Principal not found' };
    }
    
    // Handle HTTP 200 but check response body for error indicators
    if (res.status === 200 && res.data) {
      const responseData = (res.data && res.data.data) ? res.data.data : res.data;
      
      // Check if response contains an error field indicating "notFound"
      if (responseData && (responseData.error === 'notFound' || 
                          responseData.error === 'NotFound' ||
                          responseData.error === 'not_found' ||
                          (typeof responseData.error === 'string' && responseData.error.toLowerCase().includes('not found')))) {
        return { success: false, status: 404, error: 'Principal not found', data: responseData };
      }
      
      // Check if response is an error object structure (has error field but not a valid principal)
      if (responseData && responseData.error && !responseData.id && !responseData.name && !responseData.email) {
        return { success: false, status: 404, error: responseData.error || 'Principal not found', data: responseData };
      }
      
      // Valid principal data - return success
      return { success: true, status: 200, principal: responseData };
    }
    
    // Any other status code
    return { success: false, status: res.status, error: 'Unexpected response', data: res.data };
  } catch (err) {
    return { success: false, status: 0, error: err.message || String(err) };
  }
}

  /**
   * Create a new principal (mailbox/user)
   * @param {Object} principalData - Principal data
   * @param {string} principalData.name - User name
   * @param {string} principalData.email - Email address
   * @param {string} [principalData.type] - Principal type (individual, group, etc.)
   * @returns {Promise<Object>}
   */
  async createPrincipal(principalData) {
    try {
      if (!this.isConfigured()) {
        return { success: false, status: 0, error: 'Stalwart client not configured' };
      }
      const res = await this.http.post('/principal', principalData, { validateStatus: () => true });
      if (res.status >= 200 && res.status < 300) {
        return { success: true, status: res.status, principal: res.data };
      }
      return { success: false, status: res.status, error: 'Request failed', data: res.data };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }

  /**
   * Get mailbox status/unseen count
   * Note: This may require IMAP query or different endpoint - needs verification
   * @param {string} accountId - Account/principal ID
   * @returns {Promise<Object>}
   */
  async getMailboxStatus(accountId) {
    try {
      if (!this.isConfigured()) {
        return { success: false, status: 0, error: 'Stalwart client not configured' };
      }
      // This endpoint may need to be adjusted based on Stalwart's actual API
      const res = await this.http.get(`/principal/${encodeURIComponent(accountId)}/mailbox/status`, { validateStatus: () => true });
      if (res.status === 200 && res.data) {
        return { success: true, status: 200, data: res.data };
      }
      return { success: false, status: res.status, error: 'Request failed', data: res.data };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }

  /**
   * List all principals
   * @param {Object} [options] - Query options
   * @returns {Promise<Object>}
   */
  async listPrincipals(options = {}) {
    try {
      if (!this.isConfigured()) {
        return { success: false, status: 0, error: 'Stalwart client not configured' };
      }
      const res = await this.http.get('/principal', { 
        params: options,
        validateStatus: () => true 
      });
      if (res.status === 200 && res.data) {
        return { success: true, status: 200, principals: Array.isArray(res.data) ? res.data : res.data.data || [] };
      }
      return { success: false, status: res.status, error: 'Request failed', data: res.data };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }

  /**
   * Delete a principal (mailbox/user account)
   * DELETE /principal/{principal_id}
   * @param {string} principalId - Principal identifier (name field for Individual)
   * @returns {Promise<Object>}
   */
  async deletePrincipal(principalId) {
    try {
      if (!this.isConfigured()) {
        return { success: false, status: 0, error: 'Stalwart client not configured' };
      }
      const encoded = encodeURIComponent(principalId);
      const res = await this.http.delete(`/principal/${encoded}`, { validateStatus: () => true });
      if (res.status >= 200 && res.status < 300) {
        return { success: true, status: res.status };
      }
      if (res.status === 404) {
        return { success: false, status: 404, error: 'Principal not found' };
      }
      return { success: false, status: res.status, error: 'Request failed', data: res.data };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }
}

module.exports = new StalwartClient();

