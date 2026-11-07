// Supabase Edge Function: ai-assistant
// Holds the AI provider key server-side, authenticates the caller, applies a
// per-user daily quota and forwards a spoiler-guarded prompt to the provider.
//
// Secrets:  AI_PROVIDER=anthropic|openai   AI_MODEL=<model id>   AI_DAILY_LIMIT=50
//           ANTHROPIC_API_KEY=...   or   OPENAI_API_KEY=... [OPENAI_BASE_URL=...]
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SPOILER_GUARD =
  'Never reveal events beyond the reader\'s stated position unless the system prompt says spoilers are enabled.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service);
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Sign in required' });
  const { data: u, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !u.user) return json(401, { error: 'Invalid session' });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }
  const system = String(body.system ?? '').slice(0, 6000);
  const messages = Array.isArray(body.messages) ? body.messages.slice(-13) : [];
  const valid = messages.every((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length <= 8000);
  if (!system || !messages.length || !valid) return json(400, { error: 'Invalid request' });
  const image = typeof body.image === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(body.image) && body.image.length < 6_000_000 ? body.image : undefined;

  const limit = Number(Deno.env.get('AI_DAILY_LIMIT') ?? 50);
  const { data: left, error: qErr } = await admin.rpc('ai_take_quota', { p_user: u.user.id, p_limit: limit });
  if (qErr) return json(500, { error: 'Quota check failed' });
  if (left < 0) return json(429, { error: `Daily limit of ${limit} AI requests reached. It resets at 00:00 UTC.` });

  const provider = Deno.env.get('AI_PROVIDER') ?? 'anthropic';
  const model = Deno.env.get('AI_MODEL') ?? (provider === 'anthropic' ? 'claude-sonnet-5-5' : 'gpt-4o-mini');
  const sys = `${system}\n${SPOILER_GUARD}`;

  try {
    let text = '';
    if (provider === 'anthropic') {
      const key = Deno.env.get('ANTHROPIC_API_KEY');
      if (!key) return json(503, { error: 'AI provider is not configured' });
      const msgs = messages.map((m: any) => ({ role: m.role, content: m.content }));
      if (image) {
        const [, mt, data] = image.match(/^data:(image\/\w+);base64,(.*)$/)!;
        const last = msgs[msgs.length - 1];
        last.content = [{ type: 'image', source: { type: 'base64', media_type: mt, data } }, { type: 'text', text: last.content }];
      }
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 1024, system: sys, messages: msgs }),
      });
      const j = await r.json();
      if (!r.ok) return json(502, { error: j?.error?.message ?? `Provider error ${r.status}` });
      text = (j.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    } else {
      const key = Deno.env.get('OPENAI_API_KEY');
      if (!key) return json(503, { error: 'AI provider is not configured' });
      const base = (Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
      const msgs: any[] = [{ role: 'system', content: sys }, ...messages];
      if (image) {
        const last = msgs[msgs.length - 1];
        last.content = [{ type: 'text', text: last.content }, { type: 'image_url', image_url: { url: image } }];
      }
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 1024, messages: msgs }),
      });
      const j = await r.json();
      if (!r.ok) return json(502, { error: j?.error?.message ?? `Provider error ${r.status}` });
      text = j.choices?.[0]?.message?.content ?? '';
    }
    return json(200, { text, remaining: left });
  } catch (e) {
    console.error(e);
    return json(502, { error: 'The AI provider could not be reached.' });
  }
});
