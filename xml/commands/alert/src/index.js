export async function main({ text = "", color = "primary" }, context) {
  const node = document.createElement("x-alert");
  node.setAttribute("text", text);
  node.setAttribute("color", color);
  context.chat.print(node);
}
