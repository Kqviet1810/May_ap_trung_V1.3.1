# Hợp đồng Backend v1

API dùng JSON, HTTPS, cookie phiên `HttpOnly; Secure; SameSite=Lax/Strict` và kiểm tra `Origin`/Fetch Metadata cho các request thay đổi trạng thái. Nếu frontend và API khác origin, CORS phải chỉ định đúng origin production và `Access-Control-Allow-Credentials: true`; không dùng wildcard.

## `POST /v1/mqtt/session`

Request:

```json
{
  "capability": "device-control",
  "protocolVersion": 1
}
```

Response `200`:

```json
{
  "user": {
    "id": "usr_01...",
    "name": "Nguyễn Văn A",
    "role": "owner"
  },
  "devices": [
    {
      "id": "MAP-A1B2C3D4E5F6",
      "name": "Máy ấp khu A",
      "location": "Trại 1",
      "model": "MAYAP-120"
    }
  ],
  "mqtt": {
    "url": "wss://mqtt.example.com/mqtt",
    "clientId": "web-usr_01-random",
    "username": "short-lived-identity",
    "password": "short-lived-token",
    "expiresAt": "2026-08-12T12:15:00Z"
  }
}
```

Yêu cầu:

- Trả `401` nếu chưa đăng nhập; `403` nếu tài khoản bị khóa hoặc không có capability.
- Credential MQTT hết hạn sau 5–15 phút, không tái sử dụng, không ghi log plaintext.
- `devices` chỉ chứa thiết bị thuộc tenant/tài khoản hiện tại.
- `url` bắt buộc là WSS với chứng chỉ hợp lệ.
- Rate limit theo user, IP và session; ghi audit khi cấp phiên.

## `POST /v1/devices/pair`

Request:

```json
{
  "pairingCode": "AP-7K4M-92QX",
  "displayName": "Máy ấp khu A"
}
```

Yêu cầu:

- Pairing code ngẫu nhiên, dùng một lần, hết hạn nhanh; Device ID không được xem là secret.
- Rate limit chặt, khóa tạm thời sau nhiều lần sai, không tiết lộ code có tồn tại hay không.
- Transaction phải kiểm tra ownership và chống hai tài khoản claim cùng thiết bị.
- Trả `409` nếu thiết bị đã thuộc tài khoản khác; mọi lần thử phải được audit.

## `PUT /v1/devices/{deviceId}/batch-plan`

Body theo kiểu `BatchPlan` trong `src/types.ts`. Backend phải:

- kiểm tra quyền `owner/operator` và ownership của `deviceId`;
- validate chuỗi, ngày, dải nhiệt/độ ẩm và số ngày độc lập với frontend;
- dùng optimistic concurrency hoặc idempotency key nếu nhiều người cùng vận hành;
- lưu người sửa, thời điểm, giá trị trước/sau vào audit log.

## Web Push và cảnh báo

Cảnh báo khi tab đóng không thể chỉ dựa vào MQTT trong trình duyệt. Backend cần ingest event thiết bị, đánh giá rule, chống trùng và gửi Web Push/SMS/email theo cấu hình người dùng. Giao diện hiện tại chỉ hiển thị event nhận được khi phiên đang hoạt động và nói rõ giới hạn này.

## Header khuyến nghị

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://api.example.com wss://mqtt.example.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://account.example.com
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Điều chỉnh domain theo hạ tầng thật. CSP nên được gửi bằng HTTP header, không chỉ bằng thẻ `meta`.
