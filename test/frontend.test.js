const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../main.html'), 'utf8');

test('survey uses Google login and its own authenticated API', () => {
  assert.match(html, /accounts\.google\.com\/gsi\/client/);
  assert.match(html, /id="google-signin-button"/);
  assert.match(html, /id="btn-start"[^>]*disabled/);
  assert.match(html, /apiRequest\('\/api\/auth\/google'/);
  assert.match(html, /apiRequest\('\/api\/submit'/);
  assert.doesNotMatch(html, /id="survey-email"|fetch\(SURVEY_API_URL/);
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(Boolean);
  scripts.forEach(script => new Function(script));
});

test('referral question remains alone on its own survey page', () => {
  const likertPage = html.split('<section id="step-8"')[1].split('</section>')[0];
  const referralPage = html.split('<section id="step-9"')[1].split('</section>')[0];
  assert.ok(!likertPage.includes('name="Referral"'));
  assert.equal((referralPage.match(/name="Referral"/g) || []).length, 6);
  assert.ok(!referralPage.includes('<h2') && !referralPage.includes('<h3'));
});
