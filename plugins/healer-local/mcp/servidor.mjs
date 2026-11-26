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
import { archivosDelProyecto, resumenOmitidos } from './proyecto.mjs';
import { revisarLocal, textoLocal, revisarCompleto, instalarHook, quitarHook, estadoHook } from '../check.mjs';

const VERSION = '0.8.0';
const API = (process.env.HEALER_API_URL || 'https://healer-api.meiti.dev').replace(/\/$/, '');
const leerClave = () => String(process.env.CLAUDE_PLUGIN_OPTION_API_KEY || '').trim();
const ESTADO = path.join(os.tmpdir(), 'healer-claude-code');

const sha256 = (texto) => crypto.createHash('sha256').update(texto, 'utf8').digest('hex');

// ───────────────────────────── API de Healer ─────────────────────────────

async function api(metodo, ruta, cuerpo) {
  const CLAVE = leerClave();
  if (!CLAVE) {
    throw new Error('Healer is not connected yet. To connect it, see meiti.dev/healer. In Claude Code you can also paste an API key in /plugin > healer > Configure and restart Claude Code.');
  }
  const r = await fetch(API + ruta, { method: metodo, headers: { 'x-api-key': CLAVE, 'content-type': 'application/json', 'user-agent': `healer-claude-code/${VERSION}` }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`Healer answered ${r.status}: ${datos.error || datos.message || 'no detail'}`); e.status = r.status; e.datos = datos; throw e; }
  return datos;
}

const archivoDeTrabajo = (jobId) => path.join(ESTADO, `${String(jobId).replace(/[^\w-]/g, '')}.json`);

// ───────────────────────────── Herramientas ─────────────────────────────

async function revisar({ ruta, nivel, tests, confirmar_free, solo_revisar, bug }) {
  const raiz = path.resolve(ruta || process.cwd());
  if (!fs.existsSync(raiz) || !fs.statSync(raiz).isDirectory()) throw new Error(`Folder not found: ${raiz}.`);
  const { files, binary_files, total, omitidos_lista } = archivosDelProyecto(raiz);
  if (!Object.keys(files).length) throw new Error('No text files to send were found in that folder.');
  if (Array.isArray(tests) && tests.length && !files['.healer.json']) files['.healer.json'] = JSON.stringify({ tests }, null, 2);
  const appId = `claude-code/${path.basename(raiz).replace(/[^\w.-]/g, '-').slice(0, 60) || 'proyecto'}`;
  // 🔐 [2026-11-16] Sin nivel propio (antes free por defecto): vale la política de la organización (pro salvo que el dueño cambie).
  // Si tocaría free y la organización pide preguntar, Healer responde 409 y no se encola nada.
  let envio;
  try {
    envio = await api('POST', '/v1/repair', { files, ...(Object.keys(binary_files).length ? { binary_files } : {}), app_id: appId, ...(nivel === 'free' || nivel === 'pro' ? { ai_level: nivel } : {}), ...(confirmar_free === true ? { confirm_free: true } : {}), ...(solo_revisar === true ? { review_only: true } : {}), ...(typeof bug === 'string' && bug.trim() ? { bug_report: bug.trim().slice(0, 4000) } : {}), ...(omitidos_lista.length ? { omitted_files: omitidos_lista } : {}) });
  } catch (e) {
    if (e.status === 409) return `Needs the user's confirmation, nothing was queued: ${e.datos?.message}\nIn this tool, "confirm_free" is confirmar_free: true${e.datos?.reason === 'cupo_agotado' ? ', and "review_only" is solo_revisar: true' : ''}.`;
    throw e;
  }
  fs.mkdirSync(ESTADO, { recursive: true });
  fs.writeFileSync(archivoDeTrabajo(envio.job_id), JSON.stringify({ raiz, appId, enviado: new Date().toISOString() }));
  return [
    `Sent to Healer: job ${envio.job_id} (${envio.ai_level === 'none' ? 'review only, no AI' : `${envio.ai_level} level`}${envio.ai_level_reason ? `, ${({ pedido: 'requested', organizacion: 'organization default', cupo: 'single repairs', confirmado: 'confirmed by the user', auto: 'organization allows free automatically', solo_revisar: 'review only' })[envio.ai_level_reason] || envio.ai_level_reason}` : ''}).`,
    `${Object.keys(files).length} files${Object.keys(binary_files).length ? ` + ${Object.keys(binary_files).length} binary` : ''}, ${Math.round(total / 1024)} KB.${omitidos_lista.length ? ` ${resumenOmitidos(omitidos_lista)}` : ''}`,
    'Healer runs the tests in an isolated sandbox and repairs what fails. It usually takes a few minutes: check with healer_resultado.'
  ].join('\n');
}

// 🖥️ [REVISIÓN DE PANTALLA, 2026-11-15] Healer levanta la app en su sandbox y revisa sus páginas, sin reparar ni usar IA.
async function revisarPantalla({ ruta, start_command, port, pages }) {
  const raiz = path.resolve(ruta || process.cwd());
  if (!fs.existsSync(raiz) || !fs.statSync(raiz).isDirectory()) throw new Error(`Folder not found: ${raiz}.`);
  const { files, total, omitidos_lista } = archivosDelProyecto(raiz);
  if (!Object.keys(files).length) throw new Error('No text files to send were found in that folder.');
  const appId = `claude-code/${path.basename(raiz).replace(/[^\w.-]/g, '-').slice(0, 60) || 'proyecto'}`;
  // Sin start_command, port ni pages, Healer los busca (.healer.json "screen", la última corrida que funcionó, package.json).
  const envio = await api('POST', '/v1/screen', { files, app_id: appId, start_command: start_command || undefined, port: port || undefined, pages: Array.isArray(pages) && pages.length ? pages : undefined });
  return [
    `Screen review started: job ${envio.job_id}.`,
    `${Object.keys(files).length} files, ${Math.round(total / 1024)} KB.${omitidos_lista.length ? ` ${resumenOmitidos(omitidos_lista)}` : ''}`,
    'Healer starts the app in its sandbox and checks the pages, without repairing anything. It usually takes under a minute: check with healer_resultado.'
  ].join('\n');
}

// El informe de una revisión de pantalla: estado de cada página, lo que se esperaba y la prueba (igual que el conector remoto).
function informePantalla(r) {
  const lineas = [];
  const titulo = { checked: 'Screen review finished.', did_not_start: 'The app did not start, so no page could be checked.', unsupported_stack: 'Unsupported stack: no supported language was found to install and start the app.' }[r.status] || r.status;
  lineas.push(`Result: ${titulo}`, `Summary: ${r.message}`);
  if (r.start) lineas.push(`Started with: "${r.start.command}" on port ${r.start.port} · source: ${r.start.source} (${r.start.detail}) · ${r.start.verified ? 'verified: the app answered' : 'not verified: the app did not answer'}.`);
  for (const s of r.missing_services || []) lineas.push(`Missing service: ${s.address} (${s.requests} request(s) with no answer${s.found_in ? `; it seems to be in ${s.found_in}` : ''}). ${s.hint}`);
  if (r.server_log) lineas.push('Server log (last lines):', ...String(r.server_log).split('\n').slice(-25).map((l) => `    ${l}`));
  if (r.ms) lineas.push(`Time: ${Math.round((r.ms.total || 0) / 1000)} s (install ${Math.round((r.ms.install || 0) / 1000)} s, start ${Math.round((r.ms.start || 0) / 1000)} s, pages ${Math.round((r.ms.pages || 0) / 1000)} s).`);
  for (const pg of r.pages || []) {
    lineas.push('', `Page ${pg.path}: ${pg.state}${pg.http ? ` (HTTP ${pg.http})` : ''}${pg.title ? `, title "${pg.title}"` : ''}`);
    if (pg.reasons?.length) lineas.push(`  Why: ${pg.reasons.join('; ')}`);
    for (const e of pg.expectations || []) lineas.push(`  ${e.answer} ${JSON.stringify(e.expectation)} · ${e.proof}`);
    if (pg.failed_requests?.length) lineas.push(`  Requests that failed: ${pg.failed_requests.join(', ')}`);
    if (pg.page_errors?.length) lineas.push(`  Page errors: ${pg.page_errors.slice(0, 5).join(' | ')}`);
    if (pg.visual_issues?.length) lineas.push(`  Visual issues: ${pg.visual_issues.slice(0, 8).map((v) => `${v.type}${v.element ? ` at ${v.element}` : ''}: ${v.detail}`).join(' | ')}`);
    if (pg.map) lineas.push('  Screen map:', ...String(pg.map).split('\n').slice(0, 60).map((l) => `    ${l}`));
  }
  lineas.push('', 'CANNOT PROVE means the page did not load or is not the expected one: report it as such, never as "it is not there". Nothing was changed in the project.');
  return lineas.join('\n');
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
  // [2026-11-23] Igual que el conector remoto: el cliente no recibe avisos y deja de preguntar al terminar su turno.
  if (r.status === 'queued' || r.status === 'running') return `${r.progress?.message || `Still ${r.status}.`}\nKeep checking: call healer_resultado again now with the same job id. Do not tell the user it finished until this tool returns the result.\nIf you have to end your turn first, tell the user it is still running and that they can ask you to check job ${job_id} again.\nJob id: ${job_id}`;
  if (r.status === 'error') return `Healer could not finish: ${r.error || 'unknown error'}.`;
  if (r.tipo === 'pantalla') return informePantalla(r);

  const meta = fs.existsSync(archivoDeTrabajo(job_id)) ? JSON.parse(fs.readFileSync(archivoDeTrabajo(job_id), 'utf8')) : null;
  const cambiados = r.changed_files || [];
  // La propuesta queda guardada para healer_aplicar (y para mirarla con calma).
  if (meta) fs.writeFileSync(archivoDeTrabajo(job_id), JSON.stringify({ ...meta, terminado: new Date().toISOString(), status: r.status, changed_files: cambiados, base_hashes: r.base_hashes || {}, ...(r.requires_acceptance ? { requires_acceptance: r.requires_acceptance } : {}), files: Object.fromEntries(cambiados.map((c) => [c, r.files?.[c]])) }));

  const lineas = [];
  const titulo = r.not_accepted ? `Not accepted: ${r.not_accepted.reason} Healer only reviewed it; nothing was repaired and it does not count as a repair success or failure.` : { production_ready: 'Production ready: every check passes.', unresolved: r.partial_fix ? 'Partial delivery: some failures fixed, some remain.' : 'Unresolved: Healer could not leave every check passing.', unsupported_stack: 'Unsupported stack: no supported language was found to verify.' }[r.status] || r.status;
  lineas.push(`Result: ${titulo}`);
  // 🔐 [2026-11-16] Siempre se dice con qué nivel corrió y por qué.
  if (r.ai_level) lineas.push(`AI level: ${r.ai_level === 'none' ? 'none (review only)' : r.ai_level}${r.ai_level_reason ? ` (${({ pedido: 'requested', organizacion: 'organization default', cupo: 'single repairs', confirmado: 'confirmed by the user', auto: 'organization allows free automatically', solo_revisar: 'review only', benchmark: 'benchmark' })[r.ai_level_reason] || r.ai_level_reason})` : ''}.`);
  // 📋 [2026-11-14, pedido del usuario: "el usuario no ve lo que vemos, no lo demos por hecho"] El informe de Healer (report):
  // qué se reparó, tests antes y después, y cada pendiente con qué es, por qué quedó y qué hace falta. Sin informe (Healer
  // de antes), la línea de fallas de siempre.
  // 🔬 [2026-11-16] Reproducir antes de reparar: si vino con bug_report, el test que lo reprodujo y si pasa después.
  if (r.reproduction) {
    const rp = r.reproduction;
    lineas.push(rp.status === 'reproduced'
      ? `Bug reproduced with a test (${rp.test_file}): it failed with the original code${rp.passes_after === true ? ' and passes after the repair' : rp.passes_after === false ? ', and it STILL FAILS after the repair' : ''}. Offer the user to add this test to the project so the bug cannot come back:\n${String(rp.test_content || '').split('\n').map((l) => '    ' + l).join('\n')}`
      : `Bug NOT reproduced (${rp.status}): ${rp.message}`);
  }
  if (r.report) {
    lineas.push(`Summary: ${r.report.headline}`);
    // ⚖️ [2026-11-16] Una dependencia que baja el puntaje: lo primero que tiene que saber la persona.
    if (r.requires_acceptance) lineas.push(`NEEDS THE USER'S ACCEPTANCE (tell them before anything else): ${r.requires_acceptance.reason} Quality score ${r.requires_acceptance.pentagono_before} → ${r.requires_acceptance.pentagono_after}. Apply it only if they accept (healer_aplicar with acepto_puntaje_menor: true), or leave out ${r.requires_acceptance.files.join(', ')}.`);
    for (const x of r.report.fixed || []) lineas.push(`Fixed: ${x}`);
    if ((r.report.pending || []).length) {
      lineas.push('Pending (tell the user every item and what it needs; they decide whether to send it again or handle it themselves):');
      for (const p of r.report.pending) lineas.push(`- [${p.check}] ${p.what} Why: ${p.why} Needs: ${p.needs}`);
    }
    for (const x of r.report.support_updates || []) lineas.push(`Optional support update: ${x}`);
  } else if (r.failures) lineas.push(`Failures: ${r.failures.found ?? '?'} found, ${r.failures.fixed ?? '?'} fixed.${(r.failures.remaining || []).length ? ` Remaining: ${r.failures.remaining.map((f) => `[${f.origen}] ${String(f.detalle).slice(0, 160)}`).join(' | ')}` : ''}`);
  if (r.audit_report?.vulnerabilities_found) lineas.push(`Security: ${r.audit_report.vulnerabilities_found} findings (${(r.audit_report.findings || []).slice(0, 5).map((f) => `${f.archivo}:${f.linea} ${f.severidad}`).join(', ')}).`);
  if (r.files_left_out?.length) lineas.push(`${resumenOmitidos(r.files_left_out)} The checks ran without them: if one is needed to build or test, the result can fail for that reason.`);
  // 📋 [2026-11-25] De dónde sale el puntaje (pentagono_report.desglose, lo calcula Healer) y qué dice cada sugerencia.
  const pr = r.pentagono_report;
  if (pr?.puntaje != null) {
    lineas.push(`Quality score (Pentagon): ${pr.puntaje}/100${pr.critico ? ' (needs attention)' : ''}.${pr.desglose ? ' Where the points went:' : ''}`);
    const nombres = { quality: 'Code quality', dead_code: 'Dead code', dependencies: 'Dependencies (known vulnerabilities)' };
    for (const p of pr.desglose || []) {
      const sev = Object.entries(p.by_severity || {}).map(([s, n]) => `${n} ${s}`).join(', ');
      lineas.push(`- ${nombres[p.parte] || p.parte} (${(p.tools || []).join(', ')}): -${p.deducted} of max ${p.cap}${p.at_cap ? ' (at its cap)' : ''}; ${p.findings ? `${p.findings} finding(s): ${sev}` : 'no findings'}.`);
      for (const h of p.top || []) lineas.push(`    ${h.severity} ${h.package ?? (h.file ? `${h.file}${h.line ? `:${h.line}` : ''}` : '')}: ${h.message}`);
      if (p.findings > (p.top || []).length) lineas.push(`    ... and ${p.findings - p.top.length} more`);
    }
    if (pr.aceptados?.length) lineas.push(`Accepted in .healer.json (do not deduct): ${pr.aceptados.map((a) => `${a.paquete ?? a.mensaje} (${a.motivo})`).join('; ')}.`);
  }
  const sug = r.pending_improvements || [];
  if (sug.length) {
    lineas.push(`Non-blocking suggestions (not applied): ${sug.length}.`);
    for (const s of sug.slice(0, 10)) lineas.push(`- ${s.archivo}: ${String(s.diagnostico).slice(0, 300)}`);
    if (sug.length > 10) lineas.push(`- ... and ${sug.length - 10} more (all of them are in the Healer panel).`);
  }
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

async function aplicar({ job_id, archivos, acepto_puntaje_menor }) {
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
  // ⚖️ [2026-11-16] La misma regla que Healer (orquestador/aceptacion.ts): sin el sí del usuario, la dependencia que baja el
  // puntaje no se escribe. Dejarla afuera y aplicar el resto sí se puede.
  const ra = t.requires_acceptance;
  const tocados = ra && acepto_puntaje_menor !== true ? ra.files.filter((x) => elegidos.includes(x)) : [];
  if (tocados.length) return `Needs the user's acceptance before applying: ${ra.reason} Quality score ${ra.pentagono_before} → ${ra.pentagono_after}. Ask the user; if they accept the lower score, call healer_aplicar again with acepto_puntaje_menor: true. Or leave out ${tocados.join(', ')} and apply the rest.`;
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
  // Le cuenta a Healer qué se aplicó y qué no (solo para medir qué cambios valen la pena; si falla, no importa).
  await api('POST', `/v1/repair/${encodeURIComponent(job_id)}/decision`, { aplicados: elegidos, descartados, via: 'plugin_local' }).catch(() => {});
  return `Applied: ${elegidos.length} file(s) written (${elegidos.join(', ')}).${descartados.length ? ` Left out as requested: ${descartados.join(', ')}.` : ''} Review the diff with git before committing.`;
}

async function informarDecision({ job_id, aplicados = [], descartados = [] }) {
  const r = await api('POST', `/v1/repair/${encodeURIComponent(job_id)}/decision`, { aplicados, descartados, via: 'agente' });
  return `Thanks: recorded ${r.registrados ?? 0} decision(s) (${aplicados.length} applied, ${descartados.length} left out).`;
}

// 🛈 [HEALER_INFO, 2026-11-16] Qué servidor es y qué permite la cuenta (igual que en el conector remoto): versión, cada herramienta
// con la huella de su definición, la regla de nivel de la organización y el cupo pro. Sin IA y sin costo.
const huella = (texto) => crypto.createHash('sha256').update(texto).digest('hex').slice(0, 12);
async function info() {
  const tools = HERRAMIENTAS.map(({ name, description, inputSchema }) => ({ name, fingerprint: huella(JSON.stringify({ name, description, inputSchema })) }));
  const tools_fingerprint = huella(tools.map((t) => `${t.name}:${t.fingerprint}`).join('|'));
  let cuenta = null;
  try { cuenta = await api('GET', '/v1/info'); } catch (e) { cuenta = { error: e.message }; }
  const lineas = [
    `Healer MCP server (local) version ${VERSION}, talking to ${API}${cuenta?.remote_connector_version ? ` (server connector version ${cuenta.remote_connector_version})` : ''}.`,
    `Tools (${tools.length}), fingerprint ${tools_fingerprint}: ${tools.map((t) => `${t.name} [${t.fingerprint}]`).join(', ')}.`,
    'If a name here is missing from your tool list, restart the agent (or update the Healer plugin) to load the current version.',
  ];
  if (cuenta?.error) lineas.push(`Account: ${cuenta.error}`);
  else if (cuenta) {
    lineas.push(`AI level of the organization: ${cuenta.ai_level_default} by default; when a job would run on free: ${cuenta.when_free === 'ask' ? "ask the user first (free never runs without the user's yes)" : 'free runs automatically'}.`);
    const r = cuenta.repairs;
    if (r) lineas.push(`Pro repairs this month: ${r.used}${r.limit !== null ? ` of ${r.limit}` : ' (no monthly limit)'}${r.extra ? `, plus ${r.extra} single repair(s)` : ''}.`);
  }
  lineas.push('', JSON.stringify({ server: 'healer', kind: 'local', version: VERSION, tools_fingerprint, tools, account: cuenta }));
  return lineas.join('\n');
}

// 🧭 [2026-11-26] healer check y el hook antes de cada commit (ver ../check.mjs). healer_check sin completo no manda nada.
async function chequear({ ruta, archivos, completo }) {
  const raiz = path.resolve(ruta || process.cwd());
  if (completo === true) return (await revisarCompleto({ raiz })).texto;
  const lista = Array.isArray(archivos) && archivos.length ? archivos.map(String) : null;
  return textoLocal(await revisarLocal({ raiz, archivos: lista }), { archivos: lista });
}
async function hookDeCommit({ ruta, accion, bloquear, completo }) {
  const raiz = path.resolve(ruta || process.cwd());
  if (accion === 'on') return instalarHook(raiz, { bloquear: bloquear === true, completo: completo === true });
  if (accion === 'off') return quitarHook(raiz);
  const e = estadoHook(raiz);
  if (e.error) return e.error;
  if (e.externa) return `Hooks live in "${e.externa}" (husky or core.hooksPath): Healer does not manage them; add the healer line to its pre-commit file.`;
  return e.activo ? `On: ${e.bloquea ? 'blocks the commit on errors' : 'warns, never blocks'}; full review after each commit: ${e.completo ? 'on' : 'off'}.` : 'Off.';
}

const HERRAMIENTAS = [
  {
    name: 'healer_info',
    description: 'What this Healer server is and what your account allows, in one call (no AI, no cost): server version, every tool with a fingerprint of its definition, the organization rule for the AI level and the pro repairs left this month. Use it when a tool you expect is missing or behaves differently than described.',
    inputSchema: { type: 'object', properties: {} },
    run: info
  },
  {
    name: 'healer_revisar',
    description: 'Send the project to Healer for independent verification: it runs the tests in an isolated sandbox, repairs what fails and returns only changes that leave the project better, never worse. Returns a job id; then call healer_resultado.',
    inputSchema: {
      type: 'object',
      properties: {
        ruta: { type: 'string', description: 'Project folder. Defaults to the current working directory.' },
        nivel: { type: 'string', enum: ['free', 'pro'], description: 'Optional. Leave it out unless the user asked for a level: the organization default applies (pro unless the owner changed it). Free means free AI providers, which may keep what they receive, and the code may be used for training.' },
        confirmar_free: { type: 'boolean', description: 'Only after the user said yes to the free level for THIS job (Healer asks when a job would run on free). Never set it on your own.' },
        solo_revisar: { type: 'boolean', description: 'Run the checks without repairing and without AI (offered when the pro repairs are used up and the user does not want free).' },
        bug: { type: 'string', description: 'Optional: the bug as the user tells it (what they did, what they expected, what happened). Healer first writes a test that reproduces it and checks that it fails with the current code; only then repairs, and the test must pass after. If it does not reproduce, nothing is repaired blindly.' },
        tests: { type: 'array', items: { type: 'string' }, description: 'Optional: the tests that define "fixed" (e.g. tests/test_api.py::test_login). Without this Healer runs the full suite.' }
      }
    },
    run: revisar
  },
  {
    name: 'healer_check',
    description: 'Check the project with Healer rules, locally and in seconds: nothing leaves this computer and no AI is used. The rules come from real bugs (hand-copied lists that fell behind, Express routes that shadow each other, ALTER before CREATE, INSERT OR REPLACE that wipes columns, dotenv imported late, a route without the check its siblings have). Pass archivos to see only what touches those files (for example, the files of a commit). completo: true sends the project to Healer for a full review without AI (Pentagon, Semgrep, tests); it is skipped when Healer already watches the repo.',
    inputSchema: { type: 'object', properties: { ruta: { type: 'string', description: 'Project folder. Defaults to the current working directory.' }, archivos: { type: 'array', items: { type: 'string' }, description: 'Optional: only findings in these files (paths relative to the project).' }, completo: { type: 'boolean', description: 'Full review in Healer without AI. Only when the user asks for it.' } } },
    run: chequear
  },
  {
    name: 'healer_hook',
    description: 'Turn on or off the Healer check before every commit in this repo (a git hook), or see its state. Only when the user asks. On: it warns and never blocks, unless bloquear is true (blocks on errors in the files of the commit). completo: true also sends a full review without AI after each commit, in the background, except when Healer already watches the repo (no double runs). If the repo keeps its hooks elsewhere (husky), it says what line to add instead of touching team files.',
    inputSchema: { type: 'object', properties: { ruta: { type: 'string', description: 'Project folder. Defaults to the current working directory.' }, accion: { type: 'string', enum: ['on', 'off', 'status'] }, bloquear: { type: 'boolean' }, completo: { type: 'boolean' } }, required: ['accion'] },
    run: hookDeCommit
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
    inputSchema: { type: 'object', properties: { job_id: { type: 'string' }, archivos: { type: 'array', items: { type: 'string' }, description: 'Optional: paths (as listed by healer_resultado) of the only files to write.' }, acepto_puntaje_menor: { type: 'boolean', description: 'Only when the result says "Needs the user acceptance" and the user explicitly accepted the lower quality score.' } }, required: ['job_id'] },
    run: aplicar
  },
  {
    name: 'healer_revisar_pantalla',
    description: 'Start the app in Healer\'s isolated sandbox and check what its pages really show, WITHOUT repairing anything and without AI (much faster than a full review). Per page: the load state (LOADED, DID NOT LOAD with the reason, or NOT THE EXPECTED PAGE), failed requests, measured visual issues, a text map of the screen, and YES / NO / CANNOT PROVE for each expectation. Only the folder is needed: without start_command and port, Healer finds how to start the app (.healer.json "screen", the command that worked last time, or package.json / the Python entry file) and says where it came from; without pages it checks "/". You set the expectations from what you know about the code. Returns a job id; then call healer_resultado.',
    inputSchema: {
      type: 'object',
      properties: {
        ruta: { type: 'string', description: 'Project folder. Defaults to the current working directory.' },
        start_command: { type: 'string', description: 'Optional: the command that starts the app, e.g. "npm run dev". It must listen on 0.0.0.0. Leave it out and Healer finds it.' },
        port: { type: 'number', description: 'Optional: the port the app listens on (1024-65535). Leave it out and Healer finds it.' },
        pages: { type: 'array', items: { type: 'object' }, description: 'Optional (default: [{ "path": "/" }]). Up to 10 pages: [{ "path": "/", "expect_page": { "title_is": "My App" }, "expectations": [{ "exists": "Save" }, { "not_exists": "Delete all" }, { "text": "Total", "contains": "0" }, { "no_issues": true }], "storage": { "session": "test-token" }, "wait_for": "Dashboard", "width": 375 }]. Test accounts only in storage.' }
      },
      required: []
    },
    run: revisarPantalla
  },
  {
    name: 'healer_informar_decision',
    description: 'Tell Healer which of its changes the user decided not to apply (or applied by hand). healer_aplicar reports this by itself; use this when the user applies none, or edits by hand. Healer stores only fingerprints of the file paths, never code.',
    inputSchema: { type: 'object', properties: { job_id: { type: 'string' }, aplicados: { type: 'array', items: { type: 'string' } }, descartados: { type: 'array', items: { type: 'string' } } }, required: ['job_id'] },
    run: informarDecision
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
