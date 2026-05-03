import { ReactiveHTMLElement } from "@/core/reactive.js";

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function badge(text, tone = "secondary", monospace = false) {
  return el("span", `badge text-bg-${tone}${monospace ? " font-monospace" : ""}`, text);
}

function asList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

export class NodeActionCenterElement extends ReactiveHTMLElement {
  constructor() {
    super();
    this.nodeData = null;
    this.selectedActionId = "";
    this.currentDraft = "";
  }

  mount() {
    this.className = "d-none position-fixed top-0 start-0 w-100 h-100 p-3 p-lg-4";
    this.style.zIndex = "2000";

    this.concern.on(document, "keydown", event => {
      if (event.key === "Escape" && this.nodeData) this.close();
    });

    this.render();
  }

  openNode(node) {
    if (!node?.ai?.actions?.length) return;
    this.nodeData = node;
    this.selectedActionId = node.ai.actions[0].id;
    this.currentDraft = node.ai.actions[0].prompt;
    this.render();
    this.classList.remove("d-none");
    this.syncAIChat(false, "Dashboard template loaded. Adjust it in the context window or open AI Chat.");
  }

  close() {
    this.nodeData = null;
    this.selectedActionId = "";
    this.currentDraft = "";
    this.classList.add("d-none");
    this.replaceChildren();
  }

  currentAction() {
    return this.nodeData?.ai?.actions?.find(action => action.id === this.selectedActionId)
      || this.nodeData?.ai?.actions?.[0]
      || null;
  }

  selectAction(id) {
    if (!this.nodeData?.ai?.actions?.length) return;
    this.selectedActionId = id;
    this.currentDraft = this.currentAction()?.prompt || "";
    this.render();
    this.classList.remove("d-none");
    this.syncAIChat(false, "Dashboard template switched. Adjust it, then open AI Chat when ready.");
  }

  syncAIChat(open = false, note = "Dashboard template synced.") {
    const action = this.currentAction();
    const chat = document.querySelector("x-ai-chat");
    if (!action || !chat) return;

    const payload = {
      goal: this.currentDraft,
      agent: action.agent,
      skills: action.skills,
      note,
    };

    if (open && typeof chat.openTemplate === "function") {
      chat.openTemplate(payload);
      this.close();
    } else if (typeof chat.applyTemplate === "function") {
      chat.applyTemplate(payload);
    }
  }

  render() {
    if (!this.nodeData?.ai) {
      this.replaceChildren();
      return;
    }

    const node = this.nodeData;
    const action = this.currentAction();
    const ai = node.ai;

    const backdrop = el("div", "position-absolute top-0 start-0 w-100 h-100 bg-dark bg-opacity-75");
    backdrop.addEventListener("click", () => this.close());

    const stage = el("div", "position-relative h-100 d-flex align-items-center justify-content-center");

    const card = el("div", "card shadow-lg border-secondary-subtle w-100 overflow-hidden");
    card.style.maxWidth = "1200px";
    card.style.maxHeight = "calc(100vh - 3rem)";

    const header = el("div", "card-header bg-body-tertiary border-secondary-subtle");
    const headerRow = el("div", "d-flex align-items-start justify-content-between gap-3 flex-wrap");
    const headerCopy = el("div", "flex-grow-1");
    headerCopy.append(
      el("div", "small text-uppercase text-body-secondary fw-semibold mb-2", "Context-Sensitive AI Drafting"),
      el("div", "h5 mb-1", ai.title || node.label || "Node"),
      el("div", "small text-body-secondary", ai.summary || "Choose an action template for this exact part of the operating system."),
    );

    const closeButton = el("button", "btn btn-outline-secondary btn-sm");
    closeButton.type = "button";
    closeButton.innerHTML = '<i class="bi bi-x-lg me-2"></i>Close';
    closeButton.addEventListener("click", () => this.close());
    headerRow.append(headerCopy, closeButton);
    header.append(headerRow);

    const body = el("div", "card-body p-0");
    const row = el("div", "row g-0");

    const menuCol = el("div", "col-12 col-xl-4 border-end border-secondary-subtle");
    const menuWrap = el("div", "p-3 p-lg-4 vstack gap-3");
    const menuTitle = el("div", "small text-uppercase text-body-secondary fw-semibold", "Actions");
    const menuHint = el("div", "small text-body-secondary", "Pick a precise operation. The template draft stays synced to the main AI chat.");
    const menuList = el("div", "vstack gap-2");

    for (const item of asList(ai.actions)) {
      const button = el(
        "button",
        [
          "btn",
          "text-start",
          "rounded-4",
          "border",
          "w-100",
          "px-3",
          "py-3",
          item.id === action?.id ? "btn-warning border-warning-subtle bg-warning-subtle" : "btn-outline-secondary",
        ].join(" ")
      );
      button.type = "button";

      const titleRow = el("div", "d-flex align-items-start justify-content-between gap-2");
      const label = el("div", "fw-semibold", item.title);
      const icon = el("i", `bi ${item.icon || "bi-robot"} text-${item.tone || "warning"}`);
      titleRow.append(label, icon);

      const desc = el("div", "small text-body-secondary mt-2", item.description || "");

      const badges = el("div", "d-flex align-items-center flex-wrap gap-1 mt-3");
      badges.append(badge(item.agent || "general", item.tone || "warning"));
      for (const skill of asList(item.skills)) badges.append(badge(skill, "secondary"));
      for (const effect of asList(item.effects)) {
        badges.append(badge(effect.label || String(effect), effect.tone || "dark"));
      }

      button.append(titleRow, desc, badges);
      button.addEventListener("click", () => this.selectAction(item.id));
      menuList.append(button);
    }

    const contextCard = el("div", "rounded-4 border border-secondary-subtle bg-body-tertiary p-3");
    contextCard.append(
      el("div", "small text-uppercase text-body-secondary fw-semibold mb-2", "Node Context"),
    );
    const contextList = el("div", "vstack gap-2");
    for (const line of asList(ai.context)) {
      const item = el("div", "small text-body-secondary", line);
      contextList.append(item);
    }
    contextCard.append(contextList);

    menuWrap.append(menuTitle, menuHint, menuList, contextCard);
    menuCol.append(menuWrap);

    const draftCol = el("div", "col-12 col-xl-8");
    const draftWrap = el("div", "p-3 p-lg-4 vstack gap-3");

    const draftHeader = el("div", "d-flex align-items-start justify-content-between gap-3 flex-wrap");
    const draftCopy = el("div", "flex-grow-1");
    draftCopy.append(
      el("div", "small text-uppercase text-body-secondary fw-semibold mb-2", "Draft"),
      el("div", "h5 mb-1", action?.title || "Action"),
      el("div", "small text-body-secondary", action?.description || "Choose an action to load a contextual AI draft."),
    );

    const draftMeta = el("div", "d-flex align-items-center gap-1 flex-wrap");
    if (action?.agent) draftMeta.append(badge(action.agent, action.tone || "warning"));
    for (const skill of asList(action?.skills)) draftMeta.append(badge(skill, "secondary"));
    for (const effect of asList(action?.effects)) {
      draftMeta.append(badge(effect.label || String(effect), effect.tone || "dark"));
    }

    draftHeader.append(draftCopy, draftMeta);

    const draftNote = el(
      "div",
      "alert alert-info small mb-0",
      "This textarea is the context-sensitive draft. Clicking an action rewrites it. Editing here keeps the main AI chat draft in sync."
    );

    const textarea = document.createElement("textarea");
    textarea.className = "form-control font-monospace small";
    textarea.rows = 18;
    textarea.spellcheck = false;
    textarea.value = this.currentDraft;
    textarea.addEventListener("input", () => {
      this.currentDraft = textarea.value;
      this.syncAIChat(false, "Dashboard draft updated. Open AI Chat when you are ready to continue.");
    });

    const footer = el("div", "d-flex align-items-center justify-content-between gap-2 flex-wrap");
    const footerHint = el("div", "small text-body-secondary");
    footerHint.textContent = "AI Chat will open with this draft, recommended agent, and skills already selected.";

    const buttonRow = el("div", "d-flex align-items-center gap-2 flex-wrap");
    const resetButton = el("button", "btn btn-outline-secondary");
    resetButton.type = "button";
    resetButton.innerHTML = '<i class="bi bi-arrow-counterclockwise me-2"></i>Reset Template';
    resetButton.addEventListener("click", () => {
      this.currentDraft = action?.prompt || "";
      this.render();
      this.classList.remove("d-none");
      this.syncAIChat(false, "Dashboard template reset. Adjust it, then open AI Chat.");
    });

    const openChat = el("button", "btn btn-warning");
    openChat.type = "button";
    openChat.innerHTML = '<i class="bi bi-stars me-2"></i>Open In AI Chat';
    openChat.addEventListener("click", () => this.syncAIChat(true, "Dashboard template loaded. Adjust it, then ask AI."));

    buttonRow.append(resetButton, openChat);
    footer.append(footerHint, buttonRow);

    draftWrap.append(draftHeader, draftNote, textarea, footer);
    draftCol.append(draftWrap);

    row.append(menuCol, draftCol);
    body.append(row);
    card.append(header, body);
    stage.append(card);

    this.replaceChildren(backdrop, stage);
  }
}
