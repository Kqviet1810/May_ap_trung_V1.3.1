import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Máy chủ mẫu chỉ dành cho kiểm thử tích hợp, không được chạy với NODE_ENV=production.');
}

const settings = {
  port: Number(process.env.PORT || 8787),
  frontendOrigin: required('FRONTEND_ORIGIN'),
  frontendUrl: required('FRONTEND_URL'),
  loginPassword: required('DEV_LOGIN_PASSWORD'),
  mqttUrl: required('MQTT_WS_URL'),
  mqttUsername: required('MQTT_WEB_USERNAME'),
  mqttPassword: required('WEB_MQTT_PASSWORD'),
  pairingCode: required('PAIRING_CODE').toUpperCase(),
  deviceId: required('DEVICE_ID')
};

if (!/^MAP-[A-F0-9]{12}$/.test(settings.deviceId)) throw new Error('DEVICE_ID không hợp lệ.');
if (!/^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(settings.mqttUrl)) {
  throw new Error('Bộ test local chỉ chấp nhận MQTT_WS_URL loopback ws://.');
}

const sessions = new Map();
const loginAttempts = new Map();
const batchPlans = new Map();
const COOKIE_NAME = 'mayap_dev_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MQTT_TTL_MS = 10 * 60 * 1000;

const server = createServer(async (request, response) => {
  try {
    setSecurityHeaders(response);
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/v1/')) {
      if (!applyCors(request, response)) return sendJson(response, 403, { error: 'origin_not_allowed' });
      if (request.method === 'OPTIONS') return sendEmpty(response, 204);
      if (!sameOriginRequest(request)) return sendJson(response, 403, { error: 'invalid_origin' });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return sendJson(response, 200, { ok: true, service: 'mayap-integration-api' });
    }

    if (request.method === 'GET' && url.pathname === '/dev-login') {
      return sendHtml(response, 200, loginPage());
    }

    if (request.method === 'POST' && url.pathname === '/dev-login') {
      const address = request.socket.remoteAddress || 'unknown';
      if (!consumeLoginAttempt(address)) return sendHtml(response, 429, loginPage('Thử quá nhiều lần. Hãy đợi một phút.'));
      const form = new URLSearchParams(await readBody(request, 4096));
      if (!safeEqual(form.get('password') || '', settings.loginPassword)) {
        return sendHtml(response, 401, loginPage('Mật khẩu kiểm thử không đúng.'));
      }
      const token = randomBytes(32).toString('base64url');
      sessions.set(hash(token), { expiresAt: Date.now() + SESSION_TTL_MS });
      response.writeHead(303, {
        Location: settings.frontendUrl,
        'Set-Cookie': `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`
      });
      return response.end();
    }

    if (request.method === 'POST' && url.pathname === '/v1/mqtt/session') {
      if (!authenticated(request)) return sendJson(response, 401, { error: 'authentication_required' });
      const body = await readJson(request);
      if (body.capability !== 'device-control' || body.protocolVersion !== 1) {
        return sendJson(response, 400, { error: 'unsupported_capability' });
      }
      return sendJson(response, 200, {
        user: { id: 'usr_local_owner', name: 'Chủ máy kiểm thử', role: 'owner' },
        devices: [{ id: settings.deviceId, name: 'MAYAP bàn thử', location: 'Local lab', model: 'ESP32 transport test' }],
        mqtt: {
          url: settings.mqttUrl,
          clientId: `web-local-${randomBytes(8).toString('hex')}`,
          username: settings.mqttUsername,
          password: settings.mqttPassword,
          expiresAt: new Date(Date.now() + MQTT_TTL_MS).toISOString()
        }
      });
    }

    if (request.method === 'POST' && url.pathname === '/v1/devices/pair') {
      if (!authenticated(request)) return sendJson(response, 401, { error: 'authentication_required' });
      const body = await readJson(request);
      if (String(body.pairingCode || '').toUpperCase() !== settings.pairingCode) {
        return sendJson(response, 422, { error: 'invalid_pairing_code' });
      }
      return sendEmpty(response, 204);
    }

    const batchMatch = url.pathname.match(/^\/v1\/devices\/(MAP-[A-F0-9]{12})\/batch-plan$/);
    if (request.method === 'PUT' && batchMatch) {
      if (!authenticated(request)) return sendJson(response, 401, { error: 'authentication_required' });
      if (batchMatch[1] !== settings.deviceId) return sendJson(response, 403, { error: 'device_not_assigned' });
      const plan = await readJson(request);
      if (!validBatchPlan(plan)) return sendJson(response, 422, { error: 'invalid_batch_plan' });
      batchPlans.set(settings.deviceId, { ...plan, savedAt: new Date().toISOString() });
      return sendEmpty(response, 204);
    }

    return sendJson(response, 404, { error: 'not_found' });
  } catch (error) {
    console.error(error);
    if (!response.headersSent) sendJson(response, 500, { error: 'internal_error' });
    else response.end();
  }
});

server.listen(settings.port, '0.0.0.0', () => {
  console.log(`MAYAP integration API đang nghe cổng ${settings.port}`);
});

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions) if (session.expiresAt <= now) sessions.delete(key);
  for (const [key, attempt] of loginAttempts) if (attempt.resetAt <= now) loginAttempts.delete(key);
}, 60_000).unref();

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Thiếu biến môi trường ${name}`);
  return value;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(actual, expected) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function consumeLoginAttempt(address) {
  const now = Date.now();
  const current = loginAttempts.get(address);
  const next = !current || current.resetAt <= now ? { count: 1, resetAt: now + 60_000 } : { ...current, count: current.count + 1 };
  loginAttempts.set(address, next);
  return next.count <= 8;
}

function authenticated(request) {
  const cookies = Object.fromEntries(String(request.headers.cookie || '').split(';').map((part) => part.trim().split('=')));
  const token = cookies[COOKIE_NAME];
  if (!token) return false;
  const session = sessions.get(hash(token));
  if (!session || session.expiresAt <= Date.now()) return false;
  return true;
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (origin !== settings.frontendOrigin) return false;
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Mayap-Client');
  response.setHeader('Access-Control-Allow-Methods', 'POST, PUT, OPTIONS');
  return true;
}

function sameOriginRequest(request) {
  return request.headers.origin === settings.frontendOrigin && request.headers['sec-fetch-site'] !== 'cross-site';
}

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}

async function readBody(request, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw new Error('Request body quá lớn');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(request) {
  const raw = await readBody(request, 32 * 1024);
  return JSON.parse(raw || '{}');
}

function validBatchPlan(plan) {
  return typeof plan?.name === 'string' && plan.name.trim().length > 0 && plan.name.length <= 48 &&
    /^\d{4}-\d{2}-\d{2}$/.test(plan.startDate || '') &&
    Number.isInteger(plan.totalDays) && plan.totalDays >= 1 && plan.totalDays <= 40 &&
    Number.isFinite(plan.targetTemp) && plan.targetTemp >= 30 && plan.targetTemp <= 40 &&
    Number.isFinite(plan.targetHumidity) && plan.targetHumidity >= 20 && plan.targetHumidity <= 95 &&
    typeof plan.autoResumeAfterPower === 'boolean';
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function sendHtml(response, status, html) {
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(html);
}

function sendEmpty(response, status) {
  response.writeHead(status);
  response.end();
}

function loginPage(error = '') {
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Đăng nhập MAYAP local</title><style>body{font:16px system-ui;background:#f1f5f3;color:#17332e;display:grid;place-items:center;min-height:100vh;margin:0}.card{width:min(88vw,360px);background:white;padding:28px;border-radius:18px;box-shadow:0 18px 50px #17332e22}input,button{box-sizing:border-box;width:100%;height:48px;border-radius:11px;font:inherit}input{border:1px solid #c7d5d1;padding:0 12px}button{margin-top:12px;border:0;background:#167865;color:white;font-weight:800}.error{color:#a32838}</style><main class="card"><h1>MAYAP local</h1><p>Đăng nhập phiên kiểm thử tích hợp.</p>${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}<form method="post"><input name="password" type="password" autocomplete="current-password" required placeholder="Mật khẩu DEV_LOGIN_PASSWORD"><button>Đăng nhập và mở dashboard</button></form></main></html>`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

