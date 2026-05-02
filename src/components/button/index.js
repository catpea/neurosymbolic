import { ReactiveHTMLElement } from "@/core/reactive.js";

export class ButtonElement extends ReactiveHTMLElement {
  static observedAttributes = ["text", "color", "to", "icon", "target", "toggle"];

  constructor() {
    super();
    this.signal("text", "Continue");
    this.signal("color", "secondary");
    this.signal("to", "");
    this.signal("icon", "");
    this.signal("target", "");
    this.signal("toggle", "");
  }

  mount() {
    this.className = "d-inline-block";

    const button = document.createElement("button");
    button.type = "button";
    this.append(button);

    this.concern.effect(["text", "color", "icon", "target", "toggle"], (text, color, icon, target, toggle) => {
      button.className = `btn btn-${color || "secondary"}`;
      button.replaceChildren();

      if (toggle) {
        button.dataset.bsToggle = toggle;
      } else {
        delete button.dataset.bsToggle;
      }

      if (target) {
        button.dataset.bsTarget = target;
      } else {
        delete button.dataset.bsTarget;
      }

      if (icon) {
        const node = document.createElement("i");
        node.className = `bi ${icon} me-2`;
        button.append(node);
      }

      button.append(document.createTextNode(text || "Continue"));
    });
  }
}
