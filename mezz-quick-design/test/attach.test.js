// Buildings attached along a sidewall (Box 2 "Building Attachment"): where an attached building's points sit in the
// building it attaches to, and back. Back to back (BSW to BSW) it is turned 180°; BSW to FSW it runs the same way.
const assert = require('assert');
const RUN = require('../src/run.js');
const near = (p, q) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
const host = { width: 99.0417, length: 158.625 }, lean = { width: 28.1667, length: 159.9583 };

// lean-to BSW on the main BSW, 0'-0" from the left steel line (seen from outside a BSW, its left end is the REW)
const bb = RUN.attachMap({ wall: 'BSW', toWall: 'BSW', at: 0 }, host, lean);
assert.ok(bb.rot180);
assert.ok(near(bb.toHost(0, 0), { x: 158.625, y: 99.0417 + 28.1667 }), "lean-to LEW / FSW corner at the main REW, line A");
assert.ok(near(bb.toHost(0, 28.1667), { x: 158.625, y: 99.0417 }), 'its BSW on the main BSW');
assert.ok(near(bb.toHost(159.9583, 28.1667), { x: 158.625 - 159.9583, y: 99.0417 }), "1'-4\" past the main LEW, as drawn");
// lean-to BSW on the main FSW: same direction, below the FSW
const bf = RUN.attachMap({ wall: 'BSW', toWall: 'FSW', at: 0 }, { width: 120, length: 140 }, { width: 20, length: 140 });
assert.ok(!bf.rot180);
assert.ok(near(bf.toHost(10, 20), { x: 10, y: 0 }) && near(bf.toHost(10, 0), { x: 10, y: -20 }));
// an offset along the wall, and every case maps back
const off = RUN.attachMap({ wall: 'FSW', toWall: 'BSW', at: 12 }, { width: 60, length: 100 }, { width: 15, length: 40 });
assert.ok(near(off.toHost(0, 0), { x: 100 - 12 - 40, y: 60 }), 'FSW to BSW: same direction, starts "at" from the REW end');
for (const m of [bb, bf, off, RUN.attachMap({ wall: 'FSW', toWall: 'FSW', at: 5 }, { width: 60, length: 100 }, { width: 15, length: 40 })]) {
  [[0, 0], [7.5, 3.25], [40, 15]].forEach(([x, y]) => assert.ok(near(m.fromHost(m.toHost(x, y).x, m.toHost(x, y).y), { x, y }), 'round trip'));
}
// endwall attachments and missing sizes are not mapped
assert.strictEqual(RUN.attachMap({ wall: 'LEW', toWall: 'REW', at: 0 }, host, lean), null);
assert.strictEqual(RUN.attachMap({ wall: 'BSW', toWall: 'BSW', at: 0 }, host, { width: 0, length: 10 }), null);
console.log('attach tests passed (BSW→BSW turned 180°, BSW→FSW / FSW→BSW same way, offsets, round trips)');
