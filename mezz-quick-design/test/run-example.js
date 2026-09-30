// Parse a PCS and run the full design, printing what the quote needs.
const { readPcs } = require('./pdf-node.js');
const PCS = require('../src/pcs.js');
const RUN = require('../src/run.js');
(async () => {
  const pages = await readPcs(process.argv[2]);
  const pcs = PCS.parse(pages);
  const inp = RUN.inputsFromPCS(pcs, 0);
  const settings = JSON.parse(process.argv[3] || '{}');
  const t0 = Date.now();
  const res = RUN.run(inp, settings);
  console.log('run ms', Date.now() - t0);
  console.log('edition', res.edition.ed, 'division', res.division, 'layout:', res.layout.joists, res.layout.why, 'beams', res.layout.beams.length, 'mezzCols', res.layout.mezzCols.map(c => c.label).join(' '));
  console.log('beam lines', res.layout.beamLines, 'supports', res.layout.supportLines);
  res.layout.beams.forEach(b => console.log('  beam', b.id, 'line', b.line, b.from, '->', b.to, 'span', b.span, 'trib', b.trib));
  console.log('joist depth in', res.joistDepthIn, 'colLen', res.colLen);
  res.marks.forEach(mk => {
    console.log(mk.mark, mk.desc, 'span', mk.span, 'trib', mk.trib, 'qty', mk.qty, mk.sec && JSON.stringify(mk.sec));
    const c = mk.check; if (c) console.log('   CSR', c.res.CSR.toFixed(3), 'SRv', c.res.SRvx.toFixed(3), 'L/', c.defl.rDL.toFixed(0), c.defl.rLL.toFixed(0), c.defl.rTL.toFixed(0), 'conc', c.conc && c.conc.max.toFixed(3), 'V_D', c.V.D.toFixed(3), 'V_L', c.V.L.toFixed(3));
    if (mk.search) mk.search.byDepth.forEach(r => console.log('     d', r.d, r.none ? '-' : `${r.desc} ${r.web} ${r.flange} ${r.tier} CSR ${r.CSR.toFixed(3)} V ${r.SRv.toFixed(3)} LL ${r.rLL.toFixed(0)} TL ${r.rTL.toFixed(0)}`));
    if (mk.search) console.log('   evaluated', mk.search.evaluated);
  });
  res.columns.forEach(c => console.log('col', c.label, [c.DL_L, c.LL_L, c.DL_R, c.LL_R].map(x => x.toFixed(2)).join(' ')));
  res.colGroups.forEach(g => console.log('group', g.key, 'n', g.cols.length, g.design && g.design.name, g.design && g.design.tried.map(t => t.name + ':' + t.max.toFixed(3)).join(' ')));
  console.log('colFinal', res.colFinal && res.colFinal.name, res.colFinal && res.colFinal.max.toFixed(3));
  console.log('clear', JSON.stringify(res.clear));
  res.warn.forEach(w => console.log('WARN', w.level, w.text));
  console.log('\n' + RUN.quoteText(res, inp));
})().catch(e => { console.error(e); process.exit(1); });
