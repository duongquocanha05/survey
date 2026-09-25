require('dotenv').config({ quiet: true });
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieSession = require('cookie-session');
const { OAuth2Client } = require('google-auth-library');

const SESSION_DURATION_MS = 2 * 60 * 60 * 1000;
const GAS_REQUEST_TIMEOUT_MS = 20000;

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return '';
  const [local, domain] = email.split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') return local.split('+')[0].replace(/\./g, '') + '@gmail.com';
  return email;
}

function createApp(options = {}) {
  const app = express();
  const clientId = options.clientId ?? process.env.GOOGLE_CLIENT_ID ?? '';
  const gasUrl = options.gasUrl ?? process.env.GAS_URL ?? '';
  const gasSecret = options.gasSecret ?? process.env.GAS_SHARED_SECRET ?? '';
  const sessionSecret = options.sessionSecret ?? process.env.SESSION_SECRET ?? '';
  const publicOrigin = new URL(options.publicOrigin ?? process.env.PUBLIC_ORIGIN ?? 'http://localhost:3000').origin;
  const now = options.now ?? Date.now;
  const oauthClient = new OAuth2Client(clientId);
  const configured = Boolean(clientId && gasUrl && gasSecret.length >= 32 && sessionSecret.length >= 32);

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieSession({
    name: 'survey_session',
    keys: [sessionSecret || crypto.randomBytes(32).toString('hex')],
    maxAge: SESSION_DURATION_MS,
    httpOnly: true,
    sameSite: 'lax',
    secure: publicOrigin.startsWith('https://')
  }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  function requireConfiguration(_req, res, next) {
    if (!configured) return res.status(503).json({ ok: false, error: 'Đăng nhập Google chưa được cấu hình trên máy chủ.' });
    next();
  }

  function requireOrigin(req, res, next) {
    if (req.get('origin') !== publicOrigin) return res.status(403).json({ ok: false, error: 'Nguồn yêu cầu không hợp lệ.' });
    next();
  }

  function currentIdentity(req) {
    const identity = req.session;
    if (!identity || !identity.email || !/^[a-f0-9]{64}$/.test(identity.account_key || '') || identity.expires_at <= now()) return null;
    return identity;
  }

  async function signedGasRequest(data) {
    const payload = JSON.stringify({ ...data, issued_at: now() });
    const signature = crypto.createHmac('sha256', gasSecret).update(payload, 'utf8').digest('hex');
    if (options.gasTransport) return options.gasTransport(payload, signature);
    const response = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ payload, signature }),
      signal: AbortSignal.timeout(GAS_REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error('Apps Script unavailable');
    return response.json();
  }

  async function checkEligibility(identity) {
    return signedGasRequest({ action: 'check_email', email: identity.email, google_sub_hash: identity.account_key });
  }

  function sendGasError(res, result) {
    const duplicate = result.error === 'Email này đã tham gia khảo sát.';
    return res.status(duplicate ? 409 : 502).json({ ok: false, error: result.error || 'Không thể lưu khảo sát lúc này.' });
  }

  app.get('/api/auth/config', (_req, res) => res.json({ ok: configured, client_id: configured ? clientId : null }));

  app.post('/api/auth/google', requireConfiguration, requireOrigin, async (req, res) => {
    const credential = String(req.body?.credential || '');
    if (!credential || credential.length > 10000) return res.status(400).json({ ok: false, error: 'Mã đăng nhập Google không hợp lệ.' });
    let payload;
    try {
      payload = options.verifyGoogleToken
        ? await options.verifyGoogleToken(credential, clientId)
        : (await oauthClient.verifyIdToken({ idToken: credential, audience: clientId })).getPayload();
    } catch (_error) {
      return res.status(401).json({ ok: false, error: 'Đăng nhập Google không thành công. Vui lòng thử lại.' });
    }
    const email = normalizeEmail(payload?.email);
    const subject = String(payload?.sub || '');
    if (!email || !subject || payload.email_verified !== true) return res.status(401).json({ ok: false, error: 'Không xác minh được email của tài khoản Google.' });
    const accountKey = crypto.createHash('sha256').update(subject, 'utf8').digest('hex');
    const identity = { email, account_key: accountKey, expires_at: now() + SESSION_DURATION_MS };
    try {
      const eligibility = await checkEligibility(identity);
      if (!eligibility.ok) {
        req.session = null;
        return sendGasError(res, eligibility);
      }
      req.session = identity;
      return res.json({ ok: true, email, account_key: accountKey });
    } catch (_error) {
      return res.status(502).json({ ok: false, error: 'Không thể kiểm tra khảo sát lúc này. Vui lòng thử lại.' });
    }
  });

  app.get('/api/session', requireConfiguration, async (req, res) => {
    const identity = currentIdentity(req);
    if (!identity) {
      req.session = null;
      return res.status(401).json({ ok: false, error: 'Bạn cần đăng nhập Google.' });
    }
    try {
      const eligibility = await checkEligibility(identity);
      if (!eligibility.ok) {
        req.session = null;
        return sendGasError(res, eligibility);
      }
      return res.json({ ok: true, email: identity.email, account_key: identity.account_key });
    } catch (_error) {
      return res.status(502).json({ ok: false, error: 'Không thể kiểm tra khảo sát lúc này. Vui lòng thử lại.' });
    }
  });

  app.post('/api/logout', requireOrigin, (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  app.post('/api/submit', requireConfiguration, requireOrigin, async (req, res) => {
    const identity = currentIdentity(req);
    if (!identity) {
      req.session = null;
      return res.status(401).json({ ok: false, error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại bằng Google.' });
    }
    const responseId = String(req.body?.response_id || '');
    const answers = req.body?.answers;
    if (!/^SRV-[A-Z0-9-]{8,80}$/.test(responseId) || !answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return res.status(400).json({ ok: false, error: 'Dữ liệu khảo sát không hợp lệ.' });
    }
    try {
      const result = await signedGasRequest({ action: 'submit', response_id: responseId, status: 'completed', email: identity.email, google_sub_hash: identity.account_key, answers });
      if (!result.ok) return sendGasError(res, result);
      req.session = null;
      return res.json({ ok: true, response_id: result.response_id, duplicate: Boolean(result.duplicate) });
    } catch (_error) {
      return res.status(502).json({ ok: false, error: 'Không thể lưu khảo sát lúc này. Vui lòng thử lại.' });
    }
  });

  app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'main.html')));
  app.get('/main.html', (_req, res) => res.sendFile(path.join(__dirname, 'main.html')));
  app.get('/admin.html', (_req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
  app.get('/config.js', (_req, res) => res.sendFile(path.join(__dirname, 'config.js')));
  return app;
}

if (require.main === module) {
  const PORT = Number(process.env.PORT || 3000);
  createApp().listen(PORT, () => console.log(`Khảo sát đang chạy tại http://localhost:${PORT} | Admin: /admin.html`));
}

module.exports = { createApp, normalizeEmail };
