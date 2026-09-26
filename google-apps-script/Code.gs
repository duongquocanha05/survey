const SPREADSHEET_ID = '1iMVTEqfeiyodXZGDSgeaj4rqoL1EMzzqBW9CyzZ0bnQ';
const SHEET_NAME = 'Responses_v2';
const ADMIN_TOKEN = 'admin123';
const SURVEY_VERSION = 'v2.4';
const FIELDS = [
  'S1','D1','D2',
  'Q1_1','Q1_2','Q1_3','Q1_4','Q1_5','Q1_6',
  'Q2_1','Q2_2','Q2_3',
  'Q3_1','Q3_2','Q3_3','Q3_4',
  'Q4_1','Q4_2','Q4_3_Opt1','Q4_3_Opt2','Q4_3_Opt3','Q4_3_Opt4','Q4_4','Q4_5',
  'Q5_1','Q5_2','TL1','TL2','TT1','TT2','YD1','YD2','Feedback','Referral'
];
const HEADERS = ['timestamp', 'response_id', 'survey_version', 'status'].concat(FIELDS, ['google_sub_hash', 'email']);
const LIKERT_FIELDS = ['TL1','TL2','TT1','TT2','YD1','YD2'];
const REQUIRED_FIELDS = FIELDS.filter(field => field !== 'Feedback');
const REFERRAL_OPTIONS = ['Dương Quốc Anh','Nguyễn Hoàng Ân','Dương Yến Ngọc','Hoàng Thanh Long','Nguyễn Hà Phương','Lê Thị Như Phương'];

function getSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  ensureHeaders_(sheet);
  return sheet;
}

function authorizeDeployment() {
  const sheet = getSheet_();
  if (sheet.getLastRow() < 2) return;
  const referralRange = sheet.getRange(2, getHeaderMap_(sheet).Referral + 1, sheet.getLastRow() - 1, 1);
  const currentValues = referralRange.getValues();
  const normalizedValues = currentValues.map(function(row) { return [normalizeReferral_(row[0])]; });
  if (currentValues.some(function(row, index) { return row[0] !== normalizedValues[index][0]; })) referralRange.setValues(normalizedValues);
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    if (sheet.getMaxColumns() < HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
    sheet.appendRow(HEADERS);
    return;
  }
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) { return String(value).trim(); });
  if (!headers.includes('email')) throw new Error('Missing email column');
  for (const field of ['Referral', 'google_sub_hash']) {
    if (!headers.includes(field)) {
      const column = headers.indexOf('email') + 1;
      sheet.insertColumnBefore(column);
      sheet.getRange(1, column).setValue(field);
      headers.splice(column - 1, 0, field);
    }
  }
  const missing = HEADERS.filter(function(header) { return !headers.includes(header); });
  if (missing.length) throw new Error('Missing sheet headers: ' + missing.join(', '));
  const duplicated = HEADERS.filter(function(header) { return headers.filter(function(value) { return value === header; }).length > 1; });
  if (duplicated.length) throw new Error('Duplicate sheet headers: ' + duplicated.join(', '));
}

function getHeaderMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) { return String(value).trim(); });
  return HEADERS.reduce(function(map, header) {
    map[header] = headers.indexOf(header);
    return map;
  }, {});
}

function normalizeEmail_(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return '';
  const parts = email.split('@');
  if (parts[1] === 'gmail.com' || parts[1] === 'googlemail.com') return parts[0].split('+')[0].replace(/\./g, '') + '@gmail.com';
  return email;
}

function identityExists_(sheet, email, googleSubHash) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const columns = getHeaderMap_(sheet);
  return sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues()
    .some(function(row) { return normalizeEmail_(row[columns.email]) === email || row[columns.google_sub_hash] === googleSubHash; });
}

function asArray_(value) {
  return Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];
}

function normalizeReferral_(value) {
  const selection = String(value || '').trim();
  for (let index = 0; index < REFERRAL_OPTIONS.length; index++) {
    const name = REFERRAL_OPTIONS[index];
    if (selection === String.fromCharCode(65 + index) + '. ' + name) return name;
  }
  return selection;
}

function cleanAnswers_(input) {
  const answers = {};
  FIELDS.forEach(function(field) {
    const values = asArray_(input[field]).map(String).map(function(value) { return value.trim(); }).filter(Boolean);
    if (values.length === 1) answers[field] = field === 'Referral' ? normalizeReferral_(values[0]) : values[0];
    else if (values.length > 1) answers[field] = values;
  });
  return answers;
}

function validate_(answers, status) {
  if (status !== 'completed') return 'Invalid status';
  if (answers.S1 !== 'Có') return 'Invalid screening answer';
  const missing = REQUIRED_FIELDS.filter(function(field) { return asArray_(answers[field]).length === 0; });
  if (missing.length) return 'Missing fields: ' + missing.join(', ');
  for (const field of LIKERT_FIELDS) {
    const value = Number(answers[field]);
    if (!Number.isInteger(value) || value < 1 || value > 5) return 'Invalid Likert value: ' + field;
  }
  const ranks = ['Q4_3_Opt1','Q4_3_Opt2','Q4_3_Opt3','Q4_3_Opt4'].map(function(field) { return Number(answers[field]); });
  if (ranks.some(function(value) { return !Number.isInteger(value) || value < 1 || value > 4; }) || new Set(ranks).size !== 4) return 'Invalid ranking';
  for (const field of ['Q4_4','Q4_5']) {
    const choices = asArray_(answers[field]);
    if (choices.length > 3) return 'Chỉ được chọn tối đa 3 đáp án ở câu ' + field.replace('_', '.') + '.';
  }
  if (asArray_(answers.Q4_5).includes('Không muốn tương tác') && asArray_(answers.Q4_5).length !== 1) return 'Câu 4.5 chỉ được chọn một trong các đáp án loại trừ.';
  if (!REFERRAL_OPTIONS.includes(answers.Referral)) return 'Vui lòng chọn người gửi khảo sát.';
  return '';
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function hasValidSignature_(parameters) {
  const secret = PropertiesService.getScriptProperties().getProperty('SURVEY_SHARED_SECRET');
  const payload = String(parameters.payload || '');
  const signature = String(parameters.signature || '').toLowerCase();
  if (!secret || !payload || payload.length > 100000 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const bytes = Utilities.computeHmacSha256Signature(payload, secret, Utilities.Charset.UTF_8);
  const expected = bytes.map(function(byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return difference === 0;
}

function doPost(e) {
  try {
    const parameters = (e && e.parameter) || {};
    if (!hasValidSignature_(parameters)) return json_({ ok: false, error: 'Unauthorized' });
    const body = JSON.parse(parameters.payload);
    if (!Number.isFinite(body.issued_at) || Math.abs(Date.now() - body.issued_at) > 5 * 60 * 1000) return json_({ ok: false, error: 'Request expired' });
    const action = body.action || 'submit';
    const email = normalizeEmail_(body.email);
    if (!email) return json_({ ok: false, error: 'Email không hợp lệ.' });
    const googleSubHash = String(body.google_sub_hash || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(googleSubHash)) return json_({ ok: false, error: 'Google account không hợp lệ.' });
    if (action === 'check_email') {
      const sheet = getSheet_();
      if (identityExists_(sheet, email, googleSubHash)) return json_({ ok: false, error: 'Email này đã tham gia khảo sát.' });
      return json_({ ok: true });
    }
    if (action !== 'submit') return json_({ ok: false, error: 'Unknown action' });
    const status = body.status || 'completed';
    const answers = cleanAnswers_(body.answers || {});
    const error = validate_(answers, status);
    if (error) return json_({ ok: false, error: error });
    const responseId = String(body.response_id || '');
    if (!responseId) return json_({ ok: false, error: 'Missing response ID' });
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet = getSheet_();
      const values = sheet.getDataRange().getValues();
      const columns = getHeaderMap_(sheet);
      if (values.slice(1).some(function(row) { return String(row[columns.response_id]) === responseId && normalizeEmail_(row[columns.email]) === email && row[columns.google_sub_hash] === googleSubHash; })) return json_({ ok: true, response_id: responseId, duplicate: true });
      if (identityExists_(sheet, email, googleSubHash)) return json_({ ok: false, error: 'Email này đã tham gia khảo sát.' });
      const item = { timestamp: new Date(), response_id: responseId, survey_version: SURVEY_VERSION, status: status, google_sub_hash: googleSubHash, email: email };
      FIELDS.forEach(function(field) { item[field] = Array.isArray(answers[field]) ? answers[field].join(' | ') : answers[field] || ''; });
      const row = Array(sheet.getLastColumn()).fill('');
      HEADERS.forEach(function(header) { row[columns[header]] = item[header]; });
      sheet.appendRow(row);
      return json_({ ok: true, response_id: responseId });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return json_({ ok: false, error: 'Unable to save response' });
  }
}

function authorized_(e) {
  return String((e.parameter && e.parameter.token) || '') === ADMIN_TOKEN;
}

function rows_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const columns = getHeaderMap_(sheet);
  return values.slice(1).map(function(row) {
    return HEADERS.reduce(function(item, header) {
      const value = row[columns[header]];
      item[header] = value instanceof Date ? Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss') : value;
      return item;
    }, {});
  });
}

function doGet(e) {
  if (!authorized_(e)) return json_({ ok: false, error: 'Unauthorized' });
  try {
    const action = String(e.parameter.action || 'responses');
    const sheet = getSheet_();
    if (action === 'responses') return json_({ ok: true, columns: FIELDS.concat(['google_sub_hash', 'email']), rows: rows_(sheet) });
    if (action === 'delete') {
      const responseId = String(e.parameter.response_id || '');
      const values = sheet.getDataRange().getValues();
      const responseIdColumn = getHeaderMap_(sheet).response_id;
      for (let index = values.length - 1; index >= 1; index--) {
        if (String(values[index][responseIdColumn]) === responseId) {
          sheet.deleteRow(index + 1);
          return json_({ ok: true, deleted: responseId });
        }
      }
      return json_({ ok: false, error: 'Response not found' });
    }
    return json_({ ok: false, error: 'Unknown action' });
  } catch (error) {
    return json_({ ok: false, error: 'Unable to read sheet' });
  }
}
