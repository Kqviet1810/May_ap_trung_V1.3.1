// Chromium supports the renotify option even though some TypeScript DOM lib versions omit it.
interface NotificationOptions {
  renotify?: boolean;
}
