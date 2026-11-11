/**
 * Server-side content repository: every .md / .markdown / .txt / .json file under CONTENT_DIR
 * (default ./content). Returned raw; the browser parses it with the same rules as a dropped folder:
 * folders containing "case" -> case studies, "linkedin" or "post" -> LinkedIn posts,
 * optional front matter: title, tags, url, type.
 * Files named README*, or starting with "_" or ".", are skipped.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const OK = /\.(md|markdown|txt|json)$/i;
const MAX = 200 * 1024;

export async function readContentFiles(dir) {
  const root = path.resolve(dir);
  const out = [];
  async function walk(d) {
    let ents = [];
    try { ents = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name.startsWith('_') || /^readme/i.test(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && OK.test(e.name)) {
        const st = await fs.stat(full);
        if (st.size > MAX) continue;
        out.push({ path: path.relative(root, full).split(path.sep).join('/'), text: await fs.readFile(full, 'utf8') });
      }
    }
  }
  await walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
