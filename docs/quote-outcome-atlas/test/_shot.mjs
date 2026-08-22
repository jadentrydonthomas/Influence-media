import { chromium } from 'playwright';
import path from 'path'; import { fileURLToPath } from 'url';
import { openReal } from './yoy-real.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await openReal(b, {width:Number(process.env.W||1512),height:Number(process.env.H||1000)});
if (process.env.DARK) { await p.click('#themeButton'); await p.waitForTimeout(500); }
for (const spec of JSON.parse(process.argv[2])) {
  const [screen, view, sel, name, click] = spec;
  await p.click(`[data-screen="${screen}"]`); await p.waitForTimeout(600);
  if (view) { await p.click(`[data-compare-view="${view}"]`); await p.waitForTimeout(700); }
  if (click) { await p.click(click); await p.waitForTimeout(500); }
  const el = sel === 'PAGE' ? null : await p.$(sel);
  if (sel !== 'PAGE' && !el) { console.log('missing', sel); continue; }
  if (el) { await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(900); await el.screenshot({ path: path.join(root, name) }); }
  else { await p.screenshot({ path: path.join(root, name), fullPage: true }); }
  console.log('shot', name);
}
console.log('errors', p.__errors.length ? p.__errors : 'none');
await b.close();
