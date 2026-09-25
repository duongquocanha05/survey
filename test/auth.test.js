const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createApp } = require('../server');

const ORIGIN = 'http://localhost:3000';
const SECRET = 'test-shared-secret-of-at-least-32-bytes';

async function setup(t, options = {}) {
  let clock = Date.now();
  const rows = options.rows || [];
  const requests = [];
  const app = createApp({
    clientId: 'test-client-id',
    gasUrl: 'https://example.invalid/exec',
    gasSecret: SECRET,
    sessionSecret: 'test-session-secret-of-at-least-32-bytes',
    publicOrigin: ORIGIN,
    now: () => clock,
    verifyGoogleToken: async token => {
      if (token === 'invalid') throw new Error('Invalid token');
      if (token === 'unverified') return { email: 'test@gmail.com', sub: 'subject-1', email_verified: false };
      if (token === 'other-account') return { email: 'other@gmail.com', sub: 'subject-2', email_verified: true };
      return { email: 'Test.Name+survey@gmail.com', sub: 'subject-1', email_verified: true };
    },
    gasTransport: async (payload, signature) => {
      assert.equal(signature, crypto.createHmac('sha256', SECRET).update(payload).digest('hex'));
      const request = JSON.parse(payload);
      requests.push(request);
      const exists = rows.some(row => row.email === request.email || row.account_key === request.google_sub_hash);
      if (request.action === 'check_email') return exists ? { ok: false, error: 'Email này đã tham gia khảo sát.' } : { ok: true };
      if (request.action === 'submit') {
        if (exists) return { ok: false, error: 'Email này đã tham gia khảo sát.' };
        rows.push({ email: request.email, account_key: request.google_sub_hash });
        return { ok: true, response_id: request.response_id };
      }
      throw new Error('Unexpected action');
    }
  });
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, body, cookie = '', origin = ORIGIN) => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
  };
  return { request, requests, rows, advance: milliseconds => { clock += milliseconds; } };
}

test('Google identity is checked and only the verified email reaches Apps Script', async t => {
  const { request, requests } = await setup(t);
  const login = await request('/api/auth/google', { credential: 'valid', email: 'forged@example.com' });
  assert.equal(login.status, 200);
  assert.equal(login.body.email, 'testname@gmail.com');
  assert.ok(login.cookie.includes('survey_session='));
  const session = await request('/api/session', undefined, login.cookie);
  assert.equal(session.body.email, 'testname@gmail.com');
  const submitted = await request('/api/submit', { response_id: 'SRV-ABCDEF12', email: 'forged@example.com', answers: { S1: 'Có' } }, login.cookie);
  assert.equal(submitted.status, 200);
  assert.equal(requests.at(-1).email, 'testname@gmail.com');
  assert.notEqual(requests.at(-1).google_sub_hash, 'subject-1');
  assert.equal((await request('/api/auth/google', { credential: 'valid' })).status, 409);
});

test('missing, invalid, unverified, or cross-origin credentials cannot start a survey', async t => {
  const { request } = await setup(t);
  assert.equal((await request('/api/submit', { response_id: 'SRV-ABCDEF12', answers: {} })).status, 401);
  assert.equal((await request('/api/auth/google', { credential: 'invalid' })).status, 401);
  assert.equal((await request('/api/auth/google', { credential: 'unverified' })).status, 401);
  assert.equal((await request('/api/auth/google', { credential: 'valid' }, '', 'https://other.example')).status, 403);
});

test('old email rows and Google account identifiers both block another response', async t => {
  const oldEmail = 'testname@gmail.com';
  const { request } = await setup(t, { rows: [{ email: oldEmail, account_key: '' }] });
  assert.equal((await request('/api/auth/google', { credential: 'valid' })).status, 409);
  assert.equal((await request('/api/auth/google', { credential: 'other-account' })).status, 200);
});

test('session expires after two hours and account switching clears it', async t => {
  const { request, advance } = await setup(t);
  const login = await request('/api/auth/google', { credential: 'valid' });
  const logout = await request('/api/logout', {}, login.cookie);
  assert.equal(logout.status, 200);
  assert.equal((await request('/api/submit', { response_id: 'SRV-ABCDEF12', answers: {} }, logout.cookie)).status, 401);
  const nextLogin = await request('/api/auth/google', { credential: 'valid' });
  advance(2 * 60 * 60 * 1000 + 1);
  assert.equal((await request('/api/submit', { response_id: 'SRV-ABCDEF12', answers: {} }, nextLogin.cookie)).status, 401);
});
