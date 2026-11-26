// 📁 [2026-11-26] Qué archivos del proyecto salen de la máquina: lo que git mandaría según los .gitignore, nunca archivos de
// secretos, con los mismos topes que el servidor. Vivía adentro de mcp/servidor.mjs; se separó para que healer check (check.mjs)
// use exactamente la misma selección que healer_revisar. Sin dependencias y sin ejecutar ningún programa.
import fs from 'node:fs';
import path from 'node:path';

const TOPE_ARCHIVO = 1_000_000;
// 🔒 [2026-11-21, metaxy] Un lockfile grande (uv.lock de 322 paquetes) pasaba el tope de 1 MB y no se mandaba: sin él, Healer
// instalaba otras versiones que las del dueño (un plugin de pytest más nuevo rompía todo). Los lockfiles pasan hasta 15 MB; el
// tope total no cambia.
const LOCKFILES = new Set(['uv.lock', 'poetry.lock', 'pdm.lock', 'Pipfile.lock', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock']);
// 📦 [PROYECTOS GRANDES, 2026-11-25] Misma regla que el servidor (src/mcp/seleccion.ts, valores por defecto de Core): el código
// tiene su tope propio, entra primero, y todo lo que queda afuera se lista y viaja con el trabajo (omitted_files).
const MB = 1024 * 1024;
const ES_CODIGO = /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|py|pyi|vue|svelte|json|toml|ya?ml|cfg|ini|sql|sh|css|scss|sass|less|lock)$/i;
const topeDe = (ruta) => (LOCKFILES.has(ruta.split('/').pop()) ? 15 * MB : ES_CODIGO.test(ruta) ? 4 * MB : TOPE_ARCHIVO);
const TOPE_TOTAL = 48 * MB;
const TEXTO_MOTIVO = { too_large: 'too large', total_limit: 'did not fit in the upload', binary_type: 'binary type Healer does not take', binary_too_large: 'binary over 1 MB' };
export function resumenOmitidos(lista, maximo = 8) {
  if (!lista?.length) return '';
  const tam = (b) => (b >= MB ? `${(b / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const partes = lista.slice(0, maximo).map((o) => `${o.path} (${tam(o.bytes)}, ${TEXTO_MOTIVO[o.reason] ?? o.reason})`);
  return `${lista.length} file(s) left out of this run: ${partes.join(', ')}${lista.length > maximo ? `, and ${lista.length - maximo} more` : ''}.`;
}
const IGNORAR = new Set(['.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '.next', 'coverage', '__pycache__', '.healer', '.turbo', '.cache']);

// ───────────────────────────── Proyecto ─────────────────────────────

// Archivos de secretos: nunca salen de la máquina, aunque el proyecto se haya olvidado de ignorarlos.
const SECRETO = /^(\.env(\..+)?|.*\.(pem|key|p12|pfx|keystore|jks)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.npmrc|\.pypirc|\.netrc|credentials(\.json)?)$/i;
const PLANTILLA_ENV = /^\.env\.(example|sample|template|dist)$/i;

// Una línea de .gitignore → expresión regular sobre la ruta relativa a la carpeta del .gitignore. Cubre lo que se usa en
// la práctica: comentarios, "!" para volver a incluir, "/" final (solo carpetas), "/" inicial o en el medio (anclado),
// *, ?, ** y [clases]. Antes esto lo hacía `git ls-files`; se hace acá para que el plugin no ejecute ningún programa.
function reglaGitignore(linea) {
  let l = linea.replace(/\r$/, '');
  if (!l.trim() || l.startsWith('#')) return null;
  l = l.replace(/(?<!\\)\s+$/, '');
  const negada = l.startsWith('!');
  if (negada) l = l.slice(1);
  l = l.replace(/^\\([#!])/, '$1');
  const soloCarpeta = l.endsWith('/');
  if (soloCarpeta) l = l.slice(0, -1);
  const anclada = l.includes('/');
  if (l.startsWith('/')) l = l.slice(1);
  let re = '';
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (c === '*' && l[i + 1] === '*') {
      if (l[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') { const fin = l.indexOf(']', i + 1); if (fin > i) { re += '[' + l.slice(i + 1, fin).replace(/^!/, '^').replace(/\\/g, '\\\\') + ']'; i = fin; } else re += '\\['; }
    else if (c === '\\' && i + 1 < l.length) { re += l[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i++; }
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return { negada, soloCarpeta, re: new RegExp(anclada ? `^${re}$` : `(?:^|/)${re}$`) };
}

function leerReglas(archivo, base) {
  try { return fs.readFileSync(archivo, 'utf8').split('\n').map(reglaGitignore).filter(Boolean).map((r) => ({ ...r, base })); } catch { return []; }
}

// Gana la última regla que coincide, como en git. `rel` es la ruta relativa a la raíz del proyecto.
function ignorado(rel, esCarpeta, reglas) {
  let resultado = false;
  for (const r of reglas) {
    if (r.soloCarpeta && !esCarpeta) continue;
    const local = r.base ? (rel.startsWith(r.base + '/') ? rel.slice(r.base.length + 1) : null) : rel;
    if (local !== null && r.re.test(local)) resultado = !r.negada;
  }
  return resultado;
}

// Las rutas que git mandaría (relativas a la raíz), sin leer su contenido: respeta los .gitignore del proyecto (en cada carpeta)
// y .git/info/exclude, y nunca incluye archivos de secretos. La usan archivosDelProyecto y healer check.
export function rutasDelProyecto(raiz) {
  const rutas = [];
  const recorrer = (dir, rel, reglas) => {
    const propias = [...reglas, ...leerReglas(path.join(dir, '.gitignore'), rel)];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORAR.has(e.name) || e.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (ignorado(r, e.isDirectory(), propias)) continue;
      if (e.isDirectory()) recorrer(path.join(dir, e.name), r, propias);
      else if (e.isFile() && (!SECRETO.test(e.name) || PLANTILLA_ENV.test(e.name))) rutas.push(r);
    }
  };
  recorrer(raiz, '', leerReglas(path.join(raiz, '.git', 'info', 'exclude'), ''));
  return rutas;
}

export function archivosDelProyecto(raiz) {
  const rutas = rutasDelProyecto(raiz);  // 🧱 [2026-11-21, pixelmatch-py: 39 tests con FileNotFoundError] Los binarios (imágenes, fixtures, datos) no se mandaban: los
  // tests que los leen fallaban en Healer y pasaban en la máquina del dueño. Van en binary_files (base64), hasta 1 MB cada uno,
  // sin compilados ni videos, y DESPUÉS de todo el código: nunca desplazan un archivo de texto del tope total.
  const files = {};
  const binary_files = {};
  const binariosPendientes = [];
  const textosPendientes = [];
  const omitidos_lista = [];
  let total = 0;
  const BINARIO_EXCLUIDO = /\.(pyc|pyo|so|dll|dylib|exe|o|a|obj|class|jar|war|whl|egg|mp4|mov|avi|mkv|webm|iso|dmg|7z|rar)$/i;
  for (const ruta of rutas) {
    if (ruta.split('/').some((parte) => IGNORAR.has(parte))) continue;
    const p = path.join(raiz, ruta);
    let buf;
    try {
      const info = fs.statSync(p);
      if (!info.isFile()) continue;
      // Un archivo más grande que cualquier tope ni se lee: se anota como demasiado grande (o binario, si lo parece por su tipo).
      if (info.size > Math.max(topeDe(ruta), TOPE_ARCHIVO)) { omitidos_lista.push({ path: ruta, reason: BINARIO_EXCLUIDO.test(ruta) ? 'binary_type' : 'too_large', bytes: info.size }); continue; }
      buf = fs.readFileSync(p);
    } catch { continue; }
    if (buf.includes(0)) {
      if (BINARIO_EXCLUIDO.test(ruta)) omitidos_lista.push({ path: ruta, reason: 'binary_type', bytes: buf.length });
      else if (buf.length > TOPE_ARCHIVO) omitidos_lista.push({ path: ruta, reason: 'binary_too_large', bytes: buf.length });
      else binariosPendientes.push([ruta, buf]);
      continue;
    }
    if (buf.length > topeDe(ruta)) { omitidos_lista.push({ path: ruta, reason: 'too_large', bytes: buf.length }); continue; }
    // Primero el código y la configuración; los demás textos después y los binarios al final.
    if (!ES_CODIGO.test(ruta)) { textosPendientes.push([ruta, buf]); continue; }
    if (total + buf.length > TOPE_TOTAL) { omitidos_lista.push({ path: ruta, reason: 'total_limit', bytes: buf.length }); continue; }
    files[ruta] = buf.toString('utf8');
    total += buf.length;
  }
  for (const [ruta, buf] of textosPendientes) {
    if (total + buf.length > TOPE_TOTAL) { omitidos_lista.push({ path: ruta, reason: 'total_limit', bytes: buf.length }); continue; }
    files[ruta] = buf.toString('utf8');
    total += buf.length;
  }
  for (const [ruta, buf] of binariosPendientes) {
    const b64 = buf.toString('base64');
    if (total + b64.length > TOPE_TOTAL) { omitidos_lista.push({ path: ruta, reason: 'total_limit', bytes: buf.length }); continue; }
    binary_files[ruta] = b64;
    total += b64.length;
  }
  return { files, binary_files, total, omitidos: omitidos_lista.length, omitidos_lista };
}
