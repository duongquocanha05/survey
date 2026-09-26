# Khảo sát đăng nhập Google, lưu vào Google Sheets

Người tham gia đăng nhập Google ở trang đầu. Express xác minh ID token, lấy email từ tài khoản Google và giữ phiên đăng nhập trong 2 giờ. Khi gửi khảo sát, Express ký yêu cầu rồi chuyển sang Apps Script; Apps Script kiểm tra chữ ký, chặn email hoặc tài khoản đã trả lời, và ghi vào tab `Responses_v2`. Trang quản lý vẫn đọc Sheet bằng Apps Script như trước.

## 1. Tạo Google OAuth Client ID

1. Trong [Google Cloud Console](https://console.cloud.google.com/apis/credentials), chọn hoặc tạo project; cấu hình **Google Auth Platform > Branding** và **Audience: External** cho người dùng bên ngoài. Trước khi mở khảo sát công khai, chọn **Publish app** trong Audience để chuyển sang **In production**. Chỉ cần quyền đăng nhập mặc định `openid`, `email`, `profile`; không cần quyền Gmail hoặc Google Sheets của người tham gia. Theo [Google](https://support.google.com/cloud/answer/15549945), Sign in with Google chỉ dùng tên, email, hồ sơ cơ bản có ngoại lệ đối với giới hạn test users ở trạng thái Testing, nhưng vẫn nên xuất bản ứng dụng cho khảo sát công khai.
2. Tạo **OAuth client ID > Web application**. Thêm đúng hai **Authorized JavaScript origins**: `http://localhost:3000` và `https://survey-9vu2.onrender.com`. Luồng này dùng JavaScript callback nên không cần redirect URI.
3. Sao chép **Client ID** dạng `...apps.googleusercontent.com`. Nếu Google yêu cầu xác minh quyền sở hữu miền và không chấp nhận miền Render, cần dùng miền riêng do nhóm quản lý.

## 2. Cấu hình bí mật và Apps Script

Tạo hai chuỗi ngẫu nhiên **khác nhau**, mỗi chuỗi ít nhất 32 ký tự: một cho `GAS_SHARED_SECRET`, một cho `SESSION_SECRET`. Có thể tạo từng chuỗi bằng `node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"`. Không đưa các chuỗi này vào GitHub, `config.js`, hoặc HTML.

1. Trong Apps Script gắn với Google Sheet hiện tại, thay toàn bộ mã bằng [google-apps-script/Code.gs](google-apps-script/Code.gs), rồi lưu.
2. Vào **Project Settings > Script properties**, tạo thuộc tính `SURVEY_SHARED_SECRET` với giá trị **giống hệt** `GAS_SHARED_SECRET` sẽ đặt trên Render.
3. Chạy hàm `authorizeDeployment` một lần và cấp quyền nếu Google yêu cầu. Hàm tự thêm cột `google_sub_hash` trước `email` nếu chưa có; nếu các cột đã được đổi chỗ, mã tìm theo tên tiêu đề và giữ nguyên thứ tự cột, email và phản hồi cũ.
4. Chọn **Deploy > Manage deployments > Edit > New version > Deploy** trên Web app đang dùng. URL `/exec` cũ không đổi. Web app tiếp tục **Execute as: Me** và **Who has access: Anyone**; các yêu cầu khảo sát không có chữ ký giờ bị từ chối.

## 3. Cấu hình Render

Trong service đang phục vụ `https://survey-9vu2.onrender.com/`, mở **Environment** và đặt:

| Tên biến | Giá trị |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Client ID ở bước 1 |
| `GAS_URL` | URL Apps Script `/exec` đang dùng |
| `GAS_SHARED_SECRET` | Chuỗi bí mật đã đặt trong Apps Script Script properties |
| `SESSION_SECRET` | Chuỗi bí mật thứ hai, khác chuỗi trên |
| `PUBLIC_ORIGIN` | `https://survey-9vu2.onrender.com` (không có dấu `/` cuối) |

Sau khi lưu biến môi trường, triển khai mã Node mới trên Render. `config.js` hiện chỉ còn cần cho trang quản lý cũ; khảo sát không gửi trực tiếp tới Apps Script. Không có chế độ nhập email thủ công khi thiếu cấu hình Google.

## 4. Chạy và kiểm tra ở máy cá nhân

Sao chép [.env.example](.env.example) thành `.env`, điền Client ID, URL Apps Script và hai bí mật; giữ `PUBLIC_ORIGIN=http://localhost:3000`. File `.env` đã bị Git bỏ qua. Sau đó chạy:

```sh
npm install
npm test
npm start
```

Mở `http://localhost:3000/`. Thử đăng nhập bằng một tài khoản Google chưa có trong `Responses_v2`, điền và gửi khảo sát. Đăng nhập lại cùng tài khoản phải thấy thông báo đã tham gia; tài khoản có email trùng phản hồi cũ cũng bị chặn. Kiểm tra cột `google_sub_hash` được điền ở dòng mới, cột `email` vẫn nằm cuối và chỉ chứa email Google. Trang quản lý ở `http://localhost:3000/admin.html` tiếp tục hoạt động như trước.

Google Sign-In chặn việc gõ tùy ý email của người khác, nhưng một người có nhiều tài khoản Google vẫn có thể tham gia bằng từng tài khoản. Với Google Account dùng email ngoài Gmail/Google Workspace, trạng thái `email_verified` không chứng minh chắc chắn người dùng **hiện** còn sở hữu hộp thư đó.
