// Keycloak Admin API helper (uses client credentials)
// Env required:
// - KEYCLOAK_URL
// - KEYCLOAK_REALM (target realm where users live)
// - KEYCLOAK_ADMIN_REALM (defaults to 'master')
// - KEYCLOAK_ADMIN_CLIENT_ID, KEYCLOAK_ADMIN_CLIENT_SECRET (service account with realm-management: manage-users)

async function getAdminToken() {
  const url = `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_ADMIN_REALM || 'master'}/protocol/openid-connect/token`;
  const body = new URLSearchParams();
  body.set('grant_type', 'client_credentials');
  body.set('client_id', process.env.KEYCLOAK_ADMIN_CLIENT_ID || '');
  body.set('client_secret', process.env.KEYCLOAK_ADMIN_CLIENT_SECRET || '');

  const resp = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Admin token error ${resp.status}: ${text}`);
  }
  const json = await resp.json();
  return json.access_token;
}

// Create a new user (admin)
// Minimal required fields: username (string). Common optional: email, firstName, lastName, enabled, emailVerified, attributes, credentials
// // Create user representation for Keycloak Admin API
// const userRepresentation = {
//   username,
//   firstName,
//   lastName,
//   email,
//   enabled: true,
//   emailVerified: false,
//   credentials: [
//     {
//       type: 'password',
//       value: defaultTestSecret,
//       temporary: false,
//     },
//   ],
// };
async function addUser(userRepresentation) {
  if (!userRepresentation || typeof userRepresentation !== 'object') {
    throw new Error('userRepresentation is required');
  }
  const token = await getAdminToken();
  const url = `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(userRepresentation)
  });
  if (resp.status !== 201) {
    const text = await resp.text();
    throw new Error(`Create user error ${resp.status}: ${text}`);
  }

  // Keycloak returns Location header with the created user's URL ending in ID
  const location = resp.headers.get('location') || resp.headers.get('Location');
  if (location) {
    const parts = location.split('/');
    const id = parts[parts.length - 1];
    if (id) return id;
  }

  // Fallback: try to look up by username (not ideal if duplicates are allowed)
  // This fallback avoids a secondary list call; consumers can fetch as needed.
  return null;
}

async function logoutUserSessions(keycloakUserId) {
  const token = await getAdminToken();
  const url = `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${encodeURIComponent(keycloakUserId)}/logout`;
  const resp = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Logout user sessions error ${resp.status}: ${text}`);
  }
  return true;
}

// Fetch current user representation (admin)
async function getUserById(keycloakUserId) {
  const token = await getAdminToken();
  const url = `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${encodeURIComponent(keycloakUserId)}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Get user error ${resp.status}: ${text}`);
  }
  return resp.json();
}

// Fetch user OIDC sessions (admin)
async function getUserOidcSessions(keycloakUserId) {
  const token = await getAdminToken();
  const url = `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${encodeURIComponent(keycloakUserId)}/sessions`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Get user sessions error ${resp.status}: ${text}`);
  }
  return resp.json();
}

// Fetch a client by UUID to resolve clientId/name for friendly display
async function getClientByUuid(clientUuid) {
  if (!clientUuid) throw new Error('clientUuid is required');
  const token = await getAdminToken();
  const url = `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/clients/${encodeURIComponent(clientUuid)}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Get client error ${resp.status}: ${text}`);
  }
  return resp.json();
}

// Update user's email and verification flag (preserving other fields)
async function updateUserEmail(keycloakUserId, newEmail, emailVerified = true) {
  const token = await getAdminToken();
  // Load current rep to avoid wiping fields
  const current = await getUserById(keycloakUserId);
  const body = {
    ...current,
    email: newEmail,
    emailVerified: !!emailVerified,
  };
  const url = `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${encodeURIComponent(keycloakUserId)}`;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Update user email error ${resp.status}: ${text}`);
  }
  return true;
}

//module.exports = { getAdminToken, logoutUserSessions, getUserById, getUserOidcSessions, getClientByUuid, updateUserEmail, addUser };

// the rest is for OPTION TEST #2  - edSc8
// Delete a user from Keycloak
async function deleteUser(keycloakUserId) {
  const token = await getAdminToken();
  const url = `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${encodeURIComponent(keycloakUserId)}`;
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (resp.status !== 204 && resp.status !== 200) {
    const text = await resp.text();
    throw new Error(`Delete user error ${resp.status}: ${text}`);
  }
  return true;
}

// Get user by username (search)
async function getUserByUsername(username) {
  const token = await getAdminToken();
  const url = `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users?username=${encodeURIComponent(username)}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Get user by username error ${resp.status}: ${text}`);
  }
  const users = await resp.json();
  return users && users.length > 0 ? users[0] : null;
}

//module.exports = { getAdminToken, logoutUserSessions, getUserById, getUserOidcSessions, getClientByUuid, updateUserEmail, addUser, deleteUser, getUserByUsername };

// Fetch all users in realm (admin)
async function getAllUsers() {
  const token = await getAdminToken();
  const url = `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Get all users error ${resp.status}: ${text}`);
  }
  return resp.json();
}

module.exports = { getAdminToken, logoutUserSessions, getUserById, getUserOidcSessions, getClientByUuid, updateUserEmail, addUser, getAllUsers, deleteUser };

