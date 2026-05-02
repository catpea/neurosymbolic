/**
 * routes/xml.js — CRUD for the xml/ resource tree.
 *
 * Layout on disk:
 *   xml/commands/cls/Command.xml
 *   xml/commands/cls/README.md
 *   xml/workflows/show-shell/Workflow.xml
 *   xml/workflows/show-shell/README.md
 *
 * HTTP surface:
 *   GET    /xml/:type          → <Types> wrapping every resource in that directory
 *   GET    /xml/:type/:name    → raw XML for one resource
 *   POST   /xml/:type/:name    → create directory + write XML + generate README
 *   PUT    /xml/:type/:name    → overwrite XML + regenerate README
 *   DELETE /xml/:type/:name    → remove directory
 *
 * Request body for POST/PUT must be raw XML (Content-Type: application/xml).
 * The JSON middleware skips non-JSON bodies, so the request stream is intact.
 */

import { join, resolve, dirname } from 'path';
import { readdir, readFile, writeFile, mkdir, rm } from 'fs/promises';
import { fileURLToPath } from 'url';

const __dir  = dirname(fileURLToPath(import.meta.url));
const XML_ROOT = resolve(__dir, '..', '..', '..', 'xml');

// Only word-chars and hyphens are safe in a path segment
const SAFE      = /^[a-zA-Z0-9_-]+$/;
// Filenames allow a single dot extension: index.js, utils.js
const SAFE_FILE = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/;

// commands → Command.xml,  workflows → Workflow.xml
function resourceFile(type) {
  const singular = type.replace(/s$/, '');
  return singular.charAt(0).toUpperCase() + singular.slice(1) + '.xml';
}

// commands → Commands  (collection wrapper tag)
function collectionTag(type) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

// Collect raw request body as a string
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  ()    => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Strip <?xml …?> declaration so individual files embed cleanly in a collection
function stripDecl(s) {
  return s.replace(/^<\?xml[^?]*\?>\s*/i, '').trimEnd();
}

// Indent every line of a block by `pad` spaces
function indent(text, pad = '  ') {
  return text.split('\n').map(l => pad + l).join('\n');
}

// Generate a human-readable README from XML text using simple regexes
function makeReadme(type, name, xmlText) {
  const singular = type.replace(/s$/, '');
  const title    = xmlText.match(/title="([^"]*)"/)?.[1]         ?? name;
  const desc     = xmlText.match(/<Description>([\s\S]*?)<\/Description>/)?.[1]?.trim() ?? '';
  const synopsis = xmlText.match(/<Synopsis>([\s\S]*?)<\/Synopsis>/)?.[1]?.trim()       ?? '';

  const lines = [
    `# ${title}`,
    '',
    `**Type:** ${singular}  `,
    `**Name:** \`${name}\``,
  ];
  if (synopsis) lines.push('', `**Synopsis:** \`${synopsis}\``);
  if (desc)     lines.push('', desc);
  lines.push('', '---', '', '```xml', stripDecl(xmlText), '```');

  return lines.join('\n') + '\n';
}

export function registerXmlRoute(app) {

  // ── Collection ──────────────────────────────────────────────────────────────
  app.get('/xml/:type', async (req, res) => {
    const { type } = req.params;
    if (!SAFE.test(type)) return res.status(400).json({ error: 'Invalid type' });

    const dir = join(XML_ROOT, type);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: `Unknown type: ${type}` });
      return res.status(500).json({ error: err.message });
    }

    const names = entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort();

    const items = (await Promise.all(names.map(async name => {
      try {
        const text = await readFile(join(dir, name, resourceFile(type)), 'utf8');
        return indent(stripDecl(text));
      } catch {
        return null;
      }
    }))).filter(Boolean);

    const tag = collectionTag(type);
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<${tag}>\n\n${items.join('\n\n')}\n\n</${tag}>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.end(xml);
  });

  // ── Single resource ─────────────────────────────────────────────────────────
  app.get('/xml/:type/:name', async (req, res) => {
    const { type, name } = req.params;
    if (!SAFE.test(type) || !SAFE.test(name)) return res.status(400).json({ error: 'Invalid path' });

    try {
      const xml = await readFile(join(XML_ROOT, type, name, resourceFile(type)), 'utf8');
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.end(xml);
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: `Not found: ${type}/${name}` });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Create ──────────────────────────────────────────────────────────────────
  app.post('/xml/:type/:name', async (req, res) => {
    const { type, name } = req.params;
    if (!SAFE.test(type) || !SAFE.test(name)) return res.status(400).json({ error: 'Invalid path' });

    const xmlText = (await readBody(req)).trim();
    if (!xmlText) return res.status(400).json({ error: 'Request body must be XML' });

    const dir = join(XML_ROOT, type, name);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, resourceFile(type)), xmlText + '\n', 'utf8');
      await writeFile(join(dir, 'README.md'), makeReadme(type, name, xmlText), 'utf8');
      res.status(201).json({ ok: true, path: `xml/${type}/${name}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Update ──────────────────────────────────────────────────────────────────
  app.put('/xml/:type/:name', async (req, res) => {
    const { type, name } = req.params;
    if (!SAFE.test(type) || !SAFE.test(name)) return res.status(400).json({ error: 'Invalid path' });

    const xmlText = (await readBody(req)).trim();
    if (!xmlText) return res.status(400).json({ error: 'Request body must be XML' });

    const dir = join(XML_ROOT, type, name);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, resourceFile(type)), xmlText + '\n', 'utf8');
      await writeFile(join(dir, 'README.md'), makeReadme(type, name, xmlText), 'utf8');
      res.status(200).json({ ok: true, path: `xml/${type}/${name}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Save source file  PUT /xml/:type/:name/src/:filename ────────────────────
  // Saves a JS (or other) source file alongside the resource XML.
  // The client extracts <Function> content before POSTing Command XML and calls
  // this route to persist each file.  Static serving already handles GET.
  app.put('/xml/:type/:name/src/:filename', async (req, res) => {
    const { type, name, filename } = req.params;
    if (!SAFE.test(type) || !SAFE.test(name))    return res.status(400).json({ error: 'Invalid path' });
    if (!SAFE_FILE.test(filename))               return res.status(400).json({ error: 'Invalid filename' });

    const content = await readBody(req);
    if (!content.trim()) return res.status(400).json({ error: 'Body required' });

    const srcDir = join(XML_ROOT, type, name, 'src');
    try {
      await mkdir(srcDir, { recursive: true });
      await writeFile(join(srcDir, filename), content, 'utf8');
      res.status(200).json({ ok: true, path: `xml/${type}/${name}/src/${filename}` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Delete ──────────────────────────────────────────────────────────────────
  app.delete('/xml/:type/:name', async (req, res) => {
    const { type, name } = req.params;
    if (!SAFE.test(type) || !SAFE.test(name)) return res.status(400).json({ error: 'Invalid path' });

    try {
      await rm(join(XML_ROOT, type, name), { recursive: true, force: true });
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
