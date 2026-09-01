# Setup Training Salnova

Halaman **Train** menyediakan empat lokasi eksekusi. Dataset tetap berada di
NAS; worker hanya mengunduh paket job, menjalankan training, lalu mengunggah
`best.pt` ke NAS. Buka **Training setup center** untuk mengunduh script yang
sudah berisi URL server dan token worker.

> Script worker mengandung token rahasia. Jangan unggah ke Git, kirim ke orang
> lain, atau menyimpannya di folder publik. Cabut worker dari halaman Train bila
> file pernah bocor.

## Cara menjalankan script

### Windows PowerShell

1. Unduh tombol **Windows .ps1** pada kartu lokasi yang dipilih.
2. Buka PowerShell dan masuk ke folder Downloads:
   `cd "$env:USERPROFILE\Downloads"`.
3. Buka blokir file, misalnya:
   `Unblock-File .\salnova-this-pc-setup.ps1`.
4. Jalankan:
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\salnova-this-pc-setup.ps1`.
5. Izinkan pemasangan Python bila diminta. Jangan tutup terminal selama worker
   dipakai.

### Linux

1. Unduh tombol **Linux .sh** pada kartu lokasi yang dipilih.
2. Buka Terminal dan masuk ke Downloads: `cd ~/Downloads`.
3. Beri izin: `chmod +x salnova-this-pc-setup.sh`.
4. Jalankan: `./salnova-this-pc-setup.sh`.
5. Masukkan password `sudo` bila package sistem belum tersedia. Jangan tutup
   terminal selama worker dipakai.

Script worker membutuhkan minimal Python 3.10 dan sekitar 6 GB ruang kosong.
Script mencoba runtime CUDA yang cocok bila ada NVIDIA, menguji operasi
TorchVision, lalu jatuh ke CPU jika CUDA tidak lolos tes.

## 1. Training menggunakan PC RTX 5060

1. Di **Training setup center > PC RTX 5060**, unduh script Windows atau Linux.
2. Jalankan script memakai langkah OS di atas.
3. Tunggu daftar device menampilkan **PC RTX 5060 · online**.
4. Di **Training location**, pilih **PC RTX 5060**.
5. Pilih **Automatic**, **CUDA GPU**, atau **CPU**, kemudian worker yang baru.
6. Pilih versi dataset dan tekan **Start training**.

Untuk PC pengembangan saat ini, mode GPU seharusnya menampilkan RTX 5060 dan
`GPU available: True`. Jika tidak, gunakan Automatic dan periksa output setup.

## 2. Training menggunakan device sendiri

1. Buka Salnova melalui URL LAN NAS atau domain HTTPS, bukan `localhost`.
2. Pada kartu **Device sendiri**, unduh script untuk OS device target.
3. Pindahkan file ke device tersebut secara privat, lalu jalankan.
4. Bila script mendeteksi URL localhost, masukkan URL LAN/HTTPS Salnova.
5. Tunggu worker online, pilih **Device sendiri**, lalu pilih nama worker.
6. Mulai training. Job boleh menunggu di antrean sampai device kembali online.

Untuk transfer checkpoint besar di rumah, URL LAN lebih cepat dan menghindari
batas unggahan Cloudflare. Domain HTTPS cocok untuk device di luar jaringan.

## 3. Training menggunakan NAS

NAS tidak memerlukan worker atau token. Container produksi sudah mempunyai
dependency training. Tombol Windows/Linux pada kartu NAS menghasilkan script
pengecekan `/api/ready`; script itu opsional dan tidak memasang package.

1. Pilih **NAS** pada Training location.
2. Pilih **Automatic** atau **CPU**. Gunakan GPU hanya bila NAS benar-benar
   mempunyai GPU yang diteruskan ke container.
3. Pilih versi dataset lalu **Start training**.
4. NAS produksi saat ini CPU-only, sehingga mode ini lebih cocok untuk smoke
   test atau dataset kecil.

## 4. Training menggunakan Google Colab

Notebook adalah cara utama. Salnova harus dapat dijangkau melalui domain HTTPS
publik; runtime Colab tidak dapat membuka URL LAN atau localhost.

1. Pilih **Google Colab** dan **CUDA GPU**.
2. Pada kartu Google Colab tekan **Notebook**.
3. Masukkan URL `https://salnova-ai.my.id` saat diminta.
4. Unggah notebook ke Colab.
5. Pilih **Runtime > Change runtime type > T4 GPU**, lalu **Run all**.
6. Tunggu worker Colab online, pilih namanya di Salnova, lalu mulai training.

Tombol `.ps1` dan `.sh` juga tersedia untuk runtime Windows/Linux cloud yang
ingin didaftarkan sebagai provider Colab. Script tersebut bukan pengganti
notebook pada situs Google Colab.

## Verifikasi dan troubleshooting

- **Worker offline:** terminal setup harus tetap terbuka dan URL server harus
  dapat dijangkau dari device.
- **GPU tidak muncul:** cek `nvidia-smi`, hasil probe CUDA, dan output
  `GPU available` dari script.
- **Job menunggu:** pastikan preference GPU tidak dipilih untuk worker CPU.
- **Colab menolak URL:** gunakan HTTPS publik, bukan alamat LAN.
- **Token bocor:** tekan revoke pada worker lama dan buat setup baru.
- **NAS lambat:** pindahkan job besar ke PC/device/Colab GPU.
