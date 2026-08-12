import type { BatchPlan, MqttSession, RuntimeConfig } from '../types';
import { apiUrl } from './config';
import { DEVICE_ID_RE } from './protocol';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function requestMqttSession(config: RuntimeConfig, signal?: AbortSignal): Promise<MqttSession> {
  const response = await fetch(apiUrl(config, config.sessionEndpoint), {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Mayap-Client': 'web/1.3.1'
    },
    body: JSON.stringify({ capability: 'device-control', protocolVersion: 1 })
  });

  if (!response.ok) {
    throw new ApiError(response.status === 401 ? 'Phiên đăng nhập đã hết hạn' : 'Không thể cấp phiên điều khiển', response.status);
  }

  const session = (await response.json()) as MqttSession;
  validateSession(config, session);
  return session;
}

export async function pairDevice(
  config: RuntimeConfig,
  pairingCode: string,
  displayName: string
): Promise<void> {
  const response = await fetch(apiUrl(config, config.pairingEndpoint), {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Mayap-Client': 'web/1.3.1'
    },
    body: JSON.stringify({ pairingCode, displayName })
  });

  if (!response.ok) {
    const message = response.status === 409
      ? 'Thiết bị đã được liên kết với một tài khoản khác'
      : 'Không thể liên kết thiết bị. Hãy kiểm tra mã và thử lại.';
    throw new ApiError(message, response.status);
  }
}

export async function saveBatchPlan(
  config: RuntimeConfig,
  deviceId: string,
  plan: BatchPlan
): Promise<void> {
  const response = await fetch(apiUrl(config, `/v1/devices/${encodeURIComponent(deviceId)}/batch-plan`), {
    method: 'PUT',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Mayap-Client': 'web/1.3.1'
    },
    body: JSON.stringify(plan)
  });
  if (!response.ok) throw new ApiError('Không thể lưu thông tin mẻ trên máy chủ', response.status);
}

function validateSession(config: RuntimeConfig, session: MqttSession): void {
  if (!session?.user?.id || !Array.isArray(session.devices)) {
    throw new Error('Phản hồi phiên người dùng không hợp lệ');
  }
  const deviceIds = session.devices.map((device) => device.id);
  if (deviceIds.some((id) => !DEVICE_ID_RE.test(id)) || new Set(deviceIds).size !== deviceIds.length) {
    throw new Error('Danh sách thiết bị được cấp quyền không hợp lệ');
  }
  const mqttUrl = session.mqtt?.url || '';
  const secure = /^wss:\/\//i.test(mqttUrl);
  const localTest = config.environment === 'staging' && /^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(mqttUrl);
  if (!secure && !localTest) {
    throw new Error('Broker production bắt buộc dùng WSS; WS chỉ được phép ở localhost staging');
  }
  if (!session.mqtt.clientId || !session.mqtt.username || !session.mqtt.password) {
    throw new Error('Phiên MQTT thiếu thông tin xác thực');
  }
  const expiresAt = Date.parse(session.mqtt.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + 10_000) {
    throw new Error('Phiên MQTT đã hết hạn hoặc quá ngắn');
  }
}
