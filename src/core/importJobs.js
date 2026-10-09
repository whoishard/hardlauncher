/**
 * Gestor de tareas de importación/instalación en segundo plano.
 *
 * Antes, importar una instancia o un modpack era una sola llamada IPC
 * (`await importPackage()`) atada al modal que la disparó: el progreso se
 * mostraba en un toast que desaparecía a los 2 segundos sin eventos y, si el
 * usuario cerraba el modal, la promesa se perdía y no había forma de saber
 * cómo iba ni cuándo terminaba.
 *
 * Ahora cada importación es un "job" que vive en el proceso principal:
 * arranca, devuelve su id de inmediato y sigue corriendo aunque se cierre el
 * modal (o se cambie de pantalla). Cualquier parte de la UI puede pedir la
 * lista de jobs (`list`) y recibir sus actualizaciones (`setBroadcaster`).
 *
 * Este módulo no depende de Electron a propósito: quien lo usa le pasa la
 * función que envía las actualizaciones al renderer.
 */

const MAX_LOG_LINES = 150;
const BROADCAST_INTERVAL_MS = 120;
// Los jobs terminados se conservan un rato por si el renderer se recarga,
// pero no para siempre.
const MAX_FINISHED_KEPT = 12;

const jobs = new Map();
let counter = 0;
let broadcaster = () => {};

function setBroadcaster(fn) {
  broadcaster = typeof fn === 'function' ? fn : () => {};
}

function snapshot(job) {
  const { _lastSent, _timer, ...pub } = job;
  return { ...pub, log: job.log.slice() };
}

function emit(job, force = false) {
  const now = Date.now();
  if (!force && now - job._lastSent < BROADCAST_INTERVAL_MS) {
    // Un evento "intermedio" se difiere en vez de descartarse, así el último
    // estado siempre llega aunque no vengan más eventos detrás.
    if (!job._timer) {
      job._timer = setTimeout(() => {
        job._timer = null;
        emit(job, true);
      }, BROADCAST_INTERVAL_MS);
    }
    return;
  }
  clearTimeout(job._timer);
  job._timer = null;
  job._lastSent = now;
  try {
    broadcaster(snapshot(job));
  } catch {
    /* la ventana pudo cerrarse: el job sigue igual */
  }
}

function addLog(job, line) {
  const text = String(line ?? '').trim();
  if (!text) return;
  job.log.push(text);
  if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
}

/**
 * Traduce los eventos de progreso que ya emiten los importadores
 * (archiveImporter / modInstaller / launcherImporter) a los campos
 * normalizados del job. No hace falta tocar los importadores para que el
 * progreso se vea, salvo para sumar mensajes de log.
 */
function applyProgress(job, p) {
  if (!p || typeof p !== 'object') return;

  if (p.instance?.id) {
    job.instanceId = p.instance.id;
    if (p.instance.name) job.instanceName = p.instance.name;
  }

  switch (p.stage) {
    case 'instance-created':
      job.phase = 'preparing';
      job.detail = null;
      addLog(job, `Instancia creada: ${p.instance?.name || p.project || ''}`);
      break;
    case 'extracting': {
      job.phase = 'extracting';
      const m = /^(\d+)\/(\d+)$/.exec(p.file || '');
      if (m) {
        job.completed = Number(m[1]);
        job.total = Number(m[2]);
        job.percent = job.total ? (job.completed / job.total) * 100 : null;
        job.detail = null;
      }
      break;
    }
    case 'downloading':
      job.phase = 'downloading';
      if (p.total) {
        job.completed = p.completed || 0;
        job.total = p.total;
        job.percent = (job.completed / job.total) * 100;
      }
      if (p.file) job.detail = p.file;
      break;
    case 'progress':
      // Progreso de UN archivo (downloaded/total en bytes): solo se usa como
      // detalle, el porcentaje general lo marca el lote ('downloading').
      job.phase = 'downloading';
      if (p.file) job.detail = p.file;
      if (p.total && job.total == null) job.percent = (p.downloaded / p.total) * 100;
      break;
    case 'dependency':
      job.phase = 'downloading';
      job.detail = p.dependsOn || null;
      break;
    case 'resolving':
      job.phase = 'resolving';
      job.percent = null;
      job.completed = null;
      job.total = null;
      job.detail = null;
      break;
    case 'importing':
      job.phase = 'importing';
      job.detail = p.name || null;
      job.percent = null;
      addLog(job, `Importando "${p.name || ''}"${p.format ? ` (${p.format})` : ''}`);
      break;
    case 'warning':
      if (p.message) {
        job.warnings.push(p.message);
        addLog(job, `Aviso: ${p.message}`);
      }
      break;
    case 'log':
      addLog(job, p.message);
      break;
    default:
      break;
  }
}

function pruneFinished() {
  const finished = [...jobs.values()].filter((j) => j.status !== 'running');
  if (finished.length <= MAX_FINISHED_KEPT) return;
  finished
    .sort((a, b) => a.finishedAt - b.finishedAt)
    .slice(0, finished.length - MAX_FINISHED_KEPT)
    .forEach((j) => jobs.delete(j.id));
}

/**
 * Arranca un job. `run(report)` hace el trabajo real y devuelve su resultado
 * (una o varias instancias); `report` es el callback `onProgress` que ya
 * esperan los importadores. Devuelve de inmediato el snapshot inicial.
 */
function startJob({ kind, title, run }) {
  const job = {
    id: `job-${Date.now().toString(36)}-${++counter}`,
    kind,
    title: title || 'Importación',
    status: 'running', // running | done | error
    phase: 'preparing', // preparing | extracting | downloading | resolving | importing
    percent: null,
    completed: null,
    total: null,
    detail: null,
    instanceId: null,
    instanceName: null,
    results: [], // [{ id, name }] al terminar
    warnings: [],
    error: null,
    log: [],
    startedAt: Date.now(),
    finishedAt: null,
    _lastSent: 0,
    _timer: null,
  };
  jobs.set(job.id, job);
  addLog(job, `Iniciando: ${job.title}`);
  emit(job, true);

  const report = (p) => {
    applyProgress(job, p);
    emit(job);
  };

  Promise.resolve()
    .then(() => run(report))
    .then((result) => {
      const list = (Array.isArray(result) ? result : result ? [result] : []).filter(Boolean);
      job.results = list.map((i) => ({ id: i.id, name: i.name }));
      list.forEach((i) => i.importWarnings?.forEach((w) => job.warnings.push(w)));
      if (list[0]) {
        job.instanceId = job.instanceId || list[0].id;
        job.instanceName = job.instanceName || list[0].name;
      }
      job.status = 'done';
      job.phase = 'done';
      job.percent = 100;
      job.detail = null;
      addLog(job, 'Listo.');
    })
    .catch((e) => {
      job.status = 'error';
      job.error = e?.message || String(e);
      addLog(job, `Error: ${job.error}`);
    })
    .finally(() => {
      job.finishedAt = Date.now();
      emit(job, true);
      pruneFinished();
    });

  return snapshot(job);
}

function list() {
  return [...jobs.values()].map(snapshot);
}

/** Descarta un job ya terminado (los que siguen corriendo no se pueden descartar). */
function dismiss(id) {
  const job = jobs.get(id);
  if (job && job.status !== 'running') jobs.delete(id);
  return true;
}

function clearFinished() {
  for (const job of [...jobs.values()]) {
    if (job.status !== 'running') jobs.delete(job.id);
  }
  return true;
}

function hasRunning() {
  return [...jobs.values()].some((j) => j.status === 'running');
}

module.exports = { setBroadcaster, startJob, list, dismiss, clearFinished, hasRunning };
