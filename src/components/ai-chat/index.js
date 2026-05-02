import { ReactiveHTMLElement } from "@/core/reactive.js";
import { AGENTS, SKILLS } from "@/core/prompts.js";
import { extractFunctions } from "@/core/command-utils.js";

const AGENT_COLORS = {
  sophia: "primary", alice: "info", betty: "success",
  cindy:  "warning", daisy: "danger", emma:  "secondary"
};

export class AIChatElement extends ReactiveHTMLElement {
  static observedAttributes = ["placeholder"];

  constructor() {
    super();
    this.signal("placeholder", "Describe a goal...");
    this.signal("goal", "");
    this.signal("agent", "");
    this.activeSkills = new Set();
    this.messages = [];
    this.messagesNode = null;
  }

  mount() {
    this.className = "vstack gap-3";

    const help = document.createElement("div");
    help.className = "alert alert-info small mb-0";
    help.textContent = "The AI receives a live OS snapshot on every request. Agents save commands and workflows via OsCall.";

    this.messagesNode = document.createElement("div");
    this.messagesNode.className = "vstack gap-2";

    const textarea = document.createElement("textarea");
    textarea.className = "form-control";
    textarea.rows = 6;

    // ── Agent selector ────────────────────────────────────────────────────
    const agentRow = document.createElement("div");
    agentRow.className = "d-flex align-items-center gap-2";

    const agentLabel = document.createElement("span");
    agentLabel.className = "small text-body-secondary";
    agentLabel.textContent = "Agent:";

    const agentSelect = document.createElement("select");
    agentSelect.className = "form-select form-select-sm w-auto";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "General";
    agentSelect.append(defaultOpt);
    for (const name of AGENTS) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name.charAt(0).toUpperCase() + name.slice(1);
      agentSelect.append(opt);
    }

    agentRow.append(agentLabel, agentSelect);

    // ── Skills checkboxes ─────────────────────────────────────────────────
    const skillsRow = document.createElement("div");
    skillsRow.className = "d-flex align-items-center gap-2 flex-wrap";

    const skillsLabel = document.createElement("span");
    skillsLabel.className = "small text-body-secondary";
    skillsLabel.textContent = "Skills:";

    const skillGroup = document.createElement("div");
    skillGroup.className = "d-flex flex-wrap gap-1";

    for (const skill of SKILLS) {
      const id = `skill-${skill}`;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "btn-check";
      input.id = id;
      input.autocomplete = "off";

      const label = document.createElement("label");
      label.className = "btn btn-sm btn-outline-secondary";
      label.htmlFor = id;
      label.textContent = skill;

      this.concern.on(input, "change", () => {
        if (input.checked) this.activeSkills.add(skill);
        else this.activeSkills.delete(skill);
      });

      skillGroup.append(input, label);
    }

    skillsRow.append(skillsLabel, skillGroup);

    // ── Action controls ───────────────────────────────────────────────────
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
    this.concern.bindValue("agent", agentSelect);

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

      const agent  = this.signal("agent").value || null;
      const skills = [...this.activeSkills];
      const history = this.messages.slice(-8);
      this.addMessage("user", goal);
      textarea.value = "";
      this.signal("goal").value = "";

      ask.disabled = true;
      const agentLabel = agent ? ` [${agent}]` : "";
      const skillsLabel = skills.length ? ` +${skills.join(",")}` : "";
      status.textContent = `Calling /api/ai${agentLabel}${skillsLabel}...`;

      try {
        const { reply, calls, plan } = await os.aiChat(goal, history, {
          agent,
          skills,
          onOsCall: (results) => {
            const saved  = results.filter(r => r.status === "saved");
            const errors = results.filter(r => r.status !== "saved" && r.status !== "parse-error");
            if (saved.length || errors.length) {
              const summary = [...saved, ...errors].map(r => `${r.status === "saved" ? "✓" : "✗"} ${r.message}`).join("\n");
              this.addMessage("os", summary);
            }
          }
        });

        if (plan) this.renderPlanCard(plan);
        this.addMessage("assistant", reply);

        // Render retry cards for any parse errors after the main reply
        for (const call of calls.filter(c => c.status === "parse-error")) {
          this.renderParseErrorCard(call, agent, skills);
        }

        const savedCount = calls.filter(c => c.status === "saved").length;
        const errorCount = calls.filter(c => c.status !== "saved").length;
        status.textContent = savedCount || errorCount
          ? `Reply received. ${savedCount} saved, ${errorCount} failed.`
          : "Reply received.";
      } catch (error) {
        this.addMessage("system", `AI request failed: ${error.message}`);
        status.textContent = "Request failed.";
      } finally {
        ask.disabled = false;
      }
    });

    this.append(help, this.messagesNode, textarea, agentRow, skillsRow, controls, status);
  }

  os() {
    return document.querySelector("x-os");
  }

  renderPlanCard(plan) {
    const card = document.createElement("div");
    card.className = "card border-primary";

    const header = document.createElement("div");
    header.className = "card-header d-flex align-items-center gap-2 py-2";

    const icon = document.createElement("i");
    icon.className = "bi bi-list-check text-primary";

    const title = document.createElement("span");
    title.className = "fw-semibold small text-uppercase";
    title.textContent = "Plan";

    const subtitle = document.createElement("span");
    subtitle.className = "small text-body-secondary ms-1";
    subtitle.textContent = "— " + plan.title;

    header.append(icon, title, subtitle);

    const body = document.createElement("ul");
    body.className = "list-group list-group-flush";

    for (const step of plan.steps) {
      const item = document.createElement("li");
      item.className = "list-group-item d-flex align-items-start gap-2 py-2";

      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "form-check-input mt-1 flex-shrink-0";

      const num = document.createElement("span");
      num.className = "text-body-secondary small flex-shrink-0";
      num.textContent = step.id + ".";

      const content = document.createElement("div");
      content.className = "flex-grow-1 small";

      if (step.agent) {
        const badge = document.createElement("span");
        const color = AGENT_COLORS[step.agent] || "secondary";
        badge.className = `badge bg-${color} me-2`;
        badge.textContent = step.agent;
        content.append(badge);
      }

      content.append(document.createTextNode(step.text));
      item.append(check, num, content);
      body.append(item);
    }

    card.append(header, body);
    this.messagesNode.append(card);
    card.scrollIntoView({ block: "nearest" });
  }

  renderParseErrorCard(call, agent, skills) {
    const card = document.createElement("div");
    card.className = "card border-danger";

    const header = document.createElement("div");
    header.className = "card-header d-flex align-items-center gap-2 py-2 bg-danger-subtle";

    const icon = document.createElement("i");
    icon.className = "bi bi-exclamation-triangle-fill text-danger";

    const title = document.createElement("span");
    title.className = "fw-semibold small text-uppercase text-danger";
    title.textContent = `XML Parse Error — command '${call.name}'`;
    header.append(icon, title);

    const body = document.createElement("div");
    body.className = "card-body p-3 vstack gap-3";

    const errorText = document.createElement("pre");
    errorText.className = "mb-0 small text-danger font-monospace text-wrap";
    errorText.textContent = call.message;

    const hint = document.createElement("p");
    hint.className = "small mb-0 text-body-secondary";
    hint.textContent = "The AI produced JavaScript with characters that are invalid in XML (e.g. && or <). Choose an action:";

    const btnRow = document.createElement("div");
    btnRow.className = "d-flex gap-2 flex-wrap";

    const retryAI = document.createElement("button");
    retryAI.type = "button";
    retryAI.className = "btn btn-sm btn-warning";
    retryAI.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i>Retry with AI';

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-sm btn-outline-secondary";
    editBtn.innerHTML = '<i class="bi bi-pencil me-1"></i>Edit Manually';

    const abortBtn = document.createElement("button");
    abortBtn.type = "button";
    abortBtn.className = "btn btn-sm btn-outline-danger ms-auto";
    abortBtn.innerHTML = '<i class="bi bi-x me-1"></i>Abort';

    const retryStatus = document.createElement("span");
    retryStatus.className = "small text-body-secondary";

    btnRow.append(retryAI, editBtn, abortBtn);
    body.append(errorText, hint, btnRow, retryStatus);
    card.append(header, body);
    this.messagesNode.append(card);
    card.scrollIntoView({ block: "nearest" });

    // Abort: remove the card
    abortBtn.addEventListener("click", () => card.remove());

    // Edit Manually: replace card body with an editable textarea + save button
    editBtn.addEventListener("click", () => {
      const textarea = document.createElement("textarea");
      textarea.className = "form-control font-monospace small";
      textarea.style.minHeight = "240px";
      textarea.value = call.sanitizedBody || "";
      textarea.spellcheck = false;

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn btn-sm btn-primary";
      saveBtn.textContent = "Save Command";

      const saveStatus = document.createElement("span");
      saveStatus.className = "small text-body-secondary";

      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        saveStatus.textContent = "Saving…";
        try {
          const { xml: cleanXml, files } = extractFunctions(textarea.value, call.name);
          await Promise.all(files.map(({ url, content }) =>
            fetch(url, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: content })
          ));
          const res = await fetch(`/xml/commands/${call.name}`, {
            method: call.method || "POST",
            headers: { "Content-Type": "application/xml" },
            body: cleanXml
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          saveStatus.textContent = "Saved ✓";
          saveStatus.className = "small text-success";
          card.className = "card border-success";
          header.className = "card-header d-flex align-items-center gap-2 py-2 bg-success-subtle";
          title.textContent = `Saved — command '${call.name}'`;
          title.className = "fw-semibold small text-uppercase text-success";
          icon.className = "bi bi-check-circle-fill text-success";
        } catch (err) {
          saveStatus.textContent = err.message;
          saveStatus.className = "small text-danger";
        } finally {
          saveBtn.disabled = false;
        }
      });

      body.replaceChildren(textarea, document.createElement("div"));
      body.lastChild.className = "d-flex align-items-center gap-2";
      body.lastChild.append(saveBtn, saveStatus);
      card.scrollIntoView({ block: "nearest" });
    });

    // Retry with AI: send a targeted repair prompt
    retryAI.addEventListener("click", async () => {
      retryAI.disabled = true;
      editBtn.disabled = true;
      retryStatus.textContent = "Asking AI to repair…";

      const os = this.os();
      const repairGoal = [
        `The command '${call.name}' failed to save due to an XML parse error:`,
        call.message,
        "",
        "The <Function> block contains JavaScript with characters that are not valid in XML.",
        "Please regenerate the full Command XML using CDATA to wrap the function body:",
        "  <Function><![CDATA[",
        "    export async function main(params, context) { ... }",
        "  ]]></Function>",
        "",
        "Or use JSON format inside the OsCall block instead of XML.",
        `Emit a new <OsCall use="save-command" name="${call.name}" method="${call.method || "POST"}"> with the corrected XML.`
      ].join("\n");

      try {
        const { reply, calls: retryCalls, plan } = await os.aiChat(repairGoal, this.messages.slice(-6), { agent, skills });
        if (plan) this.renderPlanCard(plan);
        this.addMessage("assistant", reply);

        for (const rc of retryCalls.filter(c => c.status === "saved")) {
          retryStatus.textContent = `✓ ${rc.message}`;
          retryStatus.className = "small text-success";
          card.className = "card border-success";
        }
        for (const rc of retryCalls.filter(c => c.status === "parse-error")) {
          this.renderParseErrorCard(rc, agent, skills);
        }
        if (!retryCalls.length) {
          retryStatus.textContent = "AI responded but made no save calls.";
        }
      } catch (err) {
        retryStatus.textContent = `Retry failed: ${err.message}`;
        retryStatus.className = "small text-danger";
      } finally {
        retryAI.disabled = false;
        editBtn.disabled = false;
      }
    });
  }

  addMessage(role, content) {
    const message = { role, content: String(content ?? "") };
    this.messages.push(message);

    const card = document.createElement("div");

    const roleColors = {
      user:      "border-primary-subtle",
      assistant: "border-secondary-subtle",
      system:    "border-warning-subtle",
      os:        "border-success-subtle"
    };
    card.className = `card ${roleColors[role] || "border-secondary-subtle"}`;

    const body = document.createElement("div");
    body.className = "card-body p-3";

    const label = document.createElement("div");
    label.className = "small text-body-secondary mb-2 text-uppercase fw-semibold";
    label.textContent = role === "os" ? "OS" : role;

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
        command.parameters.length ? `Parameters: ${command.parameters.map(p => p.name || p.type).join(", ")}` : "Parameters: none",
        ""
      ].join("\n")),
      "## Workflows",
      "",
      ...snapshot.workflows.map(workflow => [
        `### ${workflow.name}`,
        `Category: ${workflow.category}`,
        `Actions: ${workflow.actions.map(a => a.use).join(" -> ") || "none"}`,
        ""
      ].join("\n"))
    ].join("\n");
  }
}
