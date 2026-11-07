import { db, type AiMessage } from '../db';
import type { Chapter, Title } from '../types';
import { uid } from '../util';

/**
 * Provider-independent AI client.
 *
 * Two transport options, neither of which puts a secret key in the client:
 *  1. "cloud": the Supabase edge function `ai-assistant` (holds the provider key,
 *     authenticates the user, applies daily limits).
 *  2. "openai-compatible": a keyless endpoint the user runs themselves
 *     (e.g. Ollama at http://localhost:11434/v1, LM Studio).
 *
 * The spoiler guard is enforced on both sides: the client only ever sends
 * context for chapters ≤ the user's current chapter, and the system prompt
 * instructs the model not to reveal later events unless spoilers are enabled.
 */

export type AiTask = 'chat' | 'summarize' | 'explain_scene' | 'characters' | 'relationships' | 'timeline' | 'terms' | 'explain_page';

export const AI_TASKS: { id: AiTask; label: string; prompt: string }[] = [
  { id: 'summarize', label: 'Summarize this chapter', prompt: 'Summarize what has happened in the chapter I am reading.' },
  { id: 'explain_scene', label: 'Explain a confusing scene', prompt: 'Explain the scene I am on — what is happening and why?' },
  { id: 'characters', label: 'Character motivations', prompt: 'Explain the motivations of the main characters so far.' },
  { id: 'relationships', label: 'Relationship map', prompt: 'Describe the relationships between the main characters so far.' },
  { id: 'timeline', label: 'Story timeline', prompt: 'Give me a short timeline of the major events so far.' },
  { id: 'terms', label: 'Explain terminology', prompt: 'Explain any unfamiliar terms, places, powers or titles that have appeared so far.' },
];

export interface AiConfig {
  transport: 'cloud' | 'openai-compatible' | 'off';
  endpoint: string; // for openai-compatible
  model: string; // for openai-compatible
  allowSpoilers: boolean;
}

export interface AiContext {
  title: Title;
  chapter?: Chapter;
  chapterIndex?: number;
  totalChapters?: number;
  page?: number;
  pageCount?: number;
  /** Optional image the user chose to share (data URL of the current page) */
  image?: string;
}

export function spoilerBoundary(ctx: AiContext): string {
  if (!ctx.chapter) return 'The reader has not started this title yet. Treat everything beyond the premise as a spoiler.';
  const num = ctx.chapter.number >= 0 ? `chapter ${ctx.chapter.number}` : `"${ctx.chapter.name}"`;
  return `The reader is currently on ${num}${ctx.page !== undefined ? `, page ${ctx.page + 1}${ctx.pageCount ? ` of ${ctx.pageCount}` : ''}` : ''}.`;
}

export function buildSystemPrompt(ctx: AiContext, allowSpoilers: boolean): string {
  const t = ctx.title;
  return [
    'You are the Furina Reader reading companion: warm, concise, and precise. Use short paragraphs.',
    `Work: "${t.title}"${t.altTitles.length ? ` (also known as ${t.altTitles.slice(0, 3).join(', ')})` : ''}.`,
    t.authors.length ? `Author(s): ${t.authors.join(', ')}.` : '',
    t.genres.length ? `Genres: ${t.genres.join(', ')}.` : '',
    t.description ? `Publisher synopsis: ${t.description.slice(0, 1200)}` : '',
    spoilerBoundary(ctx),
    allowSpoilers
      ? 'The reader has ENABLED spoilers: you may discuss later events, but warn briefly before major reveals.'
      : 'SPOILER RULE (strict): never reveal, hint at or confirm anything that happens after the reader\'s current position — no future deaths, twists, identities, romances, power-ups or endings. If a question can only be answered with spoilers, say so and offer a spoiler-free answer instead. If unsure whether something happens later, treat it as a spoiler.',
    'If you are not confident about details of this specific work, say so rather than inventing plot points. When the reader shares a page image, base your answer on what is visible.',
  ]
    .filter(Boolean)
    .join('\n');
}

export const threadKey = (ctx: Pick<AiContext, 'title' | 'chapter'>) => `${ctx.title.id}:${ctx.chapter?.id ?? 'none'}`;

export async function loadThread(key: string): Promise<AiMessage[]> {
  return (await (await db()).getAllFromIndex('ai', 'byThread', key)).sort((a, b) => a.at - b.at);
}

export async function clearThread(key: string) {
  const d = await db();
  for (const m of await d.getAllFromIndex('ai', 'byThread', key)) await d.delete('ai', m.id);
}

export class AiUnavailableError extends Error {}

interface SendArgs {
  config: AiConfig;
  ctx: AiContext;
  question: string;
  task: AiTask;
  history: AiMessage[];
  cloud?: { url: string; accessToken?: string; anonKey?: string };
  signal?: AbortSignal;
  onToken?: (text: string) => void;
}

export async function ask(a: SendArgs): Promise<AiMessage> {
  const q = a.question.trim().slice(0, 4000);
  if (!q) throw new Error('Type a question first.');
  if (a.config.transport === 'off') throw new AiUnavailableError('The AI assistant is turned off in Settings → AI.');
  const key = threadKey(a.ctx);
  const d = await db();
  const userMsg: AiMessage = { id: uid(), threadKey: key, role: 'user', content: q, at: Date.now(), chapterNumber: a.ctx.chapter?.number };
  await d.put('ai', userMsg);

  const system = buildSystemPrompt(a.ctx, a.config.allowSpoilers);
  // Only last 12 turns, and never turns from a later chapter than the current one (spoiler guard).
  const cur = a.ctx.chapter?.number ?? Infinity;
  const past = a.history.filter((m) => a.config.allowSpoilers || (m.chapterNumber ?? -1) <= cur).slice(-12).map((m) => ({ role: m.role, content: m.content }));
  const messages = [...past, { role: 'user' as const, content: q }];

  let text = '';
  if (a.config.transport === 'cloud') {
    if (!a.cloud?.url) throw new AiUnavailableError('Cloud AI is not configured. Add Supabase settings (see .env.example) or use a local endpoint in Settings → AI.');
    if (!a.cloud.accessToken) throw new AiUnavailableError('Sign in to use the cloud AI assistant.');
    const res = await fetch(a.cloud.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.cloud.accessToken}`, ...(a.cloud.anonKey ? { apikey: a.cloud.anonKey } : {}) },
      body: JSON.stringify({ system, messages, task: a.task, image: a.ctx.image, allowSpoilers: a.config.allowSpoilers }),
      signal: a.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 429) throw new Error(json.error ?? 'Daily AI limit reached. It resets at midnight UTC.');
    if (!res.ok) throw new Error(json.error ?? `AI service error (${res.status})`);
    text = String(json.text ?? '');
    a.onToken?.(text);
  } else {
    const base = a.config.endpoint.replace(/\/+$/, '');
    if (!base) throw new AiUnavailableError('Set your local AI endpoint in Settings → AI.');
    const userContent = a.ctx.image
      ? [{ type: 'text', text: q }, { type: 'image_url', image_url: { url: a.ctx.image } }]
      : q;
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: a.config.model || 'llama3.2',
        stream: true,
        messages: [{ role: 'system', content: system }, ...past, { role: 'user', content: userContent }],
      }),
      signal: a.signal,
    }).catch(() => {
      throw new Error(`Could not reach ${base}. Is your local AI server running and allowing this origin (CORS)?`);
    });
    if (!res.ok) throw new Error(`AI endpoint error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const l = line.trim();
        if (!l.startsWith('data:')) continue;
        const data = l.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (delta) {
            text += delta;
            a.onToken?.(text);
          }
        } catch {
          /* keep-alive or partial line */
        }
      }
    }
  }
  if (!text.trim()) throw new Error('The AI returned an empty answer.');
  const reply: AiMessage = { id: uid(), threadKey: key, role: 'assistant', content: text.trim(), at: Date.now(), chapterNumber: a.ctx.chapter?.number };
  await d.put('ai', reply);
  return reply;
}
