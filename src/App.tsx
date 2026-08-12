import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  ChevronDown,
  CircleAlert,
  CloudOff,
  Egg,
  Gauge,
  LayoutDashboard,
  LogIn,
  Menu,
  Plus,
  Settings,
  ShieldCheck,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import type { AppPage, CommandAction, RuntimeConfig } from './types';
import { loadRuntimeConfig } from './lib/config';
import { useMayapController } from './useMayapController';
import { OverviewPage } from './components/OverviewPage';
import { BatchPage } from './components/BatchPage';
import { AlertsPage } from './components/AlertsPage';
import { SettingsPage } from './components/SettingsPage';
import { ConfirmDialog } from './components/ConfirmDialog';
import { PairDeviceDialog } from './components/PairDeviceDialog';

const NAV_ITEMS: Array<{ id: AppPage; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: 'Tổng quan', icon: <LayoutDashboard /> },
  { id: 'batch', label: 'Mẻ ấp', icon: <Egg /> },
  { id: 'alerts', label: 'Cảnh báo', icon: <Bell /> },
  { id: 'settings', label: 'Cài đặt', icon: <Settings /> }
];

interface PendingConfirm {
  action: CommandAction;
  title: string;
  message: string;
  danger: boolean;
}

export default function App() {
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [page, setPage] = useState<AppPage>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const controller = useMayapController(runtimeConfig);

  useEffect(() => { void loadRuntimeConfig().then(setRuntimeConfig); }, []);
  useEffect(() => {
    setSidebarOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [page]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [sidebarOpen]);

  const canControl = Boolean(
    controller.session &&
    controller.session.user.role !== 'viewer' &&
    controller.status.phase === 'connected' &&
    controller.isDeviceOnline
  );
  const criticalCount = controller.selectedDevice?.logs.filter((log) => log.severity === 'critical').length ?? 0;
  const title = NAV_ITEMS.find((item) => item.id === page)?.label ?? 'Tổng quan';
  const connectionLabel = useMemo(() => {
    if (controller.isDeviceOnline) return 'Thiết bị trực tuyến';
    if (controller.status.phase === 'connected') return 'Thiết bị ngoại tuyến';
    return controller.status.message;
  }, [controller.isDeviceOnline, controller.status]);

  const requestCommand = (action: CommandAction, modalTitle: string, message: string, danger = false) => {
    setConfirm({ action, title: modalTitle, message, danger });
  };

  const runCommand = async () => {
    if (!confirm) return;
    const pending = confirm;
    setConfirm(null);
    try {
      await controller.sendCommand(pending.action);
    } catch (error) {
      controller.showNotice(error instanceof Error ? error.message : 'Không thể gửi lệnh');
    }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">M<span /></div>
          <div><strong>MAYAP</strong><small>Control Center</small></div>
        </div>
        <div className="sidebar-label">VẬN HÀNH</div>
        <nav aria-label="Điều hướng chính">
          {NAV_ITEMS.map((item) => (
            <button key={item.id} type="button" className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)}>
              {item.icon}<span>{item.label}</span>{item.id === 'alerts' && criticalCount > 0 && <b>{criticalCount}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-card">
          <ShieldCheck size={20} />
          <strong>Kết nối bảo mật</strong>
          <p>Chỉ nhận thiết bị được backend cấp quyền.</p>
          <span><i className={controller.status.phase === 'connected' ? 'ok' : ''} />{controller.status.phase === 'connected' ? 'MQTT đã xác thực' : 'Đang chờ hệ thống'}</span>
        </div>
        <div className="sidebar-footer">
          <span className={`connection-dot ${controller.isDeviceOnline ? 'online' : ''}`} />
          <div><strong>{controller.selectedDevice?.summary.name || 'Chưa chọn thiết bị'}</strong><small>{connectionLabel}</small></div>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-backdrop" type="button" aria-label="Đóng menu" onClick={() => setSidebarOpen(false)} />}

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button menu-button" type="button" aria-label="Mở menu" onClick={() => setSidebarOpen(true)}><Menu /></button>
          <div className="page-title"><span>TRUNG TÂM VẬN HÀNH</span><h1>{title}</h1></div>
          <div className="topbar-actions">
            {controller.session?.devices.length ? (
              <label className="device-select">
                <Gauge size={17} />
                <select aria-label="Chọn thiết bị" value={controller.selectedId} onChange={(event) => controller.selectDevice(event.target.value)}>
                  {controller.session.devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
                </select>
                <ChevronDown size={16} />
              </label>
            ) : (
              <button className="button secondary compact" type="button" onClick={() => setPairingOpen(true)}><Plus size={17} /><span>Thêm thiết bị</span></button>
            )}
            <button className="notification-button" type="button" aria-label={criticalCount ? `${criticalCount} cảnh báo nghiêm trọng` : 'Không có cảnh báo nghiêm trọng'} onClick={() => setPage('alerts')}>
              <Bell size={19} />{criticalCount > 0 && <b>{criticalCount}</b>}
            </button>
            <div className="user-chip" title={controller.session?.user.name || 'Chưa đăng nhập'}>{initials(controller.session?.user.name)}</div>
          </div>
        </header>

        {!runtimeConfig ? (
          <div className="loading-screen"><span className="loader" /><strong>Đang tải MAYAP Control…</strong></div>
        ) : (
          <>
            {controller.status.phase === 'unconfigured' && (
              <div className="system-banner warning">
                <CircleAlert size={20} />
                <div><strong>Chưa hoàn tất cấu hình production</strong><span>Giao diện đang ở chế độ an toàn: không có dữ liệu giả và không thể gửi lệnh cho đến khi backend xác thực được cấu hình.</span></div>
                <button type="button" onClick={() => setPage('settings')}>Xem kiểm tra hệ thống</button>
              </div>
            )}
            {controller.status.phase === 'unauthorized' && (
              <div className="system-banner danger">
                <LogIn size={20} /><div><strong>Cần đăng nhập lại</strong><span>Phiên tài khoản đã hết hạn hoặc chưa được cấp quyền điều khiển.</span></div>
                {runtimeConfig.loginUrl && <a href={runtimeConfig.loginUrl}>Đăng nhập</a>}
              </div>
            )}
            {controller.status.phase === 'offline' && (
              <div className="system-banner muted"><CloudOff size={20} /><div><strong>Không có kết nối Internet</strong><span>Bạn vẫn có thể xem giao diện đã lưu, nhưng mọi thao tác điều khiển đều bị khóa.</span></div></div>
            )}

            <section className="page-content" aria-live="polite">
              {page === 'overview' && <OverviewPage device={controller.selectedDevice} online={controller.isDeviceOnline} canControl={canControl} onSaveQuick={controller.sendConfig} onOpenPairing={() => setPairingOpen(true)} />}
              {page === 'batch' && <BatchPage config={runtimeConfig} device={controller.selectedDevice} online={controller.isDeviceOnline} canControl={canControl} onSendConfig={controller.sendConfig} onRequestCommand={requestCommand} onNotice={controller.showNotice} />}
              {page === 'alerts' && <AlertsPage device={controller.selectedDevice} />}
              {page === 'settings' && <SettingsPage config={runtimeConfig} status={controller.status} user={controller.session?.user ?? null} device={controller.selectedDevice} online={controller.isDeviceOnline} canControl={canControl} onSendConfig={controller.sendConfig} onRequestCommand={requestCommand} onNotice={controller.showNotice} />}
            </section>
          </>
        )}
      </main>

      {controller.notice && <div className="toast" role="status"><Wifi size={18} /><span>{controller.notice}</span><button type="button" aria-label="Đóng thông báo" onClick={() => controller.showNotice('')}><X size={17} /></button></div>}

      {runtimeConfig && <PairDeviceDialog open={pairingOpen} config={runtimeConfig} onClose={() => setPairingOpen(false)} onPaired={() => controller.reconnect()} />}
      <ConfirmDialog open={Boolean(confirm)} title={confirm?.title || ''} message={confirm?.message || ''} confirmLabel={confirm?.danger ? 'Xác nhận dừng' : 'Xác nhận'} danger={confirm?.danger} onCancel={() => setConfirm(null)} onConfirm={() => void runCommand()} />
    </div>
  );
}

function initials(name?: string): string {
  if (!name) return 'M';
  return name.split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]).join('').toUpperCase();
}
