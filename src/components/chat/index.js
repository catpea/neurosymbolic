import { ReactiveHTMLElement } from "@/core/reactive.js";

export class ChatElement extends ReactiveHTMLElement {
  static observedAttributes = ["name"];

  constructor() {
    super();
    this.signal("name", "chat");
  }

  mount() {
    this.className = "vstack gap-2";
  }

  clear() {
    this.replaceChildren();
  }

  print(node) {
    this.append(node);
  }
}
