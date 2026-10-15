/* PapanScore — utilitas bersama halaman Layar & Kontrol.
   Tidak ada server data: state disimpan di localStorage perangkat Layar,
   HP terhubung langsung (WebRTC via PeerJS) atau lewat BroadcastChannel
   bila dibuka di browser yang sama. */
window.PS = (() => {
  'use strict';

  const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // tanpa 0/O/1/I/L agar tidak tertukar
  const CODE_LEN = 6;
  const PEER_PREFIX = 'papanscore-v1-';
  const MAX_DURATION_MS = 99 * 60000 + 59000;

  const defaultState = () => ({
    v: 1,
    rev: 0,
    title: '',
    sound: true,
    teams: [
      { name: 'TIM A', color: '#E2471B', score: 0, sets: 0 },
      { name: 'TIM B', color: '#1F6FD1', score: 0, sets: 0 },
    ],
    timer: { duration: 30 * 60000, remaining: 30 * 60000, running: false, endsAt: 0 },
  });

  const randomCode = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
    return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  };

  const normalizeCode = (raw) => String(raw || '')
    .toUpperCase()
    .split('')
    .filter((c) => ALPHABET.includes(c))
    .join('')
    .slice(0, CODE_LEN);

  const isValidCode = (code) => code.length === CODE_LEN && [...code].every((c) => ALPHABET.includes(c));
  const formatCode = (code) => `${code.slice(0, 3)}-${code.slice(3)}`;
  const peerId = (code) => PEER_PREFIX + code.toLowerCase();
  const channelName = (code) => `papanscore:${code}`;

  const uid = () => {
    const b = crypto.getRandomValues(new Uint32Array(2));
    return `${Date.now().toString(36)}${b[0].toString(36)}${b[1].toString(36)}`;
  };

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const toInt = (v, fallback = 0) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  };

  const pad = (n) => String(n).padStart(2, '0');
  const formatTime = (ms) => {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  };

  // Teks putih/gelap dipilih otomatis agar kontras tetap terbaca di warna tim apa pun.
  const luminance = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 0;
    const int = Number.parseInt(m[1], 16);
    return [16, 8, 0]
      .map((s) => ((int >> s) & 255) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
  };
  const inkFor = (hex) => ((1.05) / (luminance(hex) + 0.05) >= 3.2 ? '#FFFFFF' : '#0E1116');
  const isHexColor = (v) => /^#[0-9a-f]{6}$/i.test(v || '');

  const store = {
    get(key, fallback = null) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* mode privat / kuota penuh: aplikasi tetap jalan tanpa simpan */
      }
    },
  };

  let wakeLock = null;
  const keepAwake = () => {
    if (!('wakeLock' in navigator)) return;
    const request = async () => {
      if (document.visibilityState !== 'visible' || wakeLock) return;
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } catch {
        /* ditolak browser/baterai lemah: abaikan */
      }
    };
    document.addEventListener('visibilitychange', request);
    request();
  };

  const peerAvailable = () => typeof window.Peer === 'function';

  return {
    CODE_LEN, MAX_DURATION_MS,
    defaultState, randomCode, normalizeCode, isValidCode, formatCode, peerId, channelName,
    uid, clamp, toInt, formatTime, inkFor, isHexColor, store, keepAwake, peerAvailable,
  };
})();
