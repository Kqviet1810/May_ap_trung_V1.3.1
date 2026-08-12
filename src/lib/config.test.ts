import { describe, expect, it } from 'vitest';
import type { RuntimeConfig } from '../types';
import { isRuntimeConfigured, isSecureProductionConfig } from './config';

const base: RuntimeConfig = {
  environment: 'unconfigured',
  apiBaseUrl: '',
  sessionEndpoint: '/v1/mqtt/session',
  pairingEndpoint: '/v1/devices/pair',
  loginUrl: '',
  supportUrl: '',
  topicRoot: 'mayap/v1',
  staleAfterMs: 90_000
};

describe('cấu hình môi trường', () => {
  it('chỉ công nhận production khi API dùng HTTPS', () => {
    expect(isRuntimeConfigured({ ...base, environment: 'production', apiBaseUrl: 'https://api.mayap.vn' })).toBe(true);
    expect(isSecureProductionConfig({ ...base, environment: 'production', apiBaseUrl: 'https://api.mayap.vn' })).toBe(true);
    expect(isRuntimeConfigured({ ...base, environment: 'production', apiBaseUrl: 'http://api.mayap.vn' })).toBe(false);
  });

  it('chỉ cho phép HTTP staging trên loopback để test tại máy', () => {
    expect(isRuntimeConfigured({ ...base, environment: 'staging', apiBaseUrl: 'http://localhost:8787' })).toBe(true);
    expect(isRuntimeConfigured({ ...base, environment: 'staging', apiBaseUrl: 'http://127.0.0.1:8787' })).toBe(true);
    expect(isRuntimeConfigured({ ...base, environment: 'staging', apiBaseUrl: 'http://192.168.1.10:8787' })).toBe(false);
  });
});
