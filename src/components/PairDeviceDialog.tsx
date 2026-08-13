import { useEffect, useState } from 'react';
import { Cloud, Cpu, Eye, EyeOff, LoaderCircle, X } from 'lucide-react';
import type { RuntimeConfig } from '../types';
import { loadDirectMqttProfile, saveDirectMqttProfile } from '../lib/directMqttProfile';

interface PairDeviceDialogProps {
  open: boolean;
  config: RuntimeConfig;
  onClose: () => void;
  onPaired: () => void;
  onOpenWifi: () => void;
}

export function PairDeviceDialog({ open, config, onClose, onPaired, onOpenWifi }: PairDeviceDialogProps) {
  const [brokerUrl, setBrokerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [deviceId, setDeviceId] = useState('MAP-A1B2C3D4E5F6');
  const [deviceName, setDeviceName] = useState('Máy ấp 01');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const saved = loadDirectMqttProfile();
    if (!saved) return;
    setBrokerUrl(saved.brokerUrl);
    setUsername(saved.username);
    setPassword(saved.password);
    setDeviceId(saved.deviceId);
    setDeviceName(saved.deviceName);
  }, [open]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      saveDirectMqttProfile({ brokerUrl, username, password, deviceId, deviceName });
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        await Notification.requestPermission().catch(() => 'default');
      }
      onPaired();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể lưu kết nối MQTT.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal pairing-modal" role="dialog" aria-modal="true" aria-labelledby="pair-title">
        <button className="icon-button modal-close" type="button" aria-label="Đóng hộp thoại" onClick={onClose}><X size={20} /></button>
        <div className="modal-icon"><Cloud size={23} /></div>
        <span className="eyebrow">KẾT NỐI MQTT TRỰC TIẾP</span>
        <h2 id="pair-title">Kết nối máy ấp với HiveMQ</h2>
        <p>Nhập một lần thông tin WebSocket của HiveMQ. Website sẽ trao đổi MQTT trực tiếp với ESP32, không cần backend riêng.</p>
        <form onSubmit={submit} className="pair-form" autoComplete="off">
          <label>
            <span>HiveMQ WebSocket URL</span>
            <input value={brokerUrl} onChange={(event) => setBrokerUrl(event.target.value)} placeholder="wss://xxxx.hivemq.cloud:8884/mqtt" inputMode="url" autoCapitalize="none" spellCheck={false} required />
          </label>
          <label>
            <span>MQTT username của website</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="mayap-web" autoCapitalize="none" spellCheck={false} required />
          </label>
          <label>
            <span>MQTT password</span>
            <div className="wifi-input">
              <input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="new-password" required />
              <button type="button" aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            </div>
          </label>
          <label>
            <span>Device ID</span>
            <input value={deviceId} onChange={(event) => setDeviceId(event.target.value.toUpperCase())} placeholder="MAP-A1B2C3D4E5F6" pattern="MAP-[A-Fa-f0-9]{12}" maxLength={16} autoCapitalize="characters" required />
          </label>
          <label>
            <span>Tên hiển thị</span>
            <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="Máy ấp 01" maxLength={40} required />
          </label>
          <div className="local-provisioning-note"><Cpu size={18} /><span>Topic dùng chung: <b>{config.topicRoot}/{deviceId || 'MAP-...'}</b>. Credential được lưu cục bộ trong trình duyệt này, không ghi vào GitHub.</span></div>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <button className="button primary full" type="submit" disabled={busy}>
            {busy && <LoaderCircle className="spin" size={17} />}
            {busy ? 'Đang lưu…' : 'Lưu và kết nối'}
          </button>
          <button className="pair-wifi-link" type="button" onClick={onOpenWifi}>ESP32 chưa vào Wi-Fi? Mở hướng dẫn cấu hình</button>
        </form>
      </section>
    </div>
  );
}
