import { useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, CircleStop, Clock3, Egg, Play, Save, ShieldCheck } from 'lucide-react';
import type { BatchPlan, CommandAction, DeviceRuntimeState, MachineConfig, RuntimeConfig } from '../types';
import { saveBatchPlan } from '../lib/api';

interface BatchPageProps {
  config: RuntimeConfig;
  device: DeviceRuntimeState | null;
  online: boolean;
  canControl: boolean;
  onSendConfig: (config: MachineConfig) => Promise<void>;
  onRequestCommand: (action: CommandAction, title: string, message: string, danger?: boolean) => void;
  onNotice: (message: string) => void;
}

export function BatchPage({ config, device, online, canControl, onSendConfig, onRequestCommand, onNotice }: BatchPageProps) {
  const machineConfig = device?.config?.config;
  const running = Boolean(device?.snapshot?.runtime.batchRunning);
  const [plan, setPlan] = useState<BatchPlan>(() => initialPlan());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!machineConfig) return;
    setPlan((current) => ({
      ...current,
      totalDays: machineConfig.totalIncubationDays,
      targetTemp: machineConfig.targetTemp,
      // Firmware thuong mai luon yeu cau xac nhan sau POWERON/BROWNOUT.
      autoResumeAfterPower: false
    }));
  }, [machineConfig]);

  const update = <K extends keyof BatchPlan>(key: K, value: BatchPlan[K]) => setPlan((current) => ({ ...current, [key]: value }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!device || !machineConfig) return;
    if (!(plan.targetTemp >= 30 && plan.targetTemp <= 40)) return onNotice('Nhiệt độ phải từ 30,0 đến 40,0°C');
    if (!(plan.totalDays >= 1 && plan.totalDays <= 40)) return onNotice('Thời gian ấp phải từ 1 đến 40 ngày');
    setBusy(true);
    try {
      await saveBatchPlan(config, device.summary.id, plan);
      await onSendConfig({
        ...machineConfig,
        targetTemp: plan.targetTemp,
        totalIncubationDays: plan.totalDays
      });
      onNotice('Kế hoạch mẻ đã lưu. Đang chờ ESP32 xác nhận cấu hình…');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Không thể lưu kế hoạch mẻ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="batch-layout">
      <section className="panel batch-plan-card">
        <div className="section-heading">
          <div><span className="eyebrow">KẾ HOẠCH MẺ ẤP</span><h2>Cấu hình vận hành</h2></div>
          <span className={`status-badge ${running ? 'online' : 'neutral'}`}><i />{running ? `Đang chạy · ngày ${device?.snapshot?.runtime.currentDay || 1}` : 'Chưa bắt đầu'}</span>
        </div>
        <form className="batch-form" onSubmit={save}>
          <label className="wide"><span>Tên mẻ ấp</span><input value={plan.name} onChange={(event) => update('name', event.target.value)} maxLength={48} disabled={!canControl} required /></label>
          <label><span>Ngày bắt đầu</span><input type="date" value={plan.startDate} onChange={(event) => update('startDate', event.target.value)} disabled={!canControl} required /></label>
          <label><span>Tổng thời gian</span><div className="input-unit"><input type="number" min="1" max="40" value={plan.totalDays} onChange={(event) => update('totalDays', Number(event.target.value))} disabled={!canControl} /><b>ngày</b></div></label>
          <label><span>Nhiệt độ mục tiêu</span><div className="input-unit"><input type="number" min="30" max="40" step="0.1" value={plan.targetTemp} onChange={(event) => update('targetTemp', Number(event.target.value))} disabled={!canControl} /><b>°C</b></div></label>
          <label><span>Độ ẩm mục tiêu</span><div className="input-unit"><input type="number" min="20" max="95" value={plan.targetHumidity} onChange={(event) => update('targetHumidity', Number(event.target.value))} disabled={!canControl} /><b>%RH</b></div></label>
          <div className="toggle-field wide fixed-safety-policy">
            <div><span>Khôi phục an toàn sau mất điện</span><small>Chính sách cố định: mất điện hoặc sụt áp luôn yêu cầu người vận hành xác nhận trên HMI hoặc website.</small></div>
            <ShieldCheck size={22} aria-hidden="true" />
          </div>
          <div className="batch-actions wide">
            <button className="button secondary" type="submit" disabled={!canControl || !machineConfig || busy}><Save size={17} />{busy ? 'Đang lưu…' : 'Lưu kế hoạch'}</button>
            <button
              className={`button ${running ? 'danger' : 'primary'}`}
              type="button"
              disabled={!canControl || !online || !machineConfig || busy}
              onClick={() => onRequestCommand(
                running ? 'batch_stop' : 'batch_start',
                running ? 'Kết thúc mẻ ấp?' : 'Bắt đầu mẻ ấp?',
                running
                  ? 'ESP32 sẽ dừng gia nhiệt và cơ cấu đảo theo trình tự an toàn. Thao tác này được ghi vào nhật ký.'
                  : `Mẻ “${plan.name}” sẽ bắt đầu với nhiệt độ ${plan.targetTemp.toLocaleString('vi-VN')}°C trong ${plan.totalDays} ngày.`,
                running
              )}
            >
              {running ? <CircleStop size={17} /> : <Play size={17} />}
              {running ? 'Kết thúc mẻ' : 'Bắt đầu mẻ'}
            </button>
          </div>
        </form>
      </section>

      <aside className="batch-side">
        <section className="panel progress-card">
          <div className="progress-visual"><Egg size={34} /><span>{running ? `${device?.snapshot?.runtime.currentDay || 1}/${plan.totalDays}` : '—'}</span></div>
          <h3>{running ? 'Mẻ đang được kiểm soát' : 'Sẵn sàng khi thiết bị online'}</h3>
          <p>{running ? 'Tiến độ dựa trên ngày hiện tại do ESP32 báo về.' : 'Lưu kế hoạch trước khi bắt đầu để đồng bộ đầy đủ.'}</p>
          <div className="progress-line"><i style={{ width: running ? `${Math.min(100, ((device?.snapshot?.runtime.currentDay || 1) / plan.totalDays) * 100)}%` : '0%' }} /></div>
        </section>
        <section className="panel safety-card">
          <div className="section-heading"><div><span className="eyebrow">TRÌNH TỰ AN TOÀN</span><h2>Trước khi bắt đầu</h2></div><ShieldCheck size={21} /></div>
          <SafetyItem icon={<CheckCircle2 />} title="Cấu hình đã được xác nhận" done={Boolean(machineConfig)} />
          <SafetyItem icon={<Clock3 />} title="Thời gian và ngày bắt đầu hợp lệ" done={Boolean(plan.startDate && plan.totalDays)} />
          <SafetyItem icon={<CalendarDays />} title="Thiết bị đang trực tuyến" done={online} />
        </section>
      </aside>
    </div>
  );
}

function SafetyItem({ icon, title, done }: { icon: React.ReactNode; title: string; done: boolean }) {
  return <div className={`safety-item ${done ? 'done' : ''}`}><span>{icon}</span><strong>{title}</strong><b>{done ? 'Đạt' : 'Chờ'}</b></div>;
}

function initialPlan(): BatchPlan {
  return {
    name: '',
    startDate: new Date().toISOString().slice(0, 10),
    totalDays: 21,
    targetTemp: 37.5,
    targetHumidity: 58,
    autoResumeAfterPower: false
  };
}
