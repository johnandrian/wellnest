// Wellnest's service worker, only for web notifications (src/push.web.ts, convex/webPush.ts). It shows each push,
// and a click focuses an open Wellnest tab (which opens the right panel) or opens a new one.
self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : "" };
  }
  const data = message.data || {};
  event.waitUntil(
    self.registration.showNotification(message.title || "Wellnest", {
      body: message.body || "",
      icon: "/favicon.png",
      badge: "/favicon.png",
      data,
      // One notification per reminder, so a repeat replaces it.
      tag: data.messageId || undefined,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
      if (tab) {
        await tab.focus();
        tab.postMessage({ type: "wellnest-open", kind: data.kind || "", url: data.url || "" });
      } else {
        await self.clients.openWindow(`/?open=${encodeURIComponent(data.kind || "")}`);
      }
    })(),
  );
});
