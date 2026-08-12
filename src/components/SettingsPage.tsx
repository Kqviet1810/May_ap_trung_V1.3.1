import { Activity, Bell, ChevronDown, Cloud, Eye, EyeOff, Gauge, LockKeyhole, RotateCw, Router, Save, ShieldCheck, Thermometer, Wifi, Wrench } from 'lucide-react';
import { useState } from 'react';
import type { CommandAction, DeviceRuntimeState, GatewayStatus, MachineConfig, MayapUser, RuntimeConfig, WifiCredentials } from '../types';
import { isSecureProductionConfig } from '../lib/config';

interface SettingsPageProps {
  config: RuntimeConfig;
  status: GatewayStatus;
  user: MayapUser | null;
  device: DeviceRuntimeState | null;
  online: boolean;
  canControl: boolean;
  canManageNetwork: boolean;
  onSendConfig: (config: MachineConfig) => Promise<void>;
  onSendWifi: (credentials: WifiCredentials) => Promise<void>;
  onRequestCommand: (action: CommandAction, title: string, message: string) => void;
  onNotice: (message: string) => void;
}

export function SettingsPage({ config, status, user, device, online, canControl, canManageNetwork, onSendConfig, onSendWifi, onRequestCommand, onNotice }: SettingsPageProps) {
  const machineConfig = device?.config?.config;
  const [wifiBusy, setWifiBusy] = useState(false);
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!machineConfig) return;
    const data = new FormData(event.currentTarget);
    const next: MachineConfig = {
      ...machineConfig,
      targetTemp: num(data, 'targetTemp'),
      lowTempAlarm: num(data, 'lowTempAlarm'),
      highTempAlarm: num(data, 'highTempAlarm'),
      emergencyTemp: num(data, 'emergencyTemp'),
      ventOnTemp: num(data, 'ventOnTemp'),
      ventOffTemp: num(data, 'ventOffTemp'),
      turnIntervalMin: num(data, 'turnIntervalMin'),
      turnMaxRunSec: num(data, 'turnMaxRunSec'),
      tempOffset: num(data, 'tempOffset'),
      humidityOffset: num(data, 'humidityOffset'),
      sensorTimeoutSec: num(data, 'sensorTimeoutSec')
    };
    if (!(next.lowTempAlarm < next.targetTemp && next.targetTemp < next.highTempAlarm && next.highTempAlarm < next.emergencyTemp)) {
      onNotice('Thứ tự an toàn phải là: cảnh báo thấp < nhiệt độ đặt < cảnh báo cao < ngắt khẩn');
      return;
    }
    if (!(next.ventOffTemp < next.ventOnTemp)) {
      onNotice('Nhiệt độ tắt thông gió phải thấp hơn nhiệt độ bật');
      return;
    }
    try {
      await onSendConfig(next);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Không thể gửi cấu hình');
    }
  };

  const submitWifi = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ssid = String(data.get('wifiSsid') || '').trim();
    const password = String(data.get('wifiPassword') || '');
    const confirmation = String(data.get('wifiPasswordConfirm') || '');
    if (!ssid || ssid.length > 32) return onNotice('Tên Wi-Fi phải có từ 1 đến 32 ký tự');
    if (password.length < 8 || password.length > 63) return onNotice('Mật khẩu Wi-Fi phải có từ 8 đến 63 ký tự');
    if (password !== confirmation) return onNotice('Hai lần nhập mật khẩu Wi-Fi chưa khớp');
    setWifiBusy(true);
    try {
      await onSendWifi({ ssid, password });
      form.reset();
      setShowWifiPassword(false);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Không thể gửi cấu hình Wi-Fi');
    } finally {
      setWifiBusy(false);
    }
  };

  return (
    <div className="settings-layout">
      <div className="settings-main">
        <section className="panel wifi-card" id="wifi-settings">
          <div className="section-heading wifi-heading">
            <div><span className="eyebrow">KẾT NỐI THIẾT BỊ</span><h2>Cấu hình Wi-Fi ESP32</h2></div>
            <span className={`wifi-status ${online ? 'online' : ''}`}><Wifi size={16} />{online ? device?.presence?.ssid || 'Đang trực tuyến' : 'Thiết bị ngoại tuyến'}</span>
          </div>
          <p className="wifi-description">Đổi mạng cho thiết bị đang trực tuyến. Mật khẩu chỉ được gửi một lần qua kênh bảo mật và không lưu trên trình duyệt.</p>
          <form className="wifi-form" onSubmit={submitWifi} autoComplete="off">
            <label className="wide">
              <span>Tên Wi-Fi (SSID)</span>
              <div className="wifi-input"><Router size={18} /><input name="wifiSsid" placeholder={device?.presence?.ssid || 'Ví dụ: MAYAP_WORKSHOP'} maxLength={32} autoCapitalize="none" spellCheck={false} disabled={!canManageNetwork || wifiBusy} required /></div>
            </label>
            <label>
              <span>Mật khẩu Wi-Fi</span>
              <div className="wifi-input"><LockKeyhole size={18} /><input name="wifiPassword" type={showWifiPassword ? 'text' : 'password'} minLength={8} maxLength={63} autoComplete="new-password" disabled={!canManageNetwork || wifiBusy} required /><button type="button" aria-label={showWifiPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} onClick={() => setShowWifiPassword((value) => !value)} disabled={!canManageNetwork}>{showWifiPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
            </label>
            <label>
              <span>Nhập lại mật khẩu</span>
              <div className="wifi-input"><ShieldCheck size={18} /><input name="wifiPasswordConfirm" type={showWifiPassword ? 'text' : 'password'} minLength={8} maxLength={63} autoComplete="new-password" disabled={!canManageNetwork || wifiBusy} required /></div>
            </label>
            <div className="wifi-action wide">
              <small>{canManageNetwork ? 'ESP32 sẽ mất kết nối khoảng 10–30 giây rồi tự kết nối lại.' : user?.role === 'owner' ? 'Cần chọn một thiết bị đang trực tuyến.' : 'Chỉ chủ sở hữu được phép thay đổi Wi-Fi.'}</small>
              <button className="button primary" type="submit" disabled={!canManageNetwork || wifiBusy}><Wifi size={17} />{wifiBusy ? 'Đang gửi…' : 'Đổi Wi-Fi cho thiết bị'}</button>
            </div>
          </form>
        </section>

        <form key={`${device?.summary.id || 'none'}-${device?.config?.revision || 0}`} className="machine-settings-form" onSubmit={submit}>
        <SettingSection icon={<Thermometer />} title="Nhiệt độ và bảo vệ" summary={machineConfig ? `${fmt(machineConfig.targetTemp)}°C · ngắt ${fmt(machineConfig.emergencyTemp)}°C` : 'Chờ cấu hình từ ESP32'} open>
          <div className="settings-grid">
            <Field name="targetTemp" label="Nhiệt độ đặt" unit="°C" value={machineConfig?.targetTemp} min={30} max={40} step={0.1} disabled={!canControl} />
            <Field name="lowTempAlarm" label="Cảnh báo thấp" unit="°C" value={machineConfig?.lowTempAlarm} min={20} max={40} step={0.1} disabled={!canControl} />
            <Field name="highTempAlarm" label="Cảnh báo cao" unit="°C" value={machineConfig?.highTempAlarm} min={30} max={50} step={0.1} disabled={!canControl} />
            <Field name="emergencyTemp" label="Ngắt khẩn cấp" unit="°C" value={machineConfig?.emergencyTemp} min={31} max={60} step={0.1} disabled={!canControl} />
            <Field name="ventOnTemp" label="Bật thông gió" unit="°C" value={machineConfig?.ventOnTemp} min={30} max={50} step={0.1} disabled={!canControl} />
            <Field name="ventOffTemp" label="Tắt thông gió" unit="°C" value={machineConfig?.ventOffTemp} min={30} max={50} step={0.1} disabled={!canControl} />
          </div>
        </SettingSection>

        <SettingSection icon={<RotateCw />} title="Cơ cấu đảo" summary={machineConfig ? `Mỗi ${machineConfig.turnIntervalMin} phút · timeout ${machineConfig.turnMaxRunSec} giây` : 'Chờ cấu hình từ ESP32'}>
          <div className="settings-grid">
            <Field name="turnIntervalMin" label="Chu kỳ đảo" unit="phút" value={machineConfig?.turnIntervalMin} min={15} max={720} disabled={!canControl} />
            <Field name="turnMaxRunSec" label="Timeout hành trình" unit="giây" value={machineConfig?.turnMaxRunSec} min={3} max={120} disabled={!canControl} />
          </div>
        </SettingSection>

        <SettingSection icon={<Gauge />} title="Cảm biến và hiệu chỉnh" summary={machineConfig ? `Bù nhiệt ${fmt(machineConfig.tempOffset)}°C · timeout ${machineConfig.sensorTimeoutSec}s` : 'Chờ cấu hình từ ESP32'}>
          <div className="settings-grid">
            <Field name="tempOffset" label="Bù nhiệt độ" unit="°C" value={machineConfig?.tempOffset} min={-10} max={10} step={0.1} disabled={!canControl} />
            <Field name="humidityOffset" label="Bù độ ẩm" unit="%RH" value={machineConfig?.humidityOffset} min={-20} max={20} step={0.1} disabled={!canControl} />
            <Field name="sensorTimeoutSec" label="Timeout cảm biến" unit="giây" value={machineConfig?.sensorTimeoutSec} min={2} max={120} disabled={!canControl} />
          </div>
        </SettingSection>

        <SettingSection icon={<Wrench />} title="PID Auto Tune" summary="Chỉ chạy khi khoang trống và không có mẻ đang hoạt động">
          <div className="autotune-row">
            <div><strong>Tự động hiệu chỉnh bộ điều khiển</strong><p>ESP32 chịu trách nhiệm giới hạn nhiệt và lưu Kp/Ki/Kd sau khi hoàn tất.</p></div>
            <button className="button secondary" type="button" disabled={!canControl || !online || Boolean(device?.snapshot?.runtime.batchRunning)} onClick={() => onRequestCommand('autotune_start', 'Bắt đầu Auto Tune PID?', 'Chỉ tiếp tục khi khoang ấp trống và thiết bị được giám sát trực tiếp.')}>Bắt đầu Auto Tune</button>
          </div>
        </SettingSection>

        <button className="button primary settings-save" type="submit" disabled={!canControl || !online || !machineConfig}><Save size={17} /> Lưu cấu hình và đọc lại</button>
        </form>
      </div>

      <aside className="settings-side">
        <section className="panel system-card">
          <div className="section-heading"><div><span className="eyebrow">TRẠNG THÁI HỆ THỐNG</span><h2>Kiểm tra production</h2></div><Activity size={20} /></div>
          <SystemCheck icon={<LockKeyhole />} label="API production qua HTTPS" ok={isSecureProductionConfig(config)} />
          <SystemCheck icon={<Cloud />} label="Phiên MQTT ngắn hạn" ok={status.phase === 'connected'} />
          <SystemCheck icon={<ShieldCheck />} label="Tài khoản được xác thực" ok={Boolean(user)} />
          <SystemCheck icon={<Activity />} label="Thiết bị có mặt" ok={online} />
        </section>
        <section className="panel account-card">
          <span className="eyebrow">QUYỀN TRUY CẬP</span>
          <h2>{user?.name || 'Chưa đăng nhập'}</h2>
          <p>{user ? `Vai trò: ${roleName(user.role)}` : 'Website không lưu mật khẩu MQTT trong mã nguồn.'}</p>
          <div className="security-note"><Bell size={17} /><span>Thông báo nền cần Web Push từ backend; website không hứa cảnh báo khi tab đã đóng nếu chưa cấu hình dịch vụ này.</span></div>
        </section>
      </aside>
    </div>
  );
}

function SettingSection({ icon, title, summary, open, children }: { icon: React.ReactNode; title: string; summary: string; open?: boolean; children: React.ReactNode }) {
  return <details className="setting-section panel" open={open}><summary><span className="setting-icon">{icon}</span><div><strong>{title}</strong><small>{summary}</small></div><ChevronDown className="chevron" size={20} /></summary><div className="setting-content">{children}</div></details>;
}

function Field({ name, label, unit, value, min, max, step = 1, disabled }: { name: string; label: string; unit: string; value?: number; min: number; max: number; step?: number; disabled: boolean }) {
  return <label className="setting-field"><span>{label}</span><div className="input-unit"><input name={name} type="number" defaultValue={value ?? ''} min={min} max={max} step={step} disabled={disabled || value === undefined} required /><b>{unit}</b></div></label>;
}

function SystemCheck({ icon, label, ok }: { icon: React.ReactNode; label: string; ok: boolean }) {
  return <div className="system-check"><span>{icon}</span><strong>{label}</strong><b className={ok ? 'ok' : ''}>{ok ? 'Đạt' : 'Chờ'}</b></div>;
}

function num(data: FormData, key: string): number { return Number(data.get(key)); }
function fmt(value: number): string { return value.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function roleName(role: MayapUser['role']): string { return ({ owner: 'Chủ sở hữu', operator: 'Vận hành', viewer: 'Chỉ xem' })[role]; }
