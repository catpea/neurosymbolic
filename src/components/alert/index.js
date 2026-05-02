import { ReactiveHTMLElement } from "@/core/reactive.js";

export class AlertElement extends ReactiveHTMLElement {
  static observedAttributes = ["color", "text"];

  constructor() {
    super();
    this.signal("color", "primary");
    this.signal("text", "");
  }

  mount() {
    this.setAttribute("role", "alert");

    this.subscribe("color", color => {
      this.className = `alert alert-${color || "primary"}`;
    });

    this.concern.bindText("text", this);
  }
}
