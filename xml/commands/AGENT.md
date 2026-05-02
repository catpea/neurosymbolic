# Agent Guide — xml/commands/

This directory is the command corpus for AI Unix. Each subdirectory is one command.

Commands are the reusable abilities of the OS. They live in the `/cmd` namespace and are invoked by workflows. An AI agent should improve existing commands before creating new ones, and create new commands before writing one-off workflow logic.

---

## Directory structure

```
xml/commands/
  <command-name>/
    Command.xml      — definition: metadata, parameters, outputs, examples
    README.md        — auto-generated documentation (regenerated on every PUT/POST)
    src/
      index.js       — runtime: export async function main(parameters, context)
```

Only commands with client-side behavior need `src/index.js`. Commands that are AI-facing descriptions (plan, improve-command, etc.) are definition-only.

---

## Command.xml schema

```xml
<Command name="command-name" path="/cmd/category/command-name" title="Human Title" category="category">
  <Synopsis>command-name param="value"</Synopsis>
  <Description>One sentence plain text description.</Description>
  <Parameters>
    <Parameter name="param" type="text/plain" required="true" default="" description="What this parameter does." />
  </Parameters>
  <Output type="component" component="x-tag" />
  <Examples>
    <Example title="Label"><Action use="command-name" param="value" /></Example>
  </Examples>
  <Improve>Guidance for future AI improvements. What to add, what to avoid.</Improve>
</Command>
```

### Parameter types

| Type | Meaning |
|------|---------|
| `text/plain` | Single-line text |
| `bootstrap/color` | Bootstrap semantic color (primary, success, danger, …) |
| `bootstrap/icon` | Bootstrap Icons class (bi-house, bi-stars, …) |
| `state/path` | OS state path (hello-world, .., /application/shell) |
| `command/name` | Name of another command |
| `command/category` | Category name |
| `enum` | One of a declared set; add `options` attribute |
| `none` | Command takes no parameters |

---

## src/index.js — runtime contract

```js
export async function main(parameters, context) {
  // parameters — resolved Action attribute object { paramName: "value", … }
  // context    — controlled OS services (see below)
}
```

Parameters are already resolved: variable references like `$message` are substituted before `main` is called.

### Context API

| Field | Signature | Description |
|-------|-----------|-------------|
| `context.fetch` | `(url, options?) => Promise<Response>` | Network access |
| `context.chat.print` | `(node: HTMLElement) => void` | Append element to chat output |
| `context.chat.clear` | `() => void` | Clear chat output |
| `context.state.goto` | `(target: string) => Promise<void>` | Navigate to a state |
| `context.state.current` | `() => string` | Current state path |
| `context.xml` | `XMLDocument` | Live application XML document |
| `context.commands` | `() => Command[]` | All registered commands |
| `context.workflows` | `() => Workflow[]` | All registered workflows |

### Example

```js
// xml/commands/my-command/src/index.js
export async function main({ text = "Hello", color = "primary" }, context) {
  const node = document.createElement("x-alert");
  node.setAttribute("text", text);
  node.setAttribute("color", color);
  context.chat.print(node);
}
```

---

## XML Route (CRUD)

The server exposes a CRUD API at `/xml/:type/:name` backed by the `xml/` directory tree.

### GET /xml/commands
Returns `<Commands>` wrapping every command, sorted alphabetically. This is the mount source consumed by the OS at boot.

```
Content-Type: application/xml
```

### GET /xml/commands/:name
Returns the raw `Command.xml` for one command.

### POST /xml/commands/:name
Creates `xml/commands/:name/Command.xml` and auto-generates `README.md`.

```
Content-Type: application/xml
Body: raw <Command> XML
→ 201 { "ok": true, "path": "xml/commands/:name" }
```

### PUT /xml/commands/:name
Overwrites `Command.xml` and regenerates `README.md`.

```
Content-Type: application/xml
Body: raw <Command> XML
→ 200 { "ok": true, "path": "xml/commands/:name" }
```

### DELETE /xml/commands/:name
Removes the entire command directory.

```
→ 200 { "ok": true }
```

---

## How the OS loads commands at boot

1. Fetch `./Application.xml`.
2. Parse XML; find `<Mounts>`.
3. Fetch each `<Mount src="..." into="...">` in parallel.
4. Graft the fetched children into the target element (e.g. `<Commands>`).
5. For every command now in `<Commands>`, attempt `import("/xml/commands/:name/src/index.js")`.
6. Commands that have a `main` export are registered in `commandModules`.
7. Render screen; enter initial state.

---

## Creating a new command (step by step)

1. Design the `<Command>` XML — name, path, parameters, outputs, examples.
2. `POST /xml/commands/:name` with the XML body.
3. If the command needs client-side code, write `xml/commands/:name/src/index.js` with `export async function main(parameters, context)`.
4. To make it live without a full page reload:
   - Fetch `/xml/commands/:name` to get the XML.
   - Parse with `DOMParser` and `importNode` the `<Command>` into `os.xml.querySelector("Commands")`.
   - Call `os.loadCommandModules()` to pick up the new `src/index.js`.

---

## Rules

- Reuse existing commands before creating new ones.
- Improve an existing command before creating a near-duplicate.
- Keep `<Description>` to one sentence of plain text — no HTML, no angle brackets.
- Keep parameters to the minimum needed (3–6 is ideal).
- Put reusable ability in a command. Put one-off logic in a workflow.
- Do not claim execution, file inspection, or test success without evidence.
