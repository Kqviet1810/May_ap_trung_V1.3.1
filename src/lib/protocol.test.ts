import { describe, expect, it } from 'vitest';
import { createCommandPayload, createWifiPayload, parseInboundTopic, topicSet } from './protocol';

describe('giao thức MAYAP', () => {
  it('chỉ phân tích topic của đúng namespace và Device ID', () => {
    expect(parseInboundTopic('mayap/v1', 'mayap/v1/MAP-A1B2C3D4E5F6/snapshot')).toEqual({
      deviceId: 'MAP-A1B2C3D4E5F6',
      channel: 'snapshot'
    });
    expect(parseInboundTopic('mayap/v1', 'mayap/v1/not-a-device/snapshot')).toBeNull();
    expect(parseInboundTopic('mayap/v1', 'other/MAP-A1B2C3D4E5F6/snapshot')).toBeNull();
  });

  it('tạo topic đầy đủ nhưng từ chối Device ID sai', () => {
    expect(topicSet('mayap/v1', 'MAP-A1B2C3D4E5F6').command).toBe('mayap/v1/MAP-A1B2C3D4E5F6/command');
    expect(topicSet('mayap/v1', 'MAP-A1B2C3D4E5F6').wifiSet).toBe('mayap/v1/MAP-A1B2C3D4E5F6/wifi/set');
    expect(() => topicSet('mayap/v1', 'MAP-123')).toThrow();
  });

  it('lệnh luôn có bootId, sequence và hạn dùng ngắn', () => {
    const payload = createCommandPayload('batch_start', 42, 100, 1_780_000_000_000);
    expect(payload.bootId).toBe(42);
    expect(payload.sequence).toBe(100);
    expect(payload.expiresAt).toBe(1_780_000_008);
    expect(payload.validForMs).toBe(5000);
  });

  it('tạo yêu cầu đổi Wi-Fi ngắn hạn và không nhận mật khẩu yếu', () => {
    const payload = createWifiPayload({ ssid: 'MAYAP-LAB', password: 'mat-khau-an-toan' }, 42, 101, 1_780_000_000_000);
    expect(payload.ssid).toBe('MAYAP-LAB');
    expect(payload.expiresAt).toBe(1_780_000_030);
    expect(() => createWifiPayload({ ssid: 'MAYAP-LAB', password: '123' }, 42, 101)).toThrow();
  });
});
