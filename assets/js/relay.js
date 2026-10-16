/* Jalur cadangan PapanScore: relai lewat broker MQTT publik (WebSocket/WSS).
   Dipakai bersamaan dengan WebRTC. Jika jaringan memblokir koneksi langsung HP↔laptop
   (data seluler vs Wi-Fi, Wi-Fi kampus yang memisahkan perangkat), keduanya tetap
   tersambung karena hanya butuh koneksi keluar biasa seperti membuka situs web.

   Privasi: topik = hash kode, isi pesan dienkripsi AES-GCM dengan kunci turunan kode
   (PBKDF2). Broker dan pihak lain tanpa kode tidak bisa membaca atau memalsukan pesan.
   Klien MQTT 3.1.1 minimal (QoS 0) ditulis sendiri agar tanpa dependensi. */
window.PSRelay = (() => {
  'use strict';

  const DEFAULT_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
  ];
  const KEEPALIVE_S = 30;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* ---------- Paket MQTT ---------- */

  const str = (s) => {
    const b = enc.encode(s);
    return [b.length >> 8, b.length & 255, ...b];
  };
  const varLen = (n) => {
    const out = [];
    do {
      let byte = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) byte |= 128;
      out.push(byte);
    } while (n > 0);
    return out;
  };
  const packet = (type, body) => new Uint8Array([type, ...varLen(body.length), ...body]);

  const connectPkt = (clientId) => packet(0x10, [...str('MQTT'), 4, 0x02, 0, KEEPALIVE_S, ...str(clientId)]);
  const subscribePkt = (topic) => packet(0x82, [0, 1, ...str(topic), 0]);
  const publishPkt = (topic, payload) => packet(0x30, [...str(topic), ...payload]);
  const PINGREQ = new Uint8Array([0xc0, 0]);

  // Satu frame WebSocket bisa berisi beberapa paket, atau satu paket terpotong.
  function parser(onPacket) {
    let buf = new Uint8Array(0);
    return (chunk) => {
      const next = new Uint8Array(buf.length + chunk.length);
      next.set(buf);
      next.set(chunk, buf.length);
      buf = next;
      for (;;) {
        if (buf.length < 2) return;
        let len = 0;
        let mul = 1;
        let i = 1;
        for (;;) {
          if (i >= buf.length) return;
          const byte = buf[i++];
          len += (byte & 127) * mul;
          mul *= 128;
          if (!(byte & 128)) break;
          if (i > 4) { buf = new Uint8Array(0); return; }
        }
        if (buf.length < i + len) return;
        onPacket(buf[0], buf.subarray(i, i + len));
        buf = buf.slice(i + len);
      }
    };
  }

  /* ---------- Kriptografi ---------- */

  const hex = (bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

  async function deriveRoom(code) {
    const topicHash = await crypto.subtle.digest('SHA-256', enc.encode(`papanscore-v1-topic:${code}`));
    const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode('papanscore-v1-relay'), iterations: 100000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    return { topic: `papanscore/v1/${hex(topicHash).slice(0, 32)}`, key };
  }

  async function seal(key, msg) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(msg)));
    const out = new Uint8Array(12 + ct.byteLength);
    out.set(iv);
    out.set(new Uint8Array(ct), 12);
    return out;
  }

  async function open(key, bytes) {
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
      return JSON.parse(dec.decode(pt));
    } catch {
      return null; // bukan pesan kita / dipalsukan
    }
  }

  /* ---------- Koneksi ke satu broker ---------- */

  function brokerLink(url, topic, onPayload, onState) {
    let ws = null;
    let ready = false;
    let closed = false;
    let retry = 0;
    let pingTimer = 0;
    let retryTimer = 0;
    let connectTimer = 0;

    const start = () => {
      if (closed) return;
      ready = false;
      try {
        ws = new WebSocket(url, 'mqtt');
      } catch {
        scheduleRetry();
        return;
      }
      ws.binaryType = 'arraybuffer';
      const feed = parser((type, body) => {
        const kind = type >> 4;
        if (kind === 2) { // CONNACK
          if (body[1] !== 0) { ws.close(); return; }
          ws.send(subscribePkt(topic));
        } else if (kind === 9) { // SUBACK
          clearTimeout(connectTimer);
          ready = true;
          retry = 0;
          onState();
        } else if (kind === 3) { // PUBLISH QoS 0
          const tlen = (body[0] << 8) | body[1];
          onPayload(body.subarray(2 + tlen));
        }
      });
      ws.onopen = () => {
        ws.send(connectPkt(`ps-${PS.uid()}`.slice(0, 23)));
        clearInterval(pingTimer);
        pingTimer = setInterval(() => { if (ws?.readyState === 1) ws.send(PINGREQ); }, (KEEPALIVE_S - 5) * 1000);
      };
      ws.onmessage = (e) => feed(new Uint8Array(e.data));
      ws.onclose = () => {
        clearInterval(pingTimer);
        clearTimeout(connectTimer);
        const was = ready;
        ready = false;
        if (was) onState();
        scheduleRetry();
      };
      ws.onerror = () => ws.close();
      // Broker yang tidak menjawab (diblokir DNS/firewall) jangan ditunggu lama.
      connectTimer = setTimeout(() => { if (!ready) ws.close(); }, 6000);
    };

    const scheduleRetry = () => {
      if (closed) return;
      clearTimeout(retryTimer);
      retry += 1;
      retryTimer = setTimeout(start, Math.min(30000, 1000 * 2 ** Math.min(retry, 5)));
    };

    start();
    return {
      get ready() { return ready; },
      publish(payload) { if (ready) ws.send(publishPkt(topic, payload)); },
      retryNow() { if (!ready && !closed) { clearTimeout(retryTimer); retry = 0; ws?.close(); start(); } },
      close() {
        closed = true;
        clearInterval(pingTimer);
        clearTimeout(retryTimer);
        clearTimeout(connectTimer);
        ws?.close();
      },
    };
  }

  /* ---------- Ruang (satu kode = satu ruang) ---------- */

  // Membuka ruang untuk sebuah kode di semua broker sekaligus; pesan dikirim ke semua
  // broker yang tersambung dan penerima membuang duplikat (id perintah / rev state).
  function join(code, onMessage, onChange = () => {}) {
    if (!('WebSocket' in window) || !crypto.subtle) return null;
    const brokers = (window.PAPANSCORE_CONFIG || {}).relayBrokers || DEFAULT_BROKERS;
    let links = [];
    let key = null;
    let left = false;
    const queue = [];

    const ready = deriveRoom(code).then((room) => {
      if (left) return;
      key = room.key;
      links = brokers.map((url) => brokerLink(url, room.topic, async (bytes) => {
        const msg = await open(key, bytes);
        if (msg && !left) onMessage(msg);
      }, () => {
        onChange();
        if (links.some((l) => l.ready)) queue.splice(0).forEach((m) => send(m));
      }));
    }).catch(() => {});

    async function send(msg) {
      if (left) return;
      if (!key || !links.some((l) => l.ready)) {
        if (msg.t === 'hello') queue.splice(0, queue.length, msg);
        return;
      }
      const payload = await seal(key, msg);
      links.forEach((l) => l.publish(payload));
    }

    return {
      ready,
      send,
      get connected() { return links.some((l) => l.ready); },
      retryNow() { links.forEach((l) => l.retryNow()); },
      leave() {
        left = true;
        links.forEach((l) => l.close());
      },
    };
  }

  return { join };
})();
