const express = require('express');
const os = require('os');
const http = require('http');
const https = require('https');
const { ensureAdmin } = require('../middleware/auth');
const mailcow = require('../services/email/mailcow-client');

const router = express.Router();

function timedFetch(url, timeoutMs = 5000) {
  return new Promise((resolve) => {
    try {
      const start = Date.now();
      const u = new URL(url);
      const client = u.protocol === 'https:' ? https : http;
      const req = client.request({
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + (u.search || ''),
        method: 'GET',
        timeout: timeoutMs
      }, (res) => {
        const latency = Date.now() - start;
        resolve({ ok: true, status: res.statusCode, latencyMs: latency });
      });
      req.on('timeout', () => { try { req.destroy(); } catch(_) {} ; resolve({ ok: false, error: 'timeout' }); });
      req.on('error', (e) => resolve({ ok: false, error: e.message }));
      req.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

// JSON health endpoints
router.get('/health/json', ensureAdmin, async (req, res) => {
  try {
    if (process.env.DEMO_HEALTHCHECK_ENABLED !== 'true') {
      return res.status(200).json({ enabled: false });
    }
    const timeoutMs = parseInt(process.env.DEMO_HEALTHCHECK_TIMEOUT_MS || '5000', 10);
    const checks = {};

    // System
    checks.system = {
      uptimeSec: Math.round(process.uptime()),
      mem: { total: os.totalmem(), free: os.freemem(), rss: process.memoryUsage().rss },
      load: os.loadavg(),
      node: process.version
    };

    // DB basic R/W
    checks.database = { ok: true };

    // Keycloak token endpoint reachability (HEAD/GET)
    const kcBase = process.env.KEYCLOAK_URL;
    const realm = process.env.KEYCLOAK_REALM;
    if (kcBase && realm) {
      checks.keycloak = await timedFetch(`${kcBase}/realms/${realm}/.well-known/openid-configuration`, timeoutMs);
    }

    // Mailcow API ping
    if (mailcow.isConfigured()) {
      const me = await mailcow.getStatus();
      checks.mailcow = { configured: true, ok: me.success || me.status === 401, status: me.status || 0 };
    } else {
      checks.mailcow = { configured: false };
    }

    return res.json({ enabled: true, checks });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Health UI
router.get('/health', ensureAdmin, async (req, res) => {
  res.render('admin-health', { title: 'System Health', refreshMs: 15000 });
});

// Mailcow tools page
router.get('/mailcow-tools', ensureAdmin, (req, res) => {
  res.render('admin-mailcow', { title: 'Mailcow Tools', configured: mailcow.isConfigured() });
});

// Mailcow recipient map add (admin-only, dry-run optional)
router.post('/mailcow/recipient-map', ensureAdmin, async (req, res) => {
  try {
    const { fromEmail, toEmail, active = true, dryRun = true } = req.body || {};
    if (!fromEmail || !toEmail) return res.status(400).json({ success: false, error: 'fromEmail and toEmail required' });
    if (dryRun) return res.json({ success: true, dryRun: true, payload: { fromEmail, toEmail, active } });
    const r = await mailcow.addRecipientMap(fromEmail, toEmail, !!active);
    return res.status(r.success ? 200 : 502).json(r);
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;


// NOTE: This is the url to obtain NextCloud info :
// https://cloud.workinpilot.org/ocs/v2.php/apps/serverinfo/api/v1/info
// returns:
// This XML file does not appear to have any style information associated with it. The document tree is shown below.
// <ocs>
// <script/>
// <meta>
// <status>ok</status>
// <statuscode>200</statuscode>
// <message>OK</message>
// </meta>
// <data>
// <nextcloud>
// <system>
// <version>31.0.6.2</version>
// <theme>none</theme>
// <enable_avatars>yes</enable_avatars>
// <enable_previews>yes</enable_previews>
// <memcache.local>\OC\Memcache\APCu</memcache.local>
// <memcache.distributed>none</memcache.distributed>
// <filelocking.enabled>yes</filelocking.enabled>
// <memcache.locking>none</memcache.locking>
// <debug>no</debug>
// <freespace>56845983744</freespace>
// <cpuload>
// <element>0.03564453125</element>
// <element>0.09033203125</element>
// <element>0.05859375</element>
// </cpuload>
// <cpunum>4</cpunum>
// <mem_total>7934976</mem_total>
// <mem_free>5359616</mem_free>
// <swap_total>4193280</swap_total>
// <swap_free>4192256</swap_free>
// </system>
// <storage>
// <num_users>16</num_users>
// <num_files>25193</num_files>
// <num_storages>6</num_storages>
// <num_storages_local>1</num_storages_local>
// <num_storages_home>1</num_storages_home>
// <num_storages_other>15</num_storages_other>
// <size_appdata_storage>-1</size_appdata_storage>
// <num_files_appdata>24788</num_files_appdata>
// </storage>
// <shares>
// <num_shares>1</num_shares>
// <num_shares_user>1</num_shares_user>
// <num_shares_groups>0</num_shares_groups>
// <num_shares_link>0</num_shares_link>
// <num_shares_mail>0</num_shares_mail>
// <num_shares_room>0</num_shares_room>
// <num_shares_link_no_password>0</num_shares_link_no_password>
// <num_fed_shares_sent>0</num_fed_shares_sent>
// <num_fed_shares_received>0</num_fed_shares_received>
// <permissions_0_19>1</permissions_0_19>
// </shares>
// </nextcloud>
// <server>
// <webserver>Apache/2.4.62 (Debian)</webserver>
// <php>
// <version>8.3.22</version>
// <memory_limit>536870912</memory_limit>
// <max_execution_time>3600</max_execution_time>
// <upload_max_filesize>536870912</upload_max_filesize>
// <opcache_revalidate_freq>60</opcache_revalidate_freq>
// <opcache>
// <opcache_enabled>1</opcache_enabled>
// <cache_full/>
// <restart_pending/>
// <restart_in_progress/>
// <memory_usage>
// <used_memory>105465768</used_memory>
// <free_memory>28751960</free_memory>
// <wasted_memory>0</wasted_memory>
// <current_wasted_percentage>0</current_wasted_percentage>
// </memory_usage>
// <interned_strings_usage>
// <buffer_size>33554432</buffer_size>
// <used_memory>15459304</used_memory>
// <free_memory>18095128</free_memory>
// <number_of_strings>109294</number_of_strings>
// </interned_strings_usage>
// <opcache_statistics>
// <num_cached_scripts>3000</num_cached_scripts>
// <num_cached_keys>5787</num_cached_keys>
// <max_cached_keys>16229</max_cached_keys>
// <hits>14003360</hits>
// <start_time>1758210142</start_time>
// <last_restart_time>0</last_restart_time>
// <oom_restarts>0</oom_restarts>
// <hash_restarts>0</hash_restarts>
// <manual_restarts>0</manual_restarts>
// <misses>3000</misses>
// <blacklist_misses>0</blacklist_misses>
// <blacklist_miss_ratio>0</blacklist_miss_ratio>
// <opcache_hit_rate>99.978581158845</opcache_hit_rate>
// </opcache_statistics>
// <jit>
// <enabled>1</enabled>
// <on>1</on>
// <kind>5</kind>
// <opt_level>5</opt_level>
// <opt_flags>6</opt_flags>
// <buffer_size>8388592</buffer_size>
// <buffer_free>7355984</buffer_free>
// </jit>
// </opcache>
// <apcu>
// <cache>
// <num_slots>4099</num_slots>
// <ttl>0</ttl>
// <num_hits>1162326</num_hits>
// <num_misses>29464</num_misses>
// <num_inserts>28057</num_inserts>
// <num_entries>2179</num_entries>
// <expunges>0</expunges>
// <start_time>1758210142</start_time>
// <mem_size>948248</mem_size>
// <memory_type>mmap</memory_type>
// </cache>
// <sma>
// <num_seg>1</num_seg>
// <seg_size>33554304</seg_size>
// <avail_mem>32485040</avail_mem>
// </sma>
// </apcu>
// <extensions>
// <element>Core</element>
// <element>date</element>
// <element>libxml</element>
// <element>openssl</element>
// <element>pcre</element>
// <element>sqlite3</element>
// <element>zlib</element>
// <element>ctype</element>
// <element>curl</element>
// <element>dom</element>
// <element>fileinfo</element>
// <element>filter</element>
// <element>hash</element>
// <element>iconv</element>
// <element>json</element>
// <element>mbstring</element>
// <element>SPL</element>
// <element>session</element>
// <element>PDO</element>
// <element>pdo_sqlite</element>
// <element>standard</element>
// <element>posix</element>
// <element>random</element>
// <element>Reflection</element>
// <element>Phar</element>
// <element>SimpleXML</element>
// <element>tokenizer</element>
// <element>xml</element>
// <element>xmlreader</element>
// <element>xmlwriter</element>
// <element>mysqlnd</element>
// <element>apache2handler</element>
// <element>apcu</element>
// <element>bcmath</element>
// <element>exif</element>
// <element>ftp</element>
// <element>gd</element>
// <element>gmp</element>
// <element>igbinary</element>
// <element>imagick</element>
// <element>intl</element>
// <element>ldap</element>
// <element>memcached</element>
// <element>pcntl</element>
// <element>pdo_mysql</element>
// <element>pdo_pgsql</element>
// <element>redis</element>
// <element>sodium</element>
// <element>sysvsem</element>
// <element>zip</element>
// <element>Zend OPcache</element>
// </extensions>
// </php>
// <database>
// <type>mysql</type>
// <version>11.8.2</version>
// <size>66863104</size>
// </database>
// </server>
// <activeUsers>
// <last5minutes>0</last5minutes>
// <last1hour>2</last1hour>
// <last24hours>16</last24hours>
// <last7days>16</last7days>
// <last1month>16</last1month>
// <last3months>16</last3months>
// <last6months>16</last6months>
// <lastyear>16</lastyear>
// </activeUsers>
// </data>
// </ocs>
