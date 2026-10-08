"""Run seismic cases through NBG's IBC Seismic workbook (LibreOffice UNO) and dump what it computes.

usage: python3 oracle/seismic_oracle.py cases.json results.json [IBC_Seismic.xls]
A case: { code (workbook CodeChoice 1..7), occupancy ('Low Hazard'|'Standard Buildings'|'Substantial Hazard'|
  'Essential Facilities'), rooftype, width, length, dtr, slope, leh, heh, Ss, S1, site, SW, RDL, CDL, RSW, Pf,
  walls: {lew, rew, fsw, bsw}, vertical, ignoreNDFS, mezz: [{elev, FDL, FLC, FLJ, FLL, FLP, storage}],
  lat: {type, bay, at: 1 LEW | 2 REW | 3 interior, story, area: [..], conc: [..]},
  long: {types: [fsw, bsw], area: [..], conc: [..]} }
The workbook is Nucor-internal and not in the repo (private/workbooks/).
"""
import json
import sys

import lo

IN = 'Input Data'
LAT = 'Lateral Calcs. (1)'
LONG = 'Longitudinal Calcs.'


def main():
    cases = json.load(open(sys.argv[1]))
    book = sys.argv[3] if len(sys.argv) > 3 else 'IBC_Seismic.xls'
    desk = lo.start()
    doc = lo.open_book(desk, book)
    sh = doc.Sheets
    inp, lat, lng = sh.getByName(IN), sh.getByName(LAT), sh.getByName(LONG)
    sdc, misc = sh.getByName('Seismic Design Calcs.'), sh.getByName('Miscellaneous')
    out = []
    for c in cases:
        lo.setv(sdc, 'D11', c['code'])
        for a, k in [('B7', 'occupancy'), ('B8', 'rooftype'), ('B9', 'width'), ('B10', 'length'), ('B11', 'dtr'),
                     ('B12', 'slope'), ('B13', 'leh'), ('B14', 'heh'), ('B26', 'Ss'), ('B27', 'S1'), ('B29', 'site'),
                     ('B33', 'SW'), ('B34', 'RDL'), ('B35', 'CDL'), ('B36', 'RSW'), ('B37', 'Pf')]:
            lo.setv(inp, a, c[k])
        lo.setv(inp, 'B18', 'Flexible')
        lo.setv(inp, 'B19', 'Rigid' if c.get('rigid') else 'None')
        lo.setv(inp, 'B21', 1 if c.get('vertical', True) else 0)
        lo.setv(inp, 'B22', 0)
        lo.setv(inp, 'F16', 1 if c.get('ignoreNDFS') else 0)
        w = c['walls']
        for a, k in [('B47', 'lew'), ('F47', 'rew'), ('B59', 'fsw'), ('F59', 'bsw')]:
            lo.setv(inp, a, w[k])
        # wall elevations follow the geometry (full height): reset in case an earlier case typed over them
        inp.getCellRangeByName('B46').setFormula('=mrh')
        inp.getCellRangeByName('F46').setFormula('=mrh')
        inp.getCellRangeByName('B58').setFormula('=leh')
        inp.getCellRangeByName('F58').setFormula('=heh')
        mz = c.get('mezz', [])
        for i, col in enumerate(['B', 'F']):
            m = mz[i] if i < len(mz) else None
            for r, k in [(89, 'elev'), (90, 'FDL'), (91, 'FLC'), (92, 'FLJ'), (94, 'FLL'), (95, 'FLP')]:
                cell = inp.getCellRangeByName(f'{col}{r}')
                if m is None:
                    cell.setString('')
                else:
                    cell.setValue(m.get(k, 0))
            lo.setv(misc, 'B36' if i == 0 else 'B38', 1 if (m and m.get('storage')) else 0)
        L = c['lat']
        lo.setv(lat, 'B9', L['type'])
        lo.setv(lat, 'B18', L['bay'])
        lo.setv(lat, 'Q1', L['at'])
        lo.setv(lat, 'B30', 'YES' if L.get('story') else 'NO')
        lo.setv(lat, 'B26', 0)
        for (ra, rc), i in [(('B31', 'B32'), 0), (('B34', 'B35'), 1)]:
            lo.setv(lat, ra, L['area'][i] if i < len(L.get('area', [])) else 0)
            lo.setv(lat, rc, L['conc'][i] if i < len(L.get('conc', [])) else 0)
        G = c['long']
        lo.setv(lng, 'B8', G['types'][0])
        lo.setv(lng, 'B9', G['types'][1])
        lo.setv(lng, 'B22', 0)
        for (ra, rc), i in [(('B27', 'B28'), 0), (('B30', 'B31'), 1)]:
            lo.setv(lng, ra, G['area'][i] if i < len(G.get('area', [])) else 0)
            lo.setv(lng, rc, G['conc'][i] if i < len(G.get('conc', [])) else 0)
        # R_lat (least R of the visible lateral sheets, 12.2.3.3) is a VBA min over a range holding "" for the hidden
        # sheets; LibreOffice reads those as 0. With only sheet (1) in use Excel gives sheet (1)'s own factors.
        for a, f in [('L8', '=L3'), ('M8', '=M3'), ('N8', '=N3')]:
            misc.getCellRangeByName(a).setFormula(f)
        doc.calculateAll()
        g = lambda s, a: lo.getv(s, a)
        res = {
            'Fa': g(lat, 'C45'), 'Fv': g(lat, 'C46'), 'Sds': g(lat, 'C49'), 'Sd1': g(lat, 'C50'), 'SDC': g(lat, 'C51'),
            'mrh': g(inp, 'B15'),
            'lat': {'R': g(lat, 'C52'), 'Ct': g(lat, 'C55'), 'Ta': g(lat, 'C56'), 'Cs': g(lat, 'C62'), 'k': g(lat, 'F62'),
                    'V': g(lat, 'C61'), 'warn': g(lat, 'E15'),
                    'rows': {str(r): [g(lat, f'{col}{r}') for col in 'BCDEF'] for r in range(67, 80)},
                    'G64': g(lat, 'G64'), 'H64': g(lat, 'H64'), 'G67': g(lat, 'G67'), 'H67': g(lat, 'H67'),
                    'G70': g(lat, 'G70'), 'H70': g(lat, 'H70'), 'G72': g(lat, 'G72'), 'H72': g(lat, 'H72'),
                    'G77': g(lat, 'G77'), 'H77': g(lat, 'H77'), 'G78': g(lat, 'G78'), 'H78': g(lat, 'H78'), 'H79': g(lat, 'H79')},
            'long': {'R': g(lng, 'C48'), 'Ct': g(lng, 'C51'), 'Ta': g(lng, 'C52'), 'Cs': g(lng, 'C58'), 'k': g(lng, 'F58'),
                     'V': g(lng, 'C57'), 'rows': {str(r): [g(lng, f'{col}{r}') for col in 'BCDEF'] for r in range(63, 80)},
                     'H65': g(lng, 'H65'), 'H66': g(lng, 'H66'), 'H67': g(lng, 'H67'), 'G70': g(lng, 'G70'), 'G72': g(lng, 'G72'),
                     'G77': g(lng, 'G77'), 'G78': g(lng, 'G78'), 'H79': g(lng, 'H79')},
        }
        out.append(res)
    json.dump(out, open(sys.argv[2], 'w'), indent=1)
    doc.close(True)
    try:
        desk.terminate()
    except Exception:
        pass


if __name__ == '__main__':
    main()
