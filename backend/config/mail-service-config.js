/**
 * Mail Service Configuration Loader
 * 
 * Loads and manages mail service configuration based on DEMO_MAIL_PROVIDER env var.
 * Supports both generic mailserver terminology and service-specific fallbacks.
 */

class MailServiceConfig {
  constructor() {
    this.provider = (process.env.DEMO_MAIL_PROVIDER || 'mailcow').toLowerCase();
    
    // Validate provider
    if (!['mailcow', 'stalwart'].includes(this.provider)) {
      console.warn(`[MailServiceConfig] Invalid provider "${this.provider}", defaulting to "mailcow"`);
      this.provider = 'mailcow';
    }
    
    this.loadConfig();
    this.loadWebmailClientConfig();
  }

  loadConfig() {
    if (this.provider === 'mailcow') {
      this.loadMailcowConfig();
    } else if (this.provider === 'stalwart') {
      this.loadStalwartConfig();
    }
    
    // Load provider display label (for UI purposes, can be mixed case)
    this.providerLabel = process.env.DEMO_MAIL_PROVIDER_LABEL || this.provider;
  }

  loadWebmailClientConfig() {
    // Get client name - normalize to lowercase for comparison (env var values should be lowercase)
    // ENV VAR RULE: Keys are UPPERCASE, values are lowercase (except *_LABEL vars for display)
    const clientName = (process.env.DEMO_SSO_MAIL_CLIENT_NAME || 'roundcube').toLowerCase();
    
    this.webmailClientName = clientName;
    this.webmailClientUrl = process.env.DEMO_SSO_MAIL_CLIENT_URL;
    this.webmailClientRedirectUrl = process.env.DEMO_SSO_MAIL_CLIENT_REDIRECT_URL;
    this.webmailClientLogoutUrl = process.env.DEMO_SSO_MAIL_CLIENT_LOGOUT_URL;
    this.webmailClientOidcClientId = process.env.KEYCLOAK_SSO_MAIL_CLIENT;
    this.webmailClientOidcClientSecret = process.env.KEYCLOAK_SSO_MAIL_CLIENT_SECRET;
    this.webmailClientOidcRedirect = process.env.KEYCLOAK_SSO_MAIL_CLIENT_REDIRECT;
    this.keycloakAuthUrlForSsoMailClients = process.env.KEYCLOAK_AUTH_URL_FOR_SSO_MAIL_CLIENTS;
    
    // Optional display label (for UI purposes only)
    this.webmailClientLabel = process.env.DEMO_SSO_MAIL_CLIENT_LABEL || clientName;
    
    // Validate required fields
    if (!this.webmailClientUrl || !this.webmailClientOidcClientId || !this.webmailClientOidcClientSecret) {
      console.warn('[MailServiceConfig] Webmail client configuration incomplete');
    }
  }



  loadMailcowConfig() {
    // Generic variables first, fallback to mailcow-specific
    this.apiUrl = process.env.DEMO_MAIL_API_URL 
      || process.env.DEMO_MAILCOW_API_URL 
      || process.env.MAILCOW_API_URL 
      || (process.env.MAILCOW_URL ? `${process.env.MAILCOW_URL.replace(/\/$/, '')}/api` : null)
      || 'https://mail.workinpilot.space/api';
    
    this.apiToken = process.env.DEMO_MAIL_API_TOKEN
      || process.env.DEMO_MAILCOW_API_TOKEN
      || process.env.MAILCOW_API_KEY;
    
    this.smtpHost = process.env.DEMO_MAIL_SMTP_HOST
      || process.env.MAILCOW_SMTP_HOST
      || 'mail.workinpilot.space';
    
    this.smtpPort = parseInt(
      process.env.DEMO_MAIL_SMTP_PORT 
      || process.env.MAILCOW_SMTP_PORT 
      || '587'
    );
    
    this.oidcClientId = process.env.DEMO_MAIL_OIDC_CLIENT_ID
      || process.env.MAILCOW_CLIENT_ID
      || 'mailcow-client';
    
    this.oidcClientSecret = process.env.DEMO_MAIL_OIDC_CLIENT_SECRET
      || process.env.MAILCOW_CLIENT_SECRET;
    
    this.baseUrl = process.env.MAILCOW_URL || 'https://mail.workinpilot.space';
  }

  loadStalwartConfig() {
    // Generic variables first, fallback to stalwart-specific
    // Prefer public URL if available (works from browser and server-side)
    this.apiUrl = process.env.DEMO_MAIL_API_URL
      || process.env.DEMO_STALWART_API_URL
      || (process.env.STALWART_URL ? `${process.env.STALWART_URL.replace(/\/$/, '')}/api` : null)
      || 'https://mailqa.workinpilot.cloud/api'; // Default to public URL if reverse proxy is configured
    
    // Stalwart Management API expects Bearer <token>
    this.apiToken = process.env.DEMO_MAIL_API_TOKEN
      || process.env.STALWART_API_KEY_AUTH_BEARER_TOKEN
      || process.env.DEMO_STALWART_API_TOKEN;
    
    this.smtpHost = process.env.DEMO_MAIL_SMTP_HOST
      || process.env.STALWART_SMTP_HOST
      || 'mailqa.workinpilot.cloud'; // Use public domain for SMTP (works from anywhere)
    
    this.smtpPort = parseInt(
      process.env.DEMO_MAIL_SMTP_PORT
      || process.env.STALWART_SMTP_PORT
      || '587'
    );
    
    this.oidcClientId = process.env.DEMO_MAIL_OIDC_CLIENT_ID
      || process.env.STALWART_CLIENT_ID;
    
    this.oidcClientSecret = process.env.DEMO_MAIL_OIDC_CLIENT_SECRET
      || process.env.STALWART_CLIENT_SECRET;
    
    this.baseUrl = process.env.STALWART_URL || 'https://mailqa.workinpilot.cloud';
    this.redirectUri = process.env.STALWART_REDIRECT_URL || `${this.baseUrl}/oidc/callback`;
  }

  getProvider() {
    // Returns lowercase value for consistent comparisons
    return this.provider;
  }

  getProviderLabel() {
    // Returns display label (can be mixed case) for UI purposes
    // Falls back to provider value if label not set
    return this.providerLabel || this.provider;
  }

  getApiUrl() {
    return this.apiUrl;
  }

  getApiToken() {
    return this.apiToken;
  }

  getSmtpHost() {
    return this.smtpHost;
  }

  getSmtpPort() {
    return this.smtpPort;
  }

  getOidcClientId() {
    return this.oidcClientId;
  }

  getOidcClientSecret() {
    return this.oidcClientSecret;
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  getRedirectUri() {
    return this.redirectUri;
  }

  getWebmailClientName() {
    // Returns lowercase value for consistent comparisons
    return this.webmailClientName || 'roundcube';
  }

  getWebmailClientLabel() {
    // Returns display label (can be mixed case) for UI purposes
    return this.webmailClientLabel || this.getWebmailClientName();
  }

  getWebmailClientUrl() {
    return this.webmailClientUrl;
  }

  getWebmailClientRedirectUrl() {
    return this.webmailClientRedirectUrl;
  }

  getWebmailClientLogoutUrl() {
    return this.webmailClientLogoutUrl;
  }

  getWebmailClientOidcClientId() {
    return this.webmailClientOidcClientId;
  }

  getWebmailClientOidcClientSecret() {
    return this.webmailClientOidcClientSecret;
  }

  getWebmailClientOidcRedirect() {
    return this.webmailClientOidcRedirect;
  }

  getKeycloakAuthUrlForSsoMailClients() {
    return this.keycloakAuthUrlForSsoMailClients;
  }

  isSogoSelected() {
    // Comparison is case-insensitive (values normalized to lowercase)
    return this.getWebmailClientName() === 'sogo';
  }

  isRoundcubeSelected() {
    // Comparison is case-insensitive (values normalized to lowercase)
    return this.getWebmailClientName() === 'roundcube';
  }

  isConfigured() {
    return !!(this.apiUrl && this.apiToken);
  }

  getConfig() {
    return {
      provider: this.provider,
      apiUrl: this.apiUrl,
      hasApiToken: !!this.apiToken,
      smtpHost: this.smtpHost,
      smtpPort: this.smtpPort,
      oidcClientId: this.oidcClientId,
      hasOidcSecret: !!this.oidcClientSecret,
      baseUrl: this.baseUrl,
      redirectUri: this.redirectUri,
      configured: this.isConfigured()
    };
  }
}

module.exports = new MailServiceConfig();

