import { AlertCircle, BellRing, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import type { DeviceLog, DeviceRuntimeState } from '../types';

export function AlertsPage({ device }: { device: DeviceRuntimeState | null }) {
  const logs = device?.logs ?? [];
  const critical = logs.filter((log) => log.severity === 'critical').length;
  const warning = logs.filter((log) => log.severity === 'warning').length;
  return (
    <div className="page-stack">
      <div className="alert-summary-grid">
        <Summary icon={<ShieldAlert />} label="Nghiêm trọng" value={critical} tone="critical" />
        <Summary icon={<AlertCircle />} label="Cần chú ý" value={warning} tone="warning" />
        <Summary icon={<CheckCircle2 />} label="Thông tin" value={logs.length - critical - warning} tone="info" />
      </div>
      <section className="panel log-card">
        <div className="section-heading">
          <div><span className="eyebrow">NHẬT KÝ THIẾT BỊ</span><h2>Sự kiện và cảnh báo</h2></div>
          <span className="safe-note">Lưu trữ chính thức cần thực hiện tại backend</span>
        </div>
        {!logs.length ? (
          <div className="empty-list"><BellRing size={30} /><strong>Chưa nhận được sự kiện</strong><span>Cảnh báo thật từ ESP32 sẽ xuất hiện tại đây.</span></div>
        ) : (
          <div className="log-list">{logs.map((log) => <LogRow key={log.id} log={log} />)}</div>
        )}
      </section>
    </div>
  );
}

function Summary({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: string }) {
  return <article className={`alert-summary ${tone}`}><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></article>;
}

function LogRow({ log }: { log: DeviceLog }) {
  const Icon = log.severity === 'critical' ? ShieldAlert : log.severity === 'warning' ? AlertCircle : Info;
  return (
    <article className={`log-row ${log.severity}`}>
      <span className="log-icon"><Icon size={18} /></span>
      <div><strong>{log.title}</strong><p>{log.detail}</p></div>
      <time dateTime={new Date(log.at).toISOString()}>{new Date(log.at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
    </article>
  );
}
