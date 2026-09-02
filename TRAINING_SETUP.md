# Setup Training Salnova

Dataset tersimpan di NAS. Worker mengunduh job, melatih model, lalu mengunggah
`best.pt` ke NAS.

## PC RTX 50/60 Lab: resource bersama

PC RTX lab bukan device yang perlu disiapkan oleh setiap user. Admin lab
memasang worker satu kali pada PC fisik di lab. Setup itu memasang supervisor
dan Scheduled Task, sehingga worker mencoba aktif kembali saat PC menyala atau
user lab login, lalu menyambung lagi ketika jaringan tersedia.

Untuk memakai GPU lab dari PC/laptop mana pun:

1. Login ke Salnova dan buka project.
2. Di **Training location**, pilih **PC RTX 50/60 Lab**.
3. Pastikan worker berstatus **online** dan nama GPU yang tampil benar-benar
   hardware lab.
4. Pilih **Automatic** atau **CUDA GPU**, pilih worker lab, lalu **Start
   training**.

Tidak perlu mengunduh script, memasang CUDA, atau remote desktop ke PC lab.
Job dikirim lewat Salnova ke worker PC lab; hasilnya kembali ke NAS.

> Hanya admin lab yang menyimpan token setup. Jika PC lab diganti atau worker
> perlu dibuat ulang, admin harus meregistrasikan ulang worker dari PC lab.

## Device sendiri: device pribadi

Pilih **Device sendiri** bila training harus berjalan di laptop/workstation
pribadi. Worker ini hanya tampil dan dapat dipilih oleh akun yang
mendaftarkannya.

1. Dari kartu **Device sendiri**, unduh script Windows atau Linux.
2. Jalankan di device target.
3. Tunggu worker online, lalu pilih **Device sendiri** dan nama workernya.

Script memerlukan Python 3.10+ dan sekitar 6 GB ruang kosong. Bila GPU NVIDIA
tersedia, script mencoba runtime CUDA yang kompatibel; bila tidak, worker
menggunakan CPU.

## NAS

NAS tidak memerlukan worker atau token. Pilih **NAS** dan **Automatic** atau
**CPU** untuk training ringan. NAS produksi saat ini CPU-only.

## Google Colab

Gunakan notebook pada kartu **Google Colab**. Salnova harus diakses memakai
HTTPS publik; runtime Colab tidak dapat membuka alamat LAN atau `localhost`.

## Troubleshooting

- **PC RTX lab offline:** pastikan PC lab menyala, internet tersedia, dan
  Scheduled Task `Salnova Training Worker` aktif.
- **Device sendiri offline:** terminal setup pada device tersebut harus tetap
  berjalan dan server harus bisa dijangkau.
- **Job menunggu:** pastikan preference GPU tidak dipilih untuk worker CPU.
- **Token bocor:** revoke worker lama dan buat ulang dari device yang benar.
