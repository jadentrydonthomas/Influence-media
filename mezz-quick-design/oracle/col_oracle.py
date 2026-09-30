"""Run column cases through the real Mezzanine Column workbook (Column sheet, AISC ASD path).

usage: python3 col_oracle.py cases.json results.json [workbook.xls]
cases: [{sec:{type:'WF',name}|{type:'BU',d,tw,bof,tof}, Fy, L, DL_L, LL_L, DL_R, LL_R}]
"""
import json
import sys

from lo import start, open_book, drop_modules, patch_pi, setv, getv

# Modules LibreOffice Basic cannot compile; they are not on the AISC ASD path (Canadian / import / UI).
DROP = ['CanadianIShapeMemberAnalysis', 'IShapeSectionProperties', 'LRD_Module1', 'TestModule1', 'ImportRoutines_MBS',
        'Results_Interface', 'Section_Properties_New', 'Report_Unit_Conversion', 'SheetFormattingUSCan', 'BasePlateCalcs',
        'PrintMacros', 'StartupTools', 'DataRoutines_ProjSpecInfo', 'AutoRoutine_Groups', 'General_Info',
        'Sheet01', 'Sheet1', 'Sheet14', 'Sheet16', 'Sheet17', 'Sheet18']


def main():
    cases = json.load(open(sys.argv[1]))
    book = sys.argv[3] if len(sys.argv) > 3 else 'Mezzanine_Column_15th_S16-14.xls'
    desktop = start()
    doc = open_book(desktop, book)
    drop_modules(doc, DROP)
    patch_pi(doc)
    sh = doc.Sheets
    col, misc, mr = sh.getByName('Column'), sh.getByName('Miscellaneous'), sh.getByName('Main Report')
    out = []
    for c in cases:
        s = c['sec']
        setv(misc, 'K8', str(int(c['Fy'])))
        setv(col, 'C8', c['L'])
        if 'Lby' in c:
            setv(col, 'C10', c['Lby'])
        if s['type'] == 'WF':
            setv(col, 'C16', s['name'])
        else:
            setv(col, 'C16', 'Built-Up')
            for a, v in [('C17', s['d']), ('C18', s['bof']), ('C19', s['tof']), ('C20', s['tw'])]:
                setv(col, a, v)
        for a, v in [('C27', c['DL_L']), ('D27', c['LL_L']), ('C28', c['DL_R']), ('D28', c['LL_R'])]:
            setv(col, a, v)
        doc.calculateAll()
        r = {}
        for L in 'CDE':
            for row in (33, 34, 39, 40):
                r[f'COL.{L}{row}'] = getv(col, f'{L}{row}')
        for a in ('G46', 'H46', 'I46', 'G22', 'G25'):
            r['MR.' + a] = getv(mr, a)
        out.append(r)
    json.dump(out, open(sys.argv[2], 'w'), indent=1)
    doc.close(True)
    try:
        desktop.terminate()
    except Exception:
        pass


if __name__ == '__main__':
    main()
