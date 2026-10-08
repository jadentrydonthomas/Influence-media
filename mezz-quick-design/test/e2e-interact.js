// Click through every control after loading a PCS; fail on any page error or a missing answer.
// usage: node test/e2e-interact.js path/to/PCS.pdf [shotsDir]
const path = require('path');
const fs = require('fs');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require(process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright'); }

// several PDFs (npm run e2e passes the glob): one run each, in turn
const pdfArgs = process.argv.slice(2).filter(a => /\.pdf$/i.test(a));
if (pdfArgs.length > 1) {
  const rest = process.argv.slice(2).filter(a => !/\.pdf$/i.test(a));
  let code = 0;
  for (const p of pdfArgs) {
    console.log(`\n=== ${path.basename(p)}`);
    const r = require('child_process').spawnSync(process.execPath, [__filename, p, ...rest], { stdio: 'inherit' });
    code = code || r.status || 0;
  }
  process.exit(code);
}

(async () => {
  const pdf = path.resolve(process.argv[2]);
  const shots = path.resolve(process.argv[3] || path.join(__dirname, '..', 'oracle', 'out', 'shots'));
  fs.mkdirSync(shots, { recursive: true });
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await ctx.newPage();
  const errors = [], fail = msg => errors.push('assert: ' + msg);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.setInputFiles('#file', pdf);
  await page.waitForSelector('#v-results.is-active', { timeout: 60000 });
  // values the PCS leaves open: type them into the prompt (B 9'-0", seat 5", joists @ 4'-0")
  const typed = { 'geom.B': `9'-0"`, 'geom.seat': '5', 'geom.joistSpacing': `4'-0"` };
  for (let k = 0; k < 8 && await page.$('#needCard'); k++) {
    const paths = await page.$$eval('#needCard input[data-need]', es => es.map(e => e.dataset.need));
    const p0 = paths.find(q => typed[q] || q === 'geom.C');
    if (!p0) { fail('unexpected open value: ' + paths.join(', ')); break; }
    if (p0 === 'geom.C') { await page.click('#needCard .chip[data-need="geom.C"][data-v="none"]'); await page.waitForTimeout(250); continue; }   // C: "No requirement"
    await page.fill(`#needCard input[data-need="${p0}"]`, typed[p0]); await page.press(`#needCard input[data-need="${p0}"]`, 'Tab'); await page.waitForTimeout(250);
  }

  // beam / column quote rows, compact
  const quote = () => page.$$eval('#quoteSheet table', ts => ts.slice(1).map(t => [...t.querySelectorAll('tbody tr')].map(tr => {
    const c = [...tr.cells].map(x => x.textContent.trim());
    return c.slice(1, -1).join(' ');
  }).join(' / ')).join(' || '));
  const log = async label => { const q = await quote(); console.log(label.padEnd(30), q); return q; };
  const base = await log('default');

  const setSetting = async (key, value) => {
    await page.click('#nav button[data-view="settings"]');
    await page.selectOption(`#settingsGrid [data-set="${key}"]`, value);
    await page.waitForTimeout(150);
  };
  const setNum = async (key, value) => {
    await page.click('#nav button[data-view="settings"]');
    await page.fill(`#settingsGrid [data-set="${key}"]`, String(value)); await page.press(`#settingsGrid [data-set="${key}"]`, 'Tab'); await page.waitForTimeout(150);
  };
  await setSetting('marks', 'split'); await log('split marks');
  await page.click('#nav button[data-view="plan"]'); await page.screenshot({ path: path.join(shots, 'plan-split.png'), fullPage: false });
  await setSetting('marks', 'single'); await log('one governing mark');
  await setSetting('marks', 'intext');
  await setSetting('colLength', 'clear'); await log('column clear length');
  await setSetting('colLength', 'A');
  for (const ed of ['13', '15', '16']) { await setSetting('edition', ed); await log('edition ' + ed); }
  await setSetting('edition', 'auto');
  await setSetting('includeW818', 'true'); await log('W8X18 allowed');
  await setSetting('includeW818', 'false');
  await setSetting('optionDefault', 'fit'); await log('default option: best fit');
  await setSetting('optionDefault', 'headroom'); await log('default option: headroom');
  await setSetting('optionDefault', 'lightest');
  await setNum('dMax', 18); await log('max depth 18');
  await setNum('dMax', 30);
  if (await quote() !== base) fail('settings round-trip did not return to the default answer');

  // joist direction toggle + trib hover
  await page.click('#nav button[data-view="plan"]');
  await page.click('#joistSeg button[data-j="x"]'); await log('joists span length');
  await page.screenshot({ path: path.join(shots, 'plan-joists-x.png'), fullPage: false });
  await page.click('#joistSeg button[data-j="auto"]');
  await page.dispatchEvent('#planSvg .beam[data-beam="0:2"]', 'mouseenter');
  const tribOn = await page.$eval('#planSvg .trib[data-band="0:2"]', e => e.classList.contains('on'));
  console.log('trib band on hover'.padEnd(30), tribOn);
  if (!tribOn) fail('trib band did not light on hover');
  // hover cards: every mezzanine column shows its Column-sheet left / right D and L; building columns their load to the frame
  const tipAt = async sel => { const el = await page.$(sel); if (!el) return null; await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(60); const b = await el.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(80); return page.$eval('.hover-tip', e => (e.hidden ? '' : e.textContent.replace(/\s+/g, ' ').trim())); };
  const colTip = await tipAt('#planSvg .mcol');
  console.log('hover mezz column'.padEnd(30), (colTip || '').slice(0, 150));
  if (!/Column sheet input/.test(colTip || '') || !/Left\s*D \d+\.\d\d\s*L \d+\.\d\d/.test(colTip) || !/Right\s*D \d+\.\d\d/.test(colTip)) fail('hovering a mezzanine column should show its left / right dead and live');
  const bTip = await tipAt('#planSvg .bcol-g.ld');
  console.log('hover building column'.padEnd(30), (bTip || '').slice(0, 150));
  if (!/load to the frame/.test(bTip || '') || !/Total\s*D \d+\.\d\d\s*L \d+\.\d\d/.test(bTip)) fail('hovering a building column with beams in should show the load to the frame');
  const beamTip = await tipAt('#planSvg .beam[data-beam="0:0"]');
  console.log('hover beam'.padEnd(30), (beamTip || '').slice(0, 150));
  if (!/End shear/.test(beamTip || '')) fail('hovering a beam should show its end shear');
  await page.mouse.move(2, 2);

  // the design manual checklist (DM 15.1) and the Excel steps on the Beam and Column pages
  await page.click('#nav button[data-view="results"]'); await page.waitForTimeout(150);
  const dm = await page.$$eval('#dmList .dm-item', xs => xs.map(x => x.className.replace('dm-item s-', '')[0] + ':' + x.querySelector('.dm-ref').textContent));
  console.log('DM 15.1 checklist'.padEnd(30), dm.length, 'items ·', dm.join(' '));
  if (dm.length < 12) fail('the DM 15.1 checklist should list the design-manual items');
  await page.click('#nav button[data-view="beam"]'); await page.waitForTimeout(150);
  const xlB = await page.$$eval('#xlBeam table.xl', ts => ts.map(t => [...t.querySelectorAll('tbody tr:not(.rb):not(.rb-h)')].map(tr => tr.cells[1].textContent + '=' + tr.cells[3].textContent)));
  console.log('Excel steps, beam'.padEnd(30), xlB.map(t => t.length).join(' + '), '·', (xlB[1] || []).slice(0, 4).join(' '));
  if (xlB.length !== 2 || xlB[0].length < 10 || !xlB[1].some(x => /!D7=/.test(x))) fail('the Beam page should list the INPUT and MB-sheet cells to type');
  await page.click('#nav button[data-view="column"]'); await page.waitForTimeout(150);
  const xlC = await page.$$eval('#xlCol table.xl tbody tr:not(.rb):not(.rb-h)', trs => trs.map(tr => tr.cells[1].textContent + '=' + tr.cells[3].textContent));
  console.log('Excel steps, column'.padEnd(30), xlC.join(' '));
  if (!xlC.some(x => /Column!C27=/.test(x)) || !xlC.some(x => /Fy/.test(x) || /K8/.test(x))) fail('the Column page should list the Column-sheet cells to type');

  // NBG Frame files: drop the job's .frame files on the Plan page; the FDL / FLL rows go on the frame's own columns
  await page.click('#nav button[data-view="plan"]'); await page.waitForTimeout(150);
  const frDir = path.join(__dirname, '..', 'private', 'frame');
  const mast = await page.$eval('#mastContext', e => e.textContent);
  const frames = /W1S-26062/.test(mast) && fs.existsSync(frDir) ? fs.readdirSync(frDir).filter(n => /^Frame_\d+_Bldg_1_[\d-]+\.frame$/.test(n)).map(n => path.join(frDir, n)) : [];
  if (!(await page.$('#nbgFrame'))) fail('the Plan page should have the NBG Frame files block');
  else if (frames.length) {
    await page.setInputFiles('#nbgFile', frames);
    await page.waitForSelector('#nbgList .nbg-file', { timeout: 20000 }); await page.waitForTimeout(300);
    const got = await page.$$eval('#nbgList .nbg-file', fs_ => fs_.map(f => [f.querySelector('.nbg-fh b').textContent, [...f.querySelectorAll('table.nbg-t tbody tr')].map(tr => [0, 2, 4, 6, 7, 9].map(i => (i === 7 ? tr.cells[i].firstChild.textContent : tr.cells[i].textContent).trim()).join(' ')), [...f.querySelectorAll('.nbg-left > div .mono b')].map(b => b.textContent)]));
    got.forEach(g => console.log(('NBG ' + g[0].replace(/^Frame_\d+_/, '')).padEnd(30), g[1].join(' | '), g[2].length ? '· not in file: ' + g[2].join(', ') : ''));
    const one = got.find(g => /_1_1\.frame$/.test(g[0])), two = got.find(g => /_1_2\.frame$/.test(g[0]));
    if (!two || two[1].join('|') !== 'FDL 2 COL02 -11.527 10.75 WebCenterline Global|FLL 2 COL02 -25.000 10.75 WebCenterline Global|FDL 3 COL03 -18.921 10.75 WebCenterline Global|FLL 3 COL03 -42.000 10.75 WebCenterline Global') fail('frame 2 should get 2/E on COL02 and 2/A on COL03');
    if (!one || one[2].join() !== '1/C,1/B' || one[1].some(r => /COL01/.test(r))) fail('frame 1: 1/E and 1/A on the frame, 1/B and 1/C listed apart, nothing on the FSW column');
    if (!/Every frame line/.test(await page.$eval('#nbgList .nbg-cover', e => e.textContent))) fail('all frame lines with load should be covered');
    // nothing is made with an unconfirmed Ecc. Loc. code: the check file first, then the row that reads WebCenterline
    if (!(await page.$eval('#nbgAll', b => b.disabled)) || (await page.$$eval('[data-nbg-dl]', bs => bs.some(b => !b.disabled)))) fail('downloads must wait for the Ecc. Loc. code');
    const [dc] = await Promise.all([page.waitForEvent('download'), page.click('#nbgEccFile')]);
    const cp = path.join(shots, dc.suggestedFilename()); await dc.saveAs(cp);
    {
      const FF0 = require('../src/framefile.js'), z0 = require('zlib');
      const io0 = { inflate: async u => new Uint8Array(z0.inflateRawSync(u)), deflate: async u => new Uint8Array(z0.deflateRawSync(u)) };
      const ck = await FF0.read(new Uint8Array(fs.readFileSync(cp)), io0, dc.suggestedFilename());
      const ecc = ck.info.cloads.filter(c => /^ECC /.test(c.name)).map(c => c.toFlange);
      console.log('NBG Ecc. Loc. check file'.padEnd(30), dc.suggestedFilename(), 'codes', ecc.join(' '));
      if (!/^[A-Za-z0-9-]+_ECC\.frame$/.test(dc.suggestedFilename())) fail('the check file name should be short too');
      if (ecc.join() !== FF0.ECC_CANDIDATES.join()) fail('the check file should carry one row per candidate code');
    }
    await page.click('#nbgList [data-ecc="3"]'); await page.waitForTimeout(200);
    if (!/code 3/.test(await page.$eval('#nbgList .nbg-ecc', e => e.textContent))) fail('picking the row should confirm the code');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#nbgAll')]);
    const zp = path.join(shots, dl.suggestedFilename()); await dl.saveAs(zp);
    console.log('NBG download'.padEnd(30), dl.suggestedFilename(), fs.statSync(zp).size, 'bytes');
    if (!/frames-mezz\.zip$/.test(dl.suggestedFilename()) || fs.statSync(zp).size < 100000) fail('Download checked should give the zip of frame files');
    { const zz = require('zlib'), FFz = require('../src/framefile.js');
      const zipped = FFz.unzip(new Uint8Array(fs.readFileSync(zp)));
      // NBG Frame's run reads the path into 64 characters: C:\Users\<name>\Downloads\ (~32) + the name + " (9)" fits
      const names = zipped.map(e => e.name);
      console.log('NBG file names'.padEnd(30), names.join(' '));
      if (!names.every(n => /^[A-Za-z0-9-]+_mz\.frame$/.test(n) && n.length <= 26)) fail('frame file names must stay short, without spaces or brackets: ' + names.join(', '));
      const one = zipped.find(e => /^\d+-B1-2_mz\.frame$/.test(e.name)), inner = FFz.unzip(one.data).find(e => e.name === '.nfrx');
      const codes = [...new Set(FFz.cloadsOf(new TextDecoder().decode(zz.inflateRawSync(inner.data))).map(c => c.fields).filter(FFz.isOurs).map(c => c.toFlange))];
      if (codes.join() !== '3') fail('the frame files should carry the confirmed code'); }
    await page.click('#nbgEccReset'); await page.waitForTimeout(150);
    if (!/One-time setup/.test(await page.$eval('#nbgList .nbg-ecc', e => e.textContent))) fail('Reset should ask for the code again');
    // a frame saved from NBG Frame with the rows set to WebCenterline by hand (stand-in code 3): the code is learned and used
    const FF = require('../src/framefile.js'), zlib = require('zlib');
    const io = { inflate: async u => new Uint8Array(zlib.inflateRawSync(u)), deflate: async u => new Uint8Array(zlib.deflateRawSync(u)) };
    const src = frames.find(n => /_1_2\.frame$/.test(n)), ff = await FF.read(new Uint8Array(fs.readFileSync(src)), io, path.basename(src));
    const rows = [{ name: 'FDL 2', caseId: 'FDL', member: 'COL02', y: -1, location: 10 }, { name: 'FLL 2', caseId: 'FLL', member: 'COL02', y: -2, location: 10 }];
    const handFixed = FF.addLoads(ff.xml, rows, { toFlange: FF.WEB_GUESS }).xml.split(`<toFlange>${FF.WEB_GUESS}</toFlange>`).join('<toFlange>3</toFlange>');
    const fixedPath = path.join(shots, path.basename(src));
    fs.writeFileSync(fixedPath, await FF.write(ff, handFixed, io));
    await page.setInputFiles('#nbgFile', [fixedPath]); await page.waitForTimeout(500);
    const eccTxt = await page.$eval('#nbgList .nbg-ecc', e => e.textContent);
    console.log('NBG Ecc. Loc. learned'.padEnd(30), eccTxt.replace(/\s+/g, ' ').slice(0, 90));
    if (!/code 3/.test(eccTxt) || !/learned/.test(eccTxt)) fail('the WebCenterline code should be learned from rows set by hand');
    const [d2] = await Promise.all([page.waitForEvent('download'), page.click('#nbgList .nbg-file [data-nbg-dl]')]);
    const p2 = path.join(shots, 'learned_' + d2.suggestedFilename()); await d2.saveAs(p2);
    const back = await FF.read(new Uint8Array(fs.readFileSync(p2)), io, d2.suggestedFilename());
    const codes = [...new Set(back.info.cloads.filter(FF.isOurs).map(c => c.toFlange))];
    console.log('NBG rows written with'.padEnd(30), 'toFlange', codes.join(', '));
    if (codes.join() !== '3') fail('every FDL / FLL row should carry the learned code');
    await page.click('#nbgEccReset'); await page.waitForTimeout(150);
    if (!/One-time setup/.test(await page.$eval('#nbgList .nbg-ecc', e => e.textContent))) fail('Reset should go back to the unconfirmed code');
    await page.click('#nbgClear');
  } else console.log('NBG Frame files'.padEnd(30), 'block present (no frame files for this job)');

  // beam options on the results page
  await page.click('#nav button[data-view="results"]');
  const opts = await page.$$eval('#options .option', os => os.length);
  if (opts < 2) fail('expected at least two beam options');
  for (const k of ['fit', 'headroom']) {
    const b = await page.$(`#options [data-opt="${k}"]`);
    if (!b) continue;
    await b.click(); await page.waitForTimeout(150); await log('option ' + k);
  }
  await page.click('#options [data-opt="lightest"]'); await page.waitForTimeout(150);
  if (await quote() !== base) fail('back to lightest did not restore the quote');

  // pick a depth from the beam calc table, then return
  await page.click('#nav button[data-view="beam"]');
  const depths = await page.$$eval('#altTable tr.pick', trs => trs.map(t => t.dataset.d));
  await page.click(`#altTable tr.pick[data-d="${depths[Math.floor(depths.length / 2)]}"]`); await log(`picked ${depths[Math.floor(depths.length / 2)]}" row`);
  await page.click('#nav button[data-view="results"]');
  // back to lightest (no button when the picked row is the lightest section already: it is "In the quote")
  const lightest = await page.$('#options [data-opt="lightest"]');
  if (lightest) { await lightest.click(); await page.waitForTimeout(150); }

  // Beam calc inputs: a design span 1'-0" under the layout goes on the MB sheet and the quote; the plan's columns and the
  // frame loads stay where they are; "Back to the layout" restores the answer
  const qBase = await quote();
  await page.click('#nav button[data-view="plan"]');
  const flCols = () => page.$$eval('#frameLoads tbody tr', trs => trs.map(tr => tr.cells[0].textContent.trim() + ':' + tr.cells[1].textContent.trim().slice(0, 5)).join(' '));
  const fl0 = await flCols();
  await page.click('#nav button[data-view="beam"]'); await page.click('#markTabs .tab[data-i="0"]'); await page.waitForTimeout(150);
  const sp0 = await page.$eval('#beamInputs input[data-bi="span"]', e => e.value), m0 = /(\d+)'-(\d+)/.exec(sp0), v0 = +m0[1] + +m0[2] / 12;
  await page.fill('#beamInputs input[data-bi="span"]', (v0 - 1).toFixed(3)); await page.press('#beamInputs input[data-bi="span"]', 'Enter'); await page.waitForTimeout(300);
  const biTxt = await page.$eval('#beamInputs', e => e.innerText.replace(/\s+/g, ' '));
  console.log('beam inputs, span − 1\'-0"'.padEnd(30), biTxt.slice(biTxt.indexOf('Design span'), biTxt.indexOf('Design span') + 120));
  if (!(await page.$('#beamInputs .bi-f.is-set'))) fail('the design span should show as set');
  const q1 = await quote();
  if (q1 === qBase) fail('a design span should change the quote rows (SPAN at the design length)');
  await page.click('#nav button[data-view="plan"]');
  if (await flCols() !== fl0) fail('a design span must not move the frame columns / members');
  await page.click('#nav button[data-view="beam"]'); await page.click('#biReset'); await page.waitForTimeout(300);
  if (await quote() !== qBase) fail('"Back to the layout" should restore the quote');

  // column override
  await page.click('#nav button[data-view="column"]');
  await page.selectOption('#colPick', 'W12X26'); await log('column override W12X26');
  await page.selectOption('#colPick', '');

  // inputs: live load, clearance C, deck type and concrete drive the dead load
  await page.click('#nav button[data-view="inputs"]');
  const fillIn = async (p, v) => { await page.fill(`#inputsGrid input[data-path="${p}"]`, v); await page.press(`#inputsGrid input[data-path="${p}"]`, 'Tab'); await page.waitForTimeout(150); };
  const dead = () => page.$eval('#inputsGrid input[data-path="loads.dead"]', e => e.value);
  const c0 = await page.$eval('#inputsGrid input[data-path="geom.C"]', e => e.value);   // the PCS value, or empty for "no requirement"
  await fillIn('loads.live', '150'); await log('live 150 psf');
  await fillIn('geom.C', `10'-6"`); await log('C = 10\'-6" requested');
  await fillIn('geom.C', '');
  // clearing C makes it an open value again: the Design page asks; "No requirement", or the PCS value typed back, restores the start
  await page.click('#nav button[data-view="results"]');
  if (!(await page.$('#needCard .chip[data-need="geom.C"][data-v="none"]'))) fail('clearing C should ask for it again');
  else { await page.click('#needCard .chip[data-need="geom.C"][data-v="none"]'); await page.waitForTimeout(200); }
  await page.click('#nav button[data-view="inputs"]');
  if (c0) await fillIn('geom.C', c0);
  await fillIn('loads.live', '125');
  const d0 = await dead();
  // the deck and concrete as read off the PCS, to come back to; a dead load given on the PCS (a number or a blue note)
  // stays put, only the deck-guide value follows deck and concrete
  const deck0 = await page.$eval('#inputsGrid select[data-mezz="deck"]', e => e.value), conc0 = await page.$eval('#inputsGrid select[data-mezz="concrete"]', e => e.value);
  const deadSrc = await page.$eval('#inputsGrid input[data-path="loads.dead"]', e => { const b = e.closest('.field-row') && e.closest('.field-row').querySelector('.src'); return b ? b.className : ''; });
  const guide = /deckGuide|estimate/.test(deadSrc);
  await page.selectOption('#inputsGrid select[data-mezz="concrete"]', 'LW'); await page.waitForTimeout(150);
  const dLW = await dead(); await log(`LW concrete (DL ${dLW})`);
  await page.selectOption('#inputsGrid select[data-mezz="deck"]', '2VL'); await page.waitForTimeout(150);
  const dLW2 = await dead(); await log(`LW on 2VL (DL ${dLW2})`);
  await page.selectOption('#inputsGrid select[data-mezz="concrete"]', conc0); await page.selectOption('#inputsGrid select[data-mezz="deck"]', deck0); await page.waitForTimeout(150);
  console.log('dead load NW / LW / LW 2VL'.padEnd(30), d0, dLW, dLW2, guide ? '(deck guide)' : `(given: ${deadSrc.replace('src ', '')})`);
  if (guide && !(+dLW < +d0)) fail('lightweight concrete should lower the deck-guide dead load');
  if (!guide && (dLW !== d0 || dLW2 !== d0)) fail('a dead load given on the PCS should not follow the deck / concrete');
  if (await dead() !== d0) fail('dead load did not return to the deck guide value');
  if (await quote() !== base) fail('inputs round-trip did not return to the default answer');

  // 3D model: controls, then find and click a beam by sweeping the canvas
  await page.click('#nav button[data-view="results"]');
  await page.click('#m3Pause'); await page.click('#m3Reset');
  for (const t of ['slab', 'joists', 'building']) { await page.click(`#modelToggles button[data-t="${t}"]`); await page.click(`#modelToggles button[data-t="${t}"]`); }
  await page.click('#m3In'); await page.click('#m3Out');
  // the slab and the joists bearing on the beams hide the beams' top faces: off while aiming
  for (const t of ['slab', 'joists']) await page.click(`#modelToggles button[data-t="${t}"]`);
  await page.$eval('#model3d', c => c.scrollIntoView({ block: 'center' }));
  const box = await page.$eval('#model3d', c => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  let hit = null;
  // aim at a beam's top face first (the renderer says where it is), then fall back to sweeping the canvas
  for (const id of (await page.evaluate(() => window.MZ_DEBUG && window.MZ_DEBUG.beams ? window.MZ_DEBUG.beams().slice(0, 6) : ['B1', 'B2', 'B3', 'B5']))) {
    const pt = await page.evaluate(i => window.MZ_DEBUG && window.MZ_DEBUG.modelPoint(i), id);
    if (!pt) continue;
    await page.mouse.move(box.x + pt[0], box.y + pt[1]);
    const h = await page.$eval('#modelCard h4', e => e.textContent);
    if (/^B\d+ · /.test(h)) { hit = [box.x + pt[0], box.y + pt[1], h]; break; }
  }
  for (let j = 0.2; j < 0.86 && !hit; j += 0.01) {
    for (let i = 0.12; i < 0.88 && !hit; i += 0.025) {
      await page.mouse.move(box.x + box.w * i, box.y + box.h * j);
      const h = await page.$eval('#modelCard h4', e => e.textContent);
      if (/^B\d+ · /.test(h)) hit = [box.x + box.w * i, box.y + box.h * j, h];
    }
  }
  if (!hit) fail('no beam found under the pointer in the 3D model');
  else {
    await page.mouse.click(hit[0], hit[1]);
    const card = await page.$eval('#modelCard', e => e.textContent.replace(/\s+/g, ' ').trim());
    console.log('3D click'.padEnd(30), card.slice(0, 120));
    if (!/Selected member/.test(card) || !/BU\d+x\d+/.test(card)) fail('clicking a 3D beam did not select it');
  }
  for (const t of ['slab', 'joists']) await page.click(`#modelToggles button[data-t="${t}"]`);
  await page.screenshot({ path: path.join(shots, 'model-selected.png'), fullPage: false });

  // copy buttons: rail copies all three tables as TSV
  await page.click('#copyQuote'); await page.waitForTimeout(150);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  if (clip != null) {
    console.log('clipboard lines'.padEnd(30), clip.split('\n').length);
    if (!clip.includes('\t') || !/BU\d+x\d+/.test(clip)) fail('copied quote rows are not tab-separated with the BU section');
  }
  for (const b of await page.$$('#quoteSheet [data-copy]')) await b.click();

  // several mezzanines: every one designs, the quote sheet lists them all, and switching keeps each one's edits
  const ids = await page.$$eval('#mezzTabs .mt', bs => bs.map(b => b.dataset.mi));
  const pick = async v => { await page.click(`#mezzTabs .mt[data-mi="${v}"]`); await page.waitForTimeout(300); };
  if (ids.length > 1 && await page.isVisible('#mezzTabs')) {
    await page.click('#nav button[data-view="results"]');
    const rowsAll = await page.$$eval('#quoteSheet table', ts => ts.map(t => t.querySelectorAll('tbody tr').length));
    console.log('mezzanines'.padEnd(30), ids.length, 'quote rows', rowsAll.join('/'));
    if (rowsAll[0] !== ids.length) fail('design table should list every mezzanine');
    for (const v of ids) {
      await pick(v);
      for (const view of ['results', 'plan', 'beam', 'column']) { await page.click(`#nav button[data-view="${view}"]`); await page.waitForTimeout(120); }
      const st = await page.$eval('#statusText', e => e.textContent);
      console.log(('mezzanine ' + v).padEnd(30), st, '|', await quote());
    }
    // beam marks are the job's: the Beam page lists them once, with a run per member length (same section)
    await page.click('#nav button[data-view="beam"]'); await page.click('#markTabs .tab[data-i="0"]'); await page.waitForTimeout(150);
    const tabs = await page.$$eval('#markTabs .tab', ts => ts.map(t => t.textContent.trim()));
    const runs = await page.$$eval('#spanRuns .sr', bs => bs.map(b => b.querySelector('b').textContent + ' ' + b.querySelector('span').textContent));
    console.log('job beam marks'.padEnd(30), tabs.join(' | '), '| runs', runs.join(' / '));
    if (tabs.length < 1 || tabs.some(t => !/^MB\d/.test(t))) fail('beam mark tabs missing');
    if (runs.length > 1) {
      await page.click('#spanRuns .sr[data-i="1"]'); await page.waitForTimeout(150);
      const title = await page.$eval('#beamCalcTitle', e => e.textContent);
      const L = await page.$$eval('#mbSheet .kv span', ss => { const i = ss.findIndex(s => /Member Length/.test(s.textContent)); return i >= 0 ? ss[i + 1].textContent.trim() : ''; });
      console.log('shorter member run'.padEnd(30), title, '| member length', L);
      if (!/ at /.test(title) || !(+L > 0) || runs[1].indexOf(String(+L).slice(0, 2)) < 0) fail('the shorter run should put its own member length on the MB sheet');
      await page.click('#spanRuns .sr[data-i="0"]');
    }
    // one mezzanine only: the Inputs page can limit an edit to the mezzanine on screen
    await pick(ids[1]); await page.click('#nav button[data-view="inputs"]'); await page.click('#linkSeg button[data-l="0"]');
    await page.fill('#inputsGrid input[data-path="loads.live"]', '150'); await page.press('#inputsGrid input[data-path="loads.live"]', 'Tab'); await page.waitForTimeout(200);
    await pick(ids[0]);
    const q2 = await quote();
    console.log('mezz 2 live 150, back on 1'.padEnd(30), q2);
    if (!/\b15[05]\b/.test(q2)) fail("the other mezzanine's edit should show in the job quote");
    await pick(ids[1]); await page.click('#nav button[data-view="inputs"]');
    await page.fill('#inputsGrid input[data-path="loads.live"]', '125'); await page.press('#inputsGrid input[data-path="loads.live"]', 'Tab'); await page.waitForTimeout(200);
    // every mezzanine (the default): one edit reaches both
    await page.click('#linkSeg button[data-l="1"]');
    await page.fill('#inputsGrid input[data-path="loads.partition"]', '10'); await page.press('#inputsGrid input[data-path="loads.partition"]', 'Tab'); await page.waitForTimeout(250);
    const parts = await page.$$eval('#quoteSheet table', ts => [...ts[0].querySelectorAll('tbody tr')].map(tr => tr.cells[7].textContent.trim()));
    console.log('partition 10 on every mezz'.padEnd(30), parts.join(' / '));
    if (!parts.every(p => p === '10')) fail('a linked edit should reach every mezzanine');
    await page.fill('#inputsGrid input[data-path="loads.partition"]', '5'); await page.press('#inputsGrid input[data-path="loads.partition"]', 'Tab'); await page.waitForTimeout(250);
    await pick(ids[0]);
  }

  // manual entry path on a fresh page: stops on the missing (B) clearance
  const p2 = await ctx.newPage();
  p2.on('pageerror', e => errors.push('manual: ' + e.message));
  await p2.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await p2.click('#manualBtn');
  await p2.waitForSelector('#v-inputs.is-active');
  const status = await p2.$eval('#statusText', e => e.textContent);
  if (!/input/i.test(status)) fail('manual entry should start as needing input, got ' + status);
  console.log('manual entry'.padEnd(30), status);
  await p2.fill(`#inputsGrid input[data-path="geom.B"]`, `10'-0"`); await p2.press(`#inputsGrid input[data-path="geom.B"]`, 'Tab'); await p2.waitForTimeout(200);
  await p2.click('#nav button[data-view="results"]');
  const open2 = await p2.$$eval('#needCard input[data-need]', es => es.map(e => e.dataset.need));
  console.log('manual entry still open'.padEnd(30), open2.join(', '));
  if (open2.join() !== 'geom.C,geom.joistSpacing,geom.seat') fail('manual entry should ask for C, joist spacing and seat');
  await p2.click('#needCard .chip[data-need="geom.C"][data-v="none"]'); await p2.waitForTimeout(200);
  await p2.click('#needCard .chip[data-need="geom.joistSpacing"]'); await p2.waitForTimeout(200);
  await p2.click('#needCard .chip[data-need="geom.seat"]'); await p2.waitForTimeout(200);
  const mq = await p2.$$eval('#quoteSheet table', ts => ts.map(t => [...t.querySelectorAll('tbody tr')].map(tr => tr.textContent.replace(/\s+/g, ' ').trim()).join(' / ')));
  console.log('manual entry, B = 10\'-0"'.padEnd(30), mq.join(' || '));
  if (mq.length !== 3) fail('manual entry did not design once (B) was filled');

  console.log('errors', errors);
  await browser.close();
  process.exitCode = errors.length ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
