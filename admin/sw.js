// Service worker de /admin/: solo muestra los recordatorios (notificaciones push).
// No guarda nada en caché ni intercepta la carga de la página.

const DEFAULT = {
  title: 'Global Tecni',
  body: '📸 No se olvide de documentar sus trabajos subiendo las fotos.',
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

/** Opciones comunes de la notificación (también la usa el botón "Probar" de la página). */
function options(data) {
  return {
    body: data.body || DEFAULT.body,
    icon: 'icon-192.png',
    badge: 'badge-96.png',
    tag: 'recordatorio-fotos',
    renotify: true,
    vibrate: [180, 90, 180],
    timestamp: Date.now(),
    actions: [
      { action: 'subir', title: '📷 Subir fotos' },
      { action: 'luego', title: 'Más tarde' },
    ],
    data: { url: new URL('./', self.registration.scope).href },
  };
}

self.addEventListener('push', (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { body: e.data && e.data.text() };
  }
  e.waitUntil(self.registration.showNotification(data.title || DEFAULT.title, options(data)));
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'test') {
    e.waitUntil(self.registration.showNotification(DEFAULT.title, options({ body: e.data.body })));
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  if (e.action === 'luego') return;
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = wins.find((w) => w.url.startsWith(self.registration.scope));
      if (open) return open.focus();
      return self.clients.openWindow(url);
    })(),
  );
});
