import { ReactiveHTMLElement } from "@/core/reactive.js";

export class CommandListElement extends ReactiveHTMLElement {
  mount() {
    const os = document.querySelector("x-os");
    const commands = os?.commands() ?? [];

    this.className = "container-fluid py-3";
    this.replaceChildren();

    const row = document.createElement("div");
    row.className = "row g-3";

    for (const command of commands) {
      const col = document.createElement("div");
      col.className = "col-12 col-md-6 col-xl-4";

      const card = document.createElement("div");
      card.className = "card h-100 border-secondary-subtle";

      const body = document.createElement("div");
      body.className = "card-body";

      const title = document.createElement("h5");
      title.className = "card-title";
      title.textContent = command.title;

      const path = document.createElement("div");
      path.className = "font-monospace small text-body-secondary mb-2";
      path.textContent = command.path;

      const category = document.createElement("span");
      category.className = "badge text-bg-secondary mb-3";
      category.textContent = command.category;

      const description = document.createElement("p");
      description.className = "card-text";
      description.textContent = command.description;

      body.append(title, path, category, description);
      card.append(body);
      col.append(card);
      row.append(col);
    }

    this.append(row);
  }
}
