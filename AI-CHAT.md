# AI Route

## POST /api/ai

Proxies a chat-completions request to the local inference server.

**Configuration** (via environment or `ecosystem.json`):
- `AI_URL` — inference server base URL (default: `http://localhost:8080`)
- `AI_MODEL` — fallback model if `model` is omitted from the request (default: `local-model`)

**Request**

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `messages` | array of `{role, content}` | yes | — |
| `model` | string | no | `AI_MODEL` env var |
| `temperature` | number | no | `0.7` |
| `max_tokens` | number | no | `1024` |
| `stream` | boolean | no | `false` |

```json
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user",   "content": "What is the capital of France?" }
  ]
}
```

**Response** — raw OpenAI-compatible completion object:
```json
{
  "choices": [
    { "message": { "role": "assistant", "content": "Paris." } }
  ]
}
```

**Errors**

| Status | Meaning |
|--------|---------|
| 400 | `messages` array missing or empty |
| 502 | Inference server returned an error |
| 500 | Network or unexpected error |

---

## Fetch example

```js
const res = await fetch('/api/ai', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user',   content: 'Hello!' },
    ],
  }),
});
const data = await res.json();
const reply = data.choices[0].message.content;
```

Because `index.html` is served from the same origin as the API, no CORS configuration is needed.
