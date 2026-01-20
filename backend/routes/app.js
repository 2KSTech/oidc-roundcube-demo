const express = require('express');
const { ensureAuthenticated } = require('../middleware/auth');


const router = express.Router();

// Home page (public)
router.get('/', (req, res) => {
  const isAuthenticated = !!req.user;
  const isAdmin = isAuthenticated ? checkIsAdmin(req) : false;

  res.render('index', {
    title: 'WorkInPilot Demo App',
    isAuthenticated: isAuthenticated,
    isAdmin: isAdmin,
    user: req.user
  });
});

// Error page (public, accepts query parameters)
router.get('/error', (req, res) => {
  const isAuthenticated = !!req.user;
  const isAdmin = isAuthenticated ? checkIsAdmin(req) : false;
  
  const title = req.query.title || 'Error';
  const message = req.query.message || 'An error occurred';
  
  res.status(500).render('error', {
    title: title,
    message: message,
    error: {},
    isAuthenticated: isAuthenticated,
    isAdmin: isAdmin,
    user: req.user
  });
});

// Admin helper function
const checkIsAdmin = (req) => {
  const adminUsername = process.env.WORKINPILOT_ADMIN_USERNAME || 'sysadmin';
  return req.user?.username === adminUsername;
};


// START TEST OPTION 1 - 9tTBQ
// Keycloak->Stalwart OIDC Workflow Test Page - Accessible without authentication for testing purposes ?
router.get('/test/test1', (req, res) => {
  const path = require('path');
  res.sendFile(path.join(__dirname, '../tests/integration/1/oidc-stalwart-workflow-test.html'));
});
//
//
//
router.get('/test/roundcube', (req, res) => {
  const path = require('path');
  res.sendFile(path.join(__dirname, '../tests/integration/1/integration/oidc-stalwart-roundcube-test.html'));
});
//
// OPTION 1 - 2 of 3 - roundcube test
//
router.get('/test/test1rc', (req, res) => {
  const path = require('path');
  res.sendFile(path.join(__dirname, '../tests/integration/1/oidc-stalwart-roundcube-test.html'));
});
//
// OPTION 1 - 3 of 3 - roundcube ONLY  test
//
router.get('/test/test1bad', (req, res) => {
  const path = require('path');
  res.sendFile(path.join(__dirname, '../tests/integration/1/integration/keycloak-stalwart-webmail-test.html'));
});
// END TEST OPTION 1
// START TEST OPTION 2 - edSc8
// OIDC Workflow Test Page (public, for service configuration testing)
router.get('/test/oidc-workflow', (req, res) => {
  const path = require('path');
  res.sendFile(path.join(__dirname, '../tests/integration/2/oidc-workflow-test.html'));
});
// END TEST OPTION 2
// START TEST OPTION 3 - tVIMV
// Keycloak->Stalwart OIDC Workflow Test Page
// Accessible without authentication for testing purposes
router.get('/test/keycloak-stalwart-workflow', (req, res) => {
  const path = require('path');
  res.sendFile(path.join(__dirname, '../tests/integration/3/keycloak-stalwart-workflow-test.html'));
});
// END TEST OPTION 3
module.exports = router;
