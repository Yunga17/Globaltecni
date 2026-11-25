// Lo ejecuta .github/workflows/recordatorios.yml de lunes a viernes, cada 15 minutos entre
// las 10:00–12:00 y las 16:00–18:00 (hora de Ecuador), porque GitHub a veces atrasa o se salta
// las tareas programadas. Envía UNA sola vez por horario: anota el último envío en
// notificaciones/enviados.json. Fuera de esas horas no envía nada (para no avisar de noche).
//
//   node recordatorios.mjs --check   → solo dice si toca enviar (sin dependencias)
//   node recordatorios.mjs           → envía (FORZAR=1 envía siempre, para pruebas manuales)
import { createDecipheriv, privateDecrypt, constants } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const FILE = 'notificaciones/dispositivos.json';
const SENT_FILE = 'notificaciones/enviados.json';

/** Hora de Ecuador: { date: 'AAAA-MM-DD', weekday: 1..7 (lunes=1), hour } */
function ecuador(now) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hour12: false, weekday: 'short' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1;
  return { date: `${p.year}-${p.month}-${p.day}`, weekday, hour: Number(p.hour) % 24 };
}

/** Horario que toca ahora ('AAAA-MM-DD-manana' / '-tarde'), o null si no es hora de avisar. */
export function slot(now = new Date()) {
  const e = ecuador(now);
  if (e.weekday > 5) return null;
  if (e.hour >= 10 && e.hour < 12) return `${e.date}-manana`;
  if (e.hour >= 16 && e.hour < 18) return `${e.date}-tarde`;
  return null;
}

function lastSent() {
  try {
    return JSON.parse(readFileSync(SENT_FILE, 'utf8')).ultimo || '';
  } catch {
    return '';
  }
}

/** ¿Toca enviar ahora? { send, reason } */
export function shouldSend(now = new Date(), forced = false) {
  if (forced) return { send: true, reason: 'envío manual' };
  const s = slot(now);
  if (!s) return { send: false, reason: 'fuera del horario de recordatorios' };
  if (lastSent() === s) return { send: false, reason: `ya se envió el de ${s}` };
  return { send: true, reason: `toca enviar el de ${s}` };
}

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
  const forced = process.env.FORZAR === '1';
  const decision = shouldSend(new Date(), forced);
  console.log(`Recordatorio: ${decision.reason}.`);
  if (process.argv.includes('--check')) {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `send=${decision.send}\n`);
    return;
  }
  if (!decision.send) return;
  const currentSlot = forced ? null : slot();
  const markSent = () => currentSlot && writeFileSync(SENT_FILE, JSON.stringify({ ultimo: currentSlot }, null, 2) + '\n');

  if (!process.env.PUSH_SECRET) {
    console.error('Falta el secreto PUSH_SECRET en GitHub (Settings → Secrets and variables → Actions).');
    process.exit(1);
  }
  const secret = JSON.parse(process.env.PUSH_SECRET);
  const list = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { devices: [] };
  const devices = Array.isArray(list.devices) ? list.devices : [];
  if (!devices.length) {
    markSent();
    return console.log('Ningún teléfono tiene los recordatorios activados.');
  }

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
  // Si no llegó a ninguno (falla de red, etc.), no se anota: se reintenta en el siguiente intento
  if (ok > 0 || gone.size === devices.length) markSent();
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
