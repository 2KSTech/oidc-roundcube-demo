const express = require('express');
const passport = require('../config/passport');
const { ensureNotAuthenticated } = require('../middleware/auth');
const mailcowClient = require('../services/email/mailcow-client');
const tokenService = require('../services/tokenService');

const router = express.Router();

// Service base URLs derived from environment, avoiding hardcoded domains
const internalDomain = process.env.WORKINPILOT_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';
const nextcloudBase = process.env.NEXTCLOUD_URL;
const mailBase = process.env.MAILCOW_URL;

// Admin helper function
const checkIsAdmin = (req) => {
  const adminUsername = process.env.WORKINPILOT_ADMIN_USERNAME || 'sysadmin';
  return req.user?.username === adminUsername;
};

async function resolveMailcowOwnership(user) {
  try {
    const email = user?.email || '';
    if (!email) return { exists: false };
    if (!mailcowClient.isConfigured()) return { exists: false };
    const r = await mailcowClient.getMailbox(email);
    if (r.success && r.status === 200 && r.mailbox && r.mailbox.username) {
      return { exists: true, source: 'mailcow', mailbox: r.mailbox };
    }
    return { exists: false };
  } catch (_) {
    return { exists: false };
  }
}

async function denyAndCleanup(req, res, meta) {
  try { await new Promise(resolve => req.logout(() => resolve())); } catch (_) {}
  try { req.session?.destroy?.(() => {}); } catch (_) {}
  res.clearCookie('connect.sid');
  return res.status(403).render('error', {
    title: 'Access Denied',
    message: 'This identity appears to be managed by another instance. Please sign in again.',
    user: req.user,
    isAuthenticated: false,
    autoClearAndRedirect: true,
    redirectTo: '/auth/login?blocked=1'
  });
}

// Admin API: force-close SSO sessions for current user (belt-and-suspenders)
router.post('/force-logout-sessions', async (req, res) => {
  try {
    if (!req.isAuthenticated() || !req.user?.keycloak_id) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    const admin = require('../config/keycloak-admin');
    await admin.logoutUserSessions(req.user.keycloak_id);
    return res.json({ success: true });
  } catch (e) {
    console.error('force-logout-sessions error:', e);
    return res.status(500).json({ success: false, message: 'Failed to close sessions' });
  }
});

// Login page
router.get('/login', ensureNotAuthenticated, (req, res) => {
  res.render('login', { 
    title: 'Login',
    error: req.flash('error')
  });
});

// Initiate Keycloak authentication
router.get('/keycloak', 
  ensureNotAuthenticated,
  (req, res, next) => {
    console.log('Initiating Keycloak authentication');
    console.log('Callback URL will be:', `${process.env.APP_URL || 'http://localhost:3010'}/auth/keycloak/callback`);
    // Honor optional ?next=... to resume after login
    try {
      const nextParam = req.query?.next;
      if (nextParam) {
        req.session.returnTo = nextParam;
        console.log('Will return to after login:', nextParam);
      }
    } catch (_) {}

    // Honor optional ?login_hint=... to pre-fill username in Keycloak login form
    try {
      const loginHint = req.query?.login_hint || req.query?.username;
      if (loginHint) {
        req.session.loginHint = loginHint;
        console.log('Will use login_hint for authentication:', loginHint);
      }
    } catch (_) {}


    next();
  },
//  passport.authenticate('keycloak')
  (req, res, next) => {
    // Build passport authenticate options
    const authOptions = {};

    // Add login_hint if available in session
    if (req.session?.loginHint) {
      authOptions.loginHint = req.session.loginHint;
      console.log('Passing login_hint to Keycloak:', authOptions.loginHint);
    }

    passport.authenticate('keycloak', authOptions)(req, res, next);
  }

);



// Mail authentication (provider-agnostic)
router.get('/mailcow', async (req, res) => {
  // Redirect to provider-agnostic route
  return res.redirect('/auth/mail');
});



router.get('/mail', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/auth/login');
  }
  
  const mailServiceConfig = require('../config/mail-service-config');
  const provider = mailServiceConfig.getProvider();
  const providerLabel = mailServiceConfig.getProviderLabel();
  
  // Get webmail client configuration
  const webmailClientName = mailServiceConfig.getWebmailClientName();
  const webmailClientLabel = mailServiceConfig.getWebmailClientLabel();
  const webmailClientUrl = mailServiceConfig.getWebmailClientUrl();
  
  // Check if this is a setup request (during onboarding) vs actual mail access
  // Setup requests come from dashboard with redirect: 'manual', so we should return 200 OK
  // Actual mail access should redirect to webmail client
  const isSetupRequest = req.query.setup === 'true' || 
                         req.get('Accept')?.includes('application/json') ||
                         req.get('X-Requested-With') === 'XMLHttpRequest';
  
  console.log(`[auth.js - mail] ${providerLabel} ${isSetupRequest ? 'setup' : 'access'} initiated for user:`, req.user.username);
  console.log(`[auth.js - mail] Webmail client: ${webmailClientLabel} (${webmailClientName})`);
  
  const intEmailDomain = process.env.WORKINPILOT_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';
  const userEmail = `${req.user.username}@${intEmailDomain}`;
  req.user.email = userEmail;
  
  try {
    // Provider-specific mailbox setup
    if (provider === 'mailcow') {
      // Mailcow: Auto-configure email proxy (existing functionality)
      try {
        const mailService = require('../services/email/mail-service-abstraction');
      } catch (proxyError) {
        console.warn(`Email proxy configuration error for ${userEmail}:`, proxyError.message);
      }
    } else if (provider === 'stalwart') {
      // Stalwart: Pre-deploy via Token Exchange (no password required)
      try {
        const stalwartService = require('../services/email/stalwart-service');
        const keycloakAccessToken = req.session.keycloakAccessToken;
        
        if (keycloakAccessToken) {
          console.log(`[auth.js - mail] Pre-deploying Stalwart mailbox via Token Exchange for ${userEmail}`);
          const preDeployResult = await stalwartService.preDeployStalwartViaTokenExchange(
            userEmail,
            keycloakAccessToken
          );
          
          if (preDeployResult.success && preDeployResult.discovered) {
            console.log(`[auth.js - mail] OK Stalwart mailbox pre-deployed successfully: ${userEmail}`);
          } else if (preDeployResult.success && !preDeployResult.discovered) {
            console.warn(`[auth.js - mail] WARN: Stalwart pre-deploy completed but principal not yet discovered: ${preDeployResult.message}`);
            // Continue anyway - may work if mailbox already exists
          } else {
            console.warn(`[auth.js - mail] Stalwart pre-deploy warning: ${preDeployResult.message || preDeployResult.error}`);
            // Continue anyway - don't block the flow
          }
        } else {
          console.warn(`[auth.js - mail] No Keycloak access token in session - cannot perform Token Exchange pre-deploy`);
          // Fallback: try verifyAndEnableMailbox (for consistency with Mailcow, though it won't work for OIDC directory)
          try {
            const mailService = require('../services/email/mail-service-abstraction');
            const verifyResult = await mailService.verifyAndEnableMailbox(userEmail);
            if (verifyResult.success) {
              console.log(`[auth.js - mail] Stalwart mailbox verified: ${userEmail}`);
            }
          } catch (verifyError) {
            console.warn(`[auth.js - mail] Stalwart verification error: ${verifyError.message}`);
          }
        }
      } catch (preDeployError) {
        console.warn(`[auth.js - mail] Stalwart pre-deploy error: ${preDeployError.message}`);
        // Continue anyway - don't block the flow
      }
    }

    // If this is a setup request (during onboarding), return 200 OK instead of redirecting
    if (isSetupRequest) {
      console.log(`[auth.js - mail] ${providerLabel} setup completed for user:`, req.user.username);
      return res.status(200).json({ 
        success: true, 
        message: 'Mail setup completed',
        provider: providerLabel,
        webmailClient: webmailClientLabel
      });
    }

    // For actual mail access: Redirect to webmail client
    // For Roundcube/SOGo: They handle their own OIDC flow, just redirect to their URL
    // User is already authenticated to Keycloak, so SSO should work seamlessly
    if (!webmailClientUrl) {
      console.error(`[auth.js - mail] Webmail client URL not configured`);
      return res.render('auth-status', {
        title: 'Mail Authentication',
        service: `${providerLabel} (${webmailClientLabel})`,
        status: 'error',
        message: 'Webmail client URL not configured',
        user: req.user
      });
    }
    
    console.log(`[auth.js - mail] ${providerLabel} authentication successful for user:`, req.user.username);
    console.log(`[auth.js - mail] Redirecting to webmail client: ${webmailClientUrl}`);
    
    return res.redirect(webmailClientUrl);
    
  } catch (error) {
    console.error(`[auth.js - mail] Error during ${providerLabel} ${isSetupRequest ? 'setup' : 'authentication'}:`, error);
    
    if (isSetupRequest) {
      return res.status(500).json({ 
        success: false, 
        error: 'Mail setup failed',
        message: error.message 
      });
    }
    
    res.render('auth-status', {
      title: 'Mail Authentication',
      service: `${providerLabel} (${webmailClientLabel})`,
      status: 'error',
      message: 'Authentication failed',
      user: req.user
    });
  }
});


// Comprehensive logout workflow
router.get('/logout', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/auth/login');
  }
  
  console.log('Session before logout:', req.session ? 'exists' : 'null');
  console.log('ID token in session:', req.session?.idToken ? 'present' : 'missing');

  // Capture keycloakId before logout clears req.user
  const capturedKeycloakId = req.user?.keycloak_id;

  // Step 1: Logout from WorkInPilot app
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.redirect('/');
    }
    
    // Invalidate tokens in tokenService before destroying session
    if (capturedKeycloakId && req.session) {
      try {
        tokenService.invalidateTokens(capturedKeycloakId, req.session);
        console.log('[logout] TokenService tokens invalidated');
      } catch (tokenError) {
        console.error('[logout] Error invalidating tokens:', tokenError);
        // Non-fatal - continue with logout
      }
    }


    // Step 2: Destroy session and clear cookies
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
      }
      
      // Step 3: Construct comprehensive Keycloak logout URL
      const keycloakUrl = process.env.KEYCLOAK_URL;
      const realm = process.env.KEYCLOAK_REALM;
      const clientId = process.env.KEYCLOAK_CLIENT_ID || 'demo-workinpilot';
      const postLogoutRedirectUri = process.env.POST_LOGOUT_REDIRECT_URI || process.env.APP_URL || 'http://localhost:5173';
      
      console.log('Logout configuration:');
      console.log('- Keycloak URL:', keycloakUrl);
      console.log('- Realm:', realm);
      console.log('- Client ID:', clientId);
      console.log('- Post-logout redirect:', postLogoutRedirectUri);
      
      // Build logout URL with all necessary parameters
      const logoutUrl = new URL(`${keycloakUrl}/realms/${realm}/protocol/openid-connect/logout`);
      logoutUrl.searchParams.set('client_id', clientId);
      logoutUrl.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
      
      // Add ID token hint if available
      if (req.session && req.session.idToken) {
        logoutUrl.searchParams.set('id_token_hint', req.session.idToken);
        console.log('ID token included in logout request');
      } else {
        console.log('No ID token available for logout - proceeding without it');
      }
      
      console.log('Comprehensive logout initiated for user:', req.user?.username);
      console.log('Logout URL:', logoutUrl.toString());
      
      // Step 4: Redirect to Keycloak for complete OIDC logout
      res.redirect(logoutUrl.toString());
    });
  });
});

// Fallback logout route (simpler version)
router.get('/logout-simple', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/auth/login');
  }
  
  // Capture keycloakId before logout clears req.user
  const capturedKeycloakId = req.user?.keycloak_id;

  // Simple logout without ID token
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
    }

    // Invalidate tokens in tokenService before destroying session
    if (capturedKeycloakId && req.session) {
      try {
        tokenService.invalidateTokens(capturedKeycloakId, req.session);
        console.log('[logout-simple] TokenService tokens invalidated');
      } catch (tokenError) {
        console.error('[logout-simple] Error invalidating tokens:', tokenError);
        // Non-fatal - continue with logout
      }
    }

    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
      }
      
      // Redirect to login page
      const loginUrl = process.env.POST_LOGOUT_REDIRECT_URI || process.env.APP_URL || 'http://localhost:5173';
      console.log('Simple logout completed, redirecting to:', loginUrl);
      res.redirect(loginUrl);
    });
  });
});

// Federated logout across OIDC-enabled apps (front-channel orchestration)
// Uses Keycloak end-session, then calls service logout URLs via hidden iframes
router.get('/logout-all', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect('/auth/login');
  }



  // const ncLogout = process.env.NEXTCLOUD_LOGOUT_URL || '';
  // Resolve Mail logout URL with user/email placeholders
  const mailTpl = process.env.MAILCOW_LOGOUT_URL_TEMPLATE || process.env.MAILCOW_LOGOUT_URL || '';
  const userEmail = req.user?.email || '';
  const userLocal = userEmail.split('@')[0] || '';
  const mailLogout = mailTpl
    .replace(/\$\{USER\}/g, userLocal)
    .replace(/\$\{EMAIL\}/g, userEmail)
    .replace(/\{user\}/g, userLocal)
    .replace(/\{email\}/g, userEmail);


  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Signing out…</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:linear-gradient(135deg, #090c9b 0%, #3066be 50%, #b4c5e4 100%);color:#1f2937;min-height:100vh}
    .backdrop{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px}
    .modal{background:rgba(255,255,255,0.95);backdrop-filter:blur(10px);box-shadow:0 8px 32px rgba(0,0,0,0.1);border-radius:15px;max-width:560px;width:100%;overflow:hidden;border:1px solid rgba(255,255,255,0.2)}
    .modal-header{padding:16px 20px;border-bottom:1px solid #f0f1f3;font-weight:600;font-size:16px}
    .modal-body{padding:14px 20px 6px 20px}
    .summary{margin:0 0 10px 0;font-weight:600;color:#111827}
    .details{font-size:14px;color:#374151}
    .row{margin:8px 0}
    .foot{padding:10px 20px 16px 20px;border-top:1px solid #f0f1f3;color:#6b7280;font-size:12px}
  </style>
  </head><body>
  <div class="backdrop">
    <div class="modal" role="dialog" aria-modal="true" aria-label="Logout progress">
      <div class="modal-header">Signing you out…</div>
      <div class="modal-body">
        <div class="summary">${ncCleanupSummary}</div>
        <div class="details">
          ${mailLogout ? '<div class="row">Mail: logout prepared</div>' : ''}
          ${ncLogout ? '<div class="row">Nextcloud: logout prepared</div>' : ''}
          ${ncTokenCleanupStatus}
          <div class="row">Identity provider (Keycloak): next…</div>
        </div>
      </div>
      <div class="foot">This window will move through logout steps automatically…</div>
    </div>
  </div>
  <script>setTimeout(function(){ window.location.href = ${JSON.stringify(mailLogout.toString())}; }, 1200);</script>
  <script>setTimeout(function(){ window.location.href = ${JSON.stringify(ncLogout.toString())}; }, 1200);</script>
  <script>setTimeout(function(){ window.location.href = ${JSON.stringify(kcLogout.toString())}; }, 1200);</script>
  </body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// After IDP logout, front-channel logout other services via iframes then redirect
// After KC logout, finalize local session and redirect to app (clean slate)
router.get('/kc-logout-complete', (req, res) => {
  const next = req.query.next || process.env.POST_LOGOUT_REDIRECT_URI || process.env.APP_URL || '/';
  // Capture identifiers before logout clears req.user
  const capturedUserId = req.user?.id;
  const capturedEmail = req.user?.email;
  const capturedKeycloakId = req.user?.keycloak_id;
  req.logout(async () => {
    try {
      // Invalidate tokens in tokenService before destroying session
      if (capturedKeycloakId && req.session) {
        try {
          tokenService.invalidateTokens(capturedKeycloakId, req.session);
          console.log('[kc-logout-complete] TokenService tokens invalidated');
        } catch (tokenError) {
          console.error('[kc-logout-complete] Error invalidating tokens:', tokenError);
          // Non-fatal - continue with logout
        }
      }
      
    } catch (e) { console.log('[auth.js - kc-logout-complete] Error during session cleanup:', e.message); }
    req.session?.destroy(() => res.redirect(next));
  });
});


module.exports = router;
