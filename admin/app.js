import { addPhotos, connect, friendly, listCategories } from './github.js';
import { folderName, photoName, prepare } from './image.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'gt_admin_cfg';

/* ───── Ajustes (se guardan solo en este teléfono) ───── */

// Valores por defecto: si la página está en usuario.github.io/repositorio/admin/, se deducen de la dirección
function defaults() {
  const host = location.hostname;
  if (host.endsWith('.github.io')) {
    const repo = location.pathname.split('/').filter(Boolean)[0];
    if (repo && repo !== 'admin') return { owner: host.split('.')[0], repo, branch: 'main' };
  }
  return { owner: 'Yunga17', repo: 'Globaltecni', branch: 'main' };
}

function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return c && c.token && c.owner && c.repo ? { branch: 'main', ...c } : null;
  } catch {
    return null;
  }
}
function saveCfg(c) {
  try {
    if (c) localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* modo privado: simplemente no se recuerda */
  }
}

let cfg = loadCfg();
let cats = null; // [{ name, dir, count }]
let selected = null; // dir de la categoría elegida, o 'NEW'
let photos = []; // fotos preparadas, pendientes de subir
let busy = null; // texto mientras trabaja

/* ───── Avisos ───── */
function notice(kind, text) {
  const box = $('notice');
  if (!text) {
    box.hidden = true;
    return;
  }
  box.className = 'notice' + (kind === 'err' ? ' err' : '');
  $('notice-text').textContent = text;
  box.hidden = false;
}
$('notice-close').addEventListener('click', () => notice('', ''));

/** Error de GitHub: se muestra en español. Si el token ya no sirve, vuelve a la pantalla de conexión. */
function fail(err) {
  if (err && err.status === 401) {
    saveCfg(null);
    cfg = null;
    show();
  }
  notice('err', friendly(err));
}

/* ───── Pantallas ───── */
function show() {
  const connected = !!cfg;
  $('view-setup').hidden = connected;
  $('view-main').hidden = !connected;
  $('btn-logout').hidden = !connected;
  if (!connected) {
    const d = { ...defaults(), ...(cfg || {}) };
    $('f-owner').value = d.owner;
    $('f-repo').value = d.repo;
    $('f-branch').value = d.branch;
    $('repo-hint').textContent = d.repo;
  } else {
    renderChips();
    renderPreviews();
  }
}

/* ───── Conexión ───── */
$('view-setup').addEventListener('submit', async (e) => {
  e.preventDefault();
  const next = {
    token: $('f-token').value.trim(),
    owner: $('f-owner').value.trim(),
    repo: $('f-repo').value.trim().replace(/\.git$/, ''),
    branch: $('f-branch').value.trim() || 'main',
  };
  if (!next.token || !next.owner || !next.repo) return notice('err', 'Completa el token, el usuario y el repositorio.');
  const btn = $('btn-connect');
  btn.disabled = true;
  btn.classList.add('busy');
  btn.textContent = 'Conectando…';
  notice('', '');
  try {
    cats = await connect(next);
    cfg = next;
    saveCfg(cfg);
    $('f-token').value = '';
    show();
    notice('ok', 'Conectado correctamente.');
  } catch (err) {
    notice('err', friendly(err));
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
    btn.textContent = 'Guardar y conectar';
  }
});

$('btn-logout').addEventListener('click', () => {
  saveCfg(null);
  cfg = null;
  cats = null;
  selected = null;
  notice('', '');
  show();
});

/* ───── Categorías ───── */
async function refresh() {
  cats = null;
  renderChips();
  $('btn-refresh').classList.add('spin');
  try {
    cats = await listCategories(cfg);
  } catch (err) {
    cats = [];
    fail(err);
  }
  $('btn-refresh').classList.remove('spin');
  renderChips();
}
$('btn-refresh').addEventListener('click', refresh);

function chip(text, count, pressed, extraClass, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip' + (extraClass ? ' ' + extraClass : '');
  b.setAttribute('aria-pressed', String(pressed));
  b.append(text);
  if (count !== null) {
    const s = document.createElement('small');
    s.textContent = count;
    b.append(' ', s);
  }
  b.addEventListener('click', onClick);
  return b;
}

function renderChips() {
  const wrap = $('chips');
  wrap.replaceChildren();
  if (cats === null) {
    for (let i = 0; i < 4; i++) {
      const s = document.createElement('span');
      s.className = 'skel';
      wrap.append(s);
    }
    return;
  }
  for (const c of cats) {
    wrap.append(chip(c.name, c.count, selected === c.dir, '', () => { selected = c.dir; renderChips(); }));
  }
  wrap.append(chip('+ Nueva categoría', null, selected === 'NEW', 'new', () => { selected = 'NEW'; renderChips(); $('f-newcat').focus(); }));
  $('f-newcat').hidden = selected !== 'NEW';
  const total = cats.reduce((a, c) => a + c.count, 0);
  $('cat-summary').textContent = cats.length ? `${cats.length} categorías · ${total} fotos en la galería` : '';
}

/** Categoría elegida (o nueva). Devuelve { name, dir } o null si falta algo. */
function resolveCategory() {
  if (!cats) {
    notice('err', 'Espera un momento: se están cargando las categorías.');
    return null;
  }
  if (!selected) {
    notice('err', 'Primero elige una categoría (paso 1).');
    return null;
  }
  if (selected !== 'NEW') return cats.find((c) => c.dir === selected);
  const name = folderName($('f-newcat').value);
  if (name.length < 2) {
    notice('err', 'Escribe el nombre de la nueva categoría (mínimo 2 letras).');
    return null;
  }
  if (name.toLowerCase() === 'todos') {
    notice('err', '"Todos" es un nombre reservado. Elige otro.');
    return null;
  }
  // Si ya existe (aunque cambien mayúsculas), se reutiliza
  const same = cats.find((c) => c.dir.toLowerCase() === name.toLowerCase() || c.name.toLowerCase() === name.toLowerCase());
  return same ? { name: same.name, dir: same.dir } : { name, dir: name };
}

/* ───── Fotos ───── */
function setBusy(text) {
  busy = text;
  for (const id of ['btn-camera', 'btn-gallery']) $(id).disabled = !!text;
  renderPreviews();
}

function renderPreviews() {
  const list = $('previews');
  list.replaceChildren();
  for (const p of photos) {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = p.url;
    img.alt = 'Vista previa de la foto';
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'x';
    x.textContent = '✕';
    x.setAttribute('aria-label', 'Quitar esta foto');
    x.disabled = !!busy;
    x.addEventListener('click', () => {
      URL.revokeObjectURL(p.url);
      photos = photos.filter((q) => q.id !== p.id);
      renderPreviews();
    });
    const kb = document.createElement('span');
    kb.className = 'kb';
    kb.textContent = `${Math.round(p.bytes / 1024)} KB`;
    li.append(img, x, kb);
    list.append(li);
  }
  $('previews-hint').hidden = photos.length > 0;
  const up = $('btn-upload');
  up.disabled = !!busy || photos.length === 0;
  up.classList.toggle('busy', !!busy);
  up.textContent = busy || (photos.length ? `Subir ${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}` : 'Subir');
}

// OJO: se copia la lista a un arreglo ANTES de reiniciar el input (el FileList es "vivo" y se vacía al reiniciar).
async function addFiles(files) {
  if (!files.length) return;
  notice('', '');
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    setBusy(`Preparando foto ${i + 1} de ${files.length}…`);
    try {
      photos.push(await prepare(files[i]));
    } catch {
      failed++;
    }
  }
  setBusy(null);
  if (failed) notice('err', `${failed} archivo(s) no se pudieron abrir como foto.`);
}

for (const [btn, input] of [['btn-camera', 'in-camera'], ['btn-gallery', 'in-gallery']]) {
  $(btn).addEventListener('click', () => $(input).click());
  $(input).addEventListener('change', (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    addFiles(files);
  });
}

/* ───── Subir ───── */
$('btn-upload').addEventListener('click', async () => {
  const cat = resolveCategory();
  if (!cat || !photos.length) return;
  notice('', '');
  const batch = [...photos];
  const now = new Date();
  setBusy(`Subiendo ${batch.length === 1 ? 'la foto' : batch.length + ' fotos'}…`);
  try {
    const done = await addPhotos(
      cfg,
      cat,
      batch.map((p, i) => ({ name: photoName(i, now), base64: p.base64 })),
    );
    for (const p of batch) URL.revokeObjectURL(p.url);
    photos = [];
    selected = done.dir;
    $('f-newcat').value = '';
    notice('ok', `${batch.length === 1 ? 'Foto agregada' : batch.length + ' fotos agregadas'} a "${done.name}". Aparecerá${batch.length === 1 ? '' : 'n'} en la página en 2 o 3 minutos.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setBusy(null);
    refresh();
  } catch (err) {
    setBusy(null);
    fail(err);
  }
});

/* ───── Inicio ───── */
show();
if (cfg) refresh();
