# Khảo sát với Google Sheets

Survey persistence hiện chạy theo luồng:

```text
Survey -> Google Apps Script -> Google Sheets
                         ^
                         |
                       /admin
```

Node/Express chỉ phục vụ `main.html`, `admin.html`, `config.js` và không còn lưu survey vào database.

## 1. Tạo Google Sheet

Tạo một spreadsheet, tạo sheet tên `Responses`. Apps Script sẽ tự tạo hàng header khi nhận response đầu tiên. Các cột là:

`timestamp`, `response_id`, `survey_version`, `status`, sau đó là toàn bộ field `S1`, `S2`, `D1`... `YD2`, `Feedback` trong form hiện tại.

## 2. Deploy Apps Script

1. Mở Extensions > Apps Script trong Google Sheet.
2. Dán toàn bộ nội dung [google-apps-script/Code.gs](google-apps-script/Code.gs).
3. Thay `PASTE_GOOGLE_SHEET_ID_HERE` bằng Spreadsheet ID trên URL Google Sheet.
4. Đặt `SHEET_NAME = 'Responses'`.
5. Đổi `ADMIN_TOKEN` thành một chuỗi admin riêng.
6. Chọn Deploy > New deployment > Web app.
7. Execute as: Me.
8. Who has access: Anyone.
9. Copy Web app URL có dạng `/exec`.

## 3. Cấu hình frontend

Mở [config.js](config.js) và thay:

```js
window.SURVEY_CONFIG = {
  GOOGLE_APPS_SCRIPT_URL: "URL_WEB_APP_DANG_EXEC",
  ADMIN_TOKEN: "cung-gia-tri-voi-ADMIN_TOKEN-trong-Code.gs"
};
```

URL Apps Script chỉ nằm tại một nơi. Request submit dùng `application/x-www-form-urlencoded` để tránh CORS preflight. Apps Script tạo timestamp bằng server và append một row mới; `response_id` được kiểm tra để retry không tạo duplicate.

## 4. Chạy frontend

```sh
npm install
npm start
```

Mở `http://localhost:3000/` để khảo sát và `http://localhost:3000/admin.html` để xem dữ liệu từ Google Sheet. Không cần chạy backend riêng để lưu response; cần giữ static server nếu mở bằng URL local.

Admin giữ tìm kiếm, lọc status, làm mới, xóa response trên Sheet và export `.xlsx` tại trình duyệt.

## Lưu ý

Không commit Spreadsheet ID nếu muốn giữ kín sheet. Web App URL không phải credential; admin token vẫn nên đổi khỏi giá trị mặc định trước khi deploy. Dữ liệu SQLite cũ không được migrate và không còn được hiển thị trong admin mới.
