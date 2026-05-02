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
  <Function>
export async function main(parameters, context) {

}
  </Function>
</Command>`;
}

// ── Function extraction ──────────────────────────────────────────────────────
//
// The AI always sees <Function> with inline JS.
// The server always stores <Function src="src/index.js"/> + a separate JS file.
//
// extractFunctions() bridges the two: it parses the XML the AI wrote,
// pulls out inline <Function> content, replaces each node with a src reference,
// and returns the files to be saved separately.

export function extractFunctions(xmlText, commandName) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const parseErr = doc.querySelector('parseerror');
  if (parseErr) throw new Error(`Invalid XML: ${parseErr.textContent.trim().split('\n')[0]}`);

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

    // Replace inline content with a src reference
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
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parseerror')) return xmlText;

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
//
// Full save: extract <Function> inline content → PUT each JS file →
// POST or PUT the Command XML.

export async function saveCommand(name, xmlText, { method = 'POST' } = {}, context) {
  const { xml, files } = extractFunctions(xmlText, name);

  // JS files first (parallel)
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
//
// A Bootstrap card with a monospace textarea and a Save button.
// onSave(xmlText) should return a Response (or throw).

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

// Prepend a goal hint paragraph to an editor card's body
export function addGoalHint(card, goal) {
  if (!goal) return;
  const p = document.createElement('p');
  p.className = 'small text-body-secondary mb-0';
  p.textContent = `Goal: ${goal}`;
  card.querySelector('.card-body').insertBefore(p, card.querySelector('textarea'));
}
