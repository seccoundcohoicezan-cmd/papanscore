"""Skenario waktu pairing PapanScore (PeerJS nyata, context browser terpisah).
A: pairing normal | B: HP dibuka dulu, layar menyusul 3 dtk | C: layar reload
D: jalur langsung (WebRTC) diblokir -> HP tetap tersambung lewat relai MQTT & skor masuk
E: relai diblokir -> jalur langsung WebRTC tetap jalan."""
import sys, time, re
from playwright.sync_api import sync_playwright
base = sys.argv[1].rstrip('/')
STATUS = "document.querySelector('#net-status-text').textContent"
BLOCK = """(() => { const R = window.RTCPeerConnection; window.RTCPeerConnection = function (cfg = {}, ...a) {
  return new R({ ...cfg, iceServers: [], iceTransportPolicy: 'relay' }, ...a); };
  window.RTCPeerConnection.prototype = R.prototype; })();"""
NO_WS = """(() => { const W = window.WebSocket; window.WebSocket = function (url, ...a) {
  if (String(url).includes('/mqtt')) throw new Error('relai diblokir'); return new W(url, ...a); };
  window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 }); })();"""
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
        wait(c, f"{STATUS}.startsWith('Terhubung')", 60)
        res['D WebRTC diblokir -> tersambung via relai'] = time.time() - t
        t = time.time(); c.click('[data-cmd="score"][data-team="1"][data-delta="1"]')
        wait(d, "document.querySelectorAll('[data-team] [data-score]')[1].textContent === '1'", 15)
        res['D   tap +1 di HP -> skor di laptop (relai)'] = time.time() - t
        wait(d, f"{STATUS}.includes('1 HP terhubung')", 15)
        print('   D status HP:', c.text_content('#net-status-text'), '| Layar:', d.text_content('#net-status-text'))
    except Exception:
        res['D WebRTC diblokir -> tersambung via relai'] = None
        print('   D banner:', c.text_content('#banner'))
    if len(sys.argv) > 2:
        c.screenshot(path=sys.argv[2] + '/control-relay.png')
    dctx.close(); cctx.close()

    dctx, cctx = b.new_context(), b.new_context()
    d = dctx.new_page(); d.goto(f'{base}/display.html'); wait(d, f"{STATUS}.startsWith('Siap')"); code = code_of(d)
    c = cctx.new_page(); c.add_init_script(NO_WS); t = time.time(); c.goto(f'{base}/control.html#{code}')
    try:
        wait(c, f"{STATUS} === 'Terhubung · ' + '{code[:3]}-{code[3:]}'", 30)
        res['E relai diblokir -> tersambung via WebRTC'] = time.time() - t
    except Exception:
        res['E relai diblokir -> tersambung via WebRTC'] = None
    b.close()
for k, v in res.items():
    print(f'{k}: ' + ('TIDAK PERNAH (>60 dtk)' if v is None else f'{v:.1f} dtk'))
