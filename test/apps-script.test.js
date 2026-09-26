const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const SECRET = 'test-shared-secret-of-at-least-32-bytes';
const code = fs.readFileSync(path.join(__dirname, '../google-apps-script/Code.gs'), 'utf8');

class Sheet {
  constructor(headers, rows = []) {
    this.rows = [[...headers], ...rows.map(row => [...row])];
    this.maxColumns = headers.length;
  }
  getMaxColumns() { return this.maxColumns; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows[0].length; }
  insertColumnsAfter(index, count) {
    this.maxColumns += count;
    this.rows.forEach(row => row.splice(index, 0, ...Array(count).fill('')));
  }
  insertColumnBefore(index) {
    this.maxColumns++;
    this.rows.forEach(row => row.splice(index - 1, 0, ''));
  }
  appendRow(row) { this.rows.push([...row]); }
  getDataRange() { return { getValues: () => this.rows.map(row => [...row]) }; }
  getRange(startRow, startColumn, rowCount = 1, columnCount = 1) {
    return {
      getValue: () => this.rows[startRow - 1][startColumn - 1],
      setValue: value => { this.rows[startRow - 1][startColumn - 1] = value; },
      getValues: () => this.rows.slice(startRow - 1, startRow - 1 + rowCount).map(row => row.slice(startColumn - 1, startColumn - 1 + columnCount)),
      setValues: values => values.forEach((value, index) => { this.rows[startRow - 1 + index].splice(startColumn - 1, columnCount, ...value); })
    };
  }
}

function setup(oldRows = [], headerOrder) {
  let sheet;
  const context = vm.createContext({
    console: { error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: name => name === 'SURVEY_SHARED_SECRET' ? SECRET : null }) },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      computeHmacSha256Signature: (payload, secret) => [...crypto.createHmac('sha256', secret).update(payload, 'utf8').digest()].map(byte => byte > 127 ? byte - 256 : byte)
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => sheet }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }
  });
  vm.runInContext(code, context);
  const headers = vm.runInContext('HEADERS', context);
  const oldHeaders = headers.filter(header => header !== 'google_sub_hash');
  sheet = new Sheet(headerOrder || oldHeaders, oldRows);
  context.request = null;
  const call = (body, validSignature = true) => {
    const payload = JSON.stringify({ ...body, issued_at: body.issued_at ?? Date.now() });
    const signature = validSignature ? crypto.createHmac('sha256', SECRET).update(payload).digest('hex') : '';
    context.request = { parameter: { payload, signature } };
    return JSON.parse(vm.runInContext('doPost(request).text', context));
  };
  const fields = vm.runInContext('FIELDS', context);
  const answers = Object.fromEntries(fields.map(field => [field, 'x']));
  answers.S1 = 'Có';
  answers.Referral = 'Lê Thị Như Phương';
  ['TL1', 'TL2', 'TT1', 'TT2', 'YD1', 'YD2'].forEach(field => { answers[field] = '3'; });
  ['Q4_3_Opt1', 'Q4_3_Opt2', 'Q4_3_Opt3', 'Q4_3_Opt4'].forEach((field, index) => { answers[field] = String(index + 1); });
  return { context, sheet, headers, oldHeaders, answers, call };
}

test('Apps Script preserves old email cells while adding the Google account column', () => {
  const oldHeaders = setup().oldHeaders;
  const oldRow = Array(oldHeaders.length).fill('');
  oldRow[oldHeaders.indexOf('email')] = 'old@gmail.com';
  const { context, sheet, headers } = setup([oldRow]);
  vm.runInContext('authorizeDeployment()', context);
  assert.equal(sheet.rows[0][headers.indexOf('google_sub_hash')], 'google_sub_hash');
  assert.equal(sheet.rows[1][headers.indexOf('email')], 'old@gmail.com');
  vm.runInContext('authorizeDeployment()', context);
  assert.equal(sheet.rows[0].filter(value => value === 'google_sub_hash').length, 1);
});

test('unsigned and expired Apps Script requests are rejected', () => {
  const { call, answers } = setup();
  const body = { action: 'submit', email: 'new@gmail.com', google_sub_hash: 'a'.repeat(64), response_id: 'SRV-ABCDEF12', answers };
  assert.equal(call(body, false).error, 'Unauthorized');
  assert.equal(call({ ...body, issued_at: Date.now() - 10 * 60 * 1000 }).error, 'Request expired');
});

test('signed Apps Script failures include a diagnostic detail without accepting unsigned requests', () => {
  const { context, call } = setup();
  context.SpreadsheetApp.openById = () => { throw new Error('Spreadsheet access denied for test'); };
  const body = { action: 'check_email', email: 'new@gmail.com', google_sub_hash: 'a'.repeat(64) };
  assert.equal(call(body, false).error, 'Unauthorized');
  const result = call(body);
  assert.equal(result.error, 'Unable to save response');
  assert.equal(result.detail, 'Spreadsheet access denied for test');
});

test('signed submissions keep one response per email and Google account', () => {
  const { call, sheet, headers, answers } = setup();
  const accountKey = 'a'.repeat(64);
  const body = { action: 'submit', email: 'new@gmail.com', google_sub_hash: accountKey, response_id: 'SRV-ABCDEF12', answers };
  assert.equal(call(body).ok, true);
  assert.equal(sheet.rows[1][headers.indexOf('email')], 'new@gmail.com');
  assert.equal(sheet.rows[1][headers.indexOf('google_sub_hash')], accountKey);
  assert.equal(call(body).duplicate, true);
  assert.equal(sheet.rows.length, 2);
  assert.equal(call({ ...body, email: 'other@gmail.com', response_id: 'SRV-OTHER123' }).error, 'Email này đã tham gia khảo sát.');
  assert.equal(call({ ...body, email: 'n.e.w+again@gmail.com', google_sub_hash: 'b'.repeat(64), response_id: 'SRV-OTHER456' }).error, 'Email này đã tham gia khảo sát.');
});

test('an existing unverified email still blocks the authenticated account', () => {
  const oldHeaders = setup().oldHeaders;
  const oldRow = Array(oldHeaders.length).fill('');
  oldRow[oldHeaders.indexOf('email')] = 'old@gmail.com';
  const { call } = setup([oldRow]);
  assert.equal(call({ action: 'check_email', email: 'o.l.d+test@gmail.com', google_sub_hash: 'c'.repeat(64) }).error, 'Email này đã tham gia khảo sát.');
});

test('reordered Referral column preserves old responses and writes new answers to named columns', () => {
  const expected = setup().headers;
  const reordered = ['timestamp', 'Referral', ...expected.filter(header => header !== 'timestamp' && header !== 'Referral')];
  const oldRow = Array(reordered.length).fill('');
  oldRow[reordered.indexOf('email')] = 'old@gmail.com';
  oldRow[reordered.indexOf('Referral')] = 'F. Lê Thị Như Phương';
  const { context, sheet, answers, call } = setup([oldRow], reordered);
  vm.runInContext('authorizeDeployment()', context);
  assert.deepEqual(sheet.rows[0], reordered);
  assert.equal(sheet.rows[1][reordered.indexOf('email')], 'old@gmail.com');
  assert.equal(sheet.rows[1][reordered.indexOf('Referral')], 'Lê Thị Như Phương');
  const adminRows = vm.runInContext('rows_(getSheet_())', context);
  assert.equal(adminRows[0].email, 'old@gmail.com');
  assert.equal(adminRows[0].Referral, 'Lê Thị Như Phương');
  assert.equal(call({ action: 'check_email', email: 'old@gmail.com', google_sub_hash: 'a'.repeat(64) }).error, 'Email này đã tham gia khảo sát.');
  const response = call({ action: 'submit', email: 'new@gmail.com', google_sub_hash: 'b'.repeat(64), response_id: 'SRV-ABCDEF12', answers });
  assert.equal(response.ok, true);
  assert.equal(sheet.rows[2][reordered.indexOf('email')], 'new@gmail.com');
  assert.equal(sheet.rows[2][reordered.indexOf('google_sub_hash')], 'b'.repeat(64));
  assert.equal(sheet.rows[2][reordered.indexOf('Referral')], 'Lê Thị Như Phương');
});
