#!/usr/bin/env node
// 🩺 Healer para Claude Code (2026-11-09): servidor MCP sin dependencias (solo Node 18+), por stdio, JSON-RPC 2.0.
// Tres herramientas sobre la API pública de Healer (las mismas de la GitHub Action y del SDK):
//   healer_revisar   arma el proyecto (lo que git versiona, o los archivos de texto si no hay git) y lo manda a reparar.
//   healer_resultado consulta el trabajo; al terminar guarda la propuesta y devuelve el resumen y el diff.
//   healer_aplicar   escribe los archivos corregidos SOLO si cada uno sigue igual a como se mandó (base_hashes).
// Nunca escribe nada sin que se llame healer_aplicar, y el comando /healer le pide a Claude confirmar antes.
// La clave sale de HEALER_API_KEY (se saca gratis en https://meiti.dev/healer) y nunca se imprime.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';

const VERSION = '0.1.0';
const API = (process.env.HEALER_API_URL || 'https://healer-api.meiti.dev').replace(/\/$/, '');
const CLAVE = process.env.HEALER_API_KEY || '';
const ESTADO = path.join(os.tmpdir(), 'healer-claude-code');
const TOPE_ARCHIVO = 1_000_000;
const TOPE_TOTAL = 18 * 1024 * 1024;
const IGNORAR = new Set(['.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '.next', 'coverage', '__pycache__', '.healer', '.turbo', '.cache']);

// ───────────────────────────── Proyecto ─────────────────────────────

function archivosDelProyecto(raiz) {
  let rutas;
  try {
    // Lo que git versiona más lo nuevo sin ignorar: respeta el .gitignore del proyecto.
    rutas = execFileSync('git', ['-C', raiz, 'ls-files', '-co', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter(Boolean);
  } catch {
    rutas = [];
    const recorrer = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (IGNORAR.has(e.name) || e.isSymbolicLink()) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) recorrer(p); else if (e.isFile()) rutas.push(path.relative(raiz, p).split(path.sep).join('/'));
      }
    };
    recorrer(raiz);
  }
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
  if (!CLAVE) throw new Error('Missing HEALER_API_KEY. Get one for free at https://meiti.dev/healer (panel > API Keys) and set it in your environment before opening Claude Code.');
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
  if (r.status === 'queued' || r.status === 'running') return `Still ${r.status === 'queued' ? 'queued' : 'running'}. Call healer_resultado again in a moment.`;
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
  lineas.push(`Proposed changes in ${cambiados.length} file(s): ${cambiados.join(', ')}.`);
  lineas.push('Nothing has been written. Show this to the user and apply only if they agree, with healer_aplicar.');
  if (meta) {
    for (const ruta of cambiados) {
      const local = path.join(meta.raiz, ruta);
      lineas.push(`\n--- ${ruta}`);
      lineas.push(diffDe(fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : '', r.files?.[ruta] ?? ''));
    }
  }
  return lineas.join('\n');
}

// Diff con git si está (lo más legible); si no, solo las líneas que cambiaron.
function diffDe(antes, despues) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'healer-diff-'));
  try {
    fs.writeFileSync(path.join(dir, 'a'), antes);
    fs.writeFileSync(path.join(dir, 'b'), despues);
    try {
      execFileSync('git', ['diff', '--no-index', '--no-color', '-U2', 'a', 'b'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return '(no differences)';
    } catch (e) {
      const salida = String(e.stdout || '');
      if (salida) return salida.split('\n').slice(4).join('\n').slice(0, 12000);
    }
  } catch { /* sin git */ } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const a = antes.split('\n');
  const b = despues.split('\n');
  const fuera = a.filter((l) => !b.includes(l)).slice(0, 40).map((l) => `- ${l}`);
  const dentro = b.filter((l) => !a.includes(l)).slice(0, 40).map((l) => `+ ${l}`);
  return [...fuera, ...dentro].join('\n') || '(whitespace only)';
}

async function aplicar({ job_id }) {
  const archivo = archivoDeTrabajo(job_id);
  if (!fs.existsSync(archivo)) throw new Error('No proposal stored for that job: call healer_resultado first.');
  const t = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  if (!t.changed_files?.length) return 'That job has no changes to apply.';
  // La base tiene que coincidir: si el usuario tocó un archivo después de mandarlo, ese no se pisa.
  const distintos = t.changed_files.filter((ruta) => {
    const local = path.join(t.raiz, ruta);
    const actual = fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : null;
    return t.base_hashes[ruta] && (actual === null || sha256(actual) !== t.base_hashes[ruta]);
  });
  if (distintos.length) return `Not applied: these files changed since they were sent to Healer: ${distintos.join(', ')}. Send the project again with healer_revisar.`;
  for (const ruta of t.changed_files) {
    const destino = path.resolve(t.raiz, ruta);
    if (!destino.startsWith(t.raiz + path.sep)) throw new Error(`Path outside the project: ${ruta}`);
    if (typeof t.files[ruta] !== 'string') continue;
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, t.files[ruta]);
  }
  fs.writeFileSync(archivo, JSON.stringify({ ...t, aplicado: new Date().toISOString() }));
  return `Applied: ${t.changed_files.length} file(s) written (${t.changed_files.join(', ')}). Review the diff with git before committing.`;
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
    description: 'Write Healer\'s proposed changes into the project. Only call it after the user agreed. It refuses any file that changed since it was sent.',
    inputSchema: { type: 'object', properties: { job_id: { type: 'string' } }, required: ['job_id'] },
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
      return responder(m.id, { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'healer', version: VERSION } });
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
