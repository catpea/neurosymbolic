import { makeTemplate, saveCommand, makeEditorCard, addGoalHint } from '/core/command-utils.js';

export async function main({ name = '', category = 'system', goal = '' }, context) {
  const cmdName = name || 'new-command';
  const xml = makeTemplate(cmdName, category);

  const card = makeEditorCard(
    `Create Command: ${cmdName}`,
    xml,
    xml => saveCommand(cmdName, xml, { method: 'POST' }, context)
  );
  addGoalHint(card, goal);

  context.chat.print(card);
}
