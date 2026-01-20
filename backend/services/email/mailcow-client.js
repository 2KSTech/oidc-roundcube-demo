const axios = require('axios');

class MailcowClient {
  constructor() {
    const explicitApiUrl = process.env.WORKINPILOT_MAILCOW_API_URL || process.env.MAILCOW_API_URL;
    const baseFromMailcowUrl = (process.env.MAILCOW_URL || '').replace(/\/$/, '');
    this.apiBaseUrl = (explicitApiUrl || (baseFromMailcowUrl ? `${baseFromMailcowUrl}/api` : 'https://mail.workinpilot.space/api'));
    this.apiKey = process.env.WORKINPILOT_MAILCOW_API_TOKEN || process.env.MAILCOW_API_KEY;
    this.http = axios.create({
      baseURL: this.apiBaseUrl,
      timeout: 7000,
      headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {}
    });
  }

  isConfigured() {
    return !!(this.apiBaseUrl && this.apiKey);
  }
  
  async getVersion() {
    try {
      if (!this.isConfigured()) {
        return { success: false, status: 0, error: 'Mailcow client not configured' };
      }
      const url = `/v1/get/status/version`;
      const res = await this.http.get(url, { validateStatus: () => true });
      if (res.status === 200 && res.data && typeof res.data === 'object') {
        return { success: true, status: 200, version: res.data };
      }
      if (res.status === 401) {
        return { success: false, status: 401, error: 'Not authorized' };
      }
      return { success: false, status: res.status, error: 'Unexpected response' };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }

  async getStatus() {
    try {
      if (!this.isConfigured()) {
        return { success: false, status: 0, error: 'Mailcow client not configured' };
      }
      const url = `/v1/get/status/vmail`;
      const res = await this.http.get(url, { validateStatus: () => true });
      if (res.status === 200 && res.data && typeof res.data === 'object') {
        return { success: true, status: 200, data: res.data };
      }
      if (res.status === 401) {
        return { success: false, status: 401, error: 'Not authorized' };
      }
      return { success: false, status: res.status, error: 'Unexpected response' };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }
  // Get all mailboxes by domain
  // Example request:
  // GET /api/v1/get/mailbox/all/domain3.tld
  // Example response:
  // [
  //   {
  //     "active": "1",
  //     "attributes": {
  //       "force_pw_update": "0",
  //       "mailbox_format": "maildir:",
  //       "quarantine_notification": "never",
  //       "sogo_access": "1",
  //       "tls_enforce_in": "0",
  //       "tls_enforce_out": "0"
  //     },
  //     "custom_attributes": {},
  //     "domain": "domain3.tld",
  //     "is_relayed": 0,
  //     "local_part": "info",
  //     "max_new_quota": 10737418240,
  //     "messages": 0,
  //     "name": "Full name",
  //     "percent_class": "success",
  //     "percent_in_use": 0,
  //     "quota": 3221225472,
  //     "quota_used": 0,
  //     "rl": false,
  //     "spam_aliases": 0,
  //     "username": "info@domain3.tld",
  //     "tags": [
  //       "tag1",
  //       "tag2"
  //     ]
  //   }
  // ]
  async getMailboxes(domain) {
    try {
      if (!domain) throw new Error('domain is required');
      if (!this.isConfigured()) {
        return { success: false, status: 0, error: 'Mailcow client not configured' };
      }
      const encoded = encodeURIComponent(domain);
      const url = `/v1/get/mailbox/all/${encoded}`;
      const res = await this.http.get(url, { validateStatus: () => true });
      if (res.status === 200 && res.data && typeof res.data === 'object') {
        return { success: true, status: 200, mailboxes: res.data };
      }
      if (res.status === 404) {
        return { success: false, status: 404, error: 'Not found' };
      }
      return { success: false, status: res.status, error: 'Unexpected response' };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }
  
  // Get single mailbox by Mailcow ID (or username if API treats it as id)
  async getMailboxById(id) {
    try {
      if (!id) throw new Error('id is required');
      if (!this.isConfigured()) {
        return { success: false, status: 0, error: 'Mailcow client not configured' };
      }
      const encoded = encodeURIComponent(String(id));
      const url = `/v1/get/mailbox/${encoded}`;
      const res = await this.http.get(url, { validateStatus: () => true });
      if (res.status === 200 && res.data && typeof res.data === 'object') {
        return { success: true, status: 200, mailbox: res.data };
      }
      if (res.status === 404) {
        return { success: false, status: 404, error: 'Not found' };
      }
      return { success: false, status: res.status, error: 'Unexpected response' };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }
  // Get mailbox by email address
  // Robust implementation:
  // 1) Try direct endpoint (older installs may accept username)
  // 2) On 404, list domain mailboxes and return the matching entry by username
  async getMailbox(emailAddress) {
    try {
      if (!emailAddress) throw new Error('emailAddress is required');
      if (!this.isConfigured()) {
        return { success: false, status: 0, error: 'Mailcow client not configured' };
      }
      // Attempt direct fetch using supplied value as id (many installs accept username here)
      const direct = await this.getMailboxById(emailAddress);
      if (direct.success || direct.status !== 404) return direct;
      // Fallback: enumerate domain, match by username
      const at = String(emailAddress).lastIndexOf('@');
      if (at <= 0) return { success: false, status: 400, error: 'Invalid email' };
      const domain = emailAddress.slice(at + 1);
      const list = await this.getMailboxes(domain);
      if (!list.success || !Array.isArray(list.mailboxes)) {
        return { success: false, status: list.status || 500, error: list.error || 'Failed to list domain mailboxes' };
      }
      const hit = list.mailboxes.find(m => (m?.username || '').toLowerCase() === String(emailAddress).toLowerCase());
      if (!hit) {
        return { success: false, status: 404, error: 'Not found' };
      }
      // If listing contains an id, use it; otherwise use username as id
      const candidateId = hit.id || hit.username || emailAddress;
      const byId = await this.getMailboxById(candidateId);
      return byId.success ? byId : { success: true, status: 200, mailbox: hit };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }

  // Add a new bcc map
  // Example request body:
  // {
  //   "active": "1",
  //   "bcc_dest": "bcc@awesomecow.tld",
  //   "local_dest": "mailcow.tld",
  //   "type": "sender"
  // }
  // Example response:
  // [
  //   {
  //     "log": [
  //       "bcc",
  //       "add",
  //       {
  //         "active": "1",
  //         "bcc_dest": "bcc@awesomecow.tld",
  //         "local_dest": "mailcow.tld",
  //         "type": "sender"
  //       },
  //       null
  //     ],
  //     "msg": "bcc_saved",
  //     "type": "success"
  //   }
  // ]
  async addBccMap(local_dest, bcc_dest, active = true) {
    try {
      if (!this.isConfigured()) return { success: false, status: 0, error: 'Mailcow client not configured' };
      if (!local_dest || !bcc_dest) return { success: false, status: 0, error: 'local_dest and bcc_dest required' };
      const body = {
        active: active ? '1' : '0',
        bcc_dest: String(bcc_dest),
        local_dest: String(local_dest),
        "type": "sender"
      };
      const res = await this.http.post('/v1/add/bcc', body, { validateStatus: () => true });
      if (res.status >= 200 && res.status < 300) {
        return { success: true, status: res.status, data: res.data };
      }
      return { success: false, status: res.status, error: 'Request failed', data: res.data };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }

  async addRecipientMap(oldEmail, newEmail, active = true) {
    try {
      if (!this.isConfigured()) return { success: false, status: 0, error: 'Mailcow client not configured' };
      if (!oldEmail || !newEmail) return { success: false, status: 0, error: 'oldEmail and newEmail required' };
      const body = {
        active: active ? '1' : '0',
        recipient_map_new: String(newEmail),
        recipient_map_old: String(oldEmail)
      };
      const res = await this.http.post('/v1/add/recipient_map', body, { validateStatus: () => true });
      if (res.status >= 200 && res.status < 300) {
        return { success: true, status: res.status, data: res.data };
      }
      return { success: false, status: res.status, error: 'Request failed', data: res.data };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }

  /*

  Ref: https://mailcow.docs.apiary.io/#reference/app-passwords/create-app-password/create-app-password

      var request = new XMLHttpRequest();
      request.open('POST', 'https://mailcow.host/api/v1/add/app-passwd');
      request.setRequestHeader('Content-Type', 'application/json');
      request.setRequestHeader('X-API-Key', 'api-key-string');
      request.onreadystatechange = function () {
        if (this.readyState === 4) {
          console.log('Status:', this.status);
          console.log('Headers:', this.getAllResponseHeaders());
          console.log('Body:', this.responseText);
        }
      };
      var body = {
        'username': 'hello@mailcow.email'
        'app_name': 'emclient',
        'app_passwd': 'keyleudecticidechothistishownsan31',
        'app_passwd2': 'keyleudecticidechothistishownsan31',
        'active': '1'
      };
      request.send(JSON.stringify(body));

*/

  async addAppPw(email, appName, appPassword) {
    try {
      if (!this.isConfigured()) 
        return { success: false, status: 0, error: 'Mailcow client not configured' };
      if (!email || !appPassword) 
        return { success: false, status: 0, error: 'email adddr and appPassword required' };
      
      const body = {
        username: username,
        app_name: appName || "WorkInPilot",
        app_passwd: appPassword,
        app_passwd2: appPassword,
        active: "1",
        // smtp_access: "1"
      };
      
      const res = await this.http.post('/v1/add/app-passwd', body, { validateStatus: () => true });
      if (res.status >= 200 && res.status < 300) {
        return { success: true, status: res.status, data: res.data };
      }
      return { success: false, status: res.status, error: 'Request failed', data: res.data };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }

  async getBccMap(id) {
    try {
      if (!this.isConfigured()) return { success: false, status: 0, error: 'Mailcow client not configured' };
      const res = await this.http.get(`/v1/get/bcc/${id}`, { validateStatus: () => true });
      if (res.status >= 200 && res.status < 300) {
        return { success: true, status: res.status, data: res.data };
      }
      return { success: false, status: res.status, error: 'Request failed', data: res.data };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }

  async getAllBccMaps() {
    try {
      if (!this.isConfigured()) return { success: false, status: 0, error: 'Mailcow client not configured' };
      const res = await this.http.get('/v1/get/bcc/all', { validateStatus: () => true });
      if (res.status >= 200 && res.status < 300) {
        return { success: true, status: res.status, data: res.data };
      }
      return { success: false, status: res.status, error: 'Request failed', data: res.data };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }

  async getRecipientMap(id) {
    try {
      if (!this.isConfigured()) return { success: false, status: 0, error: 'Mailcow client not configured' };
      const res = await this.http.get(`/v1/get/recipient_map/${id}`, { validateStatus: () => true });
      if (res.status >= 200 && res.status < 300) {
        return { success: true, status: res.status, data: res.data };
      }
      return { success: false, status: res.status, error: 'Request failed', data: res.data };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }

  async getAllRecipientMaps() {
    try {
      if (!this.isConfigured()) return { success: false, status: 0, error: 'Mailcow client not configured' };
      const res = await this.http.get('/v1/get/recipient_map/all', { validateStatus: () => true });
      if (res.status >= 200 && res.status < 300) {
        return { success: true, status: res.status, data: res.data };
      }
      return { success: false, status: res.status, error: 'Request failed', data: res.data };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }

  async deleteBccMap(id) {
    try {
      if (!this.isConfigured()) return { success: false, status: 0, error: 'Mailcow client not configured' };
      const body = [id];
      const res = await this.http.post('/v1/delete/bcc', body, { validateStatus: () => true });
      if (res.status >= 200 && res.status < 300) {
        return { success: true, status: res.status, data: res.data };
      }
      return { success: false, status: res.status, error: 'Request failed', data: res.data };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }

  async getAllAppPasswords(mailbox) {
    try {
      if (!this.isConfigured()) return { success: false, status: 0, error: 'Mailcow client not configured' };
      const res = await this.http.get(`/v1/get/app-passwd/all/${mailbox}`, { validateStatus: () => true });
      if (res.status >= 200 && res.status < 300) {
        return { success: true, status: res.status, data: res.data };
      }
      return { success: false, status: res.status, error: 'Request failed', data: res.data };
    } catch (err) {
      return { success: false, status: 0, error: err.message || String(err) };
    }
  }

}
module.exports = new MailcowClient();
