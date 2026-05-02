# Neurosymbolic

A browser OS where the AI lives at runtime, reads every command's source code, and edits the corpus from inside the chat.

---

Commands are XML. Each one carries its own JavaScript.

```xml
<Command name="alert" path="/cmd/interface/alert" title="Show Alert" category="interface">
  <Description>Prints a Bootstrap alert into the conversational interface.</Description>
  <Function>
export async function main({ text = "", color = "primary" }, context) {
  const node = document.createElement("x-alert");
  node.setAttribute("text", text);
  node.setAttribute("color", color);
  context.chat.print(node);
}
  </Function>
</Command>
```

The AI receives this — code and all — on every single request.

---

The OS boots by fetching `Application.xml`, resolving `<Mount>` declarations, hydrating every `<Function src="..."/>` with its live source, and importing each command module before the first pixel renders.

```xml
<Mounts>
  <Mount src="/xml/commands" into="Commands" />
</Mounts>
```

One line. Every command in the corpus, loaded and alive.

---

Create a command with one HTTP call.

```
POST /xml/commands/my-command
Content-Type: application/xml

<Command name="my-command" ...>
  <Function>
    export async function main(parameters, context) { ... }
  </Function>
</Command>
```

The server extracts the `<Function>` content, writes `src/index.js`, stores the definition with a `src` reference, and generates a README. The browser imports the module on next boot.

---

The AI proposes. The user saves. The OS reloads.

```
<Action use="command-builder" target="alert" goal="add dismissible support" />
```

An editor card opens in the chat. The current command XML is there — with its implementation inlined. Edit. Click Save. Done.

---

Command functions run against a controlled context. No globals. No side-channel access.

```js
export async function main({ to, text = "Continue" }, context) {
  const button = document.createElement("x-button");
  button.setAttribute("text", text);
  button.addEventListener("click", () => context.state.goto(to));
  context.chat.print(button);
}
```

`context.fetch` · `context.chat` · `context.state` · `context.xml` · `context.commands` · `context.workflows`

---

The HTTP server is 250 lines of Node built-ins. No Express. No dependencies. The process manager is a single file with daemon mode, hot reload, exponential backoff, and log routing. The reactive system powering the UI fits in one class.

---

The whole corpus is a directory tree. Each command is a folder. The AI never sees the file system.

```
xml/commands/
  alert/
    Command.xml
    README.md        ← auto-generated
    src/
      index.js       ← extracted from <Function>
```

---

`npm start` · `npm run dev` · `npm run logs -- alert`

The AI is already inside.
