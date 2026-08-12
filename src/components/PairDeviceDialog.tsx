import { useState } from 'react';
import { Cpu, LoaderCircle, X } from 'lucide-react';
import type { RuntimeConfig } from '../types';
import { pairDevice } from '../lib/api';
import { isProductionConfigured } from '../lib/config';

interface PairDeviceDialogProps {
  open: boolean;
  config: RuntimeConfig;
  onClose: () => void;
  onPaired: () => void;
}

export function PairDeviceDialog({ open, config, onClose, onPaired }: PairDeviceDialogProps) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^[A-Z0-9-]{6,24}$/i.test(code.trim())) {
      setError('Mã ghép nối phải có từ 6 đến 24 ký tự.');
      return;
    }
    if (!name.trim()) {
      setError('Hãy nhập tên hiển thị cho thiết bị.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await pairDevice(config, code.trim().toUpperCase(), name.trim());
      onPaired();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể liên kết thiết bị.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal pairing-modal" role="dialog" aria-modal="true" aria-labelledby="pair-title">
        <button className="icon-button modal-close" type="button" aria-label="Đóng hộp thoại" onClick={onClose}><X size={20} /></button>
        <div className="modal-icon"><Cpu size={23} /></div>
        <span className="eyebrow">THÊM THIẾT BỊ</span>
        <h2 id="pair-title">Liên kết MAYAP của bạn</h2>
        <p>Mã ghép nối dùng một lần phải được cấp từ màn hình hoặc nhãn bảo mật trên thiết bị.</p>
        {isProductionConfigured(config) ? (
          <form onSubmit={submit} className="pair-form">
            <label>
              <span>Mã ghép nối</span>
              <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="VD: AP-7K4M-92QX" autoComplete="one-time-code" />
            </label>
            <label>
              <span>Tên hiển thị</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Máy ấp khu A" maxLength={40} />
            </label>
            {error && <div className="inline-error" role="alert">{error}</div>}
            <button className="button primary full" type="submit" disabled={busy}>
              {busy && <LoaderCircle className="spin" size={17} />}
              {busy ? 'Đang xác minh…' : 'Xác minh và liên kết'}
            </button>
          </form>
        ) : (
          <div className="setup-note">
            <strong>Chưa cấu hình dịch vụ ghép nối</strong>
            <span>Quản trị viên cần hoàn tất `config.json` và backend trước khi thêm thiết bị thật.</span>
          </div>
        )}
      </section>
    </div>
  );
}
