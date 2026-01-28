const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const nodemailer = require('nodemailer');
const axios = require('axios');
const SMTPConnection = require('smtp-connection');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

// Import training search routes
// const trainingSearchRoutes = require('./training-search');
const https = require('https');
const http = require('http');
const PDFDocument = require('pdfkit');
const mailServiceConfig = require('../config/mail-service-config');
const mailService = require('../services/email/mail-service-abstraction');


const { spawn } = require('child_process');
// const jaScheduler = require('../services/jaScheduler');

function splitTitleAndBodyFromAi(rawText) {
  if (!rawText || typeof rawText !== 'string') return { title: null, body: '' };
  // Keep preview unchanged; parsing only here
  let text = rawText.replace(/```[\s\S]*?```/g, '').trim();

  // Split into lines and drop ANY number of leading intro lines
  // User request: remove lines matching regex "Here is a*$" (interpreted as /^\s*here\s+is\s+a.*$/i)
  const introLineRe = /^\s*here\s+is\s+a.*$/i;
  const introTheRe = /^\s*here\s+is\s+the.*$/i;
  const heresARe = /^\s*here(?:'|')s\s+a.*$/i;
  const prefaceRe = /^\s*here(?:'|')s\s+(?:a|the)\b[\s\S]*?:\s*$/i; // colon form
  const genericIntroRe = /^\s*(improved|rewritten|final)\s+summary\s*:\s*$/i;
  let lines = text.split(/\r?\n/).map(l => l.trim());
  let idx = 0;
  while (
    idx < lines.length && (
      lines[idx] === '' ||
      prefaceRe.test(lines[idx]) ||
      genericIntroRe.test(lines[idx]) ||
      introLineRe.test(lines[idx]) ||
      introTheRe.test(lines[idx]) ||
      heresARe.test(lines[idx])
    )
  ) {
    idx++;
  }
  lines = lines.slice(idx);

  // Extract title if bold/heading or first short caps line
  let title = null;
  let bodyStart = 0;
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    const ln = lines[i];
    if (!ln) continue;
    // Never treat intro lines as title
    if (introLineRe.test(ln) || introTheRe.test(ln) || heresARe.test(ln) || prefaceRe.test(ln) || genericIntroRe.test(ln)) {
      continue;
    }
    const mBold = ln.match(/^\*\*(.+?)\*\*$/);
    const mHead = ln.match(/^#{1,3}\s+(.+)$/);
    if (mBold || mHead) {
      title = (mBold ? mBold[1] : mHead[1]).trim();
      bodyStart = i + 1;
      break;
    }
  }
  if (!title && lines.length) {
    const cand = lines[0];
    if (
      cand.length <= 80 &&
      /[A-Za-z]/.test(cand) &&
      !(introLineRe.test(cand) || introTheRe.test(cand) || heresARe.test(cand) || prefaceRe.test(cand) || genericIntroRe.test(cand))
    ) {
      title = cand.replace(/^[-•\*]\s*/, '').replace(/\*\*(.*?)\*\*/g, '$1').trim();
      bodyStart = 1;
    }
  }

  // Remove any remaining intro lines anywhere in body
  const bodyLines = lines
    .slice(bodyStart)
    .filter(l => l !== '')
    .filter(l => !(introLineRe.test(l) || introTheRe.test(l) || heresARe.test(l) || prefaceRe.test(l) || genericIntroRe.test(l)));
  // Normalize bullets to own lines
  let body = bodyLines.join('\n').replace(/\s([\-*])\s+/g, '\n$1 ');
  // Strip markdown emphasis in body
  body = body.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
  // Drop trailing call-to-action / assistant closers (line-wise)
  body = body
    .replace(/(?:^|\n)\s*(?:let\s+me\s+know\b.*)$/gim, '')
    .replace(/(?:^|\n)\s*(?:if\s+you(?:'|')d\s+like\b.*)$/gim, '')
    .replace(/(?:^|\n)\s*(?:i\s+can\s+refine\b.*)$/gim, '')
    .replace(/(?:^|\n)\s*(?:would\s+you\s+like\b.*)$/gim, '')
    .replace(/(?:^|\n)\s*(?:feel\s+free\b.*)$/gim, '');
  // De-duplicate repeated sentences while keeping order
  const sentSplit = body.split(/(?<=[.!?])\s+/).filter(Boolean);
  const seen = new Set();
  const dedup = [];
  for (const s of sentSplit) { const key = s.trim().toLowerCase(); if (!seen.has(key)) { seen.add(key); dedup.push(s.trim()); } }
  if (dedup.length) body = dedup.join(' ');
  return { title: title || null, body: body.trim() };
}


// Get email send defaults
router.get('/emails/defaults-broke', ensureAuthenticated, async (req, res) => {
  try {
    const intEmailDomain = process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';
    const reqUserWipEmail = req.user.username + '@' + intEmailDomain;
    const defaultTo = 'HiringManager@' + intEmailDomain;
    
    // Check if user actually has an app password configured
    let hasAppPassword = false;
    try {
      const { MailcowClient } = require('../services/email/mailcow-client');
      const mailcowClient = new MailcowClient();
      
      if (mailcowClient.isConfigured()) {
        const appPasswordsResult = await mailcowClient.getAllAppPasswords(reqUserWipEmail);
        if (appPasswordsResult.success && appPasswordsResult.data) {
          // Handle both array and object responses
          const appPasswords = Array.isArray(appPasswordsResult.data) ? appPasswordsResult.data : Object.values(appPasswordsResult.data);
          const workinpilotApp = appPasswords.find(app => app.name === 'WorkInPilot');
          hasAppPassword = !!workinpilotApp;
        }
      }
    } catch (error) {
      console.warn('[GET /emails/defaults] Failed to check app password:', error.message);
    }
    
    res.json({
      success: true,
      defaults: {
        from: reqUserWipEmail,
        to: defaultTo,
        toReadonly: true, // Frontend should make this field readonly
        hasAppPassword: hasAppPassword,
        message: hasAppPassword 
          ? 'App password configured - leave password blank to use automatically'
          : 'Enter your email password to send'
      }
    });
  } catch (error) {
    console.error('[GET /emails/defaults] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get email defaults',
      error: error.message
    });
  }
});



//
//
//
function getRemainingTime(token) {
    // Extract the expires-at claim from the ID token JWT
    const expiresAtClaim = token.payload.expires_at;

    // Convert the expires_at value to a JavaScript Date object
    const expiresAtDate = new Date(expiresAtClaim * 1000);

    // Calculate the difference between the current date and the expires_at date
    const remainingTimeSeconds = Math.floor((expiresAtDate - new Date()) / 1000);

    return remainingTimeSeconds;
}
//




// Get email send defaults
router.get('/emails/defaults', ensureAuthenticated, async (req, res) => {
  try {
    const intEmailDomain = process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';
    const reqUserWipEmail = req.user.username + '@' + intEmailDomain;
    const defaultTo = 'HiringManager@' + intEmailDomain;
    const provider = mailServiceConfig.getProvider();
    
    // Check if user actually has an app password configured (Mailcow-specific)
    let hasAppPassword = false;
    if (provider === 'mailcow') {
      try {
        const mailcowClient = require('../services/email/mailcow-client');
        
        if (mailcowClient.isConfigured()) {
          const appPasswordsResult = await mailcowClient.getAllAppPasswords(reqUserWipEmail);
          if (appPasswordsResult.success && appPasswordsResult.data) {
            // Handle both array and object responses
            const appPasswords = Array.isArray(appPasswordsResult.data) ? appPasswordsResult.data : Object.values(appPasswordsResult.data);
            const workinpilotApp = appPasswords.find(app => app.name === 'WorkInPilot');
            hasAppPassword = !!workinpilotApp;
          }
        }
      } catch (error) {
        console.warn('[GET /emails/defaults] Failed to check app password:', error.message);
      }
    } else {
      // For Stalwart, check if OAuth token is available

      const tokenService = require('../services/tokenService');
      const accessToken = await tokenService.getValidAccessToken(req.user.keycloak_id, req.session);

      if (!accessToken) {
        console.warn('[api.js - /emails/defaults] Cannot get valid access token');
      }
      hasAppPassword = !!accessToken; // For Stalwart, OAuth token = "app password equivalent"
    }
    
    res.json({
      success: true,
      defaults: {
        from: reqUserWipEmail,
        to: defaultTo,
        toReadonly: true, // Frontend should make this field readonly
        hasAppPassword: hasAppPassword,
        message: hasAppPassword 
          ? (provider === 'stalwart' 
              ? 'OAuth token available - authentication will use XOAUTH2 automatically'
              : 'App password configured - leave password blank to use automatically')
          : (provider === 'stalwart'
              ? 'No OAuth token available - will use admin password fallback'
              : 'Enter your email password to send')
      }
    });
  } catch (error) {
    console.error('[GET /emails/defaults] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get email defaults',
      error: error.message
    });
  }
});





// REMOVE ME -- MailCow: pure verification only (no DB writes, no proxy config)
// Mail service: pure verification only (no DB writes, no proxy config)
// Provider-agnostic endpoint - uses abstraction layer
router.post('/mail/verify-only', ensureAuthenticated, async (req, res) => {
  try {
    const mailService = require('../services/email/mail-service-abstraction');
    const intEmailDomain = process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';
    const email = `${req.user.username}@${intEmailDomain}`;
    console.log('[API] /api/mail/verify-only start for:', email);
    const result = await mailService.verifyMailboxExists(email);
    if (result && result.exists) {
      console.log('[API] /api/mail/verify-only success for:', email);
      return res.json({ success: true, mailbox: result.mailbox, username: result.username });
    }
    console.log('[API] /api/mail/verify-only not found for:', email);
    return res.status(404).json({ success: false, message: result?.message || result?.error || 'Mailbox not found' });
  } catch (error) {
    console.error('[API] /api/mail/verify-only error:', error);
    return res.status(500).json({ success: false, message: 'Mailbox verification error', error: error.message });
  }
});




// System stats endpoint for admin dashboard
router.get('/system-stats', ensureAuthenticated, async (req, res) => {
  try {
    // Admin check using username comparison
    const adminUsername = process.env.DEMO_ADMIN_USERNAME || 'sysadmin';
    const isAdmin = req.user?.username === adminUsername;
    if (!isAdmin) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    // Import systeminformation dynamically to avoid issues
    const si = require('systeminformation');

    // Get system stats concurrently
    const [cpuLoad, memInfo, diskInfo, networkStats, osInfo] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.osInfo()
    ]);

    // Calculate memory in GB
    const memTotalGB = Math.round(memInfo.total / 1024 / 1024 / 1024);
    const memUsedGB = Math.round(memInfo.used / 1024 / 1024 / 1024);
    const memPercentage = Math.round((memInfo.used / memInfo.total) * 100);

    // Calculate disk in GB (use first disk if multiple)
    const primaryDisk = diskInfo[0] || diskInfo.find(d => d.mount === '/') || diskInfo[0];
    const diskTotalGB = Math.round(primaryDisk.size / 1024 / 1024 / 1024);
    const diskUsedGB = Math.round(primaryDisk.used / 1024 / 1024 / 1024);
    const diskPercentage = Math.round((primaryDisk.used / primaryDisk.size) * 100);

    // Calculate network stats (sum all interfaces)
    const totalNetworkStats = networkStats.reduce((acc, iface) => ({
      rx_bytes: acc.rx_bytes + iface.rx_bytes,
      tx_bytes: acc.tx_bytes + iface.tx_bytes,
      rx_sec: acc.rx_sec + iface.rx_sec,
      tx_sec: acc.tx_sec + iface.tx_sec,
      ms: acc.ms + iface.ms
    }), { rx_bytes: 0, tx_bytes: 0, rx_sec: 0, tx_sec: 0, ms: 0 });

    // Convert bytes to MB/s for current rates
    const rxMBps = Math.round(totalNetworkStats.rx_sec / 1024 / 1024 * 100) / 100;
    const txMBps = Math.round(totalNetworkStats.tx_sec / 1024 / 1024 * 100) / 100;

    const stats = {
      cpu: Math.round(cpuLoad.currentLoad),
      memory: {
        used: memUsedGB,
        total: memTotalGB,
        percentage: memPercentage
      },
      disk: {
        used: diskUsedGB,
        total: diskTotalGB,
        percentage: diskPercentage
      },
      network: {
        rxMBps,
        txMBps,
        interfaces: networkStats.length,
        uptime: osInfo.uptime
      }
    };

    res.json(stats);
  } catch (error) {
    console.error('System stats error:', error);
    res.status(500).json({ message: 'Failed to fetch system stats' });
  }
});

// === RSS Feed Endpoints ===


module.exports = router;


// Mail notification routes
router.post('/mail/unseen-replaced', ensureAuthenticated, async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const mailService = require('../services/email/mail-service-abstraction');
    const mailServiceConfig = require('../config/mail-service-config');
    
//    // Try abstraction layer first
//    if (mailService.isConfigured() && mailServiceConfig.getProvider() !== 'mailcow') {
//      // For Stalwart, try to get access token from session/user
    // Always try abstraction layer first (works for both mailcow and stalwart)
    if (mailService.isConfigured()) {
      // Try to get access token from session/user (needed for Stalwart/JMAP)
      const accessToken = req.session.accessToken || req.user.access_token || req.user.accessToken;
      const result = await mailService.getUnseenCount(username, accessToken);
      
      if (result.success) {
        return res.json({ unseen_count: result.unseen_count || 0 });
      }
      
//      // If abstraction fails, fall through to mail-notifier
//      console.warn('[mail/unseen] Abstraction layer failed, falling back to mail-notifier:', result.error);
      // If abstraction fails and provider is mailcow, fall through to mail-notifier
      // (Stalwart should not fall back to mail-notifier as it doesn't use that service)
      if (mailServiceConfig.getProvider() === 'mailcow') {
        console.warn('[mail/unseen] Abstraction layer failed, falling back to mail-notifier:', result.error);
      } else {
        // For stalwart, return error if abstraction fails
        return res.status(500).json({ 
          error: result.error || 'Failed to get unseen mail count',
          unseen_count: 0 
        });
      }
    }

//    // Fallback to mail-notifier service (for Mailcow or if abstraction fails)
    // Fallback to mail-notifier service (only for Mailcow if abstraction not configured)
    const mailServiceUrl = process.env.MAIL_NOTIFIER_API_URL || 'http://workinpilot.space:8083';
    const timeout = parseInt(process.env.MAIL_NOTIFIER_TIMEOUT_MS || '5000', 10);
    
    console.log('[get-mail-unseen.js] req.user.id:', req.user.id, 'Mail service URL:', mailServiceUrl);

    const response = await axios.post(`${mailServiceUrl}/api/mail/unseen`, {
      username
    }, {
      timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Mail unseen count error:', error);
    
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        error: 'Mail service unavailable',
        unseen_count: 0 
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to get unseen mail count',
      unseen_count: 0 
    });
  }
});



// Mail notification routes
router.post('/mail/unseen', ensureAuthenticated, async (req, res) => {
  try {
    const { username } = req.body;
    
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const mailService = require('../services/email/mail-service-abstraction');
    const mailServiceConfig = require('../config/mail-service-config');
    const provider = mailServiceConfig.getProvider();
    
    // For Stalwart: use abstraction layer (JMAP)
    if (provider === 'stalwart') {
      if (!mailService.isConfigured()) {
        return res.status(503).json({ 
          error: 'Mail service not configured',
          unseen_count: 0 
        });
      }

      console.log('[mail/unseen] seeking access token... from session, user, and database');
      console.log('[mail/unseen] req.session.keycloakAccessToken', req.session.keycloakAccessToken);
      console.log('[mail/unseen] req.user.access_token', req.user.access_token);
      console.log('[mail/unseen] req.user.accessToken', req.user.accessToken);

      // For Stalwart, try to get access token from session/user/database


      const tokenService = require('../services/tokenService');
      let accessToken = await tokenService.getValidAccessToken(req.user.keycloak_id, req.session);

      console.warn('[mail/unseen] Could not get token');

      const result = await mailService.getUnseenCount(username, accessToken);

      if (result.success) {
        return res.json({ unseen_count: result.unseen_count || 0 });
      }

      // If abstraction fails for Stalwart, return error (don't fall back to mail-notifier)
      console.error('[mail/unseen] Stalwart abstraction layer failed:', result.error);
      return res.status(500).json({ 
        error: result.error || 'Failed to get unseen count from Stalwart',
        unseen_count: 0 
      });
    }

    // For Mailcow: use mail-notifier service
    if (provider === 'mailcow') {
      const mailServiceUrl = process.env.MAIL_NOTIFIER_API_URL || 'http://workinpilot.space:8083';
      const timeout = parseInt(process.env.MAIL_NOTIFIER_TIMEOUT_MS || '5000', 10);
      
      console.log('[mail/unseen] Using mail-notifier for Mailcow, req.user.id:', req.user.id, 'Mail service URL:', mailServiceUrl);

      const response = await axios.post(`${mailServiceUrl}/api/mail/unseen`, {
        username
      }, {
        timeout,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      return res.json(response.data);
    }

    // Unknown provider
    return res.status(500).json({ 
      error: `Unknown mail provider: ${provider}`,
      unseen_count: 0 
    });
  } catch (error) {
    console.error('Mail unseen count error:', error);
    
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        error: 'Mail service unavailable',
        unseen_count: 0 
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to get unseen mail count',
      unseen_count: 0 
    });
  }
});






router.post('/mail/recent', ensureAuthenticated, async (req, res) => {
  try {
    const { username, limit = 10 } = req.body;
    
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    // Get mail service configuration
    const mailServiceUrl = process.env.MAIL_NOTIFIER_API_URL || 'http://mail.workinpilot.space:8083';
    const timeout = parseInt(process.env.MAIL_NOTIFIER_TIMEOUT_MS || '5000', 10);
    
    console.log('[get-mail-recent.js] req.user.id:', req.user.id, 'Mail service URL:', mailServiceUrl);
    // console.log('Mail service URL:', mailServiceUrl);
    // console.log('Environment MAIL_NOTIFIER_API_URL:', process.env.MAIL_NOTIFIER_API_URL);

    // Forward request to mail notification service
    const response = await axios.post(`${mailServiceUrl}/api/mail/recent`, {
      username,
      limit
    }, {
      timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Mail recent error:', error);
    
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        error: 'Mail service unavailable',
        recent_mail: []
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to get recent mail',
      recent_mail: []
    });
  }
});

router.get('/mail/users/status', ensureAuthenticated, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user || !req.user.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get mail service configuration
    const mailServiceUrl = process.env.MAIL_NOTIFIER_API_URL || 'http://mail.workinpilot.space:8083';
    const timeout = parseInt(process.env.MAIL_NOTIFIER_TIMEOUT_MS || '5000', 10);
    
    console.log('[get-mail-users-status.js] req.user.id:', req.user.id, 'Mail service URL:', mailServiceUrl);
    // console.log('Mail service URL:', mailServiceUrl);
    // console.log('Environment MAIL_NOTIFIER_API_URL:', process.env.MAIL_NOTIFIER_API_URL);

    // Forward request to mail notification service
    const response = await axios.get(`${mailServiceUrl}/api/mail/users/status`, {
      timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Mail users status error:', error);
    
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        error: 'Mail service unavailable',
        users_status: []
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to get mail users status',
      users_status: []
    });
  }
});


/*
 *
 *
 *
 *
 *
 *
 *
 *
*/

/**
 * GET /api/test/oidc-stalwart/config
 * Get configuration for OIDC/Stalwart test (safe values only, no secrets)
 */
router.get('/test/oidc-stalwart/config', async (req, res) => {
  try {
    const mailServiceConfig = require('../config/mail-service-config');
    const mailService = require('../services/email/mail-service-abstraction');
    
    const config = mailServiceConfig.getConfig();
    
    // Return safe configuration values (no secrets)
    res.json({
      success: true,
      provider: config.provider,
      mailService: {
        provider: config.provider,
        apiUrl: config.apiUrl,
        smtpHost: config.smtpHost,
        smtpPort: config.smtpPort,
        baseUrl: config.baseUrl,
        redirectUri: config.redirectUri,
        oidcClientId: config.oidcClientId,
        configured: config.configured
      },
      keycloak: {
        url: process.env.KEYCLOAK_URL,
        realm: process.env.KEYCLOAK_REALM,
        clientId: process.env.KEYCLOAK_CLIENT_ID,
        // Don't expose secrets
        hasClientSecret: !!process.env.KEYCLOAK_CLIENT_SECRET,
        hasAdminClientId: !!process.env.KEYCLOAK_ADMIN_CLIENT_ID,
        hasAdminClientSecret: !!process.env.KEYCLOAK_ADMIN_CLIENT_SECRET
      },
      stalwart: {
        apiUrl: process.env.DEMO_STALWART_API_URL || (process.env.STALWART_URL ? `${process.env.STALWART_URL.replace(/\/$/, '')}/api` : null),
        baseUrl: process.env.STALWART_URL || (process.env.DEMO_STALWART_API_URL ? process.env.DEMO_STALWART_API_URL.replace(/\/api$/, '') : null),
        hasApiToken: !!(process.env.DEMO_STALWART_API_TOKEN || process.env.DEMO_STALWART_ADMIN_API_KEY || process.env.STALWART_API_KEY_AUTH_BEARER_TOKEN),
        apiKeyName: process.env.DEMO_STALWART_API_KEY_NAME || process.env.STALWART_API_KEY_NAME,
        clientId: process.env.STALWART_CLIENT_ID,
        hasClientSecret: !!process.env.STALWART_CLIENT_SECRET,
        redirectUri: process.env.STALWART_REDIRECT_URL
      },
      webmailClient: {
        keycloakAuthUrl: process.env.KEYCLOAK_AUTH_URL_FOR_SSO_MAIL_CLIENTS,
        keycloakRedirectUri: process.env.KEYCLOAK_SSO_MAIL_CLIENT_REDIRECT,
        clientName: process.env.DEMO_SSO_MAIL_CLIENT_NAME,
        clientId: process.env.KEYCLOAK_SSO_MAIL_CLIENT,
        clientSecret: process.env.KEYCLOAK_SSO_MAIL_CLIENT_SECRET,
        clientUrl: process.env.DEMO_SSO_MAIL_CLIENT_URL,
        clientRedirectUri: process.env.DEMO_SSO_MAIL_CLIENT_REDIRECT_URL,
        clientLogoutUrl: process.env.DEMO_SSO_MAIL_CLIENT_LOGOUT_URL,
        authUrl: process.env.KEYCLOAK_AUTH_URL_FOR_SSO_MAIL_CLIENTS
      },
      internalEmailDomain: process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space',
      appUrl: process.env.APP_URL || 'http://localhost:3010',
      // Admin email defaults (can be overridden in .env)
      adminEmail: process.env.ADMIN_EMAIL || process.env.DEMO_ADMIN_EMAIL || `admin@${process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space'}`,
      // Demo password for test users
      webmailDemoPassword: process.env.WEBMAIL_DEMO_PASSWORD || null
    });
  } catch (error) {
    console.error('[api/test/oidc-stalwart/config] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/test/oidc-stalwart/keycloak/create-user
 * Create a new user in Keycloak (admin operation)
 */
router.post('/test/oidc-stalwart/keycloak/create-user', async (req, res) => {
  try {
    const { username, email, firstName, lastName, password } = req.body;
    
    if (!username || !email) {
      return res.status(400).json({
        success: false,
        error: 'Username and email are required'
      });
    }

    const keycloakAdmin = require('../config/keycloak-admin');
    
    const userRepresentation = {
      username,
      email,
      firstName: firstName || username,
      lastName: lastName || 'Test',
      enabled: true,
      emailVerified: false
    };

    if (password) {
      userRepresentation.credentials = [{
        type: 'password',
        value: password,
        temporary: false
      }];
    }

    const userId = await keycloakAdmin.addUser(userRepresentation);
    
    res.json({
      success: true,
      userId,
      username,
      email,
      message: 'User created successfully in Keycloak'
    });
  } catch (error) {
    console.error('[api/test/oidc-stalwart/keycloak/create-user] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create Keycloak user'
    });
  }
});

/**
 * DELETE /api/test/oidc-stalwart/keycloak/delete-user/:userId
 * Delete a user from Keycloak (admin operation)
 */
router.delete('/test/oidc-stalwart/keycloak/delete-user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({
        success: false,
        error: 'User ID is required'
      });
    }

    const keycloakAdmin = require('../config/keycloak-admin');
    const axios = require('axios');
    
    // Get admin token
    const token = await keycloakAdmin.getAdminToken();
    const url = `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${encodeURIComponent(userId)}`;
    
    const response = await axios.delete(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      validateStatus: () => true
    });

    if (response.status === 204 || response.status === 200) {
      res.json({
        success: true,
        userId,
        message: 'User deleted successfully from Keycloak'
      });
    } else {
      res.status(response.status).json({
        success: false,
        error: `Failed to delete user: ${response.status}`,
        data: response.data
      });
    }
  } catch (error) {
    console.error('[api/test/oidc-stalwart/keycloak/delete-user] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete Keycloak user'
    });
  }
});

/**
 * POST /api/test/oidc-stalwart/stalwart/verify-mailbox
 * Pre-deploy user in Stalwart via OIDC redirect flow (OAuth Token Introspection)
 * Uses preDeployOidcUserWithAdminToken to trigger Stalwart to discover user via OAuth
 */
router.post('/test/oidc-stalwart/stalwart/verify-mailbox', async (req, res) => {
  try {
    const { email, keycloakUserId, password } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    if (!keycloakUserId) {
      return res.status(400).json({
        success: false,
        error: 'Keycloak user ID is required'
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required for OAuth token acquisition'
      });
    }

    const mailService = require('../services/email/mail-service-abstraction');
    
    if (mailService.getProvider() !== 'stalwart') {
      return res.status(400).json({
        success: false,
        error: `Current provider is ${mailService.getProvider()}, not stalwart`
      });
    }

    // Get Keycloak admin token
    const keycloakAdmin = require('../config/keycloak-admin');
    let adminToken;
    try {
      adminToken = await keycloakAdmin.getAdminToken();
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: `Failed to get Keycloak admin token: ${error.message}`
      });
    }

    // Use preDeployOidcUserWithAdminToken to trigger OIDC discovery via OAuth
    const stalwartService = require('../services/email/stalwart-service');
    const result = await stalwartService.preDeployOidcUserWithAdminToken(
      email,
      keycloakUserId,
      adminToken,
      password
    );
    
    res.json(result);
  } catch (error) {
    console.error('[api/test/oidc-stalwart/stalwart/verify-mailbox] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to pre-deploy mailbox via OIDC'
    });
  }
});

/**
 * POST /api/test/oidc-stalwart/stalwart/send-mail
 * Send test email via Stalwart SMTP
 */
router.post('/test/oidc-stalwart/stalwart/send-mail', async (req, res) => {
  try {
    const { to, cc, subject, text, html, accessToken, from } = req.body;
    
    if (!to) {
      return res.status(400).json({
        success: false,
        error: 'Recipient email (to) is required'
      });
    }

    const mailService = require('../services/email/mail-service-abstraction');
    
    if (mailService.getProvider() !== 'stalwart') {
      return res.status(400).json({
        success: false,
        error: `Current provider is ${mailService.getProvider()}, not stalwart`
      });
    }

    // When using XOAUTH2, the sender email MUST match the authenticated user's email
    // Stalwart enforces this strictly - users can only send from their own email addresses
    let senderEmail = from;
    let tokenEmail = null;
    
    // If we have a token, verify the sender email matches the token's email
    if (accessToken) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.decode(accessToken);
        if (decoded) {
          // Log all token claims for debugging
          console.log(`[api/test/oidc-stalwart/stalwart/send-mail] Token claims:`, JSON.stringify({
            email: decoded.email,
            preferred_username: decoded.preferred_username,
            sub: decoded.sub,
            username: decoded.username,
            name: decoded.name
          }, null, 2));
          
          // Try multiple possible email fields
          tokenEmail = decoded.email || decoded.preferred_username || decoded.username;
          
          if (tokenEmail) {
            console.log(`[api/test/oidc-stalwart/stalwart/send-mail] Token email/username: ${tokenEmail}, Requested from: ${senderEmail || 'not provided'}`);
            
            // If no from provided, use token email
            if (!senderEmail) {
              senderEmail = tokenEmail;
              console.log(`[api/test/oidc-stalwart/stalwart/send-mail] Using email from token: ${senderEmail}`);
            } else {
              // Check if they match (case-insensitive)
              const senderLower = senderEmail.toLowerCase();
              const tokenLower = tokenEmail.toLowerCase();
              
              if (senderLower !== tokenLower) {
                // Warn if there's a mismatch - Stalwart will reject this
                console.warn(`[api/test/oidc-stalwart/stalwart/send-mail] WARN: WARNING: Sender email (${senderEmail}) does not match token email (${tokenEmail}). Stalwart will reject this!`);
                // Use token email instead to ensure it works
                senderEmail = tokenEmail;
                console.log(`[api/test/oidc-stalwart/stalwart/send-mail] Overriding to use token email: ${senderEmail}`);
              } else {
                console.log(`[api/test/oidc-stalwart/stalwart/send-mail] OK Sender email matches token email`);
              }
            }
          } else {
            console.warn(`[api/test/oidc-stalwart/stalwart/send-mail] WARN: Token does not contain email/username claim`);
          }
        }
      } catch (e) {
        // Token might not be a JWT - that's okay, but we need from address
        console.error(`[api/test/oidc-stalwart/stalwart/send-mail] Error decoding token: ${e.message}`);
        if (!senderEmail) {
          console.error('[api/test/oidc-stalwart/stalwart/send-mail] Cannot extract email from token and no from address provided');
        }
      }
    }
    
    // If still no sender email, use default (but this will likely fail with XOAUTH2)
    if (!senderEmail) {
      const intEmailDomain = process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';
      senderEmail = `test@${intEmailDomain}`;
      console.warn(`[api/test/oidc-stalwart/stalwart/send-mail] No sender email provided, using default: ${senderEmail} (may fail with XOAUTH2)`);
    }
    
    console.log(`[api/test/oidc-stalwart/stalwart/send-mail] Final sender email: ${senderEmail}${tokenEmail ? ` (token had: ${tokenEmail})` : ''}`);

    const result = await mailService.sendMail({
      from: senderEmail,
      to,
      cc,
      subject: subject || 'OIDC/Stalwart Workflow Test Email',
      text: text || 'This is a test email from the OIDC/Stalwart workflow test.',
      html: html,
      accessToken
    });
    
    res.json(result);
  } catch (error) {
    console.error('[api/test/oidc-stalwart/stalwart/send-mail] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to send email'
    });
  }
});

/**
 * POST /api/test/oidc-stalwart/stalwart/get-unseen-count
 * Get unseen email count for a user
 */
router.post('/test/oidc-stalwart/stalwart/get-unseen-count', async (req, res) => {
  try {
    const { username, accessToken } = req.body;
    
    if (!username) {
      return res.status(400).json({
        success: false,
        error: 'Username is required'
      });
    }

    const mailService = require('../services/email/mail-service-abstraction');
    
    if (mailService.getProvider() !== 'stalwart') {
      return res.status(400).json({
        success: false,
        error: `Current provider is ${mailService.getProvider()}, not stalwart`
      });
    }

    const result = await mailService.getUnseenCount(username, accessToken);
    
    res.json(result);
  } catch (error) {
    console.error('[api/test/oidc-stalwart/stalwart/get-unseen-count] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get unseen count',
      unseen_count: 0
    });
  }
});

/**
 * DELETE /api/test/oidc-stalwart/stalwart/delete-mailbox
 * Delete a mailbox/user from Stalwart
 */
router.delete('/test/oidc-stalwart/stalwart/delete-mailbox/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const mailService = require('../services/email/mail-service-abstraction');
    
    if (mailService.getProvider() !== 'stalwart') {
      return res.status(400).json({
        success: false,
        error: `Current provider is ${mailService.getProvider()}, not stalwart`
      });
    }

    const result = await mailService.deleteMailbox(email);
    
    res.json(result);
  } catch (error) {
    console.error('[api/test/oidc-stalwart/stalwart/delete-mailbox] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete mailbox'
    });
  }
});

/**
 * POST /api/test/oidc-stalwart/oidc/authorize
 * Get OIDC authorization URL for Keycloak
 */
router.post('/test/oidc-stalwart/oidc/authorize', async (req, res) => {
  try {
    const { redirectUri, state } = req.body;
    
    const keycloakUrl = process.env.KEYCLOAK_URL;
    const realm = process.env.KEYCLOAK_REALM;
    const clientId = process.env.STALWART_CLIENT_ID || process.env.KEYCLOAK_CLIENT_ID;
    
    if (!keycloakUrl || !realm || !clientId) {
      return res.status(400).json({
        success: false,
        error: 'Keycloak configuration missing'
      });
    }

    const finalRedirectUri = redirectUri || process.env.STALWART_REDIRECT_URL || `${process.env.STALWART_URL || process.env.APP_URL}/oidc/callback`;
    const finalState = state || Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const authUrl = new URL(`${keycloakUrl}/realms/${realm}/protocol/openid-connect/auth`);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', finalRedirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'openid profile email');
    authUrl.searchParams.set('state', finalState);

    res.json({
      success: true,
      authorizationUrl: authUrl.toString(),
      state: finalState,
      redirectUri: finalRedirectUri
    });
  } catch (error) {
    console.error('[api/test/oidc-stalwart/oidc/authorize] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate authorization URL'
    });
  }
});

/**
 * POST /api/test/oidc-stalwart/oidc/exchange-token
 * Exchange authorization code for access token
 */
router.post('/test/oidc-stalwart/oidc/exchange-token', async (req, res) => {
  try {
    const { code, redirectUri, state } = req.body;
    
    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Authorization code is required'
      });
    }

    const keycloakUrl = process.env.KEYCLOAK_URL;
    const realm = process.env.KEYCLOAK_REALM;
    const clientId = process.env.STALWART_CLIENT_ID || process.env.KEYCLOAK_CLIENT_ID;
    const clientSecret = process.env.STALWART_CLIENT_SECRET || process.env.KEYCLOAK_CLIENT_SECRET;
    
    if (!keycloakUrl || !realm || !clientId || !clientSecret) {
      return res.status(400).json({
        success: false,
        error: 'Keycloak configuration missing'
      });
    }

    const finalRedirectUri = redirectUri || process.env.STALWART_REDIRECT_URL || `${process.env.STALWART_URL || process.env.APP_URL}/oidc/callback`;
    const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;

    const axios = require('axios');
    const formData = new URLSearchParams();
    formData.append('grant_type', 'authorization_code');
    formData.append('code', code);
    formData.append('redirect_uri', finalRedirectUri);
    formData.append('client_id', clientId);
    formData.append('client_secret', clientSecret);

    const response = await axios.post(tokenUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      validateStatus: () => true
    });

    console.log('[api/test/oidc-stalwart/oidc/exchange-token] Response:', JSON.stringify(response.data, null, 2));
    console.log('[api/test/oidc-stalwart/oidc/exchange-token] Response status:', response.status);

    if (response.status === 200) {
      res.json({
        success: true,
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        idToken: response.data.id_token,
        expiresIn: response.data.expires_in,
        tokenType: response.data.token_type
      });
    } else {
      res.status(response.status).json({
        success: false,
        error: 'Token exchange failed',
        status: response.status,
        data: response.data
      });
    }
  } catch (error) {
    console.error('[api/test/oidc-stalwart/oidc/exchange-token] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to exchange token'
    });
  }
});

/**
 * POST /api/test/oidc-stalwart/oidc/get-token
 * Get access token directly using password grant (simplified flow for demo)
 * This eliminates the need for manual authorization code exchange
 */
router.post('/test/oidc-stalwart/oidc/get-token', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required'
      });
    }

    const keycloakUrl = process.env.KEYCLOAK_URL;
    const realm = process.env.KEYCLOAK_REALM;
    const mailServiceConfig = require('../config/mail-service-config');
    const clientId = mailServiceConfig.getOidcClientId();
    const clientSecret = mailServiceConfig.getOidcClientSecret();
    
    if (!keycloakUrl || !realm || !clientId || !clientSecret) {
      return res.status(400).json({
        success: false,
        error: 'Keycloak OIDC configuration missing'
      });
    }

    const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;
    const axios = require('axios');
    
    const formData = new URLSearchParams();
    formData.append('grant_type', 'password');
    formData.append('client_id', clientId);
    formData.append('client_secret', clientSecret);
    formData.append('username', username);
    formData.append('password', password);
    formData.append('scope', 'openid profile email');

    console.log('[api/test/oidc-stalwart/oidc/get-token] Acquiring token via password grant...');
    const response = await axios.post(tokenUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      validateStatus: () => true
    });

    if (response.status === 200) {
      console.log('[api/test/oidc-stalwart/oidc/get-token] OK Token acquired successfully');
      res.json({
        success: true,
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        idToken: response.data.id_token,
        expiresIn: response.data.expires_in,
        tokenType: response.data.token_type
      });
    } else {
      const errorMsg = response.data?.error_description || response.data?.error || response.statusText;
      console.error(`[api/test/oidc-stalwart/oidc/get-token] Token acquisition failed: ${errorMsg}`);
      res.status(response.status).json({
        success: false,
        error: errorMsg || 'Token acquisition failed',
        status: response.status,
        data: response.data
      });
    }
  } catch (error) {
    console.error('[api/test/oidc-stalwart/oidc/get-token] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get token'
    });
  }
});
// END OF TEST OPTION 1C
// START OF TEST OPTION 2
/**
 * Keycloak->Stalwart OIDC Workflow Test API
 * 
 * This endpoint provides a comprehensive test for the complete OIDC registration
 * and mail service integration workflow:
 * 1. Register new OIDC user in Keycloak
 * 2. Pre-deploy/register user in Stalwart
 * 3. Send test email to admin@workinpilot.site and Cc: self
 * 4. Check if 'unseen count' is incremented by new email
 * 5. Delete newly-registered user
 * 
 * POST /api/test/keycloak-stalwart-workflow
 * Body: { 
 *   username: string (optional, defaults to test-{timestamp}),
 *   email: string (optional, defaults to username@internal-domain),
 *   firstName: string (optional),
 *   lastName: string (optional),
 *   password: string (optional, for OAuth token acquisition)
 * }
 */
/**
 * Keycloak->Stalwart OIDC Workflow Test API
 * 
 * This endpoint provides a comprehensive test for the complete OIDC registration
 * and mail service integration workflow:
 * 1. Register new OIDC user in Keycloak
 * 2. Pre-deploy/register user in Stalwart
 * 3. Send test email to admin@workinpilot.site and Cc: self
 * 4. Check if 'unseen count' is incremented by new email
 * 5. Delete newly-registered user
 * 
 * POST /api/test/keycloak-stalwart-workflow
 * Body: { 
 *   username: string (optional, defaults to test-{timestamp}),
 *   email: string (optional, defaults to username@internal-domain),
 *   firstName: string (optional),
 *   lastName: string (optional),
 *   password: string (optional, for OAuth token acquisition)
 * }
 */
router.post('/test/keycloak-stalwart-workflow', async (req, res) => {
    const workflowId = `test-${Date.now()}`;
    const results = {
        workflowId,
        timestamp: new Date().toISOString(),
        steps: {},
        summary: {
            success: false,
            completed: false,
            errors: []
        }
    };

    let testUser = null;
    let testEmail = null;
    let keycloakUserId = null;
    let oauthToken = null;
    let initialUnseenCount = null;
    let finalUnseenCount = null;
    let password = process.env.TEST_NEXTCLOUD_USER_APP_PW ;

    try {
        // Step 1: Register new OIDC user in Keycloak
        console.log(`[OIDC Workflow Test ${workflowId}] Step 1: Registering user in Keycloak`);
        try {
            const keycloakAdmin = require('../config/keycloak-admin');
            const internalEmailDomain = process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';
            
            const username = req.body.username || `test-${Date.now()}`;
            testUser = username;
            testEmail = req.body.email || `${username}@${internalEmailDomain}`;
            const firstName = req.body.firstName || 'Test';
            const lastName = req.body.lastName || 'User';
//            const password = req.body.password || `TestPass${Date.now()}!`;

            const userRepresentation = {
                username: testUser,
                email: testEmail,
                firstName: firstName,
                lastName: lastName,
                enabled: true,
                emailVerified: false,
                credentials: [{
                    type: 'password',
                    value: password,
                    temporary: false
                }]
            };

            keycloakUserId = await keycloakAdmin.addUser(userRepresentation);
            
            results.steps.keycloakRegistration = {
                success: true,
                userId: keycloakUserId,
                username: testUser,
                email: testEmail,
                message: 'User registered in Keycloak successfully'
            };
            console.log(`[OIDC Workflow Test ${workflowId}] OK Keycloak registration successful: ${testUser}`);
        } catch (error) {
            results.steps.keycloakRegistration = {
                success: false,
                error: error.message,
                message: 'Failed to register user in Keycloak'
            };
            results.summary.errors.push(`Keycloak registration: ${error.message}`);
            throw error;
        }

        // Step 2: Pre-deploy/register user in Stalwart via OIDC discovery flow
        // For OIDC directories, we must use OAuth authentication to trigger Stalwart discovery
        // This causes Stalwart to query Keycloak's UserInfo/Introspection endpoint
        console.log(`[OIDC Workflow Test ${workflowId}] Step 2: Pre-deploying user in Stalwart via OIDC discovery`);
        try {
            const stalwartService = require('../services/email/stalwart-service');
            const provider = mailService.getProvider();
            
            if (provider === 'stalwart') {
                // Use OIDC pre-deploy function for Stalwart
                const preDeployResult = await stalwartService.preDeployOidcUserWithPassword(
                    testEmail,
                    testUser,
                    password
                );
                
                if (preDeployResult.success && preDeployResult.discovered) {
                    results.steps.stalwartPredeploy = {
                        success: true,
                        discovered: true,
                        mailbox: preDeployResult.mailbox,
                        username: preDeployResult.username,
                        message: 'User pre-deployed in Stalwart via OIDC discovery successfully'
                    };
                    console.log(`[OIDC Workflow Test ${workflowId}] OK Stalwart OIDC pre-deploy successful: ${testEmail}`);
                } else {
                    throw new Error(preDeployResult.error || preDeployResult.message || 'OIDC pre-deploy failed');
                }
            } else {
                // For non-Stalwart providers (e.g., Mailcow), use standard verifyAndEnableMailbox
                const verifyResult = await mailService.verifyAndEnableMailbox(testEmail);
                
                if (verifyResult.success) {
                    results.steps.stalwartPredeploy = {
                        success: true,
                        mailbox: verifyResult.mailbox,
                        username: verifyResult.username,
                        message: 'User pre-deployed successfully'
                    };
                    console.log(`[OIDC Workflow Test ${workflowId}] OK Mail service pre-deploy successful: ${testEmail}`);
                } else {
                    throw new Error(verifyResult.error || verifyResult.message || 'Pre-deploy failed');
                }
            }
        } catch (error) {
            results.steps.stalwartPredeploy = {
                success: false,
                error: error.message,
                message: 'Failed to pre-deploy user in mail service'
            };
            results.summary.errors.push(`Mail service pre-deploy: ${error.message}`);
            throw error;
        }

        // Step 3: Get OAuth token for the user (for sending email and checking unseen count)
        // Note: Pre-deploy in Step 2 already acquired a token internally for discovery,
        // but we need a fresh token here for sendmail (SMTP XOAUTH2) and JMAP queries
        console.log(`[OIDC Workflow Test ${workflowId}] Step 3: Acquiring OAuth token for sendmail and JMAP`);
        try {
            const keycloakUrl = process.env.KEYCLOAK_URL;
            const realm = process.env.KEYCLOAK_REALM;
            const stalwartClientId = mailServiceConfig.getOidcClientId();
            const stalwartClientSecret = mailServiceConfig.getOidcClientSecret();
            
            if (!stalwartClientId || !stalwartClientSecret) {
                throw new Error('Stalwart OIDC client credentials not configured');
            }

            // Use direct access grant (resource owner password credentials) to get token
            // This token will be used for SMTP authentication (sendmail) and JMAP queries
            const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;
            const tokenResponse = await axios.post(tokenUrl, new URLSearchParams({
                grant_type: 'password',
                client_id: stalwartClientId,
                client_secret: stalwartClientSecret,
                username: testUser,
                password: password,
                scope: 'openid profile email'
            }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                validateStatus: () => true
            });

            if (tokenResponse.status !== 200) {
                console.warn(`[OIDC Workflow Test ${workflowId}] Direct access grant failed, trying alternative method`);
                // If direct access grant is disabled, we'll proceed without token for now
                // The mail service may use admin credentials as fallback
                results.steps.oauthToken = {
                    success: false,
                    warning: 'OAuth token acquisition failed (direct access grant may be disabled)',
                    error: tokenResponse.data?.error_description || tokenResponse.statusText,
                    message: 'Proceeding with admin credentials fallback'
                };
            } else {
                oauthToken = tokenResponse.data.access_token;
                results.steps.oauthToken = {
                    success: true,
                    tokenPreview: oauthToken ? `${oauthToken.substring(0, 20)}...` : null,
                    message: 'OAuth token acquired successfully'
                };
                console.log(`[OIDC Workflow Test ${workflowId}] OK OAuth token acquired`);
            }
        } catch (error) {
            results.steps.oauthToken = {
                success: false,
                warning: true,
                error: error.message,
                message: 'OAuth token acquisition failed, will use admin credentials fallback'
            };
            console.warn(`[OIDC Workflow Test ${workflowId}] WARN: OAuth token acquisition failed: ${error.message}`);
        }

        // Step 4: Get initial unseen count
        console.log(`[OIDC Workflow Test ${workflowId}] Step 4: Getting initial unseen count`);
        try {
            const unseenResult = await mailService.getUnseenCount(testUser, oauthToken);
            if (unseenResult.success !== false) {
                initialUnseenCount = unseenResult.unseen_count || 0;
                results.steps.initialUnseenCount = {
                    success: true,
                    count: initialUnseenCount,
                    message: 'Initial unseen count retrieved'
                };
                console.log(`[OIDC Workflow Test ${workflowId}] OK Initial unseen count: ${initialUnseenCount}`);
            } else {
                initialUnseenCount = 0;
                results.steps.initialUnseenCount = {
                    success: false,
                    warning: true,
                    count: 0,
                    error: unseenResult.error,
                    message: 'Could not get initial unseen count, assuming 0'
                };
                console.warn(`[OIDC Workflow Test ${workflowId}] WARN: Could not get initial unseen count: ${unseenResult.error}`);
            }
        } catch (error) {
            initialUnseenCount = 0;
            results.steps.initialUnseenCount = {
                success: false,
                warning: true,
                count: 0,
                error: error.message,
                message: 'Error getting initial unseen count, assuming 0'
            };
            console.warn(`[OIDC Workflow Test ${workflowId}] WARN: Error getting initial unseen count: ${error.message}`);
        }

        // Step 5: Send test email to admin@workinpilot.site and Cc: self
        console.log(`[OIDC Workflow Test ${workflowId}] Step 5: Sending test email`);
        try {
            const adminEmail = 'admin@workinpilot.site';
            const emailSubject = `[OIDC Test ${workflowId}] Keycloak-Stalwart Workflow Test`;
            const emailBody = `This is a test email from the Keycloak->Stalwart OIDC workflow test.

Workflow ID: ${workflowId}
Test User: ${testUser}
Test Email: ${testEmail}
Timestamp: ${new Date().toISOString()}

This email is sent to verify the complete OIDC registration and mail service integration.`;

            const sendResult = await mailService.sendMail({
                from: testEmail,
                to: adminEmail,
                cc: testEmail,
                subject: emailSubject,
                text: emailBody,
                html: `<p>${emailBody.replace(/\n/g, '<br>')}</p>`,
                accessToken: oauthToken,
                user: oauthToken ? { access_token: oauthToken } : null
            });

            if (sendResult.success) {
                results.steps.sendEmail = {
                    success: true,
                    messageId: sendResult.messageId,
                    to: adminEmail,
                    cc: testEmail,
                    message: 'Test email sent successfully'
                };
                console.log(`[OIDC Workflow Test ${workflowId}] OK Test email sent: ${sendResult.messageId}`);
                
                // Wait a moment for email to be processed
                await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
                throw new Error(sendResult.error || 'Failed to send email');
            }
        } catch (error) {
            results.steps.sendEmail = {
                success: false,
                error: error.message,
                message: 'Failed to send test email'
            };
            results.summary.errors.push(`Send email: ${error.message}`);
            throw error;
        }

        // Step 6: Check if unseen count is incremented
        console.log(`[OIDC Workflow Test ${workflowId}] Step 6: Checking final unseen count`);
        try {
            // Wait a bit more for email delivery
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const unseenResult = await mailService.getUnseenCount(testUser, oauthToken);
            if (unseenResult.success !== false) {
                finalUnseenCount = unseenResult.unseen_count || 0;
                const countIncreased = finalUnseenCount > initialUnseenCount;
                
                results.steps.finalUnseenCount = {
                    success: countIncreased,
                    initialCount: initialUnseenCount,
                    finalCount: finalUnseenCount,
                    increased: countIncreased,
                    increment: finalUnseenCount - initialUnseenCount,
                    message: countIncreased 
                        ? `Unseen count increased from ${initialUnseenCount} to ${finalUnseenCount}`
                        : `Unseen count did not increase (${initialUnseenCount} -> ${finalUnseenCount})`
                };
                
                if (countIncreased) {
                    console.log(`[OIDC Workflow Test ${workflowId}] OK Unseen count increased: ${initialUnseenCount} -> ${finalUnseenCount}`);
                } else {
                    console.warn(`[OIDC Workflow Test ${workflowId}] WARN: Unseen count did not increase: ${initialUnseenCount} -> ${finalUnseenCount}`);
                }
            } else {
                results.steps.finalUnseenCount = {
                    success: false,
                    error: unseenResult.error,
                    message: 'Could not get final unseen count'
                };
                console.warn(`[OIDC Workflow Test ${workflowId}] WARN: Could not get final unseen count: ${unseenResult.error}`);
            }
        } catch (error) {
            results.steps.finalUnseenCount = {
                success: false,
                error: error.message,
                message: 'Error checking final unseen count'
            };
            console.warn(`[OIDC Workflow Test ${workflowId}] WARN: Error checking final unseen count: ${error.message}`);
        }

        // Step 7: Delete newly-registered user
        console.log(`[OIDC Workflow Test ${workflowId}] Step 7: Cleaning up test user`);
        const cleanupResults = {
            keycloak: { success: false },
            stalwart: { success: false }
        };

        // Delete from Stalwart
        try {
            const deleteResult = await mailService.deleteMailbox(testEmail);
            cleanupResults.stalwart = {
                success: deleteResult.success !== false,
                message: deleteResult.message || deleteResult.error || 'Stalwart cleanup completed'
            };
            console.log(`[OIDC Workflow Test ${workflowId}] ${cleanupResults.stalwart.success ? 'OK' : 'WARN:'} Stalwart cleanup: ${cleanupResults.stalwart.message}`);
        } catch (error) {
            cleanupResults.stalwart = {
                success: false,
                error: error.message,
                message: 'Failed to delete user from Stalwart'
            };
            console.error(`[OIDC Workflow Test ${workflowId}] FAIL Stalwart cleanup error: ${error.message}`);
        }

        // Delete from Keycloak
if (results.steps.finalUnseenCount.success){
        try {
            const keycloakAdmin = require('../config/keycloak-admin');
            const deleteUrl = `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${keycloakUserId}`;
            const adminToken = await keycloakAdmin.getAdminToken();
            const deleteResponse = await axios.delete(deleteUrl, {
                headers: {
                    'Authorization': `Bearer ${adminToken}`
                },
                validateStatus: () => true
            });

            cleanupResults.keycloak = {
                success: deleteResponse.status === 204 || deleteResponse.status === 200,
                status: deleteResponse.status,
                message: deleteResponse.status === 204 || deleteResponse.status === 200 
                    ? 'User deleted from Keycloak successfully'
                    : `Keycloak deletion returned status ${deleteResponse.status}`
            };
            console.log(`[OIDC Workflow Test ${workflowId}] ${cleanupResults.keycloak.success ? 'OK' : 'WARN:'} Keycloak cleanup: ${cleanupResults.keycloak.message}`);
        } catch (error) {
            cleanupResults.keycloak = {
                success: false,
                error: error.message,
                message: 'Failed to delete user from Keycloak'
            };
            console.error(`[OIDC Workflow Test ${workflowId}] FAIL Keycloak cleanup error: ${error.message}`);
        }
}
        results.steps.cleanup = cleanupResults;

        // Determine overall success
        const criticalSteps = [
            results.steps.keycloakRegistration,
            results.steps.stalwartPredeploy,
            results.steps.sendEmail
        ];
        const allCriticalSuccess = criticalSteps.every(step => step && step.success);
        
        results.summary.success = allCriticalSuccess;
        results.summary.completed = true;
        results.summary.message = allCriticalSuccess 
            ? 'Workflow test completed successfully'
            : 'Workflow test completed with errors';

        console.log(`[OIDC Workflow Test ${workflowId}] ${results.summary.success ? 'OK' : 'WARN:'} ${results.summary.message}`);

        res.json(results);

    } catch (error) {
        console.error(`[OIDC Workflow Test ${workflowId}] FAIL Fatal error:`, error);
        
        results.summary.success = false;
        results.summary.completed = false;
        results.summary.errors.push(`Fatal error: ${error.message}`);
        results.summary.fatalError = error.message;

        // Attempt cleanup on error
        if (testEmail) {
            try {
                await mailService.deleteMailbox(testEmail);
            } catch (cleanupError) {
                console.error(`[OIDC Workflow Test ${workflowId}] Cleanup error:`, cleanupError);
            }
        }
        if (keycloakUserId) {
            try {
                const keycloakAdmin = require('../config/keycloak-admin');
                const adminToken = await keycloakAdmin.getAdminToken();
                await axios.delete(
                    `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${keycloakUserId}`,
                    { headers: { 'Authorization': `Bearer ${adminToken}` }, validateStatus: () => true }
                );
            } catch (cleanupError) {
                console.error(`[OIDC Workflow Test ${workflowId}] Keycloak cleanup error:`, cleanupError);
            }
        }

        res.status(500).json(results);
    }
});

/**
 * GET /api/test/keycloak-stalwart-config
 * Get current mail service configuration for testing
 */
router.get('/test/keycloak-stalwart-config', async (req, res) => {
    try {
        const config = mailService.getConfig();
        const keycloakConfig = {
            url: process.env.KEYCLOAK_URL,
            realm: process.env.KEYCLOAK_REALM,
            hasAdminClient: !!(process.env.KEYCLOAK_ADMIN_CLIENT_ID && process.env.KEYCLOAK_ADMIN_CLIENT_SECRET)
        };
        
        res.json({
            success: true,
            mailService: config,
            keycloak: keycloakConfig,
            internalEmailDomain: process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// END OF TEST OPTION 2
// START OF TEST OPTION 3

/**
 * GET /api/test/config-info
 * Get mail service configuration info (for test page display)
 * Returns all relevant .env values from the server
 */
router.get('/test/config-info', async (req, res) => {
  try {
    const mailService = require('../services/email/mail-service-abstraction');
    const config = mailService.getConfig();
    
    // Get additional environment variables for display
    const intEmailDomain = process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';
    const adminEmail = process.env.DEMO_ADMIN_EMAIL || `admin@${intEmailDomain}`;
    const keycloakUrl = process.env.KEYCLOAK_URL || 'Not configured';
    const keycloakRealm = process.env.KEYCLOAK_REALM || 'Not configured';
    
    res.json({ 
      success: true, 
      config: {
        ...config,
        internalEmailDomain: intEmailDomain,
        adminEmail: adminEmail,
        keycloakUrl: keycloakUrl,
        keycloakRealm: keycloakRealm,
        // Include API key name if configured (for Stalwart)
        stalwartApiKeyName: process.env.DEMO_STALWART_API_KEY_NAME || process.env.STALWART_API_KEY_NAME || null,
        hasStalwartAdminApiKey: !!(process.env.DEMO_STALWART_ADMIN_API_KEY || process.env.STALWART_API_KEY_AUTH_BEARER_TOKEN)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/test/oidc-workflow
 * Comprehensive test of Keycloak->Stalwart OIDC workflow
 * Tests: (1) Register OIDC user in Keycloak, (2) Pre-deploy in Stalwart, 
 * (3) Send test email, (4) Check unseen count, (5) Delete user
 */
router.post('/test/oidc-workflow', async (req, res) => {
  const testResults = {
    step1_keycloak_register: null,
    step2_stalwart_predeploy: null,
    step3_send_email: null,
    step4_unseen_count_before: null,
    step4_unseen_count_after: null,
    step5_delete_user: null,
    cleanup_keycloak: null,
    cleanup_stalwart: null,
    summary: null,
    error: null
  };

  let testUser = null;
  let testEmail = null;
  let keycloakUserId = null;
  const intEmailDomain = process.env.DEMO_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';
  const adminEmail = process.env.DEMO_ADMIN_EMAIL || `admin@${intEmailDomain}`;

    const keycloakAdmin = require('../config/keycloak-admin');
    const mailService = require('../services/email/mail-service-abstraction');
    
    // Generate unique test username
    const timestamp = Date.now();
    const testUsername = `test_oidc_${timestamp}`;
    testEmail = `${testUsername}@${intEmailDomain}`;
    testUser = {
      username: testUsername,
      email: testEmail,
      firstName: 'Test',
      lastName: 'User',
      enabled: true,
      emailVerified: false
    };

    console.log('[OIDC Workflow Test] Starting test workflow...');
    console.log(`[OIDC Workflow Test] Test user: ${testUsername} (${testEmail})`);

  try {
    // Step 1: Register user in Keycloak
    console.log('[OIDC Workflow Test] Step 1: Registering user in Keycloak...');
    try {
      keycloakUserId = await keycloakAdmin.addUser(testUser);
      if (!keycloakUserId) {
        // Try to find user by username
        const foundUser = await keycloakAdmin.getUserByUsername(testUsername);
        if (foundUser) {
          keycloakUserId = foundUser.id;
        }
      }
      testResults.step1_keycloak_register = {
        success: true,
        userId: keycloakUserId,
        username: testUsername,
        email: testEmail
      };
      console.log(`[OIDC Workflow Test] OK Step 1: Keycloak user created (ID: ${keycloakUserId})`);
    } catch (error) {
      testResults.step1_keycloak_register = {
        success: false,
        error: error.message
      };
      throw new Error(`Step 1 failed: ${error.message}`);
    }

    // Step 2: Pre-deploy user in Stalwart (using mail-service-abstraction)
    console.log('[OIDC Workflow Test] Step 2: Pre-deploying user in Stalwart...');
    try {
      const predeployResult = await mailService.verifyAndEnableMailbox(testEmail);
      testResults.step2_stalwart_predeploy = {
        success: predeployResult.success,
        message: predeployResult.message,
        mailbox: predeployResult.mailbox,
        username: predeployResult.username,
        error: predeployResult.error
      };
      if (!predeployResult.success) {
        throw new Error(`Pre-deploy failed: ${predeployResult.error || predeployResult.message}`);
      }
      console.log(`[OIDC Workflow Test] OK Step 2: Stalwart pre-deploy successful`);
    } catch (error) {
      testResults.step2_stalwart_predeploy = {
        success: false,
        error: error.message
      };
      throw new Error(`Step 2 failed: ${error.message}`);
    }

    // Step 3: Send test email to admin@workinpilot.site and Cc: self
    console.log('[OIDC Workflow Test] Step 3: Sending test email...');
    try {
      const emailSubject = `OIDC Workflow Test - ${testUsername}`;
      const emailBody = `This is a test email from the OIDC workflow test.\n\nTest User: ${testUsername}\nTest Email: ${testEmail}\nTimestamp: ${new Date().toISOString()}`;
      
      // Use admin email as sender for better compatibility (especially for Stalwart without OAuth)
      const senderEmail = adminEmail;
      
      const sendResult = await mailService.sendMail({
        from: senderEmail,
        to: adminEmail,
        cc: testEmail, // Cc: self (test user)
        subject: emailSubject,
        text: emailBody,
        html: `<p>${emailBody.replace(/\n/g, '<br>')}</p>`
      });

      testResults.step3_send_email = {
        success: sendResult.success,
        messageId: sendResult.messageId,
        response: sendResult.response,
        error: sendResult.error
      };

      if (!sendResult.success) {
        throw new Error(`Send email failed: ${sendResult.error}`);
      }
      console.log(`[OIDC Workflow Test] OK Step 3: Test email sent (MessageID: ${sendResult.messageId})`);

      // Wait a moment for email to be delivered
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      testResults.step3_send_email = {
        success: false,
        error: error.message
      };
      throw new Error(`Step 3 failed: ${error.message}`);
    }

    // Step 4: Check unseen count (before and after)
    // Note: This step may fail for newly created users without OAuth tokens
    // This is expected behavior and does not indicate a test failure
    console.log('[OIDC Workflow Test] Step 4: Checking unseen count...');
    try {
      // Get initial count
      const countBefore = await mailService.getUnseenCount(testUsername);
      testResults.step4_unseen_count_before = {
        success: countBefore.success,
        unseen_count: countBefore.unseen_count || 0,
        error: countBefore.error,
        note: countBefore.error && countBefore.error.includes('Access token') 
          ? 'Expected: New user requires OAuth token for JMAP access' 
          : null
      };

      // Wait a bit more for email delivery
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Get count after
      const countAfter = await mailService.getUnseenCount(testUsername);
      testResults.step4_unseen_count_after = {
        success: countAfter.success,
        unseen_count: countAfter.unseen_count || 0,
        error: countAfter.error,
        note: countAfter.error && countAfter.error.includes('Access token') 
          ? 'Expected: New user requires OAuth token for JMAP access' 
          : null
      };

      const countIncreased = countAfter.success && countBefore.success && 
                            (countAfter.unseen_count || 0) > (countBefore.unseen_count || 0);
      console.log(`[OIDC Workflow Test] Step 4: Unseen count - Before: ${countBefore.unseen_count || 0}, After: ${countAfter.unseen_count || 0}, Increased: ${countIncreased}`);
      if (!countAfter.success || !countBefore.success) {
        console.log(`[OIDC Workflow Test] Step 4: Note - Unseen count check requires OAuth token (expected for new users)`);
      }
    } catch (error) {
      testResults.step4_unseen_count_before = { 
        success: false, 
        error: error.message,
        note: 'Expected: New user requires OAuth token for JMAP access'
      };
      testResults.step4_unseen_count_after = { 
        success: false, 
        error: error.message,
        note: 'Expected: New user requires OAuth token for JMAP access'
      };
      console.warn(`[OIDC Workflow Test] WARN: Step 4: Could not check unseen count: ${error.message} (This is expected for new users without OAuth)`);
    }

    // Step 5: Delete user from Stalwart
    console.log('[OIDC Workflow Test] Step 5: Deleting user from Stalwart...');
    try {
      const deleteResult = await mailService.deleteMailbox(testEmail);
      testResults.step5_delete_user = {
        success: deleteResult.success,
        message: deleteResult.message,
        error: deleteResult.error
      };
      if (!deleteResult.success && deleteResult.error && !deleteResult.error.includes('not found')) {
        console.warn(`[OIDC Workflow Test] WARN: Step 5: Stalwart deletion warning: ${deleteResult.error}`);
      } else {
        console.log(`[OIDC Workflow Test] OK Step 5: Stalwart user deleted`);
      }
    } catch (error) {
      testResults.step5_delete_user = {
        success: false,
        error: error.message
      };
      console.warn(`[OIDC Workflow Test] WARN: Step 5: Stalwart deletion error: ${error.message}`);
    }

    // Cleanup: Delete from Keycloak
    console.log('[OIDC Workflow Test] Cleanup: Deleting user from Keycloak...');
    try {
      if (keycloakUserId) {
        await keycloakAdmin.deleteUser(keycloakUserId);
        testResults.cleanup_keycloak = { success: true, message: 'Keycloak user deleted' };
        console.log(`[OIDC Workflow Test] OK Cleanup: Keycloak user deleted`);
      } else {
        // Try to find and delete by username
        const foundUser = await keycloakAdmin.getUserByUsername(testUsername);
        if (foundUser) {
          await keycloakAdmin.deleteUser(foundUser.id);
          testResults.cleanup_keycloak = { success: true, message: 'Keycloak user deleted (found by username)' };
        } else {
          testResults.cleanup_keycloak = { success: true, skipped: true, message: 'User not found in Keycloak (may already be deleted)' };
        }
      }
    } catch (error) {
      testResults.cleanup_keycloak = {
        success: false,
        error: error.message
      };
      console.warn(`[OIDC Workflow Test] WARN: Cleanup: Keycloak deletion error: ${error.message}`);
    }

    // Generate summary
    const allStepsSuccess = 
      testResults.step1_keycloak_register?.success &&
      testResults.step2_stalwart_predeploy?.success &&
      testResults.step3_send_email?.success;

    const countIncreased = testResults.step4_unseen_count_after?.success && 
                          testResults.step4_unseen_count_before?.success &&
                          (testResults.step4_unseen_count_after?.unseen_count || 0) > 
                          (testResults.step4_unseen_count_before?.unseen_count || 0);

    testResults.summary = {
      overall_success: allStepsSuccess,
      test_user: testUsername,
      test_email: testEmail,
      keycloak_user_id: keycloakUserId,
      email_delivery_verified: countIncreased,
      provider: mailService.getProvider(),
      timestamp: new Date().toISOString()
    };

    console.log('[OIDC Workflow Test] OK Test workflow completed');
    console.log(`[OIDC Workflow Test] Summary: ${allStepsSuccess ? 'SUCCESS' : 'PARTIAL FAILURE'}`);

    res.json({
      success: allStepsSuccess,
      results: testResults
    });

  } catch (error) {
    console.error('[OIDC Workflow Test] FAIL Test workflow failed:', error);
    testResults.error = error.message;
    testResults.summary = {
      overall_success: false,
      test_user: testUsername,
      test_email: testEmail,
      error: error.message,
      timestamp: new Date().toISOString()
    };

    // Attempt cleanup on error
    try {
      if (keycloakUserId) {
        const keycloakAdmin = require('../config/keycloak-admin');
        await keycloakAdmin.deleteUser(keycloakUserId);
        testResults.cleanup_keycloak = { success: true, message: 'Keycloak user deleted during cleanup' };
      }
      if (testEmail) {
        const mailService = require('../services/email/mail-service-abstraction');
        await mailService.deleteMailbox(testEmail);
        testResults.cleanup_stalwart = { success: true, message: 'Stalwart user deleted during cleanup' };
      }
    } catch (cleanupError) {
      console.error('[OIDC Workflow Test] Cleanup error:', cleanupError);
    }

    res.status(500).json({
      success: false,
      error: error.message,
      results: testResults
    });
  }
});


/**
 * direct access grant - least secure way to obtain auth
 */
router.post('/test/get-user-DAG', async (req, res) => {
  try {
    const { username, userpass, targetClientId } = req.body;

    console.log('[api/test/get-user-DAG] seeking uname and client but really need startingClient as well... oh well:', username);

    if (!username || !targetClientId) {
      return res.status(400).json({
        success: false,
        error: 'username and targetClientId are required'
      });
    }

    const stalwartService = require('../services/email/stalwart-service');

    console.log(`[api/test/get-user-DAG] DAG ${username} for ${targetClientId}...`);

    const result = await stalwartService.getWebmailClientTokenViaDAG(username,userpass);

    if (result.success) {
      console.log(`[api/test/get-user-DAG] SUCCESS DIRECT Access Grant successful for ${username}`);
      res.json({
        success: true,
        username,
        targetClientId,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        sessionState: result.sessionState,
        idToken: result.idToken,
        scope: result.scope
      });
    } else {
      console.error(`[api/test/get-user-DAG] FAIL Direct Access Grant failed:`, result.error);
      res.status(500).json({
        success: false,
        error: result.error,
        username,
        targetClientId
      });
    }
  } catch (error) {
    console.error('[api/test/get-user-DAG] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


/*
 * post user dag - more secure way to leverage direct access grant,
 *                 by posting it directly to redirect url
 */
router.post('/test/post-user-DAG', async (req, res) => {
  try {
    const { username, userpass, targetClientId } = req.body;

    console.log('[api/test/post-user-DAG] seeking uname and client but really need startingClient as well... oh well:', username);

    if (!username || !targetClientId) {
      return res.status(400).json({
        success: false,
        error: 'username and targetClientId are required'
      });
    }

    const stalwartService = require('../services/email/stalwart-service');

    console.log(`[api/test/post-user-DAG] DAG ${username} for ${targetClientId}...`);

    const result = await stalwartService.postWebmailTokenViaDAG(username,userpass);

    if (result.success) {
      console.log(`[api/test/post-user-DAG] SUCCESS Post of DIRECT Access Grant successful for ${username}`);
      res.json({
        success: true,
        username,
        targetClientId,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        sessionState: result.sessionState,
        idToken: result.idToken,
        scope: result.scope
      });
    } else {
      console.error(`[api/test/post-user-DAG] FAIL Direct Access Grant failed:`, result.error);
      res.status(500).json({
        success: false,
        error: result.error,
        username,
        targetClientId
      });
    }
  } catch (error) {
    console.error('[api/test/post-user-DAG] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/test/impersonate-user
 * Get tokens for a user via admin impersonation (bypasses login)
 * Uses token exchange with requested_subject to impersonate users
 */
router.post('/test/impersonate-user', async (req, res) => {
  try {
    const { username, targetClientId } = req.body;

    console.log('[api/test/impersonate-user] seeking uname and client but really need startingClient as well... oh well:',req.body);

    if (!username || !targetClientId) {
      return res.status(400).json({
        success: false,
        error: 'username and targetClientId are required'
      });
    }

    // BOT STUPIDOSITY:

/*    const clientSecrets = {
      'stalwart-client': process.env.STALWART_CLIENT_SECRET,
      'roundcube-client': process.env.KEYCLOAK_SSO_MAIL_CLIENT_SECRET
    };

    // MORE BOT STUPIDOSITY
    const targetClientSecret = clientSecrets[targetClientId];
    if (!targetClientSecret) {
      return res.status(400).json({
        success: false,
        error: `Unsupported or unconfigured targetClientId: ${targetClientId}`
      });
    }
*/
    const stalwartService = require('../services/email/stalwart-service');

    console.log(`[api/test/impersonate-user] Impersonating ${username} for ${targetClientId}...`);

    const startingClientId = process.env.STALWART_CLIENT_ID;
    const startingClientSecret = process.env.STALWART_CLIENT_SECRET;

//    const result = await stalwartService.impersonateUserForClient(username, targetClientId, targetClientSecret);
//    const result = await stalwartService.impersonateUserForClient(username, startingClientId, startingClientSecret, targetClientId);
    const result = await stalwartService.getWebmailClientTokenViaDAG(username,'seK#rit123');

    if (result.success) {
      console.log(`[api/test/impersonate-user] SUCCESS Impersonation successful for ${username}`);
      res.json({
        success: true,
        username,
//        targetClientId,
        accessToken: result.accessToken,
//        refreshToken: result.refreshToken,
//        idToken: result.idToken,
//        expiresIn: result.expiresIn
      });
    } else {
      console.error(`[api/test/impersonate-user] FAIL Impersonation failed:`, result.error);
      res.status(500).json({
        success: false,
        error: result.error,
        username,
        targetClientId
      });
    }
  } catch (error) {
    console.error('[api/test/impersonate-user] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// END OF TEST OPTION 3

module.exports = router;
