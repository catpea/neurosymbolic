const promptCache = new Map();

async function readPrompt(url) {
  const key = String(url);

  if (!promptCache.has(key)) {
    promptCache.set(key, (async () => {
      const response = await fetch(key);
      if (!response.ok) throw new Error(`Failed to fetch prompt ${key}: ${response.status}`);

      const text = (await response.text()).trim();
      if (!text) throw new Error(`Prompt is empty: ${key}`);
      return text;
    })());
  }

  return promptCache.get(key);
}

async function readFirstPrompt(urls) {
  let lastError;

  for (const url of urls) {
    try {
      return await readPrompt(url);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("No prompt files configured.");
}

export function loadWebMcpPrompt() {
  return readPrompt(new URL("../prompts/webmcp.md", import.meta.url));
}

export function loadSoulPrompt() {
  return readFirstPrompt([
    new URL("../prompts/soul.md", import.meta.url),
    new URL("../prompst/soul.md", import.meta.url)
  ]);
}
