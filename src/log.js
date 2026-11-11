/** Extraction log: each step with a timestamp, shown in the UI's "Extraction log" row. */
export function createLog() {
  const entries = [];
  return {
    entries,
    ok(msg, result = '') { entries.push({ t: new Date().toISOString(), mark: '✓', msg, result: String(result) }); },
    info(msg, result = '') { entries.push({ t: new Date().toISOString(), mark: '·', msg, result: String(result) }); },
    fail(msg, err) { entries.push({ t: new Date().toISOString(), mark: '✗', msg, result: err ? String(err.publicMessage || err.message || err) : '' }); }
  };
}
