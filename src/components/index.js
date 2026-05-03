import { AIChatElement } from "@/components/ai-chat/index.js";
import { AlertElement } from "@/components/alert/index.js";
import { ButtonElement } from "@/components/button/index.js";
import { ChatElement } from "@/components/chat/index.js";
import { CommandListElement } from "@/components/command-list/index.js";
import { NodeActionCenterElement } from "@/components/node-action-center/index.js";
import { PanelElement } from "@/components/panel/index.js";
import { SystemDashboardElement } from "@/components/system-dashboard/index.js";
import { TreeUIElement } from "@/components/tree-ui/index.js";

function defineElement(name, constructor) {
  if (!customElements.get(name)) customElements.define(name, constructor);
}

export function registerElements() {
  defineElement("x-alert", AlertElement);
  defineElement("x-button", ButtonElement);
  defineElement("x-chat", ChatElement);
  defineElement("x-panel", PanelElement);
  defineElement("x-ai-chat", AIChatElement);
  defineElement("x-command-list", CommandListElement);
  defineElement("x-node-action-center", NodeActionCenterElement);
  defineElement("x-system-dashboard", SystemDashboardElement);
  defineElement("x-tree-ui", TreeUIElement);
}
