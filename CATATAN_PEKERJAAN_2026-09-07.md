# Catatan Pekerjaan Salnova, 7 September 2026

Dokumen ini merangkum perubahan aplikasi, pengujian, dan deployment yang dikerjakan hari ini.

## 1. Upload gambar dan video berukuran besar

- Mengubah pengiriman file menjadi upload bertahap atau chunked upload.
- File besar tidak perlu dipotong manual oleh pengguna.
- Setiap file dikirim dalam beberapa bagian yang berada di bawah batas request Cloudflare.
- Mendukung kelanjutan alur upload gambar dan video berukuran lebih dari 100 MB, termasuk pengujian kebutuhan file 200 MB dan 300 MB.
- Menambahkan progres upload dan tahap pemrosesan setelah seluruh bagian diterima server.

Commit: `3f28a6e`.

## 2. Koneksi permanen PC RTX 50/60 Lab

- Memperbaiki worker PC RTX agar terhubung kembali setelah Windows restart.
- Menambahkan pemasangan Scheduled Task untuk menjalankan worker sejak Windows menyala atau pengguna login.
- Menambahkan mekanisme restart otomatis dengan backoff jika worker berhenti sendiri.
- Memprioritaskan alamat LAN dan menggunakan domain publik sebagai fallback.
- Menjaga antrean training agar tetap menunggu ketika PC lab sedang mati.
- Menambahkan cara menyalakan worker secara manual dari halaman Train dan script setup.

Commit: `1ab7739`.

## 3. Panduan penggunaan Salnova

- Membuat panduan penggunaan yang menjelaskan akses melalui domain, pengelolaan project, upload dataset, labeling, augmentasi, dataset version, training, inference, deployment, dan pelaporan bug.
- Menambahkan peringatan agar NAS tidak dimatikan karena berfungsi sebagai server.
- Menjelaskan bahwa PC RTX 50/60 Lab harus dinyalakan dan tersambung internet sebelum digunakan untuk training.
- Menyusun versi PDF landscape empat halaman yang padat dan siap dicetak.
- Menyesuaikan judul menjadi **Tutorial Penggunaan Salnova** dan merapikan tata letak agar halaman terisi penuh.

File: `PANDUAN_PENGGUNA_SALNOVA.html` dan `PANDUAN_PENGGUNA_SALNOVA.pdf`.

## 4. Fine-tuning dengan data baru

- Menambahkan alur fine-tuning dari model yang sudah selesai dilatih.
- Pengguna dapat menambahkan dataset baru, melakukan labeling, menjalankan augmentasi, membuat dataset version, lalu melatih ulang model.
- Arsitektur YOLO dapat dipilih sesuai tipe project dan model dasar yang digunakan.
- Menambahkan panduan langkah demi langkah dari Model Registry menuju dataset, anotasi, version, dan Train.

Commit: `49009c9`.

## 5. Workspace Research dan Architecture Lab

- Menambahkan menu **Workspace > Research**.
- Menambahkan builder arsitektur **Backbone > Neck > Head**.
- Research dapat memakai project Object Detection yang sudah ada atau membuat project baru.
- Dataset dapat ditambah, dilabeli, diaugmentasi, dibuat menjadi immutable version, lalu digunakan untuk training model baru.
- Training dapat dijalankan pada NAS/server atau dedicated worker PC/GPU.
- Model hasil Research masuk ke Model Registry seperti model training biasa.

Katalog yang tersedia:

- 37 metode Backbone.
- 24 metode Neck.
- 36 metode Head.
- Backbone siap train mencakup C2f CSP, C3k2 CSP, Darknet C3, ResNet, ResNeXt, Wide ResNet, ConvNeXt, EfficientNet, MobileNetV3, dan DenseNet.
- Neck siap train mencakup Direct Multi-scale, FPN, PAN-FPN/PAFPN, SPPF+FPN, dan SPPF+PAN-FPN.
- Head siap train mencakup Ultralytics Detect, YOLOv8 Detect, YOLO11 Detect, YOLO12 Detect, YOLO26 Detect, dan YOLOv10 End-to-End.
- Metode lain tetap tersedia di katalog dengan status **Adapter** dan alasan kebutuhan runtime yang jelas.

Commit utama: `f448887`.

## 6. Compatibility status dan Adapter Studio

- Mengubah panel kompatibilitas dan nomor tahap menjadi warna gelap.
- Menambahkan penjelasan perbedaan **Siap train** dan **Adapter**.
- Seluruh Neck dan Head sekarang tampil di dropdown, bukan hanya komponen yang siap train.
- Komponen katalog dapat dipilih untuk menyusun rancangan meskipun runtime adapter belum tersedia.
- Menambahkan **Adapter Studio** dengan pengaturan:
  - mode otomatis atau manual;
  - output channel P3/stride 8;
  - output channel P4/stride 16;
  - output channel P5/stride 32;
  - proyeksi channel Conv 1x1;
  - resize Nearest atau Bilinear;
  - validasi shape wajib sebelum masuk antrean.
- Compiler server hanya menerima komponen yang masuk allowlist dan menyusun graph model secara aman.
- Kombinasi tanpa module, loss, assignment, atau decoder yang diperlukan tidak dapat masuk antrean sampai runtime adapter tersedia.

Commit: `0ff28af` dan `d51e048`.

## 7. Informasi progres training Research

- Setelah pengguna menekan Train, halaman tidak lagi hanya menampilkan notifikasi singkat.
- Menambahkan kartu status yang terus diperbarui dari server.
- Informasi yang ditampilkan meliputi status antrean, lokasi training, persentase, tahap proses, epoch, batch, loss, error, dan tautan menuju Model Registry.
- Menampilkan spinner ketika konfigurasi sedang dikirim, job menunggu worker, atau training berlangsung.

Commit: `d51e048`.

## 8. Pengujian dan deployment

- Menjalankan TypeScript build dan Vite production build.
- Menjalankan Python syntax validation untuk backend dan worker.
- Menguji inisialisasi graph Research pada runtime Ultralytics.
- Menguji backbone dan neck siap train, termasuk adapter otomatis dan manual.
- Menguji YOLO11 Detect dan YOLOv10 End-to-End.
- Menambahkan pengujian browser untuk route Research, katalog, dropdown, dan Adapter Studio.
- Menjalankan Prettier format check.
- Seluruh workflow CI dan Deploy terakhir berhasil.
- Produksi diverifikasi melalui `https://salnova-ai.my.id/api/ready` dengan database dan storage dalam kondisi siap.

Commit terakhir sebelum dokumen ini: `d51e048`.
