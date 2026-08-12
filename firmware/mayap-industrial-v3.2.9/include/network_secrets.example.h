#pragma once

// Sao chep file nay thanh network_secrets.h truoc khi build ban test that.
// Moi thiet bi phai co DEVICE_ID va thong tin MQTT rieng.
static constexpr char NETWORK_DEVICE_ID[] = "MAP-A1B2C3D4E5F6";
static constexpr char NETWORK_TOPIC_ROOT[] = "mayap/v1";
static constexpr char NETWORK_MQTT_HOST[] = "mqtt.example.com";
static constexpr uint16_t NETWORK_MQTT_PORT = 8883;
static constexpr char NETWORK_MQTT_USERNAME[] = "device-MAP-A1B2C3D4E5F6";
static constexpr char NETWORK_MQTT_PASSWORD[] = "replace-with-a-long-device-password";

// WPA2 password cua diem truy cap cau hinh MAYAP-xxxx. Toi thieu 8 ky tu.
static constexpr char NETWORK_SETUP_AP_PASSWORD[] = "mayap-setup";

// CA goc PEM cua broker. De rong chi duoc dung cho MQTT thu nghiem noi bo
// qua port khong TLS (vi du 1883). Khong dung setInsecure o ban thuong mai.
static constexpr char NETWORK_MQTT_ROOT_CA[] = R"PEM(
-----BEGIN CERTIFICATE-----
replace-with-broker-root-ca
-----END CERTIFICATE-----
)PEM";
