import { ReactiveHTMLElement } from "@/core/reactive.js";

let TREE_SEQUENCE = 0;

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function normalizeBadge(value) {
  if (!value) return null;
  if (typeof value === "string") return { text: value, tone: "secondary" };
  return { text: value.text || "", tone: value.tone || "secondary", monospace: !!value.monospace };
}

export class TreeUIElement extends ReactiveHTMLElement {
  constructor() {
    super();
    this.nodes = [];
    this.baseId = `x-tree-${++TREE_SEQUENCE}`;
    this.renderPass = 0;
  }

  set tree(value) {
    this.nodes = asArray(value);
    if (this.isConnected) this.render();
  }

  get tree() {
    return this.nodes;
  }

  mount() {
    this.className = "vstack gap-2";
    this.render();
  }

  render() {
    this.renderPass = 0;
    this.replaceChildren();

    if (!this.nodes.length) {
      const empty = document.createElement("div");
      empty.className = "small text-body-secondary";
      empty.textContent = "Nothing to show.";
      this.append(empty);
      return;
    }

    this.append(this.renderList(this.nodes, 0));
  }

  renderList(nodes, depth) {
    const list = document.createElement("ul");
    list.className = depth === 0
      ? "list-unstyled mb-0 vstack gap-2"
      : "list-unstyled mb-0 ms-3 ps-3 border-start border-secondary-subtle vstack gap-2";

    for (const node of nodes) {
      list.append(this.renderNode(node, depth));
    }

    return list;
  }

  renderNode(node, depth) {
    const item = document.createElement("li");
    item.className = "mb-1";

    const children = asArray(node.children);
    const open = node.open ?? depth < 1;
    const aiButton = this.renderAIButton(node);

    if (!children.length) {
      item.append(this.renderLeaf(node, aiButton));
      return item;
    }

    const collapseId = `${this.baseId}-${++this.renderPass}`;
    const row = document.createElement("div");
    row.className = "d-flex align-items-stretch gap-2";
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "btn",
      "d-inline-flex",
      "align-items-start",
      "justify-content-between",
      "gap-3",
      "rounded",
      "border",
      "border-secondary-subtle",
      "flex-grow-1",
      "px-3",
      "py-2",
      "text-start",
      "bg-body-tertiary",
    ].join(" ");
    button.dataset.bsToggle = "collapse";
    button.dataset.bsTarget = `#${collapseId}`;
    button.setAttribute("aria-expanded", String(open));

    const label = this.renderLabel(node);
    const toggle = document.createElement("span");
    toggle.className = "small text-body-secondary flex-shrink-0";
    toggle.textContent = children.length === 1 ? "1 node" : `${children.length} nodes`;

    button.append(label, toggle);

    const body = document.createElement("div");
    body.className = open ? "collapse show mt-2" : "collapse mt-2";
    body.id = collapseId;
    body.append(this.renderList(children, depth + 1));

    row.append(button);
    if (aiButton) row.append(aiButton);

    item.append(row, body);
    return item;
  }

  renderLeaf(node, aiButton = null) {
    const wrapper = document.createElement("div");
    wrapper.className = "rounded border border-secondary-subtle px-3 py-2 bg-body-tertiary d-flex align-items-start gap-2";
    const label = this.renderLabel(node);
    label.classList.add("flex-grow-1");
    wrapper.append(label);
    if (aiButton) wrapper.append(aiButton);
    return wrapper;
  }

  renderAIButton(node) {
    if (!node?.ai?.actions?.length) return null;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-warning btn-sm flex-shrink-0 align-self-start";
    button.title = `AI actions for ${node.ai.title || node.label || "node"}`;
    button.innerHTML = `<i class="bi bi-robot"></i><span class="ms-2">${node.ai.actions.length}</span>`;

    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      this.dispatchEvent(new CustomEvent("tree-ui:node-ai", {
        bubbles: true,
        composed: true,
        detail: { node },
      }));
    });

    return button;
  }

  renderLabel(node) {
    const line = document.createElement("div");
    line.className = "d-flex align-items-start justify-content-between gap-3 flex-wrap";

    const text = document.createElement("div");
    text.className = "flex-grow-1";

    const labelRow = document.createElement("div");
    labelRow.className = "d-flex align-items-center flex-wrap gap-2";

    if (node.icon) {
      const icon = document.createElement("i");
      icon.className = `bi ${node.icon} text-${node.tone || "secondary"}`;
      labelRow.append(icon);
    }

    const title = document.createElement("span");
    title.className = "fw-semibold";
    title.textContent = node.label || "Node";
    labelRow.append(title);

    text.append(labelRow);

    if (node.detail) {
      const detail = document.createElement("div");
      detail.className = "small text-body-secondary font-monospace text-break mt-1";
      detail.textContent = node.detail;
      text.append(detail);
    }

    const badges = document.createElement("div");
    badges.className = "d-flex align-items-center gap-1 flex-wrap";

    for (const badgeValue of asArray(node.badges)) {
      const badgeData = normalizeBadge(badgeValue);
      if (!badgeData?.text) continue;

      const badge = document.createElement("span");
      badge.className = `badge text-bg-${badgeData.tone}${badgeData.monospace ? " font-monospace" : ""}`;
      badge.textContent = badgeData.text;
      badges.append(badge);
    }

    line.append(text);
    if (badges.childElementCount) line.append(badges);
    return line;
  }
}
