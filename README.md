# VisionFlow Local

Local computer-vision dataset, annotation, training, and inference workspace modeled after the Roboflow application workflow.

## Start

From PowerShell:

```powershell
cd F:\scrap-web
.\start.ps1
```

- Web app: http://127.0.0.1:5173
- API: http://127.0.0.1:8000
- Production build (after `npm run build`): http://127.0.0.1:8000
- Interactive API docs: http://127.0.0.1:8000/docs

## Data

All persistent data stays in `F:\scrap-web\local_data`:

- `visionflow.db`: SQLite metadata
- `uploads`: original images
- `versions`: immutable YOLO dataset snapshots
- `runs`: training results and `best.pt` weights

Training uses the real Ultralytics YOLO runtime—not simulated progress. A run creates an Ultralytics directory under `local_data/runs/<model-id>` and a successful run exposes its actual `weights/best.pt` in Model Registry and Train. The first run downloads the selected pretrained checkpoint if it is not cached. The UI supports CPU/CUDA auto-selection, queued runs, cancellation, checkpoint resume, hyperparameter sweeps, version selection, and direct `best.pt` download. A compatible external `.pt` can also be imported and validated by Ultralytics.

Dataset generation performs real EXIF auto-orientation, square resizing, configurable train/valid/test splits, and writes immutable YOLO snapshots. The Augmentation Studio supports up to eight generated copies per training image and 16 independently configurable transforms: horizontal/vertical flip, rotation, translation, shear, random crop, brightness, contrast, saturation, hue, grayscale, Gaussian blur, sharpening, sensor noise, cutout, and JPEG compression. Geometry transforms synchronize, clip, and validate every bounding box. Recipes and generated image counts are stored with each version.

Training can target any selected immutable dataset version, offers YOLO11 Nano/Small/Medium profiles, configurable epochs and image size, live progress, cancellation, and persisted metrics. Dataset versions can be removed from the Training page when they are not used by an active job; generated files and cached exports are cleaned up together.

The local Model Library exposes detection and segmentation checkpoints from YOLO26, YOLO12, YOLO11, YOLOv10, YOLOv9, YOLOv8, YOLOv5u, and YOLOv3u in their supported size variants. Training filters the catalog to the current project task. Project Templates can create preconfigured detection or instance-segmentation projects with useful class sets and colors.

Instance Segmentation projects use a dedicated polygon annotator. Polygon points persist in SQLite, follow geometric augmentation, export as normalized YOLO segmentation labels and COCO polygons, and return as mask overlays during segmentation inference. The guided workflow exposes direct actions from saved annotations to version generation, from a generated version to training, and from a ready model to deployment.

Additional local features include project/image deletion with filesystem cleanup, downloadable annotated ZIPs in YOLO, COCO, Pascal VOC, LabelMe, and mask formats, mouse-based box movement and resizing, image/webcam/batch/video inference, and a persistent executable workflow builder. Workflow graphs reject cycles and invalid links, support conditional branches, retain run history, and can run on a recurring schedule.

Workspace productivity features include persistent hash-based routes, global search with `Ctrl+K`, an in-app workflow and shortcut guide, visible backend connectivity, editable project metadata, safe deletion of unused classes, and dataset bulk actions. From the Dataset page you can select the current filtered result set, assign train/valid/test splits, approve or reject review items, and delete multiple images with their local files in one operation.

The extended product suite also includes:

- Resumable annotation state, save feedback, zoom controls, and box copy/paste.
- Drag-and-drop uploads with progress, dataset pagination, large-result filtering, image previews, tags, and custom metadata.
- Project archive/restore and duplication, plus a persistent workspace activity feed.
- Version notes/tags, recipe reuse, preprocessing previews, and side-by-side version comparison.
- Model metric comparison, aliases, development/staging/production lifecycle stages, failed-run retry, and artifact exports.
- Single-image, webcam, and batch inference; API-key management; copyable integration snippets; and recent deployment request logs.
- Workflow JSON import/export, duplication, validation, editable nodes, explicit edge management, and run history.
- Dataset health checks for duplicates, blur, low resolution, missing labels, class imbalance, and invalid annotation sizes.
- Annotation assignments with live completion/review progress, comments, immutable revision history, and an active-learning uncertainty queue.
- Dataset version snapshots with diff and rollback.
- Password login with PBKDF2 hashing, expiring server-side sessions, HttpOnly cookies, owner/admin/annotator/viewer permissions, and logout.

Set `VISIONFLOW_REQUIRE_AUTH=1` for server-enforced login. On the first visit, VisionFlow asks you to configure the owner account. For local development with authentication disabled, the legacy role header remains available for compatibility. Internet-facing deployments should additionally use HTTPS and a reverse proxy.

MP4, MOV, and WEBM uploads are sampled locally with OpenCV at approximately one frame per second, up to 100 frames per video.

## UGREEN NAS deployment

The included Compose file runs the web UI, API, SQLite database, inference service, and persistent files together on the NAS:

```powershell
docker compose -f compose.ugreen.yml up -d --build
```

Open `http://NAS-IP:8080`, create the first owner account, and keep the generated `visionflow-data` directory backed up. The container enables authentication and a per-client API rate limit by default. To expose it through a domain, place it behind UGREEN's reverse proxy (or another reverse proxy), enable HTTPS, and avoid forwarding the raw port directly unless the network is otherwise protected.

The DXP2800 can host the application and CPU inference through Docker. CPU training works but will be substantially slower than a CUDA-capable laptop or workstation, especially beyond nano/small checkpoints. Persistent datasets and `best.pt` artifacts remain on the mounted NAS volume.

### Train on a laptop while the NAS hosts VisionFlow

VisionFlow can keep the website, SQLite metadata, dataset versions, and model artifacts on the NAS while a Windows/Linux laptop performs the actual Ultralytics training. The transfer uses the VisionFlow HTTP API, so the laptop does not need the NAS data folder mounted through SMB.

1. Open a project, generate a dataset version, and go to **Train**.
2. Under **Laptop workers**, choose **Add laptop**. Copy the one-time PowerShell command immediately; only its hash is saved on the NAS.
3. On the laptop, clone/copy this repository and install the worker dependencies:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r worker\requirements.txt
   ```

4. Run the copied command. The worker reports whether CUDA is available, securely claims a compatible queued job, downloads its immutable annotated dataset ZIP, runs real YOLO training, and uploads the validated `best.pt` to the NAS.
5. In **Training location**, choose **Laptop · Automatic**, **Laptop · CUDA GPU**, or **Laptop · CPU**, then start training. Automatic prefers CUDA and falls back to CPU.

The laptop and NAS must be able to reach each other over the selected VisionFlow address (normally `http://NAS-IP:8080` on the same LAN). Keep the terminal running while training. NVIDIA training requires a CUDA-capable PyTorch installation; verify it with `python -c "import torch; print(torch.cuda.is_available())"`. If the worker is compromised or retired, cancel its active job and revoke its token in the Train page. Use HTTPS when the worker connects across the internet.

When training succeeds, the laptop uploads the real Ultralytics checkpoint. It appears in the Model Registry and can be downloaded using **Download best.pt**. Annotated dataset versions remain separately downloadable as YOLO, COCO, Pascal VOC, LabelMe, or mask ZIP files.

Annotation shortcuts:

- `Ctrl+Z` / `Ctrl+Y`: undo / redo
- `Ctrl+C` / `Ctrl+V`: copy / paste the selected box
- Arrow keys: move the selected box precisely
- `Delete`: remove the selected box
- Left / right arrows with no selection: previous / next image

Classes can be added directly in Annotate with the `+` button. Each class has its own color picker and a visible `Rename` button. The inline editor changes the name and color, and renaming is propagated to every existing annotation in the project.

## Verification

```powershell
.\.venv313\Scripts\python.exe backend\smoke_test.py
npm run build
npm run test:e2e
```
