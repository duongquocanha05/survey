const SPREADSHEET_ID = '1iMVTEqfeiyodXZGDSgeaj4rqoL1EMzzqBW9CyzZ0bnQ';
const SHEET_NAME = 'Responses';
const ADMIN_TOKEN = 'admin123';
const SURVEY_VERSION = 'v1.0';
const FIELDS = [
  'S1','S2','D1','D2','D3','D4',
  'Q1_1','Q1_2','Q1_3','Q1_4','Q1_5','Q1_6','Q1_7',
  'Q2_1','Q2_2','Q2_3','Q2_4','Q2_5','Q2_6',
  'Q3_1','Q3_2','Q3_3','Q3_4',
  'Q4_1','Q4_2','Q4_3','Q4_4','Q4_5_Opt1','Q4_5_Opt2','Q4_5_Opt3','Q4_5_Opt4','Q4_6','Q4_7',
  'Q5_1','Q5_2','Q5_3','Q5_4','TL1','TL2','TT1','TT2','YD1','YD2','Feedback'
];
const HEADERS = ['timestamp', 'response_id', 'survey_version', 'status'].concat(FIELDS);
const LIKERT_FIELDS = ['TL1','TL2','TT1','TT2','YD1','YD2'];
const REQUIRED_FIELDS = FIELDS.filter(field => field !== 'Feedback');

function getSheet_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + SHEET_NAME);
  ensureHeaders_(sheet);
  return sheet;
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
}

function asArray_(value) {
  return Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value];
}

function cleanAnswers_(input) {
  const answers = {};
  FIELDS.forEach(function(field) {
    const values = asArray_(input[field]).map(String).map(function(value) { return value.trim(); }).filter(Boolean);
    if (values.length) answers[field] = values.length === 1 ? values[0] : values;
  });
  return answers;
}

function validate_(answers, status) {
  if (['completed', 'screened_out', 'incomplete'].indexOf(status) === -1) return 'Invalid status';
  if (status !== 'completed') return '';
  const missing = REQUIRED_FIELDS.filter(function(field) { return asArray_(answers[field]).length === 0; });
  if (missing.length) return 'Missing fields: ' + missing.join(', ');
  for (const field of LIKERT_FIELDS) {
    const value = Number(answers[field]);
    if (!Number.isInteger(value) || value < 1 || value > 5) return 'Invalid Likert value: ' + field;
  }
  const ranks = ['Q4_5_Opt1','Q4_5_Opt2','Q4_5_Opt3','Q4_5_Opt4'].map(function(field) { return Number(answers[field]); });
  if (ranks.some(function(value) { return !Number.isInteger(value) || value < 1 || value > 4; }) || new Set(ranks).size !== 4) return 'Invalid ranking';
  return '';
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.parameter.payload || '{}');
    const status = body.status || 'completed';
    const answers = cleanAnswers_(body.answers || {});
    const error = validate_(answers, status);
    if (error) return json_({ ok: false, error: error });
    const sheet = getSheet_();
    const responseId = String(body.response_id || Utilities.getUuid());
    const values = sheet.getDataRange().getValues();
    const responseIdColumn = HEADERS.indexOf('response_id');
    if (values.slice(1).some(function(row) { return String(row[responseIdColumn]) === responseId; })) return json_({ ok: true, response_id: responseId, duplicate: true });
    const row = [new Date(), responseId, SURVEY_VERSION, status].concat(FIELDS.map(function(field) { return Array.isArray(answers[field]) ? answers[field].join(' | ') : answers[field] || ''; }));
    sheet.appendRow(row);
    return json_({ ok: true, response_id: responseId });
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
  return values.slice(1).map(function(row) {
    return HEADERS.reduce(function(item, header, index) {
      item[header] = row[index] instanceof Date ? Utilities.formatDate(row[index], Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss') : row[index];
      return item;
    }, {});
  });
}

function doGet(e) {
  if (!authorized_(e)) return json_({ ok: false, error: 'Unauthorized' });
  try {
    const action = String(e.parameter.action || 'responses');
    const sheet = getSheet_();
    if (action === 'responses') return json_({ ok: true, columns: FIELDS, rows: rows_(sheet) });
    if (action === 'delete') {
      const responseId = String(e.parameter.response_id || '');
      const values = sheet.getDataRange().getValues();
      const responseIdColumn = HEADERS.indexOf('response_id');
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
