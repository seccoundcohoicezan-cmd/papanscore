/* Pengaturan opsional PapanScore.
   turnServers: server TURN sebagai relai saat HP dan laptop tidak bisa tersambung
   langsung (mis. HP pakai data seluler, Wi-Fi kampus/kantor yang memisahkan perangkat).
   Tanpa TURN, gunakan Wi-Fi yang sama atau hotspot HP untuk laptop.
   Contoh (kredensial dari dasbor penyedia TURN, mis. Metered atau coturn sendiri):
   turnServers: [
     { urls: 'turn:global.relay.metered.ca:80', username: 'USERNAME', credential: 'PASSWORD' },
     { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'USERNAME', credential: 'PASSWORD' },
   ],
   Kredensial TURN terlihat oleh siapa pun yang membuka halaman; pakai akun dengan kuota terbatas. */
window.PAPANSCORE_CONFIG = {
  turnServers: [],
};
