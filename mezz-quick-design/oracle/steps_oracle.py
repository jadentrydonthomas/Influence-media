"""Type the tool's step-by-step Excel entries into the real workbooks and read back what Excel shows.

usage: python3 steps_oracle.py steps.json results.json
steps.json: [{file, runs: [{steps: [{sheet, cell, value}], read: [{sheet, cell}]}]}]  (from oracle/steps_dump.js)
Each run starts from the state the previous run left (as when typing a job into one workbook).
"""
import json
import sys

from lo import start, open_book, drop_modules, patch_pi, setv, getv
from col_oracle import DROP


def main():
    books = json.load(open(sys.argv[1]))
    desktop = start()
    out = []
    for b in books:
        doc = open_book(desktop, b['file'])
        if 'Column' in b['file']:
            drop_modules(doc, DROP)
        patch_pi(doc)
        sh = doc.Sheets
        runs = []
        for run in b['runs']:
            for st in run['steps']:
                cell = sh.getByName(st['sheet']).getCellRangeByName(st['cell'])
                if st['value'] is None:
                    cell.setString('')
                else:
                    setv(sh.getByName(st['sheet']), st['cell'], st['value'])
            doc.calculateAll()
            runs.append([getv(sh.getByName(r['sheet']), r['cell']) for r in run['read']])
        out.append(runs)
        doc.close(True)
    json.dump(out, open(sys.argv[2], 'w'), indent=1)
    try:
        desktop.terminate()
    except Exception:
        pass


if __name__ == '__main__':
    main()
