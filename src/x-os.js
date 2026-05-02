import { ReactiveHTMLElement } from "@/core/reactive.js";
import { loadSoulPrompt, loadWebMcpPrompt, loadAgentPrompt, loadSkillPrompt, AGENTS } from "@/core/prompts.js";
import { attrs, cssEscape } from "@/core/xml.js";
import { extractFunctions, sanitizeCommandXml, commandJsonToXml } from "@/core/command-utils.js";

class XOS extends ReactiveHTMLElement {
  static observedAttributes = ["fs"];

  constructor() {
    super();
    this.signal("fs", "#fs");
    this.signal("statePath", "");
    this.xml            = null;
    this.root           = null;
    this.chat           = null;
    this.commandModules = new Map();
  }

  mount() {
    this.hidden = true;

    this.subscribe("fs", selector => {
      this.boot(selector).catch(error => console.error("x-os boot failed", error));
    });

    this.subscribe("statePath", path => {
      for (const node of document.querySelectorAll("[data-state-label]")) {
        node.textContent = path;
      }
    });
  }

  async boot(selector) {
    let xmlText;

    const source = document.querySelector(selector);
    if (source) {
      xmlText = source.textContent;
    } else {
      const response = await fetch("./Application.xml");
      if (!response.ok) throw new Error(`Failed to fetch Application.xml: ${response.status}`);
      xmlText = await response.text();
    }

    this.xml = new DOMParser().parseFromString(xmlText, "application/xml");
    const error = this.xml.querySelector("parsererror");
    if (error) throw new Error(error.textContent);

    await this.resolveMounts();
    await this.hydrateCommandFunctions();
    await this.loadCommandModules();

    this.root = document.querySelector("[data-os-root]") || document.createElement("div");
    this.root.dataset.osRoot = "";
    document.body.prepend(this.root);

    this.renderScreen();
    await this.enterInitialState();
  }

  // Fetch every <Mount src="..." into="..."> and graft its children into the
  // matching element before the screen renders. Runs in parallel.
  async resolveMounts() {
    const mounts = [...this.xml.querySelectorAll("Mounts > Mount")];
    if (!mounts.length) return;

    await Promise.all(mounts.map(async mount => {
      const src  = mount.getAttribute("src");
      const into = mount.getAttribute("into");
      if (!src || !into) return;

      const response = await fetch(src);
      if (!response.ok) throw new Error(`Mount failed ${src}: ${response.status}`);

      const text = await response.text();
      const doc  = new DOMParser().parseFromString(text, "application/xml");
      const parseError = doc.querySelector("parsererror");
      if (parseError) throw new Error(`Mount parse error (${src}): ${parseError.textContent}`);

      const target = this.xml.querySelector(into);
      if (!target) throw new Error(`Mount target not found: ${into}`);

      for (const child of [...doc.documentElement.children]) {
        target.appendChild(this.xml.importNode(child, true));
      }
    }));
  }

  // Fetch every <Function src="..."/> in the live XML and replace it with the
  // inline JS content so the AI can see command implementations via mcpSnapshot.
  // Runs after resolveMounts, before loadCommandModules.
  async hydrateCommandFunctions() {
    const fns = [...this.xml.querySelectorAll("Commands > Command > Function[src]")];
    if (!fns.length) return;

    await Promise.all(fns.map(async fn => {
      const src  = fn.getAttribute("src");
      const name = fn.parentElement?.getAttribute("name");
      if (!name || !src) return;

      try {
        const res = await fetch(`/xml/commands/${name}/${src}`);
        if (!res.ok) return;
        const js = await res.text();
        fn.removeAttribute("src");
        fn.textContent = "\n" + js + "\n  ";
      } catch { /* no JS file yet — leave src reference */ }
    }));
  }

  // Try to import src/index.js for every mounted command. Commands without a
  // runtime module are definition-only (AI-facing) and skip silently.
  async loadCommandModules() {
    this.commandModules.clear();
    await Promise.all(this.commands().map(async ({ name }) => {
      try {
        const mod = await import(`/xml/commands/${name}/src/index.js`);
        if (typeof mod.main === "function") this.commandModules.set(name, mod);
      } catch {
        // no src module for this command — that's fine
      }
    }));
  }

  // Build the controlled context object passed to every command's main().
  buildContext() {
    return {
      fetch:     (...args) => fetch(...args),
      chat: {
        print:   node   => this.chat?.print(node),
        clear:   ()     => this.chat?.clear(),
      },
      state: {
        goto:    target => this.goto(target),
        current: ()     => this.signal("statePath").value,
      },
      xml:       this.xml,
      commands:  () => this.commands(),
      workflows: () => this.workflows(),
    };
  }

  commands() {
    if (!this.xml) return [];

    return [...this.xml.querySelectorAll("Commands > Command")].map(node => ({
      name: node.getAttribute("name") || "",
      path: node.getAttribute("path") || `/cmd/${node.getAttribute("name")}`,
      title: node.getAttribute("title") || node.getAttribute("name") || "command",
      category: node.getAttribute("category") || "uncategorized",
      description:  node.querySelector("Description")?.textContent.trim() || "",
      parameters:   [...node.querySelectorAll(":scope > Input, :scope > Parameters > Parameter")].map(input => attrs(input)),
      outputs:      [...node.querySelectorAll(":scope > Output")].map(output => attrs(output)),
      functionCode: node.querySelector(":scope > Function:not([src])")?.textContent?.trim() || null
    }));
  }

  workflows() {
    if (!this.xml) return [];

    return [...this.xml.querySelectorAll("Workflows > Workflow")].map(node => ({
      name: node.getAttribute("name") || "",
      title: node.getAttribute("title") || node.getAttribute("name") || "workflow",
      category: node.getAttribute("category") || "uncategorized",
      variables: [...node.querySelectorAll(":scope > Variables > Variable")].map(variable => attrs(variable)),
      actions: [...node.children]
        .filter(child => child.tagName === "Action")
        .map(action => attrs(action))
    }));
  }

  mcpSnapshot() {
    if (!this.xml) return null;

    const application = this.xml.querySelector("Application");

    return {
      application: {
        name: application?.getAttribute("name") || "application",
        version: application?.getAttribute("version") || "0.0.0"
      },
      proc: {
        currentState: this.signal("statePath").value || ""
      },
      cmd: this.commands(),
      workflows: this.workflows()
    };
  }

  async systemPromptMessages(agent = null, skills = []) {
    const soulLoader = agent ? loadAgentPrompt(agent) : loadSoulPrompt();
    const loaders = [soulLoader, loadWebMcpPrompt(), ...skills.map(s => loadSkillPrompt(s).catch(() => null))];
    const results = await Promise.all(loaders);
    return results.filter(Boolean).map(content => ({ role: "system", content }));
  }

  // Parse a single <Plan> block from AI response text.
  // Returns { plan: {title, steps} | null, cleaned: text without the Plan block }
  extractPlan(responseText) {
    const match = responseText.match(/<Plan[\s\S]*?<\/Plan>/);
    if (!match) return { plan: null, cleaned: responseText };

    const raw = match[0];
    const titleM = raw.match(/title="([^"]*)"/);
    const title = titleM?.[1] || "Plan";

    const steps = [];
    const stepRe = /<Step\s([^>]*)>([\s\S]*?)<\/Step>/g;
    let sm;
    while ((sm = stepRe.exec(raw)) !== null) {
      const idM    = sm[1].match(/id="([^"]*)"/);
      const agentM = sm[1].match(/agent="([^"]*)"/);
      steps.push({ id: idM?.[1] || String(steps.length + 1), agent: agentM?.[1] || "", text: sm[2].trim() });
    }

    return { plan: { title, steps }, cleaned: responseText.replace(raw, "").trim() };
  }

  // Parse <OsCall> blocks from AI response text and execute each one.
  // Returns { calls: [{use, name, status, message}], cleaned: text without OsCall blocks }
  async executeOsCalls(responseText) {
    const calls = [];
    const regex = /<OsCall\s([^>]*)>([\s\S]*?)<\/OsCall>/g;
    let match;
    const blocks = [];

    while ((match = regex.exec(responseText)) !== null) {
      blocks.push({ full: match[0], attrs: match[1], body: match[2] });
    }

    for (const block of blocks) {
      const useMatch = block.attrs.match(/use="([^"]+)"/);
      const nameMatch = block.attrs.match(/name="([^"]+)"/);
      const methodMatch = block.attrs.match(/method="([^"]+)"/i);

      const use = useMatch?.[1];
      const name = nameMatch?.[1];
      const method = methodMatch?.[1]?.toUpperCase() || "POST";

      if (!use || !name) {
        calls.push({ use, name, status: "error", message: "OsCall missing use or name attribute" });
        continue;
      }

      try {
        if (use === "save-command") {
          const raw = block.body.trim();

          // Detect JSON body and convert to XML (AI fallback format)
          let xmlBody = raw;
          if (raw.startsWith("{")) {
            try { xmlBody = commandJsonToXml(raw); }
            catch (e) { throw new Error(`JSON→XML conversion failed: ${e.message}`); }
          }

          // Sanitize: wrap bare <Function> content in CDATA so JS operators don't break parsing
          const sanitized = sanitizeCommandXml(xmlBody);

          let cleanXml, files;
          try {
            ({ xml: cleanXml, files } = extractFunctions(sanitized, name));
          } catch (parseErr) {
            calls.push({ use, name, status: "parse-error", message: parseErr.message, sanitizedBody: sanitized, method });
            continue;
          }

          await Promise.all(files.map(({ url, content }) =>
            fetch(url, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: content })
          ));
          const res = await fetch(`/xml/commands/${name}`, {
            method,
            headers: { "Content-Type": "application/xml" },
            body: cleanXml
          });
          if (!res.ok) {
            const detail = await res.text().catch(() => "");
            throw new Error(`HTTP ${res.status}${detail ? ": " + detail : ""}`);
          }
          calls.push({ use, name, status: "saved", message: `Command '${name}' saved (${method})` });

        } else if (use === "save-workflow") {
          const res = await fetch(`/xml/workflows/${name}`, {
            method,
            headers: { "Content-Type": "application/xml" },
            body: block.body.trim()
          });
          if (!res.ok) {
            const detail = await res.text().catch(() => "");
            throw new Error(`HTTP ${res.status}${detail ? ": " + detail : ""}`);
          }
          calls.push({ use, name, status: "saved", message: `Workflow '${name}' saved (${method})` });
        } else {
          calls.push({ use, name, status: "error", message: `Unknown OsCall: ${use}` });
        }
      } catch (err) {
        calls.push({ use, name, status: "error", message: err.message });
      }
    }

    const cleaned = responseText.replace(/<OsCall[\s\S]*?<\/OsCall>/g, "").trim();
    return { calls, cleaned };
  }

  async callAI(messages) {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        temperature: 0.4,
        max_tokens: 8192,
        stream: false
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`POST /api/ai failed with ${response.status}${text ? `: ${text}` : ""}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || "";
  }

  async aiChat(goal, history = [], { agent = null, skills = [], onOsCall = null } = {}) {
    const messages = [
      ...(await this.systemPromptMessages(agent, skills)),
      { role: "system", content: "Live OS snapshot:\n" + JSON.stringify(this.mcpSnapshot(), null, 2) },
      ...history
        .filter(m => m.role === "user" || m.role === "assistant")
        .map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: goal }
    ];

    let reply = await this.callAI(messages);

    const { plan, cleaned: afterPlan } = this.extractPlan(reply);
    const { calls, cleaned } = await this.executeOsCalls(afterPlan);

    if (calls.length > 0 && onOsCall) {
      onOsCall(calls);
    }

    // If there were OsCalls, do a follow-up turn so AI can acknowledge results
    if (calls.length > 0) {
      const results = calls.map(c => `[OsCall ${c.use} name="${c.name}": ${c.status} — ${c.message}]`).join("\n");
      messages.push({ role: "assistant", content: reply });
      messages.push({ role: "user", content: `OS call results:\n${results}\n\nSummarize what was done.` });
      const followUp = await this.callAI(messages);
      const { cleaned: cleanedFollowUp } = await this.executeOsCalls(followUp);
      return { reply: cleanedFollowUp || cleaned, calls, plan };
    }

    return { reply: cleaned || reply, calls, plan };
  }

  renderScreen() {
    const screen = this.xml.querySelector("Application > Screen");
    if (!screen) throw new Error("Application requires a Screen element.");

    this.root.replaceChildren();
    for (const child of [...screen.children]) {
      this.root.append(this.renderScreenNode(child));
    }

    this.chat = this.root.querySelector('x-chat[name="main-chat"]') || this.root.querySelector("x-chat");
  }

  renderScreenNode(node) {
    const tag = node.tagName;

    if (tag === "Navbar") return this.renderNavbar(node);
    if (tag === "Main") return this.renderMain(node);
    if (tag === "Panel") return this.renderPanelReference(node);
    if (tag === "Chat") return this.element("x-chat", attrs(node));
    if (tag === "Offcanvas") return this.renderOffcanvas(node);
    if (tag === "Modal") return this.renderModal(node);
    if (tag === "Button") return this.renderButton(node);
    if (tag === "AIChat") return this.element("x-ai-chat", attrs(node));
    if (tag === "CommandList") return this.element("x-command-list", attrs(node));
    if (tag === "StateLabel") return this.renderStateLabel();

    return this.renderUnknown(node);
  }

  renderNavbar(node) {
    const nav = document.createElement("nav");
    const placement = node.getAttribute("placement") || "top";
    const color = node.getAttribute("color") || "dark";

    nav.className = [
      "navbar",
      `navbar-${color}`,
      "bg-body-tertiary",
      "border-secondary-subtle",
      placement === "bottom" ? "fixed-bottom border-top" : "sticky-top border-bottom"
    ].join(" ");

    const box = document.createElement("div");
    box.className = "container-fluid gap-2";

    const brand = document.createElement("span");
    brand.className = "navbar-brand mb-0 h1";
    brand.textContent = node.getAttribute("title") || "AI Unix";

    const actions = document.createElement("div");
    actions.className = "d-flex align-items-center gap-2 ms-auto";

    for (const child of [...node.children]) actions.append(this.renderScreenNode(child));

    box.append(brand, actions);
    nav.append(box);
    return nav;
  }

  renderMain(node) {
    const main = document.createElement("main");
    main.className = node.getAttribute("class") || "container py-3";
    for (const child of [...node.children]) main.append(this.renderScreenNode(child));
    return main;
  }

  renderPanelReference(node) {
    const name = node.getAttribute("use") || node.getAttribute("name");
    const source = this.xml.querySelector(`Interfaces > Panel[name="${cssEscape(name)}"]`);
    const panel = document.createElement("x-panel");

    if (!source) {
      panel.append(this.muted(`Missing interface panel: ${name}`));
      return panel;
    }

    for (const child of [...source.children]) panel.append(this.renderScreenNode(child));
    return panel;
  }

  renderOffcanvas(node) {
    const placement = node.getAttribute("placement") || "end";
    const id = node.getAttribute("id") || "offcanvas";

    const box = document.createElement("div");
    box.className = `offcanvas offcanvas-${placement}`;
    box.tabIndex = -1;
    box.id = id;

    const header = document.createElement("div");
    header.className = "offcanvas-header";

    const title = document.createElement("h5");
    title.className = "offcanvas-title";
    title.textContent = node.getAttribute("title") || "Offcanvas";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn-close";
    close.dataset.bsDismiss = "offcanvas";
    close.ariaLabel = "Close";

    const body = document.createElement("div");
    body.className = "offcanvas-body";

    for (const child of [...node.children]) body.append(this.renderScreenNode(child));

    header.append(title, close);
    box.append(header, body);
    return box;
  }

  renderModal(node) {
    const id = node.getAttribute("id") || "modal";
    const size = node.getAttribute("size") || "lg";

    const box = document.createElement("div");
    box.className = "modal fade";
    box.tabIndex = -1;
    box.id = id;

    const dialog = document.createElement("div");
    dialog.className = size === "fullscreen" ? "modal-dialog modal-fullscreen" : `modal-dialog modal-${size}`;

    const content = document.createElement("div");
    content.className = "modal-content";

    const header = document.createElement("div");
    header.className = "modal-header";

    const title = document.createElement("h5");
    title.className = "modal-title";
    title.textContent = node.getAttribute("title") || "Modal";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn-close";
    close.dataset.bsDismiss = "modal";
    close.ariaLabel = "Close";

    const body = document.createElement("div");
    body.className = "modal-body";

    for (const child of [...node.children]) body.append(this.renderScreenNode(child));

    header.append(title, close);
    content.append(header, body);
    dialog.append(content);
    box.append(dialog);
    return box;
  }

  renderButton(node) {
    const button = document.createElement("x-button");
    const data = attrs(node);

    for (const [name, value] of Object.entries(data)) {
      button.setAttribute(name, value);
    }

    if (node.hasAttribute("to")) {
      this.concern.on(button, "click", () => this.goto(node.getAttribute("to")));
    }

    return button;
  }

  renderStateLabel() {
    const node = document.createElement("span");
    node.className = "badge text-bg-secondary font-monospace";
    node.dataset.stateLabel = "";
    node.textContent = this.signal("statePath").value || "";
    return node;
  }

  renderUnknown(node) {
    const box = document.createElement("div");
    box.className = "alert alert-warning";
    box.textContent = `Unknown Screen node: ${node.tagName}`;
    return box;
  }

  element(tag, attributes = {}) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  }

  muted(text) {
    const node = document.createElement("div");
    node.className = "text-body-secondary small";
    node.textContent = text;
    return node;
  }

  async enterInitialState() {
    const root = this.xml.querySelector("Application > State");
    const initial = root?.getAttribute("initial");
    const path = `/application/${initial}`;

    this.signal("statePath").value = path;
    await this.runStateEvent(path, "enter");
  }

  async goto(target) {
    const previous = this.signal("statePath").value;
    const next = this.resolveStatePath(previous, this.resolveValue(target, new Map()));

    if (previous === next) return;

    const previousNodes = this.stateNodes(previous);
    const nextNodes = this.stateNodes(next);
    let shared = 0;

    while (previousNodes[shared] && previousNodes[shared] === nextNodes[shared]) shared++;

    for (let i = previousNodes.length - 1; i >= shared; i--) {
      await this.runWorkflowChildren(previousNodes[i], "exit");
    }

    this.signal("statePath").value = next;

    for (let i = shared; i < nextNodes.length; i++) {
      await this.runWorkflowChildren(nextNodes[i], "enter");
    }

    if (nextNodes.length < previousNodes.length && shared > 0) {
      await this.runWorkflowChildren(nextNodes[nextNodes.length - 1], "resume");
    }
  }

  stateNodes(path) {
    const names = path.split("/").filter(Boolean);
    const nodes = [];
    let current = this.xml.querySelector(`Application > State[name="${cssEscape(names[0])}"]`);

    if (!current) return nodes;
    nodes.push(current);

    for (const name of names.slice(1)) {
      current = [...current.children].find(child => child.tagName === "State" && child.getAttribute("name") === name);
      if (!current) break;
      nodes.push(current);
    }

    return nodes;
  }

  resolveStatePath(currentPath, target) {
    if (target.startsWith("/")) return target;

    const parts = currentPath.split("/").filter(Boolean);

    if (target === "..") {
      parts.pop();
      return `/${parts.join("/")}`;
    }

    return `/${[...parts, target].join("/")}`;
  }

  async runStateEvent(path, eventName) {
    const node = this.stateNodes(path).at(-1);
    if (node) await this.runWorkflowChildren(node, eventName);
  }

  async runWorkflowChildren(stateNode, eventName) {
    for (const workflow of [...stateNode.children].filter(child => child.tagName === "Workflow" && child.getAttribute("on") === eventName)) {
      if (workflow.hasAttribute("use")) {
        await this.runWorkflowByName(workflow.getAttribute("use"));
      } else {
        await this.runWorkflow(workflow);
      }
    }
  }

  async runWorkflowByName(name) {
    const workflow = this.xml.querySelector(`Workflows > Workflow[name="${cssEscape(name)}"]`);
    if (!workflow) throw new Error(`Missing workflow: ${name}`);
    await this.runWorkflow(workflow);
  }

  async runWorkflow(workflow) {
    const variables = new Map();

    for (const variable of workflow.querySelectorAll(":scope > Variables > Variable")) {
      variables.set(variable.getAttribute("name"), variable.getAttribute("value") || "");
    }

    for (const action of [...workflow.children].filter(child => child.tagName === "Action")) {
      await this.runAction(action, variables);
    }
  }

  async runAction(action, variables) {
    const use = action.getAttribute("use");
    const input = attrs(action);
    delete input.use;

    for (const [name, value] of Object.entries(input)) {
      input[name] = this.resolveValue(value, variables);
    }

    const mod = this.commandModules.get(use);
    if (mod) {
      await mod.main(input, this.buildContext());
      return;
    }

    const node = document.createElement("x-alert");
    node.setAttribute("text", `Unknown command: ${use}`);
    node.setAttribute("color", "warning");
    this.chat?.print(node);
  }

  resolveValue(value, variables) {
    if (!value?.startsWith?.("$")) return value;
    const key = value.slice(1);
    return variables.get(key) ?? value;
  }
}

export function registerXOS() {
  if (!customElements.get("x-os")) customElements.define("x-os", XOS);
}
