#!/usr/bin/env node
// packages/process-manager/pm.js
//
// Lightweight foreground process orchestrator — pm2's ecosystem.json format,
// zero external dependencies.
//
// Runs in the foreground: all managed processes live as children. Ctrl-C (or
// SIGTERM) gracefully stops every child. This is the right model for Docker,
// dev boxes, and simple deployments — no hidden daemon, no surprises.
//
// ── Worker scaling ─────────────────────────────────────────────────────────────
// Set instances: "max" to spawn one worker per logical CPU. The task-queue uses
// the "competing consumers" pattern: every worker independently polls /dequeue,
// which atomically claims a job via renameSync(incoming → active). No locking,
// no coordination — each CPU stays busy as long as there is work.
//
// ── Watch mode (development) ───────────────────────────────────────────────────
// When NODE_ENV=development, pm watches each app's working directory (recursively)
// and hot-restarts the app whenever a source file changes. Changes are debounced
// (800 ms) so rapid saves during editing trigger only one restart.
//
// To OPT OUT of watching for a specific app — for example, a scaler that manages
// its own child processes and must not be restarted on every file save — add
// "watch": false to the app's ecosystem.json entry.
//
// ── Usage ──────────────────────────────────────────────────────────────────────
//   pm daemon <ecosystem.json>    Start in background — writes PID file, prints log path
//   pm stop   <ecosystem.json>    Stop the background pm gracefully (works from any shell)
//   pm restart <ecosystem.json>   Stop + daemon in one step
//   pm start  <ecosystem.json>    Start in foreground (blocks — Ctrl-C stops all)
//   pm logs   <name> [lines]      Print last N lines of a process log (default 80)
//   pm help                       Show this help text
//
// ── Lockfile ───────────────────────────────────────────────────────────────────
// daemon writes <ecosystem-dir>/pm.pid.  A second daemon call is refused if the
// PID is alive.  stop/restart reads the same file so they work regardless of
// which terminal originally ran start or dev.
//
// ── ecosystem.json format ──────────────────────────────────────────────────────
//   {
//     "apps": [
//       {
//         "name":            "my-service",   // label in output and log filenames
//         "script":          "src/index.js", // path relative to ecosystem.json
//         "instances":       1,              // integer, or "max" (os.cpus().length)
//         "watch":           true,           // false → opt out of dev file watching
//         "env":             {},             // always applied
//         "env_development": {},             // merged when NODE_ENV=development
//         "env_production":  {},             // merged when NODE_ENV=production
//         "restart_delay":   1000,           // ms before first restart (default 1000)
//         "max_restarts":    10              // give up after N consecutive crashes
//       }
//     ]
//   }
//
// ── Log files ──────────────────────────────────────────────────────────────────
// Written to <ecosystem-dir>/logs/<name>-out.log and ...-err.log (append mode).
// A process that runs stably for 30 s has its crash counter and backoff reset,
// so transient restarts do not permanently cap the retry count.

import { spawn }        from 'node:child_process';
import { cpus }         from 'node:os';
import {
  readFileSync, writeFileSync,
  mkdirSync, existsSync, unlinkSync,
  openSync,
  createWriteStream,
  watch as fsWatch,
}                       from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';

// ── ANSI colour helpers ───────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
};

// Each app gets one colour from this palette (cycles if there are many apps).
const PALETTE = [C.cyan, C.green, C.magenta, C.yellow, C.blue, C.white];

function ts() {
  return `${C.dim}${new Date().toLocaleTimeString('en', { hour12: false })}${C.reset}`;
}

// ── CLI dispatch ──────────────────────────────────────────────────────────────

const [,, cmd, ...argv] = process.argv;

switch (cmd) {
  case 'start': {
    const eco = argv[0];
    if (!eco) die('Usage: pm start <ecosystem.json>');
    startAll(resolve(process.cwd(), eco));
    break;
  }
  case 'daemon': {
    const eco = argv[0];
    if (!eco) die('Usage: pm daemon <ecosystem.json>');
    daemonize(resolve(process.cwd(), eco));
    break;
  }
  case 'stop': {
    const eco = argv[0];
    if (!eco) die('Usage: pm stop <ecosystem.json>');
    stopRunning(resolve(process.cwd(), eco));
    break;
  }
  case 'restart': {
    const eco = argv[0];
    if (!eco) die('Usage: pm restart <ecosystem.json>');
    stopRunning(resolve(process.cwd(), eco), () => daemonize(resolve(process.cwd(), eco)));
    break;
  }
  case 'logs': {
    const name  = argv[0];
    const lines = Number(argv[1] ?? 80);
    if (!name) die('Usage: pm logs <name> [lines=80]');
    showLogs(name, lines);
    break;
  }
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    printHelp();
    break;
  default:
    printHelp();
    die(`Unknown command: ${cmd}`);
}

// ── startAll — read ecosystem, spawn everything ───────────────────────────────

function startAll(ecosystemPath) {
  if (!existsSync(ecosystemPath)) die(`Ecosystem file not found: ${ecosystemPath}`);

  const eco     = JSON.parse(readFileSync(ecosystemPath, 'utf8'));
  const ecoDir  = dirname(ecosystemPath);
  const nodeEnv = process.env.NODE_ENV ?? 'production';
  const cpuN    = cpus().length;
  const logsDir = join(ecoDir, 'logs');
  const pidFile = join(ecoDir, 'pm.pid');

  mkdirSync(logsDir, { recursive: true });

  // Write PID so stop/restart can find this process
  writeFileSync(pidFile, String(process.pid));

  // ── Startup banner ────────────────────────────────────────────────────────
  const ecoRel = relative(process.cwd(), ecosystemPath);
  const W = 44;
  const bar = '─'.repeat(W);
  console.log(`\n${C.cyan}${C.bold}  ┌${bar}┐${C.reset}`);
  const rows = [
    ['ecosystem', ecoRel],
    ['NODE_ENV',  nodeEnv],
    ['CPUs',      String(cpuN)],
    ['logs',      relative(process.cwd(), logsDir)],
    ...(nodeEnv === 'development' ? [['watch', 'enabled (dev mode)']] : []),
  ];
  for (const [k, v] of rows) {
    const line = `  ${k.padEnd(10)} ${v}`;
    console.log(`${C.cyan}${C.bold}  │${C.reset}${line.padEnd(W + 2)}${C.cyan}${C.bold}│${C.reset}`);
  }
  console.log(`${C.cyan}${C.bold}  └${bar}┘${C.reset}\n`);

  // ── Expand app definitions → concrete instances ───────────────────────────
  const instances = [];
  let paletteIdx = 0;

  for (const app of eco.apps ?? []) {
    const count  = app.instances === 'max' ? cpuN : (Number(app.instances) || 1);
    const colour = PALETTE[paletteIdx++ % PALETTE.length];
    const script = resolve(ecoDir, app.script);

    // cwd defaults to the script's directory (so relative imports inside the
    // script resolve correctly without any extra configuration).
    const cwd = app.cwd ? resolve(ecoDir, app.cwd) : dirname(script);

    // Merge environment: inherited → app.env → env-specific block
    const envKey = `env_${nodeEnv}`;
    const merged = {
      ...process.env,
      ...app.env,
      ...(app[envKey] ?? {}),
      NODE_ENV: nodeEnv,
    };

    for (let i = 0; i < count; i++) {
      // Single instances keep their plain name. Multiple instances get "[i]"
      // suffix so log files don't collide and output is distinguishable.
      const label = count > 1 ? `${app.name}[${i}]` : app.name;
      instances.push({
        label,
        script,
        cwd,
        env:          merged,
        colour,
        restartDelay: app.restart_delay ?? 1000,
        maxRestarts:  app.max_restarts  ?? 10,
        logsDir,
        // watch: true by default; set watch:false in ecosystem.json to opt out.
        // Opt-out is important for stateful services that manage external processes
        // (e.g. a worker scaler) where a source-file restart would orphan children.
        watch:        app.watch !== false,
        watchPaths:   (app.watch_paths ?? []).map(p => resolve(ecoDir, p)),
        // mutable lifecycle state — reset in spawnInst on each respawn
        restarts:     0,
        backoff:      app.restart_delay ?? 1000,
        child:        null,
        // Hot-restart flag: set by hotRestart() before killing the child so the
        // exit handler knows to respawn immediately without counting it as a crash.
        _hotRestart:  false,
      });
    }
  }

  // ── Print launch plan ─────────────────────────────────────────────────────
  const nameW = Math.max(...instances.map(i => i.label.length), 12);
  for (const inst of instances) {
    const scriptRel = relative(ecoDir, inst.script);
    const watchMark = (nodeEnv === 'development' && !inst.watch) ? `  ${C.dim}(watch off)${C.reset}` : '';
    console.log(`  ${inst.colour}${C.bold}${inst.label.padEnd(nameW)}${C.reset}  ${C.dim}${scriptRel}${C.reset}${watchMark}`);
  }
  console.log('');

  // ── Spawn all instances ───────────────────────────────────────────────────
  for (const inst of instances) spawnInst(inst);

  // ── Watch mode (dev only) ─────────────────────────────────────────────────
  if (nodeEnv === 'development') setupWatchers(instances, ecoDir);

  // ── Graceful shutdown on Ctrl-C / SIGTERM ─────────────────────────────────
  let stopping = false;

  function shutdown(sig) {
    if (stopping) return;
    stopping = true;
    console.log(`\n${ts()} ${C.yellow}${C.bold} shutdown ${C.reset} (${sig}) — stopping all processes…`);

    // Remove PID file so stop/restart knows we're gone
    try { if (existsSync(pidFile)) unlinkSync(pidFile); } catch {}

    for (const inst of instances) {
      if (inst.child) {
        inst.maxRestarts = -1; // prevent auto-restart while draining
        inst.child.kill('SIGTERM');
      }
    }

    // Force-kill anything still alive after 5 s
    const force = setTimeout(() => {
      for (const inst of instances) inst.child?.kill('SIGKILL');
      process.exit(0);
    }, 5000);
    force.unref(); // do not keep the event loop alive just for this timer
  }

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ── spawnInst — spawn one process, pipe its output, handle restarts ───────────

function spawnInst(inst) {
  const nameTag = `${inst.colour}${C.bold}${inst.label.padEnd(16)}${C.reset}`;

  // Open log files in append mode so restarts don't clobber previous output.
  const outLog = createWriteStream(join(inst.logsDir, `${inst.label}-out.log`), { flags: 'a' });
  const errLog = createWriteStream(join(inst.logsDir, `${inst.label}-err.log`), { flags: 'a' });

  const child = spawn(process.execPath, [inst.script], {
    cwd:   inst.cwd,
    env:   inst.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  inst.child = child;
  console.log(`${ts()} ${nameTag}  ${C.green}▶ start${C.reset}   pid=${C.bold}${child.pid}${C.reset}`);

  // ── Stability timer — if the process runs for 30 s without crashing,
  //    reset the crash counter and backoff. This way a service that regularly
  //    restarts (e.g. due to occasional transient errors) is not permanently
  //    penalised by the max_restarts cap.
  const stableTimer = setTimeout(() => {
    inst.restarts = 0;
    inst.backoff  = inst.restartDelay;
  }, 30_000);
  stableTimer.unref();

  // ── Line-by-line stdout/stderr routing ────────────────────────────────────
  function pipeLines(stream, logStream, isErr) {
    let buf = '';
    stream.on('data', chunk => {
      buf += chunk.toString();
      // Split on \n. The last element is an incomplete line — keep it buffered.
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const isoStamp = new Date().toISOString();
        const sigil    = isErr ? `${C.red}err${C.reset}` : `${C.dim}out${C.reset}`;
        console.log(`${ts()} ${nameTag}  ${sigil}  ${line}`);
        logStream.write(`${isoStamp}  ${line}\n`);
      }
    });
  }

  pipeLines(child.stdout, outLog, false);
  pipeLines(child.stderr, errLog, true);

  // ── Exit handling ─────────────────────────────────────────────────────────
  child.on('exit', (code, signal) => {
    clearTimeout(stableTimer);
    inst.child = null;
    outLog.end();
    errLog.end();

    // ── Hot restart (watch-triggered) ──────────────────────────────────────
    // hotRestart() set this flag before sending SIGTERM. Restart immediately
    // without counting it as a crash or applying backoff.
    if (inst._hotRestart) {
      inst._hotRestart = false;
      const why = signal ? `signal=${signal}` : `exit=${code}`;
      console.log(`${ts()} ${nameTag}  ${C.cyan}${C.bold}⟳ reload${C.reset}   ${why}`);
      spawnInst(inst);
      return;
    }

    // ── Clean exit ─────────────────────────────────────────────────────────
    // Code 0 means the process exited intentionally (e.g. a worker self-retiring
    // after an idle timeout). Do not restart.
    if (code === 0) {
      console.log(`${ts()} ${nameTag}  ${C.green}✔ done${C.reset}   code=0`);
      return;
    }

    const why = signal ? `signal=${signal}` : `exit=${code}`;

    // ── Gave up — too many crashes ─────────────────────────────────────────
    if (inst.restarts >= inst.maxRestarts) {
      console.log(`${ts()} ${nameTag}  ${C.red}${C.bold}✖ gave up${C.reset}  ${why}  (${inst.restarts}/${inst.maxRestarts} restarts)`);
      return;
    }

    inst.restarts++;
    console.log(`${ts()} ${nameTag}  ${C.yellow}↺ restart${C.reset}  ${why}  attempt ${inst.restarts}/${inst.maxRestarts} in ${inst.backoff}ms`);

    setTimeout(() => spawnInst(inst), inst.backoff);

    // Exponential backoff: 1 s → 2 s → 4 s → … → 30 s (ceiling)
    inst.backoff = Math.min(inst.backoff * 2, 30_000);
  });

  child.on('error', err => {
    clearTimeout(stableTimer);
    console.error(`${ts()} ${nameTag}  ${C.red}spawn error: ${err.message}${C.reset}`);
  });
}

// ── setupWatchers — watch app directories, hot-restart on source changes ──────
//
// Called once after all instances are spawned, only in development mode.
//
// Groups instances by their cwd. Each unique watched directory gets one
// fs.watch (recursive) so N workers sharing a directory don't create N watchers.
//
// Per-app opt-out: set "watch": false in ecosystem.json. Use this for stateful
// services that manage external child processes and must not be accidentally
// restarted mid-operation (e.g. a worker scaler).

function setupWatchers(instances, ecoDir) {
  // Collect only instances that have watch=true.
  const eligible = instances.filter(i => i.watch);
  if (eligible.length === 0) return;

  // Group by watched directory so we set up one watcher per directory.
  // Each instance contributes its cwd plus any extra watch_paths.
  const cwdMap = new Map(); // dir → [inst, ...]
  for (const inst of eligible) {
    const dirs = [inst.cwd, ...inst.watchPaths];
    for (const dir of dirs) {
      if (!cwdMap.has(dir)) cwdMap.set(dir, []);
      cwdMap.get(dir).push(inst);
    }
  }

  console.log(`${C.cyan}${C.bold}  watch${C.reset}`);
  for (const [cwd, insts] of cwdMap) {
    // Deduplicate app names (multiple instances of the same app share a label root).
    const appNames = [...new Set(insts.map(i => i.label.replace(/\[\d+\]$/, '')))];
    const relPath  = relative(ecoDir, cwd);

    let debounce = null;

    try {
      const watcher = fsWatch(cwd, { recursive: true }, (event, filename) => {
        if (!filename) return;

        // Ignore files that should never trigger a restart.
        // - node_modules: dependency changes don't need a restart here
        // - logs/: the apps write here — restarting on every log line would be bad
        // - dotfiles / dot-dirs: editor swap files, .git, etc.
        // - .log files anywhere: same as logs/ above
        const f = filename.replace(/\\/g, '/'); // normalise Windows paths too
        if (f.startsWith('node_modules/') ||
            f.startsWith('logs/')         ||
            f.startsWith('.')             ||
            f.endsWith('.log'))             return;

        clearTimeout(debounce);
        debounce = setTimeout(() => {
          const col = insts[0].colour;
          console.log(
            `${ts()} ${col}${C.bold}⟳ reload${C.reset}` +
            `  ${C.dim}${relPath}/${f}${C.reset}` +
            `  → ${appNames.map(n => `${col}${n}${C.reset}`).join(', ')}`
          );
          for (const inst of insts) hotRestart(inst);
        }, 800);
      });

      watcher.on('error', err => {
        // Non-fatal: log and keep running.
        console.warn(`${ts()}  ${C.yellow}watch error${C.reset} (${relPath}): ${err.message}`);
      });

      console.log(`  ${C.dim}watching${C.reset}  ${relPath}  → ${appNames.join(', ')}`);
    } catch (err) {
      // On some systems recursive watch may not be available. Degrade gracefully.
      console.warn(`  ${C.yellow}watch skipped${C.reset} (${relPath}): ${err.message}`);
    }
  }
  console.log('');
}

// ── hotRestart — kill and respawn an instance, flagged as a non-crash restart ─

function hotRestart(inst) {
  if (!inst.child) {
    // Not currently running (clean exit or gave-up state) — just start it.
    spawnInst(inst);
    return;
  }
  // Set the flag BEFORE sending the signal so the exit handler sees it
  // regardless of how quickly the process terminates.
  inst._hotRestart = true;
  inst.child.kill('SIGTERM');
}

// ── daemonize — fork pm into the background, write PID file ──────────────────
//
// Forks `pm start <ecosystem>` as a detached child, redirects its stdio to
// log files, writes a PID file, and exits.  The child runs startAll() normally.
// A second call is refused if the PID file exists and the process is still alive.

function daemonize(ecosystemPath) {
  if (!existsSync(ecosystemPath)) die(`Ecosystem file not found: ${ecosystemPath}`);

  const ecoDir  = dirname(ecosystemPath);
  const pidFile = join(ecoDir, 'pm.pid');
  const logsDir = join(ecoDir, 'logs');

  // Guard: refuse to start if already running
  if (existsSync(pidFile)) {
    const existingPid = Number(readFileSync(pidFile, 'utf8').trim());
    try {
      process.kill(existingPid, 0);  // throws if process doesn't exist
      console.error(`${C.red}error:${C.reset} pm is already running (pid ${existingPid})`);
      console.error(`  use ${C.bold}npm run stop${C.reset} to stop it, or ${C.bold}npm run restart${C.reset} to reload`);
      process.exit(1);
    } catch {
      // Stale PID file — process no longer exists
      console.log(`${C.yellow}warn:${C.reset} removing stale PID file (pid ${existingPid})`);
      unlinkSync(pidFile);
    }
  }

  mkdirSync(logsDir, { recursive: true });

  const outFd = openSync(join(logsDir, 'pm-out.log'), 'a');
  const errFd = openSync(join(logsDir, 'pm-err.log'), 'a');

  const child = spawn(process.execPath, [process.argv[1], 'start', ecosystemPath], {
    detached: true,
    stdio: ['ignore', outFd, errFd],
    env: { ...process.env },
  });
  child.unref();

  writeFileSync(pidFile, String(child.pid));

  const relLogs = relative(process.cwd(), logsDir);
  const relEco  = relative(process.cwd(), ecosystemPath);
  console.log(`${C.green}${C.bold}started${C.reset} pm in background  pid=${C.bold}${child.pid}${C.reset}`);
  console.log(`  ecosystem   ${relEco}  (NODE_ENV=${process.env.NODE_ENV ?? 'production'})`);
  console.log(`  view logs   npm run logs -- <service-name>`);
  console.log(`  tail all    tail -f ${relLogs}/pm-out.log`);
  console.log(`  stop        npm run stop`);
  console.log(`  restart     npm run restart`);
}

// ── stopRunning — send SIGTERM to the running pm, wait for it to exit ─────────

function stopRunning(ecosystemPath, cb) {
  const ecoDir  = dirname(ecosystemPath);
  const pidFile = join(ecoDir, 'pm.pid');

  if (!existsSync(pidFile)) {
    console.log('pm is not running (no PID file found)');
    cb?.();
    return;
  }

  const pid = Number(readFileSync(pidFile, 'utf8').trim());

  try {
    process.kill(pid, 0);  // check the process is alive
  } catch {
    console.log(`${C.yellow}warn:${C.reset} pm is not running (stale PID ${pid}), cleaning up`);
    unlinkSync(pidFile);
    cb?.();
    return;
  }

  process.kill(pid, 'SIGTERM');
  console.log(`${C.yellow}stopping${C.reset} pm (pid ${pid})…`);

  // Poll until the PID file is gone (pm removes it on clean exit) or process dies
  let waited = 0;
  const poll = setInterval(() => {
    waited += 200;
    let gone = false;
    try { process.kill(pid, 0); } catch { gone = true; }
    if (gone || !existsSync(pidFile)) {
      clearInterval(poll);
      try { if (existsSync(pidFile)) unlinkSync(pidFile); } catch {}
      console.log(`${C.green}stopped${C.reset}`);
      cb?.();
      return;
    }
    if (waited >= 8000) {
      clearInterval(poll);
      console.log(`${C.yellow}warn:${C.reset} pm did not stop gracefully after 8 s — sending SIGKILL`);
      try { process.kill(pid, 'SIGKILL'); } catch {}
      try { if (existsSync(pidFile)) unlinkSync(pidFile); } catch {}
      cb?.();
    }
  }, 200);
}

// ── showLogs — print the tail of a process log file ──────────────────────────

function showLogs(name, n) {
  // Search for the log file in the most likely locations.
  const candidates = [
    join(process.cwd(), 'network-services', 'logs', `${name}-out.log`),
    join(process.cwd(), 'logs', `${name}-out.log`),
  ];

  const found = candidates.find(existsSync);
  if (!found) {
    console.error(`No log found for "${name}". Searched:\n${candidates.map(p => `  ${p}`).join('\n')}`);
    process.exit(1);
  }

  const lines = readFileSync(found, 'utf8').split('\n').filter(Boolean);
  const tail  = lines.slice(-n);
  console.log(`${C.dim}── ${found} (last ${tail.length} of ${lines.length} lines) ──${C.reset}`);
  for (const line of tail) console.log(line);
}

// ── helpers ───────────────────────────────────────────────────────────────────

function die(msg) {
  console.error(`${C.red}error:${C.reset} ${msg}`);
  process.exit(1);
}

function printHelp() {
  console.log(`
  ${C.cyan}${C.bold}pm${C.reset} — Lightweight process orchestrator

  ${C.bold}Commands:${C.reset}
    daemon  <ecosystem.json>  Start in background  ${C.dim}(writes PID file, prints log path)${C.reset}
    stop    <ecosystem.json>  Stop the running pm gracefully
    restart <ecosystem.json>  Stop then start in background  ${C.dim}(works from any shell)${C.reset}
    start   <ecosystem.json>  Start in foreground  ${C.dim}(Ctrl-C stops all — dev/debug use)${C.reset}
    logs    <name> [lines]    Print last N lines of a process log  ${C.dim}(default 80)${C.reset}
    help                      Show this message

  ${C.bold}npm scripts:${C.reset}
    npm start          background (production)
    npm run dev        background (NODE_ENV=development, watch mode)
    npm run stop       stop
    npm run restart    reload without finding the terminal where it started
    npm run logs -- <name>   view service logs

  ${C.bold}ecosystem.json:${C.reset}
    {
      "apps": [
        {
          "name":            "task-worker",
          "script":          "task-queue/processor.js",
          "instances":       "max",        // or an integer; "max" = one per CPU
          "watch":           true,         // false = opt out of dev watch mode
          "env":             { "QUEUE_URL": "http://localhost:4000" },
          "env_development": { "DEBUG": "*" },
          "restart_delay":   1000,         // ms to first restart
          "max_restarts":    10            // give up after N consecutive crashes
        }
      ]
    }

  ${C.bold}Watch mode:${C.reset}
    When NODE_ENV=development, pm watches each app's working directory and
    hot-restarts the app on any source file change (debounced 800 ms).
    Set "watch": false to opt a specific app out of this behaviour.

  ${C.bold}Worker pattern:${C.reset}
    Set instances: "max" on your processor. Each worker competes for jobs by
    calling GET /dequeue, which atomically claims one job (renameSync incoming
    → active). No locking needed — the filesystem rename is the mutex.

  ${C.bold}Log files:${C.reset}  <ecosystem-dir>/logs/<name>-out.log  and  ...-err.log
`);
}
