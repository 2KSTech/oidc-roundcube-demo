const https = require('https');
const http = require('http');
const { URL } = require('url');

const cache = new Map();

function fetchRobotsTxt(host) {
  return new Promise((resolve) => {
    const u = new URL('https://' + host + '/robots.txt');
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, (res) => {
      if ((res.statusCode || 200) >= 300) return resolve('');
      let data = '';
      res.on('data', (d) => data += d.toString());
      res.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(''));
  });
}

async function isAllowed(host, path, userAgent = '*') {
  const key = host;
  if (!cache.has(key)) {
    const txt = await fetchRobotsTxt(host);
    cache.set(key, txt);
  }
  const rules = cache.get(key) || '';
  // naive allow: disallow path prefix for UA * or our UA
  const lines = rules.split(/\r?\n/);
  let currentUA = null;
  let disallows = [];
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const kv = l.split(':').map(s => s.trim());
    if (kv.length < 2) continue;
    const k = kv[0].toLowerCase();
    const v = kv.slice(1).join(':').trim();
    if (k === 'user-agent') {
      currentUA = v;
    } else if (k === 'disallow' && (currentUA === '*' || currentUA.toLowerCase() === userAgent.toLowerCase())) {
      disallows.push(v);
    }
  }
  return !disallows.some(prefix => prefix && path.startsWith(prefix));
}

module.exports = { isAllowed };


