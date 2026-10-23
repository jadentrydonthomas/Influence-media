# Parse an NBG Design Calcs seismic print (the application's own pages: inputs, then one page per lateral frame line
# and the longitudinal page) into a JSON fixture for oracle/nbg_seismic.js: every input — the check boxes and option
# buttons read from the drawing — and every result the application prints. Needs PyMuPDF.
# usage: for f in private/nbg-calcs/validation/*.pdf; do python3 -I oracle/nbg_parse.py "$f" \
#          "private/nbg-calcs/validation/fixtures/$(basename "$f" .pdf).json"; done
import sys, re, json
import pymupdf

NUM = re.compile(r"^-?[\d,]*\.?\d+'?$")


def num(s):
    s = s.strip().rstrip("'").replace(',', '')
    for u in (' psf', ' klf', ' kips', ' feet', ' plf', ' lbs', ' ft²'):
        if s.endswith(u):
            s = s[: -len(u)]
    return float(s)


def is_num(s):
    s = s.strip()
    for u in (' psf', ' klf', ' kips', ' feet'):
        if s.endswith(u):
            s = s[: -len(u)]
    return bool(NUM.match(s))


# ---------- the application's pages (stop at the workbook / sMath validation pages) ----------
def app_pages(doc):
    out = []
    for i, p in enumerate(doc):
        t = p.get_text()
        if 'Spreadsheet Revision Number' in t or 'ASCE 7 22 - Seismic Loads Chapters' in t or 'Seismic Loads Chapters 11' in t:
            break
        out.append(i)
    return out


def tokens(page):
    return [l.strip() for l in page.get_text().split('\n') if l.strip() and l.strip() != 'i']


# ---------- check boxes and radio buttons, from the drawings ----------
def controls(page):
    ds = page.get_drawings()
    ctl = []
    for d in ds:
        r = d['rect']
        col = d.get('color')
        if d.get('type') not in ('s', 'fs') or not col:
            continue
        if not (6.5 <= r.width <= 13 and 6.5 <= r.height <= 13):
            continue
        kind = 'box' if any(it[0] == 're' for it in d['items']) else 'radio'
        blue = abs(col[2] - 1) < 0.01 and col[0] < 0.01
        grey = kind == 'box' and abs(col[0] - col[1]) < 0.01 and abs(col[1] - col[2]) < 0.01 and 0.1 < col[0] < 0.7   # a disabled box
        if not (blue or grey):
            continue
        ctl.append({'rect': r, 'kind': kind, 'on': False, 'disabled': grey})
    for c in ctl:
        R = c['rect']
        for d in ds:
            r, f = d['rect'], d.get('fill')
            if not f or d.get('type') not in ('f', 'fs') or (f[0] > 0.9 and f[1] > 0.9 and f[2] > 0.9):
                continue
            if r.width > 0.88 * R.width and r.height > 0.88 * R.height:   # the box's own background
                continue
            if r.x0 >= R.x0 - 0.6 and r.y0 >= R.y0 - 0.6 and r.x1 <= R.x1 + 0.6 and r.y1 <= R.y1 + 0.6:
                c['on'] = True
    return ctl


def control_for(page, ctl, label, side, occurrence=None):
    """state of the control on the label's line: side 'left' (box before the text) or 'right' (box after)"""
    hits = page.search_for(label)
    res = []
    for h in hits:
        cy = (h.y0 + h.y1) / 2
        cands = [c for c in ctl if abs((c['rect'].y0 + c['rect'].y1) / 2 - cy) < 4.5]
        if side == 'left':
            cands = [c for c in cands if c['rect'].x1 <= h.x0 + 1 and h.x0 - c['rect'].x1 < 12]
            cands.sort(key=lambda c: h.x0 - c['rect'].x1)
        else:
            cands = [c for c in cands if c['rect'].x0 >= h.x1 - 1 and c['rect'].x0 - h.x1 < 140]
            cands.sort(key=lambda c: c['rect'].x0 - h.x1)
        res.append({'at': (h.x0, h.y0), 'on': cands[0]['on'] if cands else None})
    return res


# ---------- input pages ----------
def after(tk, label, k=1, start=0):
    i = tk.index(label, start)
    return tk[i + k]


def parse_inputs(doc, pages):
    tk = []
    for i in pages:
        t = tokens(doc[i])
        if any(x.startswith('Lateral Calculations') or x == 'Longitudinal Calculations' for x in t[:3]):
            break
        tk += t
    inp = {}
    inp['code'] = after(tk, 'Building Code')
    inp['version'] = next((x.split(':', 1)[1].strip() for x in tk if x.startswith('Version:')), None)
    b = inp['building'] = {}
    b['type'] = after(tk, 'Building Type')
    b['width'] = num(after(tk, 'Building Width'))
    b['length'] = num(after(tk, 'Building Length'))
    b['dtr'] = num(after(tk, 'BSW Distance to Ridge'))
    b['slopeBSW'] = num(after(tk, 'BSW Roof Slope, s:12'))
    b['slopeFSW'] = num(after(tk, 'FSW Roof Slope, s:12'))
    b['eaveFSW'] = num(after(tk, 'FSW Eave Height'))
    b['eaveBSW'] = num(after(tk, 'BSW Eave Height'))
    s = inp['seismic'] = {}
    s['occupancy'] = after(tk, 'Nature of Occupancy')
    s['mezzDiaphragm'] = after(tk, 'Mezzanine Level Diaphragm')
    s['siteClass'] = after(tk, 'Site Classification')
    s['roofDiaphragm'] = after(tk, 'Roof Level Diaphragm')
    s['Ss'] = num(after(tk, 'Short period response acceleration, Ss'))
    s['S1'] = num(after(tk, '1-sec period response acceleration, S1'))
    if 'Short period response acceleration adjusted for site effects, Sms' in tk:
        s['Sms'] = num(after(tk, 'Short period response acceleration adjusted for site effects, Sms'))
        s['Sm1'] = num(after(tk, '1-sec period response acceleration adjusted for site effects, Sm1'))
    r = inp['roof'] = {}
    r['SW'] = num(after(tk, 'Lateral Frame Self-weight (SW)'))
    r['RDL'] = num(after(tk, 'Roof Dead Load (RDL)'))
    r['CDL'] = num(after(tk, 'Roof Collateral Load (CDL)'))
    r['RSW'] = num(after(tk, next(x for x in tk if x.startswith('Roof Self-weight (Bracing'))))
    r['Pf'] = num(after(tk, 'Roof Snow (Pf)'))
    # walls: each block runs from its header to the next header
    heads = ['Left EW Loads', 'Right EW Loads', 'Front SW Loads', 'Back SW Loads', 'Partition Loads']
    pos = [tk.index(h) for h in heads] + [tk.index('Mezzanine Loads')]
    walls = inp['walls'] = {}
    for n, key in enumerate(['LEW', 'REW', 'FSW', 'BSW', 'Partition']):
        blk = tk[pos[n]: pos[n + 1]]
        w = {}
        for lbl, k in (('Top Elevation', 'top'), ('Wall Weight', 'weight'), ('Upper Wall Weight', 'upperWeight'), ('Top of Masonry Elevation', 'masonryTop'), ('Lower Wall Weight', 'lowerWeight'), ('Wall Length:', 'length')):
            if lbl in blk:
                j = blk.index(lbl)
                if j + 1 < len(blk) and is_num(blk[j + 1]):
                    w[k] = num(blk[j + 1])
        walls[key] = w
    # mezzanines
    mz = []
    i0 = tk.index('Mezzanine Loads')
    i1 = tk.index('Crane Loads') if 'Crane Loads' in tk else len(tk)
    blk = tk[i0:i1]
    starts = [j for j, x in enumerate(blk) if re.match(r'^Mezzanine #\d+$', x)]
    for n, j in enumerate(starts):
        e = starts[n + 1] if n + 1 < len(starts) else len(blk)
        m = {'id': int(blk[j].split('#')[1])}
        sub = blk[j:e]
        for lbl, k in (('Elevation', 'elev'), ('Floor Dead', 'FDL'), ('Floor Collateral', 'FLC'), ('Estimated Joist Weight', 'FLJ'), ('Floor Live', 'FLL'), ('Partition Load', 'FLP'), ('Partition Dead', 'FLP')):
            if lbl in sub:
                jj = sub.index(lbl)
                if jj + 1 < len(sub) and is_num(sub[jj + 1]):
                    m[k] = num(sub[jj + 1])
        mz.append(m)
    inp['mezz'] = mz
    # cranes
    cr = []
    if 'Crane Loads' in tk:
        i0 = tk.index('Crane Loads')
        i1 = tk.index('Seismic Force Resisting Systems')
        blk = tk[i0:i1]
        starts = [j for j, x in enumerate(blk) if re.match(r'^Crane #\d+$', x)]
        for n, j in enumerate(starts):
            e = starts[n + 1] if n + 1 < len(starts) else len(blk)
            sub = blk[j:e]
            c = {'id': int(blk[j].split('#')[1]), 'type': after(sub, 'Crane Type (TR/UH/Mono)')}
            c['beam'] = num(after(sub, 'Crane Beam + Channel'))
            c['indCol'] = num(after(sub, 'Independent Crane Column'))
            jj = sub.index('Rail Weight')
            c['railYd'] = num(sub[jj + 1])
            c['rail'] = num(sub[jj + 3])
            c['bridge'] = num(after(sub, 'Bridge Weight'))
            c['hoist'] = num(after(sub, 'Hoist + Trolley'))
            c['elev'] = num(after(sub, 'Elevation'))
            cr.append(c)
    inp['cranes'] = cr
    # SFRS
    sf = inp['sfrs'] = {'FSW': after(tk, 'FSW Force Resisting System'), 'BSW': after(tk, 'BSW Force Resisting System'), 'lines': []}
    j = tk.index('Tributary Width') + 1
    while tk[j] != 'Add Frameline':
        sf['lines'].append({'desc': tk[j], 'sfrs': tk[j + 1], 'trib': num(tk[j + 2])})
        j += 3
    return inp


def parse_checks(doc, pages, inp):
    """check boxes and radio buttons of the input pages"""
    flags = {}
    wall_opts = {k: {} for k in ('LEW', 'REW', 'FSW', 'BSW', 'Partition')}
    mz_opts = []
    for i in pages:
        p = doc[i]
        t = p.get_text()
        if 'Lateral Calculations' in t[:200] or 'Longitudinal Calculations' in t[:200]:
            break
        ctl = controls(p)
        for lbl, key in (("Default to use 'Not Detailed for Seismic' SFRS", 'ndfs'), ('Significant mezzanine exists', 'significant'), ('Seismic Irregularities Exist', 'irregular'),
                         ('Use Accidental Torsion In Long. Direction?', 'torsionLong'), ('Use Accidental Torsion In Lateral Direction?', 'torsionLat')):
            r = control_for(p, ctl, lbl, 'right')
            if r and key not in flags:
                flags[key] = r[0]['on']
        # walls: header positions -> the block below each header in its column
        heads = []
        for key, h in (('LEW', 'Left EW Loads'), ('REW', 'Right EW Loads'), ('FSW', 'Front SW Loads'), ('BSW', 'Back SW Loads'), ('Partition', 'Partition Loads')):
            for q in p.search_for(h):
                heads.append((key, q))
        def owner(pt):
            best = None
            for key, q in heads:
                if abs(q.x0 - pt[0]) < 60 or (pt[0] > q.x0 - 5 and pt[0] - q.x0 < 200):
                    if q.y0 <= pt[1] + 1 and (best is None or q.y0 > best[1].y0) and abs(q.x0 - pt[0]) < 200:
                        if (q.x0 < 300) == (pt[0] < 300):
                            best = (key, q)
            return best[0] if best else None
        for lbl, k, side in (('Full Height Wall', 'full', 'left'), ('Partial Height Hardwall', 'partial', 'left'), ('Self supporting shear wall', 'shear', 'right'), ('Parapet', 'parapet', 'right')):
            for r in control_for(p, ctl, lbl, side):
                o = owner(r['at'])
                if o:
                    wall_opts[o][k] = r['on']
        sl = control_for(p, ctl, 'Storage Loading', 'left')
        pl = control_for(p, ctl, 'Partition Loading', 'left')
        for a, b in zip(sorted(sl, key=lambda r: (r['at'][1], r['at'][0])), sorted(pl, key=lambda r: (r['at'][1], r['at'][0]))):
            mz_opts.append({'storage': a['on'], 'partition': b['on']})
    inp['seismic'].update(flags)
    for k, v in wall_opts.items():
        inp['walls'][k].update(v)
    for m, o in zip(inp['mezz'], mz_opts):
        m.update(o)


# ---------- result pages ----------
FACTOR_KEYS = ['Ie', 'Fa', 'Fv', 'Sms', 'Sm1', 'Sds', 'Sd1', 'SDC', 'R', 'Om', 'Cd', 'Ct', 'Ta', 'rho', 'k']
ROW_NAMES = re.compile(r'^(Roof Loads|Left EW Loads.*|Right EW Loads.*|Front SW Loads.*|Back SW Loads.*|.*artition Wall Loads.*|Partition Loads.*|Mezzanine \d+ Loads|Crane \d+ Loads)$')


def parse_result(tk):
    res = {}
    # frame line / longitudinal information
    if tk[0].startswith('Lateral Calculations'):
        res['kind'] = 'lateral'
        res['title'] = tk[0][len('Lateral Calculations - '):]
        res['desc'] = after(tk, 'Description / Location')
        res['framing'] = after(tk, 'Framing System')
        res['sfrsName'] = after(tk, 'Seismic Force Resisting System')
        res['bay'] = num(after(tk, 'Bay Width'))
        res['bayType'] = after(tk, 'Bay Type')
    else:
        res['kind'] = 'longitudinal'
        res['fswSystem'] = after(tk, 'Front SW Framing System')
        res['bswSystem'] = after(tk, 'Back SW Framing System')
        res['sfrsName'] = after(tk, 'Seismic Force Resisting System')
        if 'Partition Wall Tributary Length' in tk:
            res['partTrib'] = num(after(tk, 'Partition Wall Tributary Length'))
            res['partQty'] = num(after(tk, 'Quantity of Partition Walls'))
    res['roofConc'] = num(after(tk, 'Roof concentrated loads'))
    res['fswTrib'] = num(after(tk, 'Front SW Tributary Length'))
    res['bswTrib'] = num(after(tk, 'Back SW Tributary Length'))
    if 'Wall Length:' in tk:
        res['partLen'] = num(after(tk, 'Wall Length:'))
    i0, i1 = tk.index('Mezzanine Information'), tk.index('Crane Information')
    blk = tk[i0:i1]
    res['mezz'] = []
    for j, x in enumerate(blk):
        if x == 'Mezzanine ID':
            res['mezz'].append({'id': int(blk[j + 1]), 'area': num(blk[j + 3]), 'conc': num(blk[j + 6])})
    i2 = tk.index('Seismic Data Input Echo') if 'Seismic Data Input Echo' in tk else tk.index('Seismic Factors')
    blk = tk[i1:i2]
    res['cranes'] = []
    for j, x in enumerate(blk):
        if x == 'Crane ID':
            res['cranes'].append({'id': int(blk[j + 1]), 'aisles': num(after(blk, 'Qty. of Aisles', 1, j)), 'runway': num(after(blk, 'Length of Runway', 1, j)),
                                  'indCols': num(after(blk, 'Qty of Ind. Crane Cols.', 1, j)), 'perAisle': num(after(blk, 'Qty. of Cranes per Aisle', 1, j))})
    # seismic factors: the values between the labels and the first "Override"
    j0 = tk.index('Seismic Factors')
    j1 = tk.index('Override', j0)
    vals = [x for x in tk[j0:j1] if is_num(x) or re.fullmatch(r'[A-F]', x)]
    # the S1 echo can sit inside the label run ("1-sec period response acceleration, S1 0.060" is one token)
    keys = FACTOR_KEYS if 'Fa' in tk[j0:j1] else [k for k in FACTOR_KEYS if k not in ('Fa', 'Fv')]
    fac = dict(zip(keys, vals[-len(keys):]))
    res['factors'] = {k: (v if k == 'SDC' else num(v)) for k, v in fac.items()}
    # uniform loads
    if res['kind'] == 'lateral':
        res['uniform'] = {'altRoof': num(after(tk, 'Alt. Roof Weight')), 'roof': num(after(tk, 'Roof Weight')), 'altPanel': num(after(tk, 'Alt. Panel Load')),
                          'panel': num(after(tk, 'Panel Load')), 'factor': num(after(tk, 'Seismic Factor'))}
    else:
        res['uniform'] = {'snow': num(after(tk, 'Roof Snow')), 'dead': num(after(tk, 'Roof Dead')), 'altTotal': num(after(tk, 'Alt. Roof Total')),
                          'total': num(after(tk, 'Roof Total')), 'factor': num(after(tk, 'Seismic Factor'))}
    jv = tk.index('Cs', tk.index('Seismic Response Coefficient'))
    res['V'] = num(tk[jv + 1])
    res['Cs'] = num(tk[jv + 2])
    # distribution rows
    j = tk.index('Mx (ft-kips)') + 1
    rows, conc = [], []
    while j < len(tk):
        x = tk[j]
        if x == 'Totals':
            res['totals'] = {'W': num(tk[j + 1]), 'num': num(tk[j + 3]), 'Fx': num(tk[j + 4]), 'Mx': num(tk[j + 5])}
            j += 6
            continue
        if x == 'Base Shear':
            res['baseShear'] = num(tk[j + 1])
            j += 2
            continue
        if ROW_NAMES.match(x):
            v = tk[j + 1: j + 6]
            if all(is_num(y) or y == '--' for y in v):
                rows.append({'name': x, 'W': num(v[0]), 'h': None if v[1] == '--' else num(v[1]), 'num': None if v[2] == '--' else num(v[2]), 'Fx': None if v[3] == '--' else num(v[3]), 'Mx': None if v[4] == '--' else num(v[4])})
                j += 6
                continue
        if x.endswith(' kips') and j + 1 < len(tk) and tk[j + 1].endswith(' feet'):
            conc.append({'F': num(x), 'at': num(tk[j + 1])})
            j += 2
            continue
        if x.startswith('Warning') or x.startswith('Cs value'):
            res.setdefault('notes', []).append(' '.join(tk[j: j + 3]))
        j += 1
    res['rows'] = rows
    res['conc'] = conc
    return res


def parse(path):
    doc = pymupdf.open(path)
    pages = app_pages(doc)
    inp = parse_inputs(doc, pages)
    parse_checks(doc, pages, inp)
    results = []
    cur = None
    for i in pages:
        tk = tokens(doc[i])
        if tk and (tk[0].startswith('Lateral Calculations') or tk[0] == 'Longitudinal Calculations'):
            if cur:
                results.append(cur)
            cur = tk
        elif cur is not None:
            cur += tk
    if cur:
        results.append(cur)
    inp['lateral'] = []
    for tk in results:
        r = parse_result(tk)
        if r['kind'] == 'lateral':
            inp['lateral'].append(r)
        else:
            inp['longitudinal'] = r
    inp['title'] = doc.metadata.get('title')
    return inp


if __name__ == '__main__':
    out = parse(sys.argv[1])
    json.dump(out, open(sys.argv[2], 'w'), indent=1)
    print(sys.argv[1].split('/')[-1], '->', len(out['lateral']), 'lateral +', 'longitudinal' if 'longitudinal' in out else 'NO longitudinal',
          '| flags', {k: out['seismic'].get(k) for k in ('ndfs', 'significant', 'irregular', 'torsionLong', 'torsionLat')},
          '| walls', {k: (v.get('full'), v.get('partial'), v.get('shear'), v.get('parapet')) for k, v in out['walls'].items()},
          '| mezz', [(m['id'], m.get('storage'), m.get('partition')) for m in out['mezz']])
