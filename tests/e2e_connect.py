"""Skenario waktu pairing PapanScore (PeerJS nyata, context browser terpisah).
A: pairing normal | B: HP dibuka dulu, layar menyusul 3 dtk | C: layar reload
D: jalur langsung diblokir (paksa relay tanpa TURN) -> HP harus memberi panduan."""
import sys, time, re
from playwright.sync_api import sync_playwright
base = sys.argv[1].rstrip('/')
STATUS = "document.querySelector('#net-status-text').textContent"
BLOCK = """(() => { const R = window.RTCPeerConnection; window.RTCPeerConnection = function (cfg = {}, ...a) {
  return new R({ ...cfg, iceServers: [], iceTransportPolicy: 'relay' }, ...a); };
  window.RTCPeerConnection.prototype = R.prototype; })();"""
def code_of(d):
    return re.sub(r'[^A-Z0-9]', '', d.text_content('#pair-code'))
def wait(p, cond, t=90):
    p.wait_for_function(cond, timeout=t * 1000)
res = {}
with sync_playwright() as pw:
    b = pw.chromium.launch()
    dctx, cctx = b.new_context(), b.new_context()
    d = dctx.new_page(); d.goto(f'{base}/display.html')
    wait(d, f"{STATUS}.startsWith('Siap')"); code = code_of(d)
    c = cctx.new_page(); t = time.time(); c.goto(f'{base}/control.html#{code}')
    wait(c, f"{STATUS}.startsWith('Terhubung')"); res['A pairing normal'] = time.time() - t
    c.click('[data-cmd="score"][data-team="0"][data-delta="1"]')
    wait(d, "document.querySelector('[data-team] [data-score]').textContent === '1'", 10)
    t = time.time(); d.reload(); wait(d, f"{STATUS}.includes('HP terhubung')")
    res['C layar reload -> HP tersambung lagi'] = time.time() - t
    dctx.close(); cctx.close()

    dctx, cctx = b.new_context(), b.new_context()
    d = dctx.new_page(); d.goto(f'{base}/display.html'); wait(d, f"{STATUS}.startsWith('Siap')")
    code = code_of(d); dctx.close()
    time.sleep(4)  # biarkan server melepas ID
    c = cctx.new_page(); c.goto(f'{base}/control.html#{code}'); time.sleep(3)
    dctx = b.new_context(); d = dctx.new_page()
    d.add_init_script(f"localStorage.setItem('ps.display.code', JSON.stringify('{code}'))")
    d.goto(f'{base}/display.html'); wait(d, f"{STATUS}.startsWith('Siap') || {STATUS}.includes('HP')"); t = time.time()
    try:
        wait(c, f"{STATUS}.startsWith('Terhubung')", 60); res['B HP duluan, layar siap -> HP tersambung'] = time.time() - t
    except Exception:
        res['B HP duluan, layar siap -> HP tersambung'] = None
    dctx.close(); cctx.close()

    dctx, cctx = b.new_context(), b.new_context()
    d = dctx.new_page(); d.goto(f'{base}/display.html'); wait(d, f"{STATUS}.startsWith('Siap')"); code = code_of(d)
    c = cctx.new_page(); c.add_init_script(BLOCK); t = time.time(); c.goto(f'{base}/control.html#{code}')
    try:
        wait(c, "/Wi-Fi|hotspot/i.test(document.querySelector('#banner').textContent)", 60)
        res['D jalur diblokir -> panduan tampil'] = time.time() - t
    except Exception:
        res['D jalur diblokir -> panduan tampil'] = None
        print('   D banner:', c.text_content('#banner'))
    c.screenshot(path=sys.argv[2] + '/control-blocked.png') if len(sys.argv) > 2 else None
    b.close()
for k, v in res.items():
    print(f'{k}: ' + ('TIDAK PERNAH (>60 dtk)' if v is None else f'{v:.1f} dtk'))
