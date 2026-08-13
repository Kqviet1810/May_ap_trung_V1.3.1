import type { MqttClient } from 'mqtt';
import type {
  AckMessage,
  CommandAction,
  GatewayHandlers,
  MachineConfig,
  MqttSession,
  RuntimeConfig,
  WifiCredentials
} from '../types';
import { ApiError, requestMqttSession } from './api';
import { directMqttClientId, loadDirectMqttProfile } from './directMqttProfile';
import {
  createCommandPayload,
  createRequestId,
  createWifiPayload,
  eventToLog,
  isConfigReport,
  isPresence,
  isSnapshot,
  parseInboundTopic,
  topicSet
} from './protocol';
import { isRuntimeConfigured } from './config';

const MAX_MESSAGE_BYTES = 64 * 1024;
const SESSION_TIMEOUT_MS = 12_000;

export class MayapMqttGateway {
  private client: MqttClient | null = null;
  private session: MqttSession | null = null;
  private refreshTimer = 0;
  private retryTimer = 0;
  private heartbeatTimer = 0;
  private selectedDeviceId = '';
  private stopped = false;
  private runId = 0;
  private retryAttempt = 0;
  private sessionRequest: AbortController | null = null;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly handlers: GatewayHandlers
  ) {}

  async start(): Promise<void> {
    const runId = ++this.runId;
    this.stopped = false;
    window.clearTimeout(this.refreshTimer);
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.heartbeatTimer);
    this.sessionRequest?.abort();
    this.sessionRequest = null;
    this.client?.end(true);
    this.client = null;
    this.session = null;

    if (this.config.connectionMode === 'direct-mqtt') {
      await this.startDirect(runId);
      return;
    }

    if (!isRuntimeConfigured(this.config)) {
      this.handlers.onStatus({
        phase: 'unconfigured',
        message: 'Chưa cấu hình dịch vụ xác thực'
      });
      return;
    }

    const requestController = new AbortController();
    this.sessionRequest = requestController;
    this.handlers.onStatus({ phase: 'authorizing', message: 'Đang xác thực phiên điều khiển…' });
    const timeout = window.setTimeout(() => requestController.abort(), SESSION_TIMEOUT_MS);
    try {
      const session = await requestMqttSession(this.config, requestController.signal);
      if (this.stopped || runId !== this.runId) return;
      this.session = session;
      this.handlers.onSession(session);
      await this.connect(session, runId);
      this.scheduleRefresh(session.mqtt.expiresAt);
    } catch (error) {
      if (this.stopped || runId !== this.runId) return;
      const unauthorized = error instanceof ApiError && error.status === 401;
      this.handlers.onStatus({
        phase: unauthorized ? 'unauthorized' : 'error',
        message: error instanceof DOMException && error.name === 'AbortError'
          ? 'Dịch vụ xác thực không phản hồi đúng hạn'
          : error instanceof Error ? error.message : 'Không thể mở phiên điều khiển'
      });
      if (!unauthorized) this.scheduleRetry();
    } finally {
      window.clearTimeout(timeout);
      if (this.sessionRequest === requestController) this.sessionRequest = null;
    }
  }

  setActiveDevice(deviceId: string): void {
    if (this.selectedDeviceId && this.selectedDeviceId !== deviceId) {
      this.publishHeartbeat(this.selectedDeviceId, false, false);
    }
    this.selectedDeviceId = deviceId;
    this.publishHeartbeat(deviceId, true, true);
  }

  async sendCommand(deviceId: string, action: CommandAction, bootId: number, sequence: number): Promise<string> {
    this.assertAuthorizedDevice(deviceId);
    const payload = createCommandPayload(action, bootId, sequence);
    await this.publish(topicSet(this.config.topicRoot, deviceId).command, payload, false);
    return payload.requestId;
  }

  async sendConfig(deviceId: string, config: MachineConfig, revision: number): Promise<string> {
    this.assertAuthorizedDevice(deviceId);
    const requestId = createRequestId('cfg');
    await this.publish(topicSet(this.config.topicRoot, deviceId).configSet, {
      v: 1,
      revision,
      requestId,
      config
    }, false);
    return requestId;
  }

  async sendWifiCredentials(deviceId: string, credentials: WifiCredentials, bootId: number, sequence: number): Promise<string> {
    this.assertAuthorizedDevice(deviceId);
    const payload = createWifiPayload(credentials, bootId, sequence);
    await this.publish(topicSet(this.config.topicRoot, deviceId).wifiSet, payload, false);
    return payload.requestId;
  }

  stop(): void {
    this.stopped = true;
    this.runId += 1;
    window.clearTimeout(this.refreshTimer);
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.heartbeatTimer);
    this.sessionRequest?.abort();
    this.sessionRequest = null;
    if (this.selectedDeviceId) this.publishHeartbeat(this.selectedDeviceId, false, false);
    this.client?.end(true);
    this.client = null;
    this.session = null;
  }

  private async startDirect(runId: number): Promise<void> {
    const profile = loadDirectMqttProfile();
    if (!profile) {
      this.handlers.onStatus({
        phase: 'unconfigured',
        message: 'Chưa nhập kết nối HiveMQ cho máy ấp'
      });
      return;
    }

    const session: MqttSession = {
      user: { id: 'pilot-owner', name: 'Chủ máy', role: 'owner' },
      devices: [{
        id: profile.deviceId,
        name: profile.deviceName,
        model: 'MAYAP ESP32-S3'
      }],
      mqtt: {
        url: profile.brokerUrl,
        clientId: directMqttClientId(profile.deviceId),
        username: profile.username,
        password: profile.password,
        expiresAt: '9999-12-31T23:59:59.000Z'
      }
    };

    this.session = session;
    this.handlers.onSession(session);
    this.handlers.onStatus({ phase: 'connecting', message: 'Đang kết nối trực tiếp HiveMQ…' });
    await this.connect(session, runId);
  }

  private async connect(session: MqttSession, runId: number): Promise<void> {
    this.handlers.onStatus({ phase: 'connecting', message: 'Đang thiết lập kênh điều khiển bảo mật…' });
    const mqtt = (await import('mqtt')).default;
    if (this.stopped || runId !== this.runId) return;
    this.client = mqtt.connect(session.mqtt.url, {
      clientId: session.mqtt.clientId,
      username: session.mqtt.username,
      password: session.mqtt.password,
      protocolVersion: 5,
      clean: true,
      reconnectPeriod: 3000,
      connectTimeout: 10_000,
      keepalive: 45,
      resubscribe: false,
      properties: { sessionExpiryInterval: 0 }
    });

    this.client.on('connect', () => {
      if (runId !== this.runId) return;
      this.retryAttempt = 0;
      this.handlers.onStatus({ phase: 'connected', message: 'Đã kết nối ESP32 qua MQTT' });
      this.subscribeAuthorizedDevices();
      if (this.selectedDeviceId) this.publishHeartbeat(this.selectedDeviceId, true, true);
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = window.setInterval(() => {
        if (this.selectedDeviceId) this.publishHeartbeat(this.selectedDeviceId, true, false);
      }, 9000);
    });

    this.client.on('reconnect', () => {
      if (runId !== this.runId) return;
      this.handlers.onStatus({ phase: 'connecting', message: 'Đang kết nối lại MQTT…' });
    });
    this.client.on('offline', () => {
      if (runId !== this.runId) return;
      this.handlers.onStatus({ phase: 'offline', message: 'Trình duyệt đang ngoại tuyến' });
    });
    this.client.on('close', () => {
      if (!this.stopped && runId === this.runId) {
        this.handlers.onStatus({ phase: 'connecting', message: 'Kênh MQTT tạm gián đoạn' });
      }
    });
    this.client.on('error', (error) => {
      if (runId !== this.runId) return;
      this.handlers.onStatus({ phase: 'error', message: error.message || 'Lỗi kết nối MQTT' });
    });
    this.client.on('message', (topic, bytes) => {
      if (runId === this.runId) this.handleMessage(topic, bytes);
    });
  }

  private subscribeAuthorizedDevices(): void {
    if (!this.client?.connected || !this.session) return;
    const topics = this.session.devices.flatMap((device) => {
      const set = topicSet(this.config.topicRoot, device.id);
      return [set.presence, set.snapshot, set.configReported, set.ack, set.log];
    });
    if (!topics.length) return;
    topics.forEach((topic) => {
      this.client?.subscribe(topic, { qos: topic.endsWith('/snapshot') ? 0 : 1 });
    });
  }

  private handleMessage(topic: string, bytes: Uint8Array): void {
    if (bytes.byteLength > MAX_MESSAGE_BYTES) return;
    const parsed = parseInboundTopic(this.config.topicRoot, topic);
    if (!parsed || !this.session?.devices.some((device) => device.id === parsed.deviceId)) return;

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return;
    }

    if (parsed.channel === 'presence' && isPresence(payload)) {
      this.handlers.onPresence(parsed.deviceId, payload);
    } else if (parsed.channel === 'snapshot' && isSnapshot(payload)) {
      this.handlers.onSnapshot(parsed.deviceId, payload);
    } else if (parsed.channel === 'config/reported' && isConfigReport(payload)) {
      this.handlers.onConfig(parsed.deviceId, payload);
    } else if (parsed.channel === 'ack' && isAck(payload)) {
      this.handlers.onAck(parsed.deviceId, payload);
    } else if (parsed.channel === 'log') {
      this.handlers.onLog(parsed.deviceId, eventToLog(payload));
    }
  }

  private publishHeartbeat(deviceId: string, active: boolean, sync: boolean): void {
    if (!this.client?.connected || !deviceId) return;
    void this.publish(topicSet(this.config.topicRoot, deviceId).session, {
      active,
      ttlMs: active ? 15_000 : 1000,
      sync
    }, false, 0).catch(() => undefined);
  }

  private publish(topic: string, payload: unknown, retain: boolean, qos: 0 | 1 = 1): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client?.connected) return reject(new Error('Kênh điều khiển chưa sẵn sàng'));
      this.client.publish(topic, JSON.stringify(payload), { qos, retain }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private assertAuthorizedDevice(deviceId: string): void {
    if (!this.session?.devices.some((device) => device.id === deviceId)) {
      throw new Error('Thiết bị này không nằm trong cấu hình trình duyệt');
    }
  }

  private scheduleRefresh(expiresAt: string): void {
    window.clearTimeout(this.refreshTimer);
    const delay = Math.max(30_000, Date.parse(expiresAt) - Date.now() - 60_000);
    this.refreshTimer = window.setTimeout(() => {
      if (this.stopped) return;
      this.client?.end(true);
      this.client = null;
      void this.start();
    }, delay);
  }

  private scheduleRetry(): void {
    window.clearTimeout(this.retryTimer);
    const delay = Math.min(30_000, 2_000 * (2 ** Math.min(this.retryAttempt, 4)));
    this.retryAttempt += 1;
    this.retryTimer = window.setTimeout(() => {
      if (!this.stopped && navigator.onLine) void this.start();
    }, delay);
  }
}

function isAck(value: unknown): value is AckMessage {
  const ack = value as AckMessage;
  return Boolean(ack && typeof ack.requestId === 'string' && typeof ack.result === 'string');
}
