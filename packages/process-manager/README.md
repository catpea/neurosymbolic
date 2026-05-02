# process-manager

Lightweight foreground process orchestrator. Same `ecosystem.json` format as
PM2 — zero external dependencies, no daemon, no surprises.

## Usage

```sh
# From the project root:
node packages/process-manager/pm.js start network-services/ecosystem.json
NODE_ENV=development node packages/process-manager/pm.js start network-services/ecosystem.json

# Via npm scripts (recommended):
npm start          # production
npm run dev        # development (sets NODE_ENV=development)
npm run logs       # alias: pm logs <name>
```

## Commands

| Command | Description |
|---------|-------------|
| `pm start <ecosystem.json>` | Start all apps (foreground — blocks until Ctrl-C or SIGTERM) |
| `pm logs <name> [lines]`    | Print last N lines of a process log (default 80) |
| `pm help`                   | Show built-in help text |

## Shutdown

Because the process manager runs in the **foreground**, the correct way to stop
everything is to **kill the pm.js process itself** — it catches SIGTERM/SIGINT,
sends SIGTERM to all children, and force-kills anything still alive after 5 s.

```sh
# Find the pm PID:
ps aux | grep "pm.js start"

# Graceful stop:
kill <pid>          # sends SIGTERM → pm catches it → stops all children cleanly

# From a terminal where npm run dev is running:
Ctrl-C              # sends SIGINT → same clean shutdown path
```

Do **not** kill individual child processes directly unless you want them to
auto-restart. Killing the pm.js parent stops the whole fleet.

## ecosystem.json

Lives in `network-services/ecosystem.json`. All script paths are relative to
the ecosystem file, not the working directory.

```json
{
  "apps": [
    {
      "name":            "project-server",
      "script":          "project-server/index.js",
      "instances":       1,
      "env":             { "PORT": "3000" },
      "env_development": { "NODE_ENV": "development" },
      "max_restarts":    5
    },
    {
      "name":            "task-worker",
      "script":          "task-queue/processor.js",
      "instances":       "max",
      "env":             { "QUEUE_URL": "http://localhost:4000" },
      "restart_delay":   2000,
      "max_restarts":    20
    }
  ]
}
```

### Field reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | required | Label in output and log filenames |
| `script` | string | required | Path to the entry script (relative to ecosystem.json) |
| `instances` | int \| `"max"` | `1` | Number of processes; `"max"` = one per logical CPU |
| `env` | object | `{}` | Environment variables — always applied |
| `env_development` | object | `{}` | Merged when `NODE_ENV=development` |
| `env_production` | object | `{}` | Merged when `NODE_ENV=production` |
| `cwd` | string | script dir | Working directory (relative to ecosystem.json) |
| `restart_delay` | ms | `1000` | Wait before first restart |
| `max_restarts` | int | `10` | Give up after N consecutive crashes |

### `instances: "max"` — competing consumers

Setting `instances: "max"` on the task-worker spawns one process per logical
CPU. Each worker independently polls `GET /dequeue`, which atomically claims a
job via `renameSync(incoming → active)`. No locking, no coordination — the
filesystem rename is the mutex. Every CPU stays busy as long as there is work.

## Log files

Written to `<ecosystem-dir>/logs/` in append mode (never truncated on restart):

```
network-services/logs/
  project-server-out.log
  project-server-err.log
  inventory-cache-out.log
  task-worker[0]-out.log
  task-worker[1]-out.log
  ...
```

## Stability timer

If a process runs for 30 s without crashing, its crash counter and backoff
delay reset. This prevents a service that recovers from occasional transient
errors from being permanently killed by the `max_restarts` cap.

Backoff follows an exponential schedule: 1 s → 2 s → 4 s → … → 30 s ceiling.

## Why not PM2?

| | pm.js | PM2 |
|-|-------|-----|
| Dependencies | zero | heavy |
| Daemon | no (foreground) | yes |
| Docker-friendly | yes (PID 1 safe) | requires `--no-daemon` |
| ecosystem.json | subset supported | full |
| Cluster mode | no | yes |
| Metrics / web UI | no | yes |

PM2 is the right choice if you need cluster mode, a web dashboard, or
advanced deployment features. For a local dev server and simple production
containers, `pm.js` is simpler and more predictable.
