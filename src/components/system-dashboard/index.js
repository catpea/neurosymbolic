import { ReactiveHTMLElement } from "@/core/reactive.js";
import {
  makeCommandAI,
  makeCommandCategoryAI,
  makeCommandCorpusAI,
  makeCommandOutputAI,
  makeCommandParameterAI,
  makeComponentAI,
  makeComponentCollectionAI,
  makeInterfaceAI,
  makeInterfaceCollectionAI,
  makeMountAI,
  makeMountCollectionAI,
  makeResourceCollectionAI,
  makeScreenCollectionAI,
  makeScreenNodeAI,
  makeScreenResourceAI,
  makeStateCollectionAI,
  makeStateHookAI,
  makeStateNodeAI,
  makeStateResourceAI,
  makeWorkflowAI,
  makeWorkflowActionAI,
  makeWorkflowCorpusAI,
  makeWorkflowVariableAI,
} from "@/core/dashboard-actions.js";

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function badge(text, tone = "secondary", monospace = false) {
  return el("span", `badge text-bg-${tone}${monospace ? " font-monospace" : ""}`, text);
}

function leafPath(path = "") {
  const parts = String(path).split("/").filter(Boolean);
  return parts.at(-1) || "/";
}

function screenNodeDetails(attributes = {}) {
  return Object.entries(attributes)
    .map(([name, value]) => `${name}=${value}`)
    .join(" ");
}

function nodePathSegment(tag, attributes = {}) {
  if (attributes.name) return `${tag}[name="${attributes.name}"]`;
  if (attributes.id) return `${tag}#${attributes.id}`;
  if (attributes.use) return `${tag}[use="${attributes.use}"]`;
  if (attributes.to) return `${tag}[to="${attributes.to}"]`;
  return tag;
}

function cloneAI(base, title, summary, extraContext = []) {
  if (!base) return null;
  return {
    ...base,
    title,
    summary,
    context: [...extraContext, ...(base.context || [])],
  };
}

function statCard({ icon, label, value, tone = "secondary", detail = "" }) {
  const col = el("div", "col-12 col-sm-6 col-xl-3");
  const card = el("div", "card h-100 shadow-sm border-secondary-subtle");
  const body = el("div", "card-body");

  const top = el("div", "d-flex align-items-start justify-content-between gap-3");
  const copy = el("div", "flex-grow-1");
  copy.append(
    el("div", "small text-uppercase text-body-secondary fw-semibold", label),
    el("div", "display-6 fw-semibold lh-1 mt-2", value)
  );

  const chip = el("div", `rounded-circle d-inline-flex align-items-center justify-content-center text-bg-${tone}`);
  chip.style.width = "2.75rem";
  chip.style.height = "2.75rem";
  chip.append(el("i", `bi ${icon}`));

  top.append(copy, chip);
  body.append(top);

  if (detail) {
    body.append(el("div", "small text-body-secondary mt-3", detail));
  }

  card.append(body);
  col.append(card);
  return col;
}

function detailList(items) {
  const list = el("dl", "row mb-0 gy-2");

  for (const { label, value, monospace = false } of items) {
    const dt = el("dt", "col-sm-4 small text-uppercase text-body-secondary mb-0", label);
    const dd = el("dd", `col-sm-8 mb-0${monospace ? " font-monospace" : ""}`, value || "—");
    list.append(dt, dd);
  }

  return list;
}

function sectionCard({ title, icon, subtitle = "" }, body) {
  const card = el("div", "card h-100 shadow-sm border-secondary-subtle");
  const header = el("div", "card-header bg-body-tertiary border-secondary-subtle");
  const titleRow = el("div", "d-flex align-items-center gap-2 flex-wrap");
  titleRow.append(el("i", `bi ${icon} text-info`), el("span", "fw-semibold", title));
  header.append(titleRow);

  if (subtitle) {
    header.append(el("div", "small text-body-secondary mt-1", subtitle));
  }

  const content = el("div", "card-body");
  content.append(body);
  card.append(header, content);
  return card;
}

function treeCard({ title, icon, subtitle = "" }, nodes) {
  const tree = document.createElement("x-tree-ui");
  tree.tree = nodes;
  return sectionCard({ title, icon, subtitle }, tree);
}

function interfaceChildAI(panelName, tag, path, detail) {
  return cloneAI(
    makeInterfaceAI({ name: panelName, tag }),
    `Interface Node \`${tag}\` in \`${panelName}\``,
    "A child node inside a reusable interface panel.",
    [
      `Panel name: \`${panelName}\`.`,
      `Panel node path: \`${path}\`.`,
      detail ? `Current attributes: ${detail}.` : "This panel node has no explicit attributes.",
    ]
  );
}

function screenTreeNode(node, currentState, path = "Application > Screen", depth = 0, resourceName = null) {
  if (!node) return null;

  const attributes = node.attributes || {};
  const detail = screenNodeDetails(attributes);
  const nextResource = resourceName || (
    path === "Application > Screen > Main"
      && node.tag === "Group"
      && attributes.name
      ? attributes.name
      : null
  );
  const nodePath = path;
  const children = (node.children || [])
    .map(child => screenTreeNode(
      child,
      currentState,
      `${nodePath} > ${nodePathSegment(child.tag, child.attributes)}`,
      depth + 1,
      nextResource
    ))
    .filter(Boolean);

  return {
    label: node.tag,
    icon: depth === 0 ? "bi-display" : "bi-box",
    tone: depth === 0 ? "info" : "secondary",
    detail,
    badges: Object.keys(attributes).length
      ? [{ text: `${Object.keys(attributes).length} attrs`, tone: "secondary" }]
      : [],
    open: depth < 2,
    ai: depth === 0
      ? makeScreenCollectionAI(currentState)
      : makeScreenNodeAI({
          tag: node.tag,
          label: node.tag,
          path: nodePath,
          detail,
          resourceName: nextResource,
          attributes,
        }),
    children,
  };
}

function stateTreeNode(node, currentState, path = "", mountedResource = null) {
  if (!node) return null;

  const nextPath = path ? `${path}/${node.name}` : `/${node.name}`;
  const nextResource = mountedResource || (path === "/application/shell" ? node.name : null);
  const active = currentState === nextPath;
  const onPath = currentState.startsWith(`${nextPath}/`) || active;
  const hooks = (node.workflows || []).map(workflow => ({
    label: `${workflow.on || "event"} → ${workflow.use || "workflow"}`,
    icon: "bi-lightning-charge",
    tone: "info",
    detail: Object.entries(workflow).map(([name, value]) => `${name}=${value}`).join(" "),
    ai: makeStateHookAI({
      path: nextPath,
      resourceName: nextResource,
      on: workflow.on,
      use: workflow.use,
    }),
  }));

  return {
    label: node.title || node.name || "state",
    icon: active ? "bi-record-circle" : "bi-signpost-split",
    tone: active ? "warning" : "secondary",
    detail: nextPath,
    badges: [
      { text: node.name || "state", tone: active ? "warning" : "secondary", monospace: true },
      ...(node.workflows?.length ? [{ text: `${node.workflows.length} workflows`, tone: "info" }] : []),
    ],
    open: onPath || nextPath === "/application",
    ai: nextPath === "/application"
      ? makeStateCollectionAI(node.name, currentState)
      : makeStateNodeAI({
          label: node.title || node.name,
          name: node.name,
          title: node.title,
          path: nextPath,
          resourceName: nextResource,
          workflows: node.workflows || [],
          childCount: node.children?.length || 0,
          isRootShell: nextPath === "/application/shell",
        }),
    children: [
      ...hooks,
      ...(node.children || []).map(child => stateTreeNode(child, currentState, nextPath, nextResource)).filter(Boolean),
    ],
  };
}

function componentNodes(components = []) {
  return [{
    label: "Web Components",
    icon: "bi-puzzle-fill",
    tone: "secondary",
    detail: `${components.length} registered`,
    badges: [{ text: `${components.length} total`, tone: "secondary" }],
    open: true,
    ai: makeComponentCollectionAI(components),
    children: components.map(component => ({
      label: component.tag || component.name || "component",
      icon: "bi-puzzle",
      tone: "secondary",
      detail: component.name || "",
      badges: component.tag ? [{ text: component.tag, tone: "dark", monospace: true }] : [],
      ai: makeComponentAI(component),
    })),
  }];
}

function mountNodes(mounts = []) {
  return [{
    label: "Mounted Roots",
    icon: "bi-diagram-2",
    tone: "primary",
    detail: `${mounts.length} mounted roots`,
    badges: [{ text: `${mounts.length} total`, tone: "primary" }],
    open: true,
    ai: makeMountCollectionAI(mounts),
    children: mounts.map(mount => ({
      label: mount.src || "mount",
      icon: "bi-diagram-2",
      tone: "primary",
      detail: mount.into || "",
      badges: mount.into ? [{ text: "mounted", tone: "primary" }] : [],
      ai: makeMountAI(mount),
    })),
  }];
}

function workflowNodes(workflows = []) {
  return [{
    label: "Workflow Corpus",
    icon: "bi-diagram-3-fill",
    tone: "success",
    detail: `${workflows.length} mounted workflows`,
    badges: [{ text: `${workflows.length} total`, tone: "success" }],
    open: true,
    ai: makeWorkflowCorpusAI(workflows),
    children: workflows.map(workflow => ({
      label: workflow.title || workflow.name || "workflow",
      icon: "bi-diagram-3",
      tone: "success",
      detail: workflow.name || "",
      badges: [
        workflow.category ? { text: workflow.category, tone: "success" } : null,
        workflow.actions?.length ? { text: `${workflow.actions.length} actions`, tone: "secondary" } : null,
      ].filter(Boolean),
      open: false,
      ai: makeWorkflowAI(workflow),
      children: [
        ...(workflow.variables?.length ? [{
          label: "Variables",
          icon: "bi-input-cursor-text",
          tone: "secondary",
          detail: `${workflow.variables.length} variables`,
          ai: cloneAI(
            makeWorkflowAI(workflow),
            `Variables in \`${workflow.name}\``,
            "The workflow variables that parameterize this one-off program.",
            [`Workflow: \`${workflow.name}\`.`]
          ),
          children: workflow.variables.map(variable => ({
            label: variable.name || "variable",
            detail: Object.entries(variable).map(([name, value]) => `${name}=${value}`).join(" "),
            badges: variable.type ? [{ text: variable.type, tone: "dark", monospace: true }] : [],
            ai: makeWorkflowVariableAI(workflow, variable),
          })),
        }] : []),
        ...workflow.actions.map((actionNode, index) => ({
          label: actionNode.use || "action",
          icon: "bi-lightning-charge",
          tone: "warning",
          detail: Object.entries(actionNode).map(([name, value]) => `${name}=${value}`).join(" "),
          ai: makeWorkflowActionAI(workflow, actionNode, index),
        })),
      ],
    })),
  }];
}

function commandNodes(commands = []) {
  const groups = new Map();

  for (const command of commands) {
    const category = command.category || "uncategorized";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(command);
  }

  return [{
    label: "Command System",
    icon: "bi-terminal-split",
    tone: "info",
    detail: `${commands.length} registered commands`,
    badges: [{ text: `${commands.length} total`, tone: "info" }],
    open: true,
    ai: makeCommandCorpusAI(commands),
    children: [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => ({
        label: category,
        icon: "bi-collection",
        tone: "primary",
        badges: [{ text: `${items.length} commands`, tone: "primary" }],
        open: false,
        ai: makeCommandCategoryAI(category, items),
        children: items
          .sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name))
          .map(command => ({
            label: command.title || command.name || "command",
            icon: "bi-terminal",
            tone: "secondary",
            detail: command.path || "",
            badges: [
              command.name ? { text: command.name, tone: "dark", monospace: true } : null,
              command.parameters?.length ? { text: `${command.parameters.length} params`, tone: "info" } : null,
              command.outputs?.length ? { text: `${command.outputs.length} outputs`, tone: "success" } : null,
            ].filter(Boolean),
            ai: makeCommandAI(command),
            children: [
              ...(command.description ? [{
                label: "Description",
                icon: "bi-card-text",
                tone: "secondary",
                detail: command.description,
                ai: cloneAI(
                  makeCommandAI(command),
                  `Description of \`${command.name}\``,
                  "The documentation sentence that frames this command.",
                  [`Command description: ${command.description}.`]
                ),
              }] : []),
              ...(command.parameters?.length ? [{
                label: "Parameters",
                icon: "bi-sliders",
                tone: "info",
                detail: `${command.parameters.length} parameters`,
                ai: cloneAI(
                  makeCommandAI(command),
                  `Parameters of \`${command.name}\``,
                  "The parameter contract of this command.",
                  [`Command path: \`${command.path}\`.`]
                ),
                children: command.parameters.map(parameter => ({
                  label: parameter.name || "parameter",
                  detail: Object.entries(parameter).map(([name, value]) => `${name}=${value}`).join(" "),
                  badges: parameter.type ? [{ text: parameter.type, tone: "dark", monospace: true }] : [],
                  ai: makeCommandParameterAI(command, parameter),
                })),
              }] : []),
              ...(command.outputs?.length ? [{
                label: "Outputs",
                icon: "bi-box-arrow-up-right",
                tone: "success",
                detail: `${command.outputs.length} outputs`,
                ai: cloneAI(
                  makeCommandAI(command),
                  `Outputs of \`${command.name}\``,
                  "The declared output contract of this command.",
                  [`Command path: \`${command.path}\`.`]
                ),
                children: command.outputs.map(output => ({
                  label: output.name || output.type || "output",
                  detail: Object.entries(output).map(([name, value]) => `${name}=${value}`).join(" "),
                  badges: output.type ? [{ text: output.type, tone: "dark", monospace: true }] : [],
                  ai: makeCommandOutputAI(command, output),
                })),
              }] : []),
            ],
          })),
      })),
  }];
}

function interfaceNodes(resources = []) {
  return [{
    label: "Interface Panels",
    icon: "bi-layout-sidebar-inset",
    tone: "danger",
    detail: `${resources.length} reusable panels`,
    badges: [{ text: `${resources.length} total`, tone: "danger" }],
    open: true,
    ai: makeInterfaceCollectionAI(resources),
    children: resources.map(resource => {
      const baseAI = makeInterfaceAI(resource);
      const rootPath = `Interfaces > ${nodePathSegment(resource.tag, { name: resource.name })}`;

      function walk(child, path = rootPath, depth = 0) {
        const detail = screenNodeDetails(child.attributes || {});
        const childPath = `${path} > ${nodePathSegment(child.tag, child.attributes)}`;
        return {
          label: child.tag,
          icon: depth < 1 ? "bi-layout-sidebar-inset" : "bi-box",
          tone: depth < 1 ? "danger" : "secondary",
          detail,
          badges: Object.keys(child.attributes || {}).length
            ? [{ text: `${Object.keys(child.attributes || {}).length} attrs`, tone: "secondary" }]
            : [],
          ai: interfaceChildAI(resource.name || resource.tag || "panel", child.tag, childPath, detail),
          children: (child.children || []).map(grandchild => walk(grandchild, childPath, depth + 1)),
        };
      }

      return {
        label: resource.name || resource.tag || "interface",
        icon: "bi-layout-sidebar-inset",
        tone: "danger",
        detail: resource.tag || "",
        badges: resource.tag ? [{ text: resource.tag, tone: "danger" }] : [],
        open: false,
        ai: baseAI,
        children: (resource.tree?.children || []).map(child => walk(child)).filter(Boolean),
      };
    }),
  }];
}

function resourceNodes(snapshot) {
  return [
    {
      label: "Screen Resources",
      icon: "bi-display",
      tone: "info",
      badges: [{ text: `${snapshot.screen.resources.length} mounted`, tone: "info" }],
      open: true,
      ai: makeResourceCollectionAI("screen", snapshot.screen.resources),
      children: snapshot.screen.resources.map(resource => ({
        label: resource.name || resource.tag || "screen",
        icon: "bi-file-earmark-code",
        tone: "secondary",
        detail: resource.tag || "",
        badges: resource.tag ? [{ text: resource.tag, tone: "dark", monospace: true }] : [],
        ai: makeScreenResourceAI(resource),
      })),
    },
    {
      label: "State Resources",
      icon: "bi-signpost-2",
      tone: "warning",
      badges: [{ text: `${snapshot.state.resources.length} mounted`, tone: "warning" }],
      open: true,
      ai: makeResourceCollectionAI("state", snapshot.state.resources),
      children: snapshot.state.resources.map(resource => ({
        label: resource.title || resource.name || "state",
        icon: "bi-file-earmark-code",
        tone: "secondary",
        detail: resource.name || "",
        badges: resource.name ? [{ text: resource.name, tone: "dark", monospace: true }] : [],
        ai: makeStateResourceAI(resource),
      })),
    },
  ];
}

export class SystemDashboardElement extends ReactiveHTMLElement {
  constructor() {
    super();
    this.refresh = this.refresh.bind(this);
    this.contentNode = null;
    this.actionCenter = null;
  }

  mount() {
    this.className = "container-fluid py-3 py-lg-4";
    this.contentNode = el("div", "vstack gap-4");
    this.actionCenter = document.createElement("x-node-action-center");
    this.append(this.contentNode, this.actionCenter);

    const modal = this.closest(".modal");
    if (modal) {
      this.concern.on(modal, "show.bs.modal", this.refresh);
    }

    this.concern.on(this, "tree-ui:node-ai", event => {
      event.stopPropagation();
      this.actionCenter?.openNode(event.detail?.node);
    });

    this.concern.on(document, "os:change", this.refresh);
    this.refresh();
  }

  os() {
    return document.querySelector("x-os");
  }

  refresh() {
    const os = this.os();
    const snapshot = os?.mcpSnapshot?.();

    if (!snapshot) {
      this.contentNode?.replaceChildren(el("div", "alert alert-warning mb-0", "The OS snapshot is not available yet."));
      return;
    }

    this.contentNode?.replaceChildren(this.build(snapshot));
  }

  build(snapshot) {
    const wrapper = el("div", "vstack gap-4");

    const hero = el("div", "card border-info-subtle shadow-sm overflow-hidden");
    const heroBody = el("div", "card-body p-4");
    heroBody.style.background = "linear-gradient(135deg, rgba(13,110,253,0.12), rgba(25,135,84,0.08) 55%, rgba(255,193,7,0.12))";

    const heroTop = el("div", "d-flex align-items-start justify-content-between gap-3 flex-wrap");
    const copy = el("div", "flex-grow-1");
    copy.append(
      el("div", "text-uppercase small fw-semibold text-body-secondary mb-2", "Live Operating System Snapshot"),
      el("h2", "h3 mb-2", "System Dashboard"),
      el("p", "mb-0 text-body-secondary", "Every tree node is now AI-addressable. Click a robot to open a context-sensitive drafting window, pick a specialized action, tweak the prompt, and continue in AI Chat.")
    );

    const pathChip = el("div", "d-flex align-items-center gap-2 flex-wrap");
    pathChip.append(
      badge(snapshot.application.name || "application", "primary"),
      badge(snapshot.application.version || "0.0.0", "secondary", true),
      badge(snapshot.proc.currentState || "/", "warning", true),
      badge("robot-enabled", "info")
    );

    heroTop.append(copy, pathChip);
    heroBody.append(heroTop);
    hero.append(heroBody);
    wrapper.append(hero);

    const stats = el("div", "row g-3");
    stats.append(
      statCard({
        icon: "bi-window-stack",
        label: "Application",
        value: snapshot.application.name || "application",
        tone: "primary",
        detail: `Version ${snapshot.application.version || "0.0.0"}`,
      }),
      statCard({
        icon: "bi-signpost-split",
        label: "Current State",
        value: leafPath(snapshot.proc.currentState),
        tone: "warning",
        detail: snapshot.proc.currentState || "/",
      }),
      statCard({
        icon: "bi-terminal",
        label: "Commands",
        value: String(snapshot.cmd.length),
        tone: "info",
      }),
      statCard({
        icon: "bi-diagram-3",
        label: "Workflows",
        value: String(snapshot.workflows.length),
        tone: "success",
      }),
      statCard({
        icon: "bi-puzzle",
        label: "Components",
        value: String(snapshot.components.length),
        tone: "secondary",
      }),
      statCard({
        icon: "bi-diagram-2",
        label: "Mounts",
        value: String(snapshot.mounts.length),
        tone: "danger",
      })
    );
    wrapper.append(stats);

    const topGrid = el("div", "row g-3");

    const runtimeCol = el("div", "col-12 col-xxl-4");
    runtimeCol.append(sectionCard({
      title: "Runtime Summary",
      icon: "bi-cpu",
      subtitle: "Process identity and mounted declarative roots.",
    }, detailList([
      { label: "Application", value: snapshot.application.name || "application" },
      { label: "Version", value: snapshot.application.version || "0.0.0", monospace: true },
      { label: "Current State", value: snapshot.proc.currentState || "/", monospace: true },
      { label: "Commands Root", value: "/cmd", monospace: true },
      { label: "Workflow Count", value: String(snapshot.workflows.length) },
      { label: "Screen Resources", value: String(snapshot.screen.resources.length) },
    ])));

    const registryCol = el("div", "col-12 col-xxl-4");
    registryCol.append(treeCard({
      title: "Mounted Roots",
      icon: "bi-diagram-2",
      subtitle: "HTTP-backed XML roots mapped into the live document.",
    }, mountNodes(snapshot.mounts)));

    const resourcesCol = el("div", "col-12 col-xxl-4");
    resourcesCol.append(treeCard({
      title: "Mounted Resources",
      icon: "bi-boxes",
      subtitle: "Live screen and state fragments currently attached to the shell.",
    }, resourceNodes(snapshot)));

    topGrid.append(runtimeCol, registryCol, resourcesCol);
    wrapper.append(topGrid);

    const lowerGrid = el("div", "row g-3");

    const stateCol = el("div", "col-12 col-xl-6");
    stateCol.append(treeCard({
      title: "State Machine",
      icon: "bi-signpost-2",
      subtitle: "Nested states plus enter, exit, and resume workflow hooks.",
    }, [stateTreeNode(snapshot.state.tree, snapshot.proc.currentState)].filter(Boolean)));

    const screenCol = el("div", "col-12 col-xl-6");
    screenCol.append(treeCard({
      title: "Screen Layout",
      icon: "bi-display",
      subtitle: "The live declarative screen tree driving the shell UI.",
    }, [screenTreeNode(snapshot.screen.tree, snapshot.proc.currentState)].filter(Boolean)));

    const commandsCol = el("div", "col-12 col-xl-6");
    commandsCol.append(treeCard({
      title: "Command System",
      icon: "bi-terminal-split",
      subtitle: "Commands grouped by category, with parameter and output contracts.",
    }, commandNodes(snapshot.cmd)));

    const workflowsCol = el("div", "col-12 col-xl-6");
    workflowsCol.append(treeCard({
      title: "Workflow Corpus",
      icon: "bi-diagram-3-fill",
      subtitle: "Mounted workflows, variables, and action programs.",
    }, workflowNodes(snapshot.workflows)));

    const interfacesCol = el("div", "col-12 col-xl-6");
    interfacesCol.append(treeCard({
      title: "Interface Panels",
      icon: "bi-layout-sidebar-inset",
      subtitle: "Reusable panel definitions available to the screen system.",
    }, interfaceNodes(snapshot.interfaces?.resources || [])));

    const componentsCol = el("div", "col-12 col-xl-6");
    componentsCol.append(treeCard({
      title: "Web Components",
      icon: "bi-puzzle-fill",
      subtitle: "Registered browser components exposed by the shell.",
    }, componentNodes(snapshot.components)));

    lowerGrid.append(stateCol, screenCol, commandsCol, workflowsCol, interfacesCol, componentsCol);
    wrapper.append(lowerGrid);

    return wrapper;
  }
}
