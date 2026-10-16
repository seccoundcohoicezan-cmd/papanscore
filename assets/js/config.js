/* Pengaturan opsional PapanScore.
   turnServers: server TURN sebagai relai saat HP dan laptop tidak bisa tersambung
   langsung (mis. HP pakai data seluler, Wi-Fi kampus/kantor yang memisahkan perangkat).
   Biasanya tidak perlu: relai cadangan (relay.js) sudah menangani kasus ini.
   Contoh (kredensial dari dasbor penyedia TURN, mis. Metered atau coturn sendiri):
   turnServers: [
     { urls: 'turn:global.relay.metered.ca:80', username: 'USERNAME', credential: 'PASSWORD' },
     { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'USERNAME', credential: 'PASSWORD' },
   ],
   Kredensial TURN terlihat oleh siapa pun yang membuka halaman; pakai akun dengan kuota terbatas.

   relayBrokers: daftar broker MQTT WebSocket (wss://…/mqtt) untuk relai cadangan.
   Kosongkan baris ini agar memakai bawaan (EMQX, HiveMQ, Mosquitto). Isi [] untuk mematikan relai. */
window.PAPANSCORE_CONFIG = {
  turnServers: [],
  // relayBrokers: ['wss://broker.emqx.io:8084/mqtt'],
};
