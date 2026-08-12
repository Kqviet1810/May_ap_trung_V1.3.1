# Security Policy

## Báo cáo lỗ hổng

Không tạo issue công khai cho lỗ hổng, token, mật khẩu, pairing code hoặc thông tin khách hàng. Hãy báo cáo riêng cho chủ dự án qua kênh hỗ trợ bảo mật được công bố trên website chính thức. Khi chưa có kênh đó, repository **chưa đạt điều kiện phát hành thương mại**.

Nội dung nên gồm phiên bản, tác động, cách tái hiện tối thiểu và biện pháp tạm thời. Không truy cập dữ liệu người khác, không gây gián đoạn thiết bị thật và không công bố trước khi có kế hoạch khắc phục.

## Nguyên tắc secret

- `public/config.json` và toàn bộ frontend là công khai.
- Không commit MQTT password, private key, API secret, JWT dài hạn hoặc credential ESP32.
- Credential dùng trong CI phải nằm trong GitHub Actions secrets/environment protection.
- Nếu secret từng được commit, xóa file là chưa đủ: phải revoke/rotate ngay và xử lý lịch sử theo quy trình sự cố.

## Phiên bản hỗ trợ

Trong giai đoạn trước pilot, chỉ nhánh/phát hành mới nhất được nhận bản vá bảo mật. Chính sách LTS cần được công bố trước khi bán rộng rãi.
