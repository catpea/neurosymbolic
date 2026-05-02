import { makeTemplate, saveCommand, hydrateXmlFunctions, makeEditorCard, addGoalHint } from '/core/command-utils.js';

export async function main({ target = '', goal = '' }, context) {
  if (!target) {
    const node = document.createElement('x-alert');
    node.setAttribute('text', 'command-builder: target parameter is required');
    node.setAttribute('color', 'warning');
    context.chat.print(node);
    return;
  }

  const res = await context.fetch(`/xml/commands/${target}`);
  let xml, method;

  if (res.ok) {
    xml    = await hydrateXmlFunctions(await res.text(), target, context);
    method = 'PUT';
  } else {
    xml    = makeTemplate(target, 'system');
    method = 'POST';
  }

  const card = makeEditorCard(
    `Command Builder: ${target}`,
    xml,
    xml => saveCommand(target, xml, { method }, context)
  );
  addGoalHint(card, goal);

  context.chat.print(card);
}
