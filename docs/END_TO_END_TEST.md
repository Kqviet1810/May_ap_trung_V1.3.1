# Kiểm thử đầu-cuối MAYAP v1.3.1

Tài liệu này dùng firmware công nghiệp tích hợp, website thật và bộ broker/API kiểm thử trong repository. Không dùng telemetry giả trong frontend.

## 1. Kiểm tra build

```bash
npm ci
npm run check
cp firmware/mayap-industrial-v3.2.9/include/network_secrets.example.h firmware/mayap-industrial-v3.2.9/include/network_secrets.h
pio run --project-dir firmware/mayap-industrial-v3.2.9
```

Kết quả đạt khi frontend test/build thành công, firmware link thành công và checksum `machine_control.h` đúng giá trị ghi trong README firmware.

## 2. Dựng broker/API test LAN

```bash
cd examples/connectivity-test
cp .env.example .env
docker compose up -d
docker compose ps
```

Đổi password trong `.env`. Sửa firmware `include/network_secrets.h`:

- `NETWORK_MQTT_HOST`: IP LAN của máy chạy Docker, không dùng `localhost`;
- `NETWORK_MQTT_PORT`: `1883` chỉ cho LAN test;
- ID/user/password khớp ACL mẫu.

Để chạy website local, từ root repository:

```bash
cp examples/connectivity-test/frontend-config.local.json public/config.json
npm run dev
```

Đăng nhập tại `http://localhost:8787/dev-login`, rồi mở `http://localhost:5173`.

## 3. Nạp bo và provisioning

1. Nạp firmware, xóa riêng NVS trước test first-boot nếu cần.
2. Xác nhận tất cả output ở trạng thái an toàn khi khởi động.
3. Kết nối điện thoại với `MAYAP-xxxx`, mở `192.168.4.1`, nhập Wi-Fi LAN.
4. Serial phải lần lượt báo Wi-Fi OK và MQTT OK.
5. Dashboard phải hiện đúng firmware, SSID, IP, nhiệt độ, độ ẩm và trạng thái máy.

## 4. Ma trận test bắt buộc

| Mã | Thử nghiệm | Kết quả phải đạt |
|---|---|---|
| T01 | Reload website, chuyển 4 trang, cuộn từng trang trên mobile | Trang hiện tại giữ vùng cuộn riêng; không có thanh điều hướng 4 mục trùng lặp |
| T02 | Gửi cấu hình hợp lệ | Nhận `accepted`, sau đó `applied`; `config/reported` khớp dữ liệu EEPROM đọc lại |
| T03 | Gửi ngưỡng sai thứ tự | UI chặn; nếu phát trực tiếp MQTT thì firmware sanitize/từ chối theo logic lõi, không tạo output nguy hiểm |
| T04 | Bắt đầu mẻ khi công tắc AUTO/cảm biến/RTC chưa sẵn sàng | Nhận `rejected` cùng lý do từ `MachineController` |
| T05 | Bắt đầu rồi dừng mẻ hợp lệ | Snapshot và HMI vật lý đồng bộ; dừng đi theo trình tự an toàn |
| T06 | Phát lại cùng `sequence` hoặc `bootId` cũ | Nhận `duplicate` hoặc `stale`; lệnh không chạy lần hai |
| T07 | Gửi lệnh đã hết hạn / trước khi NTP đồng bộ | Nhận `expired` hoặc `stale`; không chạy lệnh |
| T08 | Tắt broker/Wi-Fi trong khi máy chạy | Điều khiển lõi tiếp tục độc lập; web báo offline; output không đổi do mất mạng |
| T09 | Đổi sang Wi-Fi sai | Sau 30 giây ESP32 quay về mạng cũ và báo `rejected` khi MQTT phục hồi |
| T10 | Mất điện giữa mẻ | Sau POWERON/BROWNOUT luôn hiện chờ xác nhận; không tự chạy nếu chưa xác nhận |
| T11 | Reset watchdog/software với batch record hợp lệ | Hành vi phục hồi đúng logic v3.2.9 đã kiểm thử; journal/reset-storm vẫn hoạt động |
| T12 | Mất cảm biến/quá nhiệt/kẹt đảo | Fault, còi và output fail-safe đúng bộ test phần cứng hiện có; website chỉ phản ánh trạng thái |
| T13 | Ghi cấu hình khi ngắt/tháo AT24C32 | Không trả `applied`; cấu hình HMI rollback; fault bộ nhớ được latch |
| T14 | Soak test 24–72 giờ, broker chập chờn | Không reset control task; không tăng relay transition bất thường; stack watermark còn biên |

## 5. Quan sát MQTT

```bash
docker compose -f examples/connectivity-test/compose.yaml exec broker sh -lc \
  'mosquitto_sub -h 127.0.0.1 -p 1883 -u mayap-web-test -P "$WEB_MQTT_PASSWORD" -t "mayap/v1/MAP-A1B2C3D4E5F6/#" -v'
```

Không chụp/log payload `wifi/set`, session credential hoặc password. Lưu bằng chứng pass/fail, firmware hash, board serial, thời điểm và người test cho từng máy.

## 6. Trả môi trường về an toàn

Sau test local, trả `public/config.json` về cấu hình `unconfigured` hoặc domain HTTPS/WSS production; không commit password `.env`, `secrets.h`, certificate private key hay database test.

