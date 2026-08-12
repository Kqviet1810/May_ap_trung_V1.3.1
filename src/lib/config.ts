import type { RuntimeConfig } from '../types';

const DEFAULT_CONFIG: RuntimeConfig = {
  environment: 'unconfigured',
  apiBaseUrl: '',
  sessionEndpoint: '/v1/mqtt/session',
  pairingEndpoint: '/v1/devices/pair',
  loginUrl: '',
  supportUrl: '',
  topicRoot: 'mayap/v1',
  staleAfterMs: 90_000
};

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}config.json`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = (await response.json()) as Partial<RuntimeConfig> & Record<string, unknown>;

    if ('mqttPassword' in value || 'mqttUsername' in value) {
      throw new Error('Không được đặt thông tin MQTT bí mật trong config.json');
    }

    const merged = { ...DEFAULT_CONFIG, ...value };
    return {
      ...merged,
      apiBaseUrl: String(merged.apiBaseUrl || '').replace(/\/$/, ''),
      topicRoot: String(merged.topicRoot || DEFAULT_CONFIG.topicRoot).replace(/^\/+|\/+$/g, ''),
      staleAfterMs: Math.max(15_000, Number(merged.staleAfterMs) || DEFAULT_CONFIG.staleAfterMs)
    };
  } catch (error) {
    console.error('Không thể tải cấu hình MAYAP:', error);
    return DEFAULT_CONFIG;
  }
}

export function isProductionConfigured(config: RuntimeConfig): boolean {
  return config.environment !== 'unconfigured' && /^https:\/\//i.test(config.apiBaseUrl);
}

export function apiUrl(config: RuntimeConfig, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${config.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}
