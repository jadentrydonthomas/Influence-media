// The two spec documents must not drift: every requirement ID in one has to
// exist in the other, and every internal link has to resolve.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const md = fs.readFileSync(path.join(root,'QUOTE_OUTCOME_ATLAS_HANDOFF_SPEC.md'),'utf8');
const html = fs.readFileSync(path.join(root,'handoff-spec.html'),'utf8');
const fails=[]; const check=(n,c,d)=>{ if(!c) fails.push(n); console.log((c?'ok   ':'FAIL ')+n+(d?'  '+d:'')); };

const ids = text => new Set((text.match(/\b([PMVKTDA]-\d+[a-z]?)\b/g)||[]));
const mdIds = ids(md), htmlIds = ids(html);
const missingInHtml = [...mdIds].filter(i=>!htmlIds.has(i)).sort();
const missingInMd = [...htmlIds].filter(i=>!mdIds.has(i)).sort();
check('every requirement in the markdown appears in the designed version', missingInHtml.length===0, missingInHtml.join(', '));
check('every requirement in the designed version appears in the markdown', missingInMd.length===0, missingInMd.join(', '));

const htmlAnchors = new Set([...html.matchAll(/id="([a-z0-9]+)"/g)].map(m=>m[1]));
const htmlLinks = new Set([...html.matchAll(/href="#([a-z0-9]+)"/g)].map(m=>m[1]));
check('designed version has no dead links', [...htmlLinks].every(l=>htmlAnchors.has(l)), [...htmlLinks].filter(l=>!htmlAnchors.has(l)).join(', '));

// GitHub strips punctuation and replaces each remaining space with one hyphen,
// so "Appendix A — Defect log" becomes appendix-a--defect-log. Collapsing runs
// of spaces here would report every em-dash heading as a dead link.
const slug = h => h.toLowerCase().replace(/[^\w\s-]/g,'').trim().replace(/\s/g,'-');
const mdHeads = new Set([...md.matchAll(/^#{1,4} (.+)$/gm)].map(m=>slug(m[1])));
const mdLinks = [...new Set([...md.matchAll(/\]\(#([a-z0-9-]+)\)/g)].map(m=>m[1]))];
const deadMd = mdLinks.filter(l=>!mdHeads.has(l));
check('markdown has no dead section links', deadMd.length===0, deadMd.join(', '));

const version = (md.match(/\*\*Spec version\*\* \| ([\d.]+)/)||[])[1];
const htmlVersion = (html.match(/Spec version<\/dt><dd class="num">([\d.]+)/)||[])[1];
check('both documents carry the same version', version===htmlVersion, `md ${version} / html ${htmlVersion}`);
console.log('\n'+(fails.length?'FAILURES:\n  '+fails.join('\n  '):'The two spec documents agree.'));
process.exit(fails.length?1:0);
