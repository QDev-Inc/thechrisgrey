export const MODEL_ID = '@cf/mistralai/mistral-small-3.1-24b-instruct';
const MAX_BYTES = 262144;
const encoder = new TextEncoder();

/** @param {string} supplied @param {string} expected */
async function authenticate(supplied, expected) {
  if (!supplied || supplied.length > 256 || !expected || expected.length < 32) return false;
  const algorithm = { name: 'HMAC', hash: 'SHA-256' };
  const signingKey = await crypto.subtle.importKey('raw', encoder.encode(supplied), algorithm, false, ['sign']);
  const verifyingKey = await crypto.subtle.importKey('raw', encoder.encode(expected), algorithm, false, ['verify']);
  const data = encoder.encode('thechrisgrey-inference');
  return crypto.subtle.verify('HMAC', verifyingKey, await crypto.subtle.sign('HMAC', signingKey, data), data);
}

/** @param {Request} request */
async function readBody(request) {
  if (!request.body) throw new Error('empty');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('size');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally {
    await reader.cancel();
  }
}

/** @param {unknown} body @param {number} [status] */
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

export default {
  /**
   * @param {Request} request
   * @param {{ GATEWAY_KEY: string, AI: { run: (model: string, input: any) => Promise<any> }, LIMITER: { limit: (options: { key: string }) => Promise<{ success: boolean }> } }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'inference' });
    if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') return json({ error: 'Not found' }, 404);
    if (!(await authenticate(request.headers.get('Authorization')?.replace(/^Bearer /, '') || '', env.GATEWAY_KEY)))
      return json({ error: 'Unauthorized' }, 401);
    if (!env.AI || !env.LIMITER) return json({ error: 'Service unavailable' }, 503);
    let body;
    try {
      body = await readBody(request);
    } catch {
      return json({ error: 'Invalid request' }, 400);
    }
    if (
      !body ||
      body.model !== MODEL_ID ||
      !Array.isArray(body.messages) ||
      !body.messages.length ||
      body.messages.length > 150 ||
      body.stream ||
      !Number.isInteger(body.max_tokens) ||
      body.max_tokens < 1 ||
      body.max_tokens > 8192 ||
      (body.tools && (!Array.isArray(body.tools) || body.tools.length > 40))
    )
      return json({ error: 'Invalid request' }, 400);
    try {
      if (!(await env.LIMITER.limit({ key: 'inference' })).success) return json({ error: 'Rate limit exceeded' }, 429);
      const result = await env.AI.run(MODEL_ID, {
        messages: body.messages,
        max_tokens: body.max_tokens,
        temperature: typeof body.temperature === 'number' ? Math.max(0, Math.min(1, body.temperature)) : 0.3,
        ...(body.tools?.length ? { tools: body.tools, tool_choice: body.tool_choice || 'auto' } : {}),
        stream: false,
      });
      if (!result?.choices?.[0]?.message) return json({ error: 'Invalid model response' }, 502);
      return json({ choices: result.choices, usage: result.usage });
    } catch {
      return json({ error: 'Inference unavailable' }, 503);
    }
  },
};
