export type AppPage = 'overview' | 'batch' | 'alerts' | 'settings';

export type ConnectionPhase =
  | 'unconfigured'
  | 'authorizing'
  | 'connecting'
  | 'connected'
  | 'offline'
  | 'unauthorized'
  | 'error';

export interface RuntimeConfig {
  environment: 'production' | 'staging' | 'unconfigured';
  apiBaseUrl: string;
  sessionEndpoint: string;
  pairingEndpoint: string;
  loginUrl: string;
  supportUrl: string;
  topicRoot: string;
  staleAfterMs: number;
}

export interface MayapUser {
  id: string;
  name: string;
  role: 'owner' | 'operator' | 'viewer';
}

export interface DeviceSummary {
  id: string;
  name: string;
  location?: string;
  model?: string;
}

export interface BatchPlan {
  name: string;
  startDate: string;
  totalDays: number;
  targetTemp: number;
  targetHumidity: number;
  autoResumeAfterPower: boolean;
}

export interface MqttSession {
  user: MayapUser;
  devices: DeviceSummary[];
  mqtt: {
    url: string;
    clientId: string;
    username: string;
    password: string;
    expiresAt: string;
  };
}

export interface MachineConfig {
  targetTemp: number;
  tempHysteresis: number;
  lowTempAlarm: number;
  highTempAlarm: number;
  emergencyTemp: number;
  kp: number;
  ki: number;
  kd: number;
  lowHumidityAlarm: number;
  ventOnTemp: number;
  ventOffTemp: number;
  tempOffset: number;
  humidityOffset: number;
  pidCycleSec: number;
  humidityAlarmDelaySec: number;
  turnIntervalMin: number;
  turnMaxRunSec: number;
  powerRestoreDelaySec: number;
  sensorTimeoutSec: number;
  maxHeaterPower: number;
  totalIncubationDays: number;
  circulationFanEnabled: boolean;
  turningEnabled: boolean;
  autoResumeAfterPower: boolean;
  allowHeatWithoutBatch: boolean;
  alarmEnabled: boolean;
  controlMode: number;
  nextDirection: number;
}

export interface RuntimeSnapshot {
  temperature: number;
  humidity: number;
  heaterOn: boolean;
  heaterPower: number;
  circulationFanOn: boolean;
  ventFanOn: boolean;
  turnState: number;
  batchRunning: boolean;
  currentDay: number;
  nextTurnMinutes: number;
  machineState: string;
  autoTuneState: number;
  autoTuneProgress: number;
  resumeConfirmationRequired?: boolean;
}

export interface SnapshotMessage {
  bootId: number;
  revision: number;
  runtime: RuntimeSnapshot;
}

export interface PresenceMessage {
  online: boolean;
  ssid?: string;
  firmware?: string;
  ip?: string;
  reason?: string;
}

export interface WifiCredentials {
  ssid: string;
  password: string;
}

export interface ConfigReport {
  bootId: number;
  revision: number;
  config: MachineConfig;
}

export interface AckMessage {
  bootId?: number;
  requestId: string;
  result: 'accepted' | 'applied' | 'rejected' | 'invalid' | 'duplicate' | 'busy' | 'expired' | 'stale' | 'unsupported';
  message?: string;
}

export interface DeviceLog {
  id: string;
  at: number;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  code?: number;
}

export interface TelemetryPoint {
  at: number;
  temperature: number;
  humidity: number;
}

export interface DeviceRuntimeState {
  summary: DeviceSummary;
  presence: PresenceMessage | null;
  presenceAt: number;
  snapshot: SnapshotMessage | null;
  snapshotAt: number;
  config: ConfigReport | null;
  configAt: number;
  logs: DeviceLog[];
  telemetry: TelemetryPoint[];
  commandSequence: number;
}

export type CommandAction =
  | 'batch_start'
  | 'batch_stop'
  | 'autotune_start'
  | 'resume_yes'
  | 'resume_no';

export interface GatewayStatus {
  phase: ConnectionPhase;
  message: string;
}

export interface GatewayHandlers {
  onSession: (session: MqttSession) => void;
  onStatus: (status: GatewayStatus) => void;
  onPresence: (deviceId: string, payload: PresenceMessage) => void;
  onSnapshot: (deviceId: string, payload: SnapshotMessage) => void;
  onConfig: (deviceId: string, payload: ConfigReport) => void;
  onAck: (deviceId: string, payload: AckMessage) => void;
  onLog: (deviceId: string, payload: unknown) => void;
}
