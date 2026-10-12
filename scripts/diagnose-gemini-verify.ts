// Temporary: finds which part of the visual-check request Gemini rejects. Delete after use.
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CONFIG, verificationInstruction } from '../playground/providers.ts';
const key = process.env.GEMINI_API_KEY;
if (!key) { console.error('Set GEMINI_API_KEY first.'); process.exit(1); }
const client = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 90000, retryOptions: { attempts: 1 } } });
const Verdict = z.object({
  requirements: z.array(z.string().min(1).max(500)).min(1).max(16),
  results: z.array(z.object({ id: z.string(), checks: z.array(z.object({ status: z.enum(['pass','fail','uncertain']), evidence: z.string().min(1).max(500) })).min(1).max(16) })).min(1).max(12),
});
const full = z.toJSONSchema(Verdict) as any;
const strip = (s: any): any => Array.isArray(s) ? s.map(strip) : s && typeof s === 'object' ? Object.fromEntries(Object.entries(s).filter(([k]) => !['$schema','minLength','maxLength'].includes(k)).map(([k,v]) => [k, strip(v)])) : s;
const dir = resolve(import.meta.dirname, '../sample-dataset');
const ids = (await readdir(dir)).filter(n => /^[a-f0-9]{64}\.jpg$/.test(n)).slice(0, 13);
const images = await Promise.all(ids.map(async n => ({ id: n.slice(0, 16), bytes: await readFile(resolve(dir, n)) })));
async function attempt(label: string, count: number, schema: any, maxOutputTokens = 12000) {
  const parts: any[] = [{ text: JSON.stringify({ searchQuery: 'a baby' }) }];
  for (const p of images.slice(0, count)) parts.push({ text: `Image ID: ${p.id}` }, { inlineData: { mimeType: 'image/jpeg', data: p.bytes.toString('base64') } });
  try {
    await client.models.generateContent({ model: CONFIG.gemini.vision, contents: [{ role: 'user', parts }], config: { systemInstruction: verificationInstruction, responseMimeType: 'application/json', ...(schema ? { responseJsonSchema: schema } : {}), maxOutputTokens } });
    console.log(`OK    ${label}`);
  } catch (e) { console.log(`FAIL  ${label}: ${String((e as Error).message).slice(0, 300)}`); }
}
await attempt('1 image, current schema', 1, full);
await attempt('1 image, schema without length limits', 1, strip(full));
await attempt('1 image, no schema', 1, null);
await attempt('1 image, current schema, 2000 output tokens', 1, full, 2000);
await attempt(`${images.length} images, no schema`, images.length, null);
