# Mail Service SSO - Stalwart and Roundcube with Keycloak Authentication

This project integrates Keycloak authentication with the Stalwart mail server and Roundcube webmail client, providing secure single sign-on capabilities.

## Features

- **Keycloak Authentication**: Secure enterprise-grade authentication
- **Express Backend**: Authentication server with Keycloak integration
- **Session Management**: Persistent user sessions across services

## Project Structure

```
oidc-roundcube-demo/
├── backend/               # Express authentication server
│   ├── config            # Envbase and Passport configuration
│   ├── middleware        # Au# Authentication middleware
│   ├── routes            # Ex# Express routes
│   ── server          
└── ...
```

## Setup Instructions

### 1. Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp config.env.template .env
   ```

4. Edit `.env` with your Keycloak configuration:
   ```
   KEYCLOAK_URL=http://localhost:8080
   KEYCLOAK_REALM=your-realm
   KEYCLOAK_CLIENT_ID=your-client-id
   KEYCLOAK_CLIENT_SECRET=your-client-secret
   APP_URL=http://localhost:3010
   SESSION_SECRET=your-session-secret-key
   ```

5. Start the backend server:
   ```bash
   npm start
   ```

### 3. Keycloak Configuration

1. Set up a Keycloak server (local or cloud)
2. Create a new realm
3. Create a new client with the following settings:
   - Client ID: `myapp-client`
   - Client Protocol: `openid-connect`
   - Access Type: `confidential`
   - Valid Redirect URIs: `http://localhost:3010/auth/keycloak/callback`
   - Web Origins: `http://localhost:5173`


### 4. Stalwart and Roundcube Configuration

Using your Keycloak client configs, setup your Stalwart and Roundcube configs following the template instructions.

## Usage

1. **Access the Application**: Visit `http://localhost:3010`
2. **Register**: Type in username, we default the rest of your Keycloak ID for demo purposes
3. **Roundcube**: After authentication, you'll be able to do 1-click Roundcube registration and sign-in

## Authentication Flow


## API Endpoints

- `GET /api/auth/status` - Check authentication status
- `GET /api/user` - Get current user data
- `GET /auth/keycloak` - Initiate Keycloak authentication
- `GET /auth/logout` - Logout user


## Development

- **Backend**: `http://localhost:3010`
- **Keycloak**: `http://localhost:8080` (if running locally)

## Notes

- Ensure your demo browser allows popups
- Sessions are managed through cookies and the Keycloak IdP 
- CORS is NOT configured - you must configure it to allow communication between demo components on different machines

## Troubleshooting

1. **CORS Errors**: Ensure the backend CORS configuration includes your frontend URL
2. **Authentication Failures**: Check Keycloak configuration and environment variables
4. **Session Problems**: Check session secret and cookie configuration

## Run

```
bash setup.sh
bash node backend/diagnostic.sh
bash start-dev.sh
```
