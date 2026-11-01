// Starts the real server for the e2e run and records how it ends. If a run dies halfway (every later test then fails with
// ECONNREFUSED) the log shows whether something sent the process a signal (and when) or it crashed.
import fs from 'node:fs';

const log = process.env.E2E_SERVER_LOG;
const note = (msg) => { if (log) fs.appendFileSync(log, `${new Date().toISOString()} pid=${process.pid} ${msg}\n`); };
note('server starting');
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { note(`received ${sig}`); process.exit(128 + { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[sig]); });
process.on('uncaughtException', (e) => { note(`uncaughtException ${e?.stack || e}`); process.exit(1); });
process.on('unhandledRejection', (e) => { note(`unhandledRejection ${e?.stack || e}`); process.exit(1); });
process.on('exit', (code) => note(`exit code=${code}`));
await import('../server/src/index.js');
