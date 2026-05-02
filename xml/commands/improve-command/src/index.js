import { saveCommand, hydrateXmlFunctions, makeEditorCard, addGoalHint } from '/core/command-utils.js';

export async function main({ command = '', goal = '' }, context) {
  if (!command) {
    const node = document.createElement('x-alert');
    node.setAttribute('text', 'improve-command: command parameter is required');
    node.setAttribute('color', 'warning');
    context.chat.print(node);
    return;
  }

  const res = await context.fetch(`/xml/commands/${command}`);
  if (!res.ok) {
    const node = document.createElement('x-alert');
    node.setAttribute('text', `improve-command: command "${command}" not found`);
    node.setAttribute('color', 'danger');
    context.chat.print(node);
    return;
  }

  const xml  = await hydrateXmlFunctions(await res.text(), command, context);

  const card = makeEditorCard(
    `Improve Command: ${command}`,
    xml,
    xml => saveCommand(command, xml, { method: 'PUT' }, context)
  );
  addGoalHint(card, goal);

  context.chat.print(card);
}
