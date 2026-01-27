# Keycloak→Stalwart OIDC Workflow Test

## Overview

This test suite provides a comprehensive, self-contained test for the complete Keycloak→Stalwart OIDC registration and mail service integration workflow. It verifies that all components work together correctly on a new service host.

## Test Workflow

The test executes the following steps in sequence:

1. **Register new OIDC user in Keycloak** - Creates a test user via Keycloak Admin API
2. **Pre-deploy/register user in Stalwart** - Creates the mailbox in Stalwart using the mail service abstraction layer
3. **Acquire OAuth token** - Gets an OAuth access token for the user using resource owner password credentials grant
4. **Get initial unseen count** - Retrieves the initial unseen email count for the test user
5. **Send test email** - Sends an email to `admin@workinpilot.site` with Cc to the test user
6. **Check unseen count increment** - Verifies that the unseen count increased after sending the email
7. **Cleanup** - Deletes the test user from both Keycloak and Stalwart

## Accessing the Test

### Web Interface

Navigate to:
```
http://your-backend-url/test/keycloak-stalwart-workflow
```

Or if running locally:
```
http://localhost:3010/test/keycloak-stalwart-workflow
```

### API Endpoint

The test can also be executed directly via API:

```bash
POST /api/test/keycloak-stalwart-workflow
Content-Type: application/json

{
  "username": "test-user-123",  // Optional, defaults to test-{timestamp}
  "email": "test@workinpilot.space",  // Optional, defaults to username@internal-domain
  "firstName": "Test",  // Optional
  "lastName": "User",  // Optional
  "password": "TestPass123!"  // Optional, auto-generated if not provided
}
```

## Configuration

The test automatically uses configuration from your `.env` file:

### Required Environment Variables

- `KEYCLOAK_URL` - Keycloak server URL
- `KEYCLOAK_REALM` - Keycloak realm name
- `KEYCLOAK_ADMIN_CLIENT_ID` - Keycloak admin client ID (for user management)
- `KEYCLOAK_ADMIN_CLIENT_SECRET` - Keycloak admin client secret
- `DEMO_MAIL_PROVIDER` - Set to "stalwart" for Stalwart testing
- `DEMO_STALWART_API_URL` - Stalwart API URL
- `DEMO_STALWART_API_TOKEN` - Stalwart API token (or use `DEMO_STALWART_ADMIN_API_KEY`)
- `DEMO_STALWART_API_KEY_NAME` - Stalwart API key name (if using API key authentication)
- `STALWART_CLIENT_ID` - Stalwart OIDC client ID (for OAuth token acquisition)
- `STALWART_CLIENT_SECRET` - Stalwart OIDC client secret
- `DEMO_INTERNAL_EMAIL_DOMAIN` - Internal email domain (defaults to `workinpilot.space`)

### Optional Environment Variables

- `STALWART_URL` - Stalwart base URL (used if API URL not explicitly set)
- `STALWART_SMTP_HOST` - SMTP host for sending emails
- `STALWART_SMTP_PORT` - SMTP port (defaults to 587)

## Mail Service Abstraction

The test uses the mail service abstraction layer (`mail-service-abstraction.js`) which:

- Automatically selects the configured mail provider (Stalwart or Mailcow)
- Uses the appropriate service implementation based on `DEMO_MAIL_PROVIDER`
- Provides a unified interface for all mail operations

## Test Results

The test returns detailed results for each step:

```json
{
  "workflowId": "test-1234567890",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "steps": {
    "keycloakRegistration": {
      "success": true,
      "userId": "keycloak-user-id",
      "username": "test-user",
      "email": "test@workinpilot.space",
      "message": "User registered in Keycloak successfully"
    },
    "stalwartPredeploy": {
      "success": true,
      "mailbox": {...},
      "username": "test-user",
      "message": "User pre-deployed in Stalwart successfully"
    },
    "oauthToken": {
      "success": true,
      "tokenPreview": "eyJhbGciOiJSUzI1NiIs...",
      "message": "OAuth token acquired successfully"
    },
    "initialUnseenCount": {
      "success": true,
      "count": 0,
      "message": "Initial unseen count retrieved"
    },
    "sendEmail": {
      "success": true,
      "messageId": "<message-id>",
      "to": "admin@workinpilot.site",
      "cc": "test@workinpilot.space",
      "message": "Test email sent successfully"
    },
    "finalUnseenCount": {
      "success": true,
      "initialCount": 0,
      "finalCount": 1,
      "increased": true,
      "increment": 1,
      "message": "Unseen count increased from 0 to 1"
    },
    "cleanup": {
      "keycloak": {
        "success": true,
        "message": "User deleted from Keycloak successfully"
      },
      "stalwart": {
        "success": true,
        "message": "Principal deleted: test-user"
      }
    }
  },
  "summary": {
    "success": true,
    "completed": true,
    "message": "Workflow test completed successfully",
    "errors": []
  }
}
```

## Error Handling

The test includes comprehensive error handling:

- **Step-level errors**: Each step reports its own success/failure status
- **Warning flags**: Non-critical failures (e.g., OAuth token acquisition) are marked as warnings
- **Automatic cleanup**: If any step fails, the test attempts to clean up created resources
- **Detailed error messages**: Each error includes a descriptive message and error details

## OAuth Token Acquisition

The test attempts to acquire an OAuth token using the resource owner password credentials grant:

1. If direct access grant is enabled in Keycloak, the token is acquired successfully
2. If direct access grant is disabled, the test continues with admin credentials fallback
3. The mail service abstraction handles both OAuth and admin credential authentication

## Troubleshooting

### Common Issues

1. **Keycloak Admin Client Not Configured**
   - Ensure `KEYCLOAK_ADMIN_CLIENT_ID` and `KEYCLOAK_ADMIN_CLIENT_SECRET` are set
   - Verify the client has `realm-management: manage-users` permission

2. **Stalwart API Not Accessible**
   - Check `DEMO_STALWART_API_URL` is correct
   - Verify API token is valid (`DEMO_STALWART_API_TOKEN` or `DEMO_STALWART_ADMIN_API_KEY`)
   - Ensure reverse proxy is configured if using public URL

3. **OAuth Token Acquisition Fails**
   - This is not critical - the test will use admin credentials fallback
   - To enable direct access grant, configure it in Keycloak client settings

4. **Email Not Received**
   - Check SMTP configuration (`STALWART_SMTP_HOST`, `STALWART_SMTP_PORT`)
   - Verify email delivery settings in Stalwart
   - Check spam/junk folders

5. **Unseen Count Not Incrementing**
   - Allow time for email delivery (test waits 3-5 seconds)
   - Verify JMAP is properly configured
   - Check that the mailbox exists and is accessible

## Security Notes

- The test page is accessible without authentication for testing purposes
- Test users are automatically cleaned up after the test completes
- Passwords are auto-generated and not logged
- OAuth tokens are not stored or logged (only previews are shown)

## Use Cases

This test is designed for:

1. **Service Host Verification** - Verify proper configuration on new service hosts
2. **Integration Testing** - Test the complete OIDC registration and mail service flow
3. **Troubleshooting** - Identify issues in the Keycloak→Stalwart integration
4. **Documentation** - Demonstrate the complete workflow to stakeholders

## Files

- `backend/tests/integration/keycloak-stalwart-workflow-test.html` - Self-contained test page
- `backend/routes/api.js` - API endpoint (`/api/test/keycloak-stalwart-workflow`)
- `backend/routes/app.js` - Route to serve the test page (`/test/keycloak-stalwart-workflow`)
- `backend/services/email/mail-service-abstraction.js` - Mail service abstraction layer

## Future Enhancements

Potential improvements:

- Add support for testing with Mailcow provider
- Include NextCloud integration in the workflow
- Add performance metrics (timing for each step)
- Support for testing multiple users simultaneously
- Export test results to file/format for CI/CD integration

