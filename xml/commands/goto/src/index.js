export async function main({ to, text = "Continue", color = "secondary" }, context) {
  const button = document.createElement("x-button");
  button.setAttribute("text", text);
  button.setAttribute("color", color);
  button.setAttribute("to", to);
  context.chat.print(button);
}
