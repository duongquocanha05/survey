# Máy chủ Trạm — lưu tại WorkFlow

Đây là bản lưu của Express trong `duongquocanha05/survey`; giữ nguyên máy chủ khảo sát. Không chứa dữ liệu khảo sát hoặc khóa thật.

- `locker-chat.js`: Gemini Free Tier, timeout 2,7 giây, cache và giới hạn mặc định 20 lần gọi/ngày mỗi tiến trình; không gọi OpenAI.
- `locker-support.js`: copy từ source chuẩn `locker-support.js`.
- `tram-ky-gui/`: bản web public đóng gói.
- `.env.example`: tên biến cấu hình, không chứa khóa thật.

## Chạy local

Trong thư mục backend: `npm ci`, `npm start`, mở http://localhost:3000/tram-ky-gui/ . Prototype vẫn chạy khi chưa bật AI. Cấu hình khảo sát Google hiện có giữ nguyên.

## Bật AI miễn phí trên Render

1. Tại Google AI Studio, tự đọc/chấp nhận điều khoản nếu đồng ý. Chỉ chọn dự án hiển thị **Free Tier** và không liên kết tài khoản thanh toán.
2. Tạo hoặc dùng khóa Gemini cho dự án đó. Không gửi khóa vào chat, không lưu trong HTML/GitHub.
3. Trong Environment của service Render hiện có, đặt `GEMINI_API_KEY` bằng khóa đó. Sau khi đã kiểm tra gói miễn phí, đặt `GEMINI_FREE_TIER_CONFIRMED=true`. `LOCKER_AI_MAX_DAILY=20` là mức mặc định.
4. Save/redeploy. Kiểm tra `/api/locker-chat/config`: provider `gemini`, ai_enabled `true`, billing_mode `free_only`; thử một câu hỏi trong phạm vi Trạm chưa có trong FAQ.

**Giới hạn:** biến xác nhận không tự đọc được billing Google. Nếu dự án được liên kết thanh toán về sau, phải tắt AI bằng `GEMINI_FREE_TIER_CONFIRMED=false`; không nâng cấp tài khoản khi yêu cầu là miễn phí. Giới hạn gọi trong RAM reset khi máy chủ khởi động, không phải giới hạn thanh toán. Free Tier có hạn mức, có thể không khả dụng theo khu vực/tài khoản. Không bảo đảm luôn có câu trả lời AI trong 4 giây; hết hạn mức/timeout có hướng dẫn dự phòng và lựa chọn gửi CSKH.

Google có thể dùng nội dung Free Tier để cải thiện dịch vụ. UI có thông báo; API chặn khóa, PIN, email/số điện thoại nhận diện được trước khi gửi AI. Bộ lọc không phát hiện được mọi thông tin cá nhân: khách không nên nhập dữ liệu riêng tư. Không gửi thông tin tài khoản/đơn hàng nội bộ vào prompt.

`OPENAI_API_KEY` không được endpoint này sử dụng. Không xóa khóa thuộc ứng dụng khác.

## Kiểm thử

`npm test`: 12 test khảo sát. `node test/locker-chat.test.js`: 74 test FAQ/API với phản hồi Gemini mô phỏng, không gọi provider thật và không chứng minh khóa thật hoạt động.

Sửa FAQ ở `locker-support.js` rồi đồng bộ. Render lấy code từ GitHub main, không tự đọc WorkFlow. Báo cáo: `bản báo cáo trong WorkFlow`.
