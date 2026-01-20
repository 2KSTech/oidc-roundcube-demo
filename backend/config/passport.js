const passport = require('passport');
const KeycloakStrategy = require('passport-keycloak-oauth2-oidc').Strategy;
const database = require('../services/databaseService');

passport.use('keycloak', new KeycloakStrategy({
  clientID: process.env.KEYCLOAK_CLIENT_ID,
  clientSecret: process.env.KEYCLOAK_CLIENT_SECRET,
  callbackURL: `${process.env.APP_URL || 'http://localhost:3010'}/auth/keycloak/callback`,
  realm: process.env.KEYCLOAK_REALM,
  authServerURL: process.env.KEYCLOAK_URL,
  publicClient: false,
  sslRequired: 'external',
  scope: ['openid', 'profile', 'email']
}, async (accessToken, refreshToken, idToken, profile, done) => {
  try {
    console.log('Keycloak authentication successful');
    console.log('Access Token:', accessToken ? 'Present' : 'Missing');
    console.log('Refresh Token:', refreshToken ? 'Present' : 'Missing');
    console.log('ID Token:', idToken ? 'Present' : 'Missing');
    console.log('Profile received:', JSON.stringify(profile, null, 2));
    
    // Extract user information from Keycloak profile
    const keycloakId = profile.id;
    const username = profile.username || profile.preferred_username;
    const email = profile.email;
    //jx
    const names = profile.name.split(' ');
    const firstName = names[0];
    const lastName = names.slice(1).join(' ') || names[0]; // Handle cases with no last name  
    

    //const firstName = profile.given_name || profile.firstName;
    //const lastName = profile.family_name || profile.lastName;

    // Check if user exists in database
    let user = await database.getUserByKeycloakId(keycloakId);
    
    if (!user) {
      // Create new user
      console.log('Creating new user for Keycloak ID:', keycloakId);
      const userId = await database.createUser({
        keycloakId,
        username,
        email,
        firstName,
        lastName
      });
      
      user = await database.getUserByKeycloakId(keycloakId);
    } else {
      // Update last login
      await database.updateUserLogin(keycloakId);
    }

    // Add tokens to user object for potential future use
    user.accessToken = accessToken;
    user.refreshToken = refreshToken;
    user.id_token = idToken;
    
    return done(null, user);
  } catch (error) {
    console.error('Error in Keycloak strategy:', error);
    return done(error, null);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.keycloak_id);
});

passport.deserializeUser(async (keycloakId, done) => {
  try {
    const user = await database.getUserByKeycloakId(keycloakId);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;