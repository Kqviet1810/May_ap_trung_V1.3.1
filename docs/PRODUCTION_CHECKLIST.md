# Checklist phát hành thương mại

Frontend chỉ là một phần của sản phẩm. Không mở bán/cho điều khiển thiết bị thật cho tới khi các mục bắt buộc dưới đây có bằng chứng kiểm thử.

## P0 — chặn phát hành

- [ ] Domain production, HTTPS, HSTS và CSP đã cấu hình.
- [ ] Backend có đăng nhập, quản lý phiên, tenant isolation và RBAC phía server.
- [ ] Broker tắt anonymous, TLS/WSS hợp lệ, ACL theo từng user/device.
- [ ] Credential MQTT ngắn hạn, thu hồi được, không xuất hiện trong source/log/analytics.
- [ ] Pairing code một lần, hết hạn, rate limit, audit và chống claim trùng.
- [ ] ESP32 kiểm tra schema, bootId, sequence, requestId, expiry và trạng thái trước mọi lệnh.
- [ ] ESP32 fail-safe khi mất cảm biến, mất mạng, kẹt relay/quạt/cơ cấu đảo và nhiệt vượt ngưỡng.
- [ ] Có E-stop/ngắt nhiệt độc lập phần mềm nếu phân tích rủi ro phần cứng yêu cầu.
- [ ] Audit log bất biến cho đăng nhập, pairing, thay đổi cấu hình, bắt đầu/kết thúc mẻ và quyền.
- [ ] Backup/restore được diễn tập; có quy trình rotate/revoke credential và xử lý sự cố.
- [ ] Test end-to-end trên thiết bị thật, mất điện, reconnect, clock lệch, packet trùng/chậm/sai thứ tự.
- [ ] Điều khoản sử dụng, chính sách riêng tư, bảo hành, hỗ trợ và cảnh báo an toàn được duyệt.

## P1 — cần trước pilot trả phí

- [ ] Web Push/backend alert với retry, chống trùng và escalation.
- [ ] Lưu lịch sử telemetry ở backend, retention rõ ràng, export được.
- [ ] Monitoring uptime/API/broker, alert nội bộ và dashboard vận hành.
- [ ] Sentry hoặc hệ thống lỗi tương đương đã lọc PII/secret.
- [ ] Test đa trình duyệt và thiết bị di động; keyboard/screen-reader cơ bản.
- [ ] Load test theo số thiết bị/khách hàng dự kiến.
- [ ] Firmware signed update/rollback và inventory phiên bản.
- [ ] Quy trình hỗ trợ khi thiết bị offline hoặc cấu hình thất bại.

## Website và firmware trong repository này

- [x] Không có mock telemetry hoặc public broker.
- [x] Không lưu MQTT credential trong config/source.
- [x] Chỉ nhận danh sách thiết bị do backend cấp.
- [x] WSS và credential ngắn hạn bắt buộc.
- [x] Lệnh có anti-replay fields và bước xác nhận.
- [x] Khóa điều khiển khi offline/chưa xác thực/viewer.
- [x] Validate cấu hình phía client và yêu cầu backend validate lại.
- [x] PWA/offline shell, trạng thái trống và thông báo giới hạn rõ ràng.
- [x] TypeScript build, unit test giao thức và CI.
- [x] Đã ghép firmware/HMI công nghiệp v3.2.9; checksum lõi `machine_control.h` được khóa trong CI.
- [x] Network task tách khỏi control/supervisor, không có quyền ghi output.
- [x] Provisioning Wi-Fi tại chỗ và đổi Wi-Fi từ web đều lưu sau khi kết nối thành công, có rollback.
- [x] MQTT callback chỉ đưa dữ liệu vào queue; lệnh đi qua HMI queue/MachineController.
- [x] Cấu hình chỉ ACK `applied` sau EEPROM A/B readback.
- [x] Snapshot, presence/LWT, config reported và ACK đã khớp giao thức website.
- [x] Có PlatformIO build, CI firmware và ma trận kiểm thử đầu-cuối.
