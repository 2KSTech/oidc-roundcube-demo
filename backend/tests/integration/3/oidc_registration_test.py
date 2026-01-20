from flask import Flask, render_template
import os
import requests
import json
from urllib.parse import urlencode
app = Flask(__name__)

# Set environment variables for Keycloak and Stalwart OIDC Client
KEYCLOAK_URL = os.environ['KEYCLOAK_URL']
REALM = os.environ['REALM']
CLIENT_ID = os.environ['CLIENT_ID']
CLIENT_SECRET = os.environ['CLIENT_SECRET']
API_AUDIENCE = os.environ['API_AUDIENCE']
TOKEN_URL = f"{KEYCLOAK_URL}/auth/realms/{REALM}/protocol/openid-connect/token"
USERINFO_URL = os.environ['USERINFO_URL']

# Define the scope and grant type for the OAuth2 flow
SCOPE = "openid profile email"
GRANT_TYPE = "authorization_code"
REDIRECT_URI = f"{os.environ['REDIRECT_URI']}callback"

def get_access_token():
    # Prepare headers and data for the token request
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded'
    }
    data = {
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET,
        'grant_type': GRANT_TYPE,
        'scope': SCOPE,
        'code': os.environ['AUTHORIZATION_CODE'],
        'redirect_uri': REDIRECT_URI,
    }

    # Send the token request and decode the response
    response = requests.post(TOKEN_URL, headers=headers, data=data)
    access_token = json.loads(response.content)['access_token']
    return access_token

def get_userinfo(access_token):
    # Prepare headers for the userinfo request
    headers = {
        'Authorization': f'Bearer {access_token}',
        'Accept': 'application/json',
    }

    # Send the userinfo request and decode the response
    response = requests.get(USERINFO_URL, headers=headers)
    userinfo = json.loads(response.content)
    return userinfo

@app.route('/')
def index():
    access_token = get_access_token()
    userinfo = get_userinfo(access_token)
    output = f"""
        <h2>OIDC User Registration Test Results</h2>
        <h3>Access Token:</h3>
        <pre>{access_token}</pre>
        <h3>User Info:</h3>
        <ul>
            <li><strong>Email:</strong> {userinfo['email']}</li>
            <li><strong>Name:</strong> {userinfo['name']}</li>
            <li><strong>Sub:</strong> {userinfo['sub']}</li>
        </ul>
    """
    return output

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=80)
