import {
  addGoalHint,
  makeEditorCard,
  readXmlResource,
  saveXmlResource,
  setEditorButtonLabel,
} from '/core/command-utils.js';

function titleCase(value = '') {
  return value
    .split(/[-_/]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'State';
}

function leafStateName(value = '') {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (!clean.includes('/')) return clean;
  return clean.split('/').filter(Boolean).at(-1) || '';
}

function defaultScreenXml(name = 'main') {
  return `<Group name="${name}">
  <Panel use="main-panel" />
</Group>`;
}

function defaultStateXml(name) {
  return `<State name="${name}" title="${titleCase(name)}">
</State>`;
}

function makeResponseCard(title, lines, color = 'secondary') {
  const card = document.createElement('div');
  card.className = `card border-${color}-subtle`;

  const body = document.createElement('div');
  body.className = 'card-body p-3';

  const heading = document.createElement('div');
  heading.className = `small fw-semibold text-${color} text-uppercase mb-2`;
  heading.textContent = title;

  const pre = document.createElement('pre');
  pre.className = 'mb-0 text-wrap font-monospace small';
  pre.textContent = lines.join('\n').trim();

  body.append(heading, pre);
  card.append(body);
  return card;
}

export async function main({ goal = '', mode = 'propose', screen = 'main', state = '' }, context) {
  const screenName = (screen || 'main').trim();
  const stateName = leafStateName(state) || leafStateName(context.state.current()) || 'hello-world';

  if (mode === 'apply') {
    const prompt = [
      `Use the mounted screen resource "${screenName}" and the mounted state resource "${stateName}" to satisfy this goal: ${goal}.`,
      'Emit OsCall saves directly. Use save-screen for /xml/screen and save-state for /xml/state.',
      `If you touch the screen resource, keep it rooted at <Group name="${screenName}">...</Group>.`,
      `If you touch the state resource, keep it rooted at <State name="${stateName}">...</State>.`,
      'Prefer the smallest edit that works. Do not emit <Action use="program-ui"> recursively.',
    ].join('\n');

    const result = await context.ai.chat(prompt, {
      agent: 'cindy',
      skills: ['check-first', 'minimal'],
    });

    const lines = [];
    if (result.plan) {
      lines.push(`Plan: ${result.plan.title}`);
      for (const step of result.plan.steps) lines.push(`- ${step.id}. ${step.agent || 'cindy'}: ${step.text}`);
      lines.push('');
    }

    if (result.calls?.length) {
      lines.push('OS Calls:');
      for (const call of result.calls) lines.push(`- ${call.status}: ${call.message}`);
      lines.push('');
    }

    lines.push(result.reply || 'No reply.');
    context.chat.print(makeResponseCard('Program UI', lines, result.calls?.some(call => call.status !== 'saved') ? 'warning' : 'primary'));
    return;
  }

  const [screenRes, stateRes] = await Promise.all([
    context.fetch(`/xml/screen/${screenName}`),
    context.fetch(`/xml/state/${stateName}`),
  ]);

  const screenXml = screenRes.ok ? await readXmlResource('screen', screenName, context) : defaultScreenXml(screenName);
  const stateXml = stateRes.ok ? await readXmlResource('state', stateName, context) : defaultStateXml(stateName);

  const screenCard = makeEditorCard(
    `Screen Resource: ${screenName}`,
    screenXml,
    xml => saveXmlResource('screen', screenName, xml, { method: screenRes.ok ? 'PUT' : 'POST' }, context)
  );
  setEditorButtonLabel(screenCard, 'Save Screen');
  addGoalHint(screenCard, goal);

  const stateCard = makeEditorCard(
    `State Resource: ${stateName}`,
    stateXml,
    xml => saveXmlResource('state', stateName, xml, { method: stateRes.ok ? 'PUT' : 'POST' }, context)
  );
  setEditorButtonLabel(stateCard, 'Save State');
  addGoalHint(stateCard, goal);

  context.chat.print(makeResponseCard(
    'Program UI',
    [
      `Mode: ${mode}`,
      `Screen resource: /xml/screen/${screenName}`,
      `State resource: /xml/state/${stateName}`,
      'Screen changes patch live. State changes affect future navigation in the current session.',
    ],
    'info'
  ));
  context.chat.print(screenCard);
  context.chat.print(stateCard);
}
