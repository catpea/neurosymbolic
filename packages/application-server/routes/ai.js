/**
 * routes/ai.js — General-purpose AI gateway.
 *
 * POST /api/ai
 *   Proxies a chat-completions request to the configured inference server.
 *   The client supplies all messages, system prompt, and generation params.
 *
 * Environment variables:
 *   AI_URL   — base URL for the inference server (default: http://localhost:8080)
 *   AI_MODEL — fallback model name if the request omits "model" (default: local-model)
 */

const AI_URL   = process.env.AI_URL   ?? 'http://localhost:8080';
const AI_MODEL = process.env.AI_MODEL ?? 'local-model';

export function registerAIRoute(app) {
  app.post('/api/ai', async (req, res) => {
    const { messages, model, temperature, max_tokens, stream } = req.body ?? {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' });
    }

    try {
      const aiRes = await fetch(`${AI_URL}/v1/chat/completions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:       model       ?? AI_MODEL,
          messages,
          temperature: temperature ?? 0.7,
          max_tokens:  max_tokens  ?? 1024,
          stream:      stream      ?? false,
        }),
      });

      if (!aiRes.ok) {
        const detail = await aiRes.text().catch(() => '');
        return res.status(502).json({ error: `AI server error ${aiRes.status}`, detail });
      }

      const data = await aiRes.json();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
