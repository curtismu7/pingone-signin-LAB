// Workspace id: one lab instance's private namespace. It keys the mock's state (flows, codes, CIBA requests, lockouts, token key),
// the data directory and the trace sink, so two workspaces in one process (or one data root) never see each other.
// The id comes from the environment (SIGNIN_WORKSPACE) or the caller; a request never picks it.
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_WORKSPACE = 'default';
const VALID = /^[a-z0-9-]{1,32}$/;
export const validWorkspaceId = (id) => typeof id === 'string' && VALID.test(id);

export function resolveWorkspace(env = process.env) {
  const id = env.SIGNIN_WORKSPACE === undefined || env.SIGNIN_WORKSPACE === '' ? DEFAULT_WORKSPACE : env.SIGNIN_WORKSPACE;
  if (!validWorkspaceId(id)) throw new Error('SIGNIN_WORKSPACE must match [a-z0-9-]{1,32}');
  return id;
}

// <root>/<id>/ ; the directory is created only when something is written into it.
export const workspaceDir = (root, id) => {
  if (!validWorkspaceId(id)) throw new Error('bad workspace id');
  return path.join(root, id);
};

// The trace sink: the last `max` hops the mock and the scenario runner handled in this workspace, newest last. In memory always;
// also appended to <dir>/trace.jsonl when a data directory is given (SIGNIN_DATA_DIR). Entries hold no secrets: the paths carry no
// query string, and the cookie and password never reach the sink.
export const MAX_TRACE_FILE_BYTES = 5 * 1024 * 1024;
export function createTraceSink({ workspace, dir = null, max = 500, maxFileBytes = MAX_TRACE_FILE_BYTES }) {
  if (!validWorkspaceId(workspace)) throw new Error('bad workspace id');
  const items = [];
  const file = dir ? path.join(dir, 'trace.jsonl') : null;
  let bytes = null; // size of the file so far; once it reaches the cap, nothing more is written (memory still keeps the last `max`)
  let full = false;
  return {
    workspace, dir,
    record(entry) {
      const row = { at: new Date().toISOString(), workspace, ...entry };
      items.push(row);
      if (items.length > max) items.shift();
      if (file && !full) {
        try {
          fs.mkdirSync(dir, { recursive: true });
          if (bytes === null) { try { bytes = fs.statSync(file).size; } catch { bytes = 0; } }
          const line = `${JSON.stringify(row)}\n`;
          if (bytes + line.length > maxFileBytes) full = true;
          else { fs.appendFileSync(file, line); bytes += line.length; }
        } catch { /* the sink never breaks a request */ }
      }
    },
    list: () => items.slice(),
    get fileFull() { return full; },
    clear() { items.length = 0; },
  };
}
