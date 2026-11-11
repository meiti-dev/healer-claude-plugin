#!/usr/bin/env node
// 🩺 Healer para Claude Code (2026-11-09): servidor MCP sin dependencias (solo Node 18+), por stdio, JSON-RPC 2.0.
// Tres herramientas sobre la API pública de Healer (las mismas de la GitHub Action y del SDK):
//   healer_revisar   arma el proyecto (lo que git mandaría según los .gitignore, nunca archivos de secretos) y lo manda a reparar.
//   healer_resultado consulta el trabajo; al terminar guarda la propuesta y devuelve el resumen y el diff.
//   healer_aplicar   escribe los archivos corregidos SOLO si cada uno sigue igual a como se mandó (base_hashes).
// Nunca escribe nada sin que se llame healer_aplicar, y el comando /healer le pide a Claude confirmar antes.
// La clave llega SOLO por CLAUDE_PLUGIN_OPTION_API_KEY: en Claude Code es la opción sensible del plugin (la guarda el
// instalador de Healer); para otros agentes la pone healer-mcp.mjs del paquete npm, que vive fuera de este plugin.
// Nunca se imprime.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';

const VERSION = '0.3.5';
const API = (process.env.HEALER_API_URL || 'https://healer-api.meiti.dev').replace(/\/$/, '');
const leerClave = () => String(process.env.CLAUDE_PLUGIN_OPTION_API_KEY || '').trim();
const ESTADO = path.join(os.tmpdir(), 'healer-claude-code');
const TOPE_ARCHIVO = 1_000_000;
const TOPE_TOTAL = 18 * 1024 * 1024;
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

function archivosDelProyecto(raiz) {
  // Lo que git mandaría: respeta los .gitignore del proyecto (en cada carpeta) y .git/info/exclude.
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
  const files = {};
  let total = 0;
  let omitidos = 0;
  for (const ruta of rutas) {
    if (ruta.split('/').some((parte) => IGNORAR.has(parte))) continue;
    const p = path.join(raiz, ruta);
    let buf;
    try { const info = fs.statSync(p); if (!info.isFile() || info.size > TOPE_ARCHIVO) { omitidos++; continue; } buf = fs.readFileSync(p); } catch { continue; }
    if (buf.includes(0)) { omitidos++; continue; } // binario
    if (total + buf.length > TOPE_TOTAL) { omitidos++; continue; }
    files[ruta] = buf.toString('utf8');
    total += buf.length;
  }
  return { files, total, omitidos };
}

const sha256 = (texto) => crypto.createHash('sha256').update(texto, 'utf8').digest('hex');

// ───────────────────────────── API de Healer ─────────────────────────────

async function api(metodo, ruta, cuerpo) {
  const CLAVE = leerClave();
  if (!CLAVE) {
    throw new Error('Healer is not connected yet. To connect it, see meiti.dev/healer. In Claude Code you can also paste an API key in /plugin > healer > Configure and restart Claude Code.');
  }
  const r = await fetch(API + ruta, { method: metodo, headers: { 'x-api-key': CLAVE, 'content-type': 'application/json', 'user-agent': `healer-claude-code/${VERSION}` }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Healer answered ${r.status}: ${datos.error || 'no detail'}`);
  return datos;
}

const archivoDeTrabajo = (jobId) => path.join(ESTADO, `${String(jobId).replace(/[^\w-]/g, '')}.json`);

// ───────────────────────────── Herramientas ─────────────────────────────

async function revisar({ ruta, nivel, tests }) {
  const raiz = path.resolve(ruta || process.cwd());
  if (!fs.existsSync(raiz) || !fs.statSync(raiz).isDirectory()) throw new Error(`Folder not found: ${raiz}.`);
  const { files, total, omitidos } = archivosDelProyecto(raiz);
  if (!Object.keys(files).length) throw new Error('No text files to send were found in that folder.');
  if (Array.isArray(tests) && tests.length && !files['.healer.json']) files['.healer.json'] = JSON.stringify({ tests }, null, 2);
  const appId = `claude-code/${path.basename(raiz).replace(/[^\w.-]/g, '-').slice(0, 60) || 'proyecto'}`;
  const envio = await api('POST', '/v1/repair', { files, app_id: appId, ai_level: nivel === 'pro' ? 'pro' : 'free' });
  fs.mkdirSync(ESTADO, { recursive: true });
  fs.writeFileSync(archivoDeTrabajo(envio.job_id), JSON.stringify({ raiz, appId, enviado: new Date().toISOString() }));
  return [
    `Sent to Healer: job ${envio.job_id} (${envio.ai_level || nivel || 'free'} level).`,
    `${Object.keys(files).length} files, ${Math.round(total / 1024)} KB${omitidos ? `, ${omitidos} skipped (binary or too large)` : ''}.`,
    'Healer runs the tests in an isolated sandbox and repairs what fails. It usually takes a few minutes: check with healer_resultado.'
  ].join('\n');
}

async function resultado({ job_id, esperar_segundos }) {
  const limite = Date.now() + Math.min(Math.max(Number(esperar_segundos) || 45, 0), 50) * 1000;
  let r;
  for (;;) {
    r = await api('GET', `/v1/repair/${encodeURIComponent(job_id)}`);
    if (!['queued', 'running'].includes(r.status) || Date.now() >= limite) break;
    await new Promise((ok) => setTimeout(ok, 5000));
  }
  // El servidor manda en qué va (proyecto, minutos, etapa, lo hecho): se muestra eso en vez de solo "running".
  if (r.status === 'queued' || r.status === 'running') return `${r.progress?.message || `Still ${r.status}.`}\nCall healer_resultado again in a moment.\nJob id: ${job_id}`;
  if (r.status === 'error') return `Healer could not finish: ${r.error || 'unknown error'}.`;

  const meta = fs.existsSync(archivoDeTrabajo(job_id)) ? JSON.parse(fs.readFileSync(archivoDeTrabajo(job_id), 'utf8')) : null;
  const cambiados = r.changed_files || [];
  // La propuesta queda guardada para healer_aplicar (y para mirarla con calma).
  if (meta) fs.writeFileSync(archivoDeTrabajo(job_id), JSON.stringify({ ...meta, terminado: new Date().toISOString(), status: r.status, changed_files: cambiados, base_hashes: r.base_hashes || {}, files: Object.fromEntries(cambiados.map((c) => [c, r.files?.[c]])) }));

  const lineas = [];
  const titulo = { production_ready: 'Production ready: every check passes.', unresolved: r.partial_fix ? 'Partial delivery: some failures fixed, some remain.' : 'Unresolved: Healer could not leave every check passing.', unsupported_stack: 'Unsupported stack: no supported language was found to verify.' }[r.status] || r.status;
  lineas.push(`Result: ${titulo}`);
  if (r.failures) lineas.push(`Failures: ${r.failures.found ?? '?'} found, ${r.failures.fixed ?? '?'} fixed.${(r.failures.remaining || []).length ? ` Remaining: ${r.failures.remaining.map((f) => `[${f.origen}] ${String(f.detalle).slice(0, 160)}`).join(' | ')}` : ''}`);
  if (r.audit_report?.vulnerabilities_found) lineas.push(`Security: ${r.audit_report.vulnerabilities_found} findings (${(r.audit_report.findings || []).slice(0, 5).map((f) => `${f.archivo}:${f.linea} ${f.severidad}`).join(', ')}).`);
  if (r.pentagono_report?.puntaje != null) lineas.push(`Quality score (Pentagon): ${r.pentagono_report.puntaje}/100.`);
  if ((r.pending_improvements || []).length) lineas.push(`Non-blocking suggestions: ${r.pending_improvements.length} (not applied).`);
  if (!cambiados.length) {
    lineas.push('No file changes to apply.');
    return lineas.join('\n');
  }
  // Qué arregló en cada archivo, para que el usuario elija: se puede aplicar solo una parte (igual que el conector remoto).
  lineas.push(`Proposed changes in ${cambiados.length} file(s). What each one fixes:`);
  for (const ruta of cambiados) {
    const motivos = (r.history || []).filter((h) => h?.file === ruta).map((h) => String(h.error || '').replace(/\s+/g, ' ').slice(0, 200)).filter(Boolean);
    lineas.push(`- ${ruta}${motivos.length ? `\n    ${motivos.map((m) => `· ${m}`).join('\n    ')}` : ''}`);
  }
  lineas.push('Nothing has been written. Review each file against the rest of the project, show this to the user and apply only what they agree to, with healer_aplicar (pass "archivos" to apply only some files).');
  if (meta) {
    for (const ruta of cambiados) {
      const local = path.join(meta.raiz, ruta);
      lineas.push(`\n--- ${ruta}`);
      lineas.push(diffDe(fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : '', r.files?.[ruta] ?? ''));
    }
  }
  return lineas.join('\n');
}

// Diff unificado en JavaScript, con 2 líneas de contexto. Antes escribía los dos lados a disco y corría `git diff`:
// el escáner del directorio de plugins lo marcaba como "bajar y ejecutar", y además no hacía falta.
function diffDe(antes, despues) {
  if (antes === despues) return '(no differences)';
  const a = antes.split('\n');
  const b = despues.split('\n');
  // Se recortan el principio y el final iguales: la tabla de abajo solo cubre la parte que cambió.
  let ini = 0;
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
  let finA = a.length, finB = b.length;
  while (finA > ini && finB > ini && a[finA - 1] === b[finB - 1]) { finA--; finB--; }
  const ma = a.slice(ini, finA), mb = b.slice(ini, finB);
  if (ma.length * mb.length > 4_000_000) {
    // Cambio enorme: sin tabla, el bloque entero quitado y agregado.
    return [`@@ line ${ini + 1} @@`, ...ma.slice(0, 200).map((l) => `-${l}`), ...mb.slice(0, 200).map((l) => `+${l}`)].join('\n').slice(0, 12000);
  }
  const lcs = Array.from({ length: ma.length + 1 }, () => new Uint32Array(mb.length + 1));
  for (let i = ma.length - 1; i >= 0; i--) for (let j = mb.length - 1; j >= 0; j--) lcs[i][j] = ma[i] === mb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops = [];
  for (let k = Math.max(0, ini - 2); k < ini; k++) ops.push([' ', a[k]]);
  let i = 0, j = 0;
  while (i < ma.length || j < mb.length) {
    if (i < ma.length && j < mb.length && ma[i] === mb[j]) { ops.push([' ', ma[i]]); i++; j++; }
    else if (i < ma.length && (j === mb.length || lcs[i + 1][j] >= lcs[i][j + 1])) { ops.push(['-', ma[i]]); i++; }
    else { ops.push(['+', mb[j]]); j++; }
  }
  for (let k = finA; k < Math.min(a.length, finA + 2); k++) ops.push([' ', a[k]]);
  // Más de 4 líneas iguales seguidas en el medio se resumen con "...", como los trozos de git.
  const salida = [`@@ line ${Math.max(1, ini - 1)} @@`];
  let iguales = [];
  const volcar = (alFinal) => {
    if (iguales.length > 4 && !alFinal) salida.push(...iguales.slice(0, 2), '...', ...iguales.slice(-2));
    else salida.push(...iguales);
    iguales = [];
  };
  for (const [t, l] of ops) {
    if (t === ' ') { iguales.push(` ${l}`); continue; }
    volcar(false);
    salida.push(`${t}${l}`);
  }
  volcar(true);
  return salida.join('\n').slice(0, 12000);
}

async function aplicar({ job_id, archivos }) {
  const archivo = archivoDeTrabajo(job_id);
  if (!fs.existsSync(archivo)) throw new Error('No proposal stored for that job: call healer_resultado first.');
  const t = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  if (!t.changed_files?.length) return 'That job has no changes to apply.';
  // Solo lo que el usuario aprobó (si mandó "archivos"); un nombre que Healer no cambió frena todo.
  const pedidos = Array.isArray(archivos) && archivos.length ? archivos.map(String) : null;
  if (pedidos) {
    const ajenos = pedidos.filter((p) => !t.changed_files.includes(p));
    if (ajenos.length) throw new Error(`These are not among the files Healer changed: ${ajenos.join(', ')}. Changed files: ${t.changed_files.join(', ')}.`);
  }
  const elegidos = pedidos ?? t.changed_files;
  // La base tiene que coincidir: si el usuario tocó un archivo después de mandarlo, ese no se pisa.
  const distintos = elegidos.filter((ruta) => {
    const local = path.join(t.raiz, ruta);
    const actual = fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : null;
    return t.base_hashes[ruta] && (actual === null || sha256(actual) !== t.base_hashes[ruta]);
  });
  if (distintos.length) return `Not applied: these files changed since they were sent to Healer: ${distintos.join(', ')}. Send the project again with healer_revisar.`;
  for (const ruta of elegidos) {
    const destino = path.resolve(t.raiz, ruta);
    if (!destino.startsWith(t.raiz + path.sep)) throw new Error(`Path outside the project: ${ruta}`);
    if (typeof t.files[ruta] !== 'string') continue;
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, t.files[ruta]);
  }
  fs.writeFileSync(archivo, JSON.stringify({ ...t, aplicado: new Date().toISOString(), aplicados: elegidos }));
  const descartados = t.changed_files.filter((c) => !elegidos.includes(c));
  return `Applied: ${elegidos.length} file(s) written (${elegidos.join(', ')}).${descartados.length ? ` Left out as requested: ${descartados.join(', ')}.` : ''} Review the diff with git before committing.`;
}

const HERRAMIENTAS = [
  {
    name: 'healer_revisar',
    description: 'Send the project to Healer for independent verification: it runs the tests in an isolated sandbox, repairs what fails and returns only changes that leave the project better, never worse. Returns a job id; then call healer_resultado.',
    inputSchema: {
      type: 'object',
      properties: {
        ruta: { type: 'string', description: 'Project folder. Defaults to the current working directory.' },
        nivel: { type: 'string', enum: ['free', 'pro'], description: 'free (open models, no cost) or pro (paid models, uses your plan). Defaults to free.' },
        tests: { type: 'array', items: { type: 'string' }, description: 'Optional: the tests that define "fixed" (e.g. tests/test_api.py::test_login). Without this Healer runs the full suite.' }
      }
    },
    run: revisar
  },
  {
    name: 'healer_resultado',
    description: 'Check a Healer job. Waits up to ~45 s; if it is still running, call it again. When finished, returns the summary and the diff of the proposed changes, without writing anything.',
    inputSchema: { type: 'object', properties: { job_id: { type: 'string' }, esperar_segundos: { type: 'number', description: 'How long to wait for it to finish (0 to 50).' } }, required: ['job_id'] },
    run: resultado
  },
  {
    name: 'healer_aplicar',
    description: 'Write Healer\'s proposed changes into the project. Only call it after the user agreed. Pass "archivos" to write only the files the user approved (the rest are left out). It refuses any file that changed since it was sent.',
    inputSchema: { type: 'object', properties: { job_id: { type: 'string' }, archivos: { type: 'array', items: { type: 'string' }, description: 'Optional: paths (as listed by healer_resultado) of the only files to write.' } }, required: ['job_id'] },
    run: aplicar
  }
];

// ───────────────────────────── MCP por stdio ─────────────────────────────

const responder = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const fallar = (id, code, message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');

readline.createInterface({ input: process.stdin }).on('line', async (linea) => {
  let m;
  try { m = JSON.parse(linea); } catch { return; }
  if (m.id === undefined) return; // notificaciones (initialized, cancelled): nada que responder
  try {
    if (m.method === 'initialize') {
      // Mismo ícono y título que el conector remoto, para los clientes que los muestran (MCP 2025-11-25).
      const icono = (lado) => ({ src: `https://healer-api.meiti.dev/icono-${lado}.png?v=1`, mimeType: 'image/png', sizes: [`${lado}x${lado}`] });
      return responder(m.id, { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'healer', title: 'Healer', version: VERSION, websiteUrl: 'https://meiti.dev/healer', icons: [icono(512), icono(192), icono(64)] } });
    }
    if (m.method === 'ping') return responder(m.id, {});
    if (m.method === 'tools/list') return responder(m.id, { tools: HERRAMIENTAS.map(({ run, ...h }) => h) });
    if (m.method === 'tools/call') {
      const h = HERRAMIENTAS.find((x) => x.name === m.params?.name);
      if (!h) return fallar(m.id, -32602, `Unknown tool: ${m.params?.name}`);
      try {
        const texto = await h.run(m.params?.arguments || {});
        return responder(m.id, { content: [{ type: 'text', text: texto }] });
      } catch (e) {
        return responder(m.id, { content: [{ type: 'text', text: String(e?.message || e) }], isError: true });
      }
    }
    return fallar(m.id, -32601, `Method not supported: ${m.method}`);
  } catch (e) {
    return fallar(m.id, -32603, String(e?.message || e));
  }
});
