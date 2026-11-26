// 🧭 healer check y healer hook (2026-11-26, pedido del usuario: "usarla antes de cada commit ... un modo auto activable en el
// plugin o en cada integración directamente por el usuario"). Dos capas:
//
//   1. Local, en segundos, sin mandar nada: las reglas de Healer (reglas.mjs, empaquetado de sanador/src/chequeos) sobre el
//      proyecto, mostrando lo de los archivos del commit. Avisa y no frena, salvo que se pida --strict.
//   2. Completa (--full): el proyecto va a Healer en modo review_only (Pentágono, Semgrep y tests en el sandbox, sin IA y sin
//      reparar). Si Healer ya vigila el repo, NO se manda: la vigilancia revisa ese cambio después del push, y con IA. Lo
//      decide el cliente (pregunta antes) y lo vuelve a decidir el servidor (rechaza el envío si llega igual).
//
// Igual que el servidor MCP, este módulo no ejecuta ningún programa: la lista de archivos del commit se la pasa el hook (que es un
// script de git y corre git), y ESLint lo corre el hook si el proyecto lo tiene. El hook se instala solo si la persona lo pide.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rutasDelProyecto, archivosDelProyecto, resumenOmitidos } from './mcp/proyecto.mjs';

const API = (process.env.HEALER_API_URL || 'https://healer-api.meiti.dev').replace(/\/$/, '');
const VERSION = '0.7.1';
const es = /^es/i.test(process.env.HEALER_LANG || Intl.DateTimeFormat().resolvedOptions().locale || '');
const tx = (en, esp) => (es ? esp : en);

function leerClave() {
  const env = String(process.env.HEALER_API_KEY || process.env.CLAUDE_PLUGIN_OPTION_API_KEY || '').trim();
  if (env) return env;
  try { return String(JSON.parse(fs.readFileSync(path.join(os.homedir(), '.healer', 'config.json'), 'utf8')).api_key || '').trim(); } catch { return ''; }
}

async function api(metodo, ruta, cuerpo) {
  const clave = leerClave();
  if (!clave) throw new Error(tx('Healer is not connected on this computer. Run: npx @meiti/healer', 'Healer no está conectado en esta computadora. Corre: npx @meiti/healer'));
  const r = await fetch(API + ruta, { method: metodo, headers: { 'x-api-key': clave, 'content-type': 'application/json', 'user-agent': `healer-check/${VERSION}` }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`Healer ${r.status}: ${datos.error || datos.message || 'no detail'}`); e.status = r.status; e.datos = datos; throw e; }
  return datos;
}

// ───────────────────────────── Capa 1: local ─────────────────────────────

/**
 * Corre las reglas sobre el proyecto (respetando sus .gitignore) y devuelve los hallazgos. Con `archivos`, solo los que tocan
 * esos archivos (en una lista, si cualquiera de las dos está en el commit). Nada sale de la máquina.
 */
export async function revisarLocal({ raiz, archivos = null }) {
  const inicio = Date.now();
  const { correrReglasPropias } = await import('./reglas.mjs');
  const seguidas = new Set(rutasDelProyecto(raiz));
  const r = correrReglasPropias(raiz, (rel) => seguidas.has(rel));
  const delCommit = archivos ? new Set(archivos.map((a) => a.replace(/\\/g, '/'))) : null;
  const hallazgos = delCommit ? r.hallazgos.filter((h) => delCommit.has(h.archivo) || (h.tambien && delCommit.has(h.tambien.archivo))) : r.hallazgos;
  return { hallazgos, revisados: r.archivos_revisados, total_en_proyecto: r.hallazgos.length, errores: r.errores, ms: Date.now() - inicio };
}

export function textoLocal(r, { archivos = null } = {}) {
  const l = [];
  const donde = archivos ? tx(`in the ${archivos.length} file(s) of this commit`, `en los ${archivos.length} archivo(s) de este commit`) : tx('in the project', 'en el proyecto');
  if (!r.hallazgos.length) {
    l.push(`✓ Healer: ${tx('no findings', 'sin hallazgos')} ${donde} (${r.revisados} ${tx('files read', 'archivos leídos')}, ${(r.ms / 1000).toFixed(1)} s).`);
  } else {
    l.push(`⚠ Healer: ${r.hallazgos.length} ${tx('finding(s)', 'hallazgo(s)')} ${donde} (${(r.ms / 1000).toFixed(1)} s):`);
    for (const h of r.hallazgos.slice(0, 20)) l.push(`  ${h.severidad === 'error' ? '✗' : '!'} ${h.archivo}:${h.linea} [${h.regla}] ${h.mensaje}`);
    if (r.hallazgos.length > 20) l.push(`  ... ${tx('and', 'y')} ${r.hallazgos.length - 20} ${tx('more', 'más')}`);
    l.push(tx('  If something is on purpose, say so next to it: healer-ignore: <rule> <reason>', '  Si algo es a propósito, dilo junto al código: healer-ignore: <regla> <motivo>'));
  }
  if (archivos && r.total_en_proyecto > r.hallazgos.length) l.push(tx(`  (${r.total_en_proyecto - r.hallazgos.length} more in files outside this commit: npx @meiti/healer check)`, `  (${r.total_en_proyecto - r.hallazgos.length} más en archivos fuera de este commit: npx @meiti/healer check)`));
  if (r.errores.length) l.push(`  ${tx('Rules that could not run', 'Reglas que no pudieron correr')}: ${r.errores.join(' | ')}`);
  return l.join('\n');
}

// ───────────────────────────── Capa 2: completa (Healer, sin IA) ─────────────────────────────

// El repo de GitHub del proyecto (owner/repo), leído de .git/config: con él Healer sabe si ya lo vigila.
function carpetaGit(raiz) {
  const g = path.join(raiz, '.git');
  try {
    if (fs.statSync(g).isDirectory()) return g;
    const m = fs.readFileSync(g, 'utf8').match(/gitdir:\s*(.+)/); // worktree o submódulo
    return m ? path.resolve(raiz, m[1].trim()) : null;
  } catch { return null; }
}
export function repoDeGithub(raiz) {
  const git = carpetaGit(raiz);
  if (!git) return null;
  let config = '';
  try { config = fs.readFileSync(path.join(git, 'config'), 'utf8'); } catch { try { config = fs.readFileSync(path.join(path.dirname(path.dirname(git)), 'config'), 'utf8'); } catch { return null; } }
  const origen = config.split(/\n(?=\[)/).find((b) => /^\[remote "origin"\]/.test(b)) || '';
  const url = (origen.match(/^\s*url\s*=\s*(.+)$/m) || [])[1]?.trim() || '';
  const m = url.match(/github\.com[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  return m ? m[1].toLowerCase() : null;
}

export async function revisarCompleto({ raiz }) {
  const repo = repoDeGithub(raiz);
  if (repo) {
    const v = await api('GET', `/v1/watch?repo=${encodeURIComponent(repo)}`).catch(() => null);
    if (v?.watched) return { omitido: 'vigilancia', repo, texto: tx(`Healer already watches ${repo}: the full review runs by itself after the push (with AI), so nothing was sent now.`, `Healer ya vigila ${repo}: la revisión completa corre sola después del push (con IA), así que ahora no se mandó nada.`) };
  }
  const { files, binary_files, total, omitidos_lista } = archivosDelProyecto(raiz);
  if (!Object.keys(files).length) throw new Error(tx('No text files to send were found.', 'No encontré archivos de texto para mandar.'));
  const appId = `hook/${(repo || path.basename(raiz)).replace(/[^\w.\/-]/g, '-').slice(0, 80)}`;
  const envio = await api('POST', '/v1/repair', { files, ...(Object.keys(binary_files).length ? { binary_files } : {}), app_id: appId, review_only: true, ...(repo ? { repo } : {}), origin: 'healer-check', ...(omitidos_lista.length ? { omitted_files: omitidos_lista } : {}) });
  if (envio.status === 'covered_by_watch') return { omitido: 'vigilancia', repo, texto: envio.message };
  return {
    job_id: envio.job_id,
    texto: [
      tx(`Sent to Healer for a full review without AI: job ${envio.job_id}.`, `Mandado a Healer para una revisión completa sin IA: trabajo ${envio.job_id}.`),
      `${Object.keys(files).length} ${tx('files', 'archivos')}, ${Math.round(total / 1024)} KB.${omitidos_lista.length ? ` ${resumenOmitidos(omitidos_lista)}` : ''}`,
      tx('It takes a few minutes; the result shows in the Healer panel (meiti.dev/healer) under', 'Tarda unos minutos; el resultado aparece en el panel de Healer (meiti.dev/healer) en') + ` ${appId}.`
    ].join('\n')
  };
}

// ───────────────────────────── El hook ─────────────────────────────

const INICIO = '# >>> healer';
const FIN = '# <<< healer';
const EXT_ESLINT = '\\.(js|jsx|ts|tsx|mjs|cjs)$';

function bloquePreCommit({ bloquear }) {
  return [
    `${INICIO} (npx @meiti/healer hook off ${tx('removes it', 'lo quita')})`,
    // HEALER_CLI permite probar una versión local sin publicarla. Sin --strict, un fallo de npx (sin internet) nunca frena el commit.
    'HEALER_ARCHIVOS=$(git diff --cached --name-only --diff-filter=ACMR)',
    'if [ -n "$HEALER_ARCHIVOS" ]; then',
    `  printf '%s\\n' "$HEALER_ARCHIVOS" | \${HEALER_CLI:-npx -y @meiti/healer} check --stdin-files${bloquear ? ' --strict || exit 1' : ' || true'}`,
    // ESLint lo corre git, no Healer: solo si el proyecto lo tiene instalado y configurado, y solo sobre los archivos del commit.
    '  if [ -x node_modules/.bin/eslint ] && ls eslint.config.* .eslintrc* >/dev/null 2>&1; then',
    `    printf '%s\\n' "$HEALER_ARCHIVOS" | grep -E '${EXT_ESLINT}' | tr '\\n' '\\0' | xargs -0 -r node_modules/.bin/eslint --no-error-on-unmatched-pattern${bloquear ? ' || exit 1' : ' || true'}`,
    '  fi',
    'fi',
    FIN
  ].join('\n');
}
function bloquePostCommit() {
  return [
    `${INICIO} (npx @meiti/healer hook off ${tx('removes it', 'lo quita')})`,
    // En segundo plano: el commit ya terminó y no espera. Si Healer ya vigila el repo, no manda nada (ver revisarCompleto).
    '(${HEALER_CLI:-npx -y @meiti/healer} check --full --quiet >/dev/null 2>&1 &)',
    FIN
  ].join('\n');
}

// Dónde viven los hooks del repo. Si el repo eligió otra carpeta (core.hooksPath, como husky), esos archivos suelen ser del equipo:
// no se tocan, se dice qué agregar.
function carpetaHooks(raiz) {
  const git = carpetaGit(raiz);
  if (!git) return { error: tx('This folder is not a git repository.', 'Esta carpeta no es un repositorio de git.') };
  let config = '';
  try { config = fs.readFileSync(path.join(git, 'config'), 'utf8'); } catch { /* sin config */ }
  const propia = (config.match(/^\s*hooksPath\s*=\s*(.+)$/m) || [])[1]?.trim();
  if (propia) return { externa: propia };
  // En un worktree, los hooks son los del repo principal.
  const comun = fs.existsSync(path.join(git, 'commondir')) ? path.resolve(git, fs.readFileSync(path.join(git, 'commondir'), 'utf8').trim()) : git;
  return { carpeta: path.join(comun, 'hooks') };
}

function sinBloque(texto) {
  const i = texto.indexOf(INICIO), f = texto.indexOf(FIN);
  if (i < 0 || f < i) return texto;
  // Se va el bloque con su salto de línea: el hook que ya existía queda exactamente como estaba.
  return texto.slice(0, i) + texto.slice(f + FIN.length).replace(/^\r?\n/, '');
}
function conBloque(texto, bloque) {
  const limpio = sinBloque(texto || '#!/bin/sh\n');
  const lineas = limpio.split('\n');
  // Va después del shebang: un hook existente que termina con "exit 0" no lo saltea.
  const conShebang = lineas[0].startsWith('#!') ? 1 : 0;
  if (!conShebang) lineas.unshift('#!/bin/sh');
  lineas.splice(1, 0, bloque);
  return lineas.join('\n').replace(/\n*$/, '\n');
}

export function estadoHook(raiz) {
  const c = carpetaHooks(raiz);
  if (c.error) return { error: c.error };
  if (c.externa) return { externa: c.externa, activo: false };
  const leer = (n) => { try { return fs.readFileSync(path.join(c.carpeta, n), 'utf8'); } catch { return ''; } };
  const pre = leer('pre-commit'), post = leer('post-commit');
  return { activo: pre.includes(INICIO), bloquea: pre.includes(INICIO) && pre.includes('--strict'), completo: post.includes(INICIO), repo: repoDeGithub(raiz) };
}

export async function instalarHook(raiz, { bloquear = false, completo = false } = {}) {
  const c = carpetaHooks(raiz);
  if (c.error) throw new Error(c.error);
  if (c.externa) {
    return tx(`This repo keeps its hooks in "${c.externa}" (husky or core.hooksPath), which usually belongs to the whole team, so I did not touch it. Add this line to its pre-commit file:`, `Este repo guarda sus hooks en "${c.externa}" (husky o core.hooksPath), que suele ser de todo el equipo, así que no lo toqué. Agrega esta línea a su archivo pre-commit:`)
      + `\n  git diff --cached --name-only --diff-filter=ACMR | npx -y @meiti/healer check --stdin-files${bloquear ? ' --strict' : ''}`;
  }
  fs.mkdirSync(c.carpeta, { recursive: true });
  const escribir = (nombre, bloque) => {
    const ruta = path.join(c.carpeta, nombre);
    let actual = null;
    try { actual = fs.readFileSync(ruta, 'utf8'); } catch { /* no había */ }
    // Sin bloque que poner: si el archivo no existía no se crea, y si solo tenía el nuestro se borra (antes quedaba vacío).
    if (!bloque) {
      if (actual === null) return;
      const limpio = sinBloque(actual);
      if (!limpio.replace(/^#!.*$/m, '').trim()) { fs.rmSync(ruta, { force: true }); return; }
      fs.writeFileSync(ruta, limpio);
      return;
    }
    fs.writeFileSync(ruta, conBloque(actual ?? '', bloque));
    try { fs.chmodSync(ruta, 0o755); } catch { /* Windows: git for Windows lo corre igual */ }
  };
  escribir('pre-commit', bloquePreCommit({ bloquear }));
  escribir('post-commit', completo ? bloquePostCommit() : null);
  const lineas = [tx('Healer will check every commit in this repo, locally and in a few seconds (nothing leaves your computer).', 'Healer va a revisar cada commit de este repo, local y en unos segundos (no sale nada de tu computadora).')];
  lineas.push(bloquear ? tx('It blocks the commit if it finds an error in the files of the commit.', 'Frena el commit si encuentra un error en los archivos del commit.') : tx('It warns and never blocks the commit.', 'Avisa y nunca frena el commit.'));
  if (completo) {
    const repo = repoDeGithub(raiz);
    const v = repo ? await api('GET', `/v1/watch?repo=${encodeURIComponent(repo)}`).catch(() => null) : null;
    lineas.push(v?.watched
      ? tx(`Full review after each commit: on, but Healer already watches ${repo}, so it will not send anything while the watch is on (no double runs).`, `Revisión completa después de cada commit: encendida, pero Healer ya vigila ${repo}, así que no va a mandar nada mientras la vigilancia esté encendida (sin ejecuciones dobles).`)
      : tx('Full review after each commit: on (in Healer, without AI, in the background).', 'Revisión completa después de cada commit: encendida (en Healer, sin IA, en segundo plano).'));
  }
  return lineas.join('\n');
}

export function quitarHook(raiz) {
  const c = carpetaHooks(raiz);
  if (c.error) throw new Error(c.error);
  if (c.externa) return tx(`This repo keeps its hooks in "${c.externa}": remove the healer line from its pre-commit file.`, `Este repo guarda sus hooks en "${c.externa}": quita la línea de healer de su archivo pre-commit.`);
  for (const nombre of ['pre-commit', 'post-commit']) {
    const ruta = path.join(c.carpeta, nombre);
    let actual;
    try { actual = fs.readFileSync(ruta, 'utf8'); } catch { continue; }
    const limpio = sinBloque(actual);
    // Si solo quedaba nuestro bloque, el archivo se borra: un hook vacío no aporta nada.
    if (/^#!.*\n?\s*$/.test(limpio.trim() + '\n') || !limpio.trim()) fs.rmSync(ruta, { force: true }); else fs.writeFileSync(ruta, limpio);
  }
  return tx('Healer no longer checks the commits of this repo.', 'Healer ya no revisa los commits de este repo.');
}

// ───────────────────────────── Línea de comandos ─────────────────────────────

const leerStdin = () => new Promise((resolver) => {
  if (process.stdin.isTTY) return resolver('');
  let d = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { d += c; });
  process.stdin.on('end', () => resolver(d));
});

export async function cli(args) {
  const [comando, ...resto] = args;
  const raiz = process.cwd();
  if (comando === 'hook') {
    const accion = resto[0] || 'status';
    if (accion === 'on') console.log(await instalarHook(raiz, { bloquear: resto.includes('--block'), completo: resto.includes('--full') }));
    else if (accion === 'off') console.log(quitarHook(raiz));
    else {
      const e = estadoHook(raiz);
      if (e.error) { console.log(e.error); return 1; }
      if (e.externa) console.log(tx(`Hooks live in "${e.externa}" (husky or core.hooksPath): Healer does not manage them here.`, `Los hooks viven en "${e.externa}" (husky o core.hooksPath): Healer no los maneja desde acá.`));
      else console.log(e.activo ? `${tx('On', 'Encendido')}: ${e.bloquea ? tx('blocks on errors', 'frena con errores') : tx('warns only', 'solo avisa')}; ${tx('full review after commit', 'revisión completa después del commit')}: ${e.completo ? tx('on', 'encendida') : tx('off', 'apagada')}.` : tx('Off. Turn it on with: npx @meiti/healer hook on', 'Apagado. Se enciende con: npx @meiti/healer hook on'));
    }
    return 0;
  }
  // check
  const silencioso = resto.includes('--quiet');
  if (resto.includes('--full')) {
    try {
      const r = await revisarCompleto({ raiz });
      if (!silencioso) console.log(r.texto);
    } catch (e) { if (!silencioso) console.log(String(e?.message || e)); return silencioso ? 0 : 1; }
    return 0;
  }
  const archivos = resto.includes('--stdin-files') ? (await leerStdin()).split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : null;
  const r = await revisarLocal({ raiz, archivos });
  if (resto.includes('--json')) console.log(JSON.stringify(r));
  else if (!silencioso || r.hallazgos.length) console.log(textoLocal(r, { archivos }));
  return resto.includes('--strict') && r.hallazgos.some((h) => h.severidad === 'error') ? 1 : 0;
}
