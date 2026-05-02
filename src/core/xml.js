export function attrs(node) {
  return Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value]));
}

export function cssEscape(value) {
  return String(value).replaceAll('"', '\\"');
}
