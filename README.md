# PapanScore

Papan skor digital berbasis HTML. **Laptop jadi layar, HP jadi remote.** Tidak ada akun dan tidak ada database. Setiap laptop punya kode sendiri, jadi papan skor perangkat A dan B tidak saling tertukar.

## Halaman

| File | Untuk | Isi |
| --- | --- | --- |
| `index.html` | Semua | Beranda dan cara pakai |
| `display.html` | Laptop / proyektor (penonton) | Skor besar, waktu, set, QR untuk memasangkan HP |
| `control.html` | HP (admin/operator) | Tombol +1/−1, set, mulai/jeda waktu, nama & warna tim, tukar sisi, batalkan, reset |

```
papanscore/
├── index.html
├── display.html
├── control.html
└── assets/
    ├── favicon.svg
    ├── css/app.css      # semua gaya, token warna di :root
    └── js/
        ├── config.js    # opsional: server TURN sendiri, daftar broker relai
        ├── relay.js     # relai cadangan MQTT-over-WSS terenkripsi (tanpa dependensi)
        ├── core.js      # utilitas bersama (kode, state default, penyimpanan, ICE)
        ├── display.js   # Layar: sumber data, simpan ke localStorage, siarkan ke HP
        └── control.js   # Kontrol: kirim perintah, tampilkan state dari Layar
```

## Cara pakai

1. Buka `display.html` di laptop. Muncul **kode 6 huruf** (misalnya `K7P-4QX`) dan **QR**.
2. Pindai QR dengan kamera HP. Bisa juga buka `control.html` lalu ketik kodenya.
3. Tap **+1** di HP, dan skor di laptop langsung berubah. Tekan `F` atau tombol *Layar penuh* untuk tampilan turnamen.

Kalau hanya ada satu laptop, klik **Buka kontrol di tab baru** di jendela "Hubungkan HP". Kontrol dan layar lalu berjalan di laptop yang sama.

Pintasan keyboard di Layar: `Q`/`A` untuk tim kiri +1/−1, `P`/`L` untuk tim kanan +1/−1, `Spasi` untuk mulai/jeda, `U` untuk batalkan, `F` untuk layar penuh, `K` untuk jendela pemasangan.

## Cara kerja

- **Data lokal.** Skor, nama, warna, dan durasi disimpan di `localStorage` browser laptop (Layar). Data tetap ada setelah refresh, dan waktu yang sedang berjalan tetap dihitung.
- **HP ↔ laptop langsung.** Koneksi memakai WebRTC lewat [PeerJS](https://peerjs.com) 1.5.4 (CDN jsDelivr, versi dikunci + SRI). Server publik PeerJS hanya dipakai untuk mempertemukan kedua perangkat. Skor dikirim langsung antar-perangkat (STUN Google + Cloudflare untuk menembus NAT).
- **Relai cadangan otomatis.** Bersamaan dengan WebRTC, HP dan laptop juga masuk ke "ruang" di broker MQTT publik lewat WSS (EMQX, HiveMQ, Mosquitto sekaligus). Jika jaringan memblokir koneksi langsung, perintah dan skor lewat relai ini (status HP: *Terhubung · relai*). Topik memakai hash kode, isi pesan dienkripsi AES-GCM dengan kunci dari kode, jadi broker tidak bisa membaca atau memalsukan pesan. Selama jalur langsung tersambung, relai tidak dipakai mengirim data.
- **Satu browser.** Tab Kontrol dan tab Layar di browser yang sama juga tersambung lewat `BroadcastChannel`. Cara ini tetap jalan walau internet putus.
- **Keamanan.** Siapa pun yang tahu kodenya bisa mengubah skor. Pakai **Buat kode baru** di jendela "Hubungkan HP" untuk memutus semua HP.

## Kalau HP lama sekali "Menghubungkan…"

HP mencoba dua jalur sekaligus: **langsung** (WebRTC, ±1 dtk) dan **relai** (±2 dtk). Jalur mana pun yang lebih dulu tersambung langsung dipakai, jadi data seluler vs Wi-Fi atau Wi-Fi kampus yang memisahkan perangkat tetap bisa tersambung. Kalau keduanya gagal, biasanya internet salah satu perangkat mati atau jaringannya memblokir WebSocket. Coba Wi-Fi yang sama atau hotspot HP. Opsi lanjutan di `assets/js/config.js`: server TURN sendiri dan daftar broker relai.

Uji koneksi otomatis: `python tests/e2e_connect.py http://localhost:8000` (butuh Playwright + Chromium). Skenarionya: pairing normal, HP dibuka sebelum Layar, Layar di-reload, WebRTC diblokir (harus lewat relai), dan relai diblokir (harus lewat WebRTC).

## Menjalankan & hosting

Semua file statis, jadi tidak perlu build.

- **GitHub Pages:** *Settings → Pages → Deploy from a branch → `main` / root*. Hasilnya ada di `https://seccoundcohoicezan-cmd.github.io/papanscore/`.
- **Vercel / Netlify:** import repo ini tanpa pengaturan tambahan.
- **Lokal:** `python3 -m http.server 8000`, lalu buka `http://localhost:8000`. HP hanya bisa memindai alamat ini kalau berada di jaringan yang sama dan memakai IP laptop. Untuk dipakai dari HP, sebaiknya pakai hosting HTTPS di atas.

## Menyesuaikan

- Warna tema: ubah variabel di `:root`, bagian atas `assets/css/app.css`. Contohnya `--accent` untuk warna lampu papan skor.
- Warna & nama tim default: `defaultState()` di `assets/js/core.js`.
- Batas skor (0–999), set (0–99), dan durasi (maksimal 99:59) ada di `apply()` di `assets/js/display.js`.
