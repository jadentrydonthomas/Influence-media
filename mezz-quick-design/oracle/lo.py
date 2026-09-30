"""Drive the real NBG workbooks headless through LibreOffice UNO.

The workbooks are Nucor-internal and are NOT in the repo. Put them in
mezz-quick-design/private/workbooks/ (gitignored) or point MZ_WORKBOOKS at them.
"""
import os
import subprocess
import time

import uno
from com.sun.star.beans import PropertyValue

HERE = os.path.dirname(os.path.abspath(__file__))
WORKBOOKS = os.environ.get('MZ_WORKBOOKS', os.path.join(HERE, '..', 'private', 'workbooks'))
PORT = int(os.environ.get('MZ_LO_PORT', '2002'))


def pv(n, v):
    p = PropertyValue()
    p.Name = n
    p.Value = v
    return p


def _connect(tries=120):
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
    for _ in range(tries):
        try:
            return resolver.resolve(f'uno:socket,host=localhost,port={PORT};urp;StarOffice.ComponentContext')
        except Exception:
            time.sleep(0.5)
    raise RuntimeError('could not connect to soffice')


def start():
    subprocess.Popen(['soffice', '--headless', '--invisible', '--norestore', '--nologo', '--nodefault',
                      f'--accept=socket,host=localhost,port={PORT};urp;'],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ctx = _connect()
    return ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)


def open_book(desktop, name):
    url = uno.systemPathToFileUrl(os.path.abspath(os.path.join(WORKBOOKS, name)))
    return desktop.loadComponentFromURL(url, '_blank', 0, (pv('Hidden', True), pv('MacroExecutionMode', 4)))


def drop_modules(doc, names):
    """Remove VBA modules LibreOffice Basic cannot compile (one bad module kills every UDF)."""
    lib = doc.BasicLibraries.getByName('VBAProject')
    for n in names:
        if lib.hasByName(n):
            lib.removeByName(n)


def patch_pi(doc):
    """`Pi = Application.WorksheetFunction.Pi()` errors in LO Basic (Pi is a built-in constant there).
    Excel just assigns 3.14159...; deleting the line gives LO's identical built-in value."""
    for libname in doc.BasicLibraries.getElementNames():
        lib = doc.BasicLibraries.getByName(libname)
        for n in lib.getElementNames():
            src = lib.getByName(n)
            if 'WorksheetFunction.Pi()' in src and 'Pi As Single' not in src:
                lib.replaceByName(n, src.replace('Pi = Application.WorksheetFunction.Pi()', ''))


def setv(sheet, addr, v):
    c = sheet.getCellRangeByName(addr)
    if isinstance(v, str):
        c.setString(v)
    else:
        c.setValue(v)


def getv(sheet, addr):
    """Numeric cells come back as float, text cells (incl. "--", "OK") as str."""
    c = sheet.getCellRangeByName(addr)
    t = c.getType().value  # EMPTY / VALUE / TEXT / FORMULA
    if t == 'FORMULA':
        if c.getError():
            return '#ERR'
        rt = c.FormulaResultType2  # com.sun.star.sheet.FormulaResult: VALUE=1, STRING=2, ERROR=4
        if rt == 1:
            return c.getValue()
        return c.getString()
    if t == 'VALUE':
        return c.getValue()
    return c.getString()
