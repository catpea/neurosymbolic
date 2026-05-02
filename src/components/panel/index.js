import { ReactiveHTMLElement } from "@/core/reactive.js";

export class PanelElement extends ReactiveHTMLElement {
  mount() {
    this.className = "card shadow-sm border-secondary-subtle";

    const body = document.createElement("div");
    body.className = "card-body";

    while (this.firstChild) body.append(this.firstChild);
    this.append(body);
  }
}
