// Recordatorios diarios (10:00 y 16:00) con notificaciones push.
//
// Cómo funciona:
//  1. Al activar, el teléfono pide permiso y crea una "suscripción" push.
//  2. Esa suscripción se cifra aquí (RSA + AES) y se guarda en notificaciones/dispositivos.json.
//  3. Una acción programada de GitHub (.github/workflows/recordatorios.yml) la descifra a esas horas
//     y envía la notificación. Solo esa acción tiene la clave para descifrar.

import { removeDevice, saveDevice } from './github.js';

const VAPID_PUBLIC = 'BKrppfj3DPRxQAGHu_fL1EA5rTg1D7sNRWpHB3TRWTtOGGEpO2v-xEUX6y-o5jjnK5sD7B8HC-uknvPyQnCMIY8';
const RSA_PUBLIC =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxWCtMnqDmJL/MCq3fyckB8V5fD+2PEjzRtdBZLZKbtZ5JMP71oMK8YctpM1B+e5RaTKmr2MmpRlhqOuOzrVAqTp0U7KDRVO3qNNARn3kv/RMxXvExNMFISateJXZCKB+6RLZQ991L6e7YkKNigHfX1s2PG9cVL0xSneD8ICSHwarIJURiNpGrfolGmzZZrExFYMsj/SBsX+iQCJzEh4RtmAwy3eoOKnymX2egFRRfpm8yv9CjvQLG0LMjXEWXtYgol9nWqXyZzz0QFa8eE5xt5H9T/YoG4QDyXNLzCtr+R2ycu17ApYjZzj5J9Odvru9KDfu6Sr1ml+ij7uyHsPBMQIDAQAB';
const STORAGE_KEY = 'gt_admin_notif'; // { id } de este teléfono

const $ = (id) => document.getElementById(id);

// --- utilidades base64 ---
const toB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const fromB64 = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
const fromB64Url = (s) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

/** Cifra la suscripción para que solo la acción de GitHub pueda leerla. */
async function encrypt(obj) {
  const rsa = await crypto.subtle.importKey('spki', fromB64(RSA_PUBLIC), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify(obj)));
  const key = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsa, await crypto.subtle.exportKey('raw', aes));
  return { k: toB64(key), iv: toB64(iv), d: toB64(data) };
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {};
  } catch {
    return {};
  }
}
function saveState(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* modo privado */
  }
}

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

let reg = null;
let working = false;

async function registration() {
  if (!reg) reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
  await navigator.serviceWorker.ready;
  return reg;
}

/**
 * ctx = { getCfg: () => cfg, notice(kind, text), fail(err) }
 */
export function initReminders(ctx) {
  const sw = $('rem-switch');
  const test = $('rem-test');
  const status = $('rem-status');

  function render(on, text) {
    sw.setAttribute('aria-checked', String(on));
    sw.disabled = working || !supported();
    sw.classList.toggle('busy', working);
    test.hidden = !on;
    test.disabled = working;
    status.textContent = text;
  }

  async function current() {
    if (!supported()) {
      const msg = isIOS() && !isStandalone()
        ? 'En iPhone, primero instala esta app: botón compartir → "Agregar a inicio", y ábrela desde ahí.'
        : 'Este navegador no permite notificaciones. Prueba con Chrome (Android) o con la app instalada (iPhone).';
      render(false, msg);
      return;
    }
    if (Notification.permission === 'denied') {
      render(false, 'Las notificaciones están bloqueadas. Actívalas en los ajustes del teléfono para esta app.');
      return;
    }
    try {
      const r = await registration();
      const sub = await r.pushManager.getSubscription();
      const on = !!sub && !!loadState().id;
      render(on, on ? 'Activados: todos los días a las 10:00 y a las 16:00.' : 'Desactivados.');
    } catch {
      render(false, 'Desactivados.');
    }
  }

  async function enable() {
    const cfg = ctx.getCfg();
    if (!cfg) return;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      ctx.notice('err', 'Para recibir recordatorios, toca "Permitir" cuando el teléfono pregunte por las notificaciones.');
      return;
    }
    const r = await registration();
    let sub = await r.pushManager.getSubscription();
    if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64Url(VAPID_PUBLIC) });
    const state = loadState();
    const id = state.id || crypto.randomUUID();
    await saveDevice(cfg, { id, ...(await encrypt(sub.toJSON())), t: new Date().toISOString().slice(0, 10) });
    saveState({ id });
    ctx.notice('ok', '¡Listo! Recibirás un recordatorio todos los días a las 10:00 y a las 16:00.');
  }

  async function disable() {
    const cfg = ctx.getCfg();
    const state = loadState();
    const r = await registration();
    const sub = await r.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
    if (cfg && state.id) await removeDevice(cfg, state.id);
    saveState({});
    ctx.notice('ok', 'Recordatorios desactivados en este teléfono.');
  }

  sw.addEventListener('click', async () => {
    if (working) return;
    const turnOn = sw.getAttribute('aria-checked') !== 'true';
    working = true;
    render(turnOn, turnOn ? 'Activando…' : 'Desactivando…');
    ctx.notice('', '');
    try {
      if (turnOn) await enable();
      else await disable();
    } catch (err) {
      ctx.fail(err);
    } finally {
      working = false;
      await current();
    }
  });

  test.addEventListener('click', async () => {
    try {
      const r = await registration();
      (r.active || navigator.serviceWorker.controller).postMessage({
        type: 'test',
        body: '📸 Así se verá el recordatorio: "No se olvide de documentar sus trabajos subiendo las fotos".',
      });
    } catch (err) {
      ctx.fail(err);
    }
  });

  current();
}
