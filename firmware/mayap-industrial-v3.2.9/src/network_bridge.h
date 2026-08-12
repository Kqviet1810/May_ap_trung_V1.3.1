#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <MQTT.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_system.h>
#include <time.h>

#if __has_include("network_secrets.h")
#include "network_secrets.h"
#else
#error "Copy include/network_secrets.example.h to include/network_secrets.h and set unique device credentials"
#endif

namespace MayapNetwork {

constexpr uint8_t INBOUND_QUEUE_SIZE = 4U;
constexpr uint8_t RESULT_QUEUE_SIZE = 12U;
constexpr uint8_t PENDING_MAP_SIZE = 4U;
constexpr uint8_t REQUEST_ID_CACHE_SIZE = 8U;
constexpr size_t MQTT_PAYLOAD_SIZE = 4096U;
static_assert(sizeof(NETWORK_DEVICE_ID) == 17U,
              "NETWORK_DEVICE_ID must be MAP- plus 12 uppercase hex characters");
static_assert(sizeof(NETWORK_SETUP_AP_PASSWORD) >= 9U &&
              sizeof(NETWORK_SETUP_AP_PASSWORD) <= 64U,
              "NETWORK_SETUP_AP_PASSWORD must contain 8..63 characters");

struct InboundMessage {
  char topic[128]{};
  char payload[MQTT_PAYLOAD_SIZE]{};
};

struct ResultMessage {
  char requestId[64]{};
  char result[16]{};
  char message[96]{};
  uint32_t revision = 0U;
};

struct PendingRequest {
  bool used = false;
  uint32_t localId = 0U;
  uint32_t revision = 0U;
  char requestId[64]{};
};

struct WifiCredentialRecord {
  uint32_t magic = 0x4D41594EU;  // MAYN
  uint32_t generation = 0U;
  uint32_t checksum = 0U;
  char ssid[33]{};
  char password[64]{};
};

class NetworkBridge;
extern NetworkBridge Bridge;
void commandResultCallback(uint32_t commandId, bool ok, const char *message);
void configResultCallback(uint32_t transactionId, bool ok);
void eventSnapshotCallback(const HmiEventSnapshot &snapshot);

class NetworkBridge {
 public:
  void begin() {
    bootId_ = esp_random();
    if (!bootId_) bootId_ = 1U;
    snprintf(baseTopic_, sizeof(baseTopic_), "%s/%s", NETWORK_TOPIC_ROOT,
             NETWORK_DEVICE_ID);
    snprintf(topicPresence_, sizeof(topicPresence_), "%s/presence", baseTopic_);
    snprintf(topicSnapshot_, sizeof(topicSnapshot_), "%s/snapshot", baseTopic_);
    snprintf(topicConfigReported_, sizeof(topicConfigReported_),
             "%s/config/reported", baseTopic_);
    snprintf(topicAck_, sizeof(topicAck_), "%s/ack", baseTopic_);
    snprintf(topicLog_, sizeof(topicLog_), "%s/log", baseTopic_);
    snprintf(topicCommand_, sizeof(topicCommand_), "%s/command", baseTopic_);
    snprintf(topicConfigSet_, sizeof(topicConfigSet_), "%s/config/set", baseTopic_);
    snprintf(topicWifiSet_, sizeof(topicWifiSet_), "%s/wifi/set", baseTopic_);
    snprintf(topicSession_, sizeof(topicSession_), "%s/session", baseTopic_);

    loadWifiCredential();
    hmiSetExternalResultCallbacks(commandResultCallback, configResultCallback,
                                  eventSnapshotCallback);

    const bool forcePortal = digitalRead(PIN_ENCODER_SW) == LOW;
    if (forcePortal || activeSsid_.isEmpty()) startPortal();
    else startStation(activeSsid_, activePassword_);

    taskHandle_ = xTaskCreateStaticPinnedToCore(
        taskEntry, "mayap_network", sizeof(taskStack_), this, 1,
        taskStack_, &taskTcb_, 0);
    if (!taskHandle_) {
      mayapSerialPrintf(true, "[NET] Khong tao duoc network task\n");
    }
  }

  void setSnapshot(const MachineConfig &config, const MachineRuntime &runtime) {
    const uint32_t now = millis();
    if (now - lastSnapshotCopyAt_ < RUNTIME_TO_HMI_MS) return;
    lastSnapshotCopyAt_ = now;
    portENTER_CRITICAL(&snapshotMux_);
    snapshotConfig_ = config;
    snapshotRuntime_ = runtime;
    snapshotReady_ = true;
    portEXIT_CRITICAL(&snapshotMux_);
  }

  void onCommandResult(uint32_t localId, bool ok, const char *message) {
    portENTER_CRITICAL(&queueMux_);
    PendingRequest *pending = findPendingLocked(commandPending_, localId);
    if (pending) {
      pushResultLocked(pending->requestId, ok ? "applied" : "rejected",
                       message ? message : (ok ? "Da thuc hien" : "Bi tu choi"), 0U);
      pending->used = false;
    }
    portEXIT_CRITICAL(&queueMux_);
  }

  void onConfigResult(uint32_t localId, bool ok) {
    portENTER_CRITICAL(&queueMux_);
    PendingRequest *pending = findPendingLocked(configPending_, localId);
    if (pending) {
      pushResultLocked(pending->requestId, ok ? "applied" : "rejected",
                       ok ? "Da luu EEPROM va doc lai" : "Luu EEPROM that bai",
                       pending->revision);
      if (ok) configRevision_ = pending->revision;
      if (ok) configPublishPending_ = true;
      pending->used = false;
    }
    portEXIT_CRITICAL(&queueMux_);
  }

  void onEventSnapshot(const HmiEventSnapshot &snapshot) {
    portENTER_CRITICAL(&snapshotMux_);
    eventSnapshot_ = snapshot;
    eventSnapshotPending_ = true;
    portEXIT_CRITICAL(&snapshotMux_);
  }

 private:
  static void taskEntry(void *parameter) {
    static_cast<NetworkBridge *>(parameter)->run();
  }

  void run() {
    for (;;) {
      const uint32_t now = millis();
      servicePortal();
      serviceWifi(now);
      serviceMqtt(now);
      serviceInbound();
      serviceResults();
      serviceEvents();
      serviceWifiChange(now);
      publishPeriodic(now);
      vTaskDelay(pdMS_TO_TICKS(NETWORK_TASK_PERIOD_MS));
    }
  }

  static PendingRequest *findPendingLocked(PendingRequest (&items)[PENDING_MAP_SIZE],
                                           uint32_t localId) {
    for (auto &item : items) {
      if (item.used && item.localId == localId) return &item;
    }
    return nullptr;
  }

  static PendingRequest *freePendingLocked(PendingRequest (&items)[PENDING_MAP_SIZE]) {
    for (auto &item : items) if (!item.used) return &item;
    return nullptr;
  }

  void pushResultLocked(const char *requestId, const char *result,
                        const char *message, uint32_t revision) {
    if (resultCount_ >= RESULT_QUEUE_SIZE) return;
    ResultMessage &item = resultQueue_[resultTail_];
    snprintf(item.requestId, sizeof(item.requestId), "%s", requestId ? requestId : "");
    snprintf(item.result, sizeof(item.result), "%s", result ? result : "invalid");
    snprintf(item.message, sizeof(item.message), "%s", message ? message : "");
    item.revision = revision;
    resultTail_ = (resultTail_ + 1U) % RESULT_QUEUE_SIZE;
    ++resultCount_;
  }

  void queueResult(const char *requestId, const char *result,
                   const char *message, uint32_t revision = 0U) {
    portENTER_CRITICAL(&queueMux_);
    pushResultLocked(requestId, result, message, revision);
    portEXIT_CRITICAL(&queueMux_);
  }

  void startStation(const String &ssid, const String &password) {
    if (ssid.isEmpty()) return;
    WiFi.mode(portalActive_ ? WIFI_AP_STA : WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.begin(ssid.c_str(), password.c_str());
    stationAttemptAt_ = millis();
    mayapSerialPrintf(false, "[NET] Dang ket noi Wi-Fi %s\n", ssid.c_str());
  }

  static uint32_t credentialChecksum(WifiCredentialRecord record) {
    record.checksum = 0U;
    uint32_t hash = 2166136261UL;
    const uint8_t *bytes = reinterpret_cast<const uint8_t *>(&record);
    for (size_t index = 0U; index < sizeof(record); ++index) {
      hash ^= bytes[index];
      hash *= 16777619UL;
    }
    return hash;
  }

  static bool validCredential(const WifiCredentialRecord &record) {
    const size_t ssidLength = strnlen(record.ssid, sizeof(record.ssid));
    const size_t passwordLength = strnlen(record.password, sizeof(record.password));
    return record.magic == 0x4D41594EU && record.generation != 0U &&
           ssidLength > 0U && ssidLength < sizeof(record.ssid) &&
           passwordLength >= 8U && passwordLength < sizeof(record.password) &&
           credentialChecksum(record) == record.checksum;
  }

  static bool generationNewer(uint32_t candidate, uint32_t current) {
    return static_cast<int32_t>(candidate - current) > 0;
  }

  void loadWifiCredential() {
    WifiCredentialRecord slotA{}, slotB{};
    if (preferences_.begin("mayap_net", true)) {
      if (preferences_.getBytesLength("net_a") == sizeof(slotA)) {
        preferences_.getBytes("net_a", &slotA, sizeof(slotA));
      }
      if (preferences_.getBytesLength("net_b") == sizeof(slotB)) {
        preferences_.getBytes("net_b", &slotB, sizeof(slotB));
      }
      preferences_.end();
    }
    const bool validA = validCredential(slotA);
    const bool validB = validCredential(slotB);
    const WifiCredentialRecord *selected = nullptr;
    if (validA && (!validB || !generationNewer(slotB.generation, slotA.generation))) {
      selected = &slotA;
      activeCredentialSlot_ = 0U;
    } else if (validB) {
      selected = &slotB;
      activeCredentialSlot_ = 1U;
    }
    if (!selected) return;
    credentialGeneration_ = selected->generation;
    activeSsid_ = selected->ssid;
    activePassword_ = selected->password;
  }

  bool saveWifiCredential(const String &ssid, const String &password) {
    WifiCredentialRecord record{};
    record.generation = credentialGeneration_ + 1U;
    if (!record.generation) record.generation = 1U;
    snprintf(record.ssid, sizeof(record.ssid), "%s", ssid.c_str());
    snprintf(record.password, sizeof(record.password), "%s", password.c_str());
    record.checksum = credentialChecksum(record);
    const uint8_t targetSlot = activeCredentialSlot_ == 0U ? 1U : 0U;
    const char *key = targetSlot == 0U ? "net_a" : "net_b";
    if (!preferences_.begin("mayap_net", false)) return false;
    const bool written = preferences_.putBytes(key, &record, sizeof(record)) == sizeof(record);
    WifiCredentialRecord readback{};
    const bool read = written && preferences_.getBytesLength(key) == sizeof(readback) &&
                      preferences_.getBytes(key, &readback, sizeof(readback)) == sizeof(readback);
    preferences_.end();
    if (!read || !validCredential(readback) ||
        readback.generation != record.generation ||
        strcmp(readback.ssid, record.ssid) || strcmp(readback.password, record.password)) {
      return false;
    }
    activeCredentialSlot_ = targetSlot;
    credentialGeneration_ = record.generation;
    return true;
  }

  void serviceWifi(uint32_t now) {
    if (WiFi.status() == WL_CONNECTED) {
      if (!wifiWasConnected_) {
        wifiWasConnected_ = true;
        configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");
        mayapSerialPrintf(false, "[NET] Wi-Fi OK IP=%s\n",
                          WiFi.localIP().toString().c_str());
      }
      if (portalActive_ && !activeSsid_.isEmpty() &&
          !wifiChangeQueued_ && !wifiChangeActive_) stopPortal();
      return;
    }
    wifiWasConnected_ = false;
    if (!portalActive_ && !wifiChangeActive_ &&
        now - stationAttemptAt_ >= NETWORK_PORTAL_AFTER_MS) {
      startPortal();
    }
    if (!portalActive_ && !wifiChangeActive_ && !activeSsid_.isEmpty() &&
        now - stationAttemptAt_ >= NETWORK_RECONNECT_INTERVAL_MS) {
      startStation(activeSsid_, activePassword_);
    }
  }

  bool mqttUsesTls() const { return NETWORK_MQTT_PORT != 1883U; }

  void configureMqttTransport() {
    mqtt_.onMessage([](String &topic, String &payload) {
      Bridge.enqueueInbound(topic, payload);
    });
    if (mqttUsesTls()) {
      secureClient_.setCACert(NETWORK_MQTT_ROOT_CA);
      mqtt_.begin(NETWORK_MQTT_HOST, NETWORK_MQTT_PORT, secureClient_);
    } else {
      mqtt_.begin(NETWORK_MQTT_HOST, NETWORK_MQTT_PORT, plainClient_);
    }
    mqttConfigured_ = true;
  }

  void serviceMqtt(uint32_t now) {
    if (WiFi.status() != WL_CONNECTED || portalActive_ || wifiChangeActive_) return;
    if (!mqttConfigured_) configureMqttTransport();
    if (!mqtt_.connected()) {
      if (now - lastMqttAttemptAt_ < NETWORK_RECONNECT_INTERVAL_MS) return;
      lastMqttAttemptAt_ = now;
      JsonDocument offline;
      offline["online"] = false;
      offline["reason"] = "connection_lost";
      String will;
      serializeJson(offline, will);
      mqtt_.setWill(topicPresence_, will, true, 1);
      if (!mqtt_.connect(NETWORK_DEVICE_ID, NETWORK_MQTT_USERNAME,
                         NETWORK_MQTT_PASSWORD)) return;
      mqtt_.subscribe(topicCommand_, 1);
      mqtt_.subscribe(topicConfigSet_, 1);
      mqtt_.subscribe(topicWifiSet_, 1);
      mqtt_.subscribe(topicSession_, 0);
      publishPresence(true, "connected");
      publishConfig();
      publishSnapshot();
      mayapSerialPrintf(false, "[NET] MQTT OK %s:%u\n", NETWORK_MQTT_HOST,
                        static_cast<unsigned>(NETWORK_MQTT_PORT));
    }
    mqtt_.loop();
  }

  void enqueueInbound(const String &topic, const String &payload) {
    if (payload.length() >= MQTT_PAYLOAD_SIZE) {
      mayapSerialPrintf(false, "[NET] Bo payload qua lon\n");
      return;
    }
    portENTER_CRITICAL(&queueMux_);
    if (inboundCount_ < INBOUND_QUEUE_SIZE) {
      InboundMessage &message = inboundQueue_[inboundTail_];
      snprintf(message.topic, sizeof(message.topic), "%s", topic.c_str());
      snprintf(message.payload, sizeof(message.payload), "%s", payload.c_str());
      inboundTail_ = (inboundTail_ + 1U) % INBOUND_QUEUE_SIZE;
      ++inboundCount_;
    }
    portEXIT_CRITICAL(&queueMux_);
  }

  bool takeInbound(InboundMessage &message) {
    bool found = false;
    portENTER_CRITICAL(&queueMux_);
    if (inboundCount_) {
      message = inboundQueue_[inboundHead_];
      inboundHead_ = (inboundHead_ + 1U) % INBOUND_QUEUE_SIZE;
      --inboundCount_;
      found = true;
    }
    portEXIT_CRITICAL(&queueMux_);
    return found;
  }

  void serviceInbound() {
    InboundMessage message;
    uint8_t budget = INBOUND_QUEUE_SIZE;
    while (budget-- && takeInbound(message)) {
      JsonDocument doc;
      const DeserializationError error = deserializeJson(doc, message.payload);
      const char *requestId = doc["requestId"] | "unknown";
      if (error) {
        queueResult(requestId, "invalid", "JSON khong hop le");
      } else if (!strcmp(message.topic, topicCommand_)) {
        handleCommand(doc);
      } else if (!strcmp(message.topic, topicConfigSet_)) {
        handleConfig(doc);
      } else if (!strcmp(message.topic, topicWifiSet_)) {
        handleWifi(doc);
      }
    }
  }

  bool validateShortRequest(JsonDocument &doc, const char *requestId) {
    if ((doc["v"] | 0U) != 1U) {
      queueResult(requestId, "unsupported", "Phien ban giao thuc khong ho tro");
      return false;
    }
    if (!validRequestId(requestId)) {
      queueResult("unknown", "invalid", "requestId khong hop le");
      return false;
    }
    if (requestIdSeen(requestId)) {
      queueResult(requestId, "duplicate", "requestId da xu ly");
      return false;
    }
    const uint32_t requestedBootId = doc["bootId"] | 0U;
    const uint32_t sequence = doc["sequence"] | 0U;
    const uint32_t expiresAt = doc["expiresAt"] | 0U;
    if (requestedBootId != bootId_) {
      queueResult(requestId, "stale", "bootId cu");
      return false;
    }
    if (!sequence || sequence <= lastRequestSequence_) {
      queueResult(requestId, "duplicate", "sequence da xu ly");
      return false;
    }
    const time_t epoch = time(nullptr);
    if (epoch <= 1700000000) {
      queueResult(requestId, "stale", "Dong ho mang chua dong bo");
      return false;
    }
    if (!expiresAt || static_cast<uint32_t>(epoch) > expiresAt) {
      queueResult(requestId, "expired", "Yeu cau het han");
      return false;
    }
    lastRequestSequence_ = sequence;
    rememberRequestId(requestId);
    return true;
  }

  static bool validRequestId(const char *requestId) {
    if (!requestId) return false;
    const size_t length = strlen(requestId);
    return length > 0U && length < 64U && strcmp(requestId, "unknown") != 0;
  }

  bool requestIdSeen(const char *requestId) const {
    for (uint8_t index = 0U; index < recentRequestIdCount_; ++index) {
      if (!strcmp(recentRequestIds_[index], requestId)) return true;
    }
    return false;
  }

  void rememberRequestId(const char *requestId) {
    snprintf(recentRequestIds_[recentRequestIdNext_],
             sizeof(recentRequestIds_[recentRequestIdNext_]), "%s", requestId);
    recentRequestIdNext_ = (recentRequestIdNext_ + 1U) % REQUEST_ID_CACHE_SIZE;
    if (recentRequestIdCount_ < REQUEST_ID_CACHE_SIZE) ++recentRequestIdCount_;
  }

  void handleCommand(JsonDocument &doc) {
    const char *requestId = doc["requestId"] | "unknown";
    if (!validateShortRequest(doc, requestId)) return;
    const char *action = doc["action"] | "";
    HmiCommandType type = HmiCommandType::None;
    if (!strcmp(action, "batch_start")) type = HmiCommandType::BatchStart;
    else if (!strcmp(action, "batch_stop")) type = HmiCommandType::BatchStop;
    else if (!strcmp(action, "autotune_start")) type = HmiCommandType::AutoTuneStart;
    else if (!strcmp(action, "resume_yes")) type = HmiCommandType::ResumeYes;
    else if (!strcmp(action, "resume_no")) type = HmiCommandType::ResumeNo;
    if (type == HmiCommandType::None) {
      queueResult(requestId, "unsupported", "Lenh khong duoc ho tro");
      return;
    }
    uint32_t localId = 0U;
    uint16_t validForMs = constrain(static_cast<uint32_t>(doc["validForMs"] | 5000U),
                                    1000U, 8000U);
    portENTER_CRITICAL(&queueMux_);
    PendingRequest *pending = freePendingLocked(commandPending_);
    const bool queued = pending && hmiQueueExternalCommand(
        type, validForMs, 0U, AlarmNone, localId);
    if (queued) {
      pending->used = true;
      pending->localId = localId;
      snprintf(pending->requestId, sizeof(pending->requestId), "%s", requestId);
    }
    portEXIT_CRITICAL(&queueMux_);
    if (!queued) queueResult(requestId, "busy", "Hang doi lenh dang ban");
    else queueResult(requestId, "accepted", "Da dua vao hang doi an toan");
  }

  static bool readConfig(JsonObjectConst source, MachineConfig &c) {
    const char *required[] = {
      "targetTemp", "tempHysteresis", "lowTempAlarm", "highTempAlarm",
      "emergencyTemp", "controlMode", "kp", "ki", "kd", "pidCycleSec", "maxHeaterPower",
      "lowHumidityAlarm", "humidityAlarmDelaySec", "circulationFanEnabled",
      "ventOnTemp", "ventOffTemp", "turningEnabled", "turnIntervalMin",
      "turnMaxRunSec", "nextDirection", "totalIncubationDays",
      "allowHeatWithoutBatch", "powerRestoreDelaySec", "tempOffset",
      "humidityOffset", "sensorTimeoutSec", "alarmEnabled"
    };
    for (const char *key : required) if (!source.containsKey(key)) return false;
    c.targetTemp = source["targetTemp"];
    c.tempHysteresis = source["tempHysteresis"];
    c.lowTempAlarm = source["lowTempAlarm"];
    c.highTempAlarm = source["highTempAlarm"];
    c.emergencyTemp = source["emergencyTemp"];
    c.controlMode = static_cast<ControlMode>(source["controlMode"] | 1U);
    c.kp = source["kp"];
    c.ki = source["ki"];
    c.kd = source["kd"];
    c.pidCycleSec = source["pidCycleSec"];
    c.maxHeaterPower = source["maxHeaterPower"];
    c.lowHumidityAlarm = source["lowHumidityAlarm"];
    c.humidityAlarmDelaySec = source["humidityAlarmDelaySec"];
    c.circulationFanEnabled = source["circulationFanEnabled"];
    c.ventOnTemp = source["ventOnTemp"];
    c.ventOffTemp = source["ventOffTemp"];
    c.turningEnabled = source["turningEnabled"];
    c.turnIntervalMin = source["turnIntervalMin"];
    c.turnMaxRunSec = source["turnMaxRunSec"];
    c.nextDirection = static_cast<TurnDirection>(source["nextDirection"] | 1U);
    c.totalIncubationDays = source["totalIncubationDays"];
    c.allowHeatWithoutBatch = source["allowHeatWithoutBatch"];
    c.powerRestoreDelaySec = source["powerRestoreDelaySec"];
    c.tempOffset = source["tempOffset"];
    c.humidityOffset = source["humidityOffset"];
    c.sensorTimeoutSec = source["sensorTimeoutSec"];
    c.alarmEnabled = source["alarmEnabled"];
    return true;
  }

  void handleConfig(JsonDocument &doc) {
    const char *requestId = doc["requestId"] | "unknown";
    const uint32_t revision = doc["revision"] | 0U;
    if ((doc["v"] | 0U) != 1U) {
      queueResult(requestId, "unsupported", "Phien ban giao thuc khong ho tro", revision);
      return;
    }
    if (!validRequestId(requestId)) {
      queueResult("unknown", "invalid", "requestId khong hop le", revision);
      return;
    }
    if (requestIdSeen(requestId)) {
      queueResult(requestId, "duplicate", "requestId da xu ly", revision);
      return;
    }
    if (!revision || revision <= configRevision_) {
      queueResult(requestId, "stale", "revision cu", revision);
      return;
    }
    MachineConfig config;
    if (!readConfig(doc["config"].as<JsonObjectConst>(), config)) {
      queueResult(requestId, "invalid", "Cau hinh thieu truong", revision);
      return;
    }
    uint32_t localId = 0U;
    portENTER_CRITICAL(&queueMux_);
    PendingRequest *pending = freePendingLocked(configPending_);
    const bool queued = pending && hmiQueueExternalConfig(config, localId);
    if (queued) {
      pending->used = true;
      pending->localId = localId;
      pending->revision = revision;
      snprintf(pending->requestId, sizeof(pending->requestId), "%s", requestId);
    }
    portEXIT_CRITICAL(&queueMux_);
    if (!queued) queueResult(requestId, "busy", "Dang co giao dich EEPROM", revision);
    else {
      rememberRequestId(requestId);
      queueResult(requestId, "accepted", "Dang ghi EEPROM A/B", revision);
    }
  }

  void handleWifi(JsonDocument &doc) {
    const char *requestId = doc["requestId"] | "unknown";
    if (!validateShortRequest(doc, requestId)) return;
    const char *ssid = doc["ssid"] | "";
    const char *password = doc["password"] | "";
    const size_t ssidLength = strlen(ssid);
    const size_t passwordLength = strlen(password);
    if (!ssidLength || ssidLength > 32U || passwordLength < 8U || passwordLength > 63U) {
      queueResult(requestId, "invalid", "SSID/mat khau khong hop le");
      return;
    }
    if (wifiChangeQueued_ || wifiChangeActive_) {
      queueResult(requestId, "busy", "Dang thu Wi-Fi moi");
      return;
    }
    pendingSsid_ = ssid;
    pendingPassword_ = password;
    wifiRequestId_ = requestId;
    wifiChangeQueuedAt_ = millis();
    wifiChangeQueued_ = true;
    queueResult(requestId, "accepted", "Se thu Wi-Fi moi va tu quay lui neu loi");
  }

  void serviceWifiChange(uint32_t now) {
    if (wifiChangeQueued_ && now - wifiChangeQueuedAt_ >= 750U) {
      wifiChangeQueued_ = false;
      wifiChangeActive_ = true;
      wifiChangeStartedAt_ = now;
      mqtt_.disconnect();
      WiFi.disconnect(false, false);
      startStation(pendingSsid_, pendingPassword_);
      return;
    }
    if (!wifiChangeActive_) return;
    if (WiFi.status() == WL_CONNECTED) {
      const bool stored = saveWifiCredential(pendingSsid_, pendingPassword_);
      if (stored) {
        activeSsid_ = pendingSsid_;
        activePassword_ = pendingPassword_;
      }
      wifiChangeActive_ = false;
      mqttConfigured_ = false;
      queueResult(wifiRequestId_.c_str(), stored ? "applied" : "rejected",
                  stored ? "Wi-Fi moi da ket noi va luu" : "Ket noi duoc nhung luu NVS that bai");
      if (!stored) {
        WiFi.disconnect(false, false);
        if (activeSsid_.isEmpty()) startPortal();
        else startStation(activeSsid_, activePassword_);
      }
      return;
    }
    if (now - wifiChangeStartedAt_ < 30000U) return;
    wifiChangeActive_ = false;
    mqttConfigured_ = false;
    queueResult(wifiRequestId_.c_str(), "rejected", "Wi-Fi moi that bai, da quay lai mang cu");
    if (activeSsid_.isEmpty()) startPortal();
    else startStation(activeSsid_, activePassword_);
  }

  void serviceResults() {
    if (!mqtt_.connected()) return;
    for (uint8_t budget = 0U; budget < RESULT_QUEUE_SIZE; ++budget) {
      ResultMessage item;
      bool found = false;
      portENTER_CRITICAL(&queueMux_);
      if (resultCount_) {
        item = resultQueue_[resultHead_];
        resultHead_ = (resultHead_ + 1U) % RESULT_QUEUE_SIZE;
        --resultCount_;
        found = true;
      }
      portEXIT_CRITICAL(&queueMux_);
      if (!found) break;
      JsonDocument doc;
      doc["bootId"] = bootId_;
      doc["requestId"] = item.requestId;
      doc["result"] = item.result;
      doc["message"] = item.message;
      if (item.revision) doc["revision"] = item.revision;
      String payload;
      serializeJson(doc, payload);
      if (!mqtt_.publish(topicAck_, payload, false, 1)) {
        portENTER_CRITICAL(&queueMux_);
        pushResultLocked(item.requestId, item.result, item.message, item.revision);
        portEXIT_CRITICAL(&queueMux_);
        break;
      }
    }
  }

  void serviceEvents() {
    if (!mqtt_.connected()) return;
    HmiEventSnapshot snapshot;
    bool pending = false;
    portENTER_CRITICAL(&snapshotMux_);
    if (eventSnapshotPending_) {
      snapshot = eventSnapshot_;
      eventSnapshotPending_ = false;
      pending = true;
    }
    portEXIT_CRITICAL(&snapshotMux_);
    if (!pending) return;

    // Snapshot cua core xep moi -> cu; publish cu -> moi de dashboard giu
    // thu tu thoi gian. Sequence chong phat trung khi HMI gui lai snapshot.
    for (int index = static_cast<int>(snapshot.count) - 1; index >= 0; --index) {
      const HmiEventItem &event = snapshot.items[index];
      if (!event.sequence || event.sequence <= lastPublishedEventSequence_) continue;
      JsonDocument doc;
      doc["sequence"] = event.sequence;
      doc["epoch"] = event.epoch;
      doc["ageSec"] = event.ageSec;
      doc["code"] = event.code;
      doc["value"] = event.value;
      doc["type"] = event.type;
      doc["flags"] = event.flags;
      String payload;
      serializeJson(doc, payload);
      if (mqtt_.publish(topicLog_, payload, false, 1)) {
        lastPublishedEventSequence_ = event.sequence;
      } else {
        portENTER_CRITICAL(&snapshotMux_);
        eventSnapshot_ = snapshot;
        eventSnapshotPending_ = true;
        portEXIT_CRITICAL(&snapshotMux_);
        break;
      }
    }
  }

  static void appendConfig(JsonObject target, const MachineConfig &c) {
    target["targetTemp"] = c.targetTemp;
    target["tempHysteresis"] = c.tempHysteresis;
    target["lowTempAlarm"] = c.lowTempAlarm;
    target["highTempAlarm"] = c.highTempAlarm;
    target["emergencyTemp"] = c.emergencyTemp;
    target["controlMode"] = static_cast<uint8_t>(c.controlMode);
    target["kp"] = c.kp;
    target["ki"] = c.ki;
    target["kd"] = c.kd;
    target["pidCycleSec"] = c.pidCycleSec;
    target["maxHeaterPower"] = c.maxHeaterPower;
    target["lowHumidityAlarm"] = c.lowHumidityAlarm;
    target["humidityAlarmDelaySec"] = c.humidityAlarmDelaySec;
    target["circulationFanEnabled"] = c.circulationFanEnabled;
    target["ventOnTemp"] = c.ventOnTemp;
    target["ventOffTemp"] = c.ventOffTemp;
    target["turningEnabled"] = c.turningEnabled;
    target["turnIntervalMin"] = c.turnIntervalMin;
    target["turnMaxRunSec"] = c.turnMaxRunSec;
    target["nextDirection"] = static_cast<uint8_t>(c.nextDirection);
    target["totalIncubationDays"] = c.totalIncubationDays;
    target["allowHeatWithoutBatch"] = c.allowHeatWithoutBatch;
    target["powerRestoreDelaySec"] = c.powerRestoreDelaySec;
    target["tempOffset"] = c.tempOffset;
    target["humidityOffset"] = c.humidityOffset;
    target["sensorTimeoutSec"] = c.sensorTimeoutSec;
    target["alarmEnabled"] = c.alarmEnabled;
  }

  bool copySnapshot(MachineConfig &config, MachineRuntime &runtime) {
    bool ready;
    portENTER_CRITICAL(&snapshotMux_);
    ready = snapshotReady_;
    if (ready) {
      config = snapshotConfig_;
      runtime = snapshotRuntime_;
    }
    portEXIT_CRITICAL(&snapshotMux_);
    return ready;
  }

  void publishPresence(bool online, const char *reason) {
    if (!mqtt_.connected()) return;
    JsonDocument doc;
    doc["online"] = online;
    doc["ssid"] = WiFi.SSID();
    doc["firmware"] = MAYAP_FIRMWARE_VERSION;
    doc["bridge"] = MAYAP_NETWORK_BRIDGE_VERSION;
    doc["ip"] = WiFi.localIP().toString();
    doc["reason"] = reason;
    String payload;
    serializeJson(doc, payload);
    mqtt_.publish(topicPresence_, payload, true, 1);
  }

  void publishSnapshot() {
    MachineConfig config;
    MachineRuntime runtime;
    if (!mqtt_.connected() || !copySnapshot(config, runtime)) return;
    JsonDocument doc;
    doc["bootId"] = bootId_;
    doc["revision"] = ++snapshotRevision_;
    JsonObject data = doc["runtime"].to<JsonObject>();
    data["temperature"] = isnan(runtime.temperature) ? 0.0f : runtime.temperature;
    data["humidity"] = isnan(runtime.humidity) ? 0.0f : runtime.humidity;
    data["heaterOn"] = runtime.heaterOn;
    data["heaterPower"] = runtime.heaterPower;
    data["circulationFanOn"] = runtime.circulationFanOn;
    data["ventFanOn"] = runtime.ventFanOn;
    data["turnState"] = static_cast<uint8_t>(runtime.turnState);
    data["batchRunning"] = runtime.batchRunning;
    data["currentDay"] = runtime.currentDay;
    data["nextTurnMinutes"] = runtime.nextTurnMinutes;
    data["machineState"] = runtime.machineState;
    data["autoTuneState"] = static_cast<uint8_t>(runtime.autoTuneState);
    data["autoTuneProgress"] = runtime.autoTuneProgress;
    data["resumeConfirmationRequired"] = runtime.resumeConfirmationRequired;
    data["sensorOnline"] = runtime.sensorOnline;
    data["alarmMask"] = runtime.alarmMask;
    data["primaryFaultCode"] = runtime.primaryFaultCode;
    String payload;
    serializeJson(doc, payload);
    mqtt_.publish(topicSnapshot_, payload, false, 0);
  }

  void publishConfig() {
    MachineConfig config;
    MachineRuntime runtime;
    if (!mqtt_.connected() || !copySnapshot(config, runtime)) return;
    JsonDocument doc;
    doc["bootId"] = bootId_;
    portENTER_CRITICAL(&queueMux_);
    const uint32_t revision = configRevision_;
    portEXIT_CRITICAL(&queueMux_);
    doc["revision"] = revision;
    appendConfig(doc["config"].to<JsonObject>(), config);
    String payload;
    serializeJson(doc, payload);
    mqtt_.publish(topicConfigReported_, payload, true, 1);
  }

  void publishPeriodic(uint32_t now) {
    if (!mqtt_.connected()) return;
    portENTER_CRITICAL(&queueMux_);
    const bool publishConfigNow = configPublishPending_;
    configPublishPending_ = false;
    portEXIT_CRITICAL(&queueMux_);
    if (publishConfigNow) publishConfig();
    if (now - lastSnapshotPublishedAt_ >= NETWORK_PUBLISH_INTERVAL_MS) {
      lastSnapshotPublishedAt_ = now;
      publishSnapshot();
    }
    if (now - lastConfigPublishedAt_ >= NETWORK_CONFIG_PUBLISH_INTERVAL_MS) {
      lastConfigPublishedAt_ = now;
      publishConfig();
      publishPresence(true, "heartbeat");
    }
  }

  String portalPage() const {
    String html = F("<!doctype html><html lang='vi'><meta name='viewport' content='width=device-width,initial-scale=1'><meta charset='utf-8'><title>MAYAP Wi-Fi</title><style>body{font:16px system-ui;background:#eef6f3;color:#15352e;margin:0;padding:20px}main{max-width:440px;margin:auto;background:white;border-radius:24px;padding:24px;box-shadow:0 15px 50px #174b3820}h1{font-size:25px}label{display:block;margin:17px 0 6px;font-weight:700}input{box-sizing:border-box;width:100%;padding:14px;border:1px solid #b9cdc6;border-radius:12px;font-size:16px}button{width:100%;margin-top:22px;padding:14px;border:0;border-radius:12px;background:#087a64;color:white;font-weight:800;font-size:16px}.note{background:#eef8f5;padding:12px;border-radius:12px;font-size:14px}</style><main><b>MAYAP INDUSTRIAL</b><h1>Kết nối Wi-Fi cho thiết bị</h1><p class='note'>Mạng cấu hình chỉ dùng tại chỗ. Thông tin được lưu sau khi ESP32 kết nối thành công.</p><form method='post' action='/save'><label>Tên Wi-Fi (SSID)</label><input name='ssid' maxlength='32' required><label>Mật khẩu</label><input name='password' type='password' minlength='8' maxlength='63' required><button>Lưu và thử kết nối</button></form></main></html>");
    return html;
  }

  void startPortal() {
    if (portalActive_) return;
    char apName[24];
    const size_t idLength = strlen(NETWORK_DEVICE_ID);
    snprintf(apName, sizeof(apName), "MAYAP-%s",
             idLength >= 4U ? NETWORK_DEVICE_ID + idLength - 4U : "SETUP");
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(apName, NETWORK_SETUP_AP_PASSWORD);
    dns_.start(53, "*", WiFi.softAPIP());
    if (!portalHandlersConfigured_) {
      portalServer_.on("/", HTTP_GET, [this]() { portalServer_.send(200, "text/html; charset=utf-8", portalPage()); });
      portalServer_.on("/generate_204", HTTP_GET, [this]() { portalServer_.sendHeader("Location", "/", true); portalServer_.send(302, "text/plain", ""); });
      portalServer_.on("/hotspot-detect.html", HTTP_GET, [this]() { portalServer_.send(200, "text/html; charset=utf-8", portalPage()); });
      portalServer_.on("/save", HTTP_POST, [this]() {
        const String ssid = portalServer_.arg("ssid");
        const String password = portalServer_.arg("password");
        if (ssid.isEmpty() || ssid.length() > 32U || password.length() < 8U || password.length() > 63U) {
          portalServer_.send(400, "text/plain; charset=utf-8", "SSID hoặc mật khẩu không hợp lệ");
          return;
        }
        pendingSsid_ = ssid;
        pendingPassword_ = password;
        wifiRequestId_ = "local-portal";
        wifiChangeQueuedAt_ = millis();
        wifiChangeQueued_ = true;
        portalServer_.send(200, "text/html; charset=utf-8", "<meta name='viewport' content='width=device-width'><h2>Đã nhận cấu hình</h2><p>ESP32 đang thử kết nối. Nếu thất bại, điểm truy cập MAYAP sẽ xuất hiện lại.</p>");
        stopPortalPending_ = true;
      });
      portalServer_.onNotFound([this]() { portalServer_.sendHeader("Location", "/", true); portalServer_.send(302, "text/plain", ""); });
      portalHandlersConfigured_ = true;
    }
    portalServer_.begin();
    portalActive_ = true;
    mayapSerialPrintf(false, "[NET] Portal %s tai 192.168.4.1\n", apName);
  }

  void stopPortal() {
    if (!portalActive_) return;
    portalServer_.stop();
    dns_.stop();
    WiFi.softAPdisconnect(true);
    portalActive_ = false;
  }

  void servicePortal() {
    if (!portalActive_) return;
    dns_.processNextRequest();
    portalServer_.handleClient();
    if (stopPortalPending_) {
      stopPortalPending_ = false;
      stopPortal();
    }
  }

  StaticTask_t taskTcb_{};
  StackType_t taskStack_[(NETWORK_TASK_STACK_BYTES + sizeof(StackType_t) - 1U) /
                         sizeof(StackType_t)]{};
  TaskHandle_t taskHandle_ = nullptr;
  portMUX_TYPE queueMux_ = portMUX_INITIALIZER_UNLOCKED;
  portMUX_TYPE snapshotMux_ = portMUX_INITIALIZER_UNLOCKED;
  InboundMessage inboundQueue_[INBOUND_QUEUE_SIZE]{};
  ResultMessage resultQueue_[RESULT_QUEUE_SIZE]{};
  PendingRequest commandPending_[PENDING_MAP_SIZE]{};
  PendingRequest configPending_[PENDING_MAP_SIZE]{};
  uint8_t inboundHead_ = 0U, inboundTail_ = 0U, inboundCount_ = 0U;
  uint8_t resultHead_ = 0U, resultTail_ = 0U, resultCount_ = 0U;
  MachineConfig snapshotConfig_{};
  MachineRuntime snapshotRuntime_{};
  HmiEventSnapshot eventSnapshot_{};
  bool snapshotReady_ = false;
  bool eventSnapshotPending_ = false;
  uint32_t lastSnapshotCopyAt_ = 0U;

  Preferences preferences_;
  DNSServer dns_;
  WebServer portalServer_{80};
  WiFiClient plainClient_;
  WiFiClientSecure secureClient_;
  MQTTClient mqtt_{MQTT_PAYLOAD_SIZE};
  bool mqttConfigured_ = false;
  bool wifiWasConnected_ = false;
  bool portalActive_ = false;
  bool portalHandlersConfigured_ = false;
  bool stopPortalPending_ = false;
  bool wifiChangeQueued_ = false;
  bool wifiChangeActive_ = false;
  uint32_t bootId_ = 0U;
  uint32_t snapshotRevision_ = 0U;
  volatile uint32_t configRevision_ = 1U;
  bool configPublishPending_ = false;
  uint32_t lastPublishedEventSequence_ = 0U;
  uint32_t credentialGeneration_ = 0U;
  uint8_t activeCredentialSlot_ = 0xFFU;
  uint32_t lastRequestSequence_ = 0U;
  char recentRequestIds_[REQUEST_ID_CACHE_SIZE][64]{};
  uint8_t recentRequestIdNext_ = 0U;
  uint8_t recentRequestIdCount_ = 0U;
  uint32_t stationAttemptAt_ = 0U;
  uint32_t lastMqttAttemptAt_ = 0U;
  uint32_t lastSnapshotPublishedAt_ = 0U;
  uint32_t lastConfigPublishedAt_ = 0U;
  uint32_t wifiChangeQueuedAt_ = 0U;
  uint32_t wifiChangeStartedAt_ = 0U;
  String activeSsid_, activePassword_, pendingSsid_, pendingPassword_, wifiRequestId_;
  char baseTopic_[96]{}, topicPresence_[128]{}, topicSnapshot_[128]{};
  char topicConfigReported_[128]{}, topicAck_[128]{}, topicCommand_[128]{};
  char topicConfigSet_[128]{}, topicWifiSet_[128]{}, topicSession_[128]{}, topicLog_[128]{};
};

NetworkBridge Bridge;

void commandResultCallback(uint32_t commandId, bool ok, const char *message) {
  Bridge.onCommandResult(commandId, ok, message);
}

void configResultCallback(uint32_t transactionId, bool ok) {
  Bridge.onConfigResult(transactionId, ok);
}

void eventSnapshotCallback(const HmiEventSnapshot &snapshot) {
  Bridge.onEventSnapshot(snapshot);
}

}  // namespace MayapNetwork

inline void mayapNetworkBegin() { MayapNetwork::Bridge.begin(); }

inline void mayapNetworkSetSnapshot(const MachineConfig &config,
                                    const MachineRuntime &runtime) {
  MayapNetwork::Bridge.setSnapshot(config, runtime);
}
