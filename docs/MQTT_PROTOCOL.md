# Giao thức MQTT MAYAP v1

Root mặc định: `mayap/v1`. Device ID có định dạng `MAP-` + 12 ký tự hex in hoa.

## Topic

| Hướng | Topic | QoS | Retain | Nội dung |
|---|---|---:|---:|---|
| ESP32 → web | `{root}/{deviceId}/presence` | 1 | Có | Online/LWT, firmware, reason |
| ESP32 → web | `{root}/{deviceId}/snapshot` | 0 | Không | Telemetry/runtime hiện tại |
| ESP32 → web | `{root}/{deviceId}/config/reported` | 1 | Có | Cấu hình ESP32 đã áp dụng |
| ESP32 → web | `{root}/{deviceId}/ack` | 1 | Không | Kết quả lệnh/cấu hình |
| ESP32 → web | `{root}/{deviceId}/log` | 1 | Không | Sự kiện vận hành |
| web → ESP32 | `{root}/{deviceId}/config/set` | 1 | Không | Cấu hình mong muốn |
| web → ESP32 | `{root}/{deviceId}/command` | 1 | Không | Lệnh ngắn hạn |
| web → ESP32 | `{root}/{deviceId}/session` | 0 | Không | Heartbeat của giao diện |

Không retain `command` hoặc `config/set`; tránh ESP32 nhận lại thao tác cũ sau reboot.

## Lệnh

```json
{
  "v": 1,
  "sequence": 1760000001,
  "requestId": "cmd-uuid",
  "bootId": 123456,
  "expiresAt": 1786536008,
  "action": "batch_start",
  "validForMs": 5000,
  "leaseMs": 0,
  "alarmMask": 0,
  "arg0": 0,
  "arg1": 0,
  "value": 0
}
```

ESP32 phải từ chối lệnh khi:

- `v` không hỗ trợ;
- `bootId` khác lần khởi động hiện tại;
- `expiresAt`/`validForMs` đã hết hạn;
- `sequence` không lớn hơn sequence đã xử lý hoặc `requestId` bị trùng;
- trạng thái máy không cho phép action;
- payload vượt giới hạn hoặc sai schema.

Kết quả trả về topic `ack`:

```json
{
  "bootId": 123456,
  "requestId": "cmd-uuid",
  "result": "applied",
  "message": "Batch started"
}
```

`result`: `accepted`, `applied`, `rejected`, `invalid`, `duplicate`, `busy`, `expired`, `stale`, `unsupported`.

## ACL broker tối thiểu

Web identity của user chỉ được đọc topic thuộc `devices` đã cấp trong session và chỉ được ghi `command`, `config/set`, `session` của chính các thiết bị đó. ESP32 chỉ được đọc/ghi topic của chính nó.

Ví dụ logic, không phải cấu hình copy-paste:

```text
web user U + assigned device D:
  allow subscribe mayap/v1/D/{presence,snapshot,config/reported,ack,log}
  allow publish   mayap/v1/D/{command,config/set,session}

device D:
  allow publish   mayap/v1/D/{presence,snapshot,config/reported,ack,log}
  allow subscribe mayap/v1/D/{command,config/set,session}
  deny all other topics
```

ACL phải được thực thi tại broker/plugin xác thực, không dựa vào JavaScript. Dùng TLS cho cả MQTT TCP và WebSocket; tắt anonymous access.

## Đồng bộ thời gian

ESP32 cần thời gian đáng tin cậy để kiểm tra expiry. Trước khi NTP đồng bộ, chỉ chấp nhận lệnh sau khi có secure session policy rõ ràng hoặc từ chối fail-safe. `bootId` phải thay đổi mỗi lần khởi động và đủ khó đoán/không lặp ngoài ý muốn.
