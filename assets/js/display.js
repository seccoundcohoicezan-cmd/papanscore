/* Halaman Layar: sumber kebenaran state. Menerima perintah dari HP, menyimpan,
   lalu menyiarkan state terbaru ke semua kontrol yang terhubung. */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const CODE_KEY = 'ps.display.code';
  const stateKey = (c) => `ps.state.${c}`;
  const HEARTBEAT_MS = 4000;
  const HISTORY_MAX = 50;
  const RELAY_IDLE_MS = 20000; // berhenti mengirim detak ke relai bila tak ada HP di sana
  const RELAY_CLIENT_MS = 12000;

  let code = PS.store.get(CODE_KEY);
  if (!PS.isValidCode(code || '')) {
    code = PS.randomCode();
    PS.store.set(CODE_KEY, code);
  }

  let state = loadState();
  let history = [];
  const seen = new Map();
  const conns = new Set();
  let peer = null;
  let bc = null;
  let relay = null;
  let relayActiveAt = 0;
  const relayClients = new Map();
  let peerRetry = 0;
  let idRetry = 0;
  let netStatus = 'connecting';

  const el = {
    body: document.body,
    title: $('#board-title'),
    teams: [...document.querySelectorAll('[data-team]')],
    time: $('#timer-value'),
    timerState: $('#timer-state'),
    timerCard: $('#timer-card'),
    sets: [...document.querySelectorAll('[data-set]')],
    setNames: [...document.querySelectorAll('[data-set-name]')],
    status: $('#net-status'),
    statusText: $('#net-status-text'),
    pairBtn: $('#pair-open'),
    fullBtn: $('#fullscreen-toggle'),
    dialog: $('#pair-dialog'),
    code: $('#pair-code'),
    link: $('#pair-link'),
    qr: $('#pair-qr'),
    copyBtn: $('#pair-copy'),
    copyMsg: $('#pair-copy-msg'),
    newCodeBtn: $('#pair-new-code'),
    localLink: $('#pair-local'),
    pairNet: $('#pair-net'),
    live: $('#live-region'),
  };

  function loadState() {
    const saved = PS.store.get(stateKey(code));
    const base = PS.defaultState();
    if (!saved || saved.v !== 1) return base;
    return { ...base, ...saved, timer: { ...base.timer, ...saved.timer } };
  }

  function save() {
    PS.store.set(stateKey(code), state);
  }

  /* ---------- Timer ---------- */

  const remainingNow = () => (state.timer.running
    ? Math.max(0, state.timer.endsAt - Date.now())
    : state.timer.remaining);

  function timerStart() {
    const t = state.timer;
    if (t.running) return;
    if (t.remaining <= 0) t.remaining = t.duration;
    t.running = true;
    t.endsAt = Date.now() + t.remaining;
  }

  function timerPause() {
    const t = state.timer;
    if (!t.running) return;
    t.remaining = remainingNow();
    t.running = false;
    t.endsAt = 0;
  }

  function timerReset() {
    Object.assign(state.timer, { remaining: state.timer.duration, running: false, endsAt: 0 });
  }

  let lastShown = '';
  function tick() {
    const ms = remainingNow();
    if (state.timer.running && ms <= 0) {
      Object.assign(state.timer, { remaining: 0, running: false, endsAt: 0 });
      commit();
      announce('Waktu habis');
      beep();
    }
    const text = PS.formatTime(ms);
    if (text !== lastShown) {
      el.time.textContent = text;
      lastShown = text;
    }
  }

  /* ---------- Perintah ---------- */

  const snapshot = () => JSON.parse(JSON.stringify({ title: state.title, teams: state.teams, sound: state.sound }));

  function remember() {
    history.push(snapshot());
    if (history.length > HISTORY_MAX) history.shift();
  }

  function apply(cmd) {
    if (!cmd || typeof cmd !== 'object') return;
    const team = state.teams[cmd.team === 1 ? 1 : 0];

    switch (cmd.type) {
      case 'score': {
        const next = PS.clamp(team.score + PS.toInt(cmd.delta), 0, 999);
        if (next === team.score) return;
        remember();
        team.score = next;
        break;
      }
      case 'sets': {
        const next = PS.clamp(team.sets + PS.toInt(cmd.delta), 0, 99);
        if (next === team.sets) return;
        remember();
        team.sets = next;
        break;
      }
      case 'timer-toggle':
        if (state.timer.running) timerPause(); else timerStart();
        break;
      case 'timer-start': timerStart(); break;
      case 'timer-pause': timerPause(); break;
      case 'timer-reset': timerReset(); break;
      case 'swap':
        remember();
        state.teams.reverse();
        break;
      case 'settings': {
        remember();
        const s = cmd.settings || {};
        state.title = String(s.title ?? state.title).slice(0, 60);
        state.sound = s.sound == null ? state.sound : Boolean(s.sound);
        [0, 1].forEach((i) => {
          const src = (s.teams || [])[i] || {};
          const name = String(src.name ?? '').trim().slice(0, 24);
          state.teams[i].name = name || (i === 0 ? 'TIM A' : 'TIM B');
          if (PS.isHexColor(src.color)) state.teams[i].color = src.color.toUpperCase();
        });
        if (s.duration != null) {
          const duration = PS.clamp(PS.toInt(s.duration), 1000, PS.MAX_DURATION_MS);
          if (duration !== state.timer.duration) {
            state.timer.duration = duration;
            timerReset();
          }
        }
        break;
      }
      case 'reset-match':
        remember();
        state.teams.forEach((t) => { t.score = 0; t.sets = 0; });
        timerReset();
        break;
      case 'undo': {
        const prev = history.pop();
        if (!prev) return;
        Object.assign(state, prev);
        break;
      }
      default:
        return;
    }
    commit();
  }

  function commit() {
    state.rev += 1;
    save();
    render();
    broadcast();
  }

  function handleMessage(msg, conn) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      sendState(conn);
      return;
    }
    if (msg.t !== 'cmd' || typeof msg.id !== 'string') return;
    // Perintah yang sama bisa datang lewat dua jalur (PeerJS + BroadcastChannel).
    if (seen.has(msg.id)) return;
    seen.set(msg.id, Date.now());
    if (seen.size > 300) seen.delete(seen.keys().next().value);
    apply(msg.cmd);
  }

  /* ---------- Jaringan ---------- */

  const statePacket = () => ({
    t: 'state',
    state,
    remaining: remainingNow(),
    canUndo: history.length > 0,
    controllers: conns.size,
  });

  function sendState(conn) {
    const packet = statePacket();
    if (conn) {
      if (conn.open) conn.send(packet);
      return;
    }
    conns.forEach((c) => { if (c.open) c.send(packet); });
    if (bc) bc.postMessage(packet);
    if (relay && Date.now() - relayActiveAt < RELAY_IDLE_MS) relay.send(packet);
  }

  const broadcast = () => sendState(null);

  function startChannel() {
    if (!('BroadcastChannel' in window)) return;
    bc?.close();
    bc = new BroadcastChannel(PS.channelName(code));
    bc.onmessage = (e) => handleMessage(e.data, null);
  }

  // HP yang terhubung lewat relai mengirim 'hello' (minta state) atau 'ping' (masih ada).
  function onRelay(msg) {
    if (!msg || typeof msg !== 'object' || msg.t === 'state') return; // pesan kita sendiri
    relayActiveAt = Date.now();
    if (typeof msg.from === 'string') {
      const isNew = !relayClients.has(msg.from);
      relayClients.set(msg.from, relayActiveAt);
      if (isNew) setNet(netStatus);
    }
    if (msg.t === 'hello') relay.send(statePacket());
    else if (msg.t === 'cmd') handleMessage(msg, null);
  }

  function relayCount() {
    const now = Date.now();
    relayClients.forEach((at, id) => { if (now - at > RELAY_CLIENT_MS) relayClients.delete(id); });
    return relayClients.size;
  }

  function startRelay() {
    relay?.leave();
    relayClients.clear();
    relay = window.PSRelay ? PSRelay.join(code, onRelay, () => setNet(netStatus)) : null;
  }

  function setNet(status) {
    netStatus = status;
    const labels = {
      connecting: 'Menyiapkan koneksi…',
      ready: 'Siap — belum ada HP',
      duplicate: 'Kode dipakai di tab lain',
      offline: 'Offline — hanya tab di laptop ini',
      reconnecting: 'Menyambung ulang…',
    };
    // Server PeerJS bermasalah tapi relai jalan: HP tetap bisa tersambung.
    const usable = status === 'ready' || (status !== 'duplicate' && relay?.connected);
    const phones = conns.size + relayCount();
    let text = usable ? labels.ready : labels[status] || '';
    let tone = usable ? 'idle' : 'warn';
    if (usable && phones > 0) {
      text = `${phones} HP terhubung`;
      tone = 'ok';
    }
    el.status.dataset.tone = tone;
    el.statusText.textContent = text;
    el.pairNet.textContent = text;
    el.body.classList.toggle('has-remote', phones > 0);
  }

  function startPeer() {
    if (!PS.peerAvailable()) {
      setNet('offline');
      return;
    }
    peer?.destroy();
    setNet('connecting');
    const p = new Peer(PS.peerId(code), PS.peerOptions());
    peer = p;

    p.on('open', () => {
      peerRetry = 0;
      idRetry = 0;
      setNet('ready');
    });

    p.on('connection', (conn) => {
      conn.on('open', () => {
        conns.add(conn);
        setNet('ready');
        broadcast();
        announce('HP terhubung');
        if (el.dialog.open && conns.size === 1) el.dialog.close();
      });
      conn.on('data', (msg) => handleMessage(msg, conn));
      const drop = () => {
        if (!conns.delete(conn)) return;
        setNet(netStatus);
        broadcast();
      };
      conn.on('close', drop);
      conn.on('error', drop);
    });

    p.on('disconnected', () => {
      if (p !== peer || p.destroyed) return;
      // Koneksi HP yang sudah ada tetap jalan; ini hanya sinyal ke server pemasangan.
      setNet('reconnecting');
      setTimeout(() => { if (p === peer && !p.destroyed && p.disconnected) p.reconnect(); }, 500);
    });

    p.on('error', (err) => {
      if (p !== peer) return;
      if (err.type === 'unavailable-id') {
        // Setelah reload/tab ditutup paksa, server masih memegang ID lama sampai soketnya habis.
        if (idRetry < 15) {
          idRetry += 1;
          setNet('reconnecting');
          setTimeout(() => { if (p === peer) startPeer(); }, 1500);
        } else {
          setNet('duplicate');
        }
        return;
      }
      if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(err.type)) {
        setNet(navigator.onLine ? 'reconnecting' : 'offline');
        peerRetry += 1;
        const delay = Math.min(10000, 1000 * peerRetry);
        setTimeout(() => { if (p === peer) startPeer(); }, delay);
      }
    });
  }

  function changeCode() {
    const ok = window.confirm('Buat kode baru? HP yang terhubung akan terputus dan harus memindai ulang.');
    if (!ok) return;
    const old = code;
    code = PS.randomCode();
    PS.store.set(CODE_KEY, code);
    PS.store.set(stateKey(code), state);
    try { localStorage.removeItem(stateKey(old)); } catch { /* abaikan */ }
    conns.forEach((c) => c.close());
    conns.clear();
    renderPairing();
    startChannel();
    startRelay();
    startPeer();
  }

  /* ---------- Tampilan ---------- */

  function render() {
    const { teams, title } = state;
    el.title.textContent = title;
    el.title.hidden = !title;
    document.title = title ? `${title} — PapanScore` : 'Layar Papan Skor — PapanScore';

    teams.forEach((team, i) => {
      const card = el.teams[i];
      card.style.setProperty('--team', team.color);
      card.style.setProperty('--team-ink', PS.inkFor(team.color));
      $('[data-name]', card).textContent = team.name;
      const scoreEl = $('[data-score]', card);
      if (scoreEl.textContent !== String(team.score)) {
        scoreEl.textContent = team.score;
        scoreEl.classList.remove('is-bump');
        void scoreEl.offsetWidth; // restart animasi
        scoreEl.classList.add('is-bump');
      }
      scoreEl.classList.toggle('is-wide', team.score >= 100);
      card.setAttribute('aria-label', `${team.name}: ${team.score} poin`);
      el.sets[i].textContent = team.sets;
      el.setNames[i].textContent = team.name;
      el.setNames[i].parentElement.style.setProperty('--team', team.color);
    });

    const t = state.timer;
    const done = !t.running && t.remaining <= 0;
    el.timerCard.dataset.state = t.running ? 'running' : done ? 'done' : 'paused';
    el.timerState.textContent = t.running ? 'Berjalan' : done ? 'Waktu habis' : t.remaining === t.duration ? 'Siap' : 'Jeda';
    tick();
  }

  function renderPairing() {
    const url = new URL('control.html', location.href);
    url.hash = code;
    el.code.textContent = PS.formatCode(code);
    el.link.textContent = url.href.replace(/^https?:\/\//, '');
    el.link.href = url.href;
    el.localLink.href = url.href;
    el.qr.replaceChildren();
    if (typeof window.qrcode === 'function') {
      const qr = window.qrcode(0, 'M');
      qr.addData(url.href);
      qr.make();
      el.qr.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      const svg = el.qr.querySelector('svg');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', `Kode QR menuju ${url.href}`);
    } else {
      el.qr.textContent = 'QR tidak dapat dimuat. Ketik kode di HP.';
    }
  }

  function announce(text) {
    el.live.textContent = '';
    setTimeout(() => { el.live.textContent = text; }, 50);
  }

  /* ---------- Suara ---------- */

  let audio = null;
  const unlockAudio = () => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audio = audio || new AC();
    if (audio.state === 'suspended') audio.resume();
  };

  function beep() {
    if (!state.sound || !audio || audio.state !== 'running') return;
    const start = audio.currentTime;
    [0, 0.35, 0.7].forEach((offset, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'square';
      osc.frequency.value = i === 2 ? 660 : 880;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, start + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + (i === 2 ? 0.6 : 0.25));
      osc.connect(gain).connect(audio.destination);
      osc.start(start + offset);
      osc.stop(start + offset + 0.7);
    });
  }

  /* ---------- Interaksi lokal ---------- */

  let idleTimer = 0;
  function wake() {
    el.body.classList.remove('is-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!el.dialog.open && !el.body.contains(document.activeElement?.closest('.topbar'))) {
        el.body.classList.add('is-idle');
      }
    }, 3500);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  const KEYS = {
    q: { type: 'score', team: 0, delta: 1 },
    a: { type: 'score', team: 0, delta: -1 },
    p: { type: 'score', team: 1, delta: 1 },
    l: { type: 'score', team: 1, delta: -1 },
    ' ': { type: 'timer-toggle' },
    u: { type: 'undo' },
  };

  document.addEventListener('keydown', (e) => {
    wake();
    unlockAudio();
    if (e.ctrlKey || e.metaKey || e.altKey || el.dialog.open) return;
    if (e.target.closest('input, textarea, select, button, a')) return;
    const key = e.key.toLowerCase();
    if (key === 'f') { toggleFullscreen(); return; }
    if (key === 'k') { el.dialog.showModal(); return; }
    if (KEYS[key]) {
      e.preventDefault();
      apply(KEYS[key]);
    }
  });

  ['pointermove', 'pointerdown'].forEach((type) => document.addEventListener(type, wake, { passive: true }));
  document.addEventListener('pointerdown', unlockAudio, { passive: true });

  el.pairBtn.addEventListener('click', () => el.dialog.showModal());
  el.fullBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    el.fullBtn.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
    const label = document.fullscreenElement ? 'Keluar layar penuh' : 'Layar penuh';
    el.fullBtn.querySelector('span').textContent = label;
    el.fullBtn.setAttribute('aria-label', label);
  });
  if (!document.documentElement.requestFullscreen) el.fullBtn.hidden = true;

  el.dialog.addEventListener('click', (e) => { if (e.target === el.dialog) el.dialog.close(); });
  el.newCodeBtn.addEventListener('click', changeCode);
  el.copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(el.link.href);
      el.copyMsg.textContent = 'Tautan disalin.';
    } catch {
      el.copyMsg.textContent = 'Gagal menyalin — salin tautan secara manual.';
    }
  });

  // Tab lain yang memakai kode sama (mis. reload ganda) memperbarui state dari localStorage.
  window.addEventListener('storage', (e) => {
    if (e.key !== stateKey(code) || !e.newValue) return;
    try {
      const next = JSON.parse(e.newValue);
      if (next.rev > state.rev) { state = next; render(); }
    } catch { /* abaikan */ }
  });

  /* ---------- Mulai ---------- */

  const topbar = $('.topbar');
  const measureTopbar = () => el.body.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
  new ResizeObserver(measureTopbar).observe(topbar);

  el.body.classList.add('js');
  render();
  renderPairing();
  startChannel();
  startRelay();
  startPeer();
  PS.keepAwake();
  setInterval(tick, 200);
  setInterval(() => { broadcast(); if (relayClients.size) setNet(netStatus); }, HEARTBEAT_MS);
  window.addEventListener('online', () => {
    relay?.retryNow();
    if (netStatus !== 'ready') startPeer();
  });
  // Lepas ID di server saat halaman ditutup/di-reload, supaya saat dibuka lagi ID langsung
  // bisa dipakai (tanpa ini server menahannya beberapa detik dan HP harus menunggu).
  window.addEventListener('pagehide', () => { peer?.destroy(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) startPeer(); });
  if (!PS.store.get('ps.display.paired')) {
    el.dialog.showModal();
    PS.store.set('ps.display.paired', true);
  }
  wake();
})();
