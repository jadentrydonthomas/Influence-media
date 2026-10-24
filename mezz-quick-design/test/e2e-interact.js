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
  await page.waitForSelector('#v-results.is-active, #v-building.is-active', { timeout: 300000 });   // a PCS with no text layer is read by OCR first
  await page.click('#nav button[data-view="results"]'); await page.waitForTimeout(200);   // the Building page opens first on a complete job
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
    return c.slice(2).join(' ');   // past the sheet row number and MEZZ
  }).join(' / ')).join(' || '));
  const log = async label => { const q = await quote(); console.log(label.padEnd(30), q); return q; };
  let base = await log('default');

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
  await setSetting('optionDefault', 'econ'); await log('default option: most economical');
  await setSetting('production', 'false'); await log('production rules off');
  await setSetting('production', 'true');
  await setSetting('optionDefault', 'lightest');
  await setNum('dMax', 18); await log('max depth 18');
  await setNum('dMax', 30);
  if (await quote() !== base) fail('settings round-trip did not return to the default answer');
  // a job whose clearance C leaves no stocked section (W1S-26062 at the 5" seat: 15" of room, MB1 takes 16.03" with its
  // sag; W2R-26047: C 8'-6" under A 10'-6" leaves 14"): the page asks for the decision — why, then the setback and the
  // clear height; to drive the rest of the page it is opened the way an engineer would — C cleared on the Inputs page,
  // then "No requirement"
  if (await page.$('#decideCard')) {
    const why = await page.$eval('#decideCard', e => /Clear height not met/i.test(e.innerText) && /Set the beams back at the wall columns/.test(e.innerText) && /Make room for a deeper beam/.test(e.innerText) && /Check the joist seat/.test(e.innerText));
    console.log('no section at the PCS clearance'.padEnd(30), why ? 'the page asks: clear height not met — setback or clear height; C opened to go on' : 'no reason given');
    if (!why) fail('a mark with no section should say why and offer the setback and the clear height');
    // the setback, picked on the card the way the engineer would when it does it on its own: the design comes back
    // (W1S-26062, the practice inputs: MB1 BU14x94 / MB2 BU13x48 at the 22'-8" clear span), then undone on Beam calc
    await page.click('#nav button[data-view="results"]'); await page.waitForTimeout(200);
    if (await page.$('#decideCard .dc-ok') && await page.$('#decideCard [data-dc="setback"]')) {
      await page.click('#decideCard [data-dc="setback"]'); await page.waitForTimeout(600);
      const sq = await log('setback picked');
      if (await page.$('#decideCard') || /NO SECTION/.test(sq)) fail('the setback the card says does it should design every mark');
      if (/W1S-26062/.test(await page.$eval('#mastContext', e => e.textContent)) && !/^24 28 45 125 BU14x94 40 4 \/ 24 14 45 125 BU13x48 40 2 \//.test(sq)) fail('W1S-26062 with the setback should be BU14x94 / BU13x48');
      await page.click('#nav button[data-view="beam"]'); await page.waitForTimeout(150);
      const nT = await page.$$eval('#markTabs .tab', ts => ts.length);
      for (let i = 0; i < nT; i++) { await page.click(`#markTabs .tab[data-i="${i}"]`); await page.waitForTimeout(150); const rb = await page.$('#biReset:not([disabled])'); if (rb) { await rb.click(); await page.waitForTimeout(400); } }
      await page.click('#nav button[data-view="results"]'); await page.waitForTimeout(200);
      if (!(await page.$('#decideCard'))) fail('back to the layout should bring the decision back');
    }
    await page.click('#nav button[data-view="inputs"]'); await page.waitForTimeout(150);
    await page.fill('#inputsGrid input[data-path="geom.C"]', ''); await page.press('#inputsGrid input[data-path="geom.C"]', 'Tab'); await page.waitForTimeout(300);
    await page.click('#nav button[data-view="results"]'); await page.waitForTimeout(200);
    await page.click('#needCard .chip[data-need="geom.C"][data-v="none"]'); await page.waitForTimeout(400);
    base = await log('C: no requirement');
    if (/NO SECTION/.test(base) || await page.$('#decideCard')) fail('with C open every mark should get a section');
  }

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
  // the pointer goes to a spot of the element that is the element (on a dense plan another symbol can sit over its middle)
  const tipAt = async sel => {
    const el = await page.$(sel); if (!el) return null; await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(60);
    const pt = await page.$eval(sel, (e, s) => {
      const r = e.getBoundingClientRect(), long = r.width >= r.height;
      for (const f of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
        const x = long ? r.left + r.width * f : r.left + r.width / 2, y = long ? r.top + r.height / 2 : r.top + r.height * f, h = document.elementFromPoint(x, y);
        if (h && h.closest(s) === e) return { x, y };
      }
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, sel);
    await page.mouse.move(pt.x, pt.y); await page.waitForTimeout(80);
    return page.$eval('.hover-tip', e => (e.hidden ? '' : e.textContent.replace(/\s+/g, ' ').trim()));
  };
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
  await page.click('#nav button[data-view="frames"]'); await page.waitForTimeout(150);
  const frDir = path.join(__dirname, '..', 'private', 'frame');
  const mast = await page.$eval('#mastContext', e => e.textContent);
  const frames = /W1S-26062/.test(mast) && fs.existsSync(frDir) ? fs.readdirSync(frDir).filter(n => /^Frame_\d+_Bldg_1_[\d-]+\.frame$/.test(n)).map(n => path.join(frDir, n)) : [];
  if (!(await page.$('#nbgFrame'))) fail('the Frames page should have the NBG Frame files block');
  else if (frames.length) {
    await page.setInputFiles('#nbgFile', frames);
    await page.waitForSelector('#nbgList .nbg-file', { timeout: 20000 }); await page.waitForTimeout(300);
    // the Seismic calc: the Calcs page, its first building's Seismic Calculations card
    const openSeismic = async () => { await page.click('#nav button[data-view="calcs"]'); await page.waitForTimeout(150); await page.click('#calcList .calc-card[data-calc^="seismic|"]'); await page.waitForTimeout(200); };
    const cardRows = () => page.$$eval('#nbgList .nbg-file', fs_ => fs_.map(f => [f.querySelector('.nbg-fh b').textContent, [...f.querySelectorAll('table.nbg-t tbody tr')].map(tr => [0, 2, 3, 4, 6, 7, 9].map(i => (i === 7 ? tr.cells[i].firstChild.textContent : i === 3 && tr.cells[i].querySelector('input') ? tr.cells[i].querySelector('input').value : tr.cells[i].textContent).trim()).join(' ')), [...f.querySelectorAll('.nbg-left > div .mono b')].map(b => b.textContent)]));
    const got = await cardRows();
    got.forEach(g => console.log(('NBG ' + g[0].replace(/^Frame_\d+_/, '')).padEnd(30), g[1].join(' | '), g[2].length ? '· not in file: ' + g[2].join(', ') : ''));
    const one = got.find(g => /_1_1\.frame$/.test(g[0])), two = got.find(g => /_1_2\.frame$/.test(g[0]));
    // floor dead / live at the floor level A (11'-6"), web centreline — the job as driven here, C opened (MB1 BU26x48)
    if (!two || two[1].filter(r => /^F[DL]L/.test(r)).join('|') !== 'FDL2 COL02 0.000 -11.085 11.50 WebCenterline Global|FLL2 COL02 0.000 -25.000 11.50 WebCenterline Global|FDL3 COL03 0.000 -18.390 11.50 WebCenterline Global|FLL3 COL03 0.000 -42.000 11.50 WebCenterline Global') fail('frame 2 should get 2/E on COL02 and 2/A on COL03');
    // seismic: the frame files gave NBG Frame's roof dead, so the Seismic page is complete and each frame gets EQR / EQL
    const eq2 = two ? two[1].filter(r => /^EQ/.test(r)).map(r => r.split(' ')) : [];
    console.log('NBG seismic rows, frame 2'.padEnd(30), eq2.map(r => r.join(' ')).join(' | '));
    // a row: name member xMag yMag elevation flange system (the name one word: EQR2 = EQR on column 2)
    if (eq2.map(r => r.slice(0, 2).join(' ')).join() !== 'EQR2 COL02,EQL2 COL02,EQR3 COL03,EQL3 COL03' || eq2.some(r => r[4] !== '11.50' || r[5] !== 'Top/Left') || +eq2[0][2] <= 0 || +eq2[0][2] !== -eq2[1][2]) fail('frame 2 should carry EQR + / EQL − on COL02 (Mezz 2) and COL03 (Mezz 1) at the floor level');
    await openSeismic();
    const seisTxt = await page.$eval('#v-seismic', e => e.innerText);
    // every PCS building is worked (Bldg 2 has no mezzanine); the frame files are Bldg 1's, so only its roof dead comes from them
    const frBy = await page.$$eval('#seisFrames .seis-fr', trs => trs.reduce((o, tr) => { const k = tr.dataset.fr.split('|')[0]; o[k] = (o[k] || 0) + 1; return o; }, {}));
    console.log('Seismic page'.padEnd(30), (seisTxt.match(/SDC\s*\S+/) || [''])[0], '· frames', JSON.stringify(frBy), '· brace lines', (await page.$$('#seisBracing tbody tr')).length);
    if (!/FRAME FILE/i.test(seisTxt) || Object.values(frBy)[0] !== 6 || /Needs input:/.test(seisTxt)) fail('the Seismic page should take the roof dead from the frame files and work frames 1–6');
    await page.click('#seisFrames .seis-fr td:first-child'); await page.waitForTimeout(120);
    if (await page.$eval('#seisFrames .seis-dist-row', e => e.hidden)) fail('a frame row should open its distribution');
    await page.click('#nav button[data-view="frames"]'); await page.waitForTimeout(150);
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
    // the engineer's EQ edits: × 1.1 on every load (Seismic page), 5 k typed on frame 2 COL02 (Seismic page), 2.75 k typed
    // on the 3-5 file's COL03 (its card: all three lines) — the cards, the Seismic page and the downloaded rows agree
    const setVal = (sel, v) => page.$eval(sel, (e, x) => { e.value = x; e.dispatchEvent(new Event('change')); }, v).then(() => page.waitForTimeout(250));
    const eqOf = rows => Object.fromEntries(rows.filter(r => /^EQ/.test(r)).map(r => r.split(' ')).map(r => [r[0], +r[2]]));
    const calc2 = eqOf(two[1]), calc35 = eqOf((got.find(g => /_1_3-5\.frame$/.test(g[0])) || [0, []])[1]);
    await openSeismic();
    await setVal('#seisApply [data-seis="eqScale"]', '1.1');
    const k2 = await page.$eval('#seisApply tr[data-fr$="|2"][data-member="COL02"] input[data-eqkey]', x => x.dataset.eqkey);
    await setVal(`#seisApply [data-eqkey="${k2}"]`, '5');
    const seisEq = await page.$$eval('#seisApply tr[data-member]', trs => trs.map(tr => tr.dataset.fr.split('|').pop() + ' ' + tr.dataset.member + ' ' + tr.querySelector('input').value + (tr.classList.contains('is-typed') ? ' typed' : tr.classList.contains('is-scaled') ? ' scaled' : '')));
    console.log('EQ edits, Seismic page'.padEnd(30), seisEq.join(' | '));
    await page.click('#nav button[data-view="frames"]'); await page.waitForTimeout(150);
    const card35 = await page.$$eval('#nbgList .nbg-file', fs_ => fs_.findIndex(f => /_1_3-5\.frame$/.test(f.querySelector('.nbg-fh b').textContent)));
    // a card's data-cardeq starts with its file index (the order of the .nbg-file cards)
    await setVal(`#nbgList [data-cardeq^="${card35}|"][data-cardeq*="|COL03|"]`, '2.75');
    const ed = await cardRows();
    const e2 = eqOf(ed.find(g => /_1_2\.frame$/.test(g[0]))[1]), e35 = eqOf(ed.find(g => /_1_3-5\.frame$/.test(g[0]))[1]);
    console.log('EQ edits, cards'.padEnd(30), 'frame 2', JSON.stringify(e2), '· 3-5', JSON.stringify(e35));
    const near3 = (a, b) => Math.abs(a - b) <= 0.0015;
    if (!near3(e2['EQR2'], 5) || !near3(e2['EQL2'], -5) || !near3(e2['EQR3'], calc2['EQR3'] * 1.1) || !near3(e2['EQL3'], -e2['EQR3'])) fail('frame 2: COL02 typed 5 k, COL03 the calculated load × 1.1');
    if (!near3(e35['EQR3'], 2.75) || !near3(e35['EQL3'], -2.75)) fail('frames 3-5: 2.75 k typed on the card');
    await openSeismic();
    const seis35 = await page.$$eval('#seisApply tr[data-member]', trs => trs.filter(tr => /\|[345]$/.test(tr.dataset.fr)).map(tr => +tr.querySelector('input').value));
    console.log('EQ edits, frames 3-5'.padEnd(30), seis35.join(' '));
    if (seis35.join() !== '2.75,2.75,2.75') fail('a value typed on the 3-5 card should go to frames 3, 4 and 5');
    await page.click('#nav button[data-view="frames"]'); await page.waitForTimeout(150);
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
      const cl = FFz.cloadsOf(new TextDecoder().decode(zz.inflateRawSync(inner.data))).map(c => c.fields);
      const codes = [...new Set(cl.filter(FFz.isGravity).map(c => c.toFlange))];
      if (codes.join() !== '3') fail('the frame files should carry the confirmed code');
      if (cl.filter(FFz.isSeismic).length !== 4 || cl.filter(c => /lean/i.test(c.name)).length < 2) fail('the frame file should carry the 4 EQ rows and keep NBG\'s lean-to rows');
      // the downloaded EQ rows are the edited values, exactly as on the cards
      const xm = (file, n) => { const z = zipped.find(e => new RegExp(`^\\d+-B1-${file}_mz\\.frame$`).test(e.name)), c = FFz.cloadsOf(new TextDecoder().decode(zz.inflateRawSync(FFz.unzip(z.data).find(e => e.name === '.nfrx').data))).map(q => q.fields).find(q => q.name === n); return c ? +c.xMag : NaN; };
      const got2 = ['EQR2', 'EQL2', 'EQR3', 'EQL3'].map(n => xm('2', n)), got35 = ['EQR3', 'EQL3'].map(n => xm('3-5', n));
      console.log('EQ edits, downloaded xMag'.padEnd(30), 'frame 2', got2.join(' '), '· 3-5', got35.join(' '));
      if (!near3(got2[0], 5) || !near3(got2[1], -5) || !near3(got2[2], e2['EQR3']) || !near3(got2[3], -e2['EQR3']) || !near3(got35[0], 2.75) || !near3(got35[1], -2.75)) fail('the downloaded EQR / EQL rows should be the edited values'); }
    // back to the calculated loads
    await openSeismic();
    await page.click('#eqResetAll'); await page.waitForTimeout(250);
    await page.click('#nav button[data-view="frames"]'); await page.waitForTimeout(150);
    const reset = await cardRows(), b2 = eqOf(reset.find(g => /_1_2\.frame$/.test(g[0]))[1]), b35 = eqOf(reset.find(g => /_1_3-5\.frame$/.test(g[0]))[1]);
    if (JSON.stringify(b2) !== JSON.stringify(calc2) || JSON.stringify(b35) !== JSON.stringify(calc35)) fail('"Back to the calculated loads" should restore every EQ load');
    await page.click('#nbgEccReset'); await page.waitForTimeout(150);
    if (!/One-time setup/.test(await page.$eval('#nbgList .nbg-ecc', e => e.textContent))) fail('Reset should ask for the code again');
    // a frame saved from NBG Frame with the rows set to WebCenterline by hand (stand-in code 3): the code is learned and used
    const FF = require('../src/framefile.js'), zlib = require('zlib');
    const io = { inflate: async u => new Uint8Array(zlib.inflateRawSync(u)), deflate: async u => new Uint8Array(zlib.deflateRawSync(u)) };
    const src = frames.find(n => /_1_2\.frame$/.test(n)), ff = await FF.read(new Uint8Array(fs.readFileSync(src)), io, path.basename(src));
    const rows = [{ name: 'FDL2', caseId: 'FDL', member: 'COL02', y: -1, location: 10 }, { name: 'FLL2', caseId: 'FLL', member: 'COL02', y: -2, location: 10 }];
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
    const codes = [...new Set(back.info.cloads.filter(FF.isGravity).map(c => c.toFlange))];
    console.log('NBG rows written with'.padEnd(30), 'toFlange', codes.join(', '));
    if (codes.join() !== '3') fail('every FDL / FLL row should carry the learned code');
    await page.click('#nbgEccReset'); await page.waitForTimeout(150);
    if (!/One-time setup/.test(await page.$eval('#nbgList .nbg-ecc', e => e.textContent))) fail('Reset should go back to the unconfirmed code');
    await page.click('#nbgClear');
  } else console.log('NBG Frame files'.padEnd(30), 'block present (no frame files for this job)');

  // the NBG workbooks: added once, then each copy downloads with the job typed in (xlrd reads the cells back)
  const wbDir = path.join(__dirname, '..', 'private', 'workbooks');
  if (fs.existsSync(path.join(wbDir, 'IBC_Seismic.xls'))) {
    await page.click('#nav button[data-view="results"]'); await page.waitForTimeout(150);
    const wbs = fs.readdirSync(wbDir).filter(n => /^(Mezzanine_(Beam_Design|Column)_1[356]|IBC_Seismic).*\.xls$/.test(n) && !/S16-1[49]\.xls$/.test(n) || /Column_1[56]th_S16/.test(n));
    await page.setInputFiles('#wbFile', wbs.map(n => path.join(wbDir, n)));
    await page.waitForFunction(() => document.querySelectorAll('#wbPanel .wb-chip.ok').length >= 3, null, { timeout: 15000 }).catch(() => null);
    const chips = await page.$$eval('#wbPanel .wb-chip', xs => xs.map(x => (x.classList.contains('ok') ? '✓ ' : '· ') + x.firstChild.textContent.trim()));
    const keys = await page.$$eval('#wbPanel [data-wb]', bs => bs.map(b => b.dataset.wb));
    console.log('NBG workbooks'.padEnd(30), chips.join(' | '), '·', keys.length, 'copies');
    if (!keys.length) fail('the workbook panel should list a copy per beam sheet set, column case and frame line');
    const xr = (file, cells) => JSON.parse(require('child_process').execFileSync('python3', ['-I', '-c', `import sys, json, xlrd
b = xlrd.open_workbook(sys.argv[1], on_demand=True)
def rc(a):
    col = ''.join(c for c in a if c.isalpha()); n = 0
    for ch in col: n = n * 26 + ord(ch) - 64
    return int(''.join(c for c in a if c.isdigit())) - 1, n - 1
out = {}
for q in json.loads(sys.argv[2]):
    sh = b.sheet_by_name(q[0]); r, c = rc(q[1]); out[q[0] + '!' + q[1]] = sh.cell_value(r, c)
print(json.dumps(out))`, file, JSON.stringify(cells)]).toString());
    for (const key of [keys.find(k => /^beam/.test(k)), keys.find(k => /^column/.test(k)), keys.find(k => /^seismic/.test(k))].filter(Boolean)) {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`#wbPanel [data-wb="${key}"]`)]);
      const fp = path.join(shots, dl.suggestedFilename()); await dl.saveAs(fp);
      const kind = key.split('|')[0];
      const got = xr(fp, kind === 'beam' ? [['MB1', 'D5'], ['MB1', 'D7'], ['MB1', 'M22'], ['INPUT', 'D14']] : kind === 'column' ? [['Column', 'C16'], ['Column', 'C27']] : [['Input Data', 'B26'], ['Input Data', 'B89'], ['Lateral Calcs. (1)', 'B18'], ['Miscellaneous', 'B36']]);
      console.log(('workbook ' + kind).padEnd(30), dl.suggestedFilename(), JSON.stringify(got));
      if (kind === 'beam' && !(got['MB1!D5'] === 'MB1' && got['MB1!D7'] > 0 && got['MB1!M22'] >= 10)) fail('the beam workbook copy should carry MB1');
      if (kind === 'column' && !/^W\d+X\d+/.test(got['Column!C16'])) fail('the column workbook copy should carry the section');
      if (kind === 'seismic' && !(got['Input Data!B26'] > 0 && got['Input Data!B89'] > 0 && got['Lateral Calcs. (1)!B18'] > 0)) fail('the seismic workbook copy should carry Ss, the mezzanine and the bay');
    }
  } else console.log('NBG workbooks'.padEnd(30), 'not present — download test skipped');

  // the calc package at the bottom of the Beam and Column pages: the design-basis workbook; with the NBG workbooks added,
  // a zip of it and every filled copy
  {
    const zlib = require('zlib');
    const unzip = u => { const out = {}; let o = 0; while (u.readUInt32LE(o) === 0x04034b50) { const m = u.readUInt16LE(o + 8), cs = u.readUInt32LE(o + 18), nl = u.readUInt16LE(o + 26), xl = u.readUInt16LE(o + 28), name = u.toString('utf8', o + 30, o + 30 + nl), raw = u.subarray(o + 30 + nl + xl, o + 30 + nl + xl + cs); out[name] = m === 8 ? zlib.inflateRawSync(raw) : raw; o += 30 + nl + xl + cs; } return out; };
    await page.click('#nav button[data-view="beam"]'); await page.waitForTimeout(150);
    const [cx] = await Promise.all([page.waitForEvent('download'), page.click('.calcpack[data-cp="beam"] [data-cpdl="xlsx"]')]);
    const cxp = path.join(shots, cx.suggestedFilename()); await cx.saveAs(cxp);
    const parts = unzip(fs.readFileSync(cxp)), names = [...String(parts['xl/workbook.xml'] || '').matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]);
    console.log('calc package'.padEnd(30), cx.suggestedFilename(), '·', names.join(', '));
    if (!['Summary', 'Inputs', 'MB sheets', 'Beam options', 'Shop rules', 'Columns', 'Frame loads', 'Sources'].every(n => names.includes(n))) fail('the calc package should carry every sheet');
    if (/NaN|undefined/.test(Object.values(parts).map(String).join(''))) fail('the calc package has NaN / undefined in it');
    await page.click('#nav button[data-view="column"]'); await page.waitForTimeout(150);
    // the zip is the design basis with the filled workbooks: offered once the workbooks are added
    const zipOn = await page.$eval('.calcpack[data-cp="col"] [data-cpdl="all"]', b => !b.disabled);
    if (zipOn !== fs.existsSync(path.join(wbDir, 'IBC_Seismic.xls'))) fail('"Everything (.zip)" should be on exactly when workbooks are added');
    if (zipOn) {
      const [cz] = await Promise.all([page.waitForEvent('download'), page.click('.calcpack[data-cp="col"] [data-cpdl="all"]')]);
      const czp = path.join(shots, cz.suggestedFilename()); await cz.saveAs(czp);
      const zn = Object.keys(unzip(fs.readFileSync(czp)));
      console.log('calc package zip'.padEnd(30), cz.suggestedFilename(), '·', zn.length, 'files ·', zn.filter(n => n.startsWith('workbooks/')).length, 'filled workbooks');
      if (!zn.some(n => /\.xlsx$/.test(n))) fail('the zip should carry the calc package');
      if (!zn.some(n => /^workbooks\/.+\.xls$/.test(n))) fail('the zip should carry the filled workbooks');
    }
  }

  const allLightest = async () => { for (let k = 0; k < 8; k++) { const b = await page.$('#options [data-opt="lightest"]'); if (!b) break; await b.click(); await page.waitForTimeout(180); } };
  // beam options on the results page
  await page.click('#nav button[data-view="results"]');
  const opts = await page.$$eval('#options .option', os => os.length);
  if (opts < 2) fail('expected at least two beam options');
  for (const k of ['fit', 'econ']) {
    const b = await page.$(`#options [data-opt="${k}"]`);
    if (!b) continue;
    await b.click(); await page.waitForTimeout(150); await log('option ' + k);
  }
  // back to the lightest on every mark (the cards list each mark's options; no button where the lightest is on the quote)
  await allLightest();
  if (await quote() !== base) fail('back to lightest did not restore the quote');

  // pick a depth from the beam calc table, then return
  await page.click('#nav button[data-view="beam"]');
  // the long tables are folded: open the depth table, and the explanation, before using them
  await page.$$eval('#v-beam details.fold, #v-beam details.explain', ds => ds.forEach(d => { d.open = true; }));
  const how = await page.$eval('#beamHow', e => e.innerText);
  console.log('Beam explanation'.padEnd(30), how.split('\n').length, 'lines ·', /How deep it can be/.test(how) && /The plates/.test(how) && /The options/.test(how) && /step by step/i.test(how) ? 'steps present' : 'MISSING');
  if (!/How deep it can be/.test(how) || !/The options/.test(how) || !/Best fit, step by step/i.test(how)) fail('the beam explanation should list the steps and the best-fit method');
  const depths = await page.$$eval('#altTable tr.pick', trs => trs.map(t => t.dataset.d));
  await page.click(`#altTable tr.pick[data-d="${depths[Math.floor(depths.length / 2)]}"]`); await log(`picked ${depths[Math.floor(depths.length / 2)]}" row`);
  await page.click('#nav button[data-view="results"]');
  // back to lightest (no button when the picked row is the lightest section already: it is "In the quote")
  await allLightest();

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

  // column override (the tried-columns table is folded: open it); the explanation lists the steps
  await page.click('#nav button[data-view="column"]');
  await page.$$eval('#v-column details.fold, #v-column details.explain', ds => ds.forEach(d => { d.open = true; }));
  if (await page.$('#colHow li') && !/Sizes, in order/.test(await page.$eval('#colHow', e => e.innerText))) fail('the column explanation should list the sizes tried');
  await page.selectOption('#colPick', 'W12X26'); await log('column override W12X26');
  await page.selectOption('#colPick', '');

  // inputs: live load, clearance C, deck type and concrete drive the dead load
  await page.click('#nav button[data-view="inputs"]');
  const fillIn = async (p, v) => { await page.fill(`#inputsGrid input[data-path="${p}"]`, v); await page.press(`#inputsGrid input[data-path="${p}"]`, 'Tab'); await page.waitForTimeout(150); };
  const dead = () => page.$eval('#inputsGrid input[data-path="loads.dead"]', e => e.value);
  // several mezzanines: the round trip edits the one on screen only (their C can differ: an edit of every mezzanine
  // would type this one's C on the others)
  const linked = await page.$('#linkSeg button[data-l="0"]');
  if (linked) await linked.click();
  const c0 = await page.$eval('#inputsGrid input[data-path="geom.C"]', e => e.value);   // the PCS value, or empty for "no requirement"
  const live0 = await page.$eval('#inputsGrid input[data-path="loads.live"]', e => e.value);   // the job's own live load
  await fillIn('loads.live', '150'); await log('live 150 psf');
  await fillIn('geom.C', `10'-6"`); await log('C = 10\'-6" requested');
  await fillIn('geom.C', '');
  // clearing C makes it an open value again: the Design page asks; "No requirement", or the PCS value typed back, restores the start
  await page.click('#nav button[data-view="results"]');
  if (!(await page.$('#needCard .chip[data-need="geom.C"][data-v="none"]'))) fail('clearing C should ask for it again');
  else { await page.click('#needCard .chip[data-need="geom.C"][data-v="none"]'); await page.waitForTimeout(200); }
  await page.click('#nav button[data-view="inputs"]');
  if (c0) await fillIn('geom.C', c0);
  await fillIn('loads.live', live0);
  const d0 = await dead();
  // the deck and concrete as read off the PCS, to come back to; a dead load given on the PCS (a number or a blue note)
  // stays put, only the deck-guide value follows deck and concrete
  const deck0 = await page.$eval('#inputsGrid select[data-mezz="deck"]', e => e.value), conc0 = await page.$eval('#inputsGrid select[data-mezz="concrete"]', e => e.value);
  const deadSrc = await page.$eval('#inputsGrid input[data-path="loads.dead"]', e => { const b = e.closest('.field-row') && e.closest('.field-row').querySelector('.src'); return b ? b.className : ''; });
  const guide = /deckGuide|estimate/.test(deadSrc);
  // the other concrete weight than the PCS's (W2R-26047 is lightweight already): the deck-guide value follows it
  const conc1 = conc0 === 'LW' ? 'NW' : 'LW';
  await page.selectOption('#inputsGrid select[data-mezz="concrete"]', conc1); await page.waitForTimeout(150);
  const dLW = await dead(); await log(`${conc1} concrete (DL ${dLW})`);
  await page.selectOption('#inputsGrid select[data-mezz="deck"]', '2VL'); await page.waitForTimeout(150);
  const dLW2 = await dead(); await log(`${conc1} on 2VL (DL ${dLW2})`);
  await page.selectOption('#inputsGrid select[data-mezz="concrete"]', conc0); await page.selectOption('#inputsGrid select[data-mezz="deck"]', deck0); await page.waitForTimeout(150);
  console.log(`dead load ${conc0} / ${conc1} / ${conc1} 2VL`.padEnd(30), d0, dLW, dLW2, guide ? '(deck guide)' : `(given: ${deadSrc.replace('src ', '')})`);
  if (guide && !(conc1 === 'LW' ? +dLW < +d0 : +dLW > +d0)) fail('the deck-guide dead load should follow the concrete (lightweight lighter)');
  if (!guide && (dLW !== d0 || dLW2 !== d0)) fail('a dead load given on the PCS should not follow the deck / concrete');
  if (await dead() !== d0) fail('dead load did not return to the deck guide value');
  if (await quote() !== base) fail('inputs round-trip did not return to the default answer');
  if (linked) await page.click('#linkSeg button[data-l="1"]');

  // 3D model: controls, then find and click a beam by sweeping the canvas
  await page.click('#nav button[data-view="results"]');
  await page.click('#m3Pause'); await page.click('#m3Reset');
  for (const t of ['slab', 'joists', 'building']) { await page.click(`#modelToggles button[data-t="${t}"]`); await page.click(`#modelToggles button[data-t="${t}"]`); }
  await page.click('#m3In'); await page.click('#m3Out');
  // the slab and the joists bearing on the beams hide the beams' top faces: off while aiming
  for (const t of ['slab', 'joists']) await page.click(`#modelToggles button[data-t="${t}"]`);
  await page.$eval('#model3d', c => c.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const box = await page.$eval('#model3d', c => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  let hit = null;
  // aim at a beam's top face first (the renderer says where it is), then fall back to sweeping the canvas
  for (const id of (await page.evaluate(() => window.MZ_DEBUG && window.MZ_DEBUG.beams ? window.MZ_DEBUG.beams().slice(0, 6) : ['B1', 'B2', 'B3', 'B5']))) {
    const pt = await page.evaluate(i => window.MZ_DEBUG && window.MZ_DEBUG.modelPoint(i), id);
    if (!pt) continue;
    await page.mouse.move(box.x + pt[0], box.y + pt[1]); await page.waitForTimeout(60);   // the card follows a frame later
    const h = await page.$eval('#modelCard h4', e => e.textContent);
    if (/^B\d+ · /.test(h)) { hit = [box.x + pt[0], box.y + pt[1], h]; break; }
  }
  for (let j = 0.2; j < 0.86 && !hit; j += 0.01) {
    for (let i = 0.12; i < 0.88 && !hit; i += 0.025) {
      await page.mouse.move(box.x + box.w * i, box.y + box.h * j); await page.waitForTimeout(8);
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

  // 3D camera: zoom toward the pointer (the point under it stays put), pan with the right button, and — several
  // mezzanines — the View chips fly to each one and frame it (a mezzanine far down a long building fills the view)
  {
    const box3 = await page.$eval('#model3d', c => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const id0 = (await page.evaluate(() => window.MZ_DEBUG.beams()))[0];
    const at = () => page.evaluate(i => window.MZ_DEBUG.modelPoint(i), id0), view = () => page.evaluate(() => window.MZ_DEBUG.view());
    const p0 = await at(), z0 = (await view()).zoom;
    await page.mouse.move(box3.x + p0[0], box3.y + p0[1]); await page.mouse.wheel(0, -240); await page.waitForTimeout(250);
    const p1 = await at(), z1 = (await view()).zoom, drift = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const off = Math.hypot(p0[0] - box3.w / 2, p0[1] - box3.h / 2);   // how far a zoom about the middle would have moved it
    console.log('3D zoom at the pointer'.padEnd(30), `x${(z1 / z0).toFixed(2)}, the beam under it moved ${drift.toFixed(1)} px (${(off * (z1 / z0 - 1)).toFixed(0)} px about the middle)`);
    if (!(z1 > z0 * 1.3)) fail('the wheel did not zoom the 3D model');
    if (drift > Math.max(12, 0.2 * off * (z1 / z0 - 1))) fail(`zooming should keep the point under the pointer in place (moved ${drift.toFixed(1)} px)`);
    const t0 = (await view()).target;
    await page.mouse.move(box3.x + box3.w / 2, box3.y + box3.h / 2); await page.mouse.down({ button: 'right' });
    await page.mouse.move(box3.x + box3.w / 2 + 90, box3.y + box3.h / 2 + 40, { steps: 6 }); await page.mouse.up({ button: 'right' }); await page.waitForTimeout(150);
    const p2 = await at(), t1 = (await view()).target;
    console.log('3D pan (right-drag 90, 40)'.padEnd(30), `the beam moved ${(p2[0] - p1[0]).toFixed(0)}, ${(p2[1] - p1[1]).toFixed(0)} px`);
    // with the pointer: exactly on the plane through the target, a little less or more off it (perspective)
    if (Math.hypot(t1[0] - t0[0], t1[1] - t0[1], t1[2] - t0[2]) < 0.1 || Math.abs(p2[0] - p1[0] - 90) > 13 || Math.abs(p2[1] - p1[1] - 40) > 7) fail('a right-drag should pan the 3D model with the pointer');
    const groups = await page.evaluate(() => window.MZ_DEBUG.groups());
    if (groups.length > 1) {
      const chips = await page.$$eval('#modelFocus button', bs => bs.map(b => b.textContent));
      if (chips.length !== groups.length + 1 || chips[0] !== 'Whole job') fail('the View chips should be "Whole job" and each mezzanine: ' + chips.join(', '));
      const seen = [];
      for (const g of groups) {
        await page.click(`#modelFocus button[data-f="${g.id}"]`); await page.waitForTimeout(650);
        const v = await view(), cx = (g.box.x0 + g.box.x1) / 2, cy = (g.box.y0 + g.box.y1) / 2, diag = Math.hypot(g.box.x1 - g.box.x0, g.box.y1 - g.box.y0);
        seen.push(`${g.id} x${v.zoom.toFixed(1)}`);
        // at the mezzanine's middle (moved a little to frame it below the caption and chips laid over the canvas)
        if (v.moving || Math.hypot(v.target[0] - cx, v.target[1] - cy) > Math.max(1, 0.25 * diag)) fail(`View ${g.id}: the camera should come to the mezzanine's middle`);
        if (!(await page.$eval(`#modelFocus button[data-f="${g.id}"]`, b => b.classList.contains('is-on')))) fail(`View ${g.id}: its chip should be lit`);
      }
      await page.click('#modelFocus button[data-f=""]'); await page.waitForTimeout(650);
      console.log('3D view chips'.padEnd(30), seen.join(' · '), `· whole job x${(await view()).zoom.toFixed(1)}`);
      if (Math.abs((await view()).zoom - 1) > 1e-6) fail('"Whole job" should frame the whole job again');
    } else if (!(await page.$eval('#modelFocus', e => e.hidden))) fail('one mezzanine: no View chips');
    await page.click('#m3Reset'); await page.waitForTimeout(100);
  }

  // layout edits on the Plan page: a mezzanine column made a frame column, a column line added on the floor, undo, reset
  {
    await page.click('#nav button[data-view="plan"]'); await page.waitForTimeout(200);
    const nCols = () => page.$eval('#planStats .pstat.cols strong', e => parseInt(e.textContent, 10));
    const nBeams = () => page.$eval('#planStats .pstat.beams strong', e => parseInt(e.textContent, 10));
    const c0 = await nCols(), b0 = await nBeams(), q0 = await quote();
    await page.click('#layEdit'); await page.waitForTimeout(150);
    // the edit bar reads where the pointer is: from the LEW, and from the FSW and the BSW
    {
      await page.$eval('#planSvg rect.foot', e => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(500);
      const fb = await page.$eval('#planSvg rect.foot', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.37, y: r.top + r.height * 0.41 }; });
      await page.mouse.move(fb.x, fb.y); await page.waitForTimeout(80);
      const rd = await page.$eval('#layCoord', e => e.textContent);
      console.log('layout: pointer readout'.padEnd(30), rd);
      if (!/from the LEW .* from the FSW · .* from the BSW/.test(rd)) fail('the edit bar should read the pointer from the LEW and the FSW / BSW: ' + rd);
    }
    const col = await page.$('#planSvg .mcol[data-col]');
    if (col) {
      await col.click({ force: true });
      // the menu is drawn on the click: wait for it (a fixed pause raced the render on a busy machine)
      await page.waitForSelector('#layPop:not([hidden]) button[data-i]', { timeout: 5000 }).catch(() => {});
      const menu = await page.$eval('#layPop', e => e.innerText.replace(/\n+/g, ' | '));
      if (!/Make it a frame column/.test(menu)) fail('a mezzanine column should offer "Make it a frame column" — menu: ' + menu.slice(0, 200));
      await page.click('#layPop button[data-i="0"]'); await page.waitForTimeout(400);
      const c1 = await nCols();
      console.log('layout: frame column'.padEnd(30), `${c0} → ${c1} mezzanine columns`);
      if (c1 !== c0 - 1) fail('making a column a frame column should drop one mezzanine column');
      await page.click('#layUndo'); await page.waitForTimeout(400);
      if (await nCols() !== c0) fail('undo should bring the mezzanine column back');
      // a column with a beam on both sides can be taken out: the beam spans through (one beam instead of two)
      const keys = await page.$$eval('#planSvg .mcol[data-col]', es => es.map(e => e.dataset.col));
      let taken = false;
      for (const k of keys.slice(0, 16)) {
        await page.click(`#planSvg .mcol[data-col="${k}"]`, { force: true }); await page.waitForTimeout(120);
        const items = await page.$$eval('#layPop button[data-i]', bs => bs.map(b => b.innerText));
        const i = items.findIndex(t => /Take the column out/.test(t));
        if (i < 0) { await page.keyboard.press('Escape'); await page.waitForTimeout(80); continue; }
        await page.click(`#layPop button[data-i="${i}"]`); await page.waitForTimeout(400);
        const c2 = await nCols(), b2 = await nBeams();
        console.log('layout: column taken out'.padEnd(30), `${c0} → ${c2} columns, ${b0} → ${b2} beams`);
        if (c2 !== c0 - 1 || b2 !== b0 - 1) fail('taking a column out should leave one column and one beam fewer');
        await page.click('#layUndo'); await page.waitForTimeout(400);
        taken = true; break;
      }
      if (!taken && c0 >= 4) fail('no mezzanine column offers "Take the column out"');
      // drag a mezzanine column along its beam: the bar reads where it is going, it lands there (one column, moved); undo
      const colKeys = () => page.$$eval('#planSvg g.mcol[data-col]:not(.dropped)', es => es.map(e => e.dataset.col).sort());
      const along = /across the width/.test(await page.$eval('#layWhy', e => e.textContent)) ? 'x' : 'y';
      let dragged = false, ends = 0;
      for (const k of keys.slice(0, 24)) {
        const before = await colKeys();
        const at = await page.$eval(`#planSvg g.mcol[data-col="${k}"] circle.hit`, e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        const d = along === 'x' ? [24, 0] : [0, -24];
        await page.mouse.move(at.x, at.y); await page.mouse.down();
        await page.mouse.move(at.x + d[0] / 2, at.y + d[1] / 2, { steps: 3 }); await page.mouse.move(at.x + d[0], at.y + d[1], { steps: 3 });
        const rd = await page.$eval('#layCoord', e => e.textContent);
        if (/and its column line/.test(rd)) { ends++; await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(300); continue; }   // an end column moves its line: the next
        await page.mouse.up(); await page.waitForTimeout(450);
        const after = await colKeys();
        if (JSON.stringify(after) === JSON.stringify(before)) { await page.keyboard.press('Escape'); continue; }   // too close to a line: the next
        console.log('layout: column dragged'.padEnd(30), rd);
        if (!/→ .* from the LEW .* from the FSW/.test(rd)) fail('a dragged column should read where it is going: ' + rd);
        if (after.length !== before.length || await nCols() !== c0) fail('a dragged column should move, not add or drop one');
        await page.click('#layUndo'); await page.waitForTimeout(400);
        if (JSON.stringify(await colKeys()) !== JSON.stringify(before)) fail('undo should put the dragged column back');
        dragged = true; break;
      }
      if (!dragged && c0 >= 3 && ends < Math.min(24, keys.length)) fail('no mezzanine column could be dragged along its beam');
      // a typed spot: "Move this column to" — x from the LEW, y from the FSW or the BSW
      for (const k of keys.slice(0, 12)) {
        await page.click(`#planSvg .mcol[data-col="${k}"]`, { force: true }); await page.waitForTimeout(120);
        const items = await page.$$eval('#layPop button[data-i]', bs => bs.map(b => b.innerText));
        const i = items.findIndex(t => /Move this column to/.test(t));
        if (i < 0) { await page.keyboard.press('Escape'); await page.waitForTimeout(80); continue; }
        const before = await colKeys();
        const [x0, y0] = k.split('|').map(Number);
        const tx = along === 'x' ? x0 + 2.5 : x0, ty = along === 'x' ? y0 : y0 + 2.5;
        await page.fill('#layMvX', String(tx)); await page.fill('#layMvY', String(ty));
        await page.click(`#layPop button[data-i="${i}"]`); await page.waitForTimeout(450);
        const after = await colKeys(), moved = after.some(q => { const [x, y] = q.split('|').map(Number); return Math.abs(x - tx) < 0.01 && Math.abs(y - ty) < 0.01; });
        console.log('layout: column typed to'.padEnd(30), `${tx}, ${ty}${moved ? '' : ' (not moved: ' + (await page.$eval('#toast', e => e.textContent).catch(() => '')) + ')'}`);
        if (moved) { if (after.length !== before.length) fail('a typed move should keep the column count'); await page.click('#layUndo'); await page.waitForTimeout(400); }
        break;
      }
    }
    // a point on the floor of the first mezzanine, between its first two beam lines (clear of the beams and their tags)
    // and off the column lines
    const fp = await page.evaluate(() => {
      const f = document.querySelector('#planSvg rect.foot').getBoundingClientRect(), mid = (a, b) => (a + b) / 2;
      const rs = [...document.querySelectorAll('#planSvg line.beam[data-beam]')].map(l => l.getBoundingClientRect()).filter(r => r.left >= f.left - 3 && r.right <= f.right + 3 && r.top >= f.top - 3 && r.bottom <= f.bottom + 3);
      const vx = [...new Set(rs.filter(r => r.width < 12).map(r => Math.round(mid(r.left, r.right))))].sort((a, b) => a - b);
      const hy = [...new Set(rs.filter(r => r.height < 12).map(r => Math.round(mid(r.top, r.bottom))))].sort((a, b) => a - b);
      // across the beams, a quarter of the way in: clear of a column line in the middle of the floor
      return { x: vx.length > 1 ? mid(vx[0], vx[1]) : f.left + f.width * 0.27, y: hy.length > 1 ? mid(hy[0], hy[1]) : f.top + f.height * 0.27 };
    });
    await page.mouse.click(fp.x, fp.y); await page.waitForTimeout(200);
    const fm = await page.$eval('#layPop', e => (e.hidden ? '' : e.innerText));
    if (!/Add a column line/.test(fm)) fail('a click on the floor should open the add menu: ' + fm.replace(/\n+/g, ' | '));
    else {
      await page.click('#layPop button[data-i="1"]'); await page.waitForTimeout(500);
      const b1 = await nBeams();
      console.log('layout: column line added'.padEnd(30), `${b0} → ${b1} beams`);
      if (!(b1 > b0)) fail('a new column line should split the beams');
    }
    await page.click('#layReset'); await page.waitForTimeout(500);
    await page.click('#layDone');
    if (await nCols() !== c0 || await nBeams() !== b0 || await quote() !== q0) fail('"Reset layout" should restore the layout and the quote');
  }

  // design your own: start from a mark and the MB sheet answers; a new depth re-runs it; a section from "lighter sections
  // that pass" loads and goes on the quote for a mark; the Design page's lightest option brings the answer back
  await page.click('#nav button[data-view="designer"]'); await page.waitForTimeout(150);
  await page.click('#dzTabs button[data-t="beam"]'); await page.waitForTimeout(100);
  const dzHead = () => page.$eval('#dzOut .dz-res-head', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
  const srcOpts = await page.$$eval('#dzFrom option', os => os.map(o => o.value).filter(Boolean));
  if (!srcOpts.length) fail('the designer should offer the job\'s marks to start from');
  else {
    await page.selectOption('#dzFrom', srcOpts[0]); await page.waitForTimeout(200);
    const h1 = await dzHead();
    console.log('designer: from the job'.padEnd(30), h1);
    if (!/Passes/.test(h1)) fail('the job\'s own section should pass in the designer');
    const d0 = +(await page.$eval('#dzBody [data-dz="beam.d"]', e => e.value).catch(() => 0));
    if (d0) {
      await page.fill('#dzBody [data-dz="beam.d"]', String(d0 - 2)); await page.waitForTimeout(200);
      const h2 = await dzHead();
      console.log(`designer: ${d0 - 2}" deep`.padEnd(30), h2);
      if (!h2.includes(`BU${d0 - 2}x`)) fail('a new depth should re-run the MB sheet');
      await page.click('#dzNear'); await page.waitForTimeout(500);
      const near = await page.$$eval('#dzOut .dz-near tbody tr', trs => trs.filter(t => t.cells.length > 2).map(t => (t.cells[1].querySelector('b') || t.cells[1]).textContent.trim()));
      console.log('designer: lighter, passing'.padEnd(30), near.join(', ') || 'none');
      if (near.length) {
        const i = near.length - 1;
        await page.click(`#dzOut .dz-take[data-i="${i}"]`); await page.waitForTimeout(200);
        const h3 = await dzHead();
        if (!h3.includes(near[i]) || !/Passes/.test(h3)) fail('a loaded section should show, passing');
        const mark = await page.$eval('#dzBody [data-dz="beam.useMark"]', e => e.value);
        await page.click('#dzUse'); await page.waitForTimeout(300);
        const q = await log(`designer: ${mark} → ${near[i]}`);
        if (!q.includes(near[i])) fail('"Use this section" should put it on the quote');
        await page.click('#nav button[data-view="results"]'); await page.waitForTimeout(150);
        await allLightest();
        if (await quote() !== base) fail('the lightest option after the designer should restore the quote');
        // a mark the designer took from the job follows the job: load it, pick another option for it on the Design
        // page, come back — the designer shows the section the mark has now, not the one it was loaded with
        await page.click('#nav button[data-view="designer"]'); await page.click('#dzTabs button[data-t="beam"]'); await page.waitForTimeout(150);
        await page.selectOption('#dzFrom', srcOpts[0]); await page.waitForTimeout(200);
        await page.click('#nav button[data-view="results"]'); await page.waitForTimeout(150);
        const other = await page.$(`#options button[data-opt][data-mark="${srcOpts[0]}"]:not([data-opt="lightest"])`);
        if (other) {
          await other.click(); await page.waitForTimeout(300);
          await page.click('#nav button[data-view="designer"]'); await page.waitForTimeout(200);
          const fromLab = await page.$eval('#dzFrom', e => (e.selectedOptions[0] && e.value ? e.selectedOptions[0].textContent : '')), secNow = (fromLab.match(/\b(BU\d+x\d+|W\d+X\d+)\b/) || [])[1];
          const h4 = await dzHead();
          console.log('designer: follows the job'.padEnd(30), `${srcOpts[0]} now ${secNow} → ${h4}`);
          if (!secNow || !h4.includes(secNow)) fail(`the designer should show the job's ${secNow} for ${srcOpts[0]}, not an earlier section`);
          await page.click('#nav button[data-view="results"]'); await page.waitForTimeout(150);
          await allLightest();
          if (await quote() !== base) fail('the lightest option should restore the quote');
        } else console.log('designer: follows the job'.padEnd(30), `(${srcOpts[0]} has one option)`);
      }
    }
  }
  await page.click('#nav button[data-view="designer"]'); await page.click('#dzTabs button[data-t="col"]'); await page.waitForTimeout(150);
  const colSrc = await page.$$eval('#dzFrom option', os => os.map(o => o.value).filter(Boolean));
  if (colSrc.length) { await page.selectOption('#dzFrom', colSrc[0]); await page.waitForTimeout(200); }
  const colHead = await dzHead();
  console.log('designer: column'.padEnd(30), colHead);
  if (!/max CSR \d/.test(colHead)) fail('the column designer should show the Column sheet answer');
  await page.click('#dzTabs button[data-t="beam"]');
  await page.click('#nav button[data-view="results"]'); await page.waitForTimeout(150);

  // copy buttons: the rail goes to the quote sheet; each table copies for its own cell (A7 / A17 / A37)
  await page.click('#copyQuote'); await page.waitForTimeout(300);
  await page.click('#quoteSheet [data-copy="beams"]'); await page.waitForTimeout(150);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  if (clip != null) {
    console.log('clipboard lines'.padEnd(30), clip.split('\n').length);
    if (!clip.includes('\t') || !/BU\d+x\d+/.test(clip) || !clip.includes('=IF(B17="","",')) fail('copied beam rows are not the MEZZ sheet\'s cells (tab-separated, BU section, the sheet\'s formulas)');
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
    const qPre = await quote(), liveB = await page.$eval('#inputsGrid input[data-path="loads.live"]', e => e.value), liveNew = String(+liveB + 25);
    await page.fill('#inputsGrid input[data-path="loads.live"]', liveNew); await page.press('#inputsGrid input[data-path="loads.live"]', 'Tab'); await page.waitForTimeout(200);
    await pick(ids[0]);
    const q2 = await quote();
    console.log(`mezz 2 live ${liveNew}, back on 1`.padEnd(30), q2);
    if (q2 === qPre) fail("the other mezzanine's edit should show in the job quote");
    await pick(ids[1]); await page.click('#nav button[data-view="inputs"]');
    await page.fill('#inputsGrid input[data-path="loads.live"]', liveB); await page.press('#inputsGrid input[data-path="loads.live"]', 'Tab'); await page.waitForTimeout(200);
    // every mezzanine (the default): one edit reaches both
    await page.click('#linkSeg button[data-l="1"]');
    await page.fill('#inputsGrid input[data-path="loads.partition"]', '10'); await page.press('#inputsGrid input[data-path="loads.partition"]', 'Tab'); await page.waitForTimeout(250);
    const parts = await page.$$eval('#quoteSheet table', ts => [...ts[0].querySelectorAll('tbody tr')].map(tr => tr.cells[8].textContent.trim()));   // I: PART.
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
