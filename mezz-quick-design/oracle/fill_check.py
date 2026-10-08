"""Open the workbooks filled by src/xls.js (oracle/fill_dump.js) as they are, recalculate, and read back.

usage: python3 oracle/fill_check.py out_dir
Two checks per copy: xlrd (a strict BIFF8 reader) opens the file and reads the typed cells back; LibreOffice opens
it, recalculates, and the results are compared with what the tool says the workbook will show.
"""
import json
import os
import sys

import xlrd

from lo import start, drop_modules, patch_pi, getv, pv
from col_oracle import DROP
import uno


def rc(a):
    col = ''.join(ch for ch in a if ch.isalpha()).upper()
    c = 0
    for ch in col:
        c = c * 26 + ord(ch) - 64
    return int(''.join(ch for ch in a if ch.isdigit())) - 1, c - 1


def main():
    out = sys.argv[1]
    items = json.load(open(os.path.join(out, 'filled.json')))
    bad = 0
    n = 0
    # 1. structure: xlrd reads every copy and finds the typed values
    for it in items:
        bk = xlrd.open_workbook(os.path.join(out, it['file']), on_demand=True)
        for st in it['steps']:
            sh = bk.sheet_by_name(st['sheet'])
            r, c = rc(st['cell'])
            v = sh.cell_value(r, c)
            want = st['value']
            ok = (v == '' if want is None else (v == (1 if want else 0) and sh.cell_type(r, c) == xlrd.XL_CELL_BOOLEAN) if isinstance(want, bool) else abs(float(v) - want) < 1e-9 if isinstance(want, (int, float)) else str(v) == str(want))
            n += 1
            if not ok:
                bad += 1
                print(f"  xlrd ✗ {it['file']} {st['sheet']}!{st['cell']}: {v!r} · typed {want!r}")
        bk.release_resources()
    print(f'xlrd: {n} typed cells read back, {bad} differ')
    # 2. LibreOffice: open the copy, recalculate, read
    desk = start()
    m = 0
    for it in items:
        url = uno.systemPathToFileUrl(os.path.abspath(os.path.join(out, it['file'])))
        doc = desk.loadComponentFromURL(url, '_blank', 0, (pv('Hidden', True), pv('MacroExecutionMode', 4)))
        if 'Column' in it['book']:
            drop_modules(doc, DROP)
        patch_pi(doc)
        if 'Seismic' in it['book']:
            # LibreOffice reads the hidden lateral sheets' "" as 0 in the least-R min (see seismic_oracle.py)
            misc = doc.Sheets.getByName('Miscellaneous')
            for a, f in [('L8', '=L3'), ('M8', '=M3'), ('N8', '=N3')]:
                misc.getCellRangeByName(a).setFormula(f)
        doc.calculateAll()
        sh = doc.Sheets
        for r in it['read']:
            got = getv(sh.getByName(r['sheet']), r['cell'])
            want = r['expect']
            m += 1
            if isinstance(want, (int, float)) and not isinstance(want, bool):
                tol = 1 if 'L /' in r['label'] else max(0.0015, abs(want) * 0.002)
                ok = isinstance(got, float) and abs(got - want) <= tol
            else:
                ok = str(got) == str(want)
            if not ok:
                bad += 1
                print(f"  LO ✗ {it['file']} {r['sheet']}!{r['cell']} {r['label']}: workbook {got!r} · tool {want!r}")
        doc.close(True)
    print(f'LibreOffice: {m} results read after recalculating the filled copies, {bad} differ in all')
    try:
        desk.terminate()
    except Exception:
        pass
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
