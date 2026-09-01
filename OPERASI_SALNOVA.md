# Operasi Salnova — status deployment dan cara menyambung

Dokumen ini merekam **kondisi nyata** deployment Salnova, bukan panduan umum.
Bacalah ini lebih dulu sebelum menyentuh NAS atau Cloudflare, supaya tidak
mengulang penelusuran yang sudah pernah dilakukan.

Untuk langkah pemasangan dari nol, lihat [PANDUAN_UGREEN_CLOUDFLARE.md](PANDUAN_UGREEN_CLOUDFLARE.md)
dan [UGREEN_DEPLOYMENT.md](UGREEN_DEPLOYMENT.md). Keduanya generik dan memakai
alamat contoh; angka yang benar ada di sini.

Terakhir diperbarui: 1 September 2026.

## Status verifikasi terakhir

Pada 1 September 2026 pukul 19:03 WIB, source aplikasi utama di NAS identik
dengan workspace dan stack produksi sudah memakai build terbaru. Container
`salnova` berstatus **healthy**, `salnova-cloudflared` berjalan, dan pemeriksaan
publik berikut semuanya berhasil:

- `/` -> HTTP 200 melalui Cloudflare
- `/api/health` -> `{"status":"ok","version":"0.3.0","mlReady":true}`
- `/api/ready` -> `{"status":"ready","database":"ok","storage":"writable"}`
- bundle frontend memuat notifikasi, quality gate, evaluasi, routing canary,
  rollback, feedback inference, dan panduan lokasi training
- OpenAPI produksi memuat route backend pasangan fitur-fitur tersebut

Log aplikasi setelah deploy menunjukkan request normal tanpa traceback atau
respons 5xx. Worker GPU juga aktif mengirim heartbeat dan mengambil antrean.

Deploy otomatis sudah aktif. Container memakai
`ghcr.io/aqshalikhsan/vision-flow:latest`, package bisa ditarik anonim dari NAS,
dan `salnova-autodeploy.timer` berstatus enabled + active dengan interval tiga
menit. Pemeriksaan manual terakhir menghasilkan `OK tidak ada image baru`.
Salinan `.env` sebelum aktivasi disimpan sebagai
`.env.bak-autodeploy-20260901` pada project dir NAS.

## 1. Arsitektur

```text
Pengunjung internet
      |
      v
https://salnova-ai.my.id
      |
      v
Cloudflare (DNS, TLS, proxy)
      |
      v  koneksi keluar, tanpa port forwarding
cloudflared  --->  container salnova:8000   (UGREEN NAS di rumah)
                        |
                        +-- visionflow-data    database, upload, versi, run
                        +-- visionflow-models  bobot model
```

Training berat didorong ke worker GPU di luar NAS. NAS berperan sebagai
penyimpan dan koordinator yang selalu menyala.

## 2. Alamat dan identitas

| Hal | Nilai |
|---|---|
| NAS IP LAN | `192.168.11.160` |
| PC pengembangan | `192.168.11.140` (Wi-Fi rumah) |
| SSH alias | `ssh ugreen-nas` (sudah dikonfigurasi di `~/.ssh/config`) |
| Username SSH | `Aqshal Nur Ikhsan` — **memakai spasi** |
| Project dir | `/volume1/docker/salnova` |
| UGOS web | `https://192.168.11.160:9443` |
| Domain | `salnova-ai.my.id` (DomaiNesia, NS ke Cloudflare) |
| Cloudflare account | `c58be738987ee8a8c049f8e722c961d5` |
| Cloudflare zone | `4a4a4ae47bdece44e16b1882c11cfebb` |
| Tunnel | `salnova-ugreen`, id `a41a3316-8430-431b-93fa-55d29dd3fa5b` |
| Ingress | `salnova-ai.my.id` → `http://visionflow:8000` |
| DNS | CNAME root → `<tunnel-id>.cfargotunnel.com`, proxied |

Spesifikasi NAS: x86-64, RAM 7,5 GB, `/volume1` 5,4 TB (RAID 1 dari dua disk
IronWolf 6 TB), Docker 29.4.3, Compose v5.1.3.

Password NAS dan token tunnel **tidak dicatat di repo**. Keduanya ada di `.env`
pada NAS dan di password manager.

## 3. Tujuh jebakan yang sudah ditemukan

Ini bagian terpenting dokumen ini. Semuanya pernah memakan waktu.

**Username SSH memakai spasi.** `ssh aksal@...` ditolak; yang benar
`Aqshal Nur Ikhsan`. Di `~/.ssh/config` nilainya harus dikutip
(`User "Aqshal Nur Ikhsan"`) — tanpa kutip, OpenSSH menolak seluruh file config.
Home-nya `/home/Aqshal Nur Ikhsan`, jadi selalu kutip path.

**SFTP ter-chroot ke `/volume1`.** Lewat `scp`/SFTP, tujuannya
`/docker/salnova/...`, bukan `/volume1/docker/salnova/...`. Salah path membuat
`scp` sukses tanpa efek. Di shell (`ssh`), path lengkapnya normal.
`sftp.stat("/")` melempar `OSError: Operation unsupported`, bukan
`FileNotFoundError`.

**Docker perlu `sudo` dengan password.** Tidak ada NOPASSWD. Gunakan
`sudo -S` dan kirim password lewat stdin; `get_pty=True` membuat password
ter-echo ke output. Jangan gabungkan `sudo -S` dengan `docker exec -i`, keduanya
berebut stdin.

**File dari Windows berakhiran CRLF.** `core.autocrlf=true` di PC. Docker
Compose kebetulan membuang `\r` dari `.env`, tetapi shell script CRLF mati di
shebang dengan `bad interpreter`. [.gitattributes](.gitattributes) sekarang
mengunci `*.sh`, unit systemd, `Dockerfile`, compose, dan `.env*` ke LF.

**`localhost:5173` bukan Salnova produksi.** Vite dev server di PC mem-proxy
`/api` ke backend lokal port 8000, jadi tampilannya identik tetapi database,
akun, dan token worker-nya berbeda. Token dari sana ditolak NAS. Selalu salin
token worker dari `https://salnova-ai.my.id`.

**Router menyimpan cache DNS negatif.** Setelah domain diarahkan ke Cloudflare,
resolver rumah (`DnZO-store.lan`) masih menjawab `SERVFAIL` berjam-jam.
`ipconfig /flushdns` tidak menolong karena cache-nya di router. Verifikasi lewat
`--resolve` ke IP edge Cloudflare, jangan percaya resolver lokal.

**Venv worker tidak selamat dari pemindahan.** `.runtime/VisionFlowWorker/.venv`
dibuat di folder lain lalu disalin, dan interpreter dasarnya sudah dihapus. Venv
yatim harus dibuat ulang lewat `setup.ps1`, tidak bisa diperbaiki.

## 4. Perintah harian

Semua perintah produksi memakai dua `-f`. Menjalankan hanya satu file akan
membuat container tanpa tunnel.

```bash
ssh ugreen-nas
cd /volume1/docker/salnova

sudo docker compose -f compose.ugreen.yml -f compose.cloudflare.yml ps
sudo docker compose -f compose.ugreen.yml -f compose.cloudflare.yml logs -f cloudflared
sudo docker compose -f compose.ugreen.yml -f compose.cloudflare.yml up -d --build
```

Setelah mengubah `.env`, `restart` **tidak** cukup — environment hanya dibaca
ulang saat container dibuat:

```bash
sudo docker compose -f compose.ugreen.yml -f compose.cloudflare.yml up -d --force-recreate visionflow
```

Deploy manual dari PC (hanya bisa dari LAN rumah):

```bash
scp src/App.tsx ugreen-nas:/docker/salnova/src/     # perhatikan path chroot
ssh ugreen-nas 'cd /volume1/docker/salnova && sudo docker compose -f compose.ugreen.yml -f compose.cloudflare.yml up -d --build'
```

Cek kesehatan yang paling jujur, dari luar jaringan:

```text
https://salnova-ai.my.id/api/ready
→ {"status":"ready","database":"ok","storage":"writable"}
```

Satu request itu menguji seluruh rantai: DNS → Cloudflare → tunnel → container →
database. Dashboard Cloudflare hanya tahu kondisi tunnel; kalau aplikasi mati
tetapi `cloudflared` hidup, di sana tetap tertulis HEALTHY.

## 5. Keputusan yang sudah diambil

Jangan diperlakukan sebagai bug, dan jangan dibalik tanpa bertanya.

**Pendaftaran terbuka.** `VISIONFLOW_ALLOW_SELF_REGISTRATION=1`, disengaja —
situs ini memang untuk publik. Konsekuensi yang sudah dipahami pemilik: setiap
pendaftar menjadi `owner` dan `email_verified=1` tanpa verifikasi email.

**Project terisolasi per akun.** Kolom `projects.owner_id`, ditegakkan di
middleware `enforce_workspace_role`, bukan di 72 route satu per satu. Akses =
pemilik atau baris di `project_collaborators`. Balasan **404**, bukan 403, agar
keberadaan project orang lain tidak bisa diendus.

**Demo tutorial disalin per akun.** Tujuh project template disimpan dengan
`owner_id IS NULL` + `demo_key`, disembunyikan dari listing. Salinan pribadi
dibuat saat member pertama kali memuat `/api/projects`, sekali saja
(`workspace_members.demo_seeded`). File **wajib disalin**, tidak boleh dibagi:
`delete_project()` melakukan `rmtree` pada `UPLOADS/<project>`,
`VERSIONS/<project>`, dan `RUNS/<model>`.

**Antrean training tidak kedaluwarsa.** `VISIONFLOW_REMOTE_QUEUE_TTL_MINUTES=0`
berarti job menunggu selamanya sampai worker menyala, karena GPU-nya ada di
komputer yang tidak selalu hidup.

**Image untuk NAS memakai torch CPU.** Build arg `TORCH_INDEX_URL` diisi hanya
di `compose.ugreen.yml`. NAS tidak punya GPU, dan torch CUDA menambah beberapa
GB yang tidak akan pernah terpakai. Default kosong, sehingga
`compose.gpu.yml` tetap mendapat build CUDA.

## 6. CI/CD — aktif

Runner GitHub tidak bisa menjangkau NAS, dan repo ini **publik** sehingga
self-hosted runner berbahaya (PR dari fork akan dieksekusi di NAS). Alurnya
dibalik: GitHub membangun image, NAS yang menjemput.

```text
push ke main → Actions build → ghcr.io/aqshalikhsan/vision-flow:latest
             → timer systemd di NAS polling tiap 3 menit → restart bila berubah
```

Tidak ada kredensial NAS yang disimpan di GitHub. Branch kerja sudah masuk ke
`main`, workflow Deploy sudah menerbitkan image pertama, `.env` NAS sudah berisi
`VISIONFLOW_IMAGE=ghcr.io/aqshalikhsan/vision-flow:latest`, dan timer systemd
sudah aktif. Package dapat ditarik NAS tanpa `docker login`.

Workflow pernah gagal sebelum aktivasi karena nama image mempertahankan huruf
besar dari nama akun GitHub dan post-step cache npm error. Nama image sekarang
dikunci lowercase dan cache npm pada workflow Deploy sengaja tidak dipakai.

## 7. Worker training

Empat pilihan di halaman Train: **PC RTX 5060**, **Device sendiri**, **NAS**, dan
**Google Colab**. Masing-masing mempunyai tutorial dan unduhan Windows `.ps1`
serta Linux `.sh` di **Training setup center**; Colab juga mempunyai notebook.
Panduan pengguna lengkap ada di [TRAINING_SETUP.md](TRAINING_SETUP.md).

PC/device/Colab mengambil job dari antrean bersama tanpa filter pemilik, jadi
worker mana pun dapat melayani user mana pun. Pemilihan mesin tertentu lewat
dropdown **External worker**. NAS menjalankan training langsung di container
dan tidak memakai token worker; script NAS hanya mengecek `/api/ready`.

[worker/run-worker.ps1](worker/run-worker.ps1) menjaga worker tetap hidup:
restart dengan backoff, Scheduled Task saat login, dan pemilihan alamat otomatis
(LAN dulu, jatuh ke domain publik saat di luar rumah). LAN didahulukan karena
lebih cepat dan bebas dari batas 100 MB per request milik Cloudflare Free saat
mengunggah checkpoint.

```powershell
.\worker\run-worker.ps1 -Token "<token dari salnova-ai.my.id>" -Install
.\worker\run-worker.ps1 -Token "<token>" -DryRun    # cek prasyarat saja
```

GPU di PC pengembangan: **RTX 5060, 8 GB VRAM**, arsitektur Blackwell (`sm_120`).
Build PyTorch lama tidak punya kernel untuknya; setelah `setup.ps1` pastikan
outputnya menyebut `GPU available: True`.

Worker mengunduh dataset ke mesinnya selama training, lalu menghapusnya sendiri
(`shutil.rmtree(job_dir)`) kecuali dijalankan dengan `--keep-jobs`.

## 8. Backup

`visionflow-data` berisi database, upload, versi, run, dan cache.
`visionflow-models` berisi bobot model. Keduanya bertahan melewati rebuild dan
recreate container.

Backup `.env` juga — di dalamnya ada token tunnel dan `VISIONFLOW_OTP_SECRET`
yang **tidak boleh berubah** setelah ada akun.

Beberapa salinan `.env.bak-*` tertinggal di project dir dari perubahan
sebelumnya. Boleh dihapus setelah dipastikan tidak diperlukan.

RAID 1 melindungi dari satu disk rusak, tetapi bukan backup: file terhapus atau
ransomware mengenai kedua disk bersamaan.

## 9. Jangan dilakukan

- `docker compose down -v`, dan jangan menghapus `visionflow-data` /
  `visionflow-models`
- `POST /api/restore` untuk memindahkan project — endpoint itu **mengganti
  seluruh database** dan akan menghapus semua akun. Gunakan
  [backend/demo_bundle.py](backend/demo_bundle.py) untuk migrasi selektif
- Membuka port 22, 8080, atau 9443 ke internet
- Mengubah `VISIONFLOW_OTP_SECRET` setelah ada akun
- Membagi path file antar salinan demo
- Menjalankan hanya satu file compose di produksi
