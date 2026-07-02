// News analysis: per-headline good/bad sentiment for a ticker, plus
// "pivot" detection — headlines that confirm or threaten one of the user's
// written thesis points. One batched LLM call per (headlines, points) set,
// cached in SQLite so repeat loads are free.
import { createHash } from 'node:crypto';
import { cacheGet, cacheSet } from './db.js';
import { completeText, hasKey } from './anthropic.js';

const HOUR = 3600_000;

export async function analyzeNews({ sym, heads = [], points = [], context = 'stock' }) {
  if (!hasKey()) {
    const err = new Error('no key');
    err.code = 'NO_KEY';
    throw err;
  }
  heads = heads.slice(0, 10).map(h => String(h).slice(0, 160));
  points = points.slice(0, 12).map(p => ({ id: String(p.id), side: p.side === 'bear' ? 'bear' : 'bull', text: String(p.text).slice(0, 200) }));
  if (!heads.length) return { sent: [], pivots: [] };

  const key = 'an:' + createHash('sha1')
    .update(JSON.stringify([sym, heads, points.map(p => p.id + p.text)]))
    .digest('hex');
  const hit = cacheGet(key, 6 * HOUR);
  if (hit && !hit.stale) return hit.value;

  const subject = context === 'company'
    ? `${sym} as a company/employer in the steel business`
    : `an investor holding or watching ${sym}`;
  const pointsBlock = points.length
    ? `\nHis thesis points on ${sym}:\n${points.map(p => `${p.id} [${p.side.toUpperCase()}]: ${p.text}`).join('\n')}\n\nA headline is a PIVOT only if it materially confirms or threatens a SPECIFIC point above — routine coverage is not a pivot.`
    : '';

  const prompt = `Classify news headlines for ${subject}.

Headlines:
${heads.map((h, i) => `${i}. ${h}`).join('\n')}
${pointsBlock}
Reply ONLY JSON, no markdown:
{"sent":["good"|"bad"|"neutral", ... one per headline, in order],
 "pivots":[{"i":<headline index>,"point":"<point id>","kind":"confirms"|"threatens","why":"<under 12 words>"}]}
${points.length ? '' : 'Use an empty pivots array.'}`;

  const txt = await completeText([{ role: 'user', content: prompt }], { maxTokens: 500 });
  const m = txt.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(m ? m[0] : txt);
  const validIds = new Set(points.map(p => p.id));
  const out = {
    sent: heads.map((_, i) => ['good', 'bad', 'neutral'].includes(parsed.sent?.[i]) ? parsed.sent[i] : 'neutral'),
    pivots: (parsed.pivots || []).filter(p => Number.isInteger(p.i) && p.i >= 0 && p.i < heads.length && validIds.has(String(p.point)))
      .map(p => ({ i: p.i, point: String(p.point), kind: p.kind === 'threatens' ? 'threatens' : 'confirms', why: String(p.why || '').slice(0, 90) })),
  };
  cacheSet(key, out);
  return out;
}
