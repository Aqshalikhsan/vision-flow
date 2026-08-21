# Roboflow Local

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

Training currently uses Ultralytics YOLO on CPU. The first training run downloads the selected pretrained checkpoint if it is not already cached.

Dataset generation performs real EXIF auto-orientation, square resizing, configurable train/valid/test splits, and writes immutable YOLO snapshots. The Augmentation Studio supports up to eight generated copies per training image and 16 independently configurable transforms: horizontal/vertical flip, rotation, translation, shear, random crop, brightness, contrast, saturation, hue, grayscale, Gaussian blur, sharpening, sensor noise, cutout, and JPEG compression. Geometry transforms synchronize, clip, and validate every bounding box. Recipes and generated image counts are stored with each version.

Training can target any selected immutable dataset version, offers YOLO11 Nano/Small/Medium profiles, configurable epochs and image size, live progress, cancellation, and persisted metrics. Dataset versions can be removed from the Training page when they are not used by an active job; generated files and cached exports are cleaned up together.

The local Model Library exposes detection and segmentation checkpoints from YOLO26, YOLO12, YOLO11, YOLOv10, YOLOv9, YOLOv8, YOLOv5u, and YOLOv3u in their supported size variants. Training filters the catalog to the current project task. Project Templates can create preconfigured detection or instance-segmentation projects with useful class sets and colors.

Instance Segmentation projects use a dedicated polygon annotator. Polygon points persist in SQLite, follow geometric augmentation, export as normalized YOLO segmentation labels and COCO polygons, and return as mask overlays during segmentation inference. The guided workflow exposes direct actions from saved annotations to version generation, from a generated version to training, and from a ready model to deployment.

Additional local features include project/image deletion with filesystem cleanup, downloadable YOLO and COCO ZIP exports, mouse-based box movement and resizing, live webcam inference, and a persistent executable workflow builder. Workflow runs can select a trained project model and return predictions plus per-class counts.

MP4, MOV, and WEBM uploads are sampled locally with OpenCV at approximately one frame per second, up to 100 frames per video.

Annotation shortcuts:

- `Ctrl+Z` / `Ctrl+Y`: undo / redo
- Arrow keys: move the selected box precisely
- `Delete`: remove the selected box
- Left / right arrows with no selection: previous / next image

Classes can be added directly in Annotate with the `+` button. Each class has its own color picker and a visible `Rename` button. The inline editor changes the name and color, and renaming is propagated to every existing annotation in the project.

## Verification

```powershell
.\.venv313\Scripts\python.exe backend\smoke_test.py
npm run build
```
