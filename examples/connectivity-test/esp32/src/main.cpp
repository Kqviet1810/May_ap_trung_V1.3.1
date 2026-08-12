#include <Arduino.h>
#include <ArduinoJson.h>
#include <MQTT.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <cmath>
#include <ctime>
#include "secrets.h"

namespace {
constexpr size_t MAX_INBOUND_BYTES = 8192;
constexpr size_t INBOUND_QUEUE_SIZE = 4;
constexpr uint32_t SNAPSHOT_INTERVAL_MS = 2000;
constexpr uint32_t RECONNECT_INTERVAL_MS = 5000;
constexpr uint32_t WIFI_SWITCH_DELAY_MS = 700;
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 20000;

struct MachineConfig {
  float targetTemp = 37.5F;
  float tempHysteresis = 0.2F;
  float lowTempAlarm = 36.0F;
  float highTempAlarm = 38.5F;
  float emergencyTemp = 40.0F;
  float kp = 18.0F;
  float ki = 0.8F;
  float kd = 35.0F;
  float lowHumidityAlarm = 40.0F;
  float ventOnTemp = 38.0F;
  float ventOffTemp = 37.6F;
  float tempOffset = 0.0F;
  float humidityOffset = 0.0F;
  uint32_t pidCycleSec = 2;
  uint32_t humidityAlarmDelaySec = 120;
  uint32_t turnIntervalMin = 120;
  uint32_t turnMaxRunSec = 20;
  uint32_t powerRestoreDelaySec = 10;
  uint32_t sensorTimeoutSec = 10;
  float maxHeaterPower = 100.0F;
  uint32_t totalIncubationDays = 21;
  bool circulationFanEnabled = true;
  bool turningEnabled = true;
  bool allowHeatWithoutBatch = false;
  bool alarmEnabled = true;
  int controlMode = 1;
  int nextDirection = 1;
};

MachineConfig config;
WiFiClient plainNetwork;
WiFiClientSecure secureNetwork;
Client* network = nullptr;
MQTTClient mqtt(4096);
Preferences preferences;

String topicPresence;
String topicSnapshot;
String topicConfigReported;
String topicAck;
String topicLog;
String topicCommand;
String topicConfigSet;
String topicWifiSet;
String topicSession;

String activeWifiSsid;
String activeWifiPassword;
uint32_t lastWifiConnectAttemptAt = 0;

struct PendingWifiChange {
  bool active = false;
  uint32_t applyAt = 0;
  uint64_t sequence = 0;
  String requestId;
  String ssid;
  String password;
};
PendingWifiChange pendingWifi;
uint64_t lastWifiSequence = 0;
bool wifiResultPending = false;
String wifiResultRequestId;
String wifiResult;
String wifiResultMessage;

uint32_t bootId = 0;
uint32_t configRevision = 1;
uint64_t lastCommandSequence = 0;
uint32_t logSequence = 0;
uint32_t lastSnapshotAt = 0;
uint32_t lastConnectAttemptAt = 0;
bool batchRunning = false;
uint32_t batchStartedAt = 0;
int autoTuneState = 0;

struct InboundMessage {
  String topic;
  String payload;
};
InboundMessage inboundQueue[INBOUND_QUEUE_SIZE];
size_t inboundHead = 0;
size_t inboundTail = 0;
size_t inboundCount = 0;

void publishPresence(bool online, const char* reason);
void publishSnapshot();
void publishConfig();
void publishLog(int code);
void publishAck(const char* requestId, const char* result, const char* message);
void queueMqttMessage(String& topic, String& payload);
void processOneMessage();
void applyPendingWifi();

String baseTopic() {
  return String(TOPIC_ROOT) + "/" + DEVICE_ID;
}

bool epochIsValid() {
  return time(nullptr) > 1700000000;
}

uint32_t epochNow() {
  return epochIsValid() ? static_cast<uint32_t>(time(nullptr)) : 0;
}

bool publishJson(const String& topic, JsonDocument& document, bool retained, int qos) {
  String payload;
  serializeJson(document, payload);
  const bool ok = mqtt.publish(topic, payload, retained, qos);
  if (!ok) Serial.printf("Publish thất bại: %s\n", topic.c_str());
  return ok;
}

void buildTopics() {
  const String base = baseTopic();
  topicPresence = base + "/presence";
  topicSnapshot = base + "/snapshot";
  topicConfigReported = base + "/config/reported";
  topicAck = base + "/ack";
  topicLog = base + "/log";
  topicCommand = base + "/command";
  topicConfigSet = base + "/config/set";
  topicWifiSet = base + "/wifi/set";
  topicSession = base + "/session";
}

bool connectToWifi(const String& ssid, const String& password, uint32_t timeoutMs) {
  if (ssid.isEmpty()) return false;
  Serial.printf("Kết nối Wi-Fi %s", ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(ssid.c_str(), password.c_str());
  const uint32_t startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < timeoutMs) {
    delay(300);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("Wi-Fi OK, IP: %s\n", WiFi.localIP().toString().c_str());
    return true;
  }
  Serial.println("Wi-Fi chưa kết nối.");
  return false;
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED || activeWifiSsid.isEmpty()) return;
  if (millis() - lastWifiConnectAttemptAt < RECONNECT_INTERVAL_MS) return;
  lastWifiConnectAttemptAt = millis();
  connectToWifi(activeWifiSsid, activeWifiPassword, WIFI_CONNECT_TIMEOUT_MS);
}

void configureNetwork() {
  if (MQTT_USE_TLS) {
    if (strlen(MQTT_ROOT_CA) < 64) {
      Serial.println("MQTT_USE_TLS=true nhưng chưa có MQTT_ROOT_CA hợp lệ.");
      while (true) delay(1000);
    }
    secureNetwork.setCACert(MQTT_ROOT_CA);
    network = &secureNetwork;
  } else {
    network = &plainNetwork;
  }
  mqtt.begin(MQTT_HOST, MQTT_PORT, *network);
  mqtt.onMessage(queueMqttMessage);
  mqtt.setKeepAlive(30);
  mqtt.setTimeout(5000);
}

void connectMqtt() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  if (millis() - lastConnectAttemptAt < RECONNECT_INTERVAL_MS) return;
  lastConnectAttemptAt = millis();

  const String clientId = String("esp32-") + DEVICE_ID + "-" + String(bootId, HEX);
  const String offlinePayload = String("{\"online\":false,\"reason\":\"connection_lost\",\"firmware\":\"transport-test/1.0.0\"}");
  mqtt.clearWill();
  mqtt.setWill(topicPresence.c_str(), offlinePayload.c_str(), true, 1);

  Serial.printf("Kết nối MQTT %s:%u...\n", MQTT_HOST, MQTT_PORT);
  if (!mqtt.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)) {
    Serial.printf("MQTT chưa kết nối, mã lỗi: %d\n", static_cast<int>(mqtt.lastError()));
    return;
  }

  mqtt.subscribe(topicCommand, 1);
  mqtt.subscribe(topicConfigSet, 1);
  mqtt.subscribe(topicWifiSet, 1);
  mqtt.subscribe(topicSession, 0);
  publishPresence(true, "connected");
  publishConfig();
  publishSnapshot();
  publishLog(1);
  if (wifiResultPending) {
    publishAck(wifiResultRequestId.c_str(), wifiResult.c_str(), wifiResultMessage.c_str());
    wifiResultPending = false;
    wifiResultRequestId = "";
    wifiResult = "";
    wifiResultMessage = "";
  }
  Serial.println("MQTT đã kết nối và subscribe đầy đủ.");
}

void publishPresence(bool online, const char* reason) {
  JsonDocument document;
  document["online"] = online;
  document["ssid"] = WiFi.SSID();
  document["firmware"] = "transport-test/1.0.0";
  document["ip"] = WiFi.localIP().toString();
  document["reason"] = reason;
  publishJson(topicPresence, document, true, 1);
}

void writeConfig(JsonObject target, const MachineConfig& value) {
  target["targetTemp"] = value.targetTemp;
  target["tempHysteresis"] = value.tempHysteresis;
  target["lowTempAlarm"] = value.lowTempAlarm;
  target["highTempAlarm"] = value.highTempAlarm;
  target["emergencyTemp"] = value.emergencyTemp;
  target["kp"] = value.kp;
  target["ki"] = value.ki;
  target["kd"] = value.kd;
  target["lowHumidityAlarm"] = value.lowHumidityAlarm;
  target["ventOnTemp"] = value.ventOnTemp;
  target["ventOffTemp"] = value.ventOffTemp;
  target["tempOffset"] = value.tempOffset;
  target["humidityOffset"] = value.humidityOffset;
  target["pidCycleSec"] = value.pidCycleSec;
  target["humidityAlarmDelaySec"] = value.humidityAlarmDelaySec;
  target["turnIntervalMin"] = value.turnIntervalMin;
  target["turnMaxRunSec"] = value.turnMaxRunSec;
  target["powerRestoreDelaySec"] = value.powerRestoreDelaySec;
  target["sensorTimeoutSec"] = value.sensorTimeoutSec;
  target["maxHeaterPower"] = value.maxHeaterPower;
  target["totalIncubationDays"] = value.totalIncubationDays;
  target["circulationFanEnabled"] = value.circulationFanEnabled;
  target["turningEnabled"] = value.turningEnabled;
  target["allowHeatWithoutBatch"] = value.allowHeatWithoutBatch;
  target["alarmEnabled"] = value.alarmEnabled;
  target["controlMode"] = value.controlMode;
  target["nextDirection"] = value.nextDirection;
}

void publishConfig() {
  JsonDocument document;
  document["bootId"] = bootId;
  document["revision"] = configRevision;
  writeConfig(document["config"].to<JsonObject>(), config);
  publishJson(topicConfigReported, document, true, 1);
}

bool readRealSensors(float& temperature, float& humidity) {
  // Thay phần thân bằng driver SHT31/DHT22/DS18B20 thật. Chỉ trả true khi cả hai giá trị hợp lệ.
  (void)temperature;
  (void)humidity;
  return false;
}

bool readSensors(float& temperature, float& humidity) {
  if (TRANSPORT_TEST_MODE) {
    const float phase = static_cast<float>(millis() % 120000UL) / 120000.0F * 2.0F * PI;
    temperature = config.targetTemp + sinf(phase) * 0.25F;
    humidity = 58.0F + cosf(phase * 0.7F) * 2.0F;
    return true;
  }
  return readRealSensors(temperature, humidity);
}

void publishSnapshot() {
  float temperature = NAN;
  float humidity = NAN;
  if (!readSensors(temperature, humidity) || !isfinite(temperature) || !isfinite(humidity)) return;

  const float measuredTemp = temperature + config.tempOffset;
  const float measuredHumidity = humidity + config.humidityOffset;
  const bool heaterOn = batchRunning && measuredTemp < config.targetTemp;
  const uint32_t elapsedDays = batchRunning ? (millis() - batchStartedAt) / 86400000UL : 0;

  JsonDocument document;
  document["bootId"] = bootId;
  document["revision"] = configRevision;
  JsonObject runtime = document["runtime"].to<JsonObject>();
  runtime["temperature"] = measuredTemp;
  runtime["humidity"] = measuredHumidity;
  runtime["heaterOn"] = heaterOn;
  runtime["heaterPower"] = heaterOn ? min(config.maxHeaterPower, 70.0F) : 0.0F;
  runtime["circulationFanOn"] = config.circulationFanEnabled && batchRunning;
  runtime["ventFanOn"] = measuredTemp >= config.ventOnTemp;
  runtime["turnState"] = 0;
  runtime["batchRunning"] = batchRunning;
  runtime["currentDay"] = batchRunning ? min(elapsedDays + 1, config.totalIncubationDays) : 0;
  runtime["nextTurnMinutes"] = config.turnIntervalMin;
  runtime["machineState"] = batchRunning ? "running" : "idle";
  runtime["autoTuneState"] = autoTuneState;
  runtime["autoTuneProgress"] = 0;
  publishJson(topicSnapshot, document, false, 0);
}

void publishAck(const char* requestId, const char* result, const char* message) {
  JsonDocument document;
  document["bootId"] = bootId;
  document["requestId"] = requestId;
  document["result"] = result;
  document["message"] = message;
  publishJson(topicAck, document, false, 1);
}

void publishLog(int code) {
  JsonDocument document;
  document["code"] = code;
  document["sequence"] = ++logSequence;
  document["epoch"] = epochNow();
  publishJson(topicLog, document, false, 1);
}

bool validConfig(const MachineConfig& value) {
  return value.targetTemp >= 30.0F && value.targetTemp <= 40.0F &&
    value.lowTempAlarm < value.targetTemp && value.targetTemp < value.highTempAlarm &&
    value.highTempAlarm < value.emergencyTemp && value.ventOffTemp < value.ventOnTemp &&
    value.turnIntervalMin >= 15 && value.turnIntervalMin <= 720 &&
    value.totalIncubationDays >= 1 && value.totalIncubationDays <= 40;
}

void applyConfig(JsonObjectConst source, MachineConfig& target) {
#define APPLY_VALUE(field) if (!source[#field].isNull()) target.field = source[#field].as<decltype(target.field)>()
  APPLY_VALUE(targetTemp); APPLY_VALUE(tempHysteresis); APPLY_VALUE(lowTempAlarm); APPLY_VALUE(highTempAlarm);
  APPLY_VALUE(emergencyTemp); APPLY_VALUE(kp); APPLY_VALUE(ki); APPLY_VALUE(kd); APPLY_VALUE(lowHumidityAlarm);
  APPLY_VALUE(ventOnTemp); APPLY_VALUE(ventOffTemp); APPLY_VALUE(tempOffset); APPLY_VALUE(humidityOffset);
  APPLY_VALUE(pidCycleSec); APPLY_VALUE(humidityAlarmDelaySec); APPLY_VALUE(turnIntervalMin); APPLY_VALUE(turnMaxRunSec);
  APPLY_VALUE(powerRestoreDelaySec); APPLY_VALUE(sensorTimeoutSec); APPLY_VALUE(maxHeaterPower); APPLY_VALUE(totalIncubationDays);
  APPLY_VALUE(circulationFanEnabled); APPLY_VALUE(turningEnabled);
  APPLY_VALUE(allowHeatWithoutBatch); APPLY_VALUE(alarmEnabled); APPLY_VALUE(controlMode); APPLY_VALUE(nextDirection);
#undef APPLY_VALUE
}

void handleConfig(JsonDocument& document) {
  const char* requestId = document["requestId"] | "";
  const uint32_t revision = document["revision"] | 0;
  if (strlen(requestId) < 4 || !document["config"].is<JsonObjectConst>()) {
    return publishAck(requestId, "invalid", "Payload cấu hình thiếu trường bắt buộc");
  }
  if (revision <= configRevision) return publishAck(requestId, "duplicate", "Revision đã được xử lý");

  MachineConfig next = config;
  applyConfig(document["config"].as<JsonObjectConst>(), next);
  if (!validConfig(next)) return publishAck(requestId, "invalid", "Cấu hình nằm ngoài giới hạn an toàn");

  config = next;
  configRevision = revision;
  // TODO production: ghi config vào NVS/Preferences theo cơ chế hai bản + CRC.
  publishAck(requestId, "applied", "Đã áp dụng cấu hình");
  publishConfig();
  publishLog(50);
}

void handleWifi(JsonDocument& document) {
  const char* requestId = document["requestId"] | "";
  const char* ssid = document["ssid"] | "";
  const char* password = document["password"] | "";
  const uint32_t requestedBootId = document["bootId"] | 0;
  const uint64_t sequence = document["sequence"] | 0;
  const uint32_t expiresAt = document["expiresAt"] | 0;
  const size_t ssidLength = strlen(ssid);
  const size_t passwordLength = strlen(password);

  if (document["v"].as<int>() != 1 || strlen(requestId) < 4 || ssidLength == 0 || ssidLength > 32 || passwordLength < 8 || passwordLength > 63) {
    return publishAck(requestId, "invalid", "SSID hoặc mật khẩu Wi-Fi không hợp lệ");
  }
  if (requestedBootId != bootId) return publishAck(requestId, "stale", "bootId thuộc lần khởi động khác");
  if (sequence <= lastWifiSequence) return publishAck(requestId, "duplicate", "Yêu cầu Wi-Fi đã được xử lý");
  if (!epochIsValid()) return publishAck(requestId, "rejected", "ESP32 chưa đồng bộ thời gian");
  if (expiresAt < epochNow() || expiresAt > epochNow() + 60) return publishAck(requestId, "expired", "Yêu cầu Wi-Fi đã hết hạn");
  if (pendingWifi.active) return publishAck(requestId, "busy", "ESP32 đang thử một mạng Wi-Fi khác");

  lastWifiSequence = sequence;
  pendingWifi.active = true;
  pendingWifi.applyAt = millis() + WIFI_SWITCH_DELAY_MS;
  pendingWifi.sequence = sequence;
  pendingWifi.requestId = requestId;
  pendingWifi.ssid = ssid;
  pendingWifi.password = password;
  publishAck(requestId, "accepted", "Đã nhận cấu hình; thiết bị sắp chuyển Wi-Fi");
}

void applyPendingWifi() {
  if (!pendingWifi.active || static_cast<int32_t>(millis() - pendingWifi.applyAt) < 0) return;

  const String previousSsid = activeWifiSsid;
  const String previousPassword = activeWifiPassword;
  const String requestedSsid = pendingWifi.ssid;
  const String requestedPassword = pendingWifi.password;
  const String requestId = pendingWifi.requestId;

  pendingWifi.active = false;
  pendingWifi.requestId = "";
  pendingWifi.ssid = "";
  pendingWifi.password = "";

  mqtt.disconnect();
  WiFi.disconnect(true, false);
  delay(250);

  if (connectToWifi(requestedSsid, requestedPassword, WIFI_CONNECT_TIMEOUT_MS)) {
    activeWifiSsid = requestedSsid;
    activeWifiPassword = requestedPassword;
    preferences.putString("ssid", activeWifiSsid);
    preferences.putString("password", activeWifiPassword);
    wifiResult = "applied";
    wifiResultMessage = "Đã kết nối và lưu mạng Wi-Fi mới";
  } else {
    WiFi.disconnect(true, false);
    delay(250);
    activeWifiSsid = previousSsid;
    activeWifiPassword = previousPassword;
    connectToWifi(activeWifiSsid, activeWifiPassword, WIFI_CONNECT_TIMEOUT_MS);
    wifiResult = "rejected";
    wifiResultMessage = "Không vào được mạng mới; đã quay lại Wi-Fi cũ";
  }

  // Không ghi mật khẩu vào Serial/MQTT. Xóa các bản sao tạm ngay sau khi thử kết nối.
  wifiResultRequestId = requestId;
  wifiResultPending = true;
  lastConnectAttemptAt = 0;
  lastWifiConnectAttemptAt = millis();
}

void handleCommand(JsonDocument& document) {
  const char* requestId = document["requestId"] | "";
  const char* action = document["action"] | "";
  const uint32_t requestedBootId = document["bootId"] | 0;
  const uint64_t sequence = document["sequence"] | 0;
  const uint32_t expiresAt = document["expiresAt"] | 0;

  if (document["v"].as<int>() != 1 || strlen(requestId) < 4 || strlen(action) == 0) {
    return publishAck(requestId, "invalid", "Lệnh thiếu trường bắt buộc");
  }
  if (requestedBootId != bootId) return publishAck(requestId, "stale", "bootId thuộc lần khởi động khác");
  if (sequence <= lastCommandSequence) return publishAck(requestId, "duplicate", "Sequence đã được xử lý");
  if (!epochIsValid()) return publishAck(requestId, "rejected", "ESP32 chưa đồng bộ thời gian");
  if (expiresAt < epochNow() || expiresAt > epochNow() + 30) return publishAck(requestId, "expired", "Lệnh đã hết hạn hoặc clock sai");

  lastCommandSequence = sequence;
  if (strcmp(action, "batch_start") == 0) {
    if (batchRunning) return publishAck(requestId, "duplicate", "Mẻ đã chạy");
    batchRunning = true;
    batchStartedAt = millis();
    publishAck(requestId, "applied", "Đã bắt đầu mẻ");
    publishLog(20);
  } else if (strcmp(action, "batch_stop") == 0) {
    batchRunning = false;
    publishAck(requestId, "applied", "Đã dừng mẻ");
    publishLog(21);
  } else if (strcmp(action, "autotune_start") == 0) {
    if (batchRunning) return publishAck(requestId, "busy", "Không Auto Tune khi mẻ đang chạy");
    autoTuneState = 1;
    publishAck(requestId, "accepted", "Đã nhận yêu cầu Auto Tune");
  } else if (strcmp(action, "resume_yes") == 0) {
    batchRunning = true;
    batchStartedAt = millis();
    publishAck(requestId, "applied", "Đã tiếp tục mẻ");
  } else if (strcmp(action, "resume_no") == 0) {
    batchRunning = false;
    publishAck(requestId, "applied", "Đã hủy khôi phục mẻ");
  } else {
    publishAck(requestId, "unsupported", "Firmware chưa hỗ trợ action");
  }
  publishSnapshot();
}

void queueMqttMessage(String& topic, String& payload) {
  if (payload.length() > MAX_INBOUND_BYTES) {
    Serial.println("Bỏ payload vượt giới hạn.");
    return;
  }
  if (inboundCount >= INBOUND_QUEUE_SIZE) {
    Serial.println("Hàng đợi MQTT đầy; bỏ message mới.");
    return;
  }
  inboundQueue[inboundTail].topic = topic;
  inboundQueue[inboundTail].payload = payload;
  inboundTail = (inboundTail + 1) % INBOUND_QUEUE_SIZE;
  inboundCount += 1;
}

void processOneMessage() {
  if (inboundCount == 0) return;
  String topic = inboundQueue[inboundHead].topic;
  String payload = inboundQueue[inboundHead].payload;
  inboundQueue[inboundHead].topic = "";
  inboundQueue[inboundHead].payload = "";
  inboundHead = (inboundHead + 1) % INBOUND_QUEUE_SIZE;
  inboundCount -= 1;

  JsonDocument document;
  const DeserializationError error = deserializeJson(document, payload);
  if (error) {
    Serial.printf("JSON không hợp lệ: %s\n", error.c_str());
    return;
  }
  if (topic == topicCommand) handleCommand(document);
  else if (topic == topicConfigSet) handleConfig(document);
  else if (topic == topicWifiSet) handleWifi(document);
  else if (topic == topicSession && document["sync"].as<bool>()) {
    publishPresence(true, "sync");
    publishConfig();
    publishSnapshot();
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(400);
  bootId = esp_random();
  if (bootId == 0) bootId = 1;
  preferences.begin("mayap-net", false);
  activeWifiSsid = preferences.getString("ssid", WIFI_SSID);
  activeWifiPassword = preferences.getString("password", WIFI_PASSWORD);
  buildTopics();
  connectToWifi(activeWifiSsid, activeWifiPassword, WIFI_CONNECT_TIMEOUT_MS);
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  configureNetwork();
  connectMqtt();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  connectMqtt();
  mqtt.loop();
  processOneMessage();
  applyPendingWifi();

  if (mqtt.connected() && millis() - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
    lastSnapshotAt = millis();
    publishSnapshot();
  }
  delay(5);
}
