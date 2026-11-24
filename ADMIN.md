# Subir fotos a la galería desde el celular

La página `/admin/` permite agregar fotos a la galería sin tocar código ni saber de GitHub.
Funciona en Android y iPhone, sin instalar nada.

## Cómo se usa (cliente)

1. Abrir `https://<dirección-de-la-página>/admin/` (la misma dirección de la página, con `admin/` al final).
2. **Categoría:** tocar una existente, o **+ Nueva categoría** y escribir el nombre.
3. **Fotos:** *Tomar foto*, o *Galería* (se pueden elegir varias a la vez).
4. Tocar **Subir**.

La foto aparece en la página en 2 o 3 minutos (es lo que tarda GitHub Pages en publicar).
Las fotos se reducen solas a 1600 px, así que la página no se vuelve pesada. Las nuevas salen primero en su categoría.

**Borrar fotos:** arriba, tocar **Borrar fotos** (para volver a subir, **Subir fotos**). Elegir la categoría; abajo aparecen sus fotos. Tocar las que se quieren quitar (quedan marcadas en rojo),
tocar **Borrar** y confirmar. Dejan de verse en la página en 2 o 3 minutos. (Siguen guardadas en el historial de GitHub,
por si hubiera que recuperarlas.) Una foto recién subida aparece con su nombre en vez de la imagen hasta que GitHub Pages la publica.

**Instalarla como app (opcional):** en el celular, menú del navegador → *Agregar a la pantalla de inicio*
(iPhone: botón compartir → *Agregar a inicio*).

**Recordatorios:** al final de la pantalla, el interruptor **Recordatorios** activa un aviso diario a las 10:00 y a las 16:00
("No se olvide de documentar sus trabajos subiendo las fotos"). Se activa o desactiva en cada teléfono por separado.
Al activarlo, el teléfono pregunta si se permiten notificaciones: hay que tocar **Permitir**.
En iPhone solo funciona con la app instalada en la pantalla de inicio (iOS 16.4 o más nuevo) y abierta desde ahí.

### Cómo funcionan los recordatorios (para quien administra)

- Al activar, el teléfono queda anotado **cifrado** en `notificaciones/dispositivos.json` (el repositorio es público,
  así que nadie más puede leerlo ni usarlo).
- La acción `.github/workflows/recordatorios.yml` corre a las 10:00 y 16:00 (hora de Ecuador) y envía el aviso.
  GitHub a veces la arranca con unos minutos de demora.
- Necesita el secreto **`PUSH_SECRET`** en GitHub → *Settings → Secrets and variables → Actions*. Sin él la acción falla
  y no se envía nada. Si se pierde, hay que generar claves nuevas (y volver a activar los recordatorios en cada teléfono).
- Para probar sin esperar: GitHub → *Actions → Recordatorios de fotos → Run workflow* (se puede escribir un mensaje).
- **GitHub pausa las acciones programadas si el repositorio pasa 60 días sin cambios.** Subir o borrar fotos cuenta como cambio.
  Si se pausa, GitHub avisa por correo y se reactiva en *Actions → Recordatorios de fotos → Enable workflow*.
- Los teléfonos que desinstalan la app o quitan el permiso se borran solos de la lista.

## Conexión: se hace una sola vez, por quien administra el sitio

Necesita un *token* de GitHub. Se crea y se pega en el celular del cliente una sola vez, y el cliente no vuelve a verlo.

1. En GitHub, con la cuenta que tiene acceso al repositorio: <https://github.com/settings/personal-access-tokens/new>
2. **Repository access** → *Only select repositories* → elegir **solo** este repositorio.
3. **Permissions → Repository permissions → Contents: Read and write**. Nada más.
4. Elegir la expiración más larga permitida → *Generate token* → copiar el que empieza con `github_pat_`.
5. En `/admin/` pegar el token y tocar **Guardar y conectar**. (Mejor hacerlo en persona en el celular del cliente, y no mandar el token por mensaje.)

### Seguridad

- El token se guarda **solo en el navegador de ese celular**; no está en el código ni en el repositorio.
- Con ese token solo se puede cambiar **ese repositorio** (no otros, ni la cuenta, ni los *workflows*).
- `/admin/` solo se comunica con `api.github.com` (lo exige su política de seguridad, CSP) y no sale en buscadores.
- **Si el celular se pierde o el token se filtra:** GitHub → Settings → Developer settings → Fine-grained tokens → **Revoke**, y crear otro.
- **Los tokens vencen** (máximo un año). Cuando pase, `/admin/` avisa "El token no es válido o ya venció": crear otro y volver a conectar. Conviene anotarlo en el calendario.
- Idealmente el token lo crea una cuenta que solo tenga acceso a este repositorio (por ejemplo una cuenta de GitHub dedicada, agregada como colaboradora).

## Cómo funciona por dentro

- `galeria.json` es la lista de categorías y fotos. **La página principal (`index.html`) la lee** al cargar para armar las pestañas y las fotos.
  Si no se puede leer, usa la lista que lleva incluida como respaldo.
- Al subir, `/admin/` crea **un solo commit** con las fotos nuevas (`img/Galeria/<Categoría>/foto-AAAAMMDD-HHMMSS-n.jpg`) y el `galeria.json` actualizado.
  O se publica todo o nada, y si dos personas suben a la vez, se reintenta solo.
- Una categoría nueva crea su carpeta en `img/Galeria/` y su pestaña aparece sola.

Archivos: `admin/index.html`, `admin/app.js` (pantalla), `admin/github.js` (API de GitHub), `admin/image.js` (reducir fotos), `admin/admin.css`.

## Limitaciones actuales

- Desde `/admin/` se **agregan** y se **borran** fotos (el borrado también es un solo commit: quita los archivos y los saca de `galeria.json`).
  Para mover una foto de categoría o cambiar el orden, se edita `galeria.json` desde GitHub.
- Si se agregan fotos a mano al repositorio (sin `/admin/`), hay que anotarlas también en `galeria.json` para que aparezcan.
- Hay una foto de prueba (`img/Galeria/Enmarcados/foto-20261110-200949-1.jpg`) que no está en `galeria.json`, por lo que no se muestra. Se puede borrar.
