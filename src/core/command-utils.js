/**
 * Shared utilities for the create-command, command-builder, and improve-command
 * runtimes.  Imported at runtime via: import { … } from '/core/command-utils.js'
 */

// ── Template ────────────────────────────────────────────────────────────────

export function makeTemplate(name, category = 'system') {
  return `<Command name="${name}" path="/cmd/${category}/${name}" title="" category="${category}">
  <Synopsis>${name}</Synopsis>
  <Description></Description>
  <Parameters/>
  <Output type="void" />
  <Function><![CDATA[
export async function main(parameters, context) {

}
  ]]></Function>
</Command>`;
}

// ── XML sanitization ─────────────────────────────────────────────────────────
//
// Wraps bare <Function>…</Function> content in CDATA so that JS operators
// like &&, ||, <, > do not break the XML parser.
// Skips blocks already wrapped in CDATA and self-closing <Function/> tags.

export function sanitizeCommandXml(text) {
  return text.replace(
    /(<Function[^/]*?>)([\s\S]*?)(<\/Function>)/g,
    (_, open, content, close) => {
      // Unwrap any existing CDATA sections (including partial/misplaced ones the AI wrote).
      // Replace each <![CDATA[...]]> with just its inner text.
      let clean = content.replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1');
      // Remove any orphaned CDATA openers or closers left over.
      clean = clean.replace(/<!\[CDATA\[/g, '').replace(/]]>/g, '');
      // Wrap in a single CDATA section so all JS characters are safe.
      return `${open}<![CDATA[${clean}]]>${close}`;
    }
  );
}

// ── JSON → XML conversion ────────────────────────────────────────────────────
//
// Converts a JSON command description to valid Command XML.
// The AI can use JSON to avoid XML character escaping entirely.
//
// Expected JSON shape:
//   { name, path?, title?, category, synopsis?, description, parameters: [{name,type,required,default?,description?}],
//     outputType?, component?, improve?, function: "js source code" }

export function commandJsonToXml(jsonText) {
  const d = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;

  const params = (d.parameters || []).map(p => {
    const attrStr = Object.entries(p)
      .map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`)
      .join(' ');
    return `    <Parameter ${attrStr} />`;
  }).join('\n');

  const examples = (d.examples || []).map(e =>
    `    <Example title="${(e.title || '').replace(/"/g, '&quot;')}">${e.xml || ''}</Example>`
  ).join('\n');

  const fnBlock = d.function
    ? `\n  <Function><![CDATA[\n${d.function}\n  ]]></Function>`
    : '';

  const examplesBlock = examples
    ? `\n  <Examples>\n${examples}\n  </Examples>`
    : '';

  return `<Command name="${d.name}" path="${d.path || `/cmd/${d.category || 'system'}/${d.name}`}" title="${d.title || d.name}" category="${d.category || 'uncategorized'}">
  <Synopsis>${d.synopsis || d.name}</Synopsis>
  <Description>${d.description || ''}</Description>
  <Parameters>
${params}
  </Parameters>
  <Output type="${d.outputType || 'component'}" component="${d.component || ''}" />${examplesBlock}
  <Improve>${d.improve || ''}</Improve>${fnBlock}
</Command>`;
}

// ── XML validation ───────────────────────────────────────────────────────────
//
// Returns { doc, error: string|null }.
// error is non-null if the document is a parsererror rather than valid XML.

export function parseAndValidateXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  // When DOMParser fails, the entire document root becomes the parsererror element.
  // Check the root tag (case-insensitive) — not descendants, to avoid false positives.
  const rootTag = doc.documentElement?.tagName?.toLowerCase() ?? '';
  if (rootTag === 'parsererror' || rootTag === 'parseerror') {
    const msg = doc.documentElement.textContent?.trim().split('\n')[0] || 'XML parse error';
    return { doc: null, error: msg };
  }
  return { doc, error: null };
}

// ── Function extraction ──────────────────────────────────────────────────────
//
// The AI always sees <Function> with inline JS (possibly in CDATA).
// The server always stores <Function src="src/index.js"/> + a separate JS file.
//
// extractFunctions() bridges the two: it sanitizes the XML, parses it,
// pulls out inline <Function> content, replaces each node with a src reference,
// and returns the files to be saved separately.

export function extractFunctions(xmlText, commandName) {
  const sanitized = sanitizeCommandXml(xmlText);
  const { doc, error } = parseAndValidateXml(sanitized);
  if (error) throw new Error(`Invalid XML: ${error}`);

  const files = [];

  for (const fn of [...doc.querySelectorAll('Function:not([src])')]) {
    const content = fn.textContent.trim();
    if (!content) continue;

    const filename = 'index.js';
    files.push({
      filename,
      content,
      url: `/xml/commands/${commandName}/src/${filename}`,
    });

    while (fn.firstChild) fn.removeChild(fn.firstChild);
    fn.setAttribute('src', `src/${filename}`);
  }

  return {
    xml: new XMLSerializer().serializeToString(doc.documentElement),
    files,
  };
}

// ── Function hydration ───────────────────────────────────────────────────────
//
// The reverse of extractFunctions: fetch each <Function src="..."/> file and
// inline the content so the AI can read it.

export async function hydrateXmlFunctions(xmlText, commandName, context) {
  const { doc } = parseAndValidateXml(xmlText);
  if (!doc) return xmlText;

  const fns = [...doc.querySelectorAll('Function[src]')];
  if (!fns.length) return xmlText;

  await Promise.all(fns.map(async fn => {
    const src = fn.getAttribute('src');
    try {
      const res = await context.fetch(`/xml/commands/${commandName}/${src}`);
      if (!res.ok) return;
      const js = await res.text();
      fn.removeAttribute('src');
      fn.textContent = '\n' + js + '\n  ';
    } catch { /* no JS file — leave src reference in place */ }
  }));

  return new XMLSerializer().serializeToString(doc.documentElement);
}

// ── Save ─────────────────────────────────────────────────────────────────────

export async function saveCommand(name, xmlText, { method = 'POST' } = {}, context) {
  const { xml, files } = extractFunctions(xmlText, name);

  await Promise.all(files.map(({ url, content }) =>
    context.fetch(url, {
      method:  'PUT',
      headers: { 'Content-Type': 'text/javascript' },
      body:    content,
    })
  ));

  return context.fetch(`/xml/commands/${name}`, {
    method,
    headers: { 'Content-Type': 'application/xml' },
    body:    xml,
  });
}

// ── Editor card ──────────────────────────────────────────────────────────────

export function makeEditorCard(title, xmlText, onSave) {
  const card = document.createElement('div');
  card.className = 'card border-secondary-subtle';

  const body = document.createElement('div');
  body.className = 'card-body p-3 vstack gap-2';

  const heading = document.createElement('div');
  heading.className = 'small fw-semibold text-body-secondary text-uppercase';
  heading.textContent = title;

  const textarea = document.createElement('textarea');
  textarea.className = 'form-control font-monospace small';
  textarea.style.minHeight = '260px';
  textarea.value = xmlText;
  textarea.spellcheck = false;

  const footer = document.createElement('div');
  footer.className = 'd-flex align-items-center gap-2';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-sm btn-primary';
  btn.textContent = 'Save Command';

  const status = document.createElement('span');
  status.className = 'small text-body-secondary';

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    status.textContent = 'Saving…';
    status.className = 'small text-body-secondary';
    try {
      const res = await onSave(textarea.value);
      if (res && !res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`${res.status}${detail ? ': ' + detail : ''}`);
      }
      status.textContent = 'Saved';
      status.className = 'small text-success';
    } catch (err) {
      status.textContent = err.message;
      status.className = 'small text-danger';
    } finally {
      btn.disabled = false;
    }
  });

  footer.append(btn, status);
  body.append(heading, textarea, footer);
  card.append(body);

  return card;
}

export function addGoalHint(card, goal) {
  if (!goal) return;
  const p = document.createElement('p');
  p.className = 'small text-body-secondary mb-0';
  p.textContent = `Goal: ${goal}`;
  card.querySelector('.card-body').insertBefore(p, card.querySelector('textarea'));
}
