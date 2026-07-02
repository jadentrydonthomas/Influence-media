// News analysis: per-headline good/bad sentiment for a ticker, plus
// "pivot" detection — headlines that confirm or threaten one of the user's
// written thesis points. One batched LLM call per (headlines, points) set,
// cached in SQLite so repeat loads are free.
import { createHash } from 'node:crypto';
import { cacheGet, cacheSet } from './db.js';
import { completeText, hasKey } from './anthropic.js';

const HOUR = 3600_000;

export async function analyzeNews({ sym, heads = [], points = [], theses = null, context = 'stock' }) {
  if (!hasKey()) {
    const err = new Error('no key');
    err.code = 'NO_KEY';
    throw err;
  }
  heads = heads.slice(0, 10).map(h => String(h).slice(0, 160));
  points = points.slice(0, 12).map(p => ({ id: String(p.id), side: p.side === 'bear' ? 'bear' : 'bull', text: String(p.text).slice(0, 200) }));
  if (!heads.length) return { sent: [], pivots: [], suggest: [] };
  const thesesTxt = theses && (theses.bull || theses.bear)
    ? { bull: String(theses.bull || '').slice(0, 600), bear: String(theses.bear || '').slice(0, 600) }
    : null;

  const key = 'an:' + createHash('sha1')
    .update(JSON.stringify([sym, heads, points.map(p => p.id + p.text), thesesTxt]))
    .digest('hex');
  const hit = cacheGet(key, 6 * HOUR);
  if (hit && !hit.stale) return hit.value;

  const subject = context === 'company'
    ? `${sym} as a company/employer in the steel business`
    : `an investor holding or watching ${sym}`;
  const pointsBlock = points.length
    ? `\nHis thesis points on ${sym}:\n${points.map(p => `${p.id} [${p.side.toUpperCase()}]: ${p.text}`).join('\n')}\n\nA headline is a PIVOT only if it materially confirms or threatens a SPECIFIC point above — routine coverage is not a pivot.`
    : '';
  const thesesBlock = thesesTxt
    ? `\nHis written thesis on ${sym}:\nBULL: ${thesesTxt.bull || '(empty)'}\nBEAR: ${thesesTxt.bear || '(empty)'}\n\nAlso: if any headline reveals something material his thesis and points do NOT yet cover, propose it as a new trackable point (max 2, only genuinely new information — otherwise empty).`
    : '';

  const prompt = `Classify news headlines for ${subject}.

Headlines:
${heads.map((h, i) => `${i}. ${h}`).join('\n')}
${pointsBlock}${thesesBlock}
Reply ONLY JSON, no markdown:
{"sent":["good"|"bad"|"neutral", ... one per headline, in order],
 "pivots":[{"i":<headline index>,"point":"<point id>","kind":"confirms"|"threatens","why":"<under 12 words>"}],
 "suggest":[{"side":"bull"|"bear","text":"<new trackable point, under 15 words>","why":"<from which headline, under 8 words>"}]}
${points.length ? '' : 'Use an empty pivots array.'}${thesesTxt ? '' : ' Use an empty suggest array.'}`;

  const txt = await completeText([{ role: 'user', content: prompt }], { maxTokens: 700 });
  const m = txt.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(m ? m[0] : txt);
  const validIds = new Set(points.map(p => p.id));
  const out = {
    sent: heads.map((_, i) => ['good', 'bad', 'neutral'].includes(parsed.sent?.[i]) ? parsed.sent[i] : 'neutral'),
    pivots: (parsed.pivots || []).filter(p => Number.isInteger(p.i) && p.i >= 0 && p.i < heads.length && validIds.has(String(p.point)))
      .map(p => ({ i: p.i, point: String(p.point), kind: p.kind === 'threatens' ? 'threatens' : 'confirms', why: String(p.why || '').slice(0, 90) })),
    suggest: (parsed.suggest || []).slice(0, 2)
      .filter(g => g && g.text)
      .map(g => ({ side: g.side === 'bear' ? 'bear' : 'bull', text: String(g.text).slice(0, 120), why: String(g.why || '').slice(0, 60) })),
  };
  cacheSet(key, out);
  return out;
}
