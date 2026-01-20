## Created Files

1. **`backend/services/demo-session-cleanup-daemon.js`** — Main daemon that:
   - Scans all Keycloak users periodically
   - Checks each user's `createdTimestamp` from Keycloak Admin API
   - Connects to Roundcube DB (MariaDB) or SOGo DB (Postgres) based on `WORKINPILOT_SSO_MAIL_CLIENT_NAME`
   - Expires users older than `DEMO_MAX_SESSION_DURATION_MIN` minutes
   - Deletes in order: Keycloak → Stalwart → Webmail DB
   - Handles graceful shutdown (expires all sessions on SIGTERM/SIGINT)

2. **`backend/services/roundcube/roundcube-user-service.js`** — Service for Roundcube DB operations:
   - Connects to MariaDB using env vars (`ROUNDCUBE_DB_*`)
   - Queries users by `username` (per Roundcube schema)
   - Deletes users (cascade deletes related records)

3. **`backend/services/demo-session-cleanup-daemon-standalone.js`** — Standalone runner script that can run independently of the main backend

## Updated Files

1. **`backend/config/keycloak-admin.js`** — Exported `deleteUser` function
2. **`backend/services/sogo/sogo-user-service.js`** — Added `deleteUser` method

## Dependencies

The daemon uses:
- `pg` (already in package.json) for SOGo/PostgreSQL
- `mysql2` (needs to be added) for Roundcube/MariaDB

To install mysql2:
```bash
npm install mysql2
```

## Configuration

The daemon uses these environment variables:
- `DEMO_MAX_SESSION_DURATION_MIN` (default: 15 minutes)
- `DEMO_CLEANUP_INTERVAL_MS` (default: 60000ms = 1 minute)
- `WORKINPILOT_SSO_MAIL_CLIENT_NAME` (sogo or roundcube)
- `WORKINPILOT_MAIL_PROVIDER` (stalwart)
- `ROUNDCUBE_DB_*` vars (for Roundcube)
- `SOGO_DB_*` vars (for SOGo, already configured)

## Usage

**As part of backend server:**
The daemon can be imported and started in `server.js` similar to the SOGo sync daemon.

**Standalone mode:**
```bash
node backend/services/demo-session-cleanup-daemon-standalone.js
```

The daemon will:
- Run immediately on start
- Check every `DEMO_CLEANUP_INTERVAL_MS` milliseconds
- On shutdown (Ctrl+C or SIGTERM), expire all active sessions before exiting

The daemon only runs when `DEMO_MAX_SESSION_DURATION_MIN` is set to a non-zero value, preventing accidental execution in production.
