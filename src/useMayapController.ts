import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type {
  AckMessage,
  CommandAction,
  DeviceLog,
  DeviceRuntimeState,
  GatewayStatus,
  MachineConfig,
  MqttSession,
  RuntimeConfig,
  WifiCredentials
} from './types';
import { MayapMqttGateway } from './lib/mqttGateway';

const EMPTY_STATUS: GatewayStatus = { phase: 'authorizing', message: 'Đang khởi tạo…' };

export function useMayapController(runtimeConfig: RuntimeConfig | null) {
  const gatewayRef = useRef<MayapMqttGateway | null>(null);
  const [session, setSession] = useState<MqttSession | null>(null);
  const [status, setStatus] = useState<GatewayStatus>(EMPTY_STATUS);
  const [devices, setDevices] = useState<Record<string, DeviceRuntimeState>>({});
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState('');
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!runtimeConfig) return;
    const gateway = new MayapMqttGateway(runtimeConfig, {
      onSession: (nextSession) => {
        setSession(nextSession);
        setDevices((current) => {
          const allowed: Record<string, DeviceRuntimeState> = {};
          nextSession.devices.forEach((summary) => {
            allowed[summary.id] = current[summary.id] ?? emptyDevice(summary);
            allowed[summary.id]!.summary = summary;
          });
          return allowed;
        });
        setSelectedId((current) => {
          const preferred = current || localStorage.getItem('mayap.selectedDevice') || '';
          return nextSession.devices.some((device) => device.id === preferred)
            ? preferred
            : nextSession.devices[0]?.id ?? '';
        });
      },
      onStatus: setStatus,
      onPresence: (deviceId, payload) => updateDevice(setDevices, deviceId, (device) => ({
        ...device,
        presence: payload,
        presenceAt: Date.now()
      })),
      onSnapshot: (deviceId, payload) => updateDevice(setDevices, deviceId, (device) => ({
        ...device,
        snapshot: payload,
        snapshotAt: Date.now(),
        telemetry: [
          ...device.telemetry,
          { at: Date.now(), temperature: Number(payload.runtime.temperature), humidity: Number(payload.runtime.humidity) }
        ].slice(-180)
      })),
      onConfig: (deviceId, payload) => updateDevice(setDevices, deviceId, (device) => ({
        ...device,
        config: payload,
        configAt: Date.now()
      })),
      onAck: (deviceId, payload) => {
        updateDevice(setDevices, deviceId, (device) => ({ ...device }));
        setNotice(ackMessage(payload));
      },
      onLog: (deviceId, payload) => updateDevice(setDevices, deviceId, (device) => ({
        ...device,
        logs: [payload as DeviceLog, ...device.logs.filter((item) => item.id !== (payload as DeviceLog).id)].slice(0, 200)
      }))
    });
    gatewayRef.current = gateway;
    void gateway.start();
    const reconnectWhenOnline = () => void gateway.start();
    window.addEventListener('online', reconnectWhenOnline);
    return () => {
      window.removeEventListener('online', reconnectWhenOnline);
      gateway.stop();
      gatewayRef.current = null;
    };
  }, [runtimeConfig]);

  useEffect(() => {
    if (!selectedId) return;
    localStorage.setItem('mayap.selectedDevice', selectedId);
    gatewayRef.current?.setActiveDevice(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const selectedDevice = selectedId ? devices[selectedId] ?? null : null;
  const isDeviceOnline = Boolean(
    selectedDevice?.presence?.online &&
    clock - Math.max(selectedDevice.presenceAt, selectedDevice.snapshotAt, selectedDevice.configAt) <
      (runtimeConfig?.staleAfterMs ?? 90_000)
  );

  const selectDevice = useCallback((deviceId: string) => setSelectedId(deviceId), []);

  const sendCommand = useCallback(async (action: CommandAction) => {
    const device = selectedId ? devices[selectedId] : null;
    const bootId = Number(device?.snapshot?.bootId || device?.config?.bootId || 0);
    if (!device || !isDeviceOnline) throw new Error('Thiết bị đang offline');
    const sequence = Math.max(device.commandSequence + 1, Math.floor(Date.now() / 1000));
    await gatewayRef.current?.sendCommand(device.summary.id, action, bootId, sequence);
    updateDevice(setDevices, device.summary.id, (current) => ({ ...current, commandSequence: sequence }));
    setNotice('Đã gửi lệnh. Đang chờ ESP32 xác nhận…');
  }, [devices, isDeviceOnline, selectedId]);

  const sendConfig = useCallback(async (config: MachineConfig) => {
    const device = selectedId ? devices[selectedId] : null;
    if (!device || !isDeviceOnline) throw new Error('Thiết bị đang offline');
    const revision = Math.max(Number(device.config?.revision || 0) + 1, Math.floor(Date.now() / 1000));
    await gatewayRef.current?.sendConfig(device.summary.id, config, revision);
    setNotice('Đã gửi cấu hình. Đang chờ thiết bị đọc lại…');
  }, [devices, isDeviceOnline, selectedId]);

  const sendWifiCredentials = useCallback(async (credentials: WifiCredentials) => {
    const device = selectedId ? devices[selectedId] : null;
    const bootId = Number(device?.snapshot?.bootId || device?.config?.bootId || 0);
    if (!device || !isDeviceOnline) throw new Error('Thiết bị phải đang trực tuyến để đổi Wi-Fi');
    if (session?.user.role !== 'owner') throw new Error('Chỉ chủ sở hữu được thay đổi Wi-Fi');
    const sequence = Math.max(device.commandSequence + 1, Math.floor(Date.now() / 1000));
    await gatewayRef.current?.sendWifiCredentials(device.summary.id, credentials, bootId, sequence);
    updateDevice(setDevices, device.summary.id, (current) => ({ ...current, commandSequence: sequence }));
    setNotice('ESP32 đã nhận yêu cầu. Thiết bị sẽ ngắt kết nối ngắn để chuyển Wi-Fi…');
  }, [devices, isDeviceOnline, selectedId, session?.user.role]);

  return useMemo(() => ({
    session,
    status,
    devices,
    selectedId,
    selectedDevice,
    isDeviceOnline,
    notice,
    selectDevice,
    sendCommand,
    sendConfig,
    sendWifiCredentials,
    reconnect: () => void gatewayRef.current?.start(),
    showNotice: setNotice
  }), [session, status, devices, selectedId, selectedDevice, isDeviceOnline, notice, selectDevice, sendCommand, sendConfig, sendWifiCredentials]);
}

function emptyDevice(summary: MqttSession['devices'][number]): DeviceRuntimeState {
  return {
    summary,
    presence: null,
    presenceAt: 0,
    snapshot: null,
    snapshotAt: 0,
    config: null,
    configAt: 0,
    logs: [],
    telemetry: [],
    commandSequence: Math.floor(Date.now() / 1000)
  };
}

function updateDevice(
  setter: Dispatch<SetStateAction<Record<string, DeviceRuntimeState>>>,
  deviceId: string,
  update: (device: DeviceRuntimeState) => DeviceRuntimeState
) {
  setter((current) => current[deviceId]
    ? { ...current, [deviceId]: update(current[deviceId]) }
    : current);
}

function ackMessage(ack: AckMessage): string {
  const messages: Record<AckMessage['result'], string> = {
    accepted: 'ESP32 đã tiếp nhận yêu cầu',
    applied: 'ESP32 đã áp dụng thành công',
    rejected: 'ESP32 từ chối yêu cầu',
    invalid: 'Dữ liệu gửi xuống không hợp lệ',
    duplicate: 'Yêu cầu đã được xử lý trước đó',
    busy: 'ESP32 đang xử lý tác vụ khác',
    expired: 'Lệnh đã hết thời gian hiệu lực',
    stale: 'Lệnh thuộc lần khởi động cũ',
    unsupported: 'Firmware chưa hỗ trợ thao tác này'
  };
  return ack.message?.trim() || messages[ack.result] || 'Đã nhận phản hồi từ ESP32';
}
