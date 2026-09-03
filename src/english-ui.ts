const LANGUAGE_KEY = "salnova-auth-language";

const exactTranslations = new Map<string, string>([
  [
    "Chatbot sedang tidak dapat dihubungi.",
    "The chatbot is currently unavailable.",
  ],
  ["Aduan gagal dikirim", "Failed to send the bug report"],
  ["Tanyakan cara menggunakan Salnova...", "Ask how to use Salnova..."],
  [
    "Gemini dapat membuat kesalahan. Periksa kembali konfigurasi penting.",
    "Gemini can make mistakes. Review important configurations.",
  ],
  ["Form aduan bug", "Bug report form"],
  ["Seret untuk memindahkan form aduan", "Drag to move the bug report form"],
  [
    "Aduan tersimpan untuk evaluasi tim",
    "Reports are saved for team evaluation",
  ],
  ["Tutup form aduan", "Close bug report form"],
  ["Dataset / anotasi", "Dataset / annotation"],
  [
    "Contoh: tombol simpan tidak merespons",
    "Example: the save button does not respond",
  ],
  ["Aduan tersimpan. Terima kasih.", "Report saved. Thank you."],
  ["Mengirim…", "Sending…"],
  ["Kirim aduan", "Send report"],
  ["Pilih bantuan", "Choose support"],
  ["Aduan bug", "Bug report"],
  ["Tutup panel bantuan", "Close support panel"],
  ["Buka menu bantuan", "Open support menu"],
  [
    "Klik untuk membuka bantuan, atau seret untuk memindahkan",
    "Click to open support, or drag to move",
  ],
  ["Workspace belum siap", "Workspace is not ready"],
  [
    "Backend belum dapat memuat project. Pastikan API sudah aktif lalu coba lagi.",
    "The backend could not load projects. Make sure the API is active, then try again.",
  ],
  [
    "Memuat project, dataset, model, deployment, dan tutorial. Halaman akan terbuka otomatis setelah semuanya siap.",
    "Loading projects, datasets, models, deployments, and tutorials. The page will open automatically when everything is ready.",
  ],
  ["Memuat data dari backend", "Loading data from the backend"],
  ["Gunakan akun lain", "Use another account"],
  ["Lanjutkan sesi?", "Continue session?"],
  [
    "Pilih akun sebelum Salnova memuat workspace.",
    "Choose an account before Salnova loads the workspace.",
  ],
  ["Lewati tutorial", "Skip tutorial"],
  ["Kembali", "Back"],
  ["Lanjut", "Next"],
  ["Selesai", "Finish"],
  [
    "Panduan alur selesai. Anda dapat membukanya kembali dari Dashboard.",
    "Workflow tour completed. You can reopen it from the Dashboard.",
  ],
  [
    "Project contoh belum tersedia untuk menjalankan tutorial",
    "Sample projects are not available for the tutorial yet",
  ],
  [
    "Project dan seluruh file berhasil dihapus",
    "Project and all files were deleted",
  ],
  ["Gagal menghapus project", "Failed to delete project"],
  ["Project dibuat dari template", "Project created from template"],
  ["Gagal menggunakan template", "Failed to use template"],
  [
    "Project berhasil dibuat di database lokal",
    "Project created in the local database",
  ],
  ["Gagal membuat project", "Failed to create project"],
  ["Gagal memperbarui project", "Failed to update project"],
  ["Foto profil berhasil diperbarui", "Profile photo updated"],
  ["Foto profil gagal diunggah", "Failed to upload profile photo"],
  ["Advance providers gagal dimuat", "Failed to load Advance providers"],
  ["Belum ada AI draft untuk direview", "There are no AI drafts to review yet"],
  ["Advance job gagal dibuat", "Failed to create the Advance job"],
  [
    "Pilih kategori dan engine sesuai dataset. Semua hasil batch disimpan sebagai draft sampai Anda menerimanya.",
    "Choose a category and engine for the dataset. All batch results remain drafts until you accept them.",
  ],
  [
    "Smart Mask tidak memproses semua gambar. Mode ini membuka Annotator agar Anda klik objek dan memperoleh satu mask presisi yang langsung bisa diedit.",
    "Smart Mask does not process every image. It opens the Annotator so you can click an object and get one precise, editable mask.",
  ],
  [
    "Pilih job yang sudah selesai, periksa hasilnya, lalu accept atau reject draft.",
    "Choose a completed job, review its results, then accept or reject the drafts.",
  ],
  ["Auto-generate semua gambar", "Auto-generate all images"],
  [
    "Buat project terlebih dahulu sebelum menjalankan Advance.",
    "Create a project before running Advance.",
  ],
  ["Untuk satu gambar, dengan klik.", "For one image, with a click."],
  [
    "Pilih engine lalu buka Annotator. Pilih class dan klik objek untuk membuat polygon yang dapat diedit per vertex.",
    "Choose an engine and open the Annotator. Select a class and click an object to create a vertex-editable polygon.",
  ],
  [
    "Ini bukan auto-label seluruh dataset. Gunakan Automatic Batch Masks untuk memproses banyak gambar sekaligus.",
    "This does not auto-label the entire dataset. Use Automatic Batch Masks to process many images at once.",
  ],
  ["Buka hasil ini di annotator", "Open this result in the annotator"],
  ["Buka menu akun", "Open account menu"],
  ["Ganti akun", "Switch account"],
  [
    "Masukkan kode untuk bergabung ke project orang lain.",
    "Enter a code to join another person's project.",
  ],
  ["Gagal membuat undangan", "Failed to create invitation"],
  ["Gagal memproses permintaan", "Failed to process request"],
  [
    "Tunggu upload yang sedang berjalan selesai",
    "Wait for the current upload to finish",
  ],
  ["Upload gagal", "Upload failed"],
  [
    "Upload video satu per satu agar frame dapat dipreview terlebih dahulu",
    "Upload videos one at a time so frames can be previewed first",
  ],
  ["Hapus gambar ini dari dataset?", "Delete this image from the dataset?"],
  ["Gambar dihapus", "Image deleted"],
  ["Gagal menghapus gambar", "Failed to delete image"],
  [
    "Semua kolaborator memiliki fungsi project yang sama.",
    "All collaborators have the same project capabilities.",
  ],
  ["Menunggu persetujuan", "Awaiting approval"],
  [
    "Belum ada kolaborator yang disetujui.",
    "There are no approved collaborators yet.",
  ],
  ["Class dihapus", "Class deleted"],
  ["Gagal menghapus class", "Failed to delete class"],
  ["Nama class baru", "New class name"],
  ["Class disimpan ke database", "Class saved to the database"],
  ["Gagal menambah class", "Failed to add class"],
  ["Gagal menyimpan anotasi", "Failed to save annotation"],
  ["Nama class wajib diisi", "Class name is required"],
  ["Nama class sudah digunakan", "Class name is already in use"],
  ["Gagal menyimpan class", "Failed to save class"],
  ["Gagal mengubah warna", "Failed to change color"],
  [
    "Frame awal harus memiliki anotasi",
    "The first frame must have annotations",
  ],
  [
    "Anotasikan frame endpoint berikutnya terlebih dahulu",
    "Annotate the next endpoint frame first",
  ],
  [
    "Tidak ada frame kosong di antara kedua endpoint",
    "There are no empty frames between the two endpoints",
  ],
  ["Interpolasi gagal", "Interpolation failed"],
  ["Gagal menyimpan label", "Failed to save label"],
  ["Ubah nama class", "Rename class"],
  ["Gagal mengubah class", "Failed to rename class"],
  ["Gambar sebelumnya", "Previous image"],
  ["Gambar berikutnya", "Next image"],
  ["Tersimpan. Buat version", "Saved. Create a version"],
  ["Tambah class", "Add class"],
  ["Ubah warna class", "Change class color"],
  ["Tersimpan otomatis", "Saved automatically"],
  [
    "Gunakan tombol panah di atas untuk memeriksa gambar berikutnya.",
    "Use the arrow buttons above to review the next image.",
  ],
  [
    "Dataset version YOLO berhasil dibuat di filesystem",
    "YOLO dataset version created in the filesystem",
  ],
  ["Gagal membuat version", "Failed to create version"],
  ["Buat dataset version terlebih dahulu", "Create a dataset version first"],
  ["Training gagal dimulai", "Failed to start training"],
  ["Inference gagal", "Inference failed"],
  [
    "Gambar contoh deployment tidak tersedia",
    "The deployment sample image is unavailable",
  ],
  [
    "Gagal menjalankan contoh deployment",
    "Failed to run the deployment example",
  ],
  ["Gagal memperbarui threshold", "Failed to update threshold"],
  ["Video inference gagal", "Video inference failed"],
  ["Webcam inference gagal", "Webcam inference failed"],
  ["Kamera tidak dapat dibuka", "The camera could not be opened"],
  ["Nama API key", "API key name"],
  ["Workflow disimpan ke SQLite", "Workflow saved to SQLite"],
  ["Workflow gagal", "Workflow failed"],
  ["Workflow JSON tidak valid", "Invalid workflow JSON"],
  [
    "Workflow JSON dimuat. Save untuk menyimpannya.",
    "Workflow JSON loaded. Select Save to store it.",
  ],
  ["Import gagal", "Import failed"],
  ["Duplikasi gagal", "Duplication failed"],
  ["Schedule gagal disimpan", "Failed to save schedule"],
  ["Dataset scan gagal", "Dataset scan failed"],
  [
    "Tidak ada asset yang membutuhkan pekerjaan anotasi",
    "No assets require annotation work",
  ],
  ["Nama annotation job", "Annotation job name"],
  ["Scan gagal", "Scan failed"],
  ["Generate version gagal", "Version generation failed"],
  [
    "Aktifkan minimal satu transformasi atau matikan augmentasi",
    "Enable at least one transformation or turn augmentation off",
  ],
  ["Nama version", "Version name"],
  ["Catatan version", "Version notes"],
  ["Gagal memperbarui version", "Failed to update version"],
  ["Version diff gagal", "Version diff failed"],
  ["Rollback gagal", "Rollback failed"],
  ["Version gagal dibuat", "Failed to create version"],
  [
    "Membuat immutable dataset version",
    "Creating an immutable dataset version",
  ],
  ["gambar dataset sudah terbentuk", "dataset images created"],
  ["Nama training worker", "Training worker name"],
  ["Gagal membuat worker", "Failed to create worker"],
  ["URL server tidak valid", "Invalid server URL"],
  [
    "Google Colab memerlukan URL HTTPS publik, bukan localhost",
    "Google Colab requires a public HTTPS URL, not localhost",
  ],
  [
    "Notebook Colab dibuat. Jangan bagikan karena berisi token worker.",
    "Colab notebook created. Do not share it because it contains a worker token.",
  ],
  ["Gagal membuat notebook Colab", "Failed to create the Colab notebook"],
  [
    "Setup worker diunduh. Jalankan di laptop target dengan PowerShell.",
    "Worker setup downloaded. Run it on the target laptop with PowerShell.",
  ],
  [
    "Setup Linux/macOS diunduh. Script akan memasang dependency yang belum tersedia.",
    "Linux/macOS setup downloaded. The script will install missing dependencies.",
  ],
  ["Script verifikasi NAS diunduh.", "NAS verification script downloaded."],
  [
    "Buat dan pilih dataset version terlebih dahulu",
    "Create and select a dataset version first",
  ],
  [
    "Training dimulai menggunakan dataset version yang dipilih",
    "Training started with the selected dataset version",
  ],
  ["Pilih dataset version terlebih dahulu", "Select a dataset version first"],
  [
    "Pilih satu dedicated worker untuk seluruh sweep",
    "Select one dedicated worker for the entire sweep",
  ],
  ["Gagal menghapus version", "Failed to delete version"],
  [
    "Training dilanjutkan dari checkpoint terakhir yang tersedia",
    "Training resumed from the latest available checkpoint",
  ],
  ["Resume training gagal", "Failed to resume training"],
  [
    "Training belum tersedia untuk proyek multi-label",
    "Training is not available for multi-label projects yet",
  ],
  [
    "Mengapa tidak ada tombol Start training?",
    "Why is there no Start training button?",
  ],
  ["Buka dataset", "Open dataset"],
  ["Buat atau export version", "Create or export a version"],
  ["Jalankan langsung di server", "Run directly on the server"],
  ["Dedicated worker wajib dipilih", "A dedicated worker is required"],
  ["Kalau tidak ada worker yang menyala", "If no worker is online"],
  ["Setelah script terunduh", "After the script is downloaded"],
  ["Masuk ke folder Downloads:", "Open the Downloads folder:"],
  ["Buka blokir file hasil download:", "Unblock the downloaded file:"],
  ["Jalankan setup:", "Run setup:"],
  ["Daftarkan PC RTX (Windows)", "Register RTX PC (Windows)"],
  ["Daftarkan PC RTX (Linux)", "Register RTX PC (Linux)"],
  ["Gagal mencabut worker", "Failed to revoke worker"],
  ["Gagal membatalkan", "Failed to cancel"],
  ["Gagal menyimpan polygon", "Failed to save polygon"],
  ["Tambahkan minimal 1 keypoint", "Add at least one keypoint"],
  [
    "Smart mask dibuat dan dapat diedit per vertex",
    "Smart mask created and editable by vertex",
  ],
  ["Smart mask gagal", "Smart mask failed"],
  ["Memeriksa grafik dan gambar...", "Checking charts and images..."],
  [
    "Belum ada artefak pada bagian ini",
    "There are no artifacts in this section yet",
  ],
  ["Nama model", "Model name"],
  [
    "Buat dataset version sebelum mengimpor model",
    "Create a dataset version before importing a model",
  ],
  [
    "best.pt tervalidasi dan dimasukkan ke Model Registry",
    "best.pt validated and added to the Model Registry",
  ],
  ["Import model gagal", "Model import failed"],
  ["Nama model diperbarui", "Model name updated"],
  ["Gagal rename model", "Failed to rename model"],
  ["Model dan weights dihapus", "Model and weights deleted"],
  ["Gagal menghapus model", "Failed to delete model"],
  ["Export gagal", "Export failed"],
  ["Lifecycle gagal diubah", "Failed to change lifecycle"],
  ["Retry training gagal", "Training retry failed"],
  ["Training gagal", "Training failed"],
  ["Buka panduan format dataset", "Open dataset format guide"],
  ["Dataset import gagal", "Dataset import failed"],
  ["Hapus gambar dan anotasinya?", "Delete the image and its annotations?"],
  ["Gambar dan anotasi berhasil dihapus", "Image and annotations deleted"],
  [
    "Auto-label selesai dan hasil disimpan ke dataset",
    "Auto-label completed and results saved to the dataset",
  ],
  ["Auto-label gagal", "Auto-label failed"],
  ["Bulk action gagal", "Bulk action failed"],
  ["Nama anggota", "Member name"],
  ["Email anggota", "Member email"],
  ["Anggota workspace ditambahkan", "Workspace member added"],
  ["Gagal menambah anggota", "Failed to add member"],
  ["Perangkat ini", "This device"],
  ["Browser storage aktif", "Browser storage active"],
  ["Tidak tersedia", "Unavailable"],
  [
    "Browser tidak memberikan akses estimasi penyimpanan",
    "The browser does not provide a storage estimate",
  ],
  ["Evaluasi aduan bug", "Bug report evaluation"],
  [
    "Tinjau laporan pengguna, catat hasil evaluasi, dan perbarui status penyelesaiannya.",
    "Review user reports, record evaluation results, and update their resolution status.",
  ],
  ["halaman tidak tercatat", "page not recorded"],
  ["Tidak direproduksi", "Not reproduced"],
  ["Catatan hasil evaluasi...", "Evaluation notes..."],
  ["Evaluasi aduan disimpan", "Bug report evaluation saved"],
  ["Evaluasi gagal disimpan", "Failed to save evaluation"],
  ["Menyimpan…", "Saving…"],
  ["Simpan", "Save"],
  ["Belum ada aduan", "There are no reports yet"],
  [
    "Aduan yang dikirim pengguna akan tampil di sini.",
    "Reports submitted by users will appear here.",
  ],
  ["Password anggota diperbarui", "Member password updated"],
  ["Gagal mengubah password", "Failed to change password"],
  ["Gagal menghapus anggota", "Failed to delete member"],
  ["Selamat datang di Salnova", "Welcome to Salnova"],
  [
    "Panduan bergerak dari Dashboard ke project, dataset, anotasi, training, registry, hingga deployment secara berurutan.",
    "This tour moves from the Dashboard through projects, datasets, annotation, training, registry, and deployment in sequence.",
  ],
  ["Deteksi objek dengan bounding box", "Detect objects with bounding boxes"],
  [
    "Ini adalah project Object Detection lengkap yang sudah melewati import data, training, dan deployment.",
    "This is a complete Object Detection project that has gone through data import, training, and deployment.",
  ],
  ["Periksa gambar dan bounding box", "Review images and bounding boxes"],
  [
    "Dataset berisi delapan gambar COCO8 nyata dan anotasi objek yang menjadi sumber pembelajaran model.",
    "The dataset contains eight real COCO8 images and object annotations used to train the model.",
  ],
  [
    "Pisahkan setiap objek dengan polygon mask",
    "Separate every object with polygon masks",
  ],
  [
    "Instance Segmentation memberi mask terpisah pada setiap objek, sehingga dua objek dengan class sama tetap dapat dibedakan.",
    "Instance Segmentation creates a separate mask for every object, so objects of the same class remain distinct.",
  ],
  ["Petakan area gambar per class", "Map image regions by class"],
  [
    "Semantic Segmentation mewarnai setiap pixel berdasarkan class area. Periksa mask, class, dan dataset version yang sudah dibuat.",
    "Semantic Segmentation colors every pixel by region class. Review the masks, classes, and generated dataset version.",
  ],
  ["Deteksi objek yang berotasi", "Detect rotated objects"],
  [
    "OBB menggunakan empat titik sudut agar kotak mengikuti arah objek. Ini cocok untuk drone, dokumen, dan objek miring.",
    "OBB uses four corner points so boxes follow object orientation. It works well for drones, documents, and tilted objects.",
  ],
  ["Temukan pose dan titik penting", "Find poses and key points"],
  [
    "Keypoint Detection mempelajari titik yang berurutan, seperti 17 titik tubuh manusia pada COCO Pose.",
    "Keypoint Detection learns ordered points, such as the 17 human body points in COCO Pose.",
  ],
  ["Pilih satu class untuk setiap gambar", "Choose one class for each image"],
  [
    "Single-Label Classification menetapkan tepat satu class utama. Hasil training ditampilkan sebagai Top-1 accuracy.",
    "Single-Label Classification assigns exactly one primary class. Training results are shown as Top-1 accuracy.",
  ],
  ["Pilih beberapa label sekaligus", "Choose multiple labels at once"],
  [
    "Multi-Label Classification memungkinkan satu gambar memiliki beberapa label. Label tersimpan otomatis dan dataset dapat diekspor.",
    "Multi-Label Classification allows one image to have multiple labels. Labels are saved automatically and the dataset can be exported.",
  ],
  [
    "Baca epoch, loss, F1, precision, dan recall",
    "Read epochs, loss, F1, precision, and recall",
  ],
  [
    "Buka subbagian hasil training untuk melihat ringkasan metrik, kurva, confusion matrix, serta gambar train dan validation batch.",
    "Open the training results section to see metric summaries, curves, the confusion matrix, and train and validation batch images.",
  ],
  ["Kelola best.pt dan lifecycle model", "Manage best.pt and model lifecycle"],
  [
    "Model Registry menyimpan checkpoint, metrik, download weights, resume, fine-tuning, export, dan status production.",
    "The Model Registry stores checkpoints, metrics, weight downloads, resume, fine-tuning, exports, and production status.",
  ],
  ["Jalankan inference objek nyata", "Run inference on real objects"],
  [
    "Model production dimuat dari best.pt. Uji gambar, video, atau webcam untuk melihat bounding box, class, dan confidence.",
    "The production model loads from best.pt. Test images, videos, or a webcam to inspect bounding boxes, classes, and confidence.",
  ],
  ["Mendeteksi model dan hardware", "Detecting model and hardware"],
  ["MODE YANG DIPILIH", "SELECTED MODE"],
  [
    "Buka job yang selesai, periksa confidence dan provenance, lalu accept atau reject setiap draft.",
    "Open a completed job, review confidence and provenance, then accept or reject each draft.",
  ],
  [
    "Setup Windows/Linux untuk seluruh lokasi training.",
    "Windows/Linux setup for every training location.",
  ],
  [
    "Setup device sendiri membuat token sekali pakai dan mengunduh script yang sudah berisi alamat server ini.",
    "Personal-device setup creates a one-time token and downloads a script containing this server address.",
  ],
  [
    "Jalankan setup di device target hingga status worker online.",
    "Run setup on the target device until the worker is online.",
  ],
  ["Berikan izin eksekusi:", "Grant execute permission:"],
  [
    "Resource GPU bersama yang dikelola admin lab.",
    "Shared GPU resource managed by the lab administrator.",
  ],
  ["Pastikan status worker online.", "Make sure the worker status is online."],
  [
    "Pilih PC RTX 50/60 Lab lalu Start training.",
    "Select PC RTX 50/60 Lab, then select Start training.",
  ],
  ["Admin lab: daftarkan PC RTX sekali", "Lab admin: register the RTX PC once"],
  [
    "Buka Salnova melalui alamat LAN/HTTPS.",
    "Open Salnova through its LAN/HTTPS address.",
  ],
  [
    "Unduh dan pindahkan script ke device target.",
    "Download and move the script to the target device.",
  ],
  ["Jalankan hingga worker online.", "Run it until the worker is online."],
  [
    "Pilih nama worker lalu Start training.",
    "Select the worker name, then select Start training.",
  ],
  [
    "Unduh script pengecekan opsional.",
    "Download the optional verification script.",
  ],
  [
    "Jalankan untuk memastikan backend ready.",
    "Run it to confirm the backend is ready.",
  ],
  ["Pilih NAS dan Automatic/CPU.", "Select NAS and Automatic/CPU."],
  [
    "Klik Start training; tidak perlu worker.",
    "Select Start training; no worker is required.",
  ],
  ["Panduan memilih lokasi training", "Training location guide"],
  [
    "Klik untuk sembunyikan atau tampilkan penjelasan",
    "Click to hide or show the explanation",
  ],
  [
    "Dataset selalu tersimpan di server, di mana pun training berjalan. Pilihan ini hanya menentukan mesin mana yang memproses, lalu mengirimkan kembali",
    "The dataset always remains on the server, wherever training runs. This selection only determines which machine processes it and returns",
  ],
  [
    "Tanpa setup apa pun, langsung jalan. Tetapi server tidak punya GPU, jadi hanya cocok untuk dataset kecil atau uji coba singkat. Dataset besar bisa memakan waktu berjam-jam.",
    "Runs immediately without setup. The server has no GPU, so it is best for small datasets or short tests. Large datasets can take hours.",
  ],
  [
    "PC lab bersama. Admin mengelola worker agar aktif otomatis saat PC menyala; user cukup memilihnya saat status online.",
    "A shared lab PC. The admin keeps its worker starting automatically; users only need to select it while it is online.",
  ],
  [
    "Hubungkan laptop atau workstation Windows/Linux lain ke NAS. Script memasang environment terisolasi dan memilih GPU NVIDIA jika kompatibel, dengan fallback CPU. Device ini hanya tampil dan dapat dipilih oleh akun yang mendaftarkannya.",
    "Connect another Windows/Linux laptop or workstation to the NAS. The script installs an isolated environment and uses a compatible NVIDIA GPU with CPU fallback. Only the account that registered the device can see and select it.",
  ],
  [
    "Runtime cloud tanpa perangkat keras sendiri. Unduh notebook dari Setup Center lalu jalankan selnya di Colab. Syaratnya Salnova harus diakses lewat alamat HTTPS publik, karena runtime Colab tidak bisa menjangkau alamat LAN.",
    "A cloud runtime requiring no personal hardware. Download the notebook from Setup Center and run it in Colab. Salnova must use a public HTTPS address because Colab cannot reach LAN addresses.",
  ],
  [
    "Setiap run dikunci ke satu token device. Worker lain tidak dapat mengambil job, log, atau checkpoint run tersebut. Folder save lokal juga dipisahkan berdasarkan ID worker.",
    "Each run is locked to one device token. Other workers cannot claim its job, logs, or checkpoints. Local save folders are also separated by worker ID.",
  ],
  [
    "Job tetap menunggu dedicated worker yang dipilih. Device lain tidak mengambil alih secara otomatis, sehingga hasil dan log tidak tercampur.",
    "The job keeps waiting for its selected dedicated worker. Other devices do not take over automatically, keeping results and logs separate.",
  ],
  ["Panduan dataset & configuration", "Dataset and configuration guide"],
  [
    "Konfigurasi menentukan sumber data, kebutuhan memori, kecepatan, dan cara model memperbarui bobot selama training.",
    "Configuration determines the data source, memory requirements, speed, and how the model updates weights during training.",
  ],
  [
    "Snapshot dataset yang akan dilatih. Isi gambar, anotasi, class, resize, dan pembagian train/valid tidak berubah selama run.",
    "The dataset snapshot used for training. Its images, annotations, classes, resize, and train/validation split remain unchanged during a run.",
  ],
  [
    "Pilih pretrained resmi untuk run baru, atau best.pt sebelumnya agar pengetahuan model lama dilanjutkan ke dataset/config baru.",
    "Choose official pretrained weights for a new run, or a previous best.pt to continue existing knowledge on a new dataset/configuration.",
  ],
  [
    "Jumlah putaran model membaca seluruh data train. Lebih banyak dapat meningkatkan hasil, tetapi lebih lama dan bisa overfit.",
    "The number of passes over all training data. More epochs can improve results, but take longer and may overfit.",
  ],
  [
    "Resolusi input training. Ukuran besar membantu objek kecil, tetapi memakai VRAM/RAM dan waktu komputasi lebih banyak.",
    "Training input resolution. Larger sizes help small objects but use more VRAM/RAM and compute time.",
  ],
  [
    "Jumlah gambar yang diproses sekali update. Batch besar lebih stabil tetapi membutuhkan memori lebih besar; turunkan jika OOM.",
    "The number of images processed per update. Larger batches are more stable but need more memory; reduce this after an OOM error.",
  ],
  [
    "Algoritma pembaruan bobot. Auto paling aman; SGD cenderung stabil, sedangkan Adam/AdamW sering lebih cepat untuk fine-tuning.",
    "The weight-update algorithm. Auto is safest; SGD is generally stable, while Adam/AdamW are often faster for fine-tuning.",
  ],
  [
    "Besar langkah setiap pembaruan bobot. Terlalu tinggi dapat tidak stabil, terlalu rendah membuat proses belajar sangat lambat.",
    "The step size for each weight update. Too high can be unstable; too low makes learning very slow.",
  ],
  [
    "Training berhenti lebih awal jika metrik tidak membaik selama sejumlah epoch ini. Nilai 0 menonaktifkan early stopping.",
    "Training stops early if metrics do not improve for this many epochs. A value of 0 disables early stopping.",
  ],
  [
    "Mengunci layer awal agar tidak diperbarui. Berguna untuk dataset kecil atau fine-tuning cepat; nilai 0 melatih semua layer.",
    "Prevents early layers from updating. Useful for small datasets or quick fine-tuning; 0 trains every layer.",
  ],
  [
    "Regularisasi untuk menahan bobot agar tidak terlalu besar dan mengurangi overfitting. Default 0.0005 cocok sebagai titik awal.",
    "Regularization that limits weight growth and reduces overfitting. The 0.0005 default is a good starting point.",
  ],
  [
    "Menonaktifkan augmentasi mosaic pada beberapa epoch terakhir agar model beradaptasi kembali dengan tampilan gambar normal.",
    "Disables mosaic augmentation for the final epochs so the model readapts to normal images.",
  ],
  [
    "Mengatur perubahan learning rate. Cosine menurunkannya secara halus; linear/default mengikuti jadwal standar trainer.",
    "Controls learning-rate changes. Cosine reduces it smoothly; linear/default follows the trainer's standard schedule.",
  ],
  [
    "AMP lebih cepat dan hemat VRAM pada GPU. FP32 lebih presisi dan kompatibel, tetapi biasanya lebih berat dan lambat.",
    "AMP is faster and saves GPU VRAM. FP32 is more precise and compatible, but usually heavier and slower.",
  ],
  [
    "Menentukan mesin eksekusi dan CPU/GPU. Worker harus online dan server harus dapat diakses oleh laptop atau Google Colab.",
    "Selects the execution machine and CPU/GPU. The worker must be online and the server reachable from the laptop or Google Colab.",
  ],
  ["Resume berbeda dengan fine-tune.", "Resume is different from fine-tuning."],
]);

const patternTranslations: Array<[RegExp, string]> = [
  [/^Lanjut sebagai (.+)$/i, "Continue as $1"],
  [
    /^Tutorial dimulai dengan (\d+) tipe project yang tersedia$/i,
    "Tutorial started with $1 available project types",
  ],
  [
    /^(\d+) file disimpan ke dataset lokal$/i,
    "$1 files saved to the local dataset",
  ],
  [/^Class (.+) diubah menjadi (.+)$/i, "Class $1 renamed to $2"],
  [/^Class (.+) ditambahkan$/i, "Class $1 added"],
  [/^(\d+) frame berhasil diinterpolasi$/i, "$1 frames interpolated"],
  [/^(\d+) dipilih$/i, "$1 selected"],
  [
    /^Dataset version dibuat: sekitar (\d+) gambar$/i,
    "Dataset version created: approximately $1 images",
  ],
  [/^Recipe v(\d+) dimuat ke editor$/i, "Recipe v$1 loaded into the editor"],
  [
    /^(\d+) asset dimasukkan ke annotation job$/i,
    "$1 assets added to the annotation job",
  ],
  [/^Version v(\d+) dihapus$/i, "Version v$1 deleted"],
  [
    /^(\d+) eksperimen dimasukkan ke training queue$/i,
    "$1 experiments added to the training queue",
  ],
  [/^(\d+) grafik dan gambar tersedia$/i, "$1 charts and images available"],
  [/^Hasil menggunakan threshold (\d+)%$/i, "Results use a $1% threshold"],
  [/^Akun (.+)$/i, "$1 account"],
];

const phraseTranslations: Array<[RegExp, string]> = [
  [/\bGagal memuat\b/gi, "Failed to load"],
  [/\bGagal membuat\b/gi, "Failed to create"],
  [/\bGagal menyimpan\b/gi, "Failed to save"],
  [/\bGagal menghapus\b/gi, "Failed to delete"],
  [/\bGagal memperbarui\b/gi, "Failed to update"],
  [/\bPilih satu\b/gi, "Select one"],
  [/\bPilih semua\b/gi, "Select all"],
  [/\bPilih\b/gi, "Select"],
  [/\bBelum ada\b/gi, "No"],
  [/\btidak tersedia\b/gi, "is unavailable"],
  [/\bsedang berjalan\b/gi, "in progress"],
  [/\bberhasil dihapus\b/gi, "deleted"],
  [/\bberhasil diperbarui\b/gi, "updated"],
  [/\bdisimpan ke\b/gi, "saved to"],
  [/\bgambar\b/gi, "images"],
  [/\banotasi\b/gi, "annotations"],
  [/\bperangkat\b/gi, "device"],
];

function englishEnabled() {
  return localStorage.getItem(LANGUAGE_KEY) === "en";
}

function translateValue(value: string) {
  if (!englishEnabled()) return value;
  const leading = value.match(/^\s*/)?.[0] || "";
  const trailing = value.match(/\s*$/)?.[0] || "";
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return value;
  let translated = exactTranslations.get(compact);
  if (!translated) {
    for (const [pattern, replacement] of patternTranslations) {
      if (pattern.test(compact)) {
        translated = compact.replace(pattern, replacement);
        break;
      }
    }
  }
  if (!translated) {
    let candidate = compact;
    for (const [pattern, replacement] of phraseTranslations)
      candidate = candidate.replace(pattern, replacement);
    if (candidate !== compact) translated = candidate;
  }
  return translated ? `${leading}${translated}${trailing}` : value;
}

function skipElement(element: Element | null) {
  return Boolean(
    element?.closest(
      "script, style, code, pre, textarea, [contenteditable='true'], [data-no-translate]",
    ),
  );
}

function translateNode(node: Node) {
  if (!englishEnabled()) return;
  if (node.nodeType === Node.TEXT_NODE) {
    if (skipElement(node.parentElement)) return;
    const current = node.nodeValue || "";
    const translated = translateValue(current);
    if (translated !== current) node.nodeValue = translated;
    return;
  }
  if (!(node instanceof Element) || skipElement(node)) return;
  for (const attribute of ["aria-label", "title", "placeholder"]) {
    const current = node.getAttribute(attribute);
    if (!current) continue;
    const translated = translateValue(current);
    if (translated !== current) node.setAttribute(attribute, translated);
  }
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let current: Node | null;
  while ((current = walker.nextNode())) translateNode(current);
  node
    .querySelectorAll<HTMLElement>("[aria-label], [title], [placeholder]")
    .forEach((element) => {
      if (!skipElement(element)) translateNodeAttributes(element);
    });
}

function translateNodeAttributes(element: Element) {
  for (const attribute of ["aria-label", "title", "placeholder"]) {
    const current = element.getAttribute(attribute);
    if (!current) continue;
    const translated = translateValue(current);
    if (translated !== current) element.setAttribute(attribute, translated);
  }
}

const root = document.getElementById("root");
if (root) {
  const observer = new MutationObserver((mutations) => {
    if (!englishEnabled()) return;
    for (const mutation of mutations) {
      if (mutation.type === "characterData") translateNode(mutation.target);
      if (mutation.type === "attributes" && mutation.target instanceof Element)
        translateNodeAttributes(mutation.target);
      mutation.addedNodes.forEach(translateNode);
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-label", "title", "placeholder"],
  });
}

const nativeConfirm = window.confirm.bind(window);
window.confirm = (message?: string) =>
  nativeConfirm(translateValue(message || ""));
const nativePrompt = window.prompt.bind(window);
window.prompt = (message?: string, defaultValue?: string) =>
  nativePrompt(translateValue(message || ""), defaultValue);
