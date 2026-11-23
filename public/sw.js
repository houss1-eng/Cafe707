// Service worker : affiche les notifications (Web Push, même app fermée). Aucun cache.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(data.title || "707 Café & Resto", {
    body: data.body || "",
    icon: "logo707.png",
    badge: "logo707.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    vibrate: [200, 100, 200],
    data: { url: data.url || "/" },
  }));
});

// Toucher la notification : ouvre (ou remet devant) la bonne page du 707
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const same = list.find((c) => c.url.split("?")[0] === url.split("?")[0] && "focus" in c);
    if (same) return same.focus();
    return self.clients.openWindow(url);
  }));
});
