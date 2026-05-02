export async function main({ url, expectStatus, expectContains, expectJsonPath, expectJsonValue }, context) {
  let ok = true;
  let message = `${url} — `;
  try {
    const res = await context.fetch(url);
    const text = await res.text();

    if (expectStatus && String(res.status) !== String(expectStatus)) {
      throw new Error(`status ${res.status}, expected ${expectStatus}`);
    }

    if (expectContains && !text.includes(expectContains)) {
      throw new Error(`body does not contain "${expectContains}"`);
    }

    if (expectJsonPath) {
      const json = JSON.parse(text);
      const val = expectJsonPath.split('.').reduce((o, k) => o?.[k], json);
      if (expectJsonValue && String(val) !== String(expectJsonValue)) {
        throw new Error(`${expectJsonPath} = "${val}", expected "${expectJsonValue}"`);
      }
    }

    message += 'OK';
  } catch (e) {
    ok = false;
    message += e.message;
  }

  const node = document.createElement('x-alert');
  node.setAttribute('text', message);
  node.setAttribute('color', ok ? 'success' : 'danger');
  context.chat.print(node);
}
