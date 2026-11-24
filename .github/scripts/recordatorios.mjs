// Lo ejecuta .github/workflows/recordatorios.yml a las 10:00 y 16:00 (hora de Ecuador).
// Descifra los teléfonos guardados en notificaciones/dispositivos.json y les envía el recordatorio.
import { createDecipheriv, privateDecrypt, constants } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const FILE = 'notificaciones/dispositivos.json';

/** Descifra lo que cifró admin/notify.js (RSA-OAEP SHA-256 + AES-256-GCM). */
export function decrypt(entry, rsaPrivate) {
  const key = privateDecrypt({ key: rsaPrivate, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(entry.k, 'base64'));
  const data = Buffer.from(entry.d, 'base64');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'base64'));
  d.setAuthTag(data.subarray(data.length - 16));
  return JSON.parse(Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]).toString('utf8'));
}

/** Mensaje según la hora en Ecuador. */
export function message(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Guayaquil', hour: 'numeric', hour12: false }).format(now));
  if (h < 13) {
    return { title: '☀️ ¡Buenos días, Global Tecni!', body: 'No se olvide de documentar sus trabajos de hoy: tome fotos y súbalas a la galería.' };
  }
  return { title: '📸 Global Tecni', body: 'No se olvide de documentar sus trabajos subiendo las fotos de hoy.' };
}

async function main() {
  if (!process.env.PUSH_SECRET) {
    console.error('Falta el secreto PUSH_SECRET en GitHub (Settings → Secrets and variables → Actions).');
    process.exit(1);
  }
  const secret = JSON.parse(process.env.PUSH_SECRET);
  if (!existsSync(FILE)) return console.log('Ningún teléfono tiene los recordatorios activados.');
  const list = JSON.parse(readFileSync(FILE, 'utf8'));
  const devices = Array.isArray(list.devices) ? list.devices : [];
  if (!devices.length) return console.log('Ningún teléfono tiene los recordatorios activados.');

  const webpush = createRequire(new URL('./', import.meta.url))('web-push');
  webpush.setVapidDetails(secret.subject, secret.vapidPublic, secret.vapidPrivate);

  const msg = process.env.MENSAJE ? { title: '📸 Global Tecni', body: process.env.MENSAJE } : message();
  const payload = JSON.stringify(msg);
  const gone = new Set();
  let ok = 0;
  for (const dev of devices) {
    try {
      await webpush.sendNotification(decrypt(dev, secret.rsaPrivate), payload, { TTL: 4 * 3600, urgency: 'high' });
      ok++;
    } catch (e) {
      // 404/410: el teléfono desinstaló la app o quitó el permiso
      if (e.statusCode === 404 || e.statusCode === 410) gone.add(dev.id);
      console.log(`Teléfono ${dev.id.slice(0, 8)}…: ${e.statusCode || ''} ${e.body || e.message}`);
    }
  }
  console.log(`Enviadas: ${ok} de ${devices.length}.`);
  if (gone.size) {
    list.devices = devices.filter((d) => !gone.has(d.id));
    writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n');
  }
}

// Solo se ejecuta al llamarlo directamente (no al importarlo para probar)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
