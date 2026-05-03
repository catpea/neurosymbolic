const AGENT_SKILLS = {
  sophia: ["step-by-step", "explain-and-do"],
  alice: ["check-first", "minimal"],
  betty: ["check-first", "minimal"],
  cindy: ["check-first", "explain-and-do"],
  daisy: ["check-first", "minimal"],
  emma: ["check-first", "explain-and-do"],
};

const CARD_WORLD_NOTE = "Preserve the Neurosymbolic style: states define traversal, workflows perform the work, and the user experiences the system as a vertical stack of rich, reviewable cards.";

function asList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

function quote(value, fallback = "unknown") {
  return `\`${value || fallback}\``;
}

function write(label, tone = "secondary") {
  return { label, tone };
}

function titleCase(value = "") {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function prompt({
  lead,
  context = [],
  tasks = [],
  deliverables = [],
  writes = [],
  guardrails = [],
  placeholders = [],
}) {
  return [
    lead,
    "",
    "Context:",
    ...context.map(line => `- ${line}`),
    "",
    "Please do the following:",
    ...tasks.map((line, index) => `${index + 1}. ${line}`),
    deliverables.length ? "" : null,
    deliverables.length ? "Deliverables:" : null,
    ...deliverables.map(line => `- ${line}`),
    writes.length ? "" : null,
    writes.length ? "Persist or patch using:" : null,
    ...writes.map(line => `- ${line}`),
    guardrails.length ? "" : null,
    guardrails.length ? "Guardrails:" : null,
    ...guardrails.map(line => `- ${line}`),
    placeholders.length ? "" : null,
    placeholders.length ? "Fill or adjust these placeholders before sending if needed:" : null,
    ...placeholders.map(line => `- ${line}`),
  ].filter(Boolean).join("\n");
}

function action({
  id,
  title,
  description,
  agent,
  skills = AGENT_SKILLS[agent] || ["check-first", "minimal"],
  icon = "bi-robot",
  tone = "warning",
  effects = [],
  draft,
}) {
  return {
    id,
    title,
    description,
    agent,
    skills,
    icon,
    tone,
    effects,
    prompt: draft.trim(),
  };
}

function ai(title, summary, context, actions) {
  return {
    title,
    summary,
    context: asList(context),
    actions: asList(actions),
  };
}

function shellPersistenceLines(saveMethod, resourceName, patchTarget = "src/Application.xml") {
  if (saveMethod === "save-screen") {
    return [`Emit ${quote(saveMethod)} for mounted screen resource ${quote(resourceName)}.`];
  }
  if (saveMethod === "save-state") {
    return [`Emit ${quote(saveMethod)} for mounted state resource ${quote(resourceName)}.`, "Emit any matching workflow saves when lifecycle hooks point at new or changed workflows."];
  }
  if (saveMethod === "save-command") {
    return [`Emit ${quote(saveMethod)} for the command XML and include the full <Function> body.`];
  }
  if (saveMethod === "save-workflow") {
    return [`Emit ${quote(saveMethod)} for the workflow XML.`];
  }
  return [`Propose a reviewable patch for ${quote(patchTarget)} or the relevant JavaScript module.`];
}

function screenPersistence(resourceName) {
  return resourceName
    ? shellPersistenceLines("save-screen", resourceName)
    : shellPersistenceLines(null, null, "src/Application.xml");
}

function statePersistence(resourceName) {
  return resourceName
    ? shellPersistenceLines("save-state", resourceName)
    : [
      "Prefer creating or editing mounted child states under `/xml/state` instead of rewriting the root shell state in `Application.xml`.",
      "If the shell root itself must change, propose a precise `src/Application.xml` patch.",
    ];
}

function commandEffects() {
  return [write("save-command", "info"), write("Command XML", "dark")];
}

function workflowEffects() {
  return [write("save-workflow", "success"), write("Workflow XML", "dark")];
}

function stateEffects() {
  return [write("save-state", "warning"), write("save-workflow", "success")];
}

function screenEffects(resourceName) {
  return resourceName
    ? [write("save-screen", "info"), write(resourceName, "dark")]
    : [write("patch Application.xml", "danger")];
}

function componentPatchEffects() {
  return [write("JS patch", "danger"), write("README patch", "secondary")];
}

export function makeMountCollectionAI(mounts = []) {
  return ai(
    "Mounted Roots",
    "The HTTP-backed XML roots that are grafted into the live application document at boot.",
    [
      `Mounted roots: ${mounts.map(mount => quote(mount.src)).join(", ") || "none"}.`,
      "These mounts decide what can be persisted through browser-side OsCall saves.",
    ],
    [
      action({
        id: "mount-audit",
        title: "Audit mounted roots",
        description: "Ask which mount boundaries are strong, weak, or missing.",
        agent: "sophia",
        effects: [write("analysis", "primary"), write("Application.xml patch", "danger")],
        draft: prompt({
          lead: "Use Sophia to audit the mounted roots in Neurosymbolic and identify whether the current persistence boundaries are sufficient for iterative OS programming.",
          context: [
            `Mounted roots: ${mounts.map(mount => `${quote(mount.src)} -> ${quote(mount.into)}`).join(", ") || "none"}.`,
            "The browser can persist commands, workflows, state resources, and screen resources through mounted XML roots.",
          ],
          tasks: [
            "Review whether the current mounted roots cleanly separate reusable command ability, workflow programs, state machine structure, and screen layout.",
            "Identify any place where the current system forces manual `Application.xml` or JS patching too often.",
            "Recommend the smallest structural improvement that would make the OS easier to evolve through conversational programming.",
          ],
          deliverables: [
            "A decision: keep, refine, or add a mount.",
            "If a change is needed, provide the exact `Application.xml` patch or replacement mount XML.",
            "Explain which future developer workflows become easier after the change.",
          ],
          writes: [
            "If a mount change is proposed, provide a reviewable `src/Application.xml` patch instead of an OsCall.",
          ],
          guardrails: [
            "Do not invent persistence targets that the current server does not expose unless you explicitly propose the supporting server patch.",
            CARD_WORLD_NOTE,
          ],
        }),
      }),
      action({
        id: "mount-new-root",
        title: "Plan a new mounted root",
        description: "Design an additional root if a whole new editable domain is needed.",
        agent: "cindy",
        effects: [write("Application.xml patch", "danger"), write("server route notes", "secondary")],
        draft: prompt({
          lead: "Use Cindy to plan a new mounted root for Neurosymbolic because the current OS may need another editable domain.",
          context: [
            `Existing mounts: ${mounts.map(mount => `${quote(mount.src)} -> ${quote(mount.into)}`).join(", ") || "none"}.`,
            "New roots are justified only when a whole category of evolving structure should be persisted independently.",
          ],
          tasks: [
            "Evaluate whether the requested new editable surface truly deserves its own mount rather than living inside commands, workflows, state, or screen resources.",
            "If it does, provide the exact `Mount` element, target location, and the XML wrapper shape that should live behind the route.",
            "Name any server-side route or save-path support that must be added so the new mount is real rather than decorative.",
          ],
          deliverables: [
            "Decision: do not add, or add a new mount.",
            "If adding, provide the exact `Application.xml` patch plus concise server notes.",
          ],
          writes: [
            "This is a patch-planning task. Provide reviewable XML and route notes; do not pretend the mount already exists.",
          ],
          guardrails: [
            "Prefer a small number of strong mounts over many weak ones.",
            CARD_WORLD_NOTE,
          ],
          placeholders: [
            "new domain purpose: [describe the editable domain that is currently awkward to evolve]",
          ],
        }),
      }),
    ]
  );
}

export function makeMountAI(mount) {
  const type = String(mount?.src || "").split("/").filter(Boolean).at(-1) || "mount";
  const actions = [
    action({
      id: `mount-audit-${type}`,
      title: "Audit this mount boundary",
      description: "Decide whether this mount is carrying the right responsibility.",
      agent: "sophia",
      effects: [write("analysis", "primary"), write("Application.xml patch", "danger")],
      draft: prompt({
        lead: `Use Sophia to audit the mount ${quote(mount.src)} -> ${quote(mount.into)}.`,
        context: [
          `Mounted source: ${quote(mount.src)}.`,
          `Mounted target: ${quote(mount.into)}.`,
          `Mounted domain type: ${quote(type)}.`,
        ],
        tasks: [
          "Decide whether this mount is scoped correctly for the kind of objects it carries.",
          "Identify any responsibilities that should move out of this mount into commands, workflows, state resources, screen resources, or an `Application.xml` patch.",
          "Recommend the smallest actionable improvement.",
        ],
        deliverables: [
          "Decision with rationale.",
          "Any required XML patch or revised resource strategy.",
        ],
        writes: ["If the mount itself must change, provide a precise `src/Application.xml` patch."],
        guardrails: [CARD_WORLD_NOTE],
      }),
    }),
  ];

  if (type === "commands") {
    actions.push(action({
      id: "mount-command-research",
      title: "Research missing commands here",
      description: "Use the command mount as a starting point for gap analysis.",
      agent: "sophia",
      effects: [write("analysis", "primary"), ...commandEffects()],
      draft: prompt({
        lead: "Use Sophia to inspect the current command system and identify what reusable command ability is still missing.",
        context: [
          `The command mount ${quote(mount.src)} feeds ${quote(mount.into)}.`,
          "Reusable ability belongs in commands; workflows should stay thin.",
        ],
        tasks: [
          "Review the current commands in the live OS snapshot.",
          "Identify the most valuable missing command or small command family for the user's likely blank-canvas OS programming workflow.",
          "If a single concrete command stands out, delegate it to Alice and produce the full saveable command XML.",
        ],
        deliverables: [
          "Gap analysis.",
          "If a concrete command is justified, the full command XML plus `save-command` OsCall.",
        ],
        writes: shellPersistenceLines("save-command"),
        guardrails: [
          "Prefer strengthening an existing command before proposing a near-duplicate.",
          CARD_WORLD_NOTE,
        ],
      }),
    }));
  } else if (type === "workflows") {
    actions.push(action({
      id: "mount-workflow-compose",
      title: "Compose a new workflow here",
      description: "Design a workflow that orchestrates the current command corpus.",
      agent: "betty",
      effects: workflowEffects(),
      draft: prompt({
        lead: "Use Betty to compose a new workflow in the mounted workflow corpus.",
        context: [
          `Workflow mount: ${quote(mount.src)} -> ${quote(mount.into)}.`,
          "Workflows are short programs composed from existing commands.",
        ],
        tasks: [
          "Use only commands that already exist in the OS snapshot.",
          "Compose a workflow that advances the current programming goal.",
          "If a needed command is missing, stop and clearly name the missing command for Alice instead of inventing it.",
        ],
        deliverables: [
          "Decision.",
          "Full workflow XML plus `save-workflow` OsCall if the workflow is viable.",
        ],
        writes: shellPersistenceLines("save-workflow"),
        guardrails: [CARD_WORLD_NOTE],
        placeholders: [
          "workflow purpose: [describe the one-off program this workflow should perform]",
        ],
      }),
    }));
  } else if (type === "state") {
    actions.push(action({
      id: "mount-state-branch",
      title: "Add a new state resource under shell",
      description: "Create a mounted state branch instead of editing the shell root.",
      agent: "cindy",
      effects: stateEffects(),
      draft: prompt({
        lead: "Use Cindy to add a new mounted state resource beneath `/application/shell`.",
        context: [
          `State mount: ${quote(mount.src)} -> ${quote(mount.into)}.`,
          "Mounted state resources are the preferred way to grow the shell state machine.",
        ],
        tasks: [
          "Create a new child state resource under `/application/shell` with a clear `name` and `title`.",
          "Add only the lifecycle hooks that the experience truly needs.",
          "Create or update the referenced workflows so the state prints rich cards, starts work, resumes cleanly, and stops cleanly when appropriate.",
        ],
        deliverables: [
          "Any new or updated workflow XML plus save calls.",
          "The new mounted state resource XML plus `save-state`.",
        ],
        writes: statePersistence("new-state-resource"),
        guardrails: [
          "Keep the root shell state in `Application.xml` minimal.",
          CARD_WORLD_NOTE,
        ],
        placeholders: [
          "state purpose: [describe the experience or tool this branch represents]",
          "enter behavior: [describe the card or remote action that should happen on entry]",
          "exit behavior: [describe cleanup, stop, or summary behavior if needed]",
        ],
      }),
    }));
  } else if (type === "screen") {
    actions.push(action({
      id: "mount-screen-resource",
      title: "Create a new mounted screen resource",
      description: "Add a new main-area screen fragment that can be evolved independently.",
      agent: "cindy",
      effects: [write("save-screen", "info"), write("save-state", "warning"), write("save-workflow", "success")],
      draft: prompt({
        lead: "Use Cindy to create or revise a mounted screen resource for the main shell area.",
        context: [
          `Screen mount: ${quote(mount.src)} -> ${quote(mount.into)}.`,
          "Mounted screen resources land inside `Application > Screen > Main` and can be saved with `save-screen`.",
        ],
        tasks: [
          "Design a new or revised screen resource rooted in `<Group name=\"...\">`.",
          "Keep the layout declarative, reviewable, and aligned with a vertical rich-card workflow.",
          "If the new screen is meant to correspond to a state branch, mention the matching state and workflow updates required.",
        ],
        deliverables: [
          "Mounted screen resource XML with `save-screen`.",
          "Any state or workflow changes needed to make the screen meaningful.",
        ],
        writes: screenPersistence("new-screen-resource"),
        guardrails: [CARD_WORLD_NOTE],
        placeholders: [
          "screen purpose: [describe the UI surface you want in the main shell area]",
        ],
      }),
    }));
  }

  return ai(
    `Mounted Root ${quote(mount?.src || "/xml/...")}`,
    "A boot-time graft point from server-backed XML into the live application document.",
    [
      `Source route: ${quote(mount?.src || "/xml/...")}.`,
      `Target selector: ${quote(mount?.into || "unknown")}.`,
    ],
    actions
  );
}

export function makeResourceCollectionAI(kind, resources = []) {
  const isScreen = kind === "screen";
  return ai(
    `${titleCase(kind)} Resources`,
    `The mounted ${kind} resources that are currently present in the live OS snapshot.`,
    [
      `Mounted ${kind} resource count: ${resources.length}.`,
      isScreen
        ? "Screen resources shape the main content area and are saved through `save-screen`."
        : "State resources grow the shell state machine and are saved through `save-state`.",
    ],
    [
      action({
        id: `${kind}-resource-create`,
        title: isScreen ? "Create a new screen resource" : "Create a new state resource",
        description: isScreen
          ? "Add another independently editable main-area fragment."
          : "Add another independently editable shell state branch.",
        agent: "cindy",
        effects: isScreen ? [write("save-screen", "info")] : stateEffects(),
        draft: prompt({
          lead: isScreen
            ? "Use Cindy to create a new mounted screen resource."
            : "Use Cindy to create a new mounted state resource under `/application/shell`.",
          context: [
            `Existing resource names: ${resources.map(resource => quote(resource.name || resource.tag)).join(", ") || "none"}.`,
            isScreen
              ? "New screen resources are rooted in `<Group name=\"...\">` and mounted into the main shell area."
              : "New state resources are rooted in `<State name=\"...\">` and mounted under the shell state.",
          ],
          tasks: isScreen ? [
            "Create a new screen resource with a focused layout purpose.",
            "Use declarative screen nodes only.",
            "If the screen depends on navigation or workflow changes, include the matching state and workflow work.",
          ] : [
            "Create a new child state resource with a clear role in the symbolic world.",
            "Add only the necessary lifecycle workflow hooks.",
            "Create or update workflows so entering the state produces meaningful rich-card behavior.",
          ],
          deliverables: isScreen ? [
            "The new `<Group>` XML plus `save-screen`.",
            "Any matching state or workflow updates if the screen needs them.",
          ] : [
            "Any required workflow XML plus `save-workflow`.",
            "The new mounted state XML plus `save-state`.",
          ],
          writes: isScreen ? screenPersistence("new-screen-resource") : statePersistence("new-state-resource"),
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            isScreen
              ? "resource purpose: [describe the surface you want to add]"
              : "state purpose: [describe the world location or tool flow you want to add]",
          ],
        }),
      }),
      action({
        id: `${kind}-resource-refactor`,
        title: isScreen ? "Refactor screen resource boundaries" : "Refactor state resource boundaries",
        description: "Split or merge mounted resources so the evolving system stays legible.",
        agent: "sophia",
        effects: [write("analysis", "primary"), isScreen ? write("save-screen", "info") : write("save-state", "warning")],
        draft: prompt({
          lead: isScreen
            ? "Use Sophia to review the mounted screen resources and recommend whether they should be split, merged, or kept as-is."
            : "Use Sophia to review the mounted state resources and recommend whether they should be split, merged, or kept as-is.",
          context: [
            `Current ${kind} resource names: ${resources.map(resource => quote(resource.name || resource.tag)).join(", ") || "none"}.`,
            isScreen
              ? "Mounted resources should isolate screen areas that change together."
              : "Mounted resources should isolate state branches that evolve together.",
          ],
          tasks: [
            "Identify any resource that is carrying too much unrelated responsibility.",
            "Identify any resource split that would make AI-driven evolution safer and more precise.",
            "If a concrete change is clearly warranted, provide the exact resource updates needed.",
          ],
          deliverables: [
            "Decision with rationale.",
            "If a concrete restructure is justified, provide the updated resource XML and matching save calls.",
          ],
          writes: [
            isScreen
              ? "Use `save-screen` only if you propose the actual updated mounted screen resources."
              : "Use `save-state` and `save-workflow` only if you propose actual updated mounted state resources and hooks.",
          ],
          guardrails: [CARD_WORLD_NOTE],
        }),
      }),
    ]
  );
}

export function makeScreenResourceAI(resource) {
  const resourceName = resource?.name || resource?.tag || "screen-resource";
  return ai(
    `Screen Resource ${quote(resourceName)}`,
    "A mounted main-area screen fragment that can be evolved independently from the shell chrome.",
    [
      `Resource name: ${quote(resourceName)}.`,
      `Root tag: ${quote(resource?.tag || "Group")}.`,
    ],
    [
      action({
        id: `screen-resource-expand-${resourceName}`,
        title: "Expand this screen resource",
        description: "Add structure, controls, or richer card layout inside this mounted resource.",
        agent: "cindy",
        effects: screenEffects(resourceName),
        draft: prompt({
          lead: `Use Cindy to expand mounted screen resource ${quote(resourceName)}.`,
          context: [
            `Mounted screen resource: ${quote(resourceName)}.`,
            `Current root tag: ${quote(resource?.tag || "Group")}.`,
            "This resource already lives inside the shell main area and is safe to evolve with `save-screen`.",
          ],
          tasks: [
            "Revise the resource in place so it better supports the target programmer experience.",
            "Use only the screen nodes and panels that are already part of the OS snapshot, unless a JS patch is truly needed.",
            "Keep the result small, expressive, and centered on rich vertical cards rather than form-heavy editing.",
          ],
          deliverables: [
            "Updated `<Group>` or screen resource XML plus `save-screen`.",
            "Any matching state or workflow notes if the new layout assumes new navigation or behavior.",
          ],
          writes: screenPersistence(resourceName),
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "goal for this area: [describe what this part of the shell should now do]",
          ],
        }),
      }),
      action({
        id: `screen-resource-journey-${resourceName}`,
        title: "Connect this resource to a state journey",
        description: "Treat this screen as part of a traversable symbolic flow.",
        agent: "cindy",
        effects: [write("save-screen", "info"), write("save-state", "warning"), write("save-workflow", "success")],
        draft: prompt({
          lead: `Use Cindy to connect mounted screen resource ${quote(resourceName)} to a concrete state-machine journey.`,
          context: [
            `Mounted screen resource: ${quote(resourceName)}.`,
            "The blank-canvas OS should feel like a symbolic world where entering states prints meaningful cards and workflows interact with remote systems when needed.",
          ],
          tasks: [
            "Explain which state or state branch should own this screen resource.",
            "Update the screen resource so its layout makes sense for that journey.",
            "Create or revise the required state hooks and workflows so navigation through the journey feels coherent and card-driven.",
          ],
          deliverables: [
            "Updated screen resource XML plus `save-screen`.",
            "Any new or updated state resource XML plus `save-state`.",
            "Any new or updated workflow XML plus `save-workflow`.",
          ],
          writes: [
            "Emit `save-screen` for the mounted screen resource.",
            "Emit `save-state` and `save-workflow` if the journey requires new states or workflows.",
          ],
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "journey goal: [describe the programmer-facing experience this screen belongs to]",
          ],
        }),
      }),
    ]
  );
}

export function makeStateResourceAI(resource) {
  const resourceName = resource?.name || "state-resource";
  return ai(
    `State Resource ${quote(resourceName)}`,
    "A mounted shell state resource that can own descendants and lifecycle hooks.",
    [
      `Resource name: ${quote(resourceName)}.`,
      `Title: ${quote(resource?.title || resourceName)}.`,
    ],
    [
      action({
        id: `state-resource-expand-${resourceName}`,
        title: "Extend this state resource",
        description: "Add descendants, hooks, and matching workflows under this mounted branch.",
        agent: "cindy",
        effects: stateEffects(),
        draft: prompt({
          lead: `Use Cindy to extend mounted state resource ${quote(resourceName)}.`,
          context: [
            `Mounted state resource: ${quote(resourceName)}.`,
            `Current title: ${quote(resource?.title || resourceName)}.`,
            "Mounted state resources are the preferred unit of growth under the shell state machine.",
          ],
          tasks: [
            "Add or refine child states inside this resource.",
            "Attach enter, exit, and resume hooks only where they materially improve the journey.",
            "Create or update workflows so the branch produces rich status cards and manages long-running work cleanly.",
          ],
          deliverables: [
            "Any updated or new workflows with `save-workflow`.",
            "Updated mounted state XML with `save-state`.",
          ],
          writes: statePersistence(resourceName),
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "new branch or behavior: [describe what this state resource should gain]",
          ],
        }),
      }),
      action({
        id: `state-resource-lifecycle-${resourceName}`,
        title: "Model a start or stop lifecycle here",
        description: "Turn this resource into a long-running operational journey with clear enter and exit semantics.",
        agent: "cindy",
        effects: stateEffects(),
        draft: prompt({
          lead: `Use Cindy to model a long-running operational lifecycle inside mounted state resource ${quote(resourceName)}.`,
          context: [
            `Mounted state resource: ${quote(resourceName)}.`,
            "A common Neurosymbolic pattern is: enter starts a remote or local process, nested states inspect or interact with it, and exit stops or summarizes it.",
          ],
          tasks: [
            "Design the minimal state hierarchy needed for this lifecycle.",
            "Use workflows on enter, exit, and resume deliberately so the operational behavior is explicit.",
            "Ensure the user sees rich cards that explain what started, what is running, and what stopped.",
          ],
          deliverables: [
            "Updated state resource XML with lifecycle hooks.",
            "Any new or revised workflow XML needed to implement the lifecycle.",
          ],
          writes: statePersistence(resourceName),
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "operation to manage: [describe the service, container, server, or long-running task]",
            "enter card: [describe the card shown when work starts]",
            "exit card: [describe the card shown when work stops or is summarized]",
          ],
        }),
      }),
    ]
  );
}

export function makeStateCollectionAI(rootName, currentState) {
  return ai(
    "State Machine",
    "The nested symbolic world that users traverse, including enter, exit, and resume hooks.",
    [
      `Root state: ${quote(rootName || "application")}.`,
      `Current active path: ${quote(currentState || "/")}.`,
    ],
    [
      action({
        id: "state-world-design",
        title: "Design a new state journey",
        description: "Grow the blank canvas into a new symbolic branch with deliberate lifecycle behavior.",
        agent: "cindy",
        effects: stateEffects(),
        draft: prompt({
          lead: "Use Cindy to design a new state-machine journey in Neurosymbolic.",
          context: [
            `Current active path: ${quote(currentState || "/")}.`,
            "The shell root should stay light; substantial behavior should live in mounted state resources and workflows.",
          ],
          tasks: [
            "Create a new branch under `/application/shell` for a meaningful programmer-facing experience.",
            "Define how entering, descending, resuming, and exiting the branch should feel.",
            "Create any matching workflows so the journey prints rich cards and can coordinate remote or local work when appropriate.",
          ],
          deliverables: [
            "Any new workflow XML plus `save-workflow`.",
            "The new mounted state XML plus `save-state`.",
          ],
          writes: statePersistence("new-state-resource"),
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "branch purpose: [describe the symbolic world or tool journey you want to create]",
          ],
        }),
      }),
      action({
        id: "state-hook-audit",
        title: "Audit lifecycle coverage",
        description: "Find where enter, exit, or resume hooks are missing or overloaded.",
        agent: "sophia",
        effects: [write("analysis", "primary"), write("save-state", "warning"), write("save-workflow", "success")],
        draft: prompt({
          lead: "Use Sophia to audit the current state machine for missing or awkward lifecycle coverage.",
          context: [
            `Current active path: ${quote(currentState || "/")}.`,
            "Lifecycle hooks are what make the OS feel alive rather than static.",
          ],
          tasks: [
            "Inspect the current state tree and identify where enter, exit, or resume hooks are absent but would materially improve the experience.",
            "Call out any hooks that are overloaded or doing too much.",
            "If one concrete fix stands out, provide the exact state and workflow edits needed.",
          ],
          deliverables: [
            "Audit findings.",
            "If a specific fix is clear, the actual XML changes and save calls.",
          ],
          writes: [
            "Use `save-state` and `save-workflow` only when you provide the exact updated resources.",
          ],
          guardrails: [CARD_WORLD_NOTE],
        }),
      }),
    ]
  );
}

export function makeStateNodeAI({
  label,
  name,
  title,
  path,
  resourceName,
  workflows = [],
  childCount = 0,
  isRootShell = false,
}) {
  const persistence = statePersistence(resourceName);
  const effects = resourceName ? stateEffects() : [write("patch Application.xml", "danger"), write("save-state", "warning")];
  return ai(
    `State ${quote(path)}`,
    "A state node in the Neurosymbolic symbolic world.",
    [
      `State name: ${quote(name || label || "state")}.`,
      `State title: ${quote(title || label || name || "state")}.`,
      `State path: ${quote(path || "/")}.`,
      resourceName
        ? `Mounted resource owner: ${quote(resourceName)}.`
        : "This node belongs to the root shell structure rather than a mounted state resource.",
      workflows.length
        ? `Lifecycle hooks already present: ${workflows.map(workflow => `${workflow.on}:${workflow.use}`).join(", ")}.`
        : "No lifecycle hooks are currently attached here.",
      `Child state count: ${childCount}.`,
    ],
    [
      action({
        id: `state-child-${name || "state"}`,
        title: "Add a child state here",
        description: "Grow the world downward from this exact node.",
        agent: "cindy",
        effects,
        draft: prompt({
          lead: resourceName
            ? `Use Cindy to add a new child state under ${quote(path)} within mounted state resource ${quote(resourceName)}.`
            : `Use Cindy to add a new mounted child state beneath ${quote(path)} without bloating the root shell state.`,
          context: [
            `Parent state path: ${quote(path || "/")}.`,
            resourceName
              ? `Mounted state resource to save: ${quote(resourceName)}.`
              : "This parent is root shell structure, so prefer introducing a mounted child resource rather than rewriting the shell root unless absolutely necessary.",
          ],
          tasks: [
            "Create one clear child state with a strong purpose.",
            "Attach only the hooks that are needed for the behavior.",
            "Create or revise workflows so entering the new state produces useful rich cards and operational behavior.",
          ],
          deliverables: [
            "Any new or revised workflow XML plus save calls.",
            resourceName
              ? "The updated mounted state resource XML plus `save-state`."
              : "Either the new mounted child state resource plus `save-state`, or a precise `Application.xml` patch if the shell root itself must change.",
          ],
          writes: persistence,
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "new child state purpose: [describe what the user should be able to do there]",
          ],
        }),
      }),
      action({
        id: `state-lifecycle-${name || "state"}`,
        title: "Refine lifecycle behavior here",
        description: "Add or revise enter, exit, or resume semantics for this state.",
        agent: "cindy",
        effects,
        draft: prompt({
          lead: `Use Cindy to refine lifecycle behavior for state ${quote(path)}.`,
          context: [
            `State path: ${quote(path || "/")}.`,
            workflows.length
              ? `Existing hooks: ${workflows.map(workflow => `${workflow.on}:${workflow.use}`).join(", ")}.`
              : "No hooks are currently attached.",
            resourceName
              ? `Save target: mounted state resource ${quote(resourceName)}.`
              : "If lifecycle refinement must touch the root shell state, provide a precise `Application.xml` patch or prefer a mounted child resource instead.",
          ],
          tasks: [
            "Decide which of enter, exit, and resume should exist here.",
            "Ensure the workflows tell a coherent story through rich cards and any external actions they trigger.",
            "Keep the lifecycle minimal and explicit.",
          ],
          deliverables: [
            "Updated state XML for this node or its mounted resource.",
            "Any new or revised workflow XML the hooks require.",
          ],
          writes: persistence,
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "desired lifecycle behavior: [describe what should happen on enter, exit, and resume]",
          ],
        }),
      }),
      action({
        id: `state-operation-${name || "state"}`,
        title: "Turn this into an operational journey",
        description: "Model start, inspect, and stop behavior around this state branch.",
        agent: "cindy",
        effects,
        draft: prompt({
          lead: `Use Cindy to turn state ${quote(path)} into a deliberate operational journey.`,
          context: [
            `State path: ${quote(path || "/")}.`,
            resourceName
              ? `Mounted save target: ${quote(resourceName)}.`
              : "Prefer creating a mounted child state resource if the operational journey should not live directly on the shell root.",
            "In Neurosymbolic, a strong pattern is: enter starts or reveals a process, nested states inspect or control it, and exit stops or summarizes it.",
          ],
          tasks: [
            "Design the smallest useful state hierarchy for this operation.",
            "Use enter, exit, and resume hooks intentionally.",
            "Ensure the workflow output is rich-card oriented and easy to scan.",
          ],
          deliverables: [
            "Updated state XML and hook structure.",
            "Any workflow XML required to start, inspect, or stop the operation.",
          ],
          writes: persistence,
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "operation goal: [describe the server, container, process, or remote system]",
            "status cards needed: [describe the cards the user should see while moving through the branch]",
          ],
        }),
      }),
      !isRootShell ? action({
        id: `state-refactor-${name || "state"}`,
        title: "Refactor this branch",
        description: "Rename, split, or simplify this branch without losing meaning.",
        agent: "sophia",
        effects,
        draft: prompt({
          lead: `Use Sophia to refactor state branch ${quote(path)} while preserving behavior.`,
          context: [
            `State path: ${quote(path || "/")}.`,
            resourceName
              ? `Mounted state resource owner: ${quote(resourceName)}.`
              : "This branch lives in root shell structure.",
            `Current child count: ${childCount}.`,
          ],
          tasks: [
            "Decide whether this branch should be renamed, split, simplified, or left alone.",
            "If a concrete refactor is justified, provide the minimal state and workflow edits required.",
            "Keep navigation semantics clear after the change.",
          ],
          deliverables: [
            "Decision with rationale.",
            "If changing the branch, the exact updated XML and save calls or patch.",
          ],
          writes: persistence,
          guardrails: [CARD_WORLD_NOTE],
        }),
      }) : null,
    ]
  );
}

export function makeStateHookAI({ path, resourceName, on, use }) {
  return ai(
    `State Hook ${quote(on)} on ${quote(path)}`,
    "A lifecycle hook that binds a state event to a workflow.",
    [
      `State path: ${quote(path || "/")}.`,
      `Lifecycle event: ${quote(on || "enter")}.`,
      `Referenced workflow: ${quote(use || "workflow")}.`,
      resourceName
        ? `Mounted state resource owner: ${quote(resourceName)}.`
        : "This hook belongs to the root shell state structure.",
    ],
    [
      action({
        id: `state-hook-improve-${on}-${use}`,
        title: "Improve this lifecycle hook",
        description: "Make the referenced workflow sharper for this exact state event.",
        agent: "betty",
        effects: stateEffects(),
        draft: prompt({
          lead: `Use Betty to improve the workflow ${quote(use)} as used by the ${quote(on)} hook on state ${quote(path)}.`,
          context: [
            `Lifecycle event: ${quote(on || "enter")}.`,
            `Workflow in use: ${quote(use || "workflow")}.`,
            resourceName
              ? `Mounted state resource to save: ${quote(resourceName)}.`
              : "If the hook definition itself changes on the shell root, provide a precise `Application.xml` patch or prefer a mounted child state resource.",
          ],
          tasks: [
            "Inspect the existing workflow from the snapshot instead of inventing command names.",
            "Improve the workflow so it better fits this lifecycle moment.",
            "If a better workflow name or split is warranted, update the state hook accordingly.",
          ],
          deliverables: [
            "Updated workflow XML plus `save-workflow` if the workflow changes.",
            "Updated state XML or state patch if the hook wiring changes.",
          ],
          writes: statePersistence(resourceName),
          guardrails: [
            "Do not invent missing commands. If a needed command is absent, say so and stop.",
            CARD_WORLD_NOTE,
          ],
        }),
      }),
      action({
        id: `state-hook-pair-${on}-${use}`,
        title: "Add companion lifecycle hooks",
        description: "Balance this hook with enter, exit, or resume companions.",
        agent: "cindy",
        effects: stateEffects(),
        draft: prompt({
          lead: `Use Cindy to balance the ${quote(on)} hook on state ${quote(path)} with any missing companion lifecycle hooks.`,
          context: [
            `Existing hook: ${quote(on || "enter")} -> ${quote(use || "workflow")}.`,
            resourceName
              ? `Mounted state resource owner: ${quote(resourceName)}.`
              : "This hook lives in root shell structure.",
          ],
          tasks: [
            "Decide whether this state also needs enter, exit, or resume behavior in addition to the current hook.",
            "If companion hooks are warranted, create or update the matching workflows.",
            "Ensure the sequence of cards and external effects makes narrative sense while moving through the state branch.",
          ],
          deliverables: [
            "Updated state XML with the full hook set.",
            "Any new or updated workflows needed for the lifecycle.",
          ],
          writes: statePersistence(resourceName),
          guardrails: [CARD_WORLD_NOTE],
        }),
      }),
    ]
  );
}

export function makeScreenCollectionAI(currentState) {
  return ai(
    "Screen Layout",
    "The declarative screen tree that shapes the browser UI.",
    [
      `Current active state path: ${quote(currentState || "/")}.`,
      "Mounted screen resources are the preferred surface for main-area layout changes.",
    ],
    [
      action({
        id: "screen-redesign",
        title: "Redesign the main shell experience",
        description: "Use the screen tree as the starting point for a more intentional UI.",
        agent: "cindy",
        effects: [write("save-screen", "info"), write("save-state", "warning"), write("save-workflow", "success")],
        draft: prompt({
          lead: "Use Cindy to redesign the main shell experience while keeping the UI declarative and reviewable.",
          context: [
            `Current active state path: ${quote(currentState || "/")}.`,
            "Most main-area layout work should be expressed through mounted screen resources under `/xml/screen`.",
          ],
          tasks: [
            "Propose the smallest screen layout change that materially improves the programmer experience.",
            "If the change needs state or workflow support, include that work rather than leaving the UI disconnected.",
            "Keep the style bold and intentional, but still optimized for vertical rich cards rather than drag-and-drop editing.",
          ],
          deliverables: [
            "Updated screen resource XML and any matching state or workflow XML that makes the change real.",
          ],
          writes: [
            "Emit `save-screen` for mounted screen resources.",
            "Emit `save-state` and `save-workflow` only if navigation or behavior must also change.",
          ],
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "designer intent: [describe the kind of screen experience you want]",
          ],
        }),
      }),
      action({
        id: "screen-ui-audit",
        title: "Audit the screen tree for missing tools",
        description: "Ask what UI surfaces are missing for the current symbolic world.",
        agent: "sophia",
        effects: [write("analysis", "primary"), write("save-screen", "info"), write("patch Application.xml", "danger")],
        draft: prompt({
          lead: "Use Sophia to audit the current screen tree and identify which UI surfaces are still missing.",
          context: [
            `Current active state path: ${quote(currentState || "/")}.`,
            "The OS should help programmers inspect and evolve a symbolic world through focused cards, panels, buttons, modals, and offcanvas surfaces.",
          ],
          tasks: [
            "Review the live screen tree and call out the most useful missing surface.",
            "Separate what belongs in mounted screen resources from what would require an `Application.xml` shell-chrome patch.",
            "If one change clearly stands out, provide the actual XML needed.",
          ],
          deliverables: [
            "Audit findings.",
            "If a concrete change is chosen, the exact XML and save/patch path.",
          ],
          writes: [
            "Use `save-screen` for main-area resources.",
            "Use a reviewable `Application.xml` patch only for shell-chrome changes outside mounted screen resources.",
          ],
          guardrails: [CARD_WORLD_NOTE],
        }),
      }),
    ]
  );
}

export function makeScreenNodeAI({
  tag,
  label,
  path,
  detail,
  resourceName,
  attributes = {},
}) {
  const saveable = !!resourceName;
  const effects = screenEffects(resourceName);
  const writes = screenPersistence(resourceName);
  const context = [
    `Screen node tag: ${quote(tag || label || "node")}.`,
    `Screen tree path: ${quote(path || "Application > Screen")}.`,
    detail ? `Current attributes: ${detail}.` : "This node has no explicit attributes.",
    saveable
      ? `Mounted screen resource owner: ${quote(resourceName)}.`
      : "This node is part of shell chrome in `Application.xml` rather than a mounted screen resource.",
  ];

  const actions = [
    action({
      id: `screen-node-evolve-${tag || label}`,
      title: "Evolve this node in place",
      description: "Revise this exact UI node while respecting how it is persisted.",
      agent: "cindy",
      effects,
      draft: prompt({
        lead: `Use Cindy to evolve screen node ${quote(tag || label || "node")} at ${quote(path)}.`,
        context,
        tasks: [
          "Revise this node as narrowly as possible.",
          "If the node is mounted-screen-backed, save the resource with `save-screen`.",
          "If the node lives in shell chrome, provide a precise `Application.xml` patch instead.",
        ],
        deliverables: [
          "The updated XML or patch for this node and any directly related surrounding structure.",
        ],
        writes,
        guardrails: [CARD_WORLD_NOTE],
        placeholders: [
          "change requested: [describe exactly what should change about this node]",
        ],
      }),
    }),
    action({
      id: `screen-node-children-${tag || label}`,
      title: "Add children or siblings around this node",
      description: "Grow the layout from this exact anchor point.",
      agent: "cindy",
      effects,
      draft: prompt({
        lead: `Use Cindy to add structure around screen node ${quote(tag || label || "node")} at ${quote(path)}.`,
        context,
        tasks: [
          "Use this node as the anchor for a small, intentional layout expansion.",
          "Add the minimal new children, siblings, or panel references needed.",
          "Keep the result focused on card-driven interaction rather than generic dashboard clutter.",
        ],
        deliverables: [
          "Updated screen XML or an `Application.xml` patch, depending on where this node lives.",
        ],
        writes,
        guardrails: [CARD_WORLD_NOTE],
        placeholders: [
          "new structure needed: [describe the extra child, sibling, panel, modal, or button]",
        ],
      }),
    }),
  ];

  if (tag === "Panel") {
    const panelName = attributes.use || attributes.name || "panel";
    actions.push(action({
      id: `screen-node-panel-${panelName}`,
      title: "Redesign the referenced panel",
      description: "Use this panel reference to improve the underlying rich-card surface.",
      agent: "cindy",
      effects: [write("screen patch", "info"), write("panel patch", "danger")],
      draft: prompt({
        lead: `Use Cindy to redesign the panel referenced by screen node ${quote(path)}.`,
        context: [
          ...context,
          `Referenced panel name: ${quote(panelName)}.`,
          "Panel definitions live in `Interfaces` and may require a reviewable patch if the markup itself changes there.",
        ],
        tasks: [
          "Decide whether the change should happen at the panel definition, the screen usage site, or both.",
          "If the panel definition must change, provide the exact XML or patch needed for the interface panel.",
          "If the mounted screen resource should also change, include that resource update.",
        ],
        deliverables: [
          "A precise panel change plan and the actual patch or XML updates.",
        ],
        writes: [
          "Use `save-screen` for mounted screen resource changes.",
          "Use a reviewable patch for `Interfaces` changes because panel persistence is not currently mounted separately.",
        ],
        guardrails: [CARD_WORLD_NOTE],
        placeholders: [
          "panel experience desired: [describe the richer card surface you want this panel to become]",
        ],
      }),
    }));
  } else if (tag === "Button") {
    actions.push(action({
      id: `screen-node-button-${label}`,
      title: "Retarget this button",
      description: "Change what this UI control reveals, toggles, or navigates to.",
      agent: "cindy",
      effects,
      draft: prompt({
        lead: `Use Cindy to retarget button node at ${quote(path)}.`,
        context,
        tasks: [
          "Decide whether this button should navigate, toggle a surface, or expose a different tool.",
          "Update only the attributes and nearby structure needed to support the new role.",
          "Ensure the button still fits the shell's programmer workflow.",
        ],
        deliverables: ["Updated button XML or patch."],
        writes,
        guardrails: [CARD_WORLD_NOTE],
        placeholders: [
          "new button role: [describe what this control should now do]",
        ],
      }),
    }));
  } else if (tag === "Navbar") {
    actions.push(action({
      id: `screen-node-navbar-${label}`,
      title: "Refine shell navigation tools here",
      description: "Improve the current navigational affordances around this navbar.",
      agent: "cindy",
      effects,
      draft: prompt({
        lead: `Use Cindy to refine the navbar at ${quote(path)}.`,
        context,
        tasks: [
          "Improve the navbar with the smallest meaningful set of additional controls, status displays, or summaries.",
          "Avoid generic dashboard clutter; add only what supports the symbolic programmer workflow.",
          "Keep navigation and tool discovery explicit.",
        ],
        deliverables: ["Updated navbar XML or precise patch."],
        writes,
        guardrails: [CARD_WORLD_NOTE],
        placeholders: [
          "navbar improvement: [describe the command, status, or navigation affordance you want here]",
        ],
      }),
    }));
  }

  return ai(
    `Screen Node ${quote(tag || label || "node")}`,
    saveable
      ? "A screen node inside a mounted resource that can be evolved with `save-screen`."
      : "A shell-chrome screen node that currently requires an `Application.xml` patch rather than a mounted screen save.",
    context,
    actions
  );
}

export function makeCommandCorpusAI(commands = []) {
  const names = commands.map(command => command.name).filter(Boolean);
  return ai(
    "Command System",
    "The reusable command vocabulary that the symbolic world builds on.",
    [
      `Registered commands: ${names.map(name => quote(name)).join(", ") || "none"}.`,
      "Commands should be parameterized, composable, and more general than one-off workflow steps.",
    ],
    [
      action({
        id: "command-research",
        title: "Research what commands are missing",
        description: "Ask for a gap analysis grounded in the current command corpus.",
        agent: "sophia",
        effects: [write("analysis", "primary"), ...commandEffects()],
        draft: prompt({
          lead: "Use Sophia to identify the most valuable missing command ability in the current command corpus.",
          context: [
            `Existing commands: ${names.map(name => quote(name)).join(", ") || "none"}.`,
            "The OS should favor a small number of strong, parameterized commands over piles of narrow wrappers.",
          ],
          tasks: [
            "Audit the current commands and identify the single most useful missing command or command family.",
            "Explain why the missing ability belongs in a reusable command rather than a workflow.",
            "If a single concrete command clearly stands out, delegate it to Alice and provide the saveable command XML.",
          ],
          deliverables: [
            "Gap analysis.",
            "If a concrete command is justified, the full command XML plus `save-command`.",
          ],
          writes: shellPersistenceLines("save-command"),
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "problem space to optimize: [describe the kind of capability you suspect is missing]",
          ],
        }),
      }),
      action({
        id: "command-rich-cards",
        title: "Design richer card-producing commands",
        description: "Focus the corpus on commands that print strong programmer-facing cards.",
        agent: "alice",
        effects: commandEffects(),
        draft: prompt({
          lead: "Use Alice to design or improve commands so the OS can print stronger programmer-facing rich cards.",
          context: [
            "The end-user interface remains a vertical list of rich cards.",
            "Commands are the reusable ability layer beneath those cards.",
          ],
          tasks: [
            "Review the current commands and decide whether an existing command should be improved or a new one should be created.",
            "Favor parameterized command design over tiny wrappers.",
            "Ensure the command output contract matches the card-driven experience you are designing.",
          ],
          deliverables: [
            "Decision.",
            "Full command XML plus `save-command` for the chosen improvement or new command.",
          ],
          writes: shellPersistenceLines("save-command"),
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "card type needed: [describe the kind of rich card or operational status output you want the system to produce]",
          ],
        }),
      }),
    ]
  );
}

export function makeCommandCategoryAI(category, commands = []) {
  const names = commands.map(command => command.name).filter(Boolean);
  return ai(
    `Command Category ${quote(category)}`,
    "A category slice of the command corpus.",
    [
      `Category: ${quote(category || "uncategorized")}.`,
      `Commands in category: ${names.map(name => quote(name)).join(", ") || "none yet"}.`,
    ],
    [
      action({
        id: `command-category-missing-${category}`,
        title: "What is missing here?",
        description: "Run a focused research pass on this command category.",
        agent: "sophia",
        effects: [write("analysis", "primary"), ...commandEffects()],
        draft: prompt({
          lead: `Use Sophia to research what command ability is missing from category ${quote(category)}.`,
          context: [
            `Category under review: ${quote(category || "uncategorized")}.`,
            `Commands currently present: ${names.map(name => quote(name)).join(", ") || "none"}.`,
          ],
          tasks: [
            "Identify the strongest missing reusable ability for this category.",
            "Explain why it belongs here and why it should be a command rather than a workflow.",
            "If one concrete command stands out, delegate it to Alice and provide the full saveable command XML.",
          ],
          deliverables: [
            "Gap analysis.",
            "If justified, the new or improved command XML plus `save-command`.",
          ],
          writes: shellPersistenceLines("save-command"),
          guardrails: [
            "Prefer improving a nearby command before creating a near-duplicate.",
            CARD_WORLD_NOTE,
          ],
        }),
      }),
      action({
        id: `command-category-create-${category}`,
        title: "Create a command in this category",
        description: "Add a parameterized new command aligned to this domain.",
        agent: "alice",
        effects: commandEffects(),
        draft: prompt({
          lead: `Use Alice to create or improve a command in category ${quote(category)}.`,
          context: [
            `Category: ${quote(category || "uncategorized")}.`,
            `Nearby commands: ${names.map(name => quote(name)).join(", ") || "none"}.`,
          ],
          tasks: [
            "Check whether an existing command in this category should be improved first.",
            "If a new command is warranted, make it parameterized and tool-like rather than narrow.",
            "Return the full saveable command definition with a real `<Function>` body.",
          ],
          deliverables: [
            "Decision.",
            "Full command XML plus `save-command`.",
          ],
          writes: shellPersistenceLines("save-command"),
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "command goal: [describe the reusable ability you want this category to gain]",
          ],
        }),
      }),
      action({
        id: `command-category-cleanup-${category}`,
        title: "Generalize instead of duplicating",
        description: "Make this category more elegant by reducing narrow wrappers.",
        agent: "alice",
        effects: commandEffects(),
        draft: prompt({
          lead: `Use Alice to generalize the commands in category ${quote(category)} instead of letting them drift toward duplication.`,
          context: [
            `Category: ${quote(category || "uncategorized")}.`,
            `Current commands: ${names.map(name => quote(name)).join(", ") || "none"}.`,
          ],
          tasks: [
            "Identify whether one command should absorb the role of another through better parameterization.",
            "Prefer improving a command rather than keeping narrow near-duplicates.",
            "Provide the actual improved command XML if a concrete generalization is clear.",
          ],
          deliverables: [
            "Decision with rationale.",
            "If a concrete generalization is chosen, the updated command XML plus `save-command`.",
          ],
          writes: shellPersistenceLines("save-command"),
          guardrails: [CARD_WORLD_NOTE],
        }),
      }),
    ]
  );
}

export function makeCommandAI(command) {
  const params = command.parameters?.map(parameter => parameter.name || parameter.type).filter(Boolean) || [];
  const outputs = command.outputs?.map(output => output.name || output.component || output.type).filter(Boolean) || [];
  return ai(
    `Command ${quote(command.name)}`,
    "A concrete reusable ability in the command corpus.",
    [
      `Command name: ${quote(command.name)}.`,
      `Path: ${quote(command.path)}.`,
      `Category: ${quote(command.category)}.`,
      `Parameters: ${params.length ? params.map(name => quote(name)).join(", ") : "none"}.`,
      `Outputs: ${outputs.length ? outputs.map(name => quote(name)).join(", ") : "none"}.`,
      command.description ? `Description: ${command.description}.` : "Description is currently sparse.",
    ],
    [
      action({
        id: `command-improve-${command.name}`,
        title: "Improve this command",
        description: "Strengthen this command instead of creating a nearby duplicate.",
        agent: "alice",
        effects: commandEffects(),
        draft: prompt({
          lead: `Use Alice to improve command ${quote(command.name)}.`,
          context: [
            `Command path: ${quote(command.path)}.`,
            `Category: ${quote(command.category)}.`,
            `Current parameters: ${params.length ? params.map(name => quote(name)).join(", ") : "none"}.`,
            `Current outputs: ${outputs.length ? outputs.map(name => quote(name)).join(", ") : "none"}.`,
          ],
          tasks: [
            "Strengthen this command in place rather than creating a sibling wrapper.",
            "If new capability is needed, prefer adding the minimal parameters that make the command more generally useful.",
            "Keep the `<Function>` implementation complete and saveable.",
          ],
          deliverables: [
            "Decision.",
            "Full updated command XML plus `save-command`.",
          ],
          writes: shellPersistenceLines("save-command"),
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "improvement goal: [describe the new ability or refinement you want this command to gain]",
          ],
        }),
      }),
      action({
        id: `command-debug-${command.name}`,
        title: "Debug this command",
        description: "Use the command's current implementation to trace a bug precisely.",
        agent: "daisy",
        effects: commandEffects(),
        draft: prompt({
          lead: `Use Daisy to debug command ${quote(command.name)} using the live snapshot's functionCode.`,
          context: [
            `Command name: ${quote(command.name)}.`,
            `Path: ${quote(command.path)}.`,
            `Parameters: ${params.length ? params.map(name => quote(name)).join(", ") : "none"}.`,
          ],
          tasks: [
            "Read the current `functionCode` from the snapshot.",
            "Trace the smallest actual bug or weakness relevant to the issue described.",
            "Fix only what is broken and return the full saveable command XML.",
          ],
          deliverables: [
            "Bug statement.",
            "Full fixed command XML plus `save-command`.",
          ],
          writes: shellPersistenceLines("save-command"),
          guardrails: [
            "Do not refactor unrelated behavior.",
            CARD_WORLD_NOTE,
          ],
          placeholders: [
            "bug or failure mode: [describe what this command is doing wrong]",
          ],
        }),
      }),
      action({
        id: `command-cards-${command.name}`,
        title: "Make the output more like a rich card",
        description: "Align the command output contract with the card-driven UI style.",
        agent: "alice",
        effects: commandEffects(),
        draft: prompt({
          lead: `Use Alice to refine command ${quote(command.name)} so its output better supports the rich-card UI style.`,
          context: [
            `Command name: ${quote(command.name)}.`,
            `Current outputs: ${outputs.length ? outputs.map(name => quote(name)).join(", ") : "none"}.`,
            "The UI should stay a vertical list of expressive cards rather than generic logs.",
          ],
          tasks: [
            "Decide whether the command should print a stronger component, richer metadata, or more interactive follow-up controls.",
            "Keep the command reusable and parameterized.",
            "Update the output metadata and implementation so they match.",
          ],
          deliverables: [
            "Decision.",
            "Full updated command XML plus `save-command`.",
          ],
          writes: shellPersistenceLines("save-command"),
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "desired card style: [describe the kind of card this command should produce]",
          ],
        }),
      }),
      action({
        id: `command-docs-${command.name}`,
        title: "Improve docs and examples",
        description: "Make this command easier for the next agent to use and evolve.",
        agent: "emma",
        effects: commandEffects(),
        draft: prompt({
          lead: `Use Emma to improve the documentation surface of command ${quote(command.name)}.`,
          context: [
            `Command path: ${quote(command.path)}.`,
            `Category: ${quote(command.category)}.`,
            `Parameters: ${params.length ? params.map(name => quote(name)).join(", ") : "none"}.`,
          ],
          tasks: [
            "Improve Synopsis, Description, Improve hints, parameter descriptions, and examples.",
            "Do not change function code unless there is a clear bug.",
            "Make the command easier for future AI agents to extend safely.",
          ],
          deliverables: [
            "The full updated command XML plus `save-command`.",
          ],
          writes: shellPersistenceLines("save-command"),
          guardrails: [CARD_WORLD_NOTE],
        }),
      }),
    ]
  );
}

export function makeCommandParameterAI(command, parameter) {
  const name = parameter?.name || "parameter";
  return ai(
    `Command Parameter ${quote(name)}`,
    "A specific parameter contract inside a command.",
    [
      `Command: ${quote(command?.name)}.`,
      `Parameter name: ${quote(name)}.`,
      `Type: ${quote(parameter?.type || "text/plain")}.`,
      parameter?.required ? "This parameter is currently required." : "This parameter is currently optional or unspecified.",
      parameter?.default ? `Default: ${quote(parameter.default)}.` : "No default is currently declared.",
    ],
    [
      action({
        id: `command-param-contract-${command?.name}-${name}`,
        title: "Refine this parameter contract",
        description: "Make the parameter more precise, useful, or better typed.",
        agent: "alice",
        effects: commandEffects(),
        draft: prompt({
          lead: `Use Alice to refine parameter ${quote(name)} on command ${quote(command?.name)}.`,
          context: [
            `Command: ${quote(command?.name)} at ${quote(command?.path)}.`,
            `Current parameter type: ${quote(parameter?.type || "text/plain")}.`,
            parameter?.default ? `Current default: ${quote(parameter.default)}.` : "No default is currently declared.",
          ],
          tasks: [
            "Decide whether this parameter's type, default, requiredness, or semantics should change.",
            "Prefer a stronger parameter contract over adding several new narrow parameters.",
            "Update the command XML and implementation if the parameter contract changes.",
          ],
          deliverables: [
            "Decision.",
            "Full updated command XML plus `save-command`.",
          ],
          writes: shellPersistenceLines("save-command"),
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "parameter refinement: [describe what should change about this parameter]",
          ],
        }),
      }),
      action({
        id: `command-param-docs-${command?.name}-${name}`,
        title: "Clarify parameter documentation",
        description: "Make the parameter easier for future agents to understand correctly.",
        agent: "emma",
        effects: commandEffects(),
        draft: prompt({
          lead: `Use Emma to improve the documentation for parameter ${quote(name)} on command ${quote(command?.name)}.`,
          context: [
            `Command: ${quote(command?.name)}.`,
            `Parameter type: ${quote(parameter?.type || "text/plain")}.`,
          ],
          tasks: [
            "Improve the parameter description and any related synopsis or examples.",
            "Do not change function code unless a clear bug appears.",
          ],
          deliverables: [
            "The full updated command XML plus `save-command`.",
          ],
          writes: shellPersistenceLines("save-command"),
          guardrails: [CARD_WORLD_NOTE],
        }),
      }),
    ]
  );
}

export function makeCommandOutputAI(command, output) {
  const label = output?.name || output?.component || output?.type || "output";
  return ai(
    `Command Output ${quote(label)}`,
    "A declared output contract on a command.",
    [
      `Command: ${quote(command?.name)}.`,
      `Output label: ${quote(label)}.`,
      output?.type ? `Output type: ${quote(output.type)}.` : "Output type is not explicitly set.",
      output?.component ? `Component: ${quote(output.component)}.` : "No component is currently declared.",
    ],
    [
      action({
        id: `command-output-align-${command?.name}-${label}`,
        title: "Align output contract and behavior",
        description: "Make the metadata and implementation say the same thing.",
        agent: "alice",
        effects: commandEffects(),
        draft: prompt({
          lead: `Use Alice to align the output contract of command ${quote(command?.name)}.`,
          context: [
            `Command: ${quote(command?.name)}.`,
            `Output under review: ${quote(label)}.`,
            output?.component ? `Declared component: ${quote(output.component)}.` : "No component is currently declared.",
          ],
          tasks: [
            "Check whether the command's declared outputs still match what the implementation should produce.",
            "If the output should become a richer card or component, update both metadata and implementation.",
            "Keep the command reusable and explicit.",
          ],
          deliverables: [
            "Full updated command XML plus `save-command`.",
          ],
          writes: shellPersistenceLines("save-command"),
          guardrails: [CARD_WORLD_NOTE],
        }),
      }),
    ]
  );
}

export function makeWorkflowCorpusAI(workflows = []) {
  return ai(
    "Workflow Corpus",
    "The one-off programs that compose existing commands into user experiences.",
    [
      `Workflow count: ${workflows.length}.`,
      `Workflow names: ${workflows.map(workflow => quote(workflow.name)).join(", ") || "none"}.`,
    ],
    [
      action({
        id: "workflow-compose-new",
        title: "Compose a new workflow",
        description: "Create a new program from the existing command vocabulary.",
        agent: "betty",
        effects: workflowEffects(),
        draft: prompt({
          lead: "Use Betty to compose a new workflow in the current workflow corpus.",
          context: [
            `Existing workflows: ${workflows.map(workflow => quote(workflow.name)).join(", ") || "none"}.`,
            "Workflows should be concise programs that use commands already in the snapshot.",
          ],
          tasks: [
            "Compose a workflow for the desired programmer experience.",
            "If a required command is missing, stop and clearly name the missing command instead of inventing it.",
            "Keep the workflow short and centered on card-driven output.",
          ],
          deliverables: [
            "Decision.",
            "Full workflow XML plus `save-workflow` if the workflow is viable.",
          ],
          writes: shellPersistenceLines("save-workflow"),
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "workflow goal: [describe the one-off program you want to add]",
          ],
        }),
      }),
      action({
        id: "workflow-lifecycle-pattern",
        title: "Design start, status, and stop workflows",
        description: "Shape a multi-state operational experience with complementary workflows.",
        agent: "betty",
        effects: [write("save-workflow", "success"), write("save-state", "warning")],
        draft: prompt({
          lead: "Use Betty to design a small workflow set for a start, status, and stop style operational experience.",
          context: [
            "A common Neurosymbolic pattern is a branch that starts work on enter, exposes status while descended, and stops or summarizes on exit.",
            `Existing workflows: ${workflows.map(workflow => quote(workflow.name)).join(", ") || "none"}.`,
          ],
          tasks: [
            "Use only existing commands from the snapshot.",
            "Design the minimum workflow set needed for this lifecycle.",
            "If the workflows imply new state hooks, say exactly which state resource should be updated and how.",
          ],
          deliverables: [
            "Any new workflow XML plus `save-workflow`.",
            "Notes for the matching state hooks, and full state XML if you choose to update them too.",
          ],
          writes: [
            "Emit `save-workflow` for the workflows.",
            "Emit `save-state` only if you also provide the exact state-hook changes.",
          ],
          guardrails: [
            "Do not invent missing commands.",
            CARD_WORLD_NOTE,
          ],
          placeholders: [
            "operation: [describe the running task, service, or remote system]",
          ],
        }),
      }),
    ]
  );
}

export function makeWorkflowAI(workflow) {
  const actionUses = workflow.actions?.map(actionItem => actionItem.use).filter(Boolean) || [];
  return ai(
    `Workflow ${quote(workflow.name)}`,
    "A concrete one-off program in the workflow corpus.",
    [
      `Workflow name: ${quote(workflow.name)}.`,
      `Category: ${quote(workflow.category)}.`,
      `Action sequence: ${actionUses.map(use => quote(use)).join(" -> ") || "none"}.`,
      workflow.variables?.length
        ? `Variables: ${workflow.variables.map(variable => quote(variable.name)).join(", ")}.`
        : "No variables are currently declared.",
    ],
    [
      action({
        id: `workflow-improve-${workflow.name}`,
        title: "Improve this workflow",
        description: "Rewrite this sequence so it better serves its exact job.",
        agent: "betty",
        effects: workflowEffects(),
        draft: prompt({
          lead: `Use Betty to improve workflow ${quote(workflow.name)}.`,
          context: [
            `Workflow category: ${quote(workflow.category)}.`,
            `Current actions: ${actionUses.map(use => quote(use)).join(" -> ") || "none"}.`,
          ],
          tasks: [
            "Use only commands that already exist in the snapshot.",
            "Strengthen the sequence so it better supports the target behavior.",
            "Keep the workflow focused and card-driven.",
          ],
          deliverables: [
            "Full updated workflow XML plus `save-workflow`.",
          ],
          writes: shellPersistenceLines("save-workflow"),
          guardrails: [
            "If a needed command is missing, say so and stop.",
            CARD_WORLD_NOTE,
          ],
          placeholders: [
            "workflow refinement: [describe the behavior you want this workflow to gain or change]",
          ],
        }),
      }),
      action({
        id: `workflow-lifecycle-${workflow.name}`,
        title: "Use this workflow in a state lifecycle",
        description: "Attach or adapt this workflow for enter, exit, or resume use.",
        agent: "cindy",
        effects: [write("save-workflow", "success"), write("save-state", "warning")],
        draft: prompt({
          lead: `Use Cindy to adapt workflow ${quote(workflow.name)} for use in a state lifecycle.`,
          context: [
            `Workflow under review: ${quote(workflow.name)}.`,
            `Current actions: ${actionUses.map(use => quote(use)).join(" -> ") || "none"}.`,
            "State lifecycles should use workflows deliberately so traversal feels meaningful.",
          ],
          tasks: [
            "Decide whether this workflow should be used on enter, exit, or resume.",
            "If the workflow needs reshaping to fit that lifecycle moment, update it.",
            "Provide the exact state-hook wiring needed for the chosen lifecycle.",
          ],
          deliverables: [
            "Updated workflow XML if needed.",
            "Exact state XML for the hook placement if you choose to wire it into the state machine.",
          ],
          writes: [
            "Emit `save-workflow` for workflow changes.",
            "Emit `save-state` only if you also provide the exact hook updates.",
          ],
          guardrails: [
            "Do not invent missing commands.",
            CARD_WORLD_NOTE,
          ],
          placeholders: [
            "state path to integrate with: [describe where this workflow should fire]",
          ],
        }),
      }),
    ]
  );
}

export function makeWorkflowVariableAI(workflow, variable) {
  return ai(
    `Workflow Variable ${quote(variable?.name || "variable")}`,
    "A named value inside a workflow.",
    [
      `Workflow: ${quote(workflow?.name)}.`,
      `Variable name: ${quote(variable?.name || "variable")}.`,
      `Current value: ${quote(variable?.value || "")}.`,
    ],
    [
      action({
        id: `workflow-variable-${workflow?.name}-${variable?.name}`,
        title: "Refine this variable",
        description: "Make the workflow's parameterization cleaner and more expressive.",
        agent: "betty",
        effects: workflowEffects(),
        draft: prompt({
          lead: `Use Betty to refine variable ${quote(variable?.name || "variable")} in workflow ${quote(workflow?.name)}.`,
          context: [
            `Workflow: ${quote(workflow?.name)}.`,
            `Current variable value: ${quote(variable?.value || "")}.`,
          ],
          tasks: [
            "Decide whether this variable should be renamed, split, removed, or repurposed.",
            "Keep the workflow concise and easy to understand.",
            "Update the workflow XML accordingly.",
          ],
          deliverables: [
            "Full updated workflow XML plus `save-workflow`.",
          ],
          writes: shellPersistenceLines("save-workflow"),
          guardrails: [
            "Do not invent missing commands.",
            CARD_WORLD_NOTE,
          ],
        }),
      }),
    ]
  );
}

export function makeWorkflowActionAI(workflow, actionNode, index) {
  const label = actionNode?.use || `action-${index + 1}`;
  return ai(
    `Workflow Action ${quote(label)}`,
    "A single command invocation inside a workflow sequence.",
    [
      `Workflow: ${quote(workflow?.name)}.`,
      `Action index: ${index + 1}.`,
      `Command in use: ${quote(actionNode?.use || "unknown")}.`,
      `Current attributes: ${Object.entries(actionNode || {}).map(([name, value]) => `${name}=${value}`).join(" ") || "none"}.`,
    ],
    [
      action({
        id: `workflow-action-${workflow?.name}-${index}`,
        title: "Rewrite this workflow step",
        description: "Replace, retune, or extend this exact action invocation.",
        agent: "betty",
        effects: workflowEffects(),
        draft: prompt({
          lead: `Use Betty to rewrite action ${index + 1} in workflow ${quote(workflow?.name)}.`,
          context: [
            `Workflow: ${quote(workflow?.name)}.`,
            `Current action command: ${quote(actionNode?.use || "unknown")}.`,
            `Current action attributes: ${Object.entries(actionNode || {}).map(([name, value]) => `${name}=${value}`).join(" ") || "none"}.`,
          ],
          tasks: [
            "Improve this exact action call or replace it with a better existing command.",
            "If additional steps are needed before or after it, update the workflow as a whole rather than hacking around the step.",
            "Stop if the needed command does not exist.",
          ],
          deliverables: [
            "Full updated workflow XML plus `save-workflow`.",
          ],
          writes: shellPersistenceLines("save-workflow"),
          guardrails: [
            "Do not invent missing commands.",
            CARD_WORLD_NOTE,
          ],
          placeholders: [
            "step change: [describe what should be different about this stage of the workflow]",
          ],
        }),
      }),
    ]
  );
}

export function makeInterfaceCollectionAI(resources = []) {
  return ai(
    "Interface Panels",
    "Reusable panel definitions that mounted screens can reference.",
    [
      `Panel count: ${resources.length}.`,
      `Panel names: ${resources.map(resource => quote(resource.name || resource.tag)).join(", ") || "none"}.`,
    ],
    [
      action({
        id: "interface-design",
        title: "Design a new rich-card panel",
        description: "Plan a reusable panel that supports a programmer workflow.",
        agent: "cindy",
        effects: [write("panel patch", "danger"), write("save-screen", "info"), write("save-state", "warning")],
        draft: prompt({
          lead: "Use Cindy to design a new reusable interface panel for Neurosymbolic.",
          context: [
            `Existing panels: ${resources.map(resource => quote(resource.name || resource.tag)).join(", ") || "none"}.`,
            "Interface panels are the right place for reusable rich-card structures that multiple screens may reference.",
          ],
          tasks: [
            "Design a panel that serves a concrete programmer-facing need.",
            "If the panel should be wired into a mounted screen resource or a state journey, include that surrounding work.",
            "If the panel definition itself must change, provide a precise patch because panel persistence is not mounted separately yet.",
          ],
          deliverables: [
            "The panel patch or XML fragment.",
            "Any matching screen or state resource changes needed to actually use it.",
          ],
          writes: [
            "Provide a reviewable patch for `Interfaces` changes.",
            "Use `save-screen` and `save-state` for any mounted resource changes that consume the new panel.",
          ],
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "panel purpose: [describe the card or surface this panel should represent]",
          ],
        }),
      }),
    ]
  );
}

export function makeInterfaceAI(resource) {
  const name = resource?.name || resource?.tag || "panel";
  return ai(
    `Interface Panel ${quote(name)}`,
    "A reusable panel definition that screen resources can reference.",
    [
      `Panel name: ${quote(name)}.`,
      `Root tag: ${quote(resource?.tag || "Panel")}.`,
    ],
    [
      action({
        id: `interface-panel-redesign-${name}`,
        title: "Redesign this panel",
        description: "Refine the reusable card surface behind this panel.",
        agent: "cindy",
        effects: [write("panel patch", "danger"), write("save-screen", "info")],
        draft: prompt({
          lead: `Use Cindy to redesign interface panel ${quote(name)}.`,
          context: [
            `Panel name: ${quote(name)}.`,
            "Panel definitions are reusable and may need a precise patch rather than a mounted-resource OsCall.",
          ],
          tasks: [
            "Redesign the panel so it better supports the intended programmer workflow.",
            "If the redesign also requires changes to the mounted screen resources that reference this panel, include them.",
            "Keep the result card-driven and purposeful.",
          ],
          deliverables: [
            "A reviewable panel patch or XML replacement.",
            "Any mounted screen resource updates needed to consume the new panel.",
          ],
          writes: [
            "Provide a reviewable patch for the panel definition.",
            "Use `save-screen` for any mounted screen resource changes that reference the panel.",
          ],
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "panel redesign goal: [describe the new behavior or visual structure you want]",
          ],
        }),
      }),
    ]
  );
}

export function makeComponentCollectionAI(components = []) {
  return ai(
    "Web Components",
    "The browser-level component vocabulary behind the declarative shell.",
    [
      `Registered components: ${components.map(component => quote(component.tag || component.name)).join(", ") || "none"}.`,
      "Component changes require JS patches rather than mounted XML saves.",
    ],
    [
      action({
        id: "component-missing",
        title: "What component is missing?",
        description: "Ask what new component would most improve the card-driven OS.",
        agent: "sophia",
        effects: componentPatchEffects(),
        draft: prompt({
          lead: "Use Sophia to identify which missing web component would most improve Neurosymbolic right now.",
          context: [
            `Current components: ${components.map(component => quote(component.tag || component.name)).join(", ") || "none"}.`,
            "Components should be added only when screen XML and panels are no longer expressive enough on their own.",
          ],
          tasks: [
            "Audit the current component vocabulary.",
            "Identify the single most justified missing component for rich-card, state-driven programmer workflows.",
            "If a new component is warranted, provide the exact JS, registration, and README patch plan.",
          ],
          deliverables: [
            "Decision with rationale.",
            "If justified, a reviewable component patch plan.",
          ],
          writes: [
            "Provide reviewable JavaScript and README patches rather than OsCalls.",
          ],
          guardrails: [CARD_WORLD_NOTE],
        }),
      }),
    ]
  );
}

export function makeComponentAI(component) {
  return ai(
    `Component ${quote(component?.tag || component?.name || "component")}`,
    "A registered browser component used by the declarative shell.",
    [
      `Component name: ${quote(component?.name || "component")}.`,
      `Custom element tag: ${quote(component?.tag || "x-component")}.`,
    ],
    [
      action({
        id: `component-extend-${component?.name || component?.tag}`,
        title: "Extend this component",
        description: "Plan a targeted JS patch for this exact component.",
        agent: "cindy",
        effects: componentPatchEffects(),
        draft: prompt({
          lead: `Use Cindy to extend component ${quote(component?.tag || component?.name || "component")}.`,
          context: [
            `Component name: ${quote(component?.name || "component")}.`,
            `Tag: ${quote(component?.tag || "x-component")}.`,
            "Component changes must be expressed as reviewable JavaScript patches.",
          ],
          tasks: [
            "Add the minimum new behavior or presentation needed for the goal.",
            "Preserve the declarative-first shell style.",
            "Provide the exact JS and README patch required.",
          ],
          deliverables: [
            "A reviewable component patch.",
            "Any matching screen or panel usage updates if the new capability should be wired in immediately.",
          ],
          writes: [
            "Provide a JS patch for the component implementation and registration if needed.",
            "Provide a README patch if the component contract changes.",
          ],
          guardrails: [CARD_WORLD_NOTE],
          placeholders: [
            "component enhancement: [describe what this component should gain]",
          ],
        }),
      }),
    ]
  );
}
