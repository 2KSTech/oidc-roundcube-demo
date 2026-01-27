// Middleware to ensure user is authenticated
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  
  // Store the original URL to redirect after login
  req.session.returnTo = req.originalUrl;
  res.redirect('/auth/login');
}

// Middleware to ensure user is not authenticated (for login/register pages)
function ensureNotAuthenticated(req, res, next) {
  if (!req.isAuthenticated()) {
    return next();
  }
  
  res.redirect('/dashboard');
}

// Middleware to add user to all templates
function addUserToLocals(req, res, next) {
  res.locals.user = req.user || null;
  res.locals.isAuthenticated = req.isAuthenticated();
  next();
}

module.exports = {
  ensureAuthenticated,
  ensureNotAuthenticated,
  addUserToLocals,
  ensureAdmin: (req, res, next) => {
    if (!req.isAuthenticated()) {
      req.session.returnTo = req.originalUrl;
      return res.redirect('/auth/login');
    }
    const adminUsername = process.env.DEMO_ADMIN_USERNAME || 'sysadmin';
    const isAdmin = req.user?.username === adminUsername;
    if (!isAdmin) {
      return res.status(403).render('error', {
        title: 'Access Denied',
        message: 'Administrator access required for this page.',
        user: req.user,
        isAdmin: false,
        isAuthenticated: true
      });
    }
    return next();
  }
};