# AI Unix — Usage Guide

## Agent Quick Reference

| Agent      | Role                   | Use when…                                                      |
|------------|------------------------|----------------------------------------------------------------|
| **Sophia** | Manager                | Your goal has multiple parts and you're not sure who owns each |
| **Alice**  | Command Architect      | You need a new command, or an existing one needs new behavior  |
| **Betty**  | Workflow Designer      | You need to sequence existing commands into a program          |
| **Cindy**  | UI Specialist          | You need screen layout, navigation state, or component changes |
| **Daisy**  | Debug Specialist       | Something is broken and you need it traced and fixed           |
| **Emma**   | Documentation          | Descriptions, synopses, or examples are missing or unclear     |

Use **General** (no agent) when you're exploring or not sure.

---

## Per-Agent Examples

### Sophia — Manager

Sophia reads the OS snapshot, emits a `<Plan>` for multi-step goals, and tells you exactly which agent handles each step.

```
I want to monitor my server health endpoint every time I open the shell.
The endpoint is http://localhost:11222/health and returns {"status":"ok","uptime":123}.
Plan it out.
```

```
Set up a complete onboarding flow: welcome screen, a configuration step, then a return button.
I don't know which agents should build what — figure it out.
```

```
The http command doesn't exist yet, and I need a workflow that uses it.
Break this down into steps and assign each to the right specialist.
```

**Tip:** Sophia's plan lists steps by agent. Send each step verbatim to the named agent to execute it.

---

### Alice — Command Architect

Alice creates and improves commands. She always emits full Command XML with a `<Function>` block and saves it automatically via `<OsCall>`.

```
Create a /cmd/network/http command. It should use fetch, check status code, check if the
response body contains a substring, and check a simple JSON path like "status" == "ok".
```

```
The alert command should support an optional dismissible parameter so users can close it.
Improve the existing alert — do not create a new command.
```

```
Add a /cmd/system/timestamp command that prints the current ISO timestamp to chat as an info alert.
```

```
I need a command that shows a confirm dialog before navigating to a state.
Name it confirm-goto. Reuse context.chat.print and context.state.goto.
```

**Tip:** Alice works best with concrete capability descriptions. Name the inputs and outputs you expect.

---

### Betty — Workflow Designer

Betty composes existing commands into workflows and saves them. She checks the snapshot before writing — if a needed command is missing, she'll tell you to ask Alice first.

```
Compose a server-status-check workflow: cls, then alert "Checking...", then http with
url="http://localhost:11222/health" expectStatus="200" expectJsonPath="status" expectJsonValue="ok".
```

```
Write a morning-check workflow that clears the screen, checks three URLs in sequence,
and shows a summary alert at the end. Assume the http command exists.
```

```
I need a demo workflow that shows a welcome message, prints two example alerts, and then
offers a navigation button back to shell.
```

**Tip:** Tell Betty which commands to use by name. She reads the snapshot but clear names save tokens.

---

### Cindy — UI Specialist

Cindy handles screen layout, navigation states, and Application.xml structure.

```
Add a new state called /application/settings. It should clear the screen on enter and show
a placeholder alert saying "Settings coming soon", then a Back button.
```

```
I want the AI Chat offcanvas to open from the left side instead of the right.
```

```
Add a second panel to the main screen for a command palette. It should appear below the chat area.
```

**Tip:** Give Cindy the state path and the enter workflow you want. She proposes complete XML fragments.

---

### Daisy — Debug Specialist

Daisy reads `functionCode` from the OS snapshot, traces the execution path, and proposes the smallest fix. She touches only what is broken.

```
The goto command throws "Cannot read properties of undefined (reading 'goto')".
Read the functionCode and fix it.
```

```
The http command swallows all errors silently. I need it to print a danger alert
when fetch itself fails (network error, not just a bad status code).
```

```
Alert shows "undefined" as the text when called from a workflow with a variable.
Trace why variable substitution is failing.
```

**Tip:** Paste the exact error message if you have it. Daisy uses it to focus on the right part of the code.

---

### Emma — Documentation Specialist

Emma improves command XML without touching code. Descriptions, synopses, examples, and `<Improve>` hints.

```
The http command has no Synopsis, no Examples, and a generic Description.
Improve all three — keep Description to one sentence.
```

```
Add two realistic examples to every command in the navigation category.
```

```
The Improve hint on alert is vague. Rewrite it with specific guidance for the next agent.
```

---

## Multi-Step Example

**Goal:** Run a server health check every time the shell loads.

**Step 1** — Select **Sophia**. Enable the `step-by-step` skill. Send:

```
I want the shell state to automatically check http://localhost:11222/health on enter.
The response is JSON with a "status" field that should equal "ok". Plan it.
```

Sophia emits a `<Plan>` card and assigns Alice (create `http` command) and Betty (compose workflow).

**Step 2** — Select **Alice**. Send the first step from Sophia's plan verbatim:

```
Create /cmd/network/http with fetch, status-code check, body-contains check, and
a simple JSON-path check. Save it.
```

Alice creates the command and saves it via OsCall. The OS card confirms.

**Step 3** — Select **Betty**. Send the second step from Sophia's plan:

```
Compose a server-status-check workflow: cls, alert "Checking server...", http with
url="http://localhost:11222/health" expectStatus="200" expectJsonPath="status" expectJsonValue="ok".
Save it.
```

Betty writes the workflow and saves it. After browser refresh, it will be live.

**Step 4** — Select **Cindy** (or modify `Application.xml` directly). Wire the workflow to the shell state's `enter` event.

---

## Skills

Skills are short behavioral modifiers that stack on top of any agent. Enable them in the AI Chat panel before sending your message.

| Skill              | Effect                                                                  |
|--------------------|-------------------------------------------------------------------------|
| `step-by-step`     | Agent plans first, then executes one step, then stops                   |
| `check-first`      | Agent scans the snapshot for existing commands before creating anything |
| `minimal`          | Agent does only what was asked — no extra parameters, no gold-plating   |
| `explain-and-do`   | Agent explains its approach in plain language before emitting XML        |

### When to stack skills

**`check-first` + `minimal`** — when you want a focused new command with no surprises:
```
Select Alice. Enable: check-first, minimal.
Send: "I need a command that prints current ISO time to chat."
```
Alice confirms nothing similar exists, then creates the smallest possible timestamp command.

**`step-by-step` + `explain-and-do`** — learning mode:
```
Select Sophia. Enable: step-by-step, explain-and-do.
Send: "Build a complete user onboarding flow."
```
Sophia emits a plan, explains the first step in plain language, then acts. Pauses for your confirmation before moving on.

**`explain-and-do` alone** — when you want to understand what the AI is doing before it does it:
```
Select Daisy. Enable: explain-and-do.
Send: "The http command crashes on network errors. Fix it."
```
Daisy names the bug, explains the fix in one paragraph, then emits the corrected XML.

---

## Command Quick Reference

These commands already exist in the corpus. You can reference them in your requests.

| Command           | Category   | What it does                                           |
|-------------------|------------|--------------------------------------------------------|
| `alert`           | interface  | Prints a Bootstrap alert to chat                       |
| `cls`             | interface  | Clears the chat output area                            |
| `goto`            | navigation | Prints a button that navigates to a state path         |
| `create-command`  | ai         | Scaffolds a new command (opens editor card)            |
| `command-builder` | ai         | Powerful command editor for complex authoring          |
| `improve-command` | ai         | Improves an existing command (opens editor card)       |
| `plan`            | ai         | Turns a goal into markdown instructions                |
| `ask-os`          | ai         | Lets the AI query the live OS via OSCall messages      |
| `program-ui`      | ai         | Lets the AI propose or apply Screen XML changes        |
