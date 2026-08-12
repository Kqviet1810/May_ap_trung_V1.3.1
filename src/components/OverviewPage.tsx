import { Activity, ArrowUpRight, Fan, Flame, Gauge, RotateCw, Save, Thermometer, WifiOff } from 'lucide-react';
import type { DeviceRuntimeState, MachineConfig } from '../types';
import { TelemetryChart } from './TelemetryChart';

interface OverviewPageProps {
  device: DeviceRuntimeState | null;
  online: boolean;
  canControl: boolean;
  onSaveQuick: (config: MachineConfig) => Promise<void>;
  onOpenPairing: () => void;
}

export function OverviewPage({ device, online, canControl, onSaveQuick, onOpenPairing }: OverviewPageProps) {
  const runtime = device?.snapshot?.runtime;
  const machineConfig = device?.config?.config;
  const saveQuick = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!machineConfig) return;
    const form = new FormData(event.currentTarget);
    await onSaveQuick({
      ...machineConfig,
      targetTemp: Number(form.get('targetTemp')),
      turnIntervalMin: Number(form.get('turnInterval'))
    });
  };

  return (
    <div className="page-stack">
      {!device ? (
        <section className="hero-empty panel">
          <div className="hero-empty-icon"><WifiOff size={26} /></div>
          <div>
            <span className="eyebrow">BẮT ĐẦU VẬN HÀNH</span>
            <h2>Chưa có thiết bị được cấp cho tài khoản</h2>
            <p>Liên kết máy bằng mã dùng một lần. Device ID không được dùng như mật khẩu trong phiên bản này.</p>
          </div>
          <button className="button primary" type="button" onClick={onOpenPairing}>Liên kết thiết bị <ArrowUpRight size={17} /></button>
        </section>
      ) : (
        <section className={`device-hero ${online ? 'online' : ''}`}>
          <div className="device-hero-copy">
            <div className="status-row">
              <span className={`status-badge ${online ? 'online' : 'offline'}`}><i />{online ? 'Đang trực tuyến' : 'Đang ngoại tuyến'}</span>
              <span className="device-id">{device.summary.id}</span>
            </div>
            <h2>{device.summary.name}</h2>
            <p>{device.summary.location || 'Chưa đặt vị trí'} · {device.presence?.firmware ? `Firmware ${device.presence.firmware}` : 'Chưa nhận phiên bản firmware'}</p>
          </div>
          <div className="hero-temperature">
            <span>Nhiệt độ khoang</span>
            <strong>{number(runtime?.temperature, 1)}<small>°C</small></strong>
            <em>{runtime?.machineState || (online ? 'Đang đồng bộ trạng thái' : 'Không có dữ liệu mới')}</em>
          </div>
        </section>
      )}

      <div className="metric-grid">
        <Metric icon={<Thermometer />} label="Nhiệt độ" value={number(runtime?.temperature, 1)} unit="°C" note={machineConfig ? `Mục tiêu ${number(machineConfig.targetTemp, 1)}°C` : 'Chờ cấu hình'} tone="green" />
        <Metric icon={<Gauge />} label="Độ ẩm" value={number(runtime?.humidity, 0)} unit="%" note={runtime ? 'Dữ liệu cảm biến trực tiếp' : 'Chưa có dữ liệu'} tone="blue" />
        <Metric icon={<Flame />} label="Công suất nhiệt" value={number(runtime?.heaterPower, 0)} unit="%" note={runtime?.heaterOn ? 'Thanh nhiệt đang hoạt động' : 'Thanh nhiệt đang nghỉ'} tone="amber" />
        <Metric icon={<RotateCw />} label="Lần đảo tiếp theo" value={runtime ? String(runtime.nextTurnMinutes ?? '—') : '—'} unit="phút" note={turnText(runtime?.turnState)} tone="violet" />
      </div>

      <div className="overview-grid">
        <section className="panel chart-card">
          <div className="section-heading">
            <div><span className="eyebrow">TELEMETRY TRỰC TIẾP</span><h2>Độ ổn định nhiệt độ</h2></div>
            <span className="live-chip"><i /> LIVE</span>
          </div>
          <TelemetryChart points={device?.telemetry ?? []} />
        </section>

        <section className="panel outputs-card">
          <div className="section-heading">
            <div><span className="eyebrow">ĐẦU RA THIẾT BỊ</span><h2>Trạng thái tức thời</h2></div>
            <Activity size={20} />
          </div>
          <div className="output-list">
            <Output icon={<Flame />} label="Thanh nhiệt" active={runtime?.heaterOn} detail={runtime ? `${number(runtime.heaterPower, 0)}% công suất` : 'Chưa có dữ liệu'} />
            <Output icon={<Fan />} label="Quạt tuần hoàn" active={runtime?.circulationFanOn} detail="Phân bố nhiệt trong khoang" />
            <Output icon={<Fan />} label="Quạt thông gió" active={runtime?.ventFanOn} detail="Xả nhiệt theo ngưỡng" />
            <Output icon={<RotateCw />} label="Cơ cấu đảo" active={runtime?.turnState === 1 || runtime?.turnState === 2} detail={turnText(runtime?.turnState)} />
          </div>
        </section>
      </div>

      <section className="panel quick-card">
        <div className="section-heading">
          <div><span className="eyebrow">ĐIỀU CHỈNH NHANH</span><h2>Thông số vận hành chính</h2></div>
          <span className="safe-note">Chỉ gửi khi thiết bị online và đã xác thực</span>
        </div>
        <form className="quick-form" onSubmit={saveQuick}>
          <label><span>Nhiệt độ đặt</span><div className="input-unit"><input name="targetTemp" type="number" min="30" max="40" step="0.1" defaultValue={machineConfig?.targetTemp ?? ''} disabled={!canControl || !machineConfig} required /><b>°C</b></div></label>
          <label><span>Chu kỳ đảo</span><div className="input-unit"><input name="turnInterval" type="number" min="15" max="720" defaultValue={machineConfig?.turnIntervalMin ?? ''} disabled={!canControl || !machineConfig} required /><b>phút</b></div></label>
          <button className="button primary" type="submit" disabled={!canControl || !machineConfig}><Save size={17} /> Lưu và xác nhận</button>
        </form>
      </section>
    </div>
  );
}

function Metric({ icon, label, value, unit, note, tone }: { icon: React.ReactNode; label: string; value: string; unit: string; note: string; tone: string }) {
  return <article className="metric-card panel"><div className={`metric-icon ${tone}`}>{icon}</div><div><span>{label}</span><strong>{value}<small>{unit}</small></strong><p>{note}</p></div></article>;
}

function Output({ icon, label, active, detail }: { icon: React.ReactNode; label: string; active?: boolean; detail: string }) {
  return <div className="output-row"><div className={`output-icon ${active ? 'active' : ''}`}>{icon}</div><div><strong>{label}</strong><span>{detail}</span></div><b className={active ? 'on' : ''}>{active ? 'ON' : 'OFF'}</b></div>;
}

function number(value: unknown, digits: number): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString('vi-VN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
}

function turnText(state: number | undefined): string {
  return ({ 0: 'Đang dừng', 1: 'Đang đảo trái', 2: 'Đang đảo phải', 3: 'Đang chờ', 4: 'Có lỗi hành trình' } as Record<number, string>)[Number(state)] || 'Chưa có dữ liệu';
}
