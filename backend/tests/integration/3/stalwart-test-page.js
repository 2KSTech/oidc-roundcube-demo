#!/usr/bin/env node
/**
 * Stalwart Mail Service Test Page - Node.js Version
 * 
 * Tests all 3 things the webapp does with mail:
 * 1. Pre-deploy (pre-auth) - Stop bounces before user logs in
 * 2. You've got mail counter - Get unread count via JMAP
 * 3. Send mail - Send email via SMTP (with OAuth if available)
 */

require('dotenv').config({ path: './backend/.env' });
const axios = require('axios');
const nodemailer = require('nodemailer');

const BASE_URL = process.env.WORKINPILOT_STALWART_API_URL?.replace(/\/api$/, '') 
  || process.env.STALWART_URL 
  || 'https://mailqa.workinpilot.cloud';
const API_URL = `${BASE_URL}/api`;
const API_KEY = process.env.WORKINPILOT_STALWART_API_TOKEN 
  || process.env.WORKINPILOT_MAIL_API_TOKEN;
const DOMAIN = process.env.WORKINPILOT_INTERNAL_EMAIL_DOMAIN || 'workinpilot.space';

// Test user
const USERNAME = process.argv[2] || 'testuser';
const EMAIL = `${USERNAME}@${DOMAIN}`;

async function predeploy() {
  console.log('\n=== 1. PRE-DEPLOY (Pre-auth) ===');
  console.log(`Email: ${EMAIL}`);

  try {
    const res = await axios.post(`${API_URL}/principal`, {
      name: USERNAME,
      email: EMAIL,
      type: 'individual'
    }, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    });

    if (res.status >= 200 && res.status < 300) {
      console.log(`OK SUCCESS (${res.status})`);
      console.log(JSON.stringify(res.data, null, 2));
      return true;
    } else if (res.status === 409) {
      console.log(`OK Already exists (409)`);
      return true;
    } else {
      console.log(`FAIL FAILED (${res.status})`);
      console.log(JSON.stringify(res.data, null, 2));
      return false;
    }
  } catch (error) {
    console.log(`FAIL ERROR: ${error.message}`);
    return false;
  }
}

async function getUnreadCount(userToken) {
  console.log('\n=== 2. YOU\'VE GOT MAIL COUNTER (JMAP) ===');
  
  if (!userToken) {
    console.log('WARN:  Skipping - no user OAuth token provided');
    console.log('Set USER_TOKEN env var or pass as 3rd arg');
    return null;
  }

  try {
    // Get JMAP session
    const sessionRes = await axios.get(`${BASE_URL}/jmap/session`, {
      headers: {
        'Authorization': `Bearer ${userToken}`
      },
      validateStatus: () => true
    });

    if (sessionRes.status !== 200) {
      throw new Error(`Session failed: ${sessionRes.status} ${JSON.stringify(sessionRes.data)}`);
    }

    const session = sessionRes.data;
    const accountId = session.primaryAccounts?.['urn:ietf:params:jmap:mail'] 
      || (session.accounts ? Object.keys(session.accounts)[0] : null);

    if (!accountId) {
      throw new Error('No account ID found in session');
    }

    console.log(`Account ID: ${accountId}`);

    // Get mailboxes
    const jmapRes = await axios.post(`${BASE_URL}/jmap`, {
      using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
      methodCalls: [
        ['Mailbox/get', {
          accountId: accountId,
          properties: ['id', 'name', 'role', 'totalEmails', 'unreadEmails', 'totalThreads', 'unreadThreads']
        }, 'c1']
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      validateStatus: () => true
    });

    const response = jmapRes.data;
    const inbox = response.methodResponses?.[0]?.[1]?.list?.find(m => m.role === 'inbox');

    if (inbox) {
      console.log(`OK Unread: ${inbox.unreadEmails || 0}`);
      console.log(`   Total: ${inbox.totalEmails || 0}`);
      console.log(JSON.stringify(inbox, null, 2));
      return inbox.unreadEmails || 0;
    } else {
      console.log(`WARN:  No inbox found`);
      console.log(JSON.stringify(response, null, 2));
      return null;
    }
  } catch (error) {
    console.log(`FAIL ERROR: ${error.message}`);
    return null;
  }
}

async function sendMail(userToken) {
  console.log('\n=== 3. SEND MAIL (SMTP) ===');
  console.log(`To: ${EMAIL}`);
  console.log(`From: mailadmin@${DOMAIN}`);

  const smtpHost = BASE_URL.replace(/^https?:\/\//, '');
  const smtpPort = 587;

  try {
    // Try XOAUTH2 if token provided, otherwise fall back to admin password
    let transporter;
    
    if (userToken) {
      console.log('Attempting XOAUTH2...');
      // XOAUTH2 format: base64("user=email\x01auth=Bearer token\x01\x01")
      const xoauth2 = Buffer.from(`user=${EMAIL}\x01auth=Bearer ${userToken}\x01\x01`).toString('base64');
      
      transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: false,
        auth: {
          user: EMAIL,
          method: 'XOAUTH2',
          accessToken: userToken
        },
        tls: {
          rejectUnauthorized: false
        }
      });
    } else {
      console.log('Using admin password (fallback)...');
      const adminPassword = process.env.STALWART_ADMIN_PASSWORD || process.env.NEXTCLOUD_ADMIN_PW;
      if (!adminPassword) {
        throw new Error('No OAuth token or admin password provided');
      }

      transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: false,
        auth: {
          user: `mailadmin@${DOMAIN}`,
          pass: adminPassword
        },
        tls: {
          rejectUnauthorized: false
        }
      });
    }

    const result = await transporter.sendMail({
      from: `mailadmin@${DOMAIN}`,
      to: EMAIL,
      subject: `Test from Stalwart Test Page - ${new Date().toISOString()}`,
      text: 'This is a test email sent from the Stalwart test page.'
    });

    console.log(`OK SUCCESS`);
    console.log(`Message ID: ${result.messageId}`);
    console.log(`Response: ${result.response}`);
    return true;
  } catch (error) {
    console.log(`FAIL ERROR: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('Stalwart Mail Service Test Page');
  console.log('================================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`API URL: ${API_URL}`);
  console.log(`Domain: ${DOMAIN}`);
  console.log(`Test user: ${EMAIL}`);

  const userToken = process.argv[3] || process.env.USER_TOKEN;

  const predeployResult = await predeploy();
  const unreadCount = await getUnreadCount(userToken);
  const sendResult = await sendMail(userToken);

  console.log('\n=== SUMMARY ===');
  console.log(`Pre-deploy: ${predeployResult ? 'OK' : 'FAIL'}`);
  console.log(`Unread count: ${unreadCount !== null ? `OK ${unreadCount}` : 'WARN:  Skipped'}`);
  console.log(`Send mail: ${sendResult ? 'OK' : 'FAIL'}`);
}

main().catch(console.error);

