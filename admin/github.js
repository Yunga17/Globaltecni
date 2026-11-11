// Cliente mínimo de la API de GitHub para la página /admin/.
// Solo habla con api.github.com y solo necesita un token con permiso "Contents: Read and write".
//
// Para agregar fotos se hace UN solo commit con todo (fotos + galeria.json actualizado):
// o se publica todo, o nada. Así la galería nunca apunta a una foto que no existe.

const API = 'https://api.github.com';
const MANIFEST_PATH = 'galeria.json';
const PHOTOS_DIR = 'img/Galeria';

export class GhError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const repoUrl = (c) => `/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;
const refPath = (c) => `heads/${c.branch.split('/').map(encodeURIComponent).join('/')}`;

async function gh(c, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${c.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* respuesta sin cuerpo */
  }
  if (!res.ok) throw new GhError((data && data.message) || `Error ${res.status}`, res.status);
  return data;
}

/** Mensaje en español, entendible para alguien que no es técnico. */
export function friendly(e) {
  if (e instanceof GhError) {
    if (e.status === 401) return 'El token no es válido o ya venció. Crea uno nuevo en GitHub y vuelve a conectar.';
    if (e.status === 403 || e.status === 404)
      return 'El token no tiene permiso para este repositorio. Debe tener "Contents: Read and write" sobre ese repositorio, y el usuario, repositorio y rama deben estar bien escritos.';
    if (e.status === 409 || e.status === 422) return 'GitHub rechazó el cambio (posible conflicto). Inténtalo de nuevo.';
    return e.message;
  }
  if (e instanceof TypeError) return 'Sin conexión a internet. Revisa tu señal e inténtalo otra vez.';
  return e && e.message ? e.message : 'Ocurrió un error inesperado.';
}

// --- base64 <-> texto UTF-8 ---
const utf8ToB64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64ToUtf8 = (b64) => {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

function parseManifest(json) {
  if (!json || !Array.isArray(json.categories)) throw new Error('El archivo galeria.json no tiene el formato esperado.');
  return json;
}

/** Lee galeria.json en una versión concreta (rama o commit). */
async function readManifest(c, ref) {
  try {
    const f = await gh(c, 'GET', `${repoUrl(c)}/contents/${MANIFEST_PATH}?ref=${encodeURIComponent(ref)}`);
    return parseManifest(JSON.parse(b64ToUtf8(f.content)));
  } catch (e) {
    if (e instanceof GhError && e.status === 404) {
      throw new GhError('No encuentro galeria.json en el repositorio. Revisa que la rama sea la correcta.', 0);
    }
    throw e;
  }
}

/** Comprueba que el token funciona, que puede escribir, y devuelve las categorías actuales. */
export async function connect(c) {
  const repo = await gh(c, 'GET', repoUrl(c));
  if (repo.permissions && repo.permissions.push === false) {
    throw new GhError('El token solo puede leer el repositorio. Necesita "Contents: Read and write".', 403);
  }
  return listCategories(c);
}

/** Categorías con su cantidad de fotos: [{ name, dir, count }] */
export async function listCategories(c) {
  const m = await readManifest(c, c.branch);
  return m.categories.map((x) => ({ name: x.name, dir: x.dir, count: x.files.length }));
}

/**
 * Sube las fotos y las anota en galeria.json, todo en un solo commit.
 *   category: { name, dir }  (name = título visible, dir = carpeta dentro de img/Galeria)
 *   photos:   [{ name: 'foto-….jpg', base64 }]   (las primeras de la lista quedan primero en la galería)
 */
export async function addPhotos(c, category, photos) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // 1) Estado actual de la rama
      const ref = await gh(c, 'GET', `${repoUrl(c)}/git/ref/${refPath(c)}`);
      const parentSha = ref.object.sha;
      const parent = await gh(c, 'GET', `${repoUrl(c)}/git/commits/${parentSha}`);

      // 2) galeria.json de ESA versión (para no pisar cambios de otra persona)
      const manifest = await readManifest(c, parentSha);
      let cat = manifest.categories.find((x) => x.dir === category.dir) || manifest.categories.find((x) => x.name === category.name);
      if (!cat) {
        cat = { name: category.name, dir: category.dir, files: [] };
        manifest.categories.push(cat);
      }
      cat.files = [...photos.map((p) => p.name), ...cat.files.filter((f) => !photos.some((p) => p.name === f))];

      // 3) Las fotos como archivos del repositorio
      const tree = [];
      for (const p of photos) {
        const blob = await gh(c, 'POST', `${repoUrl(c)}/git/blobs`, { content: p.base64, encoding: 'base64' });
        tree.push({ path: `${PHOTOS_DIR}/${cat.dir}/${p.name}`, mode: '100644', type: 'blob', sha: blob.sha });
      }
      tree.push({ path: MANIFEST_PATH, mode: '100644', type: 'blob', content: JSON.stringify(manifest, null, 2) + '\n' });

      // 4) Un commit con todo, y se mueve la rama (falla si alguien más cambió la rama justo ahora)
      const newTree = await gh(c, 'POST', `${repoUrl(c)}/git/trees`, { base_tree: parent.tree.sha, tree });
      const n = photos.length;
      const commit = await gh(c, 'POST', `${repoUrl(c)}/git/commits`, {
        message: `Agregar ${n === 1 ? 'foto' : n + ' fotos'} a ${cat.name}`,
        tree: newTree.sha,
        parents: [parentSha],
      });
      await gh(c, 'PATCH', `${repoUrl(c)}/git/refs/${refPath(c)}`, { sha: commit.sha, force: false });
      return { dir: cat.dir, name: cat.name };
    } catch (e) {
      last = e;
      // 409/422: la rama cambió mientras tanto -> se repite todo con la versión nueva
      if (!(e instanceof GhError) || ![409, 422].includes(e.status)) throw e;
      await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
    }
  }
  throw last;
}
