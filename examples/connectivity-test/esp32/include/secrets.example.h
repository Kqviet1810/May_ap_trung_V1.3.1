#pragma once

// Sao chép file này thành include/secrets.h rồi thay các giá trị.
inline constexpr char WIFI_SSID[] = "";
inline constexpr char WIFI_PASSWORD[] = "";

// Khi test local, dùng IP LAN của máy chạy Docker; không dùng localhost.
inline constexpr char MQTT_HOST[] = "";
inline constexpr unsigned short MQTT_PORT = 1883;
inline constexpr char MQTT_USERNAME[] = "mayap-device-test";
inline constexpr char MQTT_PASSWORD[] = "";

inline constexpr char DEVICE_ID[] = "MAP-A1B2C3D4E5F6";
inline constexpr char TOPIC_ROOT[] = "mayap/v1";

// Test local dùng false. Production phải dùng TLS, cổng 8883 và CA thật.
inline constexpr bool MQTT_USE_TLS = false;
inline constexpr char MQTT_ROOT_CA[] = "";

// true: tạo nhiệt/ẩm biến thiên để kiểm tra luồng truyền. Khi gắn cảm biến thật, đặt false
// và hiện thực hàm readRealSensors() trong src/main.cpp.
inline constexpr bool TRANSPORT_TEST_MODE = true;
