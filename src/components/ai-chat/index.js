import { ReactiveHTMLElement } from "@/core/reactive.js";

export class AIChatElement extends ReactiveHTMLElement {
  static observedAttributes = ["placeholder"];

  constructor() {
    super();
    this.signal("placeholder", "Describe a goal...");
    this.signal("goal", "");
    this.messages = [];
    this.messagesNode = null;
  }

  mount() {
    this.className = "vstack gap-3";

    const help = document.createElement("div");
    help.className = "alert alert-info small mb-0";
    help.textContent = "The AI receives a live webMCP-style snapshot of /cmd, /workflows, and /proc/current-state on every request.";

    this.messagesNode = document.createElement("div");
    this.messagesNode.className = "vstack gap-2";

    const textarea = document.createElement("textarea");
    textarea.className = "form-control";
    textarea.rows = 6;

    const controls = document.createElement("div");
    controls.className = "d-flex flex-wrap gap-2";

    const ask = document.createElement("button");
    ask.type = "button";
    ask.className = "btn btn-primary";
    ask.innerHTML = '<i class="bi bi-stars me-2"></i>Ask AI';

    const showContext = document.createElement("button");
    showContext.type = "button";
    showContext.className = "btn btn-outline-secondary";
    showContext.innerHTML = '<i class="bi bi-hdd-network me-2"></i>Show OS Context';

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "btn btn-outline-danger ms-auto";
    clear.innerHTML = '<i class="bi bi-trash me-2"></i>Clear';

    const status = document.createElement("div");
    status.className = "small text-body-secondary";
    status.textContent = "Ready.";

    controls.append(ask, showContext, clear);

    this.concern.bindValue("goal", textarea);
    this.subscribe("placeholder", value => {
      textarea.placeholder = value;
    });

    this.concern.on(showContext, "click", () => {
      const os = this.os();
      const snapshot = os?.mcpSnapshot?.();
      this.addMessage("system", this.snapshotMarkdown(snapshot));
    });

    this.concern.on(clear, "click", () => {
      this.messages = [];
      this.messagesNode.replaceChildren();
      status.textContent = "Cleared.";
    });

    this.concern.on(ask, "click", async () => {
      const goal = this.signal("goal").value?.trim();
      if (!goal) return;

      const os = this.os();
      if (!os?.aiChat) {
        this.addMessage("system", "No x-os AI bridge is available.");
        return;
      }

      const history = this.messages.slice(-8);
      this.addMessage("user", goal);
      textarea.value = "";
      this.signal("goal").value = "";

      ask.disabled = true;
      status.textContent = "Calling /api/ai with live OS context...";

      try {
        const reply = await os.aiChat(goal, history);
        this.addMessage("assistant", reply);
        status.textContent = "Reply received.";
      } catch (error) {
        this.addMessage("system", `AI request failed: ${error.message}`);
        status.textContent = "Request failed.";
      } finally {
        ask.disabled = false;
      }
    });

    this.append(help, this.messagesNode, textarea, controls, status);
  }

  os() {
    return document.querySelector("x-os");
  }

  addMessage(role, content) {
    const message = { role, content: String(content ?? "") };
    this.messages.push(message);

    const card = document.createElement("div");
    card.className = "card border-secondary-subtle";

    const body = document.createElement("div");
    body.className = "card-body p-3";

    const label = document.createElement("div");
    label.className = "small text-body-secondary mb-2 text-uppercase";
    label.textContent = role;

    const text = document.createElement("pre");
    text.className = "mb-0 text-body text-wrap font-monospace small";
    text.textContent = message.content;

    body.append(label, text);
    card.append(body);
    this.messagesNode.append(card);
    card.scrollIntoView({ block: "nearest" });
  }

  snapshotMarkdown(snapshot) {
    if (!snapshot) return "# OS Context\n\nNo OS snapshot available.";

    return [
      "# OS Context",
      "",
      `Application: ${snapshot.application.name} ${snapshot.application.version}`,
      `Current state: ${snapshot.proc.currentState}`,
      "",
      "## Commands",
      "",
      ...snapshot.cmd.map(command => [
        `### ${command.name}`,
        `Path: ${command.path}`,
        `Category: ${command.category}`,
        command.description,
        command.parameters.length ? `Parameters: ${command.parameters.map(parameter => parameter.name || parameter.type).join(", ")}` : "Parameters: none",
        command.outputs.length ? `Outputs: ${command.outputs.map(output => output.name || output.type).join(", ")}` : "Outputs: none",
        ""
      ].join("\n")),
      "## Workflows",
      "",
      ...snapshot.workflows.map(workflow => [
        `### ${workflow.name}`,
        `Category: ${workflow.category}`,
        `Actions: ${workflow.actions.map(action => action.use).join(" -> ") || "none"}`,
        ""
      ].join("\n"))
    ].join("\n");
  }
}
