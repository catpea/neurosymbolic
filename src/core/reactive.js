const hasValue = value => value !== null && value !== undefined;

function disposeOne(item) {
  if (!item) return;
  if (typeof item === "function") return item();
  if (typeof item.dispose === "function") return item.dispose();
  if (typeof item[Symbol.dispose] === "function") return item[Symbol.dispose]();
}

export class Scope {
  #items = [];
  #disposed = false;

  get disposed() {
    return this.#disposed;
  }

  collect(...items) {
    const flat = items.flat(Infinity).filter(Boolean);

    if (this.#disposed) {
      for (let i = flat.length - 1; i >= 0; i--) disposeOne(flat[i]);
      return this;
    }

    this.#items.push(...flat);
    return this;
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;

    const items = this.#items.splice(0);
    for (let i = items.length - 1; i >= 0; i--) disposeOne(items[i]);
  }
}

export class Signal {
  #value;
  #subscribers = new Set();

  constructor(value) {
    if (hasValue(value)) this.#value = value;
  }

  get value() {
    return this.#value;
  }

  set value(next) {
    this.set(next);
  }

  get hasValue() {
    return hasValue(this.#value);
  }

  set(next) {
    if (!hasValue(next)) return false;
    if (Object.is(next, this.#value)) return false;

    this.#value = next;
    this.notify();
    return true;
  }

  subscribe(fn) {
    this.#subscribers.add(fn);
    if (this.hasValue) fn(this.#value);
    return () => this.#subscribers.delete(fn);
  }

  notify() {
    if (!this.hasValue) return;
    for (const fn of [...this.#subscribers]) fn(this.#value);
  }
}

export class Concern extends Scope {
  #signals = new Map();

  signal(name, value) {
    if (value instanceof Signal) {
      this.#signals.set(name, value);
      return value;
    }

    let signal = this.#signals.get(name);

    if (!signal) {
      signal = new Signal(value);
      this.#signals.set(name, signal);
      return signal;
    }

    if (arguments.length > 1) signal.value = value;
    return signal;
  }

  resolve(source) {
    return source instanceof Signal ? source : this.signal(source);
  }

  subscribe(source, fn) {
    const unsubscribe = this.resolve(source).subscribe(fn);
    this.collect(unsubscribe);
    return unsubscribe;
  }

  effect(sources, fn) {
    const input = (Array.isArray(sources) ? sources : [sources]).map(source => this.resolve(source));
    let wiring = true;

    const run = () => {
      if (wiring) return;
      const values = input.map(signal => signal.value);
      if (values.every(hasValue)) fn(...values);
    };

    for (const signal of input) this.collect(signal.subscribe(run));
    wiring = false;
    run();
    return this;
  }

  attribute(name, value) {
    if (hasValue(value)) this.signal(name).value = value;
    return this.signal(name);
  }

  attributes(element, names = element.constructor.observedAttributes ?? []) {
    for (const name of names) this.signal(name);
    return this;
  }

  hydrateAttributes(element, names = element.constructor.observedAttributes ?? []) {
    for (const name of names) {
      if (element.hasAttribute(name)) this.attribute(name, element.getAttribute(name));
    }
    return this;
  }

  on(target, eventName, handler, options) {
    target.addEventListener(eventName, handler, options);
    this.collect(() => target.removeEventListener(eventName, handler, options));
    return this;
  }

  bindText(source, node) {
    this.subscribe(source, value => {
      const next = String(value);
      if (node.textContent !== next) node.textContent = next;
    });
    return this;
  }

  bindValue(source, element) {
    const signal = this.resolve(source);

    this.subscribe(signal, value => {
      const next = String(value);
      if (element.value !== next) element.value = next;
    });

    this.on(element, "input", () => {
      signal.value = element.value;
    });

    return this;
  }

  dispose() {
    if (this.disposed) return;
    super.dispose();
    this.#signals.clear();
  }
}

export class ReactiveHTMLElement extends HTMLElement {
  #mounted = false;

  constructor() {
    super();
    this.concern = new Concern();
    this.concern.attributes(this);
  }

  connectedCallback() {
    if (this.#mounted) return;
    this.#mounted = true;
    this.concern.hydrateAttributes(this);
    this.mount?.();
  }

  disconnectedCallback() {
    this.concern.dispose();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (Object.is(oldValue, newValue)) return;
    this.concern.attribute(name, newValue);
  }

  signal(name, value) {
    return this.concern.signal(name, value);
  }

  subscribe(source, fn) {
    return this.concern.subscribe(source, fn);
  }
}
