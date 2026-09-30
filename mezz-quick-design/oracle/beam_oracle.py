"""Run beam cases through the real Mezzanine Beam Design workbook (MB1 sheet).

usage: python3 beam_oracle.py cases.json results.json [workbook.xls]
cases: [{dead, coll, live, joistWt, L, Lb, trib, axial?, sec:{d,tw,bof,tof,bif,tif}}]
"""
import json
import sys

from lo import start, open_book, patch_pi, setv, getv

MB_OUT = ['D17', 'D19', 'D20', 'D21', 'D22', 'D23', 'H6', 'H8', 'H10', 'H12', 'H14', 'H16',
          'K6', 'K7', 'K10', 'K11', 'K14', 'K15', 'J12', 'J16', 'L7', 'G19', 'G20', 'M20']
MR_OUT = ['G46', 'G47', 'G48', 'G49']
CONC_OUT = ['G18', 'G42', 'G43', 'G44', 'G45', 'G46', 'G47', 'G48']


def main():
    cases = json.load(open(sys.argv[1]))
    book = sys.argv[3] if len(sys.argv) > 3 else 'Mezzanine_Beam_Design_15th.xls'
    desktop = start()
    doc = open_book(desktop, book)
    patch_pi(doc)
    sh = doc.Sheets
    inp, mb, mr = sh.getByName('INPUT'), sh.getByName('MB1'), sh.getByName('Main Report')
    conc, sec = sh.getByName('Concentrated Load Checks'), sh.getByName('Secondary Report')
    out = []
    for c in cases:
        s = c['sec']
        for a, v in [('D14', c['dead']), ('D15', c['coll']), ('D16', c['live']), ('D17', c['joistWt'])]:
            setv(inp, a, v)
        for a, v in [('D7', c['L']), ('D8', c['Lb']), ('D9', c['trib']),
                     ('M22', s['d']), ('M23', s['tw']), ('M24', s['bof']), ('M25', s['tof']),
                     ('M26', s['bif']), ('M27', s['tif']), ('Q4', 2)]:
            setv(mb, a, v)
        if c.get('axial'):
            setv(mb, 'D15', c['axial'])
        else:
            mb.getCellRangeByName('D15').setString('')
        doc.calculateAll()
        r = {'MB.' + a: getv(mb, a) for a in MB_OUT}
        r.update({'MR.' + a: getv(mr, a) for a in MR_OUT})
        r.update({'CONC.' + a: getv(conc, a) for a in CONC_OUT})
        r['SR.G22'] = getv(sec, 'G22')
        out.append(r)
    json.dump(out, open(sys.argv[2], 'w'), indent=1)
    doc.close(True)
    try:
        desktop.terminate()
    except Exception:
        pass


if __name__ == '__main__':
    main()
