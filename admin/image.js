// Preparación de las fotos en el navegador: se reducen a 1600 px y se pasan a JPEG,
// para que la página cargue rápido aunque la foto original pese varios MB.

const MAX = 1600;
const QUALITY = 0.82;

async function decode(file) {
  try {
    // Respeta la orientación EXIF (las fotos de celular suelen venir "de lado")
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error('No se pudo abrir la foto. ¿Es una imagen?'));
      img.src = url;
    });
    return { img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  }
}

/** Devuelve { id, url (vista previa), base64, w, h, bytes } */
export async function prepare(file) {
  const src = await decode(file);
  const k = Math.min(1, MAX / Math.max(src.w, src.h));
  const w = Math.round(src.w * k);
  const h = Math.round(src.h * k);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // los PNG con transparencia quedan sobre blanco
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src.img, 0, 0, w, h);
  src.close();

  const blob = await new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('No se pudo procesar la foto.'))), 'image/jpeg', QUALITY));
  const dataUrl = await new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => fail(new Error('No se pudo leer la foto.'));
    r.readAsDataURL(blob);
  });

  return { id: crypto.randomUUID(), url: URL.createObjectURL(blob), base64: dataUrl.split(',')[1], w, h, bytes: blob.size };
}

const pad = (n) => String(n).padStart(2, '0');

/** foto-AAAAMMDD-HHMMSS-n.jpg */
export function photoName(index, now = new Date()) {
  const d = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `foto-${d}-${t}-${index + 1}.jpg`;
}

/** Nombre de carpeta seguro para una categoría nueva ("  cierres de   vidrio " → "Cierres de vidrio"). */
export function folderName(input) {
  const clean = String(input)
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean[0].toUpperCase() + clean.slice(1) : '';
}
