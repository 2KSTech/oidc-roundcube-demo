require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const flash = require('connect-flash');
const path = require('path');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const { spawn } = require('child_process');

// Import configurations and middleware
const passport = require('./config/passport');
const { addUserToLocals } = require('./middleware/auth');

// Import routes
const authRoutes = require('./routes/auth');
const appRoutes = require('./routes/app');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3010; // Backend fixed on 3010

// CORS configuration
// Build allowed origins from environment variables for per-instance configuration
const allowedOrigins = [
  // Always allow localhost for development
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3010',
  'http://localhost:4173',
];

// Add origins from environment variables (comma-separated or individual vars)
if (process.env.CORS_ORIGINS) {
  // Support comma-separated list: CORS_ORIGINS=https://app.example.com,https://api.example.com
  const envOrigins = process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean);
  allowedOrigins.push(...envOrigins);
}

// Add individual origin environment variables (for backward compatibility)
const individualOriginVars = [
  'FRONTEND_URL',
  'VITE_APP_URL',
  'BACKEND_URL',
  'CORS_ORIGIN' // Legacy single origin support
];

individualOriginVars.forEach(varName => {
  if (process.env[varName]) {
    const origin = process.env[varName].trim();
    if (origin && !allowedOrigins.includes(origin)) {
      allowedOrigins.push(origin);
    }
  }
});

// Remove duplicates and filter out empty values
const uniqueOrigins = [...new Set(allowedOrigins.filter(Boolean))];

console.log('[CORS] Allowed origins:', uniqueOrigins);

app.use(cors({
  origin: uniqueOrigins,
  credentials: true
}));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Body parsing middleware (allow larger payloads for avatar data URLs)
app.use(bodyParser.urlencoded({ extended: false, limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));

// File upload middleware
app.use(fileUpload({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  abortOnLimit: true,
  responseOnLimit: 'File size limit has been reached'
}));

// Session configuration
// For same-domain subdomains (e.g., webqa.workinpilot.cloud and workinpilot.cloud),
// set domain to '.workinpilot.cloud' to allow cookies across subdomains
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    // secure: process.env.NODE_ENV === 'production', // true for HTTPS in production
    // httpOnly: true, // Prevent XSS attacks
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    // sameSite: 'lax', // Allow cross-site requests but maintain CSRF protection
    // Set domain to parent domain to allow cookies across subdomains
    // Example: '.workinpilot.cloud' allows cookies on workinpilot.cloud, webqa.workinpilot.cloud, etc.
    // domain: process.env.SESSION_COOKIE_DOMAIN || undefined // e.g., '.workinpilot.cloud'
  }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Flash messages
app.use(flash());

// Add user to all templates
app.use(addUserToLocals);

// Routes (mount API first to avoid any accidental shadowing)
app.use('/api', apiRoutes);
app.use('/auth', authRoutes);
app.use('/', appRoutes);

// API endpoint to check authentication status
// This endpoint MUST return JSON, never HTML, as it's called by the frontend
app.get('/api/auth/status', (req, res) => {
  // Explicitly set content-type to ensure JSON response
  res.setHeader('Content-Type', 'application/json');
  
  try {
    if (req.isAuthenticated()) {
      return res.json({
        authenticated: true,
        user: {
          id: req.user.id,
          keycloak_id: req.user.keycloak_id,
          username: req.user.username,
          email: req.user.email,
          first_name: req.user.first_name,
          last_name: req.user.last_name
        }
      });
    } else {
      return res.json({ authenticated: false });
    }
  } catch (error) {
    console.error('Error in /api/auth/status:', error);
    return res.status(500).json({ authenticated: false, error: 'Server error checking authentication status' });
  }
});

// API endpoint to get user data for React frontend
app.get('/api/user', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      id: req.user.id,
      keycloak_id: req.user.keycloak_id,
      username: req.user.username,
      email: req.user.email,
      first_name: req.user.first_name,
      last_name: req.user.last_name,
      created_at: req.user.created_at,
      last_login: req.user.last_login
    });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({
    message: 'Server is running!',
    timestamp: new Date().toISOString()
  });
});

// Serve React app for all other routes (for production)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Application error:', err);
  if (res.headersSent) {
    return next(err);
  }
  
  // Handle OAuth specific errors
  if (err.name === 'InternalOAuthError') {
    console.error('OAuth Error Details:', {
      statusCode: err.oauthError?.statusCode,
      data: err.oauthError?.data,
      message: err.message
    });
    
    return res.status(500).render('error', {
      title: 'Authentication Error',
      message: 'Failed to authenticate with Keycloak. Please check your configuration and try again.',
      error: process.env.NODE_ENV === 'development' ? err : {}
    });
  }
  
  // Handle token errors
  if (err.name === 'TokenError') {
    console.error('Token Error Details:', {
      code: err.code,
      status: err.status,
      message: err.message
    });
    
    return res.status(500).render('error', {
      title: 'Token Error',
      message: 'Authentication token is invalid. Please try logging in again.',
      error: process.env.NODE_ENV === 'development' ? err : {}
    });
  }
  
  res.status(500).render('error', {
    title: 'Error',
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    title: '404 - Page Not Found',
    message: 'The page you are looking for does not exist.',
    error: {}
  });
});

/**
 * Check if the demo cleanup daemon is currently running
 * @param {string} pidFile - Path to the PID file
 * @returns {Promise<boolean>} True if daemon is running
 */
async function checkDaemonRunning(pidFile) {
  try {
    if (!fs.existsSync(pidFile)) {
      return false;
    }

    const pidContent = fs.readFileSync(pidFile, 'utf8').trim();
    const pid = parseInt(pidContent, 10);

    if (isNaN(pid)) {
      console.warn('[Cleanup] Invalid PID in file:', pidContent);
      return false;
    }

    // Check if process is running (Unix-like systems)
    try {
      process.kill(pid, 0); // Signal 0 doesn't kill, just checks if process exists
      return true;
    } catch (error) {
      // Process doesn't exist
      console.log(`[Cleanup] PID ${pid} not running, removing stale PID file`);
      try {
        fs.unlinkSync(pidFile);
      } catch (unlinkError) {
        console.warn('[Cleanup] Failed to remove stale PID file:', unlinkError.message);
      }
      return false;
    }
  } catch (error) {
    console.error('[Cleanup] Error checking daemon status:', error.message);
    return false;
  }
}

// Initialize data and start server
async function startServer() {
  try {
    
    app.listen(PORT, async () => {
      console.log(`Server running on ${process.env.APP_URL}`);
      console.log('Test endpoint: GET /test');

      // Check if Keycloak is configured
      if (!process.env.KEYCLOAK_URL) {
        console.warn('\n[server.js] WARNING: Keycloak not configured - using test mode');
        console.warn('[server.js] Upload functionality will work but authentication is disabled');
      }

      // NOTE: Demo cleanup daemon should run as a separate process (standalone/pm2/cron),
      // not inside the web server. Keeping server startup independent prevents DB cleanup
      // failures from breaking the demo UI.

      //
      // ensure standalone daemon is running -- this is critical to demo security posture
      //

      // Check and start STANDALONE demo cleanup daemon IFF DEMO_MAX_SESSION_DURATION_MIN is a non-zero value.
      // Contract: duration 0 => do not run.
      try {
        const maxMinutes = parseInt(process.env.DEMO_MAX_SESSION_DURATION_MIN || '0', 10);
        if (Number.isFinite(maxMinutes) && maxMinutes > 0) {
          const daemonPidFile = path.join(__dirname, 'demo-cleanup-daemon.pid');

          // Check if daemon is already running
          const isDaemonRunning = await checkDaemonRunning(daemonPidFile);

          if (!isDaemonRunning) {
            console.log(`[Cleanup] Starting standalone demo cleanup daemon (DEMO_MAX_SESSION_DURATION_MIN=${maxMinutes})...`);

            // Start the daemon as a separate process and wait for it to confirm startup
            await new Promise((resolve, reject) => {
              const daemonProcess = spawn('node', [
                path.join(__dirname, 'services', 'demo-session-cleanup-daemon-standalone.js')
              ], {
                cwd: path.join(__dirname, '..'), // Run from backend directory
                detached: true, // Allow process to run independently
                stdio: ['ignore', 'pipe', 'pipe'] // Ignore stdin, pipe stdout/stderr
              });

              const timeout = setTimeout(() => {
                daemonProcess.kill();
                reject(new Error('Daemon startup timeout - daemon failed to start within 10 seconds'));
              }, 10000); // 10 second timeout

              let startupConfirmed = false;
              let errorOutput = '';

              // Listen for daemon stdout (success messages)
              daemonProcess.stdout.on('data', (data) => {
                const output = data.toString();
                console.log(`[Cleanup Daemon] ${output.trim()}`);

                // Check for success indicators
                if (output.includes('Daemon started successfully') ||
                    output.includes('PID file created')) {
                  startupConfirmed = true;
                  clearTimeout(timeout);
                  resolve();
                }
              });

              // Listen for daemon stderr (error messages)
              daemonProcess.stderr.on('data', (data) => {
                const error = data.toString();
                console.error(`[Cleanup Daemon Error] ${error.trim()}`);
                errorOutput += error;
              });

              // Handle process exit
              daemonProcess.on('exit', (code, signal) => {
                if (!startupConfirmed) {
                  clearTimeout(timeout);
                  if (code !== 0) {
                    reject(new Error(`Daemon process exited with code ${code}: ${errorOutput}`));
                  } else {
                    reject(new Error('Daemon process exited unexpectedly during startup'));
                  }
                }
              });

              // Handle spawn errors
              daemonProcess.on('error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Failed to spawn daemon process: ${error.message}`));
              });
            });

            console.log('[Cleanup] Standalone demo cleanup daemon started successfully');
          } else {
            console.log('[Cleanup] Standalone demo cleanup daemon already running');
          }
        }
      } catch (error) {
        console.error('[Cleanup] Failed to ensure standalone demo cleanup daemon is running:', error?.message || error);
        console.error('[Cleanup] Server startup will fail as daemon is required but not running');
        throw error; // Re-throw to fail server startup
      }


    });
  } catch (error) {
    console.error('[server.js] Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[server.js] Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[server.js] Shutting down gracefully...');
  process.exit(0);
});

startServer();
