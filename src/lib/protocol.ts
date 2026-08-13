import type {
  CommandAction,
  ConfigReport,
  DeviceLog,
  MachineConfig,
  PresenceMessage,
  SnapshotMessage,
  WifiCredentials
} from '../types';

export const DEVICE_ID_RE = /^MAP-[A-F0-9]{12}$/;
export const CONFIG_KEYS: ReadonlyArray<keyof MachineConfig> = [
  'targetTemp', 'tempHysteresis', 'lowTempAlarm', 'highTempAlarm', 'emergencyTemp',
  'kp', 'ki', 'kd', 'lowHumidityAlarm', 'ventOnTemp', 'ventOffTemp', 'tempOffset',
  'humidityOffset', 'pidCycleSec', 'humidityAlarmDelaySec', 'turnIntervalMin',
  'turnMaxRunSec', 'powerRestoreDelaySec', 'sensorTimeoutSec', 'maxHeaterPower',
  'totalIncubationDays', 'circulationFanEnabled', 'turningEnabled',
  'allowHeatWithoutBatch', 'alarmEnabled', 'controlMode',
  'nextDirection'
];

export function topicSet(root: string, deviceId: string) {
  if (!DEVICE_ID_RE.test(deviceId)) throw new Error('Device ID không hợp lệ');
  const base = `${root.replace(/^\/+|\/+$/g, '')}/${deviceId}`;
  return {
    presence: `${base}/presence`,
    snapshot: `${base}/snapshot`,
    configReported: `${base}/config/reported`,
    ack: `${base}/ack`,
    log: `${base}/log`,
    configSet: `${base}/config/set`,
    wifiSet: `${base}/wifi/set`,
    command: `${base}/command`,
    session: `${base}/session`
  };
}

export function parseInboundTopic(root: string, topic: string) {
  const escaped = root.replace(/^\/+|\/+$/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = topic.match(new RegExp(`^${escaped}/(MAP-[A-F0-9]{12})/(presence|snapshot|config/reported|ack|log)$`));
  return match ? { deviceId: match[1]!, channel: match[2]! } : null;
}

export function createRequestId(prefix: 'cmd' | 'cfg' | 'wifi'): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`.slice(0, 63);
}

export function createWifiPayload(
  credentials: WifiCredentials,
  bootId: number,
  sequence: number,
  now = Date.now()
) {
  const ssid = credentials.ssid.trim();
  if (!ssid || ssid.length > 32) throw new Error('Tên Wi-Fi phải có từ 1 đến 32 ký tự');
  if (credentials.password.length < 8 || credentials.password.length > 63) {
    throw new Error('Mật khẩu Wi-Fi phải có từ 8 đến 63 ký tự');
  }
  if (!Number.isInteger(bootId) || bootId <= 0) throw new Error('Chưa nhận bootId hợp lệ từ thiết bị');
  if (!Number.isInteger(sequence) || sequence <= 0) throw new Error('Sequence không hợp lệ');
  return {
    v: 1,
    sequence,
    requestId: createRequestId('wifi'),
    bootId,
    expiresAt: Math.floor(now / 1000) + 30,
    ssid,
    password: credentials.password
  };
}

export function createCommandPayload(
  action: CommandAction,
  bootId: number,
  sequence: number,
  now = Date.now()
) {
  if (!Number.isInteger(bootId) || bootId <= 0) throw new Error('Chưa nhận bootId hợp lệ từ thiết bị');
  if (!Number.isInteger(sequence) || sequence <= 0) throw new Error('Sequence không hợp lệ');
  return {
    v: 1,
    sequence,
    requestId: createRequestId('cmd'),
    bootId,
    expiresAt: Math.floor(now / 1000) + 8,
    action,
    validForMs: 5000,
    leaseMs: 0,
    alarmMask: 0,
    arg0: 0,
    arg1: 0,
    value: 0
  };
}

export function isCompleteConfig(value: unknown): value is MachineConfig {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return CONFIG_KEYS.every((key) => Object.prototype.hasOwnProperty.call(record, key)) &&
    Number.isFinite(Number(record.targetTemp));
}

export function isPresence(value: unknown): value is PresenceMessage {
  return Boolean(value && typeof value === 'object' && typeof (value as PresenceMessage).online === 'boolean');
}

export function isSnapshot(value: unknown): value is SnapshotMessage {
  const snapshot = value as SnapshotMessage;
  return Boolean(snapshot?.runtime && Number.isFinite(Number(snapshot.bootId)) &&
    Number.isFinite(Number(snapshot.runtime.temperature)) && Number.isFinite(Number(snapshot.runtime.humidity)));
}

export function isConfigReport(value: unknown): value is ConfigReport {
  const report = value as ConfigReport;
  return Boolean(report && Number.isFinite(Number(report.revision)) && isCompleteConfig(report.config));
}

export function eventToLog(value: unknown): DeviceLog {
  const event = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const code = Number(event.code || 0);
  const known: Record<number, [DeviceLog['severity'], string, string]> = {
    1: ['info', 'Thiết bị vừa khởi động', 'Máy đã được cấp nguồn và bắt đầu đồng bộ.'],
    20: ['info', 'Mẻ ấp đã bắt đầu', 'ESP32 xác nhận chuyển sang chế độ vận hành mẻ.'],
    21: ['info', 'Mẻ ấp đã kết thúc', 'Thiết bị đã thực hiện trình tự dừng mẻ.'],
    23: ['warning', 'Chờ xác nhận sau mất điện', 'Cần quyết định tiếp tục hoặc hủy mẻ đang lưu.'],
    40: ['info', 'Cảm biến hoạt động trở lại', 'Dữ liệu cảm biến đã được khôi phục.'],
    41: ['critical', 'Mất tín hiệu cảm biến', 'Kiểm tra đầu đo và dây kết nối ngay.'],
    50: ['info', 'Cấu hình đã được lưu', 'Thiết bị xác nhận cấu hình mới.'],
    53: ['warning', 'Auto Tune không hoàn tất', 'Kiểm tra điều kiện khoang ấp trước khi chạy lại.'],
    80: ['warning', 'Lệnh điều khiển bị từ chối', 'Thiết bị không chấp nhận yêu cầu vừa gửi.']
  };
  const fallback: [DeviceLog['severity'], string, string] = code >= 1000
    ? ['critical', `Cảnh báo hệ thống #${code - 1000}`, 'Thiết bị báo điều kiện bất thường cần kiểm tra.']
    : ['info', `Sự kiện thiết bị #${code}`, 'Sự kiện được gửi từ ESP32.'];
  const [severity, title, detail] = known[code] ?? fallback;
  const epoch = Number(event.epoch || 0);
  return {
    id: `${Number(event.sequence || 0)}-${epoch || Date.now()}-${code}`,
    at: epoch > 1_700_000_000 ? epoch * 1000 : Date.now(),
    severity,
    title,
    detail,
    code
  };
}
