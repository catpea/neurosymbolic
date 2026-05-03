import { ReactiveHTMLElement } from "@/core/reactive.js";
import { loadSoulPrompt, loadWebMcpPrompt, loadAgentPrompt, loadSkillPrompt, AGENTS } from "@/core/prompts.js";
import { attrs, cssEscape } from "@/core/xml.js";
import { extractFunctions, sanitizeCommandXml, commandJsonToXml } from "@/core/command-utils.js";

const SCREEN_META = Symbol("screenMeta");

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
    this.rootClickHandler = event => this.handleRootClick(event);
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
      this.emitSystemChange("state", { currentState: path });
    });
  }

  emitSystemChange(type, detail = {}) {
    document.dispatchEvent(new CustomEvent("os:change", {
      detail: {
        type,
        ...detail,
        snapshot: this.mcpSnapshot(),
      },
    }));
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
    if (!this.root.dataset.osWired) {
      this.root.dataset.osWired = "true";
      this.root.addEventListener("click", this.rootClickHandler);
    }

    this.renderScreen();
    this.emitSystemChange("screen");
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
    const runtimeCommands = [...this.xml.querySelectorAll("Commands > Command")]
      .filter(node => node.querySelector(":scope > Function"))
      .map(node => node.getAttribute("name"))
      .filter(Boolean);

    await Promise.all(runtimeCommands.map(async name => {
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
      ai: {
        chat: (goal, options = {}) => this.aiChat(goal, [], options),
      },
      os: {
        syncResource: (type, name, xmlText) => this.syncResource(type, name, xmlText),
        snapshot:     () => this.mcpSnapshot(),
      },
      xml:       this.xml,
      commands:  () => this.commands(),
      workflows: () => this.workflows(),
      components: () => this.components(),
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

  components() {
    if (!this.xml) return [];
    return [...this.xml.querySelectorAll("Components > Component")].map(component => attrs(component));
  }

  mounts() {
    if (!this.xml) return [];
    return [...this.xml.querySelectorAll("Mounts > Mount")].map(mount => attrs(mount));
  }

  mountSelector(type) {
    return this.xml.querySelector(`Mounts > Mount[src="/xml/${type}"]`)?.getAttribute("into") || null;
  }

  mountTarget(type) {
    const selector = this.mountSelector(type);
    return selector ? this.xml.querySelector(selector) : null;
  }

  serializeNode(node) {
    return node ? new XMLSerializer().serializeToString(node) : "";
  }

  xmlNodeTree(node) {
    if (!node) return null;

    return {
      tag: node.tagName,
      attributes: attrs(node),
      children: [...node.children].map(child => this.xmlNodeTree(child)),
    };
  }

  screenResources() {
    const target = this.mountTarget("screen");
    if (!target) return [];

    return [...target.children].map(node => ({
      name: node.getAttribute("name") || "",
      tag: node.tagName,
      xml: this.serializeNode(node),
    }));
  }

  stateResources() {
    const target = this.mountTarget("state");
    if (!target) return [];

    return [...target.children].map(node => ({
      name: node.getAttribute("name") || "",
      title: node.getAttribute("title") || "",
      xml: this.serializeNode(node),
    }));
  }

  stateTree(node = this.xml?.querySelector("Application > State")) {
    if (!node) return null;

    return {
      name: node.getAttribute("name") || "",
      title: node.getAttribute("title") || "",
      workflows: [...node.children]
        .filter(child => child.tagName === "Workflow")
        .map(workflow => attrs(workflow)),
      children: [...node.children]
        .filter(child => child.tagName === "State")
        .map(child => this.stateTree(child)),
    };
  }

  screenTree(node = this.xml?.querySelector("Application > Screen")) {
    return this.xmlNodeTree(node);
  }

  interfaceResources() {
    const target = this.xml?.querySelector("Interfaces");
    if (!target) return [];

    return [...target.children].map(node => ({
      name: node.getAttribute("name") || "",
      tag: node.tagName,
      xml: this.serializeNode(node),
      tree: this.xmlNodeTree(node),
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
      mounts: this.mounts(),
      components: this.components(),
      interfaces: {
        xml: this.serializeNode(this.xml.querySelector("Interfaces")),
        resources: this.interfaceResources(),
      },
      screen: {
        xml: this.serializeNode(this.xml.querySelector("Application > Screen")),
        tree: this.screenTree(),
        resources: this.screenResources(),
      },
      state: {
        xml: this.serializeNode(this.xml.querySelector("Application > State")),
        tree: this.stateTree(),
        resources: this.stateResources(),
      },
      cmd: this.commands(),
      workflows: this.workflows()
    };
  }

  parseResourceElement(xmlText, label) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    const error = doc.querySelector("parsererror");
    if (error) throw new Error(`Invalid ${label}: ${error.textContent}`);
    return doc.documentElement;
  }

  upsertNamedNode(target, node, name) {
    const imported = this.xml.importNode(node, true);
    const existing = [...target.children].find(child => child.getAttribute?.("name") === name);

    if (existing) {
      existing.replaceWith(imported);
    } else {
      target.append(imported);
    }

    return imported;
  }

  async syncResource(type, name, xmlText) {
    if (!this.xml) return;

    const root = this.parseResourceElement(xmlText, `${type}/${name}`);

    if (type === "commands") {
      const target = this.xml.querySelector("Commands");
      if (!target) return;
      this.upsertNamedNode(target, root, name);
      await this.hydrateCommandFunctions();
      await this.loadCommandModules();
      this.refreshCommandLists();
      this.emitSystemChange("commands", { name });
      return;
    }

    if (type === "workflows") {
      const target = this.xml.querySelector("Workflows");
      if (!target) return;
      this.upsertNamedNode(target, root, name);
      this.emitSystemChange("workflows", { name });
      return;
    }

    if (type === "state" || type === "screen") {
      const target = this.mountTarget(type);
      if (!target) return;
      this.upsertNamedNode(target, root, name);
      if (type === "screen" && this.root) this.renderScreen();
      this.emitSystemChange(type, { name });
    }
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
          await this.syncResource("commands", name, cleanXml);
          calls.push({ use, name, status: "saved", message: `Command '${name}' saved (${method})` });

        } else if (use === "save-workflow" || use === "save-state" || use === "save-screen") {
          const type = {
            "save-workflow": "workflows",
            "save-state": "state",
            "save-screen": "screen",
          }[use];

          const res = await fetch(`/xml/${type}/${name}`, {
            method,
            headers: { "Content-Type": "application/xml" },
            body: block.body.trim()
          });
          if (!res.ok) {
            const detail = await res.text().catch(() => "");
            throw new Error(`HTTP ${res.status}${detail ? ": " + detail : ""}`);
          }
          await this.syncResource(type, name, block.body.trim());

          const noun = type === "workflows"
            ? "Workflow"
            : type === "state"
              ? "State resource"
              : "Screen resource";
          calls.push({ use, name, status: "saved", message: `${noun} '${name}' saved (${method}).` });
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

    this.reconcileScreenChildren(this.root, [...screen.children]);

    this.chat = this.root.querySelector('x-chat[name="main-chat"]') || this.root.querySelector("x-chat");
  }

  renderScreenNode(node) {
    const tag = node.tagName;
    let rendered;

    if (tag === "Navbar") rendered = this.renderNavbar(node);
    else if (tag === "Main") rendered = this.renderMain(node);
    else if (tag === "Group") rendered = this.renderGroup(node);
    else if (tag === "Panel") rendered = this.renderPanelReference(node);
    else if (tag === "Chat") rendered = this.element("x-chat", attrs(node));
    else if (tag === "Offcanvas") rendered = this.renderOffcanvas(node);
    else if (tag === "Modal") rendered = this.renderModal(node);
    else if (tag === "Button") rendered = this.renderButton(node);
    else if (tag === "AIChat") rendered = this.element("x-ai-chat", attrs(node));
    else if (tag === "CommandList") rendered = this.element("x-command-list", attrs(node));
    else if (tag === "SystemDashboard") rendered = this.element("x-system-dashboard", attrs(node));
    else if (tag === "StateLabel") rendered = this.renderStateLabel();
    else rendered = this.renderUnknown(node);

    return this.markScreenNode(rendered, node);
  }

  renderNavbar(node) {
    const nav = document.createElement("nav");
    this.patchNavbar(nav, node);
    return nav;
  }

  renderMain(node) {
    const main = document.createElement("main");
    main.className = node.getAttribute("class") || "container py-3";
    for (const child of [...node.children]) main.append(this.renderScreenNode(child));
    return main;
  }

  renderGroup(node) {
    const group = document.createElement("div");
    group.dataset.osGroup = node.getAttribute("name") || "";
    group.style.display = "contents";
    for (const child of [...node.children]) group.append(this.renderScreenNode(child));
    return group;
  }

  renderPanelReference(node) {
    const name = node.getAttribute("use") || node.getAttribute("name");
    const source = this.xml.querySelector(`Interfaces > Panel[name="${cssEscape(name)}"]`);
    const panel = document.createElement("x-panel");
    panel.dataset.panelUse = name || "";

    if (!source) {
      panel.append(this.muted(`Missing interface panel: ${name}`));
      return panel;
    }

    for (const child of [...source.children]) panel.append(this.renderScreenNode(child));
    return panel;
  }

  renderOffcanvas(node) {
    const box = document.createElement("div");
    this.patchOffcanvas(box, node);
    return box;
  }

  renderModal(node) {
    const box = document.createElement("div");
    this.patchModal(box, node);
    return box;
  }

  renderButton(node) {
    const button = document.createElement("x-button");
    const data = attrs(node);

    for (const [name, value] of Object.entries(data)) {
      button.setAttribute(name, value);
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

  handleRootClick(event) {
    const button = event.target?.closest?.("x-button[to]");
    if (!button || !this.root?.contains(button)) return;

    const to = button.getAttribute("to");
    if (!to) return;

    event.preventDefault();
    this.goto(to).catch(error => console.error("x-os navigation failed", error));
  }

  screenNodeKey(node) {
    const fields = {
      Navbar: ["id", "placement", "title"],
      Main: ["id", "name", "class"],
      Group: ["name"],
      Panel: ["use", "name"],
      Chat: ["name"],
      Offcanvas: ["id"],
      Modal: ["id"],
      Button: ["id", "to", "target", "toggle", "icon"],
      AIChat: ["id", "placeholder"],
      CommandList: ["id"],
      SystemDashboard: ["id"],
      StateLabel: ["id", "name"],
    }[node.tagName] ?? ["id", "name", "use"];

    const values = fields.map(field => node.getAttribute(field)).filter(Boolean);
    return `${node.tagName}:${values.join("|")}`;
  }

  markScreenNode(rendered, sourceNode) {
    if (rendered?.nodeType === Node.ELEMENT_NODE) {
      rendered[SCREEN_META] = {
        tag: sourceNode.tagName,
        key: this.screenNodeKey(sourceNode),
      };
    }
    return rendered;
  }

  matchesScreenNode(rendered, sourceNode) {
    if (!rendered || rendered.nodeType !== Node.ELEMENT_NODE) return false;
    const meta = rendered[SCREEN_META];
    return !!meta && meta.tag === sourceNode.tagName && meta.key === this.screenNodeKey(sourceNode);
  }

  syncElementAttributes(element, sourceNode, names) {
    for (const name of names) {
      const value = sourceNode.getAttribute(name);
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
  }

  classTokens(value = "") {
    return String(value).split(/\s+/).filter(Boolean);
  }

  findScreenSlotCandidate(parent, tagName, className = "") {
    const expectedTag = tagName.toUpperCase();
    const requiredClasses = this.classTokens(className);

    return [...parent.children].find(child => {
      if (child.dataset.osSlot) return false;
      if (child.tagName !== expectedTag) return false;
      return requiredClasses.every(token => child.classList.contains(token));
    }) || null;
  }

  ensureScreenSlot(parent, tagName, slotName, className = "") {
    let node = [...parent.children].find(child => child.dataset.osSlot === slotName)
      || this.findScreenSlotCandidate(parent, tagName, className);

    if (node && node.tagName !== tagName.toUpperCase()) {
      const replacement = document.createElement(tagName);
      replacement.dataset.osSlot = slotName;
      parent.insertBefore(replacement, node);
      node.remove();
      node = replacement;
    } else if (!node) {
      node = document.createElement(tagName);
      node.dataset.osSlot = slotName;
      parent.append(node);
    }

    node.dataset.osSlot = slotName;
    if (className) node.className = className;
    return node;
  }

  pruneScreenChildren(parent, keep) {
    const allowed = new Set(keep);
    for (const child of [...parent.children]) {
      if (!allowed.has(child)) child.remove();
    }
  }

  reconcileScreenChildren(parent, sourceChildren) {
    const desired = sourceChildren.filter(child => child.nodeType === Node.ELEMENT_NODE);
    let cursor = parent.firstElementChild;

    for (const sourceNode of desired) {
      let current = cursor;
      let created = false;

      if (!this.matchesScreenNode(current, sourceNode)) {
        current = this.renderScreenNode(sourceNode);
        parent.insertBefore(current, cursor);
        created = true;
      }

      if (!created) this.patchScreenNode(current, sourceNode);
      cursor = current.nextElementSibling;
    }

    while (cursor) {
      const next = cursor.nextElementSibling;
      cursor.remove();
      cursor = next;
    }
  }

  patchScreenNode(rendered, sourceNode) {
    this.markScreenNode(rendered, sourceNode);

    switch (sourceNode.tagName) {
      case "Navbar":
        this.patchNavbar(rendered, sourceNode);
        return;
      case "Main":
        this.patchMain(rendered, sourceNode);
        return;
      case "Group":
        this.patchGroup(rendered, sourceNode);
        return;
      case "Panel":
        this.patchPanel(rendered, sourceNode);
        return;
      case "Chat":
        this.patchChat(rendered, sourceNode);
        return;
      case "Offcanvas":
        this.patchOffcanvas(rendered, sourceNode);
        return;
      case "Modal":
        this.patchModal(rendered, sourceNode);
        return;
      case "Button":
        this.patchButton(rendered, sourceNode);
        return;
      case "AIChat":
        this.patchAIChat(rendered, sourceNode);
        return;
      case "CommandList":
        this.patchCommandList(rendered);
        return;
      case "SystemDashboard":
        this.patchSystemDashboard(rendered);
        return;
      case "StateLabel":
        this.patchStateLabel(rendered);
        return;
      default:
        rendered.className = "alert alert-warning";
        rendered.textContent = `Unknown Screen node: ${sourceNode.tagName}`;
    }
  }

  patchNavbar(nav, sourceNode) {
    const placement = sourceNode.getAttribute("placement") || "top";
    const color = sourceNode.getAttribute("color") || "dark";

    nav.className = [
      "navbar",
      `navbar-${color}`,
      "bg-body-tertiary",
      "border-secondary-subtle",
      placement === "bottom" ? "fixed-bottom border-top" : "sticky-top border-bottom"
    ].join(" ");

    const box = this.ensureScreenSlot(nav, "div", "box", "container-fluid gap-2");
    const brand = this.ensureScreenSlot(box, "span", "brand", "navbar-brand mb-0 h1");
    const actions = this.ensureScreenSlot(box, "div", "actions", "d-flex align-items-center gap-2 ms-auto");
    this.pruneScreenChildren(nav, [box]);
    this.pruneScreenChildren(box, [brand, actions]);

    brand.textContent = sourceNode.getAttribute("title") || "Neurosymbolic";
    this.reconcileScreenChildren(actions, [...sourceNode.children]);
  }

  patchMain(main, sourceNode) {
    main.className = sourceNode.getAttribute("class") || "container py-3";
    this.reconcileScreenChildren(main, [...sourceNode.children]);
  }

  patchGroup(group, sourceNode) {
    group.dataset.osGroup = sourceNode.getAttribute("name") || "";
    group.style.display = "contents";
    this.reconcileScreenChildren(group, [...sourceNode.children]);
  }

  patchPanel(panel, sourceNode) {
    const name = sourceNode.getAttribute("use") || sourceNode.getAttribute("name") || "";
    const source = this.xml.querySelector(`Interfaces > Panel[name="${cssEscape(name)}"]`);
    const body = panel.querySelector(".card-body");
    const target = body || panel;

    panel.dataset.panelUse = name;

    if (!source) {
      target.replaceChildren(this.muted(`Missing interface panel: ${name}`));
      return;
    }

    this.reconcileScreenChildren(target, [...source.children]);
  }

  patchChat(chat, sourceNode) {
    this.syncElementAttributes(chat, sourceNode, ["name"]);
  }

  patchOffcanvas(box, sourceNode) {
    const placement = sourceNode.getAttribute("placement") || "end";
    box.className = `offcanvas offcanvas-${placement}`;
    box.tabIndex = -1;
    box.id = sourceNode.getAttribute("id") || "offcanvas";

    const header = this.ensureScreenSlot(box, "div", "header", "offcanvas-header");
    const title = this.ensureScreenSlot(header, "h5", "title", "offcanvas-title");
    const close = this.ensureScreenSlot(header, "button", "close", "btn-close");
    const body = this.ensureScreenSlot(box, "div", "body", "offcanvas-body");
    this.pruneScreenChildren(box, [header, body]);
    this.pruneScreenChildren(header, [title, close]);
    close.type = "button";
    close.dataset.bsDismiss = "offcanvas";
    close.ariaLabel = "Close";
    title.textContent = sourceNode.getAttribute("title") || "Offcanvas";

    this.reconcileScreenChildren(body, [...sourceNode.children]);
  }

  patchModal(box, sourceNode) {
    const id = sourceNode.getAttribute("id") || "modal";
    const size = sourceNode.getAttribute("size") || "lg";

    box.className = "modal fade";
    box.tabIndex = -1;
    box.id = id;

    const dialog = this.ensureScreenSlot(box, "div", "dialog");
    dialog.className = size === "fullscreen" ? "modal-dialog modal-fullscreen" : `modal-dialog modal-${size}`;
    this.pruneScreenChildren(box, [dialog]);

    const content = this.ensureScreenSlot(dialog, "div", "content", "modal-content");
    this.pruneScreenChildren(dialog, [content]);
    const header = this.ensureScreenSlot(content, "div", "header", "modal-header");
    const title = this.ensureScreenSlot(header, "h5", "title", "modal-title");
    const close = this.ensureScreenSlot(header, "button", "close", "btn-close");
    const body = this.ensureScreenSlot(content, "div", "body", "modal-body");
    this.pruneScreenChildren(content, [header, body]);
    this.pruneScreenChildren(header, [title, close]);
    close.type = "button";
    close.dataset.bsDismiss = "modal";
    close.ariaLabel = "Close";
    title.textContent = sourceNode.getAttribute("title") || "Modal";

    this.reconcileScreenChildren(body, [...sourceNode.children]);
  }

  patchButton(button, sourceNode) {
    this.syncElementAttributes(button, sourceNode, ["text", "color", "to", "icon", "target", "toggle"]);
  }

  patchAIChat(chat, sourceNode) {
    this.syncElementAttributes(chat, sourceNode, ["placeholder"]);
  }

  patchCommandList(list) {
    if (typeof list.mount === "function") list.mount();
  }

  patchSystemDashboard(dashboard) {
    if (typeof dashboard.refresh === "function") dashboard.refresh();
  }

  patchStateLabel(node) {
    node.className = "badge text-bg-secondary font-monospace";
    node.dataset.stateLabel = "";
    node.textContent = this.signal("statePath").value || "";
  }

  refreshCommandLists() {
    if (!this.root) return;
    for (const node of this.root.querySelectorAll("x-command-list")) {
      if (typeof node.mount === "function") node.mount();
    }
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
