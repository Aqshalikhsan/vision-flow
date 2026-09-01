# Panduan Lengkap Salnova di UGREEN dengan Cloudflare Tunnel

Panduan ini memasang Salnova sebagai aplikasi Docker yang selalu aktif di UGREEN
NAS dan dapat diakses melalui alamat HTTPS publik. Seluruh database, dataset,
gambar, hasil anotasi, model, dan hasil training tetap disimpan di UGREEN.
Cloudflare hanya menangani domain, HTTPS, perlindungan jaringan, dan meneruskan
trafik melalui tunnel terenkripsi.

Arsitektur akhirnya:

```text
Pengguna internet
       |
       v
https://salnova.domainanda.com
       |
       v
Cloudflare (DNS, TLS, proxy, proteksi)
       |
       v
cloudflared -- koneksi keluar terenkripsi
       |
       v
Container Salnova di UGREEN:8000
       |
       +-- visionflow-data   (database, dataset, upload, hasil)
       +-- visionflow-models (model AI)
```

Tidak diperlukan `start.ps1`, komputer Windows yang selalu menyala, IP publik,
atau port forwarding pada router. UGREEN dan koneksi internetnya tetap harus
menyala agar aplikasi dapat diakses.

## 1. Yang perlu disiapkan

- UGREEN NAS dengan UGOS Pro dan aplikasi Docker terpasang.
- Akun administrator UGREEN untuk pengaturan awal.
- Akun Cloudflare.
- Domain aktif, misalnya `domainanda.com`.
- Subdomain untuk Salnova, misalnya `salnova.domainanda.com`.
- Repository Salnova ini, termasuk:
  - `Dockerfile`
  - `compose.ugreen.yml`
  - `compose.cloudflare.yml`
  - `.env.ugreen.example`
- Ruang kosong yang cukup untuk dataset dan model.
- Sebaiknya UGREEN menggunakan IP LAN tetap atau DHCP reservation.

Domain berbayar bukan bagian dari paket Cloudflare Free. Domain dapat dibeli di
registrar mana pun, kemudian DNS-nya dikelola melalui Cloudflare.

## 2. Batasan yang perlu diketahui

Pada Cloudflare Free, ukuran maksimal satu request upload adalah 100 MB. Ruang
penyimpanan UGREEN boleh jauh lebih besar, tetapi file tetap melewati Cloudflare
sebelum sampai ke NAS. Dataset ZIP atau video yang lebih besar perlu diunggah
melalui LAN/UGREENlink, dipecah menjadi beberapa bagian, atau kelak menggunakan
fitur chunked upload.

Proses HTTP yang tidak mengirim respons terlalu lama juga dapat terkena timeout
Cloudflare. Karena itu training harus berjalan sebagai background job dengan
status/progress polling, bukan sebagai satu request HTTP yang menunggu training
selesai.

Referensi resmi:

- [Cloudflare upload limits](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/#upload-limits)
- [Cloudflare Error 524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)
- [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/setup/)
- [Cloudflare Tunnel tokens](https://developers.cloudflare.com/tunnel/advanced/tunnel-tokens/)

## 3. Menyiapkan domain di Cloudflare

Lewati bagian ini apabila domain sudah berstatus **Active** di Cloudflare.

1. Masuk ke [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Pilih **Add a domain** atau **Onboard a domain**.
3. Masukkan domain utama, misalnya `domainanda.com`.
4. Pilih paket Free jika belum memerlukan fitur berbayar.
5. Cloudflare akan memberikan dua nameserver.
6. Masuk ke registrar tempat domain dibeli dan ganti nameserver domain dengan
   kedua nameserver Cloudflare tersebut.
7. Tunggu sampai status domain di Cloudflare menjadi **Active**.

Tidak perlu membuat A record menuju IP rumah. Cloudflare Tunnel akan membuat
rute DNS yang sesuai tanpa membuka alamat NAS secara langsung.

## 4. Membuat Cloudflare Tunnel

Nama menu Cloudflare dapat sedikit berubah, tetapi alurnya adalah Zero Trust atau
Networking, kemudian Tunnels.

1. Dari Cloudflare Dashboard, buka **Zero Trust**.
2. Buka **Networks/Networking > Tunnels**.
3. Pilih **Create a tunnel**.
4. Pilih connector **Cloudflared**.
5. Beri nama tunnel, misalnya `salnova-ugreen`.
6. Pada halaman pemasangan connector, pilih **Docker**.
7. Salin perintah Docker yang ditampilkan ke tempat aman sementara.

Perintah tersebut kurang lebih berbentuk:

```bash
docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token eyJ...
```

Yang diperlukan oleh Salnova hanya bagian token panjang yang dimulai dengan
`eyJ...`. Jangan memasukkan seluruh perintah Docker ke `.env`.

> Token tunnel adalah rahasia. Siapa pun yang memilikinya dapat menjalankan
> connector untuk tunnel tersebut. Jangan mengirim token melalui chat, email,
> screenshot publik, commit Git, atau dokumentasi.

### Membuat Public Hostname

Di pengaturan tunnel, tambahkan **Public Hostname** atau **Published Application**:

| Pengaturan | Nilai contoh |
|---|---|
| Subdomain | `salnova` |
| Domain | `domainanda.com` |
| Path | kosong |
| Service type | `HTTP` |
| Service URL | `http://visionflow:8000` |

Gunakan tepat `http://visionflow:8000`, bukan `localhost:8000`, bukan IP NAS,
dan bukan port publik `8080`. `visionflow` adalah nama service pada jaringan
internal Docker yang dipakai bersama oleh Salnova dan `cloudflared`.

Simpan hostname tersebut. Alamat finalnya menjadi:

```text
https://salnova.domainanda.com
```

## 5. Menyiapkan folder Salnova di UGREEN

Gunakan Storage Manager/File Manager UGOS untuk membuat shared folder, misalnya:

```text
docker/salnova
```

Path absolut di SSH berbeda antar-volume dan model UGREEN. Cari path sebenarnya
melalui File Manager atau jalankan `pwd` setelah masuk ke folder tersebut. Dalam
panduan ini, path itu disebut `<SALNOVA_DIR>`.

Salin repository ke folder itu melalui salah satu cara berikut:

- SMB/File Explorer dari komputer Windows.
- File Manager UGOS.
- Git melalui SSH, jika repository tersedia di remote pribadi.

Jangan ikut menyalin folder/file lokal berikut:

```text
node_modules
.venv-backend
.env.local
local_data
dist
test-results
*.pt dari komputer pengembangan, kecuali memang diperlukan
```

Pastikan sekurangnya file berikut tersedia di folder UGREEN:

```text
Dockerfile
compose.ugreen.yml
compose.cloudflare.yml
.env.ugreen.example
backend/
src/
package.json
```

## 6. Mengaktifkan SSH UGREEN

SSH adalah metode yang paling mudah untuk menjalankan gabungan dua file Compose.

1. Buka **Control Panel > Terminal/SSH** di UGOS Pro.
2. Aktifkan SSH hanya pada jaringan lokal.
3. Catat IP LAN UGREEN dan port SSH.
4. Dari Windows PowerShell, masuk dengan:

```powershell
ssh username@192.168.1.50
```

Ganti username dan IP sesuai UGREEN. Password diketik langsung pada prompt SSH;
jangan menuliskannya ke file atau memasukkannya ke command line.

Setelah terhubung, pindah ke folder Salnova:

```bash
cd <SALNOVA_DIR>
pwd
ls -la
```

## 7. Membuat konfigurasi `.env`

Di folder Salnova pada UGREEN:

```bash
cp .env.ugreen.example .env
```

Buat secret OTP permanen. Pilih salah satu perintah yang tersedia:

```bash
openssl rand -base64 48
```

atau:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Edit `.env` menggunakan editor UGOS atau editor terminal. Contoh produksi:

```dotenv
VISIONFLOW_PUBLIC_URL=https://salnova.domainanda.com
VISIONFLOW_ALLOWED_ORIGINS=https://salnova.domainanda.com
VISIONFLOW_ALLOWED_HOSTS=salnova.domainanda.com,192.168.1.50
VISIONFLOW_COOKIE_SECURE=1

# Tetap menyediakan akses LAN pada port 8080.
VISIONFLOW_BIND_ADDRESS=0.0.0.0
VISIONFLOW_PORT=8080

# Tempel hanya token eyJ... dari Cloudflare.
CLOUDFLARE_TUNNEL_TOKEN=eyJ...

# Ganti dengan hasil openssl/python dan jangan diubah setelah aplikasi digunakan.
VISIONFLOW_OTP_SECRET=SECRET_ACAK_PANJANG

# Akun baru dibuat oleh owner/admin, bukan pendaftaran publik bebas.
VISIONFLOW_ALLOW_SELF_REGISTRATION=0

VISIONFLOW_RATE_LIMIT=120
VISIONFLOW_AUTH_RATE_LIMIT=30
VISIONFLOW_AUTH_RATE_WINDOW_SECONDS=300
VISIONFLOW_DB_BUSY_TIMEOUT_MS=30000
VISIONFLOW_REMOTE_QUEUE_TTL_MINUTES=120

# Sesuaikan dengan RAM NAS dan sisakan RAM untuk UGOS.
VISIONFLOW_MEMORY_LIMIT=6g
VISIONFLOW_SHM_SIZE=1gb
TZ=Asia/Jakarta

# Email OTP opsional.
VISIONFLOW_SMTP_HOST=smtp.gmail.com
VISIONFLOW_SMTP_PORT=587
VISIONFLOW_SMTP_USERNAME=
VISIONFLOW_SMTP_PASSWORD=
VISIONFLOW_SMTP_FROM=

# Asisten Gemini opsional.
GEMINI_API_KEY=
VISIONFLOW_GEMINI_MODEL=gemini-3.6-flash
```

Catatan:

- Gunakan domain final yang sama pada `PUBLIC_URL`, `ALLOWED_ORIGINS`, dan
  `ALLOWED_HOSTS`.
- `VISIONFLOW_COOKIE_SECURE=1` wajib untuk deployment HTTPS publik.
- Jangan menambahkan `https://` pada `VISIONFLOW_ALLOWED_HOSTS`; variabel ini
  hanya berisi hostname/IP.
- Jangan mengganti `VISIONFLOW_OTP_SECRET` setelah akun mulai digunakan.
- Jangan commit `.env` ke Git.

Batasi izin baca `.env` jika filesystem UGREEN mendukungnya:

```bash
chmod 600 .env
```

## 8. Memvalidasi dan menjalankan container

Masih dari `<SALNOVA_DIR>`, validasi konfigurasi:

```bash
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml config --quiet
```

Jika perintah kembali tanpa error, build dan jalankan:

```bash
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml up -d --build
```

Periksa status:

```bash
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml ps
```

Container yang diharapkan:

| Container | Kondisi normal |
|---|---|
| `salnova` | `Up` dan kemudian `healthy` |
| `salnova-cloudflared` | `Up` |

Lihat log awal:

```bash
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml logs --tail=100 visionflow
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml logs --tail=100 cloudflared
```

Log `cloudflared` yang sehat akan menunjukkan koneksi tunnel telah terdaftar.
Dashboard Cloudflare juga seharusnya menampilkan status connector **Healthy**.

## 9. Pengujian setelah deployment

### Dari LAN

Buka:

```text
http://192.168.1.50:8080/api/health
http://192.168.1.50:8080/api/ready
```

Ganti IP dengan IP UGREEN. Endpoint `ready` harus menunjukkan database tersedia
dan storage dapat ditulis.

### Dari internet

Matikan Wi-Fi pada ponsel agar benar-benar memakai jaringan seluler, lalu buka:

```text
https://salnova.domainanda.com
https://salnova.domainanda.com/api/health
https://salnova.domainanda.com/api/ready
```

Periksa bahwa:

- HTTPS aktif dan browser tidak menampilkan peringatan sertifikat.
- Halaman login terbuka.
- Login dapat dilakukan.
- Refresh halaman tidak mengeluarkan pengguna secara tiba-tiba.
- Upload gambar kecil berhasil.
- Membuat project/dataset tetap tersimpan setelah container direstart.

Setelah login pertama, buat owner/admin dan matikan pendaftaran mandiri apabila
tidak dibutuhkan. Gunakan password unik dan kuat.

## 10. Memastikan hidup otomatis setelah restart

Kedua service menggunakan:

```yaml
restart: unless-stopped
```

Artinya container kembali hidup setelah Docker atau UGREEN restart, kecuali
container sebelumnya dihentikan secara manual. Uji pada waktu yang aman:

1. Restart UGREEN melalui antarmuka UGOS.
2. Tunggu Docker selesai aktif.
3. Periksa halaman publik.
4. Jika perlu, periksa kembali dengan `docker compose ... ps`.

Tidak perlu menjalankan `start.ps1`. File tersebut hanya untuk pengembangan pada
komputer Windows.

## 11. Penyimpanan dan backup

Compose membuat dua direktori persisten di samping file Compose:

```text
visionflow-data/
visionflow-models/
```

`visionflow-data` berisi database, upload, dataset version, run, export, dan cache
aplikasi. `visionflow-models` berisi checkpoint/model AI. Mengganti atau membangun
ulang container tidak menghapus kedua folder ini.

Backup sekurangnya:

```text
.env
visionflow-data/
visionflow-models/
```

Untuk backup SQLite yang konsisten, hentikan penulisan atau hentikan service
Salnova sebentar:

```bash
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml stop visionflow
```

Jalankan backup/snapshot UGREEN, lalu hidupkan lagi:

```bash
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml start visionflow
```

RAID melindungi dari kerusakan satu disk, tetapi bukan pengganti backup. Simpan
salinan kedua di perangkat atau lokasi lain.

## 12. Upgrade aplikasi

Sebelum upgrade, buat backup. Kemudian perbarui source dan build ulang:

```bash
cd <SALNOVA_DIR>
git pull
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml up -d --build
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml ps
```

Perbarui image `cloudflared` secara berkala:

```bash
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml pull cloudflared
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml up -d
```

Jangan menjalankan `docker compose down -v` dan jangan menghapus
`visionflow-data` atau `visionflow-models` saat upgrade.

## 13. Pengaturan untuk banyak pengguna

Jumlah akun tersimpan biasanya bukan masalah utama. Kapasitas lebih dipengaruhi
oleh jumlah pengguna aktif bersamaan, ukuran upload, inferensi, training, RAM,
CPU, dan kecepatan upload internet UGREEN.

Rekomendasi awal:

- Gunakan autentikasi Salnova untuk pengguna umum.
- Tetapkan `VISIONFLOW_ALLOW_SELF_REGISTRATION=0` dan buat akun melalui admin.
- Batasi role/izin pengguna sesuai kebutuhan.
- Jalankan training berat melalui remote worker GPU.
- Antrekan pekerjaan training; jangan menjalankan banyak training berat bersamaan
  pada CPU NAS.
- Pantau RAM, CPU, temperatur, ruang disk, dan bandwidth UGREEN.
- Lakukan load test sebelum membuka akses ke banyak pengguna.

Cloudflare Access dapat dipasang khusus untuk halaman/admin internal, tetapi tidak
harus digunakan untuk seluruh pengguna Salnova. Dengan demikian akun pengguna
umum tidak bergantung pada kuota pengguna Cloudflare Zero Trust Access.

## 14. Cache Cloudflare yang aman

Jangan menggunakan aturan **Cache Everything** untuk seluruh aplikasi. Halaman
login dan respons pengguna bersifat privat.

Gunakan bypass cache untuk:

```text
/api/*
route login/logout/auth
upload
dataset
model
export privat
```

Aset frontend statis seperti JS, CSS, font, dan ikon dapat menggunakan cache
default Cloudflare. HTML dan JSON tidak dicache secara default, tetapi tetap
hindari rule yang memaksa cache pada konten autentikasi.

## 15. Keamanan minimum

- Jangan membuka port 8000/8080 pada router ke internet.
- Jangan mengekspos UI admin UGOS, SMB, NFS, SSH, atau database ke internet.
- Batasi SSH ke LAN atau VPN dan nonaktifkan kembali jika tidak diperlukan.
- Gunakan password admin unik dan aktifkan MFA pada akun Cloudflare.
- Simpan `.env` dan token tunnel sebagai rahasia.
- Matikan self-registration jika tidak dibutuhkan.
- Perbarui UGOS, Docker image Salnova, dan `cloudflared` secara berkala.
- Aktifkan notifikasi status Tunnel pada Cloudflare bila tersedia.
- Backup konfigurasi dan data secara rutin.
- Jangan cache route yang memuat data pengguna.

Jika token tunnel bocor, rotate token melalui halaman tunnel Cloudflare, ganti
`CLOUDFLARE_TUNNEL_TOKEN` di `.env`, lalu recreate connector:

```bash
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml up -d --force-recreate cloudflared
```

## 16. Perintah operasional sehari-hari

Untuk menghindari salah file, semua perintah produksi memakai dua `-f`:

```bash
# Status
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml ps

# Log real-time
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml logs -f

# Restart aplikasi saja
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml restart visionflow

# Restart tunnel saja
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml restart cloudflared

# Hentikan stack tanpa menghapus data
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml down

# Hidupkan kembali
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml up -d
```

## 17. Troubleshooting

### Domain menampilkan Error 1033

Tunnel tidak tersambung ke Cloudflare.

```bash
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml ps
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml logs --tail=200 cloudflared
```

Periksa token, akses internet UGREEN, waktu/tanggal NAS, dan status tunnel di
dashboard Cloudflare.

### Mendapat 502 Bad Gateway

Tunnel aktif tetapi tidak dapat menghubungi Salnova.

- Pastikan service URL di Cloudflare adalah `http://visionflow:8000`.
- Pastikan kedua container dibuat melalui perintah Compose gabungan yang sama.
- Pastikan `salnova` berstatus healthy.

```bash
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml logs --tail=200 visionflow
```

### Mendapat Invalid host header atau 400

Pastikan `.env` berisi hostname publik tanpa salah eja:

```dotenv
VISIONFLOW_ALLOWED_HOSTS=salnova.domainanda.com,192.168.1.50
```

Kemudian recreate Salnova:

```bash
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml up -d --force-recreate visionflow
```

### Login berhasil tetapi kembali ke halaman login

Periksa tiga nilai berikut:

```dotenv
VISIONFLOW_PUBLIC_URL=https://salnova.domainanda.com
VISIONFLOW_ALLOWED_ORIGINS=https://salnova.domainanda.com
VISIONFLOW_COOKIE_SECURE=1
```

Pastikan browser membuka domain HTTPS final, bukan IP HTTP ketika menguji session
publik. Hapus cookie lama setelah mengganti domain.

### Upload gagal dengan 413

File melewati batas ukuran request Cloudflare. Gunakan file di bawah batas paket,
upload melalui LAN, atau implementasikan chunked upload. Menambah kapasitas disk
UGREEN tidak mengubah batas per-request Cloudflare.

### Proses gagal dengan Error 524

Request ke origin terlalu lama. Ubah proses menjadi background job dengan polling,
kurangi pekerjaan sinkron, atau gunakan jalur non-proxy untuk operasi administratif
yang memang berlangsung lama.

### Container terus restart

```bash
docker inspect salnova --format '{{.State.Status}} {{.State.ExitCode}} {{.State.Error}}'
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml logs --tail=300 visionflow
```

Periksa RAM, izin tulis folder, `.env`, ruang disk, dan hasil `/api/ready`.

### Perubahan `.env` tidak diterapkan

Perintah `restart` saja tidak selalu membuat ulang environment container. Gunakan:

```bash
docker compose -f compose.ugreen.yml -f compose.cloudflare.yml up -d --force-recreate
```

## 18. Checklist akhir

- [ ] Domain berstatus Active di Cloudflare.
- [ ] Tunnel `salnova-ugreen` dibuat.
- [ ] Public hostname menuju `http://visionflow:8000`.
- [ ] Token hanya disimpan di `.env` UGREEN.
- [ ] `VISIONFLOW_PUBLIC_URL` memakai HTTPS dan domain final.
- [ ] `VISIONFLOW_COOKIE_SECURE=1`.
- [ ] OTP secret sudah acak, panjang, dan dibackup dengan aman.
- [ ] Kedua container berstatus Up; Salnova healthy.
- [ ] `/api/health` dan `/api/ready` dapat diakses.
- [ ] Login dan upload gambar kecil berhasil dari jaringan seluler.
- [ ] Tidak ada port forwarding ke UGREEN.
- [ ] Self-registration dimatikan jika tidak dibutuhkan.
- [ ] Backup `.env`, `visionflow-data`, dan `visionflow-models` sudah dijadwalkan.
- [ ] Uji restart UGREEN berhasil menghidupkan stack otomatis.

Setelah seluruh checklist terpenuhi, Salnova berjalan terus melalui Docker di
UGREEN dan dapat diakses secara global tanpa `start.ps1`.
