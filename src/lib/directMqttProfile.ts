import { DEVICE_ID_RE } from './protocol';

export interface DirectMqttProfile {
  brokerUrl: string;
  username: string;
  password: string;
  deviceId: string;
  deviceName: string;
}

const STORAGE_KEY = 'mayap.directMqtt.v1';
const CLIENT_ID_KEY = 'mayap.directMqtt.clientId.v1';

export function loadDirectMqttProfile(): DirectMqttProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveDirectMqttProfile(value: DirectMqttProfile): DirectMqttProfile {
  const profile = normalizeProfile(value);
  if (!profile) throw new Error('Thông tin kết nối MQTT chưa hợp lệ');
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  return profile;
}

export function clearDirectMqttProfile(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function directMqttClientId(deviceId: string): string {
  const existing = sessionStorage.getItem(CLIENT_ID_KEY);
  if (existing) return existing;
  const suffix = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12)
    ?? Math.random().toString(16).slice(2, 14);
  const clientId = `mayap-web-${deviceId.slice(-6).toLowerCase()}-${suffix}`;
  sessionStorage.setItem(CLIENT_ID_KEY, clientId);
  return clientId;
}

function normalizeProfile(value: unknown): DirectMqttProfile | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<DirectMqttProfile>;
  const brokerUrl = String(input.brokerUrl || '').trim();
  const username = String(input.username || '').trim();
  const password = String(input.password || '');
  const deviceId = String(input.deviceId || '').trim().toUpperCase();
  const deviceName = String(input.deviceName || 'Máy ấp 01').trim().slice(0, 40) || 'Máy ấp 01';

  if (!/^wss:\/\//i.test(brokerUrl)) return null;
  if (!username || !password) return null;
  if (!DEVICE_ID_RE.test(deviceId)) return null;
  return { brokerUrl, username, password, deviceId, deviceName };
}
