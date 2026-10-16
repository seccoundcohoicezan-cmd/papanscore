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
        ├── config.js    # opsional: server TURN sendiri
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
- **Satu browser.** Tab Kontrol dan tab Layar di browser yang sama juga tersambung lewat `BroadcastChannel`. Cara ini tetap jalan walau internet putus.
- **Keamanan.** Siapa pun yang tahu kodenya bisa mengubah skor. Pakai **Buat kode baru** di jendela "Hubungkan HP" untuk memutus semua HP.

## Kalau HP lama sekali "Menghubungkan…"

HP sekarang mencoba ulang otomatis tiap beberapa detik dan biasanya tersambung dalam ±1 detik setelah Layar siap. Kalau muncul pesan *"HP belum bisa tersambung langsung ke laptop karena jaringannya"*, berarti jaringan memblokir koneksi langsung, misalnya HP memakai data seluler sedangkan laptop memakai Wi-Fi, atau Wi-Fi kampus/kantor memisahkan perangkat. Solusinya:

1. Sambungkan HP dan laptop ke **Wi-Fi yang sama**, atau
2. Nyalakan **hotspot HP** lalu sambungkan laptop ke hotspot itu (paling andal), atau
3. Pasang server **TURN** sendiri di `assets/js/config.js` (misalnya akun gratis Metered atau coturn). TURN bawaan PeerJS sudah tidak aktif.

Uji koneksi otomatis: `python tests/e2e_connect.py http://localhost:8000` (butuh Playwright + Chromium). Skenarionya: pairing normal, HP dibuka sebelum Layar, Layar di-reload, dan jalur langsung diblokir.

## Menjalankan & hosting

Semua file statis, jadi tidak perlu build.

- **GitHub Pages:** *Settings → Pages → Deploy from a branch → `main` / root*. Hasilnya ada di `https://seccoundcohoicezan-cmd.github.io/papanscore/`.
- **Vercel / Netlify:** import repo ini tanpa pengaturan tambahan.
- **Lokal:** `python3 -m http.server 8000`, lalu buka `http://localhost:8000`. HP hanya bisa memindai alamat ini kalau berada di jaringan yang sama dan memakai IP laptop. Untuk dipakai dari HP, sebaiknya pakai hosting HTTPS di atas.

## Menyesuaikan

- Warna tema: ubah variabel di `:root`, bagian atas `assets/css/app.css`. Contohnya `--accent` untuk warna lampu papan skor.
- Warna & nama tim default: `defaultState()` di `assets/js/core.js`.
- Batas skor (0–999), set (0–99), dan durasi (maksimal 99:59) ada di `apply()` di `assets/js/display.js`.
