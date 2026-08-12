import type { TelemetryPoint } from '../types';

interface TelemetryChartProps {
  points: TelemetryPoint[];
}

export function TelemetryChart({ points }: TelemetryChartProps) {
  if (points.length < 2) {
    return (
      <div className="chart-empty" role="status">
        <div className="chart-grid" aria-hidden="true" />
        <strong>Đang chờ dữ liệu thời gian thực</strong>
        <span>Biểu đồ sẽ bắt đầu sau khi nhận ít nhất hai bản tin snapshot.</span>
      </div>
    );
  }

  const recent = points.slice(-60);
  const width = 720;
  const height = 220;
  const padding = 18;
  const temperatures = recent.map((point) => point.temperature);
  const min = Math.min(...temperatures, 34);
  const max = Math.max(...temperatures, 40);
  const span = Math.max(1, max - min);
  const path = recent.map((point, index) => {
    const x = padding + (index / Math.max(1, recent.length - 1)) * (width - padding * 2);
    const y = height - padding - ((point.temperature - min) / span) * (height - padding * 2);
    return `${index ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Biểu đồ nhiệt độ thời gian thực">
        <defs>
          <linearGradient id="temperature-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1b8d77" stopOpacity="0.22" />
            <stop offset="1" stopColor="#1b8d77" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line key={ratio} x1="18" x2="702" y1={height * ratio} y2={height * ratio} className="chart-line" />
        ))}
        <path d={`${path} L ${width - padding} ${height - padding} L ${padding} ${height - padding} Z`} fill="url(#temperature-fill)" />
        <path d={path} className="chart-path" />
        <circle
          cx={width - padding}
          cy={height - padding - ((recent.at(-1)!.temperature - min) / span) * (height - padding * 2)}
          r="5"
          className="chart-dot"
        />
      </svg>
      <div className="chart-axis" aria-hidden="true">
        <span>{new Date(recent[0]!.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
        <span>Thời gian thực</span>
        <span>{new Date(recent.at(-1)!.at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
}
