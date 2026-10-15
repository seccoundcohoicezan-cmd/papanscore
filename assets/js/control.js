/* Halaman Kontrol (HP): mengirim perintah ke Layar dan menampilkan state yang
   disiarkan balik. Tidak menyimpan skor sendiri — Layar adalah sumber kebenaran. */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const LAST_CODE_KEY = 'ps.control.code';
  const STALE_MS = 11000; // Layar mengirim detak tiap 4 dtk

  const el = {
    viewPair: $('#view-pair'),
    viewRemote: $('#view-remote'),
    form: $('#pair-form'),
    input: $('#code-input'),
    error: $('#code-error'),
    reuse: $('#reuse-code'),
    status: $('#net-status'),
    statusText: $('#net-status-text'),
    change: $('#change-screen'),
    banner: $('#banner'),
    teams: $$('.rteam'),
    time: $('#timer-value'),
    timerState: $('#timer-state'),
    timerCard: $('#timer-card'),
    timerToggle: $('#timer-toggle'),
    undo: $('#undo-btn'),
    settings: $('#settings-dialog'),
    settingsForm: $('#settings-form'),
    settingsError: $('#settings-error'),
    reset: $('#reset-dialog'),
  };

  let code = '';
  let state = null;
  let remainingAt = { ms: 0, at: 0 };
  let lastMsgAt = 0;
  let lastBcAt = 0;
  let connOpenedAt = 0;
  let peer = null;
  let conn = null;
  let bc = null;
  let retryTimer = 0;
  let retryCount = 0;
  let lastError = '';

  /* ---------- Koneksi ---------- */

  const peerConnected = () => Boolean(conn && conn.open);
  const bcConnected = () => Date.now() - lastBcAt < STALE_MS;
  const isConnected = () => (peerConnected() || bcConnected()) && state != null;

  function send(msg) {
    let sent = false;
    if (peerConnected()) { conn.send(msg); sent = true; }
    if (bc) { bc.postMessage(msg); sent = sent || bcConnected(); }
    return sent;
  }

  function sendCmd(cmd) {
    if (!isConnected()) {
      flashBanner('Belum terhubung ke layar. Perintah tidak terkirim.');
      return;
    }
    send({ t: 'cmd', id: PS.uid(), cmd });
    navigator.vibrate?.(12);
  }

  function onMessage(msg, via) {
    if (!msg || msg.t !== 'state' || !msg.state) return;
    if (state && msg.state.rev < state.rev && via === 'bc') return;
    lastMsgAt = Date.now();
    if (via === 'bc') lastBcAt = lastMsgAt;
    state = msg.state;
    remainingAt = { ms: msg.remaining, at: performance.now() };
    el.undo.disabled = !msg.canUndo;
    retryCount = 0;
    lastError = '';
    render();
    updateStatus();
  }

  function connect(newCode) {
    disconnect();
    code = newCode;
    PS.store.set(LAST_CODE_KEY, code);
    if (location.hash.slice(1) !== code) history.replaceState(null, '', `#${code}`);
    showRemote();

    if ('BroadcastChannel' in window) {
      bc = new BroadcastChannel(PS.channelName(code));
      bc.onmessage = (e) => onMessage(e.data, 'bc');
      bc.postMessage({ t: 'hello' });
    }
    startPeer();
    updateStatus();
  }

  function disconnect() {
    clearTimeout(retryTimer);
    conn?.close();
    peer?.destroy();
    bc?.close();
    conn = null;
    peer = null;
    bc = null;
    state = null;
    lastBcAt = 0;
    lastMsgAt = 0;
  }

  function startPeer() {
    if (!PS.peerAvailable()) {
      lastError = 'Pustaka koneksi gagal dimuat. Periksa internet HP lalu muat ulang.';
      updateStatus();
      return;
    }
    const p = new Peer({ debug: 0 });
    peer = p;
    p.on('open', () => { if (p === peer) openConn(); });
    p.on('disconnected', () => {
      // Server pemasangan putus; data channel yang sudah terbuka tetap dipakai.
      if (p === peer && !p.destroyed) setTimeout(() => { if (p === peer && p.disconnected && !p.destroyed) p.reconnect(); }, 2000);
    });
    p.on('error', (err) => {
      if (p !== peer) return;
      lastError = err.type === 'peer-unavailable'
        ? 'Layar dengan kode ini tidak ditemukan. Pastikan halaman Layar terbuka di laptop.'
        : 'Gagal menghubungi server pemasangan. Mencoba lagi…';
      updateStatus();
      scheduleRetry();
    });
  }

  function openConn() {
    conn?.close();
    const c = peer.connect(PS.peerId(code), { serialization: 'json', reliable: true });
    conn = c;
    c.on('open', () => {
      if (c !== conn) return;
      connOpenedAt = Date.now();
      c.send({ t: 'hello' });
      updateStatus();
    });
    c.on('data', (msg) => { if (c === conn) onMessage(msg, 'peer'); });
    const lost = () => {
      if (c !== conn) return;
      updateStatus();
      scheduleRetry();
    };
    c.on('close', lost);
    c.on('error', lost);
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryCount += 1;
    const delay = Math.min(15000, 1000 * 2 ** Math.min(retryCount, 4));
    retryTimer = setTimeout(() => {
      if (!code) return;
      if (peer && !peer.destroyed && peer.open) openConn();
      else { peer?.destroy(); startPeer(); }
    }, delay);
  }

  // Data channel bisa "terbuka" padahal mati (HP tidur). Detak hilang = sambung ulang.
  function watchdog() {
    if (!code) return;
    if (peerConnected() && Date.now() - Math.max(lastMsgAt, connOpenedAt) > STALE_MS) {
      conn.close();
      conn = null;
      scheduleRetry();
    }
    updateStatus();
  }

  /* ---------- Tampilan ---------- */

  function showRemote() {
    el.viewPair.hidden = true;
    el.viewRemote.hidden = false;
    el.change.hidden = false;
  }

  function showPair(message = '') {
    disconnect();
    code = '';
    history.replaceState(null, '', location.pathname + location.search);
    el.viewPair.hidden = false;
    el.viewRemote.hidden = true;
    el.change.hidden = true;
    el.error.textContent = message;
    const last = PS.store.get(LAST_CODE_KEY);
    el.reuse.hidden = !PS.isValidCode(last || '');
    if (!el.reuse.hidden) el.reuse.textContent = `Sambung lagi ke ${PS.formatCode(last)}`;
    updateStatus();
    el.input.focus();
  }

  function updateStatus() {
    const connected = isConnected();
    let text = 'Belum terhubung';
    let tone = 'idle';
    if (code) {
      if (connected) {
        text = `Terhubung · ${PS.formatCode(code)}`;
        tone = 'ok';
      } else {
        text = lastMsgAt ? 'Menyambung ulang…' : 'Menghubungkan…';
        tone = 'warn';
      }
    }
    el.status.dataset.tone = tone;
    if (el.statusText.textContent !== text) el.statusText.textContent = text;
    el.status.dataset.short = connected ? PS.formatCode(code) : '';

    document.body.classList.toggle('is-offline', Boolean(code) && !connected);
    $$('[data-cmd]', el.viewRemote).forEach((b) => {
      if (b !== el.undo) b.disabled = !connected;
    });
    $('#open-settings').disabled = !connected;
    $('#open-reset').disabled = !connected;
    if (!connected) el.undo.disabled = true;

    if (code && !connected) {
      el.banner.hidden = false;
      el.banner.dataset.tone = 'warn';
      el.banner.textContent = lastError || (lastMsgAt
        ? 'Koneksi ke layar terputus. Menyambung ulang otomatis…'
        : `Menghubungkan ke layar ${PS.formatCode(code)}…`);
    } else if (el.banner.dataset.tone === 'warn') {
      el.banner.hidden = true;
      el.banner.dataset.tone = '';
    }
  }

  let bannerTimer = 0;
  function flashBanner(text) {
    el.banner.hidden = false;
    el.banner.dataset.tone = 'info';
    el.banner.textContent = text;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { if (el.banner.dataset.tone === 'info') el.banner.hidden = true; }, 2500);
  }

  function render() {
    if (!state) return;
    state.teams.forEach((team, i) => {
      const card = el.teams[i];
      card.style.setProperty('--team', team.color);
      card.style.setProperty('--team-ink', PS.inkFor(team.color));
      $('[data-name]', card).textContent = team.name;
      $('[data-score]', card).textContent = team.score;
      $('[data-sets]', card).textContent = team.sets;
      const [plusLabel, minusLabel] = $$('[data-label]', card);
      plusLabel.textContent = `Tambah 1 poin ${team.name}`;
      minusLabel.textContent = `Kurangi 1 poin ${team.name}`;
      $('[data-set-group]', card).setAttribute('aria-label', `Set ${team.name}`);
    });
    const t = state.timer;
    const done = !t.running && t.remaining <= 0;
    el.timerCard.dataset.state = t.running ? 'running' : done ? 'done' : 'paused';
    el.timerState.textContent = t.running ? '· berjalan' : done ? '· habis' : t.remaining === t.duration ? '· siap' : '· jeda';
    el.timerToggle.querySelector('span').textContent = t.running ? 'Jeda' : done ? 'Mulai ulang' : t.remaining === t.duration ? 'Mulai' : 'Lanjut';
    el.timerToggle.querySelector('[data-icon-play]').hidden = t.running;
    el.timerToggle.querySelector('[data-icon-pause]').hidden = !t.running;
    tick();
  }

  function tick() {
    if (!state) return;
    const ms = state.timer.running
      ? Math.max(0, remainingAt.ms - (performance.now() - remainingAt.at))
      : remainingAt.ms;
    const text = PS.formatTime(ms);
    if (el.time.textContent !== text) el.time.textContent = text;
  }

  /* ---------- Pengaturan ---------- */

  function openSettings() {
    if (!state) return;
    const f = el.settingsForm.elements;
    f.title.value = state.title || '';
    state.teams.forEach((team, i) => {
      f[`name${i}`].value = team.name;
      f[`color${i}`].value = team.color.toLowerCase();
    });
    const totalSec = Math.round(state.timer.duration / 1000);
    f.min.value = Math.floor(totalSec / 60);
    f.sec.value = totalSec % 60;
    f.sound.checked = state.sound !== false;
    el.settingsError.textContent = '';
    el.settings.showModal();
  }

  function saveSettings(e) {
    e.preventDefault();
    const f = el.settingsForm.elements;
    const names = [f.name0.value.trim(), f.name1.value.trim()];
    const min = Number(f.min.value);
    const sec = Number(f.sec.value);
    let error = '';
    let focus = null;
    if (!names[0]) { error = 'Nama tim kiri belum diisi.'; focus = f.name0; }
    else if (!names[1]) { error = 'Nama tim kanan belum diisi.'; focus = f.name1; }
    else if (!Number.isInteger(min) || min < 0 || min > 99) { error = 'Menit harus angka bulat 0–99.'; focus = f.min; }
    else if (!Number.isInteger(sec) || sec < 0 || sec > 59) { error = 'Detik harus angka bulat 0–59.'; focus = f.sec; }
    else if (min === 0 && sec === 0) { error = 'Durasi minimal 1 detik.'; focus = f.sec; }
    [f.name0, f.name1, f.min, f.sec].forEach((input) => input.setAttribute('aria-invalid', String(input === focus)));
    if (error) {
      el.settingsError.textContent = error;
      focus.focus();
      return;
    }
    sendCmd({
      type: 'settings',
      settings: {
        title: f.title.value.trim(),
        sound: f.sound.checked,
        duration: (min * 60 + sec) * 1000,
        teams: [0, 1].map((i) => ({ name: names[i], color: f[`color${i}`].value })),
      },
    });
    el.settings.close();
  }

  /* ---------- Event ---------- */

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const value = PS.normalizeCode(el.input.value);
    if (!PS.isValidCode(value)) {
      el.error.textContent = `Kode harus ${PS.CODE_LEN} karakter, contoh ABC-234. Lihat jendela "Hubungkan HP" di layar.`;
      el.input.setAttribute('aria-invalid', 'true');
      el.input.focus();
      return;
    }
    el.input.setAttribute('aria-invalid', 'false');
    el.error.textContent = '';
    connect(value);
  });

  el.input.addEventListener('input', () => {
    const v = PS.normalizeCode(el.input.value);
    el.input.value = v.length > 3 ? PS.formatCode(v) : v;
  });

  el.reuse.addEventListener('click', () => connect(PS.store.get(LAST_CODE_KEY)));
  el.change.addEventListener('click', () => showPair());

  el.viewRemote.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn || btn.disabled) return;
    const cmd = { type: btn.dataset.cmd };
    if (btn.dataset.team) cmd.team = Number(btn.dataset.team);
    if (btn.dataset.delta) cmd.delta = Number(btn.dataset.delta);
    sendCmd(cmd);
  });

  $('#open-settings').addEventListener('click', openSettings);
  $('#open-reset').addEventListener('click', () => {
    el.reset.returnValue = '';
    el.reset.showModal();
  });
  el.reset.addEventListener('close', () => {
    if (el.reset.returnValue === 'reset') sendCmd({ type: 'reset-match' });
  });
  el.settingsForm.addEventListener('submit', saveSettings);
  $('[data-close]', el.settingsForm).addEventListener('click', () => el.settings.close());
  [el.settings, el.reset].forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && code) {
      send({ t: 'hello' });
      watchdog();
    }
  });
  window.addEventListener('online', () => { if (code && !isConnected()) scheduleRetry(); });
  window.addEventListener('hashchange', () => {
    const fromHash = PS.normalizeCode(location.hash.slice(1));
    if (PS.isValidCode(fromHash) && fromHash !== code) connect(fromHash);
  });

  /* ---------- Mulai ---------- */

  document.body.classList.add('js');
  const fromHash = PS.normalizeCode(location.hash.slice(1));
  if (PS.isValidCode(fromHash)) connect(fromHash);
  else showPair();
  PS.keepAwake();
  setInterval(tick, 250);
  setInterval(watchdog, 3000);
})();
