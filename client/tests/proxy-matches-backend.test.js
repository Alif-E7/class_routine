// Guard: the Vite dev-server proxy must target the same port the
// backend actually listens on. Drifting these two used to silently
// break every API call in the browser (axios -> 502 / Network Error).
//
// Run with:  node tests/proxy-matches-backend.test.js
// Exit code 0 = pass, 1 = mismatch.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const viteCfgPath = path.join(root, 'vite.config.js');
const envPath = path.join(root, '..', 'backend', '.env');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

const viteSrc = fs.readFileSync(viteCfgPath, 'utf8');
const proxyMatch = viteSrc.match(/target:\s*['"]http:\/\/localhost:(\d+)['"]/);
if (!proxyMatch) fail('vite.config.js proxy target not found or not on localhost');
const proxyPort = Number(proxyMatch[1]);

// Try backend/.env for PORT, default to 4000 (matches src/server.js default).
let backendPort = 4000;
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf8');
  const m = env.match(/^PORT\s*=\s*(\d+)/m);
  if (m) backendPort = Number(m[1]);
}

if (proxyPort !== backendPort) {
  fail(
    `vite proxy port ${proxyPort} != backend PORT ${backendPort}. ` +
    `Fix: edit client/vite.config.js proxy.target to "http://localhost:${backendPort}".`
  );
}

console.log(`OK: vite proxy :${proxyPort} matches backend PORT :${backendPort}`);