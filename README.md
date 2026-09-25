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

Sử dụng Google Sheet của dự án. Bản khảo sát mới ghi vào tab `Responses_v2`; hàm `authorizeDeployment` sẽ tự tạo tab này và hàng tiêu đề. Tab `Responses` cũ được giữ nguyên để dữ liệu trước khi sửa câu hỏi không bị lẫn với dữ liệu mới. Các cột của tab mới là:

`timestamp`, `response_id`, `survey_version`, `status`, các mã câu hỏi mới từ `S1`, `D1`... `YD2`, `Feedback`, `Referral`, và cuối cùng là `email`. Khi chạy mã mới, cột `Referral` sẽ được chèn trước `email` trên tab `Responses_v2` đang có, giữ nguyên dữ liệu email cũ.

## 2. Deploy Apps Script

1. Mở **Extensions > Apps Script** trong Google Sheet.
2. Thay toàn bộ nội dung `Code.gs` trên Apps Script bằng [google-apps-script/Code.gs](google-apps-script/Code.gs) của dự án và lưu lại.
3. Kiểm tra `SPREADSHEET_ID` đúng với Google Sheet và giữ `SHEET_NAME = 'Responses_v2'`.
4. Trong danh sách hàm ở thanh công cụ, chọn `authorizeDeployment`, bấm **Run**, rồi cấp quyền truy cập Sheet cho tài khoản triển khai. Hàm này tạo tab `Responses_v2` nếu chưa có, thêm cột `Referral` trước `email` nếu cần, và bỏ tiền tố `A.`–`F.` khỏi tên người giới thiệu đã lưu.
5. Nếu đã có Web app: chọn **Deploy > Manage deployments > Edit**, ở **Version** chọn **New version**, rồi bấm **Deploy**. URL `/exec` cũ tiếp tục dùng được.
6. Nếu chưa có Web app: chọn **Deploy > New deployment > Web app**, đặt **Execute as: Me**, **Who has access: Anyone**, rồi bấm **Deploy** và sao chép URL `/exec`.

## 3. Cấu hình frontend

Mở [config.js](config.js) và thay:

```js
window.SURVEY_CONFIG = {
  GOOGLE_APPS_SCRIPT_URL: "URL_WEB_APP_DANG_EXEC"
};
```

URL Apps Script chỉ nằm tại một nơi. Nếu cập nhật deployment cũ, giữ nguyên URL hiện tại trong `config.js`; nếu tạo deployment mới, thay bằng URL `/exec` mới. Request dùng `application/x-www-form-urlencoded` để tránh CORS preflight. Người tham gia nhập email trước khi bắt đầu; Apps Script kiểm tra email trùng lúc bắt đầu và ngay trước khi ghi phản hồi. Bấm gửi ở cuối khảo sát sẽ lưu trực tiếp vào Sheet, không gửi email hay yêu cầu mã xác nhận.

## 4. Chạy frontend

```sh
npm install
npm start
```

Mở `http://localhost:3000/` để khảo sát và `http://localhost:3000/admin.html` để xem dữ liệu từ Google Sheet. Không cần chạy backend riêng để lưu response; cần giữ static server nếu mở bằng URL local.

Sau khi cập nhật Web app, thử với một email chưa có trong `Responses_v2`: nhập email, hoàn thành bảng hỏi và bấm gửi. Tải lại trang rồi nhập cùng email để kiểm tra thông báo đã tham gia. Lượt gửi được lưu vào Sheet thật. Trang quản lý đọc tab `Responses_v2`; dữ liệu cũ vẫn nằm trong tab `Responses`.

Admin giữ tìm kiếm, lọc status, làm mới, xóa response trên Sheet và export `.xlsx` tại trình duyệt.

## Lưu ý

Không commit Spreadsheet ID nếu muốn giữ kín sheet. Web App URL không phải credential. Dữ liệu SQLite cũ không được migrate và không còn được hiển thị trong admin mới.
