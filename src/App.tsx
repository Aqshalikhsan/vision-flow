import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  Archive,
  ArrowLeft,
  BarChart3,
  BookOpen,
  Boxes,
  BrainCircuit,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CloudUpload,
  Code2,
  Copy,
  Database,
  Download,
  FlaskConical,
  FolderKanban,
  GalleryHorizontalEnd,
  History,
  Home,
  Image as ImageIcon,
  Keyboard,
  Layers3,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Network,
  Pencil,
  PenTool,
  Play,
  Plus,
  Redo2,
  Rocket,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  Tag,
  Trash2,
  Undo2,
  Upload,
  UserRound,
  WandSparkles,
  Wifi,
  WifiOff,
  Workflow,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { starterProjects, uid } from "./data";
import type { Asset, AugmentationRecipe, Box, Model, Project } from "./types";
import { api } from "./api";
import type {
  ActivityEntry,
  ActiveLearningItem,
  AnnotationJob,
  AuthStatus,
  DatasetHealth,
  TrainingWorker,
  WorkflowNode,
  WorkflowRun,
  WorkspaceMember,
} from "./api";

type Page =
  | "dashboard"
  | "project"
  | "dataset"
  | "annotate"
  | "insights"
  | "versions"
  | "train"
  | "registry"
  | "deploy"
  | "workflows"
  | "models"
  | "templates"
  | "settings";
const PROJECT_PAGES: Page[] = [
  "project",
  "dataset",
  "annotate",
  "insights",
  "versions",
  "train",
  "registry",
  "deploy",
];
const parseRoute = (): { page: Page; projectId?: string } => {
  const parts = window.location.hash
    .replace(/^#\/?/, "")
    .split("/")
    .filter(Boolean);
  if (parts[0] === "projects" && parts[1])
    return {
      projectId: decodeURIComponent(parts[1]),
      page: (PROJECT_PAGES.includes(parts[2] as Page)
        ? parts[2]
        : "project") as Page,
    };
  const page = parts[0] as Page;
  return {
    page: [
      "dashboard",
      "workflows",
      "models",
      "templates",
      "settings",
    ].includes(page)
      ? page
      : "dashboard",
  };
};
const CLASS_PALETTE = [
  "#ffcf4a",
  "#7a62ed",
  "#24c7bd",
  "#f06b9d",
  "#f0943f",
  "#4b9cff",
  "#54c17a",
  "#e85d4a",
];
const classColor = (project: Project, name: string, index = 0) =>
  project.colors?.[name] || CLASS_PALETTE[index % CLASS_PALETTE.length];
const AUGMENTATION_OPTIONS = [
  {
    key: "horizontalFlip",
    group: "Geometry",
    name: "Horizontal flip",
    description: "Mirror left/right with synchronized boxes",
    probability: 0.5,
    amount: 0,
    min: 0,
    max: 0,
    unit: "",
  },
  {
    key: "verticalFlip",
    group: "Geometry",
    name: "Vertical flip",
    description: "Mirror top/bottom with synchronized boxes",
    probability: 0.15,
    amount: 0,
    min: 0,
    max: 0,
    unit: "",
  },
  {
    key: "rotate",
    group: "Geometry",
    name: "Rotation",
    description: "Random clockwise or counter-clockwise rotation",
    probability: 0.45,
    amount: 15,
    min: 1,
    max: 45,
    unit: "°",
  },
  {
    key: "translate",
    group: "Geometry",
    name: "Translation",
    description: "Shift image horizontally and vertically",
    probability: 0.3,
    amount: 10,
    min: 1,
    max: 30,
    unit: "%",
  },
  {
    key: "shear",
    group: "Geometry",
    name: "Shear",
    description: "Perspective-like X/Y affine skew",
    probability: 0.2,
    amount: 8,
    min: 1,
    max: 25,
    unit: "°",
  },
  {
    key: "crop",
    group: "Geometry",
    name: "Random crop",
    description: "Crop edges, clip boxes, then resize",
    probability: 0.25,
    amount: 12,
    min: 2,
    max: 35,
    unit: "%",
  },
  {
    key: "brightness",
    group: "Color & lighting",
    name: "Brightness",
    description: "Simulate darker and brighter environments",
    probability: 0.55,
    amount: 22,
    min: 1,
    max: 60,
    unit: "%",
  },
  {
    key: "contrast",
    group: "Color & lighting",
    name: "Contrast",
    description: "Vary separation between shadows and highlights",
    probability: 0.4,
    amount: 20,
    min: 1,
    max: 60,
    unit: "%",
  },
  {
    key: "saturation",
    group: "Color & lighting",
    name: "Saturation",
    description: "Vary color intensity",
    probability: 0.35,
    amount: 25,
    min: 1,
    max: 80,
    unit: "%",
  },
  {
    key: "hue",
    group: "Color & lighting",
    name: "Hue shift",
    description: "Shift colors while preserving luminance",
    probability: 0.2,
    amount: 12,
    min: 1,
    max: 45,
    unit: "°",
  },
  {
    key: "grayscale",
    group: "Color & lighting",
    name: "Grayscale",
    description: "Train robustness without color information",
    probability: 0.08,
    amount: 0,
    min: 0,
    max: 0,
    unit: "",
  },
  {
    key: "blur",
    group: "Quality & occlusion",
    name: "Gaussian blur",
    description: "Simulate motion, focus, and soft lenses",
    probability: 0.2,
    amount: 1.5,
    min: 0.2,
    max: 4,
    step: 0.1,
    unit: "px",
  },
  {
    key: "sharpen",
    group: "Quality & occlusion",
    name: "Sharpen",
    description: "Increase edge definition",
    probability: 0.15,
    amount: 1.4,
    min: 0.2,
    max: 3,
    step: 0.1,
    unit: "×",
  },
  {
    key: "noise",
    group: "Quality & occlusion",
    name: "Sensor noise",
    description: "Add realistic Gaussian pixel noise",
    probability: 0.2,
    amount: 12,
    min: 1,
    max: 40,
    unit: "σ",
  },
  {
    key: "cutout",
    group: "Quality & occlusion",
    name: "Cutout",
    description: "Hide a random square to simulate occlusion",
    probability: 0.2,
    amount: 18,
    min: 3,
    max: 45,
    unit: "%",
  },
  {
    key: "jpeg",
    group: "Quality & occlusion",
    name: "JPEG compression",
    description: "Simulate low-bandwidth compression artifacts",
    probability: 0.2,
    amount: 55,
    min: 15,
    max: 95,
    unit: " quality",
  },
] as const;
const defaultAugmentations = (): AugmentationRecipe =>
  Object.fromEntries(
    AUGMENTATION_OPTIONS.map((option, index) => [
      option.key,
      {
        enabled: [0, 2, 6, 7, 13].includes(index),
        probability: option.probability,
        amount: option.amount,
      },
    ]),
  );
const YOLO_MODELS = [
  ...["n", "s", "m", "l", "x"].flatMap((size, index) => [
    {
      id: `yolo26${size}.pt`,
      family: "YOLO26",
      size: size.toUpperCase(),
      task: "detect",
      note: [
        "Newest edge model",
        "Newest small model",
        "Newest balanced model",
        "Newest large model",
        "Maximum YOLO26 accuracy",
      ][index],
    },
    {
      id: `yolo26${size}-seg.pt`,
      family: "YOLO26",
      size: size.toUpperCase(),
      task: "segment",
      note: "Latest native segmentation checkpoint",
    },
  ]),
  ...["n", "s", "m", "l", "x"].flatMap((size) => [
    {
      id: `yolo12${size}.pt`,
      family: "YOLO12",
      size: size.toUpperCase(),
      task: "detect",
      note: "Attention-centric detector",
    },
    {
      id: `yolo12${size}-seg.pt`,
      family: "YOLO12",
      size: size.toUpperCase(),
      task: "segment",
      note: "Attention-centric segmentation",
    },
  ]),
  ...["n", "s", "m", "l", "x"].flatMap((size, index) => [
    {
      id: `yolo11${size}.pt`,
      family: "YOLO11",
      size: size.toUpperCase(),
      task: "detect",
      note: [
        "Fastest CPU / edge",
        "Balanced realtime",
        "High accuracy",
        "Large production",
        "Maximum accuracy",
      ][index],
    },
    {
      id: `yolo11${size}-seg.pt`,
      family: "YOLO11",
      size: size.toUpperCase(),
      task: "segment",
      note: [
        "Fast segmentation",
        "Balanced segmentation",
        "Accurate masks",
        "Large mask model",
        "Maximum mask quality",
      ][index],
    },
  ]),
  ...["n", "s", "m", "l", "x"].flatMap((size) =>
    (["pose", "obb", "cls"] as const).map((task) => ({
      id: `yolo11${size}-${task}.pt`,
      family: "YOLO11",
      size: size.toUpperCase(),
      task,
      note:
        task === "pose"
          ? "Native keypoint and pose model"
          : task === "obb"
            ? "Rotated object detection model"
            : "Image classification model",
    })),
  ),
  ...["n", "s", "m", "l", "x"].flatMap((size, index) => [
    {
      id: `yolov8${size}.pt`,
      family: "YOLOv8",
      size: size.toUpperCase(),
      task: "detect",
      note: [
        "Legacy edge",
        "Legacy small",
        "Legacy medium",
        "Legacy large",
        "Legacy xlarge",
      ][index],
    },
    {
      id: `yolov8${size}-seg.pt`,
      family: "YOLOv8",
      size: size.toUpperCase(),
      task: "segment",
      note: "Proven segmentation checkpoint",
    },
  ]),
  ...["n", "s", "m", "b", "l", "x"].map((size) => ({
    id: `yolov10${size}.pt`,
    family: "YOLOv10",
    size: size.toUpperCase(),
    task: "detect",
    note: "End-to-end NMS-free detector",
  })),
  ...["t", "s", "m", "c", "e"].map((size) => ({
    id: `yolov9${size}.pt`,
    family: "YOLOv9",
    size: size.toUpperCase(),
    task: "detect",
    note: "Programmable-gradient detector",
  })),
  ...["c", "e"].map((size) => ({
    id: `yolov9${size}-seg.pt`,
    family: "YOLOv9",
    size: size.toUpperCase(),
    task: "segment",
    note: "YOLOv9 mask checkpoint",
  })),
  ...["n", "s", "m", "l", "x"].map((size) => ({
    id: `yolov5${size}u.pt`,
    family: "YOLOv5u",
    size: size.toUpperCase(),
    task: "detect",
    note: "Updated YOLOv5 detection head",
  })),
  {
    id: "yolov3u.pt",
    family: "YOLOv3u",
    size: "Base",
    task: "detect",
    note: "Updated classic YOLOv3 checkpoint",
  },
  {
    id: "yolov3-tinyu.pt",
    family: "YOLOv3u",
    size: "Tiny",
    task: "detect",
    note: "Lightweight classic YOLO checkpoint",
  },
] as Array<{
  id: string;
  family: string;
  size: string;
  task: "detect" | "segment" | "pose" | "obb" | "cls";
  note: string;
}>;
const PROJECT_TEMPLATES = [
  {
    name: "Warehouse Safety",
    type: "Object Detection",
    description: "Detect people, helmets, vests, and forklifts.",
    classes: ["person", "helmet", "safety-vest", "forklift"],
  },
  {
    name: "Surface Defect Segmentation",
    type: "Instance Segmentation",
    description: "Outline scratches, dents, cracks, and corrosion precisely.",
    classes: ["scratch", "dent", "crack", "corrosion"],
  },
  {
    name: "Retail Shelf Audit",
    type: "Object Detection",
    description: "Count products, empty slots, and misplaced items.",
    classes: ["product", "empty-slot", "misplaced"],
  },
  {
    name: "Road Damage Segmentation",
    type: "Instance Segmentation",
    description: "Create masks for potholes and pavement damage.",
    classes: ["pothole", "crack", "patch"],
  },
  {
    name: "Wildlife Monitoring",
    type: "Object Detection",
    description: "Detect animals from local camera-trap images.",
    classes: ["animal", "person", "vehicle"],
  },
  {
    name: "Medical Region Segmentation",
    type: "Instance Segmentation",
    description: "Research template for outlining regions of interest.",
    classes: ["region-of-interest"],
  },
];

function AuthGate({
  setup,
  onAuthenticated,
}: {
  setup: boolean;
  onAuthenticated: () => Promise<void>;
}) {
  const [name, setName] = useState("Local Owner");
  const [email, setEmail] = useState("owner@visionflow.local");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (setup) await api.bootstrapAuth({ name, email, password });
      await api.login(email, password);
      await onAuthenticated();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Login gagal");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <span className="brand-mark">
          <Boxes />
        </span>
        <span className="eyebrow">VISIONFLOW SECURE WORKSPACE</span>
        <h1>{setup ? "Configure workspace owner" : "Welcome back"}</h1>
        <p>
          {setup
            ? "Create the first protected owner account."
            : "Sign in to datasets, models, and deployments."}
        </p>
        {setup && (
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error && <p className="auth-error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "Please wait…" : setup ? "Secure workspace" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

function App() {
  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("vf-projects") || "null") ||
        starterProjects
      );
    } catch {
      return starterProjects;
    }
  });
  const initialRoute = useMemo(parseRoute, []);
  const [page, setPage] = useState<Page>(initialRoute.page);
  const [selectedId, setSelectedId] = useState(
    initialRoute.projectId || "warehouse-safety",
  );
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [profile, setProfile] = useState(false);
  const [backend, setBackend] = useState<"checking" | "online" | "offline">(
    "checking",
  );
  const [toast, setToast] = useState("");
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  useEffect(() => {
    try {
      const snapshot = JSON.stringify(projects);
      if (snapshot.length <= 2_000_000)
        localStorage.setItem("vf-projects", snapshot);
      else localStorage.removeItem("vf-projects");
    } catch {
      // Large annotated workspaces can exceed the browser storage quota.
      // SQLite remains authoritative, so a failed convenience cache is safe
      // to discard and must never take down the application shell.
      localStorage.removeItem("vf-projects");
    }
  }, [projects]);
  useEffect(() => {
    api
      .authStatus()
      .then(setAuth)
      .catch(() => setAuth({ required: false, setupRequired: false }));
  }, []);
  useEffect(() => {
    if (!auth || (auth.required && !auth.member)) return;
    api
      .projects()
      .then((remote) => {
        setProjects(remote);
        setBackend("online");
        setSelectedId((current) =>
          remote.some((project) => project.id === current)
            ? current
            : remote[0]?.id || "",
        );
      })
      .catch(() => setBackend("offline"));
  }, [auth?.required, auth?.member?.id]);
  useEffect(() => {
    const sync = () => {
      const route = parseRoute();
      setPage(route.page);
      if (route.projectId) setSelectedId(route.projectId);
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((value) => !value);
      }
      if (
        event.key === "?" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (event.target as HTMLElement).tagName,
        )
      )
        setHelp(true);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const project =
    projects.find((p) => p.id === selectedId) ||
    (backend === "checking" ? undefined : projects[0]);
  const update = (fn: (p: Project) => Project) =>
    setProjects((ps) => ps.map((p) => (p.id === selectedId ? fn(p) : p)));
  const go = (p: Page, id?: string) => {
    const projectId = id || selectedId;
    if (id) setSelectedId(id);
    setPage(p);
    window.location.hash =
      PROJECT_PAGES.includes(p) && projectId
        ? `/projects/${encodeURIComponent(projectId)}/${p}`
        : `/${p}`;
    window.scrollTo(0, 0);
  };
  const notify = (s: string) => {
    setToast(s);
    setTimeout(() => setToast(""), 2600);
  };
  if (!auth) return <div className="auth-loading">Loading VisionFlow…</div>;
  if (auth.required && !auth.member)
    return (
      <AuthGate
        setup={auth.setupRequired}
        onAuthenticated={() => api.authStatus().then(setAuth)}
      />
    );
  return (
    <div className="app">
      <Sidebar page={page} go={go} onHelp={() => setHelp(true)} />
      <main>
        <Topbar
          project={PROJECT_PAGES.includes(page) ? project : undefined}
          backend={backend}
          onBack={() => go(page === "project" ? "dashboard" : "project")}
          onSearch={() => setPalette(true)}
          onHelp={() => setHelp(true)}
          onProfile={() => setProfile((value) => !value)}
        />
        {page === "dashboard" && (
          <Dashboard
            projects={projects}
            go={go}
            create={() => setModal(true)}
            duplicate={async (id) => {
              try {
                const saved = await api.duplicateProject(id);
                setProjects((current) => [saved, ...current]);
                notify("Project duplicated with its dataset");
              } catch (error) {
                notify(
                  error instanceof Error
                    ? error.message
                    : "Project duplication failed",
                );
              }
            }}
            archive={async (id, archived) => {
              try {
                const saved = await api.archiveProject(id, archived);
                setProjects((current) =>
                  current.map((item) => (item.id === id ? saved : item)),
                );
                notify(archived ? "Project archived" : "Project restored");
              } catch (error) {
                notify(
                  error instanceof Error
                    ? error.message
                    : "Project archive failed",
                );
              }
            }}
          />
        )}
        {page === "project" && project && (
          <ProjectHome
            project={project}
            go={go}
            update={update}
            notify={notify}
            edit={() => setEditing(true)}
            remove={async () => {
              if (
                confirm(
                  `Hapus project "${project.name}" beserta seluruh data dan model?`,
                )
              ) {
                try {
                  await api.deleteProject(project.id);
                  const remaining = projects.filter((p) => p.id !== project.id);
                  setProjects(remaining);
                  setSelectedId(remaining[0]?.id || "");
                  go("dashboard");
                  notify("Project dan seluruh file berhasil dihapus");
                } catch (e) {
                  notify(
                    e instanceof Error ? e.message : "Gagal menghapus project",
                  );
                }
              }
            }}
          />
        )}
        {page === "dataset" && project && (
          <DatasetManager
            project={project}
            go={go}
            update={update}
            notify={notify}
          />
        )}
        {page === "insights" && project && (
          <ProjectInsights project={project} go={go} notify={notify} />
        )}
        {page === "annotate" &&
          project &&
          (project.type.includes("Classification") ? (
            <ClassificationAnnotate
              project={project}
              go={go}
              update={update}
              notify={notify}
            />
          ) : [
              "Instance Segmentation",
              "Semantic Segmentation",
              "Oriented Bounding Box",
              "Keypoint Detection",
            ].includes(project.type) ? (
            <SegmentationAnnotate
              project={project}
              go={go}
              update={update}
              notify={notify}
            />
          ) : (
            <Annotate
              project={project}
              go={go}
              update={update}
              notify={notify}
            />
          ))}
        {page === "versions" && project && (
          <DatasetVersions
            project={project}
            go={go}
            update={update}
            notify={notify}
          />
        )}
        {page === "train" && project && (
          <DatasetTrain
            project={project}
            go={go}
            update={update}
            notify={notify}
          />
        )}
        {page === "registry" && project && (
          <ModelRegistry
            project={project}
            go={go}
            update={update}
            notify={notify}
          />
        )}
        {page === "deploy" && project && <Deploy project={project} go={go} />}
        {page === "workflows" && (
          <Workflows projects={projects} notify={notify} />
        )}
        {page === "models" && <ModelLibrary go={go} />}
        {page === "templates" && (
          <ProjectTemplates
            onUse={async (template) => {
              try {
                const colors = Object.fromEntries(
                  template.classes.map((name, index) => [
                    name,
                    CLASS_PALETTE[index % CLASS_PALETTE.length],
                  ]),
                );
                const saved = await api.createProject({
                  name: template.name,
                  type: template.type,
                  description: template.description,
                  classes: template.classes,
                  colors,
                });
                setProjects((current) => [saved, ...current]);
                setSelectedId(saved.id);
                go("project", saved.id);
                notify("Project dibuat dari template");
              } catch (e) {
                notify(
                  e instanceof Error ? e.message : "Gagal menggunakan template",
                );
              }
            }}
          />
        )}
        {page === "settings" && (
          <LocalSettings
            notify={notify}
            onRestored={async () => {
              const fresh = await api.projects();
              setProjects(fresh);
              setSelectedId(fresh[0]?.id || "");
              go("dashboard");
            }}
          />
        )}
        {project && <WorkflowNext page={page} project={project} go={go} />}
      </main>
      {modal && (
        <CreateProject
          onClose={() => setModal(false)}
          onCreate={async (p) => {
            try {
              const saved = await api.createProject({
                name: p.name,
                type: p.type,
                description: p.description,
                classes: p.classes,
                colors: p.colors,
              });
              setProjects((x) => [saved, ...x]);
              setSelectedId(saved.id);
              setModal(false);
              go("project", saved.id);
              notify("Project berhasil dibuat di database lokal");
            } catch (e) {
              notify(e instanceof Error ? e.message : "Gagal membuat project");
            }
          }}
        />
      )}
      {editing && project && (
        <EditProject
          project={project}
          onClose={() => setEditing(false)}
          onSave={async (data) => {
            try {
              const saved = await api.updateProject(project.id, data);
              update(() => saved);
              setEditing(false);
              notify("Project details updated");
            } catch (e) {
              notify(
                e instanceof Error ? e.message : "Gagal memperbarui project",
              );
            }
          }}
        />
      )}
      {palette && (
        <CommandPalette
          projects={projects}
          go={go}
          close={() => setPalette(false)}
        />
      )}
      {help && <HelpCenter close={() => setHelp(false)} />}
      {profile && (
        <ProfileMenu
          backend={backend}
          projects={projects.length}
          member={auth.member}
          settings={() => {
            setProfile(false);
            go("settings");
          }}
          logout={
            auth.required
              ? async () => {
                  await api.logout();
                  setProfile(false);
                  setProjects([]);
                  setAuth(await api.authStatus());
                }
              : undefined
          }
          close={() => setProfile(false)}
        />
      )}
      {toast && (
        <div className="toast">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

function Sidebar({
  page,
  go,
  onHelp,
}: {
  page: Page;
  go: (p: Page) => void;
  onHelp: () => void;
}) {
  const nav = [
    ["dashboard", LayoutDashboard, "Projects"],
    ["workflows", Workflow, "Workflows"],
    ["deploy", Rocket, "Deployments"],
  ] as const;
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brandmark">
          <Boxes />
        </span>
        <span>
          roboflow <small>LOCAL</small>
        </span>
      </div>
      <div className="workspace">
        <span className="avatar">AK</span>
        <div>
          <b>Arunika Labs</b>
          <small>Personal workspace</small>
        </div>
        <ChevronDown size={15} />
      </div>
      <nav>
        <p>WORKSPACE</p>
        {nav.map(([id, I, l]) => (
          <button
            key={id}
            className={page === id ? "active" : ""}
            onClick={() => go(id as Page)}
          >
            <I size={18} />
            {l}
          </button>
        ))}
        <p>DISCOVER</p>
        <button
          className={page === "models" ? "active" : ""}
          onClick={() => go("models")}
        >
          <GalleryHorizontalEnd size={18} />
          Model Library
        </button>
        <button
          className={page === "templates" ? "active" : ""}
          onClick={() => go("templates")}
        >
          <Sparkles size={18} />
          Templates
        </button>
      </nav>
      <div className="sidebar-bottom">
        <div className="usage">
          <div>
            <span>Local storage</span>
            <b>Private</b>
          </div>
          <div className="meter">
            <i />
          </div>
          <small>Stored in local_data on this machine</small>
        </div>
        <button onClick={onHelp}>
          <CircleHelp size={18} />
          Documentation
        </button>
        <button
          className={page === "settings" ? "active" : ""}
          onClick={() => go("settings")}
        >
          <Settings size={18} />
          Settings
        </button>
      </div>
    </aside>
  );
}

function Topbar({
  project,
  backend,
  onBack,
  onSearch,
  onHelp,
  onProfile,
}: {
  project?: Project;
  backend: "checking" | "online" | "offline";
  onBack: () => void;
  onSearch: () => void;
  onHelp: () => void;
  onProfile: () => void;
}) {
  return (
    <header className="topbar">
      <div className="crumb">
        {project ? (
          <>
            <button className="icon ghost" onClick={onBack} aria-label="Back">
              <ArrowLeft size={18} />
            </button>
            <span>Projects</span>
            <ChevronRight size={14} />
            <b>{project.name}</b>
          </>
        ) : (
          <>
            <h2>Dashboard</h2>
          </>
        )}
      </div>
      <div className="top-actions">
        <span className={"backend-state " + backend}>
          {backend === "offline" ? <WifiOff /> : <Wifi />}
          {backend}
        </span>
        <button className="global-search" onClick={onSearch}>
          <Search size={15} />
          <span>Search</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button
          className="icon ghost"
          onClick={onHelp}
          title="Help and shortcuts"
        >
          <CircleHelp size={18} />
        </button>
        <button className="user" onClick={onProfile}>
          AK
        </button>
      </div>
    </header>
  );
}

function CommandPalette({
  projects,
  go,
  close,
}: {
  projects: Project[];
  go: (page: Page, id?: string) => void;
  close: () => void;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const escape = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [close]);
  const navigation: Array<{
    label: string;
    hint: string;
    page: Page;
    icon: any;
  }> = [
    {
      label: "Projects dashboard",
      hint: "Workspace overview",
      page: "dashboard",
      icon: LayoutDashboard,
    },
    {
      label: "Workflows",
      hint: "Build inference pipelines",
      page: "workflows",
      icon: Workflow,
    },
    {
      label: "Model Library",
      hint: "Browse local checkpoints",
      page: "models",
      icon: GalleryHorizontalEnd,
    },
    {
      label: "Project Templates",
      hint: "Start from a preset",
      page: "templates",
      icon: Sparkles,
    },
    {
      label: "System & Recovery",
      hint: "Settings, members, backup",
      page: "settings",
      icon: Settings,
    },
  ];
  const term = query.trim().toLowerCase();
  const nav = navigation.filter((item) =>
    `${item.label} ${item.hint}`.toLowerCase().includes(term),
  );
  const matchingProjects = projects.filter((project) =>
    `${project.name} ${project.type} ${project.description}`
      .toLowerCase()
      .includes(term),
  );
  return (
    <div className="modal-bg command-bg" onMouseDown={close}>
      <section
        className="command-palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-input">
          <Search />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects and navigate…"
          />
          <kbd>ESC</kbd>
        </div>
        {matchingProjects.length > 0 && (
          <div className="command-group">
            <p>PROJECTS</p>
            {matchingProjects.slice(0, 6).map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  go("project", project.id);
                  close();
                }}
              >
                <span>
                  <Boxes />
                </span>
                <div>
                  <b>{project.name}</b>
                  <small>
                    {project.type} · {project.assets.length} images
                  </small>
                </div>
                <ChevronRight />
              </button>
            ))}
          </div>
        )}
        <div className="command-group">
          <p>NAVIGATION</p>
          {nav.map((item) => (
            <button
              key={item.page}
              onClick={() => {
                go(item.page);
                close();
              }}
            >
              <span>
                <item.icon />
              </span>
              <div>
                <b>{item.label}</b>
                <small>{item.hint}</small>
              </div>
              <ChevronRight />
            </button>
          ))}
        </div>
        {!matchingProjects.length && !nav.length && (
          <div className="command-empty">
            <Search />
            <b>No results</b>
            <span>Try a project name, model, workflow, or settings.</span>
          </div>
        )}
        <footer>
          <span>
            <kbd>Ctrl</kbd>
            <kbd>K</kbd> toggle search
          </span>
          <span>Local workspace search</span>
        </footer>
      </section>
    </div>
  );
}

function HelpCenter({ close }: { close: () => void }) {
  return (
    <div className="modal-bg" onMouseDown={close}>
      <section
        className="help-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span>
            <BookOpen />
          </span>
          <div>
            <h2>Roboflow Local help</h2>
            <p>Quick reference for the complete model workflow.</p>
          </div>
          <button className="icon ghost" onClick={close}>
            <X />
          </button>
        </header>
        <div className="help-grid">
          <article>
            <Upload />
            <h3>1. Add data</h3>
            <p>
              Upload images or videos, or import YOLO, COCO, VOC, LabelMe, and
              CVAT archives.
            </p>
          </article>
          <article>
            <PenTool />
            <h3>2. Annotate & review</h3>
            <p>
              Draw boxes, masks, OBBs, keypoints, or classification labels, then
              approve the dataset.
            </p>
          </article>
          <article>
            <Layers3 />
            <h3>3. Generate</h3>
            <p>
              Freeze preprocessing, split assignments, and an augmentation
              recipe into a version.
            </p>
          </article>
          <article>
            <BrainCircuit />
            <h3>4. Train & deploy</h3>
            <p>
              Train a local YOLO checkpoint, inspect metrics, export artifacts,
              and create API keys.
            </p>
          </article>
        </div>
        <div className="shortcut-list">
          <h3>
            <Keyboard /> Keyboard shortcuts
          </h3>
          <span>
            <kbd>Ctrl K</kbd> Global search
          </span>
          <span>
            <kbd>?</kbd> Open this help
          </span>
          <span>
            <kbd>Ctrl Z / Ctrl Y</kbd> Annotator undo / redo
          </span>
          <span>
            <kbd>Delete</kbd> Remove selected annotation
          </span>
          <span>
            <kbd>← / →</kbd> Previous / next image
          </span>
        </div>
        <footer>
          <a
            className="secondary"
            href="http://127.0.0.1:8000/docs"
            target="_blank"
            rel="noreferrer"
          >
            Open API documentation
          </a>
          <button className="primary" onClick={close}>
            Got it
          </button>
        </footer>
      </section>
    </div>
  );
}

function ProfileMenu({
  backend,
  projects,
  member,
  settings,
  logout,
  close,
}: {
  backend: "checking" | "online" | "offline";
  projects: number;
  member?: AuthStatus["member"];
  settings: () => void;
  logout?: () => Promise<void>;
  close: () => void;
}) {
  return (
    <div className="profile-popover">
      <button className="profile-close" onClick={close}>
        <X />
      </button>
      <div className="profile-identity">
        <span>
          {(member?.name || "Arunika Labs")
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0])
            .join("")
            .toUpperCase()}
        </span>
        <div>
          <b>{member?.name || "Arunika Labs"}</b>
          <small>
            {member
              ? `${member.role} · ${member.email}`
              : "Local workspace owner"}
          </small>
        </div>
      </div>
      <div className={"profile-backend " + backend}>
        {backend === "offline" ? <WifiOff /> : <Wifi />}
        <span>
          <b>Local API {backend}</b>
          <small>{projects} projects available</small>
        </span>
      </div>
      <button onClick={settings}>
        <Settings />
        Workspace settings
        <ChevronRight />
      </button>
      {logout && (
        <button className="profile-logout" onClick={() => void logout()}>
          <LogOut />
          Sign out
        </button>
      )}
    </div>
  );
}

function EditProject({
  project,
  onClose,
  onSave,
}: {
  project: Project;
  onClose: () => void;
  onSave: (data: { name: string; description: string }) => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="modal-icon">
              <Pencil />
            </span>
            <h2>Edit project</h2>
            <p>Update the project details shown throughout the workspace.</p>
          </div>
          <button className="icon ghost" onClick={onClose}>
            <X />
          </button>
        </div>
        <label>
          Project name
          <input
            autoFocus
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Project type
          <input value={project.type} disabled />
          <small className="field-help">
            Project type is immutable after annotations and versions exist.
          </small>
        </label>
        <label>
          Description
          <textarea
            value={description}
            maxLength={1000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!name.trim()}
            onClick={() =>
              onSave({ name: name.trim(), description: description.trim() })
            }
          >
            <Check />
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function Dashboard({
  projects,
  go,
  create,
  duplicate,
  archive,
}: {
  projects: Project[];
  go: (p: Page, id?: string) => void;
  create: () => void;
  duplicate: (id: string) => void;
  archive: (id: string, archived: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const filtered = projects.filter(
    (p) =>
      p.archived === showArchived &&
      p.name.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="content dashboard">
      <section className="welcome">
        <div>
          <span className="eyebrow">ROBOFLOW LOCAL</span>
          <h1>Build computer vision models faster.</h1>
          <p>
            Upload data, annotate, generate a version, train, and deploy—all on
            this machine.
          </p>
        </div>
        <button className="primary" onClick={create}>
          <Plus size={17} />
          Create New Project
        </button>
      </section>
      <div className="stats">
        <Stat
          icon={Database}
          val={projects.length}
          label="Projects"
          tone="purple"
        />
        <Stat
          icon={ImageIcon}
          val={projects.reduce((a, p) => a + p.assets.length, 0)}
          label="Dataset images"
          tone="blue"
        />
        <Stat
          icon={BrainCircuit}
          val={projects.reduce(
            (a, p) =>
              a + p.models.filter((model) => model.status === "ready").length,
            0,
          )}
          label="Trained models"
          tone="green"
        />
        <Stat icon={Activity} val="Local" label="Environment" tone="orange" />
      </div>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Your projects</h2>
            <p>Manage datasets and model experiments.</p>
          </div>
          <div className="dashboard-tools">
            <div className="project-view-toggle" aria-label="Project status">
              <button
                className={!showArchived ? "active" : ""}
                onClick={() => setShowArchived(false)}
              >
                Active
                <span>{projects.filter((item) => !item.archived).length}</span>
              </button>
              <button
                className={showArchived ? "active" : ""}
                onClick={() => setShowArchived(true)}
              >
                <Archive /> Archived
                <span>{projects.filter((item) => item.archived).length}</span>
              </button>
            </div>
            <div className="search">
              <Search size={16} />
              <input
                placeholder="Search projects"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="project-grid">
          {filtered.map((p, i) => (
            <article className="project-card" key={p.id}>
              <button
                className="project-card-main"
                onClick={() => go("project", p.id)}
              >
                <div className={"project-cover cover-" + (i % 4)}>
                  <Boxes />
                  <span className="project-type-pill">{p.type}</span>
                  {p.archived && (
                    <span className="project-archive-pill">
                      <Archive /> Archived
                    </span>
                  )}
                </div>
                <div className="project-info">
                  <div>
                    <h3>{p.name}</h3>
                    <span />
                  </div>
                  <p>{p.description}</p>
                  <div className="meta">
                    <span>
                      <ImageIcon size={14} />
                      {p.assets.length || (i ? 0 : 248)} images
                    </span>
                    <span>
                      <Tag size={14} />
                      {p.classes.length} classes
                    </span>
                  </div>
                  <div className="card-foot">
                    <span>
                      {p.models.length
                        ? p.models.length + " model ready"
                        : "Not trained"}
                    </span>
                    <ChevronRight size={16} />
                  </div>
                </div>
              </button>
              <button
                className="project-card-menu"
                aria-label={`Actions for ${p.name}`}
                aria-expanded={menu === p.id}
                onClick={() => setMenu(menu === p.id ? "" : p.id)}
              >
                <MoreHorizontal />
              </button>
              {menu === p.id && (
                <div className="project-card-popover">
                  <button
                    onClick={() => {
                      setMenu("");
                      duplicate(p.id);
                    }}
                  >
                    <Copy /> Duplicate
                  </button>
                  <button
                    className="archive-action"
                    onClick={() => {
                      setMenu("");
                      archive(p.id, !p.archived);
                    }}
                  >
                    <Archive /> {p.archived ? "Restore" : "Archive"}
                  </button>
                </div>
              )}
            </article>
          ))}
          <button className="new-card" onClick={create}>
            <span>
              <Plus />
            </span>
            <b>Create a new project</b>
            <small>Start with images, video, or an existing dataset</small>
          </button>
        </div>
      </section>
    </div>
  );
}

function Stat({
  icon: I,
  val,
  label,
  tone,
}: {
  icon: any;
  val: any;
  label: string;
  tone: string;
}) {
  return (
    <div className="stat">
      <span className={"stat-icon " + tone}>
        <I size={20} />
      </span>
      <div>
        <b>{val}</b>
        <small>{label}</small>
      </div>
    </div>
  );
}

function ProjectTabs({ active, go }: { active: Page; go: (p: Page) => void }) {
  return (
    <div className="tabs" data-testid="project-tabs">
      {(
        [
          ["project", "Overview"],
          ["dataset", "Dataset"],
          ["annotate", "Annotate"],
          ["insights", "Health & Jobs"],
          ["versions", "Versions"],
          ["train", "Train"],
          ["registry", "Models"],
          ["deploy", "Deploy"],
        ] as [Page, string][]
      ).map(([p, l]) => (
        <button
          className={active === p ? "active" : ""}
          onClick={() => go(p)}
          key={p}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

type TransferStage = "uploading" | "processing";

function TransferProgress({
  percent,
  stage,
  label,
  processingLabel = "Upload complete · Processing",
}: {
  percent: number;
  stage: TransferStage;
  label: string;
  processingLabel?: string;
}) {
  const safePercent = Math.max(0, Math.min(100, percent));
  return (
    <div
      className={`upload-progress ${stage}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safePercent}
    >
      <span>
        <span>{stage === "processing" ? processingLabel : label}</span>
        <b>{safePercent}%</b>
      </span>
      <i>
        <em style={{ width: `${safePercent}%` }} />
      </i>
      {stage === "processing" && (
        <small>Please keep this page open while the server validates it.</small>
      )}
    </div>
  );
}

function ProjectHome({
  project,
  go,
  update,
  notify,
  edit,
  remove,
}: {
  project: Project;
  go: (p: Page) => void;
  update: (fn: (p: Project) => Project) => void;
  notify: (s: string) => void;
  edit: () => void;
  remove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [draggingUpload, setDraggingUpload] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStage, setUploadStage] = useState<TransferStage>("uploading");
  const upload = async (files: FileList | null) => {
    if (!files) return;
    try {
      setUploadProgress(0);
      setUploadStage("uploading");
      const saved = await api.uploadWithProgress(
        project.id,
        files,
        setUploadProgress,
        () => setUploadStage("processing"),
      );
      update(() => saved);
      notify(`${files.length} file disimpan ke dataset lokal`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Upload gagal");
    } finally {
      setUploadProgress(null);
      setDraggingUpload(false);
    }
  };
  const deleteImage = async (id: string) => {
    if (!confirm("Hapus gambar ini dari dataset?")) return;
    try {
      await api.deleteAsset(project.id, id);
      const saved = await api.project(project.id);
      update(() => saved);
      notify("Gambar dihapus");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Gagal menghapus gambar");
    }
  };
  return (
    <div className="content">
      <ProjectTabs active="project" go={go} />
      <div className="project-title">
        <div>
          <span className="badge">{project.type}</span>
          <h1>{project.name}</h1>
          <p>{project.description}</p>
        </div>
        <div className="title-actions">
          <button className="secondary" onClick={edit}>
            <Pencil size={16} />
            Edit
          </button>
          <button className="danger" onClick={remove}>
            <Trash2 size={16} />
            Delete
          </button>
          <button className="primary" onClick={() => input.current?.click()}>
            <Upload size={17} />
            Upload data
          </button>
        </div>
        <input
          ref={input}
          hidden
          multiple
          type="file"
          accept="image/*,video/mp4,video/quicktime,video/webm"
          onChange={(e) => upload(e.target.files)}
        />
      </div>
      <div className="project-layout">
        <div className="main-col">
          <section className="panel progress-card">
            <div className="panel-head">
              <div>
                <h2>Project progress</h2>
                <p>Complete these steps to ship your model.</p>
              </div>
              <span className="progress-label">
                {project.models.length
                  ? 100
                  : project.versions.length
                    ? 75
                    : project.assets.length
                      ? 35
                      : 15}
                %
              </span>
            </div>
            <div className="big-meter">
              <i
                style={{
                  width:
                    (project.models.length
                      ? 100
                      : project.versions.length
                        ? 75
                        : project.assets.length
                          ? 35
                          : 15) + "%",
                }}
              />
            </div>
            <div className="steps">
              <Step done title="Create project" />
              <Step
                done={project.assets.length > 0}
                title="Upload images"
                onClick={() => input.current?.click()}
              />
              <Step
                done={project.assets.some((a) => a.status === "annotated")}
                title="Annotate"
                onClick={() => go("annotate")}
              />
              <Step
                done={project.versions.length > 0}
                title="Generate version"
                onClick={() => go("versions")}
              />
              <Step
                done={project.models.length > 0}
                title="Train model"
                onClick={() => go("train")}
              />
            </div>
          </section>
          <section
            className={
              "panel project-drop-zone " + (draggingUpload ? "drop-active" : "")
            }
            onDragOver={(event) => {
              event.preventDefault();
              setDraggingUpload(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setDraggingUpload(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              upload(event.dataTransfer.files);
            }}
          >
            <div className="panel-head">
              <div>
                <h2>Dataset</h2>
                <p>Your latest uploaded images.</p>
              </div>
              <button className="secondary" onClick={() => go("dataset")}>
                View dataset <ChevronRight size={15} />
              </button>
            </div>
            {uploadProgress !== null && (
              <TransferProgress
                percent={uploadProgress}
                stage={uploadStage}
                label="Uploading dataset files"
              />
            )}
            {project.assets.length ? (
              <div className="thumb-grid">
                {project.assets
                  .slice(-6)
                  .reverse()
                  .map((a) => (
                    <div className="thumb" key={a.id}>
                      <img src={a.src} />
                      <span>{a.boxes.length} labels</span>
                      <button
                        className="thumb-delete"
                        onClick={() => deleteImage(a.id)}
                        title="Delete image"
                      >
                        <Trash2 />
                      </button>
                    </div>
                  ))}
              </div>
            ) : (
              <div
                className="empty-drop"
                onClick={() => input.current?.click()}
              >
                <CloudUpload size={30} />
                <b>Drop images or video here</b>
                <small>JPG, PNG, WEBP, MP4, MOV, WEBM</small>
              </div>
            )}
          </section>
        </div>
        <div className="side-col">
          <section className="panel compact">
            <h3>Dataset health</h3>
            <div className="donut">
              <span>
                {project.assets.length
                  ? Math.round(
                      (project.assets.filter((a) => a.status === "annotated")
                        .length /
                        project.assets.length) *
                        100,
                    )
                  : 0}
                %<small>Annotated</small>
              </span>
            </div>
            <dl>
              <div>
                <dt>Images</dt>
                <dd>{project.assets.length}</dd>
              </div>
              <div>
                <dt>Annotations</dt>
                <dd>
                  {project.assets.reduce((n, a) => n + a.boxes.length, 0)}
                </dd>
              </div>
              <div>
                <dt>Classes</dt>
                <dd>{project.classes.length}</dd>
              </div>
            </dl>
          </section>
          <section className="panel compact">
            <h3>Classes</h3>
            {project.classes.map((c, i) => {
              const usage = project.assets.reduce(
                (n, a) => n + a.boxes.filter((b) => b.label === c).length,
                0,
              );
              return (
                <div className="class-row" key={c}>
                  <i style={{ background: classColor(project, c, i) }} />
                  {c}
                  <span>{usage}</span>
                  <button
                    disabled={project.classes.length === 1 || usage > 0}
                    title={
                      usage ? `Used by ${usage} annotations` : "Delete class"
                    }
                    onClick={async () => {
                      if (!confirm(`Hapus class ${c}?`)) return;
                      try {
                        const saved = await api.deleteClass(project.id, c);
                        update(() => saved);
                        notify("Class dihapus");
                      } catch (e) {
                        notify(
                          e instanceof Error
                            ? e.message
                            : "Gagal menghapus class",
                        );
                      }
                    }}
                  >
                    <Trash2 />
                  </button>
                </div>
              );
            })}
            <button
              className="text-btn"
              onClick={async () => {
                const n = prompt("Nama class baru")?.trim();
                if (n && !project.classes.includes(n)) {
                  try {
                    const saved = await api.addClass(
                      project.id,
                      n,
                      CLASS_PALETTE[
                        project.classes.length % CLASS_PALETTE.length
                      ],
                    );
                    update(() => saved);
                    notify("Class disimpan ke database");
                  } catch (e) {
                    notify(
                      e instanceof Error ? e.message : "Gagal menambah class",
                    );
                  }
                }
              }}
            >
              <Plus size={14} />
              Add class
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function Step({
  done,
  title,
  onClick,
}: {
  done?: boolean;
  title: string;
  onClick?: () => void;
}) {
  return (
    <button className="step" onClick={onClick}>
      <span className={done ? "done" : ""}>
        {done ? <Check size={15} /> : <ChevronRight size={15} />}
      </span>
      <b>{title}</b>
    </button>
  );
}

function Annotate({
  project,
  go,
  update,
  notify,
}: {
  project: Project;
  go: (p: Page) => void;
  update: (fn: (p: Project) => Project) => void;
  notify: (s: string) => void;
}) {
  const [index, setIndex] = useState(() => {
    const requested = localStorage.getItem(`vf-annotate-${project.id}`);
    const found = project.assets.findIndex((item) => item.id === requested);
    return found >= 0 ? found : 0;
  });
  const asset = project.assets[index];
  const [drawing, setDrawing] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);
  const [label, setLabel] = useState(project.classes[0] || "object");
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<Box[][]>([]);
  const [future, setFuture] = useState<Box[][]>([]);
  const [zoom, setZoom] = useState(1);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const copied = useRef<Box | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    mode: "move" | "resize";
    start: { x: number; y: number };
    original: Box;
  } | null>(null);
  const [classEditor, setClassEditor] = useState<{
    original: string | null;
    name: string;
    color: string;
  } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const saveSequence = useRef(0);
  useEffect(() => {
    setHistory([]);
    setFuture([]);
    setSelected(null);
    setZoom(1);
    if (asset) localStorage.setItem(`vf-annotate-${project.id}`, asset.id);
  }, [asset?.id]);
  const point = (e: any) => {
    const r = canvas.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)),
    };
  };
  const saveBoxes = (boxes: Box[]) => {
    if (!asset) return;
    const sequence = ++saveSequence.current;
    setSaveState("saving");
    update((p) => ({
      ...p,
      assets: p.assets.map((a) =>
        a.id === asset.id
          ? { ...a, boxes, status: boxes.length ? "annotated" : "unannotated" }
          : a,
      ),
    }));
    api
      .annotate(project.id, asset.id, boxes)
      .then((saved) => {
        if (sequence === saveSequence.current) {
          update(() => saved);
          setSaveState("saved");
        }
      })
      .catch((e) => {
        setSaveState("error");
        notify(e instanceof Error ? e.message : "Gagal menyimpan anotasi");
      });
  };
  const commitBoxes = (boxes: Box[]) => {
    if (!asset) return;
    setHistory((h) => [...h.slice(-29), asset.boxes]);
    setFuture([]);
    saveBoxes(boxes);
  };
  const undo = () => {
    if (!asset || !history.length) return;
    const previous = history.at(-1)!;
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [asset.boxes, ...f]);
    saveBoxes(previous);
  };
  const redo = () => {
    if (!asset || !future.length) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setHistory((h) => [...h, asset.boxes]);
    saveBoxes(next);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "c" &&
        selected &&
        asset
      ) {
        e.preventDefault();
        copied.current = asset.boxes.find((box) => box.id === selected) || null;
        if (copied.current) notify("Annotation copied");
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "v" &&
        copied.current &&
        asset
      ) {
        e.preventDefault();
        const source = copied.current;
        const duplicate = {
          ...source,
          id: uid(),
          x: Math.min(100 - source.w, source.x + 2),
          y: Math.min(100 - source.h, source.y + 2),
          points: source.points?.map((point) => ({
            ...point,
            x: Math.min(100, point.x + 2),
            y: Math.min(100, point.y + 2),
          })),
        };
        commitBoxes([...asset.boxes, duplicate]);
        setSelected(duplicate.id);
        return;
      }
      if (!asset) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        commitBoxes(asset.boxes.filter((b) => b.id !== selected));
        setSelected(null);
        return;
      }
      if (
        selected &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        e.preventDefault();
        const dx =
          e.key === "ArrowLeft" ? -0.5 : e.key === "ArrowRight" ? 0.5 : 0;
        const dy = e.key === "ArrowUp" ? -0.5 : e.key === "ArrowDown" ? 0.5 : 0;
        commitBoxes(
          asset.boxes.map((b) =>
            b.id === selected
              ? {
                  ...b,
                  x: Math.max(0, Math.min(100 - b.w, b.x + dx)),
                  y: Math.max(0, Math.min(100 - b.h, b.y + dy)),
                }
              : b,
          ),
        );
      }
      if (e.key === "ArrowLeft" && !selected && index > 0)
        setIndex((i) => i - 1);
      if (
        e.key === "ArrowRight" &&
        !selected &&
        index < project.assets.length - 1
      )
        setIndex((i) => i + 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [asset, selected, history, future, index, project.assets.length]);
  const editDown = (e: any, box: Box, mode: "move" | "resize") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelected(box.id);
    setHistory((h) => [...h.slice(-29), asset.boxes]);
    setFuture([]);
    setEditing({ id: box.id, mode, start: point(e), original: box });
  };
  const openAddClass = () =>
    setClassEditor({
      original: null,
      name: "",
      color: CLASS_PALETTE[project.classes.length % CLASS_PALETTE.length],
    });
  const openRenameClass = (name: string, index: number) =>
    setClassEditor({
      original: name,
      name,
      color: classColor(project, name, index),
    });
  const saveClassEditor = async () => {
    if (!classEditor) return;
    const name = classEditor.name.trim();
    if (!name) {
      notify("Nama class wajib diisi");
      return;
    }
    if (project.classes.some((c) => c === name && c !== classEditor.original)) {
      notify("Nama class sudah digunakan");
      return;
    }
    try {
      const saved = classEditor.original
        ? await api.renameClass(
            project.id,
            classEditor.original,
            name,
            classEditor.color,
          )
        : await api.addClass(project.id, name, classEditor.color);
      update(() => saved);
      if (!classEditor.original || label === classEditor.original)
        setLabel(name);
      notify(
        classEditor.original
          ? `Class ${classEditor.original} diubah menjadi ${name}`
          : `Class ${name} ditambahkan`,
      );
      setClassEditor(null);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Gagal menyimpan class");
    }
  };
  const recolorClass = async (name: string, color: string) => {
    try {
      const saved = await api.renameClass(project.id, name, name, color);
      update(() => saved);
      notify(`Warna ${name} diperbarui`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Gagal mengubah warna");
    }
  };
  const interpolate = async () => {
    if (!asset || !asset.boxes.length) {
      notify("Frame awal harus memiliki anotasi");
      return;
    }
    const nextIndex = project.assets.findIndex(
      (item, itemIndex) => itemIndex > index && item.boxes.length > 0,
    );
    if (nextIndex < 0) {
      notify("Anotasikan frame endpoint berikutnya terlebih dahulu");
      return;
    }
    if (nextIndex === index + 1) {
      notify("Tidak ada frame kosong di antara kedua endpoint");
      return;
    }
    try {
      const saved = await api.interpolate(
        project.id,
        asset.id,
        project.assets[nextIndex].id,
      );
      update(() => saved);
      notify(`${nextIndex - index - 1} frame berhasil diinterpolasi`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Interpolasi gagal");
    }
  };
  const down = (e: any) => {
    if (e.button !== 0) return;
    setSelected(null);
    const p = point(e);
    setDrawing(p);
    setDraft({ id: uid(), x: p.x, y: p.y, w: 0, h: 0, label });
  };
  const move = (e: any) => {
    const p = point(e);
    if (editing) {
      const dx = p.x - editing.start.x,
        dy = p.y - editing.start.y;
      update((projectState) => ({
        ...projectState,
        assets: projectState.assets.map((a) =>
          a.id === asset.id
            ? {
                ...a,
                boxes: a.boxes.map((b) =>
                  b.id === editing.id
                    ? editing.mode === "move"
                      ? {
                          ...b,
                          x: Math.max(
                            0,
                            Math.min(100 - b.w, editing.original.x + dx),
                          ),
                          y: Math.max(
                            0,
                            Math.min(100 - b.h, editing.original.y + dy),
                          ),
                        }
                      : {
                          ...b,
                          w: Math.max(
                            1,
                            Math.min(100 - b.x, editing.original.w + dx),
                          ),
                          h: Math.max(
                            1,
                            Math.min(100 - b.y, editing.original.h + dy),
                          ),
                        }
                    : b,
                ),
              }
            : a,
        ),
      }));
      return;
    }
    if (!drawing) return;
    setDraft({
      id: draft?.id || uid(),
      x: Math.min(drawing.x, p.x),
      y: Math.min(drawing.y, p.y),
      w: Math.abs(p.x - drawing.x),
      h: Math.abs(p.y - drawing.y),
      label,
    });
  };
  const up = () => {
    if (editing) {
      saveBoxes(asset.boxes);
      setEditing(null);
      return;
    }
    if (asset && draft && draft.w > 1 && draft.h > 1)
      commitBoxes([...asset.boxes, draft]);
    setDrawing(null);
    setDraft(null);
  };
  if (!asset)
    return (
      <div className="content">
        <ProjectTabs active="annotate" go={go} />
        <div className="zero">
          <ImageIcon />
          <h2>No images to annotate</h2>
          <p>Upload images from the Overview page first.</p>
        </div>
      </div>
    );
  return (
    <div className="annotator">
      <div className="annotator-head">
        <div>
          <b>Annotate</b>
          <span>{asset.name}</span>
          <span className={"save-state " + saveState}>
            {saveState === "saving"
              ? "Saving…"
              : saveState === "error"
                ? "Save failed"
                : "Saved"}
          </span>
        </div>
        <div className="image-nav">
          <button disabled={!index} onClick={() => setIndex((i) => i - 1)}>
            ‹
          </button>
          <span>
            {index + 1} / {project.assets.length}
          </span>
          <button
            disabled={index === project.assets.length - 1}
            onClick={() => setIndex((i) => i + 1)}
          >
            ›
          </button>
        </div>
        <button className="primary small" onClick={() => go("versions")}>
          <Check size={15} />
          Saved · Generate Version
        </button>
      </div>
      <div className="annotator-body">
        <aside className="toolrail">
          <button className="active" title="Bounding box">
            <Boxes />
          </button>
          <button
            onClick={interpolate}
            title="Interpolate boxes to the next annotated frame"
          >
            <Activity />
          </button>
          <button
            onClick={undo}
            disabled={!history.length}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 />
          </button>
          <button
            onClick={redo}
            disabled={!future.length}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 />
          </button>
          <button
            onClick={() =>
              selected &&
              (commitBoxes(asset.boxes.filter((b) => b.id !== selected)),
              setSelected(null))
            }
            disabled={!selected}
            title="Delete selected"
          >
            <Trash2 />
          </button>
          <button
            disabled={!selected}
            title="Copy selected (Ctrl+C)"
            onClick={() => {
              copied.current =
                asset.boxes.find((box) => box.id === selected) || null;
              if (copied.current) notify("Annotation copied");
            }}
          >
            <Copy />
          </button>
        </aside>
        <aside className="classes">
          <div className="classes-head">
            <span className="eyebrow">CLASSES</span>
            <button onClick={openAddClass} title="Add class">
              <Plus />
            </button>
          </div>
          {project.classes.map((c, i) => (
            <div className="annot-class" key={c}>
              <button
                onClick={() => setLabel(c)}
                className={label === c ? "active" : ""}
              >
                <i style={{ background: classColor(project, c, i) }} />
                {c}
                <small>{asset.boxes.filter((b) => b.label === c).length}</small>
              </button>
              <input
                className="class-color"
                type="color"
                value={classColor(project, c, i)}
                onChange={(e) => recolorClass(c, e.target.value)}
                title="Change class color"
              />
              <button
                className="class-edit"
                onClick={() => openRenameClass(c, i)}
                title="Rename class"
              >
                <span>Rename</span>
              </button>
            </div>
          ))}
          {classEditor && (
            <div className="class-editor">
              <div className="class-editor-title">
                <b>{classEditor.original ? "Rename class" : "Add new class"}</b>
                <button onClick={() => setClassEditor(null)}>
                  <X />
                </button>
              </div>
              <label>
                Class name
                <input
                  autoFocus
                  value={classEditor.name}
                  onChange={(e) =>
                    setClassEditor({ ...classEditor, name: e.target.value })
                  }
                  onKeyDown={(e) => e.key === "Enter" && saveClassEditor()}
                />
              </label>
              <label>
                Color
                <div className="color-field">
                  <input
                    type="color"
                    value={classEditor.color}
                    onChange={(e) =>
                      setClassEditor({ ...classEditor, color: e.target.value })
                    }
                  />
                  <span>{classEditor.color}</span>
                </div>
              </label>
              <button className="save-class" onClick={saveClassEditor}>
                <Check />
                Save class
              </button>
            </div>
          )}
          <div className="hint">
            <b>Draw & edit</b>
            <span>
              Drag empty space to draw. Drag a box to move it; use its
              lower-right handle to resize.
            </span>
          </div>
        </aside>
        <div
          className={"canvas-wrap " + (zoom > 1 ? "zoomed" : "")}
          onWheel={(event) => {
            if (!event.ctrlKey) return;
            event.preventDefault();
            setZoom((value) =>
              Math.max(
                0.5,
                Math.min(3, value + (event.deltaY < 0 ? 0.1 : -0.1)),
              ),
            );
          }}
        >
          <div
            className="canvas"
            ref={canvas}
            style={{ transform: `scale(${zoom})` }}
            onMouseDown={down}
            onMouseMove={move}
            onMouseUp={up}
            onMouseLeave={up}
          >
            <img src={asset.src} draggable={false} />
            {asset.boxes.map((b, i) => (
              <div
                key={b.id}
                className={"bbox " + (selected === b.id ? "selected" : "")}
                onMouseDown={(e) => editDown(e, b, "move")}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(b.id);
                }}
                style={{
                  left: b.x + "%",
                  top: b.y + "%",
                  width: b.w + "%",
                  height: b.h + "%",
                  borderColor: classColor(
                    project,
                    b.label,
                    Math.max(0, project.classes.indexOf(b.label)),
                  ),
                }}
              >
                <span>
                  {b.label} · {i + 1}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    commitBoxes(asset.boxes.filter((x) => x.id !== b.id));
                  }}
                >
                  <X />
                </button>
                {selected === b.id && (
                  <i
                    className="resize-handle"
                    onMouseDown={(e) => editDown(e, b, "resize")}
                  />
                )}
              </div>
            ))}
            {draft && (
              <div
                className="bbox draft"
                style={{
                  left: draft.x + "%",
                  top: draft.y + "%",
                  width: draft.w + "%",
                  height: draft.h + "%",
                }}
              />
            )}
          </div>
          <div className="zoom">
            <button
              onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
              title="Zoom out"
            >
              <ZoomOut />
            </button>
            <button
              className="zoom-value"
              onClick={() => setZoom(1)}
              title="Reset zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
              title="Zoom in"
            >
              <ZoomIn />
            </button>
          </div>
        </div>
        <aside className="annotation-list">
          <h3>
            Annotations <span>{asset.boxes.length}</span>
          </h3>
          {asset.boxes.map((b, i) => (
            <div
              className={selected === b.id ? "selected" : ""}
              key={b.id}
              onClick={() => setSelected(b.id)}
            >
              <i
                style={{
                  background: classColor(
                    project,
                    b.label,
                    Math.max(0, project.classes.indexOf(b.label)),
                  ),
                }}
              />
              {i + 1}. {b.label}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  commitBoxes(asset.boxes.filter((x) => x.id !== b.id));
                }}
              >
                <X />
              </button>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

function ClassificationAnnotate({
  project,
  go,
  update,
  notify,
}: {
  project: Project;
  go: (p: Page) => void;
  update: (fn: (p: Project) => Project) => void;
  notify: (s: string) => void;
}) {
  const [index, setIndex] = useState(() => {
    const requested = localStorage.getItem(`vf-annotate-${project.id}`);
    const found = project.assets.findIndex((item) => item.id === requested);
    return found >= 0 ? found : 0;
  });
  const asset = project.assets[index];
  useEffect(() => {
    if (asset) localStorage.setItem(`vf-annotate-${project.id}`, asset.id);
  }, [asset?.id]);
  const multi = project.type === "Multi-Label Classification";
  const apply = async (label: string) => {
    if (!asset) return;
    const exists = asset.boxes.some((box) => box.label === label);
    const boxes: Box[] = exists
      ? asset.boxes.filter((box) => box.label !== label)
      : multi
        ? [
            ...asset.boxes,
            {
              id: uid(),
              x: 0,
              y: 0,
              w: 100,
              h: 100,
              label,
              type: "classification",
            },
          ]
        : [
            {
              id: uid(),
              x: 0,
              y: 0,
              w: 100,
              h: 100,
              label,
              type: "classification",
            },
          ];
    update((state) => ({
      ...state,
      assets: state.assets.map((item) =>
        item.id === asset.id
          ? {
              ...item,
              boxes,
              status: boxes.length ? "annotated" : "unannotated",
            }
          : item,
      ),
    }));
    try {
      const saved = await api.annotate(project.id, asset.id, boxes);
      update(() => saved);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Gagal menyimpan label");
    }
  };
  const addClass = async () => {
    const name = prompt("Nama class baru")?.trim();
    if (!name || project.classes.includes(name)) return;
    try {
      const saved = await api.addClass(
        project.id,
        name,
        CLASS_PALETTE[project.classes.length % CLASS_PALETTE.length],
      );
      update(() => saved);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Gagal menambah class");
    }
  };
  const renameClass = async (name: string, i: number) => {
    const replacement = prompt("Ubah nama class", name)?.trim();
    if (!replacement || replacement === name) return;
    try {
      const saved = await api.renameClass(
        project.id,
        name,
        replacement,
        classColor(project, name, i),
      );
      update(() => saved);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Gagal mengubah class");
    }
  };
  if (!asset)
    return (
      <div className="content">
        <ProjectTabs active="annotate" go={go} />
        <div className="zero">
          <ImageIcon />
          <h2>No images to classify</h2>
          <p>Upload images from the Overview page first.</p>
        </div>
      </div>
    );
  return (
    <div className="annotator classification-annotator">
      <div className="annotator-head">
        <div>
          <b>{multi ? "Multi-label" : "Single-label"} Classification</b>
          <span>{asset.name}</span>
        </div>
        <div className="image-nav">
          <button
            disabled={!index}
            onClick={() => setIndex((value) => value - 1)}
          >
            ‹
          </button>
          <span>
            {index + 1} / {project.assets.length}
          </span>
          <button
            disabled={index === project.assets.length - 1}
            onClick={() => setIndex((value) => value + 1)}
          >
            ›
          </button>
        </div>
        <button className="primary small" onClick={() => go("versions")}>
          <Check />
          Saved · Generate Version
        </button>
      </div>
      <div className="classification-workspace">
        <section className="classification-image">
          <img src={asset.src} />
          <div className="classification-tags">
            {asset.boxes.map((box, i) => (
              <span
                key={box.id}
                style={{ background: classColor(project, box.label, i) }}
              >
                {box.label}
              </span>
            ))}
          </div>
        </section>
        <aside className="classification-panel">
          <div className="classes-head">
            <span className="eyebrow">IMAGE LABELS</span>
            <button onClick={addClass}>
              <Plus />
            </button>
          </div>
          <p>
            {multi
              ? "Choose every class present in this image."
              : "Choose exactly one class for this image."}
          </p>
          {project.classes.map((name, i) => {
            const selected = asset.boxes.some((box) => box.label === name);
            return (
              <div
                className={
                  "classification-choice " + (selected ? "selected" : "")
                }
                key={name}
              >
                <button onClick={() => apply(name)}>
                  <i style={{ background: classColor(project, name, i) }} />
                  {name}
                  <span>{selected ? <Check /> : null}</span>
                </button>
                <input
                  type="color"
                  value={classColor(project, name, i)}
                  onChange={async (e) => {
                    const saved = await api.renameClass(
                      project.id,
                      name,
                      name,
                      e.target.value,
                    );
                    update(() => saved);
                  }}
                />
                <button
                  title="Rename class"
                  onClick={() => renameClass(name, i)}
                >
                  Rename
                </button>
              </div>
            );
          })}
          <div className="classification-shortcuts">
            <b>Instant save</b>
            <span>
              Choose labels, then use the arrows above to review the next image.
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Versions({
  project,
  go,
  update,
  notify,
}: {
  project: Project;
  go: (p: Page) => void;
  update: (fn: (p: Project) => Project) => void;
  notify: (s: string) => void;
}) {
  const [resize, setResize] = useState(640);
  const [aug, setAug] = useState(true);
  const generate = async () => {
    try {
      const saved = await api.version(project.id, {
        resize,
        augment: aug,
        splits: [70, 20, 10],
      });
      update(() => saved);
      notify("Dataset version YOLO berhasil dibuat di filesystem");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Gagal membuat version");
    }
  };
  return (
    <div className="content">
      <ProjectTabs active="versions" go={go} />
      <div className="project-title">
        <div>
          <span className="eyebrow">IMMUTABLE DATA SNAPSHOTS</span>
          <h1>Dataset versions</h1>
          <p>
            Freeze preprocessing and augmentation settings for reproducible
            training.
          </p>
        </div>
      </div>
      <div className="project-layout">
        <div className="main-col">
          <section className="panel">
            <div className="section-label">
              <span>1</span>
              <div>
                <h2>Source images</h2>
                <p>
                  {project.assets.length} images ·{" "}
                  {
                    project.assets.filter((a) => a.status === "annotated")
                      .length
                  }{" "}
                  annotated
                </p>
              </div>
              <Check />
            </div>
            <div className="section-label">
              <span>2</span>
              <div>
                <h2>Train / valid / test split</h2>
                <p>Choose how the images are distributed.</p>
              </div>
            </div>
            <div className="splitbar">
              <i />
              <i />
              <i />
            </div>
            <div className="splitlabels">
              <span>
                Train <b>70%</b>
              </span>
              <span>
                Valid <b>20%</b>
              </span>
              <span>
                Test <b>10%</b>
              </span>
            </div>
            <div className="section-label">
              <span>3</span>
              <div>
                <h2>Preprocessing</h2>
                <p>Standardize images before training.</p>
              </div>
            </div>
            <div className="setting">
              <div>
                <SlidersHorizontal />
                <span>
                  <b>Auto-orient</b>
                  <small>Remove EXIF orientation</small>
                </span>
              </div>
              <input type="checkbox" checked readOnly />
            </div>
            <div className="setting">
              <div>
                <ImageIcon />
                <span>
                  <b>Resize</b>
                  <small>Stretch images to a fixed square</small>
                </span>
              </div>
              <select
                value={resize}
                onChange={(e) => setResize(+e.target.value)}
              >
                <option>416</option>
                <option>640</option>
                <option>1024</option>
              </select>
            </div>
            <div className="section-label">
              <span>4</span>
              <div>
                <h2>Augmentation</h2>
                <p>Create varied training examples.</p>
              </div>
            </div>
            <div className="setting">
              <div>
                <Sparkles />
                <span>
                  <b>Smart augment</b>
                  <small>Horizontal flip + brightness +18%</small>
                </span>
              </div>
              <input
                type="checkbox"
                checked={aug}
                onChange={(e) => setAug(e.target.checked)}
              />
            </div>
            <button className="primary wide" onClick={generate}>
              <FlaskConical size={17} />
              Generate version
            </button>
          </section>
        </div>
        <div className="side-col">
          <section className="panel compact">
            <h3>Version history</h3>
            {[...project.versions].reverse().map((v) => (
              <div className="version-row" key={v.id}>
                <span>v{v.number}</span>
                <div>
                  <b>{v.images} images</b>
                  <small>
                    {v.createdAt} · {v.resize}px
                  </small>
                </div>
                <div className="export-links">
                  <a
                    className="version-download"
                    href={api.exportUrl(project.id, v.id, "yolo")}
                    download
                    title="Download YOLO ZIP"
                  >
                    YOLO
                  </a>
                  <a
                    className="version-download"
                    href={api.exportUrl(project.id, v.id, "coco")}
                    download
                    title="Download COCO ZIP"
                  >
                    COCO
                  </a>
                </div>
              </div>
            ))}
            {!project.versions.length && (
              <p className="muted">No versions generated yet.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Train({
  project,
  go,
  update,
  notify,
}: {
  project: Project;
  go: (p: Page) => void;
  update: (fn: (p: Project) => Project) => void;
  notify: (s: string) => void;
}) {
  const [arch, setArch] = useState("VisionFlow Detect Fast");
  const [epochs, setEpochs] = useState(10);
  const start = async () => {
    if (!project.versions.length) {
      notify("Buat dataset version terlebih dahulu");
      return;
    }
    try {
      const architecture = arch.includes("Accurate")
        ? "yolo11s.pt"
        : "yolo11n.pt";
      const saved = await api.train(project.id, {
        architecture,
        epochs,
        image_size: 640,
      });
      update(() => saved);
      notify("Training YOLO dimulai di backend lokal");
      const poll = window.setInterval(async () => {
        try {
          const fresh = await api.project(project.id);
          update(() => fresh);
          if (fresh.models.every((m) => m.status !== "training"))
            window.clearInterval(poll);
        } catch {}
      }, 2000);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Training gagal dimulai");
    }
  };
  return (
    <div className="content">
      <ProjectTabs active="train" go={go} />
      <div className="project-title">
        <div>
          <span className="eyebrow">MODEL TRAINING</span>
          <h1>Train a model</h1>
          <p>Configure and launch a computer vision training job.</p>
        </div>
      </div>
      <div className="train-grid">
        <section className="panel">
          <h2>Choose architecture</h2>
          <p className="muted">
            Select the best balance of speed and accuracy.
          </p>
          {[
            "VisionFlow Detect Fast",
            "VisionFlow Detect Accurate",
            "YOLO-compatible Local",
          ].map((a, i) => (
            <button
              className={"model-option " + (arch === a ? "active" : "")}
              onClick={() => setArch(a)}
              key={a}
            >
              <span className={i === 0 ? "purple" : i === 1 ? "blue" : "green"}>
                <BrainCircuit />
              </span>
              <div>
                <b>{a}</b>
                <small>
                  {i === 0
                    ? "Recommended · optimized for realtime"
                    : i === 1
                      ? "Best accuracy · higher compute"
                      : "Exportable · local runtime"}
                </small>
              </div>
              {i === 0 && <em>RECOMMENDED</em>}
              <i>{arch === a && <Check />}</i>
            </button>
          ))}
          <div className="train-config">
            <label>
              Dataset version
              <select>
                <option>
                  {project.versions.length
                    ? "Version " + project.versions.at(-1)!.number
                    : "No version available"}
                </option>
              </select>
            </label>
            <label>
              Training epochs
              <select
                value={epochs}
                onChange={(e) => setEpochs(+e.target.value)}
              >
                <option value={5}>Fast · 5 epochs</option>
                <option value={10}>Balanced · 10 epochs</option>
                <option value={30}>Accurate · 30 epochs</option>
              </select>
            </label>
          </div>
          <button className="primary wide" onClick={start}>
            <Play size={17} />
            Start training
          </button>
        </section>
        <section className="panel">
          <h2>Training runs</h2>
          {[...project.models].reverse().map((m) => (
            <div className="run" key={m.id}>
              <div className="run-head">
                <span className={m.status}>
                  <Activity />
                </span>
                <div>
                  <b>{m.name}</b>
                  <small>Dataset v{m.version}</small>
                </div>
                <strong>
                  {m.status === "ready"
                    ? "Ready"
                    : m.status === "failed"
                      ? "Failed"
                      : m.status === "cancelled"
                        ? "Cancelled"
                        : m.progress + "%"}
                </strong>
              </div>
              {m.status === "training" ? (
                <>
                  <div className="big-meter">
                    <i style={{ width: m.progress + "%" }} />
                  </div>
                  <button
                    className="cancel-job"
                    onClick={async () => {
                      await api.cancelTraining(project.id, m.id);
                      notify("Permintaan pembatalan dikirim");
                    }}
                  >
                    Cancel training
                  </button>
                </>
              ) : (
                <div className="metrics">
                  <span>
                    <b>{m.map}%</b>
                    <small>mAP</small>
                  </span>
                  <span>
                    <b>{m.precision}%</b>
                    <small>Precision</small>
                  </span>
                  <span>
                    <b>{m.recall}%</b>
                    <small>Recall</small>
                  </span>
                </div>
              )}
            </div>
          ))}
          {!project.models.length && (
            <div className="zero mini">
              <BrainCircuit />
              <h3>No training runs</h3>
              <p>Your runs and metrics will appear here.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Deploy({ project, go }: { project: Project; go: (p: Page) => void }) {
  const ready = project.models.filter((m) => m.status === "ready");
  const [tab, setTab] = useState("image");
  const [preview, setPreview] = useState("");
  const [threshold, setThreshold] = useState(50);
  const [result, setResult] = useState<{
    predictions: Array<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      confidence: number;
      class: string;
      points?: Array<{ x: number; y: number }>;
    }>;
    image: { width: number; height: number };
  } | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [transferProgress, setTransferProgress] = useState<number | null>(null);
  const [transferStage, setTransferStage] =
    useState<TransferStage>("uploading");
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchResults, setBatchResults] = useState<
    Array<{ file: string; predictions: number; error?: string }>
  >([]);
  const [videoResult, setVideoResult] = useState<{
    sampledFrames: number;
    durationSeconds: number;
    totals: Record<string, number>;
  } | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [keys, setKeys] = useState<
    Array<{
      id: string;
      name: string;
      prefix: string;
      createdAt: string;
      lastUsed?: string;
      revoked: boolean;
    }>
  >([]);
  const [revealedKey, setRevealedKey] = useState("");
  const [metrics, setMetrics] = useState<{
    requests: number;
    averageLatencyMs: number;
    errors: number;
    recent: Array<{
      created_at: string;
      latency_ms: number;
      predictions: number;
      status: string;
    }>;
  } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const busy = useRef(false);
  const test = async (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.readAsDataURL(file);
    setRunning(true);
    setTransferProgress(0);
    setTransferStage("uploading");
    setError("");
    setResult(null);
    try {
      setResult(
        await api.infer(
          project.id,
          file,
          threshold / 100,
          setTransferProgress,
          () => setTransferStage("processing"),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inference gagal");
    } finally {
      setRunning(false);
      setTransferProgress(null);
    }
  };
  const testBatch = async (files?: FileList | null) => {
    if (!files?.length) return;
    setRunning(true);
    setBatchProgress(0);
    setBatchResults([]);
    const outputs: Array<{
      file: string;
      predictions: number;
      error?: string;
    }> = [];
    for (const [index, file] of Array.from(files).entries()) {
      try {
        const output = await api.infer(project.id, file, threshold / 100);
        outputs.push({
          file: file.name,
          predictions: output.predictions.length,
        });
      } catch (batchError) {
        outputs.push({
          file: file.name,
          predictions: 0,
          error:
            batchError instanceof Error
              ? batchError.message
              : "Inference gagal",
        });
      }
      setBatchResults([...outputs]);
      setBatchProgress(Math.round(((index + 1) / files.length) * 100));
    }
    setRunning(false);
  };
  const downloadBatch = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(batchResults, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "visionflow-batch-results.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const testVideo = async (file?: File) => {
    if (!file) return;
    setRunning(true);
    setTransferProgress(0);
    setTransferStage("uploading");
    setVideoResult(null);
    setError("");
    try {
      setVideoResult(
        await api.inferVideo(
          project.id,
          file,
          threshold / 100,
          setTransferProgress,
          () => setTransferStage("processing"),
        ),
      );
    } catch (videoError) {
      setError(
        videoError instanceof Error
          ? videoError.message
          : "Video inference gagal",
      );
    } finally {
      setRunning(false);
      setTransferProgress(null);
    }
  };
  const endpoint = `http://localhost:8000/api/projects/${project.id}/infer`;
  const pythonSnippet = `import requests\n\nresponse = requests.post(\n  "${endpoint}",\n  files={"file": open("image.jpg", "rb")},\n  params={"confidence": 0.5}\n)\n\nprint(response.json())`;
  const boxes = result?.predictions.map((p, i) => (
    <div
      className={p.points?.length ? "inference-mask" : "inference-box"}
      key={i}
      style={
        p.points?.length
          ? {
              clipPath: `polygon(${p.points.map((point) => `${(point.x / result.image.width) * 100}% ${(point.y / result.image.height) * 100}%`).join(",")})`,
            }
          : {
              left: (p.x1 / result.image.width) * 100 + "%",
              top: (p.y1 / result.image.height) * 100 + "%",
              width: ((p.x2 - p.x1) / result.image.width) * 100 + "%",
              height: ((p.y2 - p.y1) / result.image.height) * 100 + "%",
            }
      }
    >
      <span>
        {p.class} {Math.round(p.confidence * 100)}%
      </span>
    </div>
  ));
  const capture = async () => {
    if (!video.current || !video.current.videoWidth || busy.current) return;
    busy.current = true;
    const canvas = document.createElement("canvas");
    canvas.width = video.current.videoWidth;
    canvas.height = video.current.videoHeight;
    canvas.getContext("2d")!.drawImage(video.current, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.84),
    );
    if (blob)
      try {
        setResult(
          await api.infer(
            project.id,
            new File([blob], "webcam.jpg", { type: "image/jpeg" }),
            threshold / 100,
          ),
        );
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Webcam inference gagal");
      } finally {
        busy.current = false;
      }
    else busy.current = false;
  };
  const stopCamera = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setCameraOn(false);
    setResult(null);
  };
  const startCamera = async () => {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (video.current) {
        video.current.srcObject = stream.current;
        await video.current.play();
      }
      setCameraOn(true);
      timer.current = window.setInterval(capture, 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kamera tidak dapat dibuka");
    }
  };
  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    api
      .deploymentKeys(project.id)
      .then(setKeys)
      .catch(() => {});
    api
      .deploymentMetrics(project.id)
      .then(setMetrics)
      .catch(() => {});
  }, [project.id]);
  const createKey = async () => {
    const name = prompt("Nama API key", "Local application")?.trim();
    if (!name) return;
    const created = await api.createDeploymentKey(project.id, name);
    setRevealedKey(created.key);
    setKeys((current) => [created, ...current]);
  };
  const revokeKey = async (id: string) => {
    if (
      !confirm(
        "Revoke API key ini? Aplikasi yang memakainya akan langsung ditolak.",
      )
    )
      return;
    await api.revokeDeploymentKey(project.id, id);
    setKeys((current) =>
      current.map((key) => (key.id === id ? { ...key, revoked: true } : key)),
    );
  };
  const changeTab = (next: string) => {
    if (next !== "webcam") stopCamera();
    setTab(next);
    setError("");
    setResult(null);
  };
  return (
    <div className="content">
      <ProjectTabs active="deploy" go={go} />
      <div className="project-title">
        <div>
          <span className="eyebrow">LOCAL INFERENCE</span>
          <h1>Deploy & test</h1>
          <p>Test your model or connect it to an application.</p>
        </div>
        <span className="online">
          <i />
          Local endpoint ready
        </span>
      </div>
      {ready.length ? (
        <div className="deploy-grid">
          <section className="panel playground">
            <div className="play-tabs">
              <button
                className={tab === "image" ? "active" : ""}
                onClick={() => changeTab("image")}
              >
                Image
              </button>
              <button
                className={tab === "webcam" ? "active" : ""}
                onClick={() => changeTab("webcam")}
              >
                Webcam
              </button>
              <button
                className={tab === "batch" ? "active" : ""}
                onClick={() => changeTab("batch")}
              >
                Batch
              </button>
              <button
                className={tab === "video" ? "active" : ""}
                onClick={() => changeTab("video")}
              >
                Video
              </button>
            </div>
            {tab === "image" ? (
              preview ? (
                <div className="preview">
                  <img src={preview} />
                  {boxes}
                  {running && (
                    <div className="infer-loading">Running model…</div>
                  )}
                  <button
                    onClick={() => {
                      setPreview("");
                      setResult(null);
                      setError("");
                    }}
                  >
                    <X />
                  </button>
                </div>
              ) : (
                <label className="test-drop">
                  <Upload />
                  <b>Test an image</b>
                  <span>Drag & drop or select from your computer</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => test(e.target.files?.[0])}
                  />
                </label>
              )
            ) : tab === "webcam" ? (
              <div>
                <div className="preview webcam-preview">
                  <video ref={video} muted playsInline />
                  {boxes}
                  {!cameraOn && (
                    <div className="camera-empty">
                      <Activity />
                      <b>Camera is off</b>
                    </div>
                  )}
                </div>
                <button
                  className={
                    cameraOn ? "danger camera-button" : "primary camera-button"
                  }
                  onClick={cameraOn ? stopCamera : startCamera}
                >
                  {cameraOn ? "Stop camera" : "Start camera"}
                </button>
              </div>
            ) : tab === "batch" ? (
              <div className="batch-inference">
                <label className="test-drop">
                  <GalleryHorizontalEnd />
                  <b>Run a batch</b>
                  <span>
                    Select multiple images and process them sequentially.
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => testBatch(event.target.files)}
                  />
                </label>
                {running && (
                  <TransferProgress
                    percent={batchProgress}
                    stage="processing"
                    label="Processing batch"
                    processingLabel="Processing image batch"
                  />
                )}
                {!!batchResults.length && (
                  <div className="batch-results">
                    <header>
                      <b>{batchResults.length} files processed</b>
                      <button onClick={downloadBatch}>
                        <Download /> JSON
                      </button>
                    </header>
                    {batchResults.map((item) => (
                      <span key={item.file}>
                        <b>{item.file}</b>
                        <small>
                          {item.error || `${item.predictions} predictions`}
                        </small>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="video-inference">
                <label className="test-drop">
                  <Play />
                  <b>Analyze a video</b>
                  <span>Samples one frame per second, up to 300 frames.</span>
                  <input
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm,video/x-msvideo"
                    onChange={(event) => testVideo(event.target.files?.[0])}
                  />
                </label>
                {running && transferProgress === null && (
                  <p className="infer-result">Processing video frames…</p>
                )}
                {videoResult && (
                  <div className="video-results">
                    <header>
                      <b>{videoResult.sampledFrames} frames analyzed</b>
                      <span>{videoResult.durationSeconds}s video</span>
                    </header>
                    {Object.entries(videoResult.totals).map(([name, count]) => (
                      <span key={name}>
                        <b>{name}</b>
                        <strong>{count}</strong>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {transferProgress !== null && (
              <TransferProgress
                percent={transferProgress}
                stage={transferStage}
                label={
                  tab === "video" ? "Uploading video" : "Uploading test image"
                }
                processingLabel={
                  tab === "video"
                    ? "Upload complete · Analyzing video frames"
                    : "Upload complete · Running model"
                }
              />
            )}
            {error && <p className="infer-error">{error}</p>}
            {result && (
              <p className="infer-result">
                {result.predictions.length} prediction
                {result.predictions.length === 1 ? "" : "s"} found
              </p>
            )}
            <div className="threshold">
              <span>
                Confidence threshold <b>{threshold}%</b>
              </span>
              <input
                type="range"
                value={threshold}
                onChange={(e) => setThreshold(+e.target.value)}
              />
            </div>
          </section>
          <section className="panel api">
            <h2>Use the local API</h2>
            <p>Connect your app to this model using HTTP.</p>
            <div className="endpoint">
              <span>POST</span> http://localhost:8000/api/projects/{project.id}
              /infer
              <button onClick={() => navigator.clipboard.writeText(endpoint)}>
                <Copy />
              </button>
            </div>
            <div className="code">
              <div>
                <span>Python</span>
                <button
                  onClick={() => navigator.clipboard.writeText(pythonSnippet)}
                >
                  <Copy size={15} />
                  Copy
                </button>
              </div>
              <pre>{pythonSnippet}</pre>
            </div>
            <div className="deploy-note ready">
              <Check />
              <span>
                <b>Real local inference</b>Predictions use the trained best.pt
                weights stored in local_data/runs.
              </span>
            </div>
          </section>
        </div>
      ) : (
        <div className="zero">
          <Rocket />
          <h2>No trained model available</h2>
          <p>Complete a training run before deploying.</p>
        </div>
      )}
      {ready.length > 0 && (
        <section className="panel deployment-security">
          <div className="panel-head">
            <div>
              <h2>Secure deployment API</h2>
              <p>
                API keys are hashed in SQLite. The complete key is shown only
                once.
              </p>
            </div>
            <button className="primary small" onClick={createKey}>
              <Plus />
              Create key
            </button>
          </div>
          {revealedKey && (
            <div className="revealed-key">
              <b>Copy this key now</b>
              <code>{revealedKey}</code>
              <button
                onClick={() => navigator.clipboard.writeText(revealedKey)}
              >
                <Copy />
                Copy
              </button>
              <button onClick={() => setRevealedKey("")}>
                <X />
              </button>
            </div>
          )}
          <div className="secure-endpoint">
            <span>POST</span>
            <code>http://localhost:8000/api/deploy/{project.id}/infer</code>
            <small>Header: X-API-Key</small>
          </div>
          <div className="deployment-summary">
            <span>
              <b>{metrics?.requests || 0}</b>
              <small>Recent requests</small>
            </span>
            <span>
              <b>{metrics?.averageLatencyMs || 0} ms</b>
              <small>Average latency</small>
            </span>
            <span>
              <b>{metrics?.errors || 0}</b>
              <small>Errors</small>
            </span>
          </div>
          <div className="key-list">
            {keys.map((key) => (
              <div className={key.revoked ? "revoked" : ""} key={key.id}>
                <span>
                  <b>{key.name}</b>
                  <small>
                    {key.prefix}•••••• ·{" "}
                    {key.lastUsed
                      ? "Last used " +
                        key.lastUsed.slice(0, 16).replace("T", " ")
                      : "Never used"}
                  </small>
                </span>
                <em>{key.revoked ? "Revoked" : "Active"}</em>
                {!key.revoked && (
                  <button onClick={() => revokeKey(key.id)}>Revoke</button>
                )}
              </div>
            ))}
            {!keys.length && (
              <p>No API keys yet. Create one for external applications.</p>
            )}
          </div>
          {!!metrics?.recent.length && (
            <div className="request-log">
              <h3>Recent requests</h3>
              <div className="request-log-head">
                <span>Time</span>
                <span>Status</span>
                <span>Predictions</span>
                <span>Latency</span>
              </div>
              {metrics.recent.map((entry, index) => (
                <div key={`${entry.created_at}-${index}`}>
                  <span>{entry.created_at.slice(0, 19).replace("T", " ")}</span>
                  <span
                    className={entry.status === "success" ? "success" : "error"}
                  >
                    {entry.status}
                  </span>
                  <span>{entry.predictions}</span>
                  <span>{Math.round(entry.latency_ms)} ms</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Workflows({
  projects,
  notify,
}: {
  projects: Project[];
  notify: (s: string) => void;
}) {
  const initial: WorkflowNode[] = [
    {
      id: "input",
      type: "input",
      x: 55,
      y: 115,
      title: "Image Input",
      subtitle: "Upload / camera",
    },
    {
      id: "model",
      type: "model",
      x: 350,
      y: 115,
      title: "Object Detection",
      subtitle: "Latest ready model",
      projectId: projects.find((p) =>
        p.models.some((m) => m.status === "ready"),
      )?.id,
    },
    {
      id: "count",
      type: "count",
      x: 645,
      y: 115,
      title: "Count Objects",
      subtitle: "Group predictions",
    },
    {
      id: "output",
      type: "output",
      x: 940,
      y: 115,
      title: "JSON Output",
      subtitle: "Predictions + counts",
    },
  ];
  const [nodes, setNodes] = useState<WorkflowNode[]>(initial);
  const [edges, setEdges] = useState<
    Array<{ from: string; to: string; condition?: "true" | "false" }>
  >([
    { from: "input", to: "model" },
    { from: "model", to: "count" },
    { from: "count", to: "output" },
  ]);
  const [workflowId, setWorkflowId] = useState("");
  const [name, setName] = useState("Vision inference pipeline");
  const [drag, setDrag] = useState<{
    id: string;
    dx: number;
    dy: number;
  } | null>(null);
  const [result, setResult] = useState<{
    status: string;
    counts: Record<string, number>;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [runProgress, setRunProgress] = useState(0);
  const [runStage, setRunStage] = useState<TransferStage>("uploading");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [edgeFrom, setEdgeFrom] = useState("");
  const [edgeTo, setEdgeTo] = useState("");
  const [edgeCondition, setEdgeCondition] = useState<"" | "true" | "false">("");
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [workflowSchedule, setWorkflowSchedule] = useState<{
    enabled: boolean;
    intervalMinutes: number;
    nextRun: string;
    lastRun?: string;
  } | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const runInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const layoutWorkflow = (
    items: WorkflowNode[],
    links: Array<{ from: string; to: string; condition?: "true" | "false" }>,
  ) => {
    const width = board.current?.clientWidth || 1000;
    const incoming = new Map(items.map((item) => [item.id, 0]));
    const outgoing = new Map(items.map((item) => [item.id, [] as string[]]));
    links.forEach((link) => {
      if (!incoming.has(link.to) || !outgoing.has(link.from)) return;
      incoming.set(link.to, (incoming.get(link.to) || 0) + 1);
      outgoing.get(link.from)!.push(link.to);
    });
    const queue = items
      .filter((item) => incoming.get(item.id) === 0)
      .map((item) => item.id);
    const layer = new Map(items.map((item) => [item.id, 0]));
    const ordered: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      ordered.push(id);
      outgoing.get(id)?.forEach((target) => {
        layer.set(
          target,
          Math.max(layer.get(target) || 0, (layer.get(id) || 0) + 1),
        );
        incoming.set(target, (incoming.get(target) || 0) - 1);
        if (incoming.get(target) === 0) queue.push(target);
      });
    }
    items.forEach((item) => {
      if (!ordered.includes(item.id)) ordered.push(item.id);
    });
    if (width < 650) {
      return ordered.map((id, index) => ({
        ...items.find((item) => item.id === id)!,
        x: 24,
        y: 28 + index * 118,
      }));
    }
    const maximumLayer = Math.max(1, ...layer.values());
    const horizontalGap = Math.max(0, width - 258) / maximumLayer;
    if (horizontalGap < 230) {
      const columns = Math.max(1, Math.floor((width - 48) / 230));
      const step =
        columns > 1 ? Math.max(230, (width - 48 - 210) / (columns - 1)) : 0;
      return ordered.map((id, index) => ({
        ...items.find((item) => item.id === id)!,
        x: 24 + (index % columns) * step,
        y: 38 + Math.floor(index / columns) * 128,
      }));
    }
    const layerCounts = new Map<number, number>();
    return ordered.map((id) => {
      const item = items.find((candidate) => candidate.id === id)!;
      const itemLayer = layer.get(id) || 0;
      const row = layerCounts.get(itemLayer) || 0;
      layerCounts.set(itemLayer, row + 1);
      return {
        ...item,
        x: 24 + (itemLayer / maximumLayer) * Math.max(0, width - 258),
        y: 38 + row * 118,
      };
    });
  };
  useEffect(() => {
    api
      .workflows()
      .then((items) => {
        if (items[0]) {
          setWorkflowId(items[0].id);
          setName(items[0].name);
          setNodes(layoutWorkflow(items[0].nodes, items[0].edges));
          setEdges(items[0].edges);
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!workflowId) {
      setRuns([]);
      return;
    }
    Promise.all([
      api.workflowRuns(workflowId),
      api.workflowSchedule(workflowId),
    ])
      .then(([runItems, schedule]) => {
        setRuns(runItems);
        setWorkflowSchedule(schedule);
      })
      .catch(() => setRuns([]));
  }, [workflowId]);
  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    if (!nodes.some((node) => node.type === "input"))
      errors.push("Add at least one input block.");
    if (!nodes.some((node) => node.type === "model"))
      errors.push("Add a vision model block.");
    if (!nodes.some((node) => node.type === "output"))
      errors.push("Add an output block.");
    if (edges.some((edge) => edge.from === edge.to))
      errors.push("A block cannot connect to itself.");
    if (
      edges.some(
        (edge) =>
          !nodes.some((node) => node.id === edge.from) ||
          !nodes.some((node) => node.id === edge.to),
      )
    )
      errors.push("Remove connections to missing blocks.");
    const seen = new Set<string>();
    if (
      edges.some((edge) => {
        const key = `${edge.from}:${edge.to}`;
        if (seen.has(key)) return true;
        seen.add(key);
        return false;
      })
    )
      errors.push("Remove duplicate connections.");
    const degrees = new Map(nodes.map((node) => [node.id, 0]));
    const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
    edges.forEach((edge) => {
      if (!degrees.has(edge.to) || !outgoing.has(edge.from)) return;
      degrees.set(edge.to, (degrees.get(edge.to) || 0) + 1);
      outgoing.get(edge.from)!.push(edge.to);
    });
    const queue = [...degrees]
      .filter(([, degree]) => degree === 0)
      .map(([id]) => id);
    let visited = 0;
    while (queue.length) {
      const id = queue.shift()!;
      visited += 1;
      outgoing.get(id)?.forEach((target) => {
        const degree = (degrees.get(target) || 0) - 1;
        degrees.set(target, degree);
        if (degree === 0) queue.push(target);
      });
    }
    if (visited !== nodes.length)
      errors.push("Workflow graph cannot contain cycles.");
    return errors;
  }, [edges, nodes]);
  const save = async () => {
    if (validationErrors.length) {
      notify(validationErrors[0]);
      throw new Error(validationErrors[0]);
    }
    const saved = await api.saveWorkflow({
      id: workflowId,
      name,
      nodes,
      edges,
    });
    setWorkflowId(saved.id);
    notify("Workflow disimpan ke SQLite");
    return saved;
  };
  const add = (type: string, title: string, subtitle: string) => {
    const id = uid();
    const last = nodes.at(-1);
    let config: Record<string, string | number | boolean> | undefined;
    if (type === "webhook") {
      const url = prompt("Webhook URL (http:// atau https://)")?.trim();
      if (!url) return;
      config = { url };
      subtitle = url;
    }
    if (type === "filter") {
      const className = prompt("Class name (kosong = semua)", "")?.trim() || "";
      const confidence = Number(prompt("Minimum confidence (0 - 1)", "0.5"));
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
        return;
      config = { class: className, confidence };
      subtitle = `${className || "All classes"} ≥ ${Math.round(confidence * 100)}%`;
    }
    if (type === "branch") {
      const className =
        prompt("Class to count (kosong = semua)", "")?.trim() || "";
      const count = Number(prompt("Minimum object count", "1"));
      if (!Number.isFinite(count) || count < 0) return;
      config = { class: className, count };
      subtitle = `${className || "All objects"} count ≥ ${count}`;
    }
    setNodes((n) => [
      ...n,
      {
        id,
        type,
        x: Math.min(940, 70 + n.length * 165),
        y: 70 + (n.length % 3) * 120,
        title,
        subtitle,
        projectId:
          type === "model"
            ? projects.find((p) => p.models.some((m) => m.status === "ready"))
                ?.id
            : undefined,
        config,
      },
    ]);
    if (last) setEdges((e) => [...e, { from: last.id, to: id }]);
  };
  const remove = (id: string) => {
    setNodes((n) => n.filter((node) => node.id !== id));
    setEdges((e) => e.filter((edge) => edge.from !== id && edge.to !== id));
  };
  const run = async (file?: File) => {
    if (!file) return;
    setRunning(true);
    setRunProgress(0);
    setRunStage("uploading");
    setResult(null);
    try {
      const saved = await save();
      const output = await api.runWorkflow(
        saved.id,
        file,
        0.5,
        setRunProgress,
        () => setRunStage("processing"),
      );
      setResult({ status: output.status, counts: output.counts });
      api
        .workflowRuns(saved.id)
        .then(setRuns)
        .catch(() => {});
      notify("Workflow selesai dieksekusi");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Workflow gagal");
    } finally {
      setRunning(false);
    }
  };
  const exportJson = () => {
    const blob = new Blob(
      [JSON.stringify({ id: workflowId, name, nodes, edges }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "visionflow-workflow.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const importJson = async (file?: File) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as {
        name?: string;
        nodes?: WorkflowNode[];
        edges?: Array<{
          from: string;
          to: string;
          condition?: "true" | "false";
        }>;
      };
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges))
        throw new Error("Workflow JSON tidak valid");
      setWorkflowId("");
      setName(parsed.name || "Imported workflow");
      setNodes(parsed.nodes);
      setEdges(parsed.edges);
      notify("Workflow JSON dimuat. Save untuk menyimpannya.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Import gagal");
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  };
  const duplicateCurrent = async () => {
    try {
      const saved = workflowId
        ? await api.duplicateWorkflow(workflowId)
        : await api.saveWorkflow({
            id: "",
            name: `${name} copy`,
            nodes,
            edges,
          });
      setWorkflowId(saved.id);
      setName(saved.name);
      setNodes(saved.nodes);
      setEdges(saved.edges);
      notify("Workflow diduplikasi");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Duplikasi gagal");
    }
  };
  const configureSchedule = async () => {
    try {
      const saved = workflowId ? { id: workflowId } : await save();
      if (workflowSchedule) {
        if (!confirm("Remove this workflow schedule?")) return;
        await api.deleteWorkflowSchedule(saved.id);
        setWorkflowSchedule(null);
        notify("Workflow schedule removed");
        return;
      }
      const interval = Number(prompt("Run every N minutes", "60"));
      if (!Number.isInteger(interval) || interval < 1 || interval > 10080)
        return;
      const schedule = await api.setWorkflowSchedule(saved.id, true, interval);
      setWorkflowSchedule(schedule);
      notify(`Workflow dijadwalkan setiap ${interval} menit`);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Schedule gagal disimpan",
      );
    }
  };
  const addEdge = () => {
    if (!edgeFrom || !edgeTo || edgeFrom === edgeTo) return;
    if (edges.some((edge) => edge.from === edgeFrom && edge.to === edgeTo))
      return;
    setEdges((current) => [
      ...current,
      {
        from: edgeFrom,
        to: edgeTo,
        ...(edgeCondition ? { condition: edgeCondition } : {}),
      },
    ]);
    setEdgeFrom("");
    setEdgeTo("");
    setEdgeCondition("");
  };
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const icon = (type: string) =>
    type === "input" ? (
      <ImageIcon />
    ) : type === "model" ? (
      <BrainCircuit />
    ) : type === "count" ? (
      <BarChart3 />
    ) : type === "webhook" ? (
      <Network />
    ) : type === "filter" ? (
      <SlidersHorizontal />
    ) : type === "branch" ? (
      <Workflow />
    ) : (
      <Code2 />
    );
  return (
    <div className="workflow-page">
      <div className="workflow-top">
        <div>
          <span className="eyebrow">EXECUTABLE WORKFLOW</span>
          <input
            className="workflow-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <button className="secondary" onClick={save}>
            <Check />
            Save
          </button>
          <button className="secondary" onClick={exportJson}>
            <Download />
            Export JSON
          </button>
          <button
            className="secondary"
            onClick={() => importInput.current?.click()}
          >
            <Upload /> Import
          </button>
          <button className="secondary" onClick={duplicateCurrent}>
            <Copy /> Duplicate
          </button>
          <button
            className="secondary"
            onClick={() => setNodes(layoutWorkflow(nodes, edges))}
          >
            <Layers3 /> Tidy layout
          </button>
          <button
            className={workflowSchedule ? "secondary scheduled" : "secondary"}
            onClick={configureSchedule}
          >
            <History />
            {workflowSchedule
              ? `Every ${workflowSchedule.intervalMinutes}m`
              : "Schedule"}
          </button>
          <input
            ref={importInput}
            hidden
            type="file"
            accept="application/json,.json"
            onChange={(event) => importJson(event.target.files?.[0])}
          />
          <button
            className="primary"
            onClick={() => runInput.current?.click()}
            disabled={running}
          >
            <Play />
            {running ? "Running…" : "Run workflow"}
          </button>
          <input
            ref={runInput}
            hidden
            type="file"
            accept="image/*"
            onChange={(e) => run(e.target.files?.[0])}
          />
        </div>
      </div>
      {running && (
        <TransferProgress
          percent={runProgress}
          stage={runStage}
          label="Uploading workflow input"
          processingLabel="Upload complete · Running workflow"
        />
      )}
      <div className="workflow-body">
        <aside>
          <div className="search">
            <Search />
            <input placeholder="Search blocks" />
          </div>
          <p>INPUTS</p>
          <button onClick={() => add("input", "Image Input", "Upload image")}>
            <ImageIcon />
            Image input
          </button>
          <button onClick={() => add("input", "Video Frame", "Captured frame")}>
            <Activity />
            Video frame
          </button>
          <p>MODELS</p>
          <button
            onClick={() =>
              add(
                "model",
                "Vision Model",
                "Detection / masks / pose / classification",
              )
            }
          >
            <BrainCircuit />
            Vision model
          </button>
          <p>LOGIC</p>
          <button
            onClick={() =>
              add("filter", "Filter Predictions", "Class + confidence")
            }
          >
            <SlidersHorizontal />
            Filter predictions
          </button>
          <button
            onClick={() =>
              add("branch", "Conditional Branch", "Count threshold")
            }
          >
            <Workflow />
            Conditional branch
          </button>
          <button
            onClick={() => add("count", "Count Objects", "Group by class")}
          >
            <BarChart3 />
            Count objects
          </button>
          <button onClick={() => add("webhook", "Webhook", "POST results")}>
            <Network />
            Webhook
          </button>
          <p>MODEL PROJECT</p>
          <select
            className="workflow-select"
            value={nodes.find((n) => n.type === "model")?.projectId || ""}
            onChange={(e) =>
              setNodes((n) =>
                n.map((node) =>
                  node.type === "model"
                    ? { ...node, projectId: e.target.value }
                    : node,
                ),
              )
            }
          >
            <option value="">Latest ready model</option>
            {projects
              .filter((p) => p.models.some((m) => m.status === "ready"))
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <div className="workflow-connections">
            <p>CONNECTIONS</p>
            <select
              value={edgeFrom}
              onChange={(event) => setEdgeFrom(event.target.value)}
            >
              <option value="">From block</option>
              {nodes.map((node) => (
                <option value={node.id} key={node.id}>
                  {node.title}
                </option>
              ))}
            </select>
            <select
              value={edgeTo}
              onChange={(event) => setEdgeTo(event.target.value)}
            >
              <option value="">To block</option>
              {nodes.map((node) => (
                <option value={node.id} key={node.id}>
                  {node.title}
                </option>
              ))}
            </select>
            <select
              value={edgeCondition}
              onChange={(event) =>
                setEdgeCondition(event.target.value as "" | "true" | "false")
              }
            >
              <option value="">Always</option>
              <option value="true">When branch is true</option>
              <option value="false">When branch is false</option>
            </select>
            <button onClick={addEdge} disabled={!edgeFrom || !edgeTo}>
              Add connection
            </button>
            {!!edges.length && (
              <div className="connection-list">
                {edges.map((edge, index) => (
                  <div
                    className="connection-item"
                    key={`${edge.from}-${edge.to}-${index}`}
                  >
                    <div>
                      <span>
                        {nodes.find((node) => node.id === edge.from)?.title ||
                          edge.from}
                      </span>
                      <ChevronRight />
                      <span>
                        {nodes.find((node) => node.id === edge.to)?.title ||
                          edge.to}
                      </span>
                    </div>
                    {edge.condition && <small>Branch: {edge.condition}</small>}
                    <button
                      aria-label="Remove connection"
                      title="Remove connection"
                      onClick={() =>
                        setEdges((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      <X />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {!!validationErrors.length && (
            <div className="workflow-validation">
              <b>Needs attention</b>
              {validationErrors.map((message) => (
                <small key={message}>{message}</small>
              ))}
            </div>
          )}
          {selectedNode && (
            <div className="workflow-node-editor">
              <p>SELECTED BLOCK</p>
              <label>
                Title
                <input
                  value={selectedNode.title}
                  onChange={(event) =>
                    setNodes((current) =>
                      current.map((node) =>
                        node.id === selectedNode.id
                          ? { ...node, title: event.target.value }
                          : node,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Description
                <input
                  value={selectedNode.subtitle}
                  onChange={(event) =>
                    setNodes((current) =>
                      current.map((node) =>
                        node.id === selectedNode.id
                          ? { ...node, subtitle: event.target.value }
                          : node,
                      ),
                    )
                  }
                />
              </label>
              {selectedNode.type === "model" && (
                <label>
                  Project
                  <select
                    value={selectedNode.projectId || ""}
                    onChange={(event) =>
                      setNodes((current) =>
                        current.map((node) =>
                          node.id === selectedNode.id
                            ? { ...node, projectId: event.target.value }
                            : node,
                        ),
                      )
                    }
                  >
                    <option value="">Latest ready model</option>
                    {projects
                      .filter((item) =>
                        item.models.some((model) => model.status === "ready"),
                      )
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>
          )}
          {result && (
            <div className="workflow-result">
              <Check />
              <b>Run completed</b>
              {Object.entries(result.counts).map(([key, value]) => (
                <span key={key}>
                  {key}
                  <strong>{value}</strong>
                </span>
              ))}
              {!Object.keys(result.counts).length && (
                <small>No objects above threshold.</small>
              )}
            </div>
          )}
          {!!runs.length && (
            <div className="workflow-runs">
              <p>RECENT RUNS</p>
              {runs.slice(0, 5).map((runItem) => (
                <span key={runItem.id}>
                  <b>{runItem.status}</b>
                  <small>
                    {runItem.predictions} predictions · {runItem.durationMs} ms
                  </small>
                </span>
              ))}
            </div>
          )}
        </aside>
        <div className="board" ref={board}>
          <svg>
            {edges.map((edge, i) => {
              const from = nodes.find((n) => n.id === edge.from),
                to = nodes.find((n) => n.id === edge.to);
              return from && to ? (
                <path
                  key={i}
                  d={`M ${from.x + 210} ${from.y + 45} C ${from.x + 250} ${from.y + 45},${to.x - 40} ${to.y + 45},${to.x} ${to.y + 45}`}
                />
              ) : null;
            })}
          </svg>
          {nodes.map((node) => (
            <div
              className={`wf-node draggable ${selectedNodeId === node.id ? "selected" : ""}`}
              style={{ left: node.x, top: node.y }}
              key={node.id}
              onPointerDown={(e) => {
                const r = board.current!.getBoundingClientRect();
                e.currentTarget.setPointerCapture(e.pointerId);
                setDrag({
                  id: node.id,
                  dx: e.clientX - r.left - node.x,
                  dy: e.clientY - r.top - node.y,
                });
              }}
              onPointerMove={(e) => {
                if (!drag || drag.id !== node.id) return;
                const r = board.current!.getBoundingClientRect();
                setNodes((n) =>
                  n.map((item) =>
                    item.id === node.id
                      ? {
                          ...item,
                          x: Math.max(
                            0,
                            Math.min(
                              r.width - 215,
                              e.clientX - r.left - drag.dx,
                            ),
                          ),
                          y: Math.max(
                            0,
                            Math.min(
                              r.height - 95,
                              e.clientY - r.top - drag.dy,
                            ),
                          ),
                        }
                      : item,
                  ),
                );
              }}
              onPointerUp={() => setDrag(null)}
              onClick={() => setSelectedNodeId(node.id)}
            >
              <div>
                <span>{icon(node.type)}</span>
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => remove(node.id)}
                  title="Remove block"
                >
                  <X />
                </button>
              </div>
              <b>{node.title}</b>
              <small>{node.subtitle}</small>
              <i className="port in" />
              <i className="port out" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CreateProject({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (p: Project) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("Object Detection");
  const [desc, setDesc] = useState("");
  const submit = () => {
    if (!name.trim()) return;
    onCreate({
      id:
        name.toLowerCase().replace(/[^a-z0-9]+/g, "-") +
        "-" +
        uid().slice(0, 3),
      name,
      type,
      description: desc || `A ${type.toLowerCase()} computer vision project.`,
      createdAt: new Date().toISOString().slice(0, 10),
      classes: ["object"],
      colors: { object: CLASS_PALETTE[0] },
      assets: [],
      versions: [],
      models: [],
    });
  };
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="modal-icon">
              <FolderKanban />
            </span>
            <h2>Create a project</h2>
            <p>Set up a new computer vision dataset.</p>
          </div>
          <button className="icon ghost" onClick={onClose}>
            <X />
          </button>
        </div>
        <label>
          Project name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Quality inspection"
          />
        </label>
        <label>
          Project type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option>Object Detection</option>
            <option>Single-Label Classification</option>
            <option>Multi-Label Classification</option>
            <option>Instance Segmentation</option>
            <option>Semantic Segmentation</option>
            <option>Oriented Bounding Box</option>
            <option>Keypoint Detection</option>
          </select>
        </label>
        <label>
          Description
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="What will this project detect?"
          />
        </label>
        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!name.trim()} onClick={submit}>
            Create project <ChevronRight />
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectInsights({
  project,
  go,
  notify,
}: {
  project: Project;
  go: (page: Page) => void;
  notify: (message: string) => void;
}) {
  const [health, setHealth] = useState<DatasetHealth | null>(null);
  const [jobs, setJobs] = useState<AnnotationJob[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [queue, setQueue] = useState<ActiveLearningItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const load = async () => {
    const [jobItems, memberItems, active] = await Promise.all([
      api.annotationJobs(project.id),
      api.members(),
      api.activeLearning(project.id),
    ]);
    setJobs(jobItems);
    setMembers(memberItems);
    setQueue(active.items);
    setScanning(active.scanning);
  };
  const scanHealth = async () => {
    setLoadingHealth(true);
    try {
      setHealth(await api.datasetHealth(project.id));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Dataset scan gagal");
    } finally {
      setLoadingHealth(false);
    }
  };
  useEffect(() => {
    load().catch(() => {});
    scanHealth();
  }, [project.id]);
  useEffect(() => {
    if (!scanning) return;
    const timer = window.setInterval(() => load().catch(() => {}), 2500);
    return () => window.clearInterval(timer);
  }, [scanning, project.id]);
  const createJob = async () => {
    const candidates =
      health?.issues.map((item) => item.assetId) ||
      project.assets
        .filter((asset) => asset.status === "unannotated")
        .map((asset) => asset.id);
    if (!candidates.length) {
      notify("Tidak ada asset yang membutuhkan pekerjaan anotasi");
      return;
    }
    const name = prompt("Nama annotation job", "Dataset cleanup")?.trim();
    if (!name) return;
    const assignee =
      members.find((member) => member.role === "annotator") || members[0];
    await api.createAnnotationJob(project.id, {
      name,
      assignee_id: assignee?.id,
      asset_ids: candidates,
    });
    await load();
    notify(`${candidates.length} asset dimasukkan ke annotation job`);
  };
  const openAsset = (assetId: string) => {
    localStorage.setItem(`vf-annotate-${project.id}`, assetId);
    go("annotate");
  };
  return (
    <div className="content insights-page">
      <ProjectTabs active="insights" go={go} />
      <div className="project-title">
        <div>
          <span className="eyebrow">DATASET OPERATIONS</span>
          <h1>Health, jobs & active learning</h1>
          <p>
            Find data problems, distribute annotation work, and prioritize
            uncertain samples.
          </p>
        </div>
        <button
          className="secondary"
          disabled={loadingHealth}
          onClick={scanHealth}
        >
          <Activity /> {loadingHealth ? "Scanning…" : "Rescan dataset"}
        </button>
      </div>
      {health && (
        <div className="health-summary">
          <section className="panel health-score">
            <strong>{health.score}</strong>
            <span>
              <b>Dataset health</b>
              <small>
                {health.issueAssets} of {health.assets} assets need attention
              </small>
            </span>
          </section>
          <section className="panel">
            <b>{health.duplicateGroups.length}</b>
            <small>Duplicate groups</small>
          </section>
          <section className="panel">
            <b>{health.imbalanceRatio || "—"}</b>
            <small>Class imbalance ratio</small>
          </section>
          <section className="panel">
            <b>{health.averageBlurScore}</b>
            <small>Average sharpness</small>
          </section>
        </div>
      )}
      <div className="insights-grid">
        <section className="panel health-issues">
          <div className="panel-head">
            <div>
              <h2>Dataset issues</h2>
              <p>
                Duplicates, blur, resolution, labels, and annotation outliers.
              </p>
            </div>
            <button className="primary small" onClick={createJob}>
              <Plus />
              Create cleanup job
            </button>
          </div>
          {health?.issues.slice(0, 100).map((item) => (
            <button key={item.assetId} onClick={() => openAsset(item.assetId)}>
              <span>
                <b>{item.name}</b>
                <small>{item.issues.join(" · ")}</small>
              </span>
              <ChevronRight />
            </button>
          ))}
          {health && !health.issues.length && (
            <div className="zero mini">
              <Check />
              <h3>No issues detected</h3>
            </div>
          )}
        </section>
        <section className="panel annotation-jobs">
          <div className="panel-head">
            <div>
              <h2>Annotation jobs</h2>
              <p>Assignment and review progress.</p>
            </div>
            <CheckSquare />
          </div>
          {jobs.map((job) => (
            <article key={job.id}>
              <header>
                <span>
                  <b>{job.name}</b>
                  <small>{job.assigneeName || "Unassigned"}</small>
                </span>
                <select
                  value={job.status}
                  onChange={async (event) => {
                    await api.updateAnnotationJob(
                      project.id,
                      job.id,
                      event.target.value,
                    );
                    await load();
                  }}
                >
                  <option value="open">Open</option>
                  <option value="in-progress">In progress</option>
                  <option value="review">Review</option>
                  <option value="completed">Completed</option>
                </select>
              </header>
              <div className="job-meter">
                <i
                  style={{
                    width: `${job.total ? (job.completed / job.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <footer>
                <span>
                  {job.completed}/{job.total} annotated
                </span>
                <span>{job.approved} approved</span>
              </footer>
            </article>
          ))}
          {!jobs.length && <p>No annotation jobs yet.</p>}
        </section>
      </div>
      <section className="panel active-learning-panel">
        <div className="panel-head">
          <div>
            <h2>Active Learning</h2>
            <p>
              Use a ready YOLO model to prioritize uncertain, unannotated
              images.
            </p>
          </div>
          <button
            className="primary small"
            disabled={
              scanning ||
              !project.models.some((model) => model.status === "ready")
            }
            onClick={async () => {
              try {
                await api.startActiveLearning(project.id, {
                  limit: 100,
                  confidence: 0.5,
                });
                setScanning(true);
                notify("Active-learning scan dimulai");
              } catch (error) {
                notify(error instanceof Error ? error.message : "Scan gagal");
              }
            }}
          >
            <Sparkles />
            {scanning ? "Scanning…" : "Scan uncertain images"}
          </button>
        </div>
        <div className="active-learning-list">
          {queue
            .filter((item) => item.status === "pending")
            .map((item) => (
              <div key={item.id}>
                <strong>{Math.round(item.score * 100)}</strong>
                <span>
                  <b>{item.name}</b>
                  <small>{item.reason}</small>
                </span>
                <button onClick={() => openAsset(item.assetId)}>
                  Annotate
                </button>
                <button
                  onClick={async () => {
                    await api.updateActiveLearning(
                      project.id,
                      item.id,
                      "dismissed",
                    );
                    await load();
                  }}
                >
                  Dismiss
                </button>
              </div>
            ))}
          {!queue.some((item) => item.status === "pending") && (
            <p>No pending samples. Run a scan after a model is ready.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function DatasetVersions({
  project,
  go,
  update,
  notify,
}: {
  project: Project;
  go: (p: Page) => void;
  update: (fn: (p: Project) => Project) => void;
  notify: (s: string) => void;
}) {
  const [resize, setResize] = useState(640);
  const [augment, setAugment] = useState(true);
  const [copies, setCopies] = useState(2);
  const [splits, setSplits] = useState<[number, number, number]>([70, 20, 10]);
  const [recipe, setRecipe] =
    useState<AugmentationRecipe>(defaultAugmentations);
  const [generating, setGenerating] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [versionDiffs, setVersionDiffs] = useState<
    Record<
      string,
      {
        added: string[];
        removed: string[];
        changed: string[];
        unchanged: number;
      }
    >
  >({});
  const previewAsset = project.assets[0];
  const enabledCount = Object.values(recipe).filter(
    (setting) => setting.enabled,
  ).length;
  const estimatedTrain = Math.round((project.assets.length * splits[0]) / 100);
  const estimatedTotal =
    project.assets.length + (augment ? estimatedTrain * copies : 0);
  const changeSetting = (
    key: string,
    patch: Partial<AugmentationRecipe[string]>,
  ) =>
    setRecipe((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
  const preset = (name: "balanced" | "geometry" | "lowlight" | "none") => {
    const next = defaultAugmentations();
    for (const option of AUGMENTATION_OPTIONS) {
      if (name === "none") next[option.key].enabled = false;
      if (name === "geometry")
        next[option.key].enabled = option.group === "Geometry";
      if (name === "lowlight")
        next[option.key].enabled = [
          "brightness",
          "contrast",
          "blur",
          "noise",
          "jpeg",
        ].includes(option.key);
    }
    setRecipe(next);
    setAugment(name !== "none");
  };
  const changeSplit = (index: number, value: number) =>
    setSplits(
      (current) =>
        current.map((item, i) =>
          i === index ? Math.max(0, Math.min(100, value)) : item,
        ) as [number, number, number],
    );
  const generate = async () => {
    if (splits.reduce((sum, value) => sum + value, 0) !== 100) {
      notify("Train, valid, dan test harus berjumlah 100%");
      return;
    }
    if (augment && !enabledCount) {
      notify("Aktifkan minimal satu transformasi atau matikan augmentasi");
      return;
    }
    setGenerating(true);
    try {
      const saved = await api.version(project.id, {
        resize,
        augment,
        splits,
        augmentations: recipe,
        augmentation_copies: copies,
      });
      update(() => saved);
      notify(`Dataset version dibuat: sekitar ${estimatedTotal} gambar`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Gagal membuat version");
    } finally {
      setGenerating(false);
    }
  };
  const reuseVersion = (version: Project["versions"][number]) => {
    setResize(version.resize);
    setAugment(version.augment);
    setSplits(version.splits);
    setCopies(version.augmentations?.copies || 1);
    setRecipe({
      ...defaultAugmentations(),
      ...(version.augmentations?.transforms || {}),
    });
    notify(`Recipe v${version.number} dimuat ke editor`);
  };
  const editVersion = async (version: Project["versions"][number]) => {
    const name = prompt(
      "Nama version",
      version.name || `Version ${version.number}`,
    )?.trim();
    if (!name) return;
    const notes =
      prompt("Catatan version", version.notes || "") ?? version.notes ?? "";
    const tags = (
      prompt("Tags (pisahkan dengan koma)", (version.tags || []).join(", ")) ||
      ""
    )
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    try {
      const saved = await api.updateVersion(project.id, version.id, {
        name,
        notes,
        tags,
      });
      update(() => saved);
      notify("Metadata version diperbarui");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Gagal memperbarui version",
      );
    }
  };
  const toggleCompare = (id: string) =>
    setCompareIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current.slice(-1), id],
    );
  const inspectDiff = async (versionId: string) => {
    try {
      const diff = await api.versionDiff(project.id, versionId);
      setVersionDiffs((current) => ({ ...current, [versionId]: diff }));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Version diff gagal");
    }
  };
  const rollback = async (version: Project["versions"][number]) => {
    if (
      !confirm(
        `Kembalikan annotations dan splits ke v${version.number}? Metadata saat ini akan ditimpa.`,
      )
    )
      return;
    try {
      const saved = await api.rollbackVersion(project.id, version.id);
      update(() => saved);
      notify(`Dataset dikembalikan ke snapshot v${version.number}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Rollback gagal");
    }
  };
  const compared = compareIds
    .map((id) => project.versions.find((version) => version.id === id))
    .filter(Boolean) as Project["versions"];
  return (
    <div className="content versions-page">
      <ProjectTabs active="versions" go={go} />
      <div className="project-title">
        <div>
          <span className="eyebrow">REPRODUCIBLE DATASET PIPELINE</span>
          <h1>Dataset versions</h1>
          <p>
            Configure preprocessing, split, and box-aware augmentation recipes.
          </p>
        </div>
        <div className="version-estimate">
          <Sparkles />
          <span>
            <b>~{estimatedTotal}</b>
            <small>output images</small>
          </span>
        </div>
      </div>
      <div className="version-layout">
        <div className="version-main">
          <section className="panel version-section">
            <div className="version-section-head">
              <span>1</span>
              <div>
                <h2>Source & split</h2>
                <p>
                  {project.assets.length} source images ·{" "}
                  {
                    project.assets.filter((a) => a.status === "annotated")
                      .length
                  }{" "}
                  annotated
                </p>
              </div>
            </div>
            <div className="split-editor">
              {(["Train", "Valid", "Test"] as const).map((name, index) => (
                <label key={name}>
                  <span>
                    {name}
                    <i className={name.toLowerCase()} />
                  </span>
                  <div>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={splits[index]}
                      onChange={(e) => changeSplit(index, +e.target.value)}
                    />
                    <b>%</b>
                  </div>
                </label>
              ))}
            </div>
            <div className="split-preview">
              <i style={{ width: splits[0] + "%" }} />
              <i style={{ width: splits[1] + "%" }} />
              <i style={{ width: splits[2] + "%" }} />
            </div>
            <p
              className={
                "split-total " +
                (splits.reduce((a, b) => a + b, 0) === 100
                  ? "valid"
                  : "invalid")
              }
            >
              Total: {splits.reduce((a, b) => a + b, 0)}%{" "}
              {splits.reduce((a, b) => a + b, 0) === 100
                ? "✓"
                : "— must equal 100%"}
            </p>
          </section>
          <section className="panel version-section">
            <div className="version-section-head">
              <span>2</span>
              <div>
                <h2>Preprocessing</h2>
                <p>Applied consistently before augmentation.</p>
              </div>
            </div>
            <div className="preprocess-grid">
              <div className="preprocess-card">
                <Check />
                <span>
                  <b>Auto-orient</b>
                  <small>Normalize EXIF orientation</small>
                </span>
              </div>
              <label className="preprocess-card">
                <ImageIcon />
                <span>
                  <b>Square resize</b>
                  <small>High-quality Lanczos resampling</small>
                </span>
                <select
                  value={resize}
                  onChange={(e) => setResize(+e.target.value)}
                >
                  <option value="416">416 px</option>
                  <option value="640">640 px</option>
                  <option value="1024">1024 px</option>
                  <option value="1280">1280 px</option>
                </select>
              </label>
            </div>
            {previewAsset && (
              <div className="preprocess-preview">
                <figure>
                  <img src={previewAsset.src} />
                  <figcaption>Original</figcaption>
                </figure>
                <figure className="square-preview">
                  <img src={previewAsset.src} />
                  <figcaption>
                    {resize} × {resize} preview
                  </figcaption>
                </figure>
              </div>
            )}
          </section>
          <section className="panel version-section augment-panel">
            <div className="version-section-head">
              <span>3</span>
              <div>
                <h2>Augmentation studio</h2>
                <p>
                  Each generated copy samples enabled transforms independently.
                </p>
              </div>
              <label className="master-switch">
                <input
                  type="checkbox"
                  checked={augment}
                  onChange={(e) => setAugment(e.target.checked)}
                />
                <i />
              </label>
            </div>
            <div
              className={"augmentation-content " + (!augment ? "disabled" : "")}
            >
              <div className="augment-toolbar">
                <div className="preset-buttons">
                  <button onClick={() => preset("balanced")}>Balanced</button>
                  <button onClick={() => preset("geometry")}>Geometry</button>
                  <button onClick={() => preset("lowlight")}>Low light</button>
                  <button onClick={() => preset("none")}>Clear</button>
                </div>
                <label>
                  Copies per train image
                  <select
                    value={copies}
                    onChange={(e) => setCopies(+e.target.value)}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => (
                      <option key={value} value={value}>
                        {value}×
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {(
                ["Geometry", "Color & lighting", "Quality & occlusion"] as const
              ).map((group) => (
                <div className="augment-group" key={group}>
                  <h3>
                    {group}
                    <span>
                      {
                        AUGMENTATION_OPTIONS.filter(
                          (option) =>
                            option.group === group &&
                            recipe[option.key].enabled,
                        ).length
                      }{" "}
                      enabled
                    </span>
                  </h3>
                  <div className="augment-list">
                    {AUGMENTATION_OPTIONS.filter(
                      (option) => option.group === group,
                    ).map((option) => {
                      const setting = recipe[option.key];
                      return (
                        <div
                          className={
                            "augment-row " + (setting.enabled ? "enabled" : "")
                          }
                          key={option.key}
                        >
                          <label className="augment-check">
                            <input
                              type="checkbox"
                              checked={setting.enabled}
                              onChange={(e) =>
                                changeSetting(option.key, {
                                  enabled: e.target.checked,
                                })
                              }
                            />
                            <i>
                              <Check />
                            </i>
                          </label>
                          <div className="augment-copy">
                            <b>{option.name}</b>
                            <small>{option.description}</small>
                          </div>
                          <label className="augment-control">
                            <span>
                              Probability{" "}
                              <b>{Math.round(setting.probability * 100)}%</b>
                            </span>
                            <input
                              type="range"
                              min="0.05"
                              max="1"
                              step="0.05"
                              value={setting.probability}
                              onChange={(e) =>
                                changeSetting(option.key, {
                                  probability: +e.target.value,
                                })
                              }
                            />
                          </label>
                          {option.max > 0 ? (
                            <label className="augment-control">
                              <span>
                                Magnitude{" "}
                                <b>
                                  {setting.amount}
                                  {option.unit}
                                </b>
                              </span>
                              <input
                                type="range"
                                min={option.min}
                                max={option.max}
                                step={"step" in option ? option.step : 1}
                                value={setting.amount}
                                onChange={(e) =>
                                  changeSetting(option.key, {
                                    amount: +e.target.value,
                                  })
                                }
                              />
                            </label>
                          ) : (
                            <div className="augment-fixed">BOX SAFE</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <button
            className="primary generate-version"
            disabled={generating || !project.assets.length}
            onClick={generate}
          >
            <FlaskConical />
            {generating ? "Generating files…" : "Generate immutable version"}
            <span>
              {enabledCount} transforms · ~{estimatedTotal} outputs
            </span>
          </button>
        </div>
        <aside className="version-side">
          <section className="panel">
            <h3>Version history</h3>
            {[...project.versions].reverse().map((v) => {
              const transforms = Object.values(
                v.augmentations?.transforms || {},
              ).filter((setting) => setting.enabled).length;
              return (
                <div className="version-history-card" key={v.id}>
                  <div className="version-history-head">
                    <span>v{v.number}</span>
                    <div>
                      <b>{v.generatedImages || v.images} output images</b>
                      <small>
                        {v.images} sources · {v.resize}px
                      </small>
                    </div>
                  </div>
                  <div className="recipe-summary">
                    <span>
                      {v.augment
                        ? `${transforms || 2} transforms`
                        : "No augmentation"}
                    </span>
                    <span>{v.createdAt}</span>
                  </div>
                  {v.notes && <p className="version-notes">{v.notes}</p>}
                  {!!v.tags?.length && (
                    <div className="version-tags">
                      {v.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  )}
                  <div className="version-actions">
                    <button onClick={() => reuseVersion(v)}>
                      Reuse recipe
                    </button>
                    <button onClick={() => editVersion(v)}>Edit</button>
                    <button
                      className={compareIds.includes(v.id) ? "active" : ""}
                      onClick={() => toggleCompare(v.id)}
                    >
                      Compare
                    </button>
                    <button onClick={() => inspectDiff(v.id)}>Diff</button>
                    <button onClick={() => rollback(v)}>Rollback</button>
                    <a href={api.exportUrl(project.id, v.id, "yolo")} download>
                      YOLO ZIP
                    </a>
                    <a href={api.exportUrl(project.id, v.id, "coco")} download>
                      COCO ZIP
                    </a>
                  </div>
                  {versionDiffs[v.id] && (
                    <div className="version-diff-summary">
                      <span>+{versionDiffs[v.id].added.length} added</span>
                      <span>~{versionDiffs[v.id].changed.length} changed</span>
                      <span>-{versionDiffs[v.id].removed.length} removed</span>
                      <span>{versionDiffs[v.id].unchanged} unchanged</span>
                    </div>
                  )}
                </div>
              );
            })}
            {!project.versions.length && (
              <div className="empty-versions">
                <Database />
                <b>No versions yet</b>
                <span>Your immutable snapshots will appear here.</span>
              </div>
            )}
            {compared.length === 2 && (
              <div className="version-compare">
                <h4>Version comparison</h4>
                <div>
                  {compared.map((version) => (
                    <span key={version.id}>
                      <b>{version.name || `v${version.number}`}</b>
                      <small>
                        {version.generatedImages || version.images} images
                      </small>
                      <small>
                        {version.resize}px ·{" "}
                        {version.augment
                          ? `${version.augmentations?.copies || 1} copies`
                          : "no augment"}
                      </small>
                      <small>{version.splits.join(" / ")} split</small>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </section>
          <section className="panel recipe-info">
            <h3>Box-aware pipeline</h3>
            <p>
              Flip, rotation, translation, shear, and crop transform every
              bounding box. Boxes are clipped to image bounds and invalid boxes
              are removed.
            </p>
            <dl>
              <div>
                <dt>Source images</dt>
                <dd>{project.assets.length}</dd>
              </div>
              <div>
                <dt>Train originals</dt>
                <dd>{estimatedTrain}</dd>
              </div>
              <div>
                <dt>Augmented copies</dt>
                <dd>{augment ? estimatedTrain * copies : 0}</dd>
              </div>
              <div>
                <dt>Enabled transforms</dt>
                <dd>{augment ? enabledCount : 0}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

function DatasetTrain({
  project,
  go,
  update,
  notify,
}: {
  project: Project;
  go: (p: Page) => void;
  update: (fn: (p: Project) => Project) => void;
  notify: (s: string) => void;
}) {
  const trainingTask: "detect" | "segment" | "pose" | "obb" | "cls" =
    project.type.includes("Segmentation")
      ? "segment"
      : project.type === "Keypoint Detection"
        ? "pose"
        : project.type === "Oriented Bounding Box"
          ? "obb"
          : project.type.includes("Classification")
            ? "cls"
            : "detect";
  const [architecture, setArchitecture] = useState(
    trainingTask === "detect"
      ? "yolo26n.pt"
      : trainingTask === "segment"
        ? "yolo26n-seg.pt"
        : `yolo11n-${trainingTask}.pt`,
  );
  const [versionId, setVersionId] = useState(project.versions.at(-1)?.id || "");
  const [epochs, setEpochs] = useState(20);
  const [imageSize, setImageSize] = useState(640);
  const [batchSize, setBatchSize] = useState(16);
  const [optimizer, setOptimizer] = useState("auto");
  const [learningRate, setLearningRate] = useState(0.01);
  const [patience, setPatience] = useState(50);
  const [device, setDevice] = useState("auto");
  const [executionTarget, setExecutionTarget] = useState<
    "server" | "remote-auto" | "remote-gpu" | "remote-cpu"
  >("server");
  const [workerId, setWorkerId] = useState("");
  const [workers, setWorkers] = useState<TrainingWorker[]>([]);
  const [workerToken, setWorkerToken] = useState("");
  const [starting, setStarting] = useState(false);
  // Use the browser origin so laptop workers go through the same Vite/NAS
  // proxy as the UI. The API itself remains private on localhost in dev mode.
  const workerServer = window.location.origin;
  const workerCommand = workerToken
    ? `$env:VISIONFLOW_WORKER_TOKEN="${workerToken}"; python worker/visionflow_worker.py --server "${workerServer}"`
    : "";
  const active = project.models.some(
    (model) => model.status === "training" || model.status === "queued",
  );
  useEffect(() => {
    if (!active) return;
    const poll = window.setInterval(async () => {
      try {
        const fresh = await api.project(project.id);
        update(() => fresh);
      } catch {}
    }, 2000);
    return () => window.clearInterval(poll);
  }, [active, project.id]);
  useEffect(() => {
    if (
      versionId &&
      !project.versions.some((version) => version.id === versionId)
    )
      setVersionId(project.versions.at(-1)?.id || "");
  }, [project.versions, versionId]);
  useEffect(() => {
    const refresh = () =>
      api
        .trainingWorkers()
        .then(setWorkers)
        .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(timer);
  }, []);
  const createWorker = async () => {
    const name = prompt("Nama laptop worker", "Training Laptop")?.trim();
    if (!name) return;
    try {
      const worker = await api.createTrainingWorker(name);
      setWorkers((current) => [worker, ...current]);
      setWorkerId(worker.id);
      setWorkerToken(worker.token);
      await navigator.clipboard.writeText(worker.token).catch(() => {});
      notify(
        "Token worker dibuat dan disalin. Token hanya ditampilkan sekali.",
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Gagal membuat worker");
    }
  };
  const downloadWorkerSetup = () => {
    if (!workerToken) return;
    const quote = (value: string) => value.replace(/'/g, "''");
    const script = `# VisionFlow laptop worker setup
# This file was generated by VisionFlow. Keep it private because it contains a one-time worker token.
$ErrorActionPreference = "Stop"
$server = '${quote(workerServer)}'
$token = '${quote(workerToken)}'
$workerRoot = Join-Path $env:USERPROFILE "VisionFlowWorker"
$rawBase = "https://raw.githubusercontent.com/Aqshalikhsan/vision-flow/feature/advanced-platform-suite/worker"

New-Item -ItemType Directory -Force -Path (Join-Path $workerRoot "worker") | Out-Null
Invoke-WebRequest -UseBasicParsing "$rawBase/visionflow_worker.py" -OutFile (Join-Path $workerRoot "worker/visionflow_worker.py")
Invoke-WebRequest -UseBasicParsing "$rawBase/requirements.txt" -OutFile (Join-Path $workerRoot "worker/requirements.txt")

$venvPython = Join-Path $workerRoot ".venv/Scripts/python.exe"
if (!(Test-Path $venvPython)) {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 -m venv (Join-Path $workerRoot ".venv")
  } elseif (Get-Command python -ErrorAction SilentlyContinue) {
    & python -m venv (Join-Path $workerRoot ".venv")
  } else {
    throw "Python 3 tidak ditemukan. Install Python 3.10+ dari python.org lalu jalankan ulang file ini."
  }
}
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r (Join-Path $workerRoot "worker/requirements.txt")
Write-Host "Worker siap. Menghubungkan ke $server ..." -ForegroundColor Green
& $venvPython (Join-Path $workerRoot "worker/visionflow_worker.py") --server $server --token $token
`;
    const url = URL.createObjectURL(
      new Blob([script], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "visionflow-worker-setup.ps1";
    anchor.click();
    URL.revokeObjectURL(url);
    notify(
      "Setup worker diunduh. Jalankan di laptop target dengan PowerShell.",
    );
  };
  const downloadUnixWorkerSetup = () => {
    if (!workerToken) return;
    const quote = (value: string) => value.replace(/'/g, "'\"'\"'");
    const script = [
      "#!/usr/bin/env bash",
      "# VisionFlow laptop worker setup - keep this file private.",
      "set -euo pipefail",
      "server='" + quote(workerServer) + "'",
      "token='" + quote(workerToken) + "'",
      'worker_root="$HOME/VisionFlowWorker"',
      'raw_base="https://raw.githubusercontent.com/Aqshalikhsan/vision-flow/feature/advanced-platform-suite/worker"',
      'mkdir -p "$worker_root/worker"',
      'curl -fsSL "$raw_base/visionflow_worker.py" -o "$worker_root/worker/visionflow_worker.py"',
      'curl -fsSL "$raw_base/requirements.txt" -o "$worker_root/worker/requirements.txt"',
      'command -v python3 >/dev/null 2>&1 || { echo "Python 3.10+ tidak ditemukan."; exit 1; }',
      'if [ ! -x "$worker_root/.venv/bin/python" ]; then python3 -m venv "$worker_root/.venv"; fi',
      '"$worker_root/.venv/bin/python" -m pip install --upgrade pip',
      '"$worker_root/.venv/bin/python" -m pip install -r "$worker_root/worker/requirements.txt"',
      'echo "Worker siap. Menghubungkan ke $server ..."',
      'exec "$worker_root/.venv/bin/python" "$worker_root/worker/visionflow_worker.py" --server "$server" --token "$token"',
      "",
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([script], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "visionflow-worker-setup.sh";
    anchor.click();
    URL.revokeObjectURL(url);
    notify("Setup Linux/macOS diunduh");
  };
  const start = async () => {
    if (!versionId) {
      notify("Buat dan pilih dataset version terlebih dahulu");
      return;
    }
    if (
      executionTarget !== "server" &&
      !workers.some((worker) => !worker.revoked)
    ) {
      notify("Buat token laptop worker terlebih dahulu");
      return;
    }
    setStarting(true);
    try {
      const saved = await api.train(project.id, {
        architecture,
        epochs,
        image_size: imageSize,
        version_id: versionId,
        batch_size: batchSize,
        optimizer,
        learning_rate: learningRate,
        patience,
        device,
        execution_target: executionTarget,
        worker_id: workerId || undefined,
      });
      update(() => saved);
      notify("Training dimulai menggunakan dataset version yang dipilih");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Training gagal dimulai");
    } finally {
      setStarting(false);
    }
  };
  const startSweep = async () => {
    if (!versionId) return notify("Pilih dataset version terlebih dahulu");
    if (
      executionTarget !== "server" &&
      !workers.some((worker) => !worker.revoked)
    )
      return notify("Buat token laptop worker terlebih dahulu");
    const rates = (
      prompt("Learning rates (pisahkan koma, maksimum 4)", "0.01, 0.001") || ""
    )
      .split(",")
      .map(Number)
      .filter((value) => value > 0 && value <= 1)
      .slice(0, 4);
    const optimizers = (
      prompt("Optimizers (auto, SGD, Adam, AdamW)", "auto, AdamW") || ""
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 4);
    if (
      !rates.length ||
      !optimizers.length ||
      rates.length * optimizers.length > 8
    ) {
      notify("Sweep membutuhkan 1–8 kombinasi valid");
      return;
    }
    setStarting(true);
    try {
      const saved = await api.trainSweep(project.id, {
        base: {
          architecture,
          epochs,
          image_size: imageSize,
          version_id: versionId,
          batch_size: batchSize,
          optimizer,
          learning_rate: learningRate,
          patience,
          device,
          execution_target: executionTarget,
          worker_id: workerId || undefined,
        },
        learning_rates: rates,
        optimizers,
      });
      update(() => saved);
      notify(
        `${rates.length * optimizers.length} eksperimen dimasukkan ke training queue`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : "Sweep gagal dimulai");
    } finally {
      setStarting(false);
    }
  };
  const removeVersion = async () => {
    const selected = project.versions.find(
      (version) => version.id === versionId,
    );
    if (
      !selected ||
      !confirm(
        `Hapus dataset version v${selected.number} beserta file hasil augmentasinya?`,
      )
    )
      return;
    try {
      await api.deleteVersion(project.id, selected.id);
      const fresh = await api.project(project.id);
      update(() => fresh);
      setVersionId(fresh.versions.at(-1)?.id || "");
      notify(`Version v${selected.number} dihapus`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Gagal menghapus version");
    }
  };
  const architectures = YOLO_MODELS.filter(
    (model) => model.task === trainingTask,
  ).map((model, index) => ({
    id: model.id,
    name: `${model.family} ${model.size}`,
    note: model.note,
    tone: ["purple", "blue", "green"][index % 3],
  }));
  return (
    <div className="content train-page">
      <ProjectTabs active="train" go={go} />
      <div className="project-title">
        <div>
          <span className="eyebrow">LOCAL MODEL TRAINING</span>
          <h1>Train a detection model</h1>
          <p>Select an immutable dataset version and tune the training run.</p>
        </div>
        {active && (
          <span className="training-live">
            <i />
            Training active
          </span>
        )}
      </div>
      <div className="train-grid">
        <section className="panel">
          <h2>1. Architecture</h2>
          <p className="muted">
            Choose the speed and accuracy profile for this run.
          </p>
          <div className="architecture-catalog">
            {architectures.map((item) => (
              <button
                className={
                  "model-option " + (architecture === item.id ? "active" : "")
                }
                onClick={() => setArchitecture(item.id)}
                key={item.id}
              >
                <span className={item.tone}>
                  <BrainCircuit />
                </span>
                <div>
                  <b>{item.name}</b>
                  <small>{item.note}</small>
                </div>
                {item.id === "yolo11n.pt" && <em>RECOMMENDED</em>}
                <i>{architecture === item.id && <Check />}</i>
              </button>
            ))}
          </div>
          <h2 className="train-step-title">2. Dataset & configuration</h2>
          <div className="training-fields">
            <label>
              Dataset version
              <select
                value={versionId}
                onChange={(e) => setVersionId(e.target.value)}
              >
                <option value="">Select a version</option>
                {[...project.versions].reverse().map((version) => (
                  <option value={version.id} key={version.id}>
                    v{version.number} ·{" "}
                    {version.generatedImages || version.images} images ·{" "}
                    {version.resize}px
                  </option>
                ))}
              </select>
            </label>
            <label>
              Epochs
              <input
                type="number"
                min="1"
                max="300"
                value={epochs}
                onChange={(e) =>
                  setEpochs(Math.max(1, Math.min(300, +e.target.value)))
                }
              />
            </label>
            <label>
              Image size
              <select
                value={imageSize}
                onChange={(e) => setImageSize(+e.target.value)}
              >
                <option value="416">416 px</option>
                <option value="640">640 px</option>
                <option value="1024">1024 px</option>
                <option value="1280">1280 px</option>
              </select>
            </label>
            <label>
              Batch size
              <input
                type="number"
                min="1"
                max="128"
                value={batchSize}
                onChange={(e) => setBatchSize(+e.target.value)}
              />
            </label>
            <label>
              Optimizer
              <select
                value={optimizer}
                onChange={(e) => setOptimizer(e.target.value)}
              >
                <option value="auto">Auto</option>
                <option>SGD</option>
                <option>Adam</option>
                <option>AdamW</option>
                <option>NAdam</option>
                <option>RAdam</option>
                <option>RMSProp</option>
              </select>
            </label>
            <label>
              Learning rate
              <input
                type="number"
                min=".00001"
                max="1"
                step=".0001"
                value={learningRate}
                onChange={(e) => setLearningRate(+e.target.value)}
              />
            </label>
            <label>
              Patience
              <input
                type="number"
                min="0"
                max="300"
                value={patience}
                onChange={(e) => setPatience(+e.target.value)}
              />
            </label>
            <label>
              Training location
              <select
                value={executionTarget}
                onChange={(event) =>
                  setExecutionTarget(
                    event.target.value as typeof executionTarget,
                  )
                }
              >
                <option value="server">NAS / web server</option>
                <option value="remote-auto">Laptop · Automatic</option>
                <option value="remote-gpu">Laptop · CUDA GPU</option>
                <option value="remote-cpu">Laptop · CPU</option>
              </select>
            </label>
            {executionTarget === "server" ? (
              <label>
                Server device
                <select
                  value={device}
                  onChange={(e) => setDevice(e.target.value)}
                >
                  <option value="auto">Auto</option>
                  <option value="cpu">CPU</option>
                  <option value="0">GPU 0</option>
                </select>
              </label>
            ) : (
              <label>
                Laptop worker
                <select
                  value={workerId}
                  onChange={(event) => setWorkerId(event.target.value)}
                >
                  <option value="">Any compatible worker</option>
                  {workers
                    .filter((worker) => !worker.revoked)
                    .map((worker) => (
                      <option value={worker.id} key={worker.id}>
                        {worker.name} · {worker.status}
                        {worker.capabilities.cuda ? " · CUDA" : ""}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </div>
          <div className="train-actions">
            <button
              className="danger-link"
              disabled={!versionId || active}
              onClick={removeVersion}
            >
              <Trash2 />
              Delete selected version
            </button>
            <button
              className="secondary"
              disabled={starting || active || !versionId}
              onClick={startSweep}
            >
              <FlaskConical /> Hyperparameter sweep
            </button>
            <button
              className="primary"
              disabled={starting || active || !versionId}
              onClick={start}
            >
              <Play />
              {starting
                ? "Starting…"
                : active
                  ? "Training in progress"
                  : "Start training"}
            </button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Training runs</h2>
              <p>Metrics and status update automatically.</p>
            </div>
            <Activity />
          </div>
          <div className="laptop-workers">
            <header>
              <div>
                <b>Laptop workers</b>
                <small>Run jobs outside the NAS and return best.pt.</small>
              </div>
              <button className="secondary" onClick={createWorker}>
                <Plus /> Add laptop
              </button>
            </header>
            {workerToken && (
              <div className="worker-token">
                <b>Hubungkan laptop training</b>
                <small>
                  Untuk laptop baru, unduh setup otomatis di bawah. Script akan
                  membuat virtual environment, memasang dependensi, lalu
                  menjalankan worker. Token hanya ditampilkan sekali.
                </small>
                <div className="worker-guide">
                  <b>Setup laptop langkah demi langkah</b>
                  <ol>
                    <li>
                      Buka web dari alamat LAN server, misalnya{" "}
                      <code>{workerServer}</code>, bukan localhost.
                    </li>
                    <li>
                      Download setup sesuai sistem operasi. Python 3.10+ dan
                      internet diperlukan pada proses pertama.
                      <span className="worker-downloads">
                        <button onClick={() => downloadWorkerSetup()}>
                          <Download /> Windows (.ps1)
                        </button>
                        <button onClick={downloadUnixWorkerSetup}>
                          <Download /> Linux / macOS (.sh)
                        </button>
                      </span>
                    </li>
                    <li>
                      Jalankan file di laptop target:
                      <code className="worker-command">
                        Windows: powershell -ExecutionPolicy Bypass -File
                        .\visionflow-worker-setup.ps1
                        <br />
                        Linux/macOS: chmod +x visionflow-worker-setup.sh &&{" "}
                        ./visionflow-worker-setup.sh
                      </code>
                    </li>
                    <li>
                      Tunggu status worker berubah menjadi <b>online</b>, lalu
                      pilih lokasi training dan klik <b>Start training</b>.
                    </li>
                  </ol>
                  <small>
                    Jangan tutup terminal worker selama training. Untuk cek
                    jaringan Windows gunakan{" "}
                    <code>Test-NetConnection SERVER -Port 5173</code>; Linux dan
                    macOS dapat memakai <code>curl SERVER</code>.
                  </small>
                </div>
                <details className="worker-manual">
                  <summary>Advanced: jalankan command manual</summary>
                  <code>{workerCommand}</code>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(workerCommand);
                      notify("Perintah worker disalin");
                    }}
                  >
                    <Copy /> Copy command
                  </button>
                </details>
              </div>
            )}
            {workers
              .filter((worker) => !worker.revoked)
              .map((worker) => (
                <div className="worker-row" key={worker.id}>
                  <i className={worker.status} />
                  <span>
                    <b>{worker.name}</b>
                    <small>
                      {worker.status} ·{" "}
                      {worker.capabilities.gpuName ||
                        worker.capabilities.cpu ||
                        "Not connected yet"}
                    </small>
                  </span>
                  <button
                    title="Revoke worker"
                    onClick={async () => {
                      if (!confirm(`Cabut akses ${worker.name}?`)) return;
                      try {
                        await api.revokeTrainingWorker(worker.id);
                        setWorkers(await api.trainingWorkers());
                        if (workerId === worker.id) setWorkerId("");
                      } catch (error) {
                        notify(
                          error instanceof Error
                            ? error.message
                            : "Gagal mencabut worker",
                        );
                      }
                    }}
                  >
                    <Trash2 />
                  </button>
                </div>
              ))}
            {!workers.some((worker) => !worker.revoked) && (
              <p className="muted">No laptop worker tokens yet.</p>
            )}
          </div>
          {[...project.models].reverse().map((model) => (
            <div className="run detailed-run" key={model.id}>
              <div className="run-head">
                <span className={model.status}>
                  <Activity />
                </span>
                <div>
                  <b>{model.name}</b>
                  <small>Dataset v{model.version}</small>
                </div>
                <strong>
                  {model.status === "ready"
                    ? "Ready"
                    : model.status === "failed"
                      ? "Failed"
                      : model.status === "cancelled"
                        ? "Cancelled"
                        : model.status === "queued"
                          ? "Queued"
                          : model.progress + "%"}
                </strong>
              </div>
              {(model.status === "training" || model.status === "queued") && (
                <>
                  <div className="big-meter">
                    <i style={{ width: model.progress + "%" }} />
                  </div>
                  <div className="run-progress">
                    <span>
                      {model.status === "queued"
                        ? String(
                            model.config?.execution_target || "server",
                          ).startsWith("remote-")
                          ? "Waiting for laptop worker"
                          : "Waiting for server compute"
                        : String(
                              model.config?.execution_target || "server",
                            ).startsWith("remote-")
                          ? `Training on ${workers.find((worker) => worker.id === model.workerId)?.name || "laptop"}`
                          : "Training on server"}
                    </span>
                    <b>{model.progress}%</b>
                  </div>
                  <button
                    className="cancel-job"
                    onClick={async () => {
                      try {
                        await api.cancelTraining(project.id, model.id);
                        notify("Permintaan pembatalan dikirim");
                      } catch (e) {
                        notify(
                          e instanceof Error ? e.message : "Gagal membatalkan",
                        );
                      }
                    }}
                  >
                    Cancel training
                  </button>
                </>
              )}
              {model.status === "ready" && (
                <>
                  <div className="metrics">
                    <span>
                      <b>{model.map}%</b>
                      <small>mAP50</small>
                    </span>
                    <span>
                      <b>{model.precision}%</b>
                      <small>Precision</small>
                    </span>
                    <span>
                      <b>{model.recall}%</b>
                      <small>Recall</small>
                    </span>
                  </div>
                  <a
                    className="download-best"
                    href={api.modelWeightsUrl(project.id, model.id)}
                    download
                  >
                    <Download />
                    Download best.pt
                  </a>
                </>
              )}
              {model.error && <p className="run-error">{model.error}</p>}
            </div>
          ))}
          {!project.models.length && (
            <div className="zero mini">
              <BrainCircuit />
              <h3>No training runs</h3>
              <p>Generate a dataset version, then start your first model.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function WorkflowNext({
  page,
  project,
  go,
}: {
  page: Page;
  project: Project;
  go: (page: Page) => void;
}) {
  const next =
    page === "annotate" &&
    project.assets.some((asset) => asset.status === "annotated")
      ? {
          label: "Annotations saved",
          action: "Generate version",
          page: "versions" as Page,
        }
      : page === "versions" && project.versions.length
        ? {
            label: `Version v${project.versions.at(-1)!.number} ready`,
            action: "Continue to training",
            page: "train" as Page,
          }
        : page === "train" &&
            project.models.some((model) => model.status === "ready")
          ? {
              label: "Model ready",
              action: "Open deployment",
              page: "deploy" as Page,
            }
          : null;
  return next ? (
    <div className="workflow-next">
      <Check />
      <span>
        <b>{next.label}</b>
        <small>Next recommended step</small>
      </span>
      <button onClick={() => go(next.page)}>
        {next.action}
        <ChevronRight />
      </button>
    </div>
  ) : null;
}

function ModelLibrary({ go }: { go: (page: Page) => void }) {
  const [query, setQuery] = useState("");
  const [task, setTask] = useState<
    "all" | "detect" | "segment" | "pose" | "obb" | "cls"
  >("all");
  const models = YOLO_MODELS.filter(
    (model) =>
      (task === "all" || model.task === task) &&
      `${model.family} ${model.size} ${model.task}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="content discover-page">
      <div className="discover-hero">
        <span className="eyebrow">LOCAL CHECKPOINT CATALOG</span>
        <h1>YOLO Model Library</h1>
        <p>
          Choose pretrained detection, segmentation, pose, OBB, and
          classification checkpoints. Weights download locally only when
          training starts.
        </p>
        <div className="library-stats">
          <span>
            <b>{YOLO_MODELS.length}</b> checkpoints
          </span>
          <span>
            <b>{new Set(YOLO_MODELS.map((model) => model.family)).size}</b> YOLO
            families
          </span>
          <span>
            <b>5</b> vision tasks
          </span>
        </div>
      </div>
      <div className="library-toolbar">
        <div className="search">
          <Search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search model or family"
          />
        </div>
        <div>
          {(["all", "detect", "segment", "pose", "obb", "cls"] as const).map(
            (value) => (
              <button
                className={task === value ? "active" : ""}
                onClick={() => setTask(value)}
                key={value}
              >
                {value === "all"
                  ? "All models"
                  : value === "detect"
                    ? "Detection"
                    : value === "segment"
                      ? "Segmentation"
                      : value === "pose"
                        ? "Keypoints"
                        : value === "obb"
                          ? "Oriented boxes"
                          : "Classification"}
              </button>
            ),
          )}
        </div>
      </div>
      <div className="model-library-grid">
        {models.map((model) => (
          <article className="library-card" key={model.id}>
            <div className={"library-icon " + model.task}>
              {model.task === "segment" ? <PenTool /> : <Boxes />}
            </div>
            <div className="library-card-head">
              <span>{model.family}</span>
              <em>{model.task}</em>
            </div>
            <h3>
              {model.family} {model.size}
            </h3>
            <p>{model.note}</p>
            <code>{model.id}</code>
            <dl>
              <div>
                <dt>Task</dt>
                <dd>
                  {model.task === "segment"
                    ? "Segmentation"
                    : model.task === "pose"
                      ? "Keypoint detection"
                      : model.task === "obb"
                        ? "Oriented bounding box"
                        : model.task === "cls"
                          ? "Classification"
                          : "Object detection"}
                </dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{model.size}</dd>
              </div>
            </dl>
            <button onClick={() => go("templates")}>
              Create compatible project
              <ChevronRight />
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function ProjectTemplates({
  onUse,
}: {
  onUse: (template: (typeof PROJECT_TEMPLATES)[number]) => void;
}) {
  return (
    <div className="content discover-page">
      <div className="discover-hero template-hero">
        <span className="eyebrow">START WITH A PROVEN STRUCTURE</span>
        <h1>Project Templates</h1>
        <p>
          Create a ready-to-annotate project with task type, class names, and
          colors already configured.
        </p>
      </div>
      <div className="template-grid">
        {PROJECT_TEMPLATES.map((template, index) => (
          <article className="template-card" key={template.name}>
            <div className={"template-cover cover-" + (index % 4)}>
              {template.type === "Instance Segmentation" ? (
                <PenTool />
              ) : (
                <Boxes />
              )}
              <span>{template.type}</span>
            </div>
            <div>
              <h3>{template.name}</h3>
              <p>{template.description}</p>
              <div className="template-classes">
                {template.classes.map((name, i) => (
                  <span key={name}>
                    <i
                      style={{
                        background: CLASS_PALETTE[i % CLASS_PALETTE.length],
                      }}
                    />
                    {name}
                  </span>
                ))}
              </div>
              <button className="primary" onClick={() => onUse(template)}>
                Use template
                <ChevronRight />
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function SegmentationAnnotate({
  project,
  go,
  update,
  notify,
}: {
  project: Project;
  go: (page: Page) => void;
  update: (fn: (project: Project) => Project) => void;
  notify: (message: string) => void;
}) {
  const [index, setIndex] = useState(() => {
    const requested = localStorage.getItem(`vf-annotate-${project.id}`);
    const found = project.assets.findIndex((item) => item.id === requested);
    return found >= 0 ? found : 0;
  });
  const asset = project.assets[index];
  const [zoom, setZoom] = useState(1);
  const [label, setLabel] = useState(project.classes[0] || "object");
  const [points, setPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [selectedMask, setSelectedMask] = useState<string | null>(null);
  const [draggingVertex, setDraggingVertex] = useState<{
    boxId: string;
    pointIndex: number;
  } | null>(null);
  const [smart, setSmart] = useState(false);
  const [smartBusy, setSmartBusy] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const isObb = project.type === "Oriented Bounding Box";
  const isPose = project.type === "Keypoint Detection";
  const minimumPoints = isPose ? 1 : 3;
  useEffect(() => {
    if (asset) localStorage.setItem(`vf-annotate-${project.id}`, asset.id);
    setZoom(1);
  }, [asset?.id]);
  const location = (event: { clientX: number; clientY: number }) => {
    const rect = canvas.current!.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(100, ((event.clientX - rect.left) / rect.width) * 100),
      ),
      y: Math.max(
        0,
        Math.min(100, ((event.clientY - rect.top) / rect.height) * 100),
      ),
    };
  };
  const persist = async (boxes: Box[]) => {
    if (!asset) return;
    update((current) => ({
      ...current,
      assets: current.assets.map((item) =>
        item.id === asset.id
          ? {
              ...item,
              boxes,
              status: boxes.length ? "annotated" : "unannotated",
            }
          : item,
      ),
    }));
    try {
      const saved = await api.annotate(project.id, asset.id, boxes);
      update(() => saved);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Gagal menyimpan polygon");
    }
  };
  const finish = () => {
    if (
      !asset ||
      points.length < minimumPoints ||
      (isObb && points.length !== 4)
    ) {
      notify(
        isObb
          ? "Oriented box wajib memiliki tepat 4 sudut"
          : isPose
            ? "Tambahkan minimal 1 keypoint"
            : "Polygon membutuhkan minimal 3 titik",
      );
      return;
    }
    const xs = points.map((point) => point.x),
      ys = points.map((point) => point.y);
    const polygon: Box = {
      id: uid(),
      type: isPose ? "keypoint" : isObb ? "obb" : "polygon",
      label,
      points: isPose
        ? points.map((point) => ({ ...point, visibility: 2 as const }))
        : points,
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(0.2, Math.max(...xs) - Math.min(...xs)),
      h: Math.max(0.2, Math.max(...ys) - Math.min(...ys)),
    };
    persist([...asset.boxes, polygon]);
    setPoints([]);
  };
  const smartAt = async (event: React.MouseEvent) => {
    if (!asset || smartBusy) return;
    const point = location(event);
    setSmartBusy(true);
    try {
      const polygon = await api.smartMask(project.id, asset.id, {
        ...point,
        label,
      });
      await persist([...asset.boxes, polygon]);
      notify("Smart mask dibuat dan dapat diedit per vertex");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Smart mask gagal");
    } finally {
      setSmartBusy(false);
    }
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Enter" && points.length >= minimumPoints) finish();
      if (event.key === "Escape") setPoints([]);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [points, asset, label, minimumPoints, isObb, isPose]);
  if (!asset)
    return (
      <div className="content">
        <ProjectTabs active="annotate" go={go} />
        <div className="zero">
          <ImageIcon />
          <h2>No images to segment</h2>
          <p>Upload images from Overview first.</p>
        </div>
      </div>
    );
  const remove = (id: string) =>
    persist(asset.boxes.filter((box) => box.id !== id));
  const moveVertex = (event: React.PointerEvent) => {
    if (!draggingVertex) return;
    const point = location(event);
    update((current) => ({
      ...current,
      assets: current.assets.map((item) => {
        if (item.id !== asset.id) return item;
        const boxes = item.boxes.map((box) => {
          if (box.id !== draggingVertex.boxId || !box.points) return box;
          const next = box.points.map((value, pointIndex) =>
            pointIndex === draggingVertex.pointIndex ? point : value,
          );
          const xs = next.map((value) => value.x),
            ys = next.map((value) => value.y);
          return {
            ...box,
            points: next,
            x: Math.min(...xs),
            y: Math.min(...ys),
            w: Math.max(...xs) - Math.min(...xs),
            h: Math.max(...ys) - Math.min(...ys),
          };
        });
        return { ...item, boxes };
      }),
    }));
  };
  const stopVertex = () => {
    if (!draggingVertex) return;
    setDraggingVertex(null);
    persist(asset.boxes);
  };
  return (
    <div className="annotator segmentation-annotator">
      <div className="annotator-head">
        <div>
          <b>{project.type}</b>
          <span>{asset.name}</span>
        </div>
        <div className="image-nav">
          <button
            disabled={!index}
            onClick={() => {
              setPoints([]);
              setIndex((value) => value - 1);
            }}
          >
            ‹
          </button>
          <span>
            {index + 1} / {project.assets.length}
          </span>
          <button
            disabled={index === project.assets.length - 1}
            onClick={() => {
              setPoints([]);
              setIndex((value) => value + 1);
            }}
          >
            ›
          </button>
        </div>
        <button className="primary small" onClick={() => go("versions")}>
          <Check />
          Saved · Generate Version
        </button>
      </div>
      <div className="annotator-body">
        <aside className="toolrail">
          <button
            className={!smart ? "active" : ""}
            title={
              isPose
                ? "Keypoint tool"
                : isObb
                  ? "Four-corner OBB tool"
                  : "Polygon tool"
            }
          >
            <PenTool />
          </button>
          {!isObb && !isPose && (
            <button
              className={smart ? "active" : ""}
              title="Smart mask: click object center"
              onClick={() => {
                setSmart((value) => !value);
                setPoints([]);
              }}
            >
              <WandSparkles />
            </button>
          )}
          <button
            disabled={!points.length}
            onClick={() => setPoints((current) => current.slice(0, -1))}
          >
            <Undo2 />
          </button>
          <button disabled={!points.length} onClick={() => setPoints([])}>
            <X />
          </button>
        </aside>
        <aside className="classes">
          <div className="classes-head">
            <span className="eyebrow">ANNOTATION CLASSES</span>
            <button
              onClick={async () => {
                const name = prompt("Nama class baru")?.trim();
                if (name && !project.classes.includes(name)) {
                  const saved = await api.addClass(
                    project.id,
                    name,
                    CLASS_PALETTE[
                      project.classes.length % CLASS_PALETTE.length
                    ],
                  );
                  update(() => saved);
                  setLabel(name);
                }
              }}
            >
              <Plus />
            </button>
          </div>
          {project.classes.map((name, i) => (
            <div className="annot-class" key={name}>
              <button
                className={label === name ? "active" : ""}
                onClick={() => setLabel(name)}
              >
                <i style={{ background: classColor(project, name, i) }} />
                {name}
                <small>
                  {asset.boxes.filter((box) => box.label === name).length}
                </small>
              </button>
              <input
                className="class-color"
                type="color"
                value={classColor(project, name, i)}
                onChange={(e) => {
                  api
                    .renameClass(project.id, name, name, e.target.value)
                    .then((saved) => update(() => saved))
                    .catch((error) =>
                      notify(
                        error instanceof Error
                          ? error.message
                          : "Gagal mengubah warna",
                      ),
                    );
                }}
              />
              <button
                className="class-edit"
                onClick={async () => {
                  const renamed = prompt("Ubah nama class", name)?.trim();
                  if (renamed) {
                    const saved = await api.renameClass(
                      project.id,
                      name,
                      renamed,
                      classColor(project, name, i),
                    );
                    update(() => saved);
                    if (label === name) setLabel(renamed);
                  }
                }}
              >
                Rename
              </button>
            </div>
          ))}
          <div className="polygon-guide">
            <b>
              {isPose
                ? "Keypoint tool"
                : isObb
                  ? "Oriented box tool"
                  : "Polygon tool"}
            </b>
            <span>
              {isPose
                ? "Click keypoints in a consistent order, then press Enter."
                : isObb
                  ? "Click the four corners clockwise, then press Enter."
                  : "Click around the boundary; press Enter after at least 3 points."}{" "}
              Esc cancels.
            </span>
            <button
              className="new-polygon"
              onClick={() => {
                setSelectedMask(null);
                setPoints([]);
              }}
            >
              {isPose
                ? "New keypoints"
                : isObb
                  ? "New oriented box"
                  : "New polygon"}
            </button>
            <button
              disabled={
                points.length < minimumPoints || (isObb && points.length !== 4)
              }
              onClick={finish}
            >
              {isPose
                ? "Save keypoints"
                : isObb
                  ? "Save oriented box"
                  : "Close polygon"}{" "}
              ({points.length})
            </button>
          </div>
        </aside>
        <div className={"canvas-wrap " + (zoom > 1 ? "zoomed" : "")}>
          <div
            className={
              "canvas polygon-canvas " + (smart ? "smart-mask-cursor" : "")
            }
            ref={canvas}
            style={{ transform: `scale(${zoom})` }}
            onClick={(event) => {
              if (smart) {
                smartAt(event);
                return;
              }
              if (selectedMask) {
                setSelectedMask(null);
                return;
              }
              setPoints((current) =>
                isObb && current.length >= 4
                  ? current
                  : [...current, location(event)],
              );
            }}
            onPointerMove={moveVertex}
            onPointerUp={stopVertex}
            onPointerLeave={stopVertex}
          >
            <img src={asset.src} draggable={false} />
            {smartBusy && (
              <div className="smart-mask-loading">
                <WandSparkles />
                Finding object contour…
              </div>
            )}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              {asset.boxes
                .filter((box) => box.points?.length)
                .map((box, i) => (
                  <g key={box.id}>
                    <polygon
                      className={selectedMask === box.id ? "selected-mask" : ""}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedMask(box.id);
                        setPoints([]);
                      }}
                      points={box
                        .points!.map((point) => `${point.x},${point.y}`)
                        .join(" ")}
                      fill={classColor(project, box.label, i) + "44"}
                      stroke={classColor(project, box.label, i)}
                      strokeWidth={selectedMask === box.id ? ".8" : ".45"}
                      vectorEffect="non-scaling-stroke"
                    />
                    {selectedMask === box.id &&
                      box.points!.map((point, pointIndex) => (
                        <circle
                          className="mask-vertex"
                          key={pointIndex}
                          cx={point.x}
                          cy={point.y}
                          r="1"
                          fill="#fff"
                          stroke={classColor(project, box.label, i)}
                          strokeWidth=".4"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            event.currentTarget.setPointerCapture(
                              event.pointerId,
                            );
                            setDraggingVertex({ boxId: box.id, pointIndex });
                          }}
                        />
                      ))}
                  </g>
                ))}
              {points.length > 0 && (
                <>
                  <polyline
                    points={points
                      .map((point) => `${point.x},${point.y}`)
                      .join(" ")}
                    fill="none"
                    stroke={classColor(project, label)}
                    strokeWidth=".55"
                    vectorEffect="non-scaling-stroke"
                  />
                  {points.map((point, i) => (
                    <circle
                      key={i}
                      cx={point.x}
                      cy={point.y}
                      r=".65"
                      fill="#fff"
                      stroke={classColor(project, label)}
                      strokeWidth=".3"
                    />
                  ))}
                </>
              )}
            </svg>
          </div>
          <div className="zoom">
            <button
              onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
            >
              <ZoomOut />
            </button>
            <button className="zoom-value" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </button>
            <button
              onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
            >
              <ZoomIn />
            </button>
          </div>
        </div>
        <aside className="annotation-list">
          <h3>
            Annotations <span>{asset.boxes.length}</span>
          </h3>
          {asset.boxes.map((box, i) => (
            <div
              key={box.id}
              className={selectedMask === box.id ? "selected" : ""}
              onClick={() => {
                setSelectedMask(box.id);
                setPoints([]);
              }}
            >
              <i style={{ background: classColor(project, box.label, i) }} />
              {i + 1}. {box.label}
              <button onClick={() => remove(box.id)}>
                <X />
              </button>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}

function MetricSparkline({ model }: { model: Model }) {
  const points = (model.metricsHistory || []).map((entry, index) => {
    const metric =
      Object.entries(entry).find(
        ([key]) => key.includes("mAP50") && !key.includes("95"),
      )?.[1] ??
      Object.entries(entry).find(([key]) =>
        key.includes("accuracy_top1"),
      )?.[1] ??
      0;
    return { x: index, y: Number(metric) * 100 };
  });
  if (points.length < 2) return null;
  const maximum = Math.max(1, ...points.map((point) => point.y));
  const path = points
    .map(
      (point, index) =>
        `${index ? "L" : "M"} ${(index / (points.length - 1)) * 100} ${34 - (point.y / maximum) * 30}`,
    )
    .join(" ");
  return (
    <div className="metric-chart">
      <div>
        <b>Validation curve</b>
        <span>
          {points.length} epochs · peak {maximum.toFixed(1)}%
        </span>
      </div>
      <svg viewBox="0 0 100 36" preserveAspectRatio="none">
        <path d="M 0 34 L 100 34" className="axis" />
        <path d={path} className="metric-line" />
      </svg>
    </div>
  );
}

function ModelRegistry({
  project,
  go,
  update,
  notify,
}: {
  project: Project;
  go: (page: Page) => void;
  update: (fn: (project: Project) => Project) => void;
  notify: (message: string) => void;
}) {
  const [exporting, setExporting] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [importStage, setImportStage] = useState<TransferStage>("uploading");
  const importWeightsInput = useRef<HTMLInputElement>(null);
  const importWeights = async (file?: File) => {
    if (!file) return;
    const name = prompt("Nama model", file.name.replace(/\.pt$/i, ""))?.trim();
    if (!name) return;
    const versionId = project.versions.at(-1)?.id;
    if (!versionId) {
      notify("Buat dataset version sebelum mengimpor model");
      return;
    }
    try {
      setImportProgress(0);
      setImportStage("uploading");
      const saved = await api.importModel(
        project.id,
        file,
        {
          name,
          version_id: versionId,
        },
        setImportProgress,
        () => setImportStage("processing"),
      );
      update(() => saved);
      notify("best.pt tervalidasi dan dimasukkan ke Model Registry");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Import model gagal");
    } finally {
      setImportProgress(null);
      if (importWeightsInput.current) importWeightsInput.current.value = "";
    }
  };
  const rename = async (id: string, current: string) => {
    const name = prompt("Nama model", current)?.trim();
    if (!name) return;
    try {
      const saved = await api.renameModel(project.id, id, name);
      update(() => saved);
      notify("Nama model diperbarui");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Gagal rename model");
    }
  };
  const remove = async (id: string, name: string) => {
    if (!confirm(`Hapus model ${name} dan seluruh weights-nya?`)) return;
    try {
      await api.deleteModel(project.id, id);
      const fresh = await api.project(project.id);
      update(() => fresh);
      notify("Model dan weights dihapus");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Gagal menghapus model");
    }
  };
  const exportWeights = async (id: string, format: string) => {
    setExporting(id + format);
    try {
      const response = await api.exportModel(project.id, id, format);
      if (!response.ok)
        throw new Error(
          (await response.json().catch(() => ({}))).detail || "Export gagal",
        );
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        response.headers
          .get("content-disposition")
          ?.match(/filename="?([^";]+)/)?.[1] || `model-${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
      notify(`Export ${format.toUpperCase()} selesai`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Export gagal");
    } finally {
      setExporting("");
    }
  };
  const updateLifecycle = async (
    id: string,
    stage: NonNullable<Model["stage"]>,
    alias?: string,
  ) => {
    try {
      const saved = await api.updateModelLifecycle(project.id, id, {
        stage,
        alias,
      });
      update(() => saved);
      notify(`Model dipindahkan ke ${stage}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Lifecycle gagal diubah");
    }
  };
  const retry = async (id: string) => {
    try {
      const saved = await api.retryTraining(project.id, id);
      update(() => saved);
      notify("Training dijadwalkan ulang dengan konfigurasi yang sama");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Retry training gagal");
    }
  };
  const toggleModel = (id: string) =>
    setSelectedModels((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current.slice(-1), id],
    );
  const comparedModels = selectedModels
    .map((id) => project.models.find((model) => model.id === id))
    .filter(Boolean) as Model[];
  return (
    <div className="content registry-page">
      <ProjectTabs active="registry" go={go} />
      <div className="project-title">
        <div>
          <span className="eyebrow">MODEL REGISTRY</span>
          <h1>Models & artifacts</h1>
          <p>
            Manage trained checkpoints, metrics, configuration, and deployment
            formats.
          </p>
        </div>
        <button
          className="secondary"
          disabled={importProgress !== null}
          onClick={() => importWeightsInput.current?.click()}
        >
          <Upload />
          {importProgress !== null ? "Importing best.pt…" : "Import best.pt"}
        </button>
        <input
          ref={importWeightsInput}
          hidden
          type="file"
          accept=".pt"
          onChange={(event) => importWeights(event.target.files?.[0])}
        />
      </div>
      {importProgress !== null && (
        <TransferProgress
          percent={importProgress}
          stage={importStage}
          label="Uploading model weights"
        />
      )}
      {comparedModels.length === 2 && (
        <section className="panel model-comparison">
          <div className="panel-head">
            <div>
              <h2>Model comparison</h2>
              <p>Compare validation metrics before promoting a checkpoint.</p>
            </div>
            <button className="ghost" onClick={() => setSelectedModels([])}>
              Clear
            </button>
          </div>
          <div>
            {comparedModels.map((model) => (
              <article key={model.id}>
                <b>{model.alias || model.name}</b>
                <span>
                  mAP50 <strong>{model.map}%</strong>
                </span>
                <span>
                  Precision <strong>{model.precision}%</strong>
                </span>
                <span>
                  Recall <strong>{model.recall}%</strong>
                </span>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="registry-grid">
        {[...project.models].reverse().map((model) => (
          <article className="registry-card" key={model.id}>
            <div className="registry-head">
              <label className="model-select" title="Select for comparison">
                <input
                  type="checkbox"
                  checked={selectedModels.includes(model.id)}
                  onChange={() => toggleModel(model.id)}
                />
              </label>
              <span className={model.status}>
                <BrainCircuit />
              </span>
              <div>
                <h3>{model.name}</h3>
                {model.alias && (
                  <strong className="model-alias">{model.alias}</strong>
                )}
                <p>
                  Dataset v{model.version} ·{" "}
                  {model.createdAt?.slice(0, 10) || "local run"}
                </p>
              </div>
              <em>{model.status}</em>
            </div>
            {model.status === "ready" && (
              <div className="registry-metrics">
                <span>
                  <b>{model.map}%</b>
                  <small>mAP50</small>
                </span>
                <span>
                  <b>{model.precision}%</b>
                  <small>Precision</small>
                </span>
                <span>
                  <b>{model.recall}%</b>
                  <small>Recall</small>
                </span>
              </div>
            )}
            <MetricSparkline model={model} />
            {model.status === "ready" && (
              <div className="evaluation-links">
                <a
                  href={`/api/projects/${project.id}/models/${model.id}/evaluation/results.png`}
                  target="_blank"
                >
                  Training curves
                </a>
                <a
                  href={`/api/projects/${project.id}/models/${model.id}/evaluation/confusion_matrix.png`}
                  target="_blank"
                >
                  Confusion matrix
                </a>
                <a
                  href={`/api/projects/${project.id}/models/${model.id}/evaluation/PR_curve.png`}
                  target="_blank"
                >
                  PR curve
                </a>
              </div>
            )}
            <div className="registry-config">
              <span>
                Epochs <b>{String(model.config?.epochs || "—")}</b>
              </span>
              <span>
                Image <b>{String(model.config?.image_size || "—")}</b>
              </span>
              <span>
                Batch <b>{String(model.config?.batch_size || "—")}</b>
              </span>
              <span>
                Optimizer <b>{String(model.config?.optimizer || "—")}</b>
              </span>
            </div>
            <div className="model-lifecycle">
              <label>
                Stage
                <select
                  value={model.stage || "development"}
                  disabled={model.status !== "ready"}
                  onChange={(event) =>
                    updateLifecycle(
                      model.id,
                      event.target.value as NonNullable<Model["stage"]>,
                      model.alias,
                    )
                  }
                >
                  <option value="development">Development</option>
                  <option value="staging">Staging</option>
                  <option value="production">Production</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              <button
                disabled={model.status !== "ready"}
                onClick={() => {
                  const alias = prompt(
                    "Alias model",
                    model.alias || "latest",
                  )?.trim();
                  if (alias)
                    updateLifecycle(
                      model.id,
                      model.stage || "development",
                      alias,
                    );
                }}
              >
                Set alias
              </button>
            </div>
            {model.status === "ready" && (
              <div className="registry-exports">
                <a href={api.modelWeightsUrl(project.id, model.id)} download>
                  BEST.PT
                </a>
                {["onnx", "torchscript", "openvino", "ncnn", "tflite"].map(
                  (format) => (
                    <button
                      disabled={!!exporting}
                      onClick={() => exportWeights(model.id, format)}
                      key={format}
                    >
                      {exporting === model.id + format
                        ? "Exporting…"
                        : format.toUpperCase()}
                    </button>
                  ),
                )}
              </div>
            )}
            <div className="registry-actions">
              {(model.status === "failed" || model.status === "cancelled") && (
                <button onClick={() => retry(model.id)}>
                  <Redo2 /> Retry
                </button>
              )}
              <button onClick={() => rename(model.id, model.name)}>
                Rename
              </button>
              <button
                className="delete"
                disabled={model.status === "training"}
                onClick={() => remove(model.id, model.name)}
              >
                <Trash2 />
                Delete
              </button>
            </div>
            {model.error && <p className="run-error">{model.error}</p>}
          </article>
        ))}
        {!project.models.length && (
          <div className="zero">
            <BrainCircuit />
            <h2>No models yet</h2>
            <p>Train a model to create the first registry entry.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DatasetManager({
  project,
  go,
  update,
  notify,
}: {
  project: Project;
  go: (page: Page) => void;
  update: (fn: (project: Project) => Project) => void;
  notify: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [split, setSplit] = useState("all");
  const [review, setReview] = useState("all");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importStage, setImportStage] = useState<TransferStage>("uploading");
  const [importFileName, setImportFileName] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importFormat, setImportFormat] = useState("yolo");
  const [labeling, setLabeling] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const annotatedFormats = [
    { id: "yolo", name: "YOLO", hint: "data.yaml + images/labels" },
    { id: "coco", name: "COCO JSON", hint: "images + annotations JSON" },
    { id: "voc", name: "Pascal VOC", hint: "images + XML annotations" },
    { id: "labelme", name: "LabelMe", hint: "images + shape JSON files" },
    { id: "cvat", name: "CVAT", hint: "images + CVAT XML export" },
  ];
  const filtered = project.assets.filter(
    (asset) =>
      `${asset.name} ${(asset.tags || []).join(" ")} ${Object.values(asset.metadata || {}).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (status === "all" || asset.status === status) &&
      (split === "all" || asset.split === split) &&
      (review === "all" || (asset.reviewStatus || "pending") === review),
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleAssets = filtered.slice(
    (pageNumber - 1) * pageSize,
    pageNumber * pageSize,
  );
  useEffect(() => setPageNumber(1), [query, status, split, review, pageSize]);
  useEffect(() => {
    if (pageNumber > totalPages) setPageNumber(totalPages);
  }, [pageNumber, totalPages]);
  useEffect(
    () =>
      setSelected(
        (current) =>
          new Set(
            [...current].filter((id) =>
              project.assets.some((asset) => asset.id === id),
            ),
          ),
      ),
    [project.assets],
  );
  const importZip = async (file?: File) => {
    if (!file) return;
    setImporting(true);
    setImportProgress(0);
    setImportStage("uploading");
    setImportFileName(file.name);
    try {
      const saved = await api.importAnnotatedDataset(
        project.id,
        file,
        setImportProgress,
        () => setImportStage("processing"),
      );
      update(() => saved);
      setShowImport(false);
      notify(
        `${saved.assets.length - project.assets.length} annotated images imported`,
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : "Dataset import gagal");
    } finally {
      setImporting(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async (id: string) => {
    if (!confirm("Hapus gambar dan anotasinya?")) return;
    await api.deleteAsset(project.id, id);
    const fresh = await api.project(project.id);
    update(() => fresh);
  };
  const autoLabel = async () => {
    const confidence = Number(
      prompt("Confidence auto-label (0.01 - 0.99)", "0.35"),
    );
    if (!confidence || confidence < 0.01 || confidence > 0.99) return;
    setLabeling(true);
    try {
      const saved = await api.autoLabel(project.id, {
        confidence,
        overwrite: false,
      });
      update(() => saved);
      notify("Auto-label selesai dan hasil disimpan ke dataset");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Auto-label gagal");
    } finally {
      setLabeling(false);
    }
  };
  const runBulk = async (
    action: "split" | "review" | "delete",
    value?: string,
  ) => {
    const ids = [...selected];
    if (!ids.length) return;
    if (
      action === "delete" &&
      !confirm(`Hapus ${ids.length} gambar beserta seluruh anotasinya?`)
    )
      return;
    setBulkBusy(true);
    try {
      const saved = await api.bulkAssets(project.id, ids, action, value);
      update(() => saved);
      setSelected(new Set());
      notify(`${ids.length} images updated`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Bulk action gagal");
    } finally {
      setBulkBusy(false);
    }
  };
  const allSelected =
    filtered.length > 0 && filtered.every((asset) => selected.has(asset.id));
  const toggleAll = () =>
    setSelected((current) => {
      const next = new Set(current);
      if (allSelected) filtered.forEach((asset) => next.delete(asset.id));
      else filtered.forEach((asset) => next.add(asset.id));
      return next;
    });
  const downloadAnnotated = (format: string) => {
    if (!format) return;
    const anchor = document.createElement("a");
    anchor.href = api.annotatedExportUrl(project.id, format);
    anchor.download = "";
    anchor.click();
  };
  return (
    <div className="content dataset-page">
      <ProjectTabs active="dataset" go={go} />
      <div className="project-title">
        <div>
          <span className="eyebrow">DATASET MANAGEMENT</span>
          <h1>Images & annotations</h1>
          <p>Import, inspect, filter, split, and clean your local dataset.</p>
        </div>
        <div className="title-actions">
          <label className="export-dataset-select">
            <Download />
            <select
              defaultValue=""
              onChange={(event) => {
                downloadAnnotated(event.target.value);
                event.target.value = "";
              }}
            >
              <option value="" disabled>
                Download annotated ZIP
              </option>
              <option value="yolo">YOLO</option>
              <option value="coco">COCO JSON</option>
              <option value="voc">Pascal VOC</option>
              <option value="labelme">LabelMe</option>
              <option value="masks">PNG masks</option>
            </select>
          </label>
          <button
            className="secondary auto-label-button"
            disabled={labeling}
            onClick={autoLabel}
          >
            <WandSparkles />
            {labeling ? "Auto-labeling…" : "Auto-label unannotated"}
          </button>
          <button className="secondary" onClick={() => setShowImport(true)}>
            <Upload />
            {importing ? "Importing…" : "Import annotated dataset"}
          </button>
          <button className="primary" onClick={() => go("annotate")}>
            <PenTool />
            Open annotator
          </button>
        </div>
      </div>
      <div className="dataset-stats">
        <span>
          <b>{project.assets.length}</b>
          <small>Total images</small>
        </span>
        <span>
          <b>
            {
              project.assets.filter((asset) => asset.status === "annotated")
                .length
            }
          </b>
          <small>Annotated</small>
        </span>
        <span>
          <b>
            {project.assets.reduce((sum, asset) => sum + asset.boxes.length, 0)}
          </b>
          <small>Annotations</small>
        </span>
        <span>
          <b>{project.classes.length}</b>
          <small>Classes</small>
        </span>
      </div>
      <div className="dataset-toolbar">
        <button
          className={"select-all " + (allSelected ? "active" : "")}
          onClick={toggleAll}
        >
          {allSelected ? <CheckSquare /> : <Square />}
          <span>{allSelected ? "Clear page" : "Select page"}</span>
        </button>
        <div className="search">
          <Search />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search filename"
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="annotated">Annotated</option>
          <option value="unannotated">Unannotated</option>
        </select>
        <select value={review} onChange={(e) => setReview(e.target.value)}>
          <option value="all">All reviews</option>
          <option value="pending">Pending review</option>
          <option value="approved">Approved</option>
          <option value="needs-fix">Needs fix</option>
        </select>
        <select value={split} onChange={(e) => setSplit(e.target.value)}>
          <option value="all">All splits</option>
          <option value="train">Train</option>
          <option value="valid">Valid</option>
          <option value="test">Test</option>
        </select>
        <span>{filtered.length} results</span>
      </div>
      {selected.size > 0 && (
        <div className="bulk-bar">
          <b>
            <CheckSquare /> {selected.size} selected
          </b>
          <span>Set split</span>
          <button disabled={bulkBusy} onClick={() => runBulk("split", "train")}>
            Train
          </button>
          <button disabled={bulkBusy} onClick={() => runBulk("split", "valid")}>
            Valid
          </button>
          <button disabled={bulkBusy} onClick={() => runBulk("split", "test")}>
            Test
          </button>
          <i />
          <span>Review</span>
          <button
            disabled={bulkBusy}
            onClick={() => runBulk("review", "approved")}
          >
            Approve
          </button>
          <button
            disabled={bulkBusy}
            onClick={() => runBulk("review", "needs-fix")}
          >
            Needs fix
          </button>
          <button
            className="bulk-delete"
            disabled={bulkBusy}
            onClick={() => runBulk("delete")}
          >
            <Trash2 /> Delete
          </button>
          <button
            className="bulk-close"
            onClick={() => setSelected(new Set())}
            aria-label="Clear selection"
          >
            <X />
          </button>
        </div>
      )}
      <div className="dataset-grid">
        {visibleAssets.map((asset) => (
          <article
            className={
              "dataset-item " + (selected.has(asset.id) ? "selected" : "")
            }
            key={asset.id}
          >
            <div>
              <button
                className="asset-check"
                aria-label={`Select ${asset.name}`}
                onClick={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    next.has(asset.id)
                      ? next.delete(asset.id)
                      : next.add(asset.id);
                    return next;
                  })
                }
              >
                {selected.has(asset.id) ? <CheckSquare /> : <Square />}
              </button>
              <img
                src={asset.src}
                onClick={() => setPreviewAsset(asset)}
                title="Preview and edit metadata"
              />
              <span className={asset.status}>{asset.status}</span>
              <button onClick={() => remove(asset.id)}>
                <Trash2 />
              </button>
            </div>
            <h3 title={asset.name}>{asset.name}</h3>
            {!!asset.tags?.length && (
              <div className="asset-tags">
                {asset.tags.slice(0, 3).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            )}
            <footer>
              <span>{asset.boxes.length} labels</span>
              <select
                className={"review-select " + (asset.reviewStatus || "pending")}
                value={asset.reviewStatus || "pending"}
                onChange={async (e) => {
                  const saved = await api.setAssetReview(
                    project.id,
                    asset.id,
                    e.target.value as "pending" | "approved" | "needs-fix",
                  );
                  update(() => saved);
                }}
              >
                <option value="pending">Review pending</option>
                <option value="approved">Approved</option>
                <option value="needs-fix">Needs fix</option>
              </select>
              <select
                value={asset.split}
                onChange={async (e) => {
                  const saved = await api.setAssetSplit(
                    project.id,
                    asset.id,
                    e.target.value as "train" | "valid" | "test",
                  );
                  update(() => saved);
                }}
              >
                <option value="train">Train</option>
                <option value="valid">Valid</option>
                <option value="test">Test</option>
              </select>
            </footer>
          </article>
        ))}
      </div>
      {filtered.length > pageSize && (
        <div className="dataset-pagination">
          <span>
            Page {pageNumber} of {totalPages}
          </span>
          <button
            disabled={pageNumber === 1}
            onClick={() => setPageNumber((value) => value - 1)}
          >
            Previous
          </button>
          <button
            disabled={pageNumber === totalPages}
            onClick={() => setPageNumber((value) => value + 1)}
          >
            Next
          </button>
          <select
            value={pageSize}
            onChange={(event) => setPageSize(Number(event.target.value))}
          >
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
        </div>
      )}
      {!filtered.length && (
        <div className="zero">
          <ImageIcon />
          <h2>No matching images</h2>
          <p>
            Adjust filters or import a YOLO, COCO, VOC, LabelMe, or CVAT ZIP.
          </p>
        </div>
      )}
      {previewAsset && (
        <AssetPreviewModal
          project={project}
          asset={
            project.assets.find((item) => item.id === previewAsset.id) ||
            previewAsset
          }
          close={() => setPreviewAsset(null)}
          annotate={() => {
            localStorage.setItem(`vf-annotate-${project.id}`, previewAsset.id);
            setPreviewAsset(null);
            go("annotate");
          }}
          save={async (data) => {
            try {
              const saved = await api.updateAssetMetadata(
                project.id,
                previewAsset.id,
                data,
              );
              update(() => saved);
              setPreviewAsset(
                saved.assets.find((item) => item.id === previewAsset.id) ||
                  null,
              );
              notify("Image metadata updated");
            } catch (error) {
              notify(
                error instanceof Error
                  ? error.message
                  : "Metadata update failed",
              );
            }
          }}
        />
      )}
      {showImport && (
        <div
          className="modal-bg"
          onMouseDown={() => !importing && setShowImport(false)}
        >
          <section
            className="annotated-import-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">ANNOTATED DATASET</span>
                <h2>Import existing annotations</h2>
                <p>
                  Upload one ZIP containing images and annotation files. The
                  imported images are immediately ready for review, versioning,
                  and training.
                </p>
              </div>
              <button
                className="icon ghost"
                aria-label="Close annotated dataset import"
                disabled={importing}
                onClick={() => setShowImport(false)}
              >
                <X />
              </button>
            </header>
            <div className="annotated-format-grid">
              {annotatedFormats.map((format) => (
                <button
                  className={importFormat === format.id ? "active" : ""}
                  onClick={() => setImportFormat(format.id)}
                  key={format.id}
                >
                  <span>{format.name}</span>
                  <small>{format.hint}</small>
                  {importFormat === format.id && <Check />}
                </button>
              ))}
            </div>
            <div className="annotated-import-note">
              <Boxes />
              <span>
                <b>Annotations are preserved</b>
                <small>
                  Classes, boxes, polygons, and train/valid/test folders are
                  detected automatically.
                </small>
              </span>
            </div>
            {importing && (
              <TransferProgress
                percent={importProgress}
                stage={importStage}
                label={`Uploading ${importFileName || "annotated dataset"}`}
              />
            )}
            <footer>
              <button
                className="secondary"
                disabled={importing}
                onClick={() => setShowImport(false)}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={importing}
                onClick={() => input.current?.click()}
              >
                <Upload />
                {importing
                  ? "Importing…"
                  : `Choose ${annotatedFormats.find((item) => item.id === importFormat)?.name} ZIP`}
              </button>
              <input
                hidden
                ref={input}
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => importZip(event.target.files?.[0])}
              />
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function AssetPreviewModal({
  project,
  asset,
  close,
  annotate,
  save,
}: {
  project: Project;
  asset: Asset;
  close: () => void;
  annotate: () => void;
  save: (data: {
    name: string;
    tags: string[];
    metadata: Record<string, string>;
  }) => void;
}) {
  const [name, setName] = useState(asset.name);
  const [tags, setTags] = useState((asset.tags || []).join(", "));
  const [metadata, setMetadata] = useState(
    Object.entries(asset.metadata || {})
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
  );
  const [comment, setComment] = useState("");
  const [collaboration, setCollaboration] = useState<{
    revisions: Array<{
      id: string;
      actor: string;
      createdAt: string;
      annotations: number;
    }>;
    comments: Array<{
      id: string;
      actor: string;
      body: string;
      createdAt: string;
    }>;
  }>({ revisions: [], comments: [] });
  const loadCollaboration = () =>
    api
      .assetCollaboration(project.id, asset.id)
      .then(setCollaboration)
      .catch(() => {});
  useEffect(() => {
    loadCollaboration();
  }, [project.id, asset.id]);
  const submit = () => {
    const parsed = Object.fromEntries(
      metadata
        .split("\n")
        .map((line) => line.split("="))
        .filter((parts) => parts.length >= 2 && parts[0].trim())
        .map((parts) => [parts[0].trim(), parts.slice(1).join("=").trim()]),
    );
    save({
      name: name.trim(),
      tags: tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      metadata: parsed,
    });
  };
  return (
    <div className="modal-bg asset-preview-bg" onMouseDown={close}>
      <section
        className="asset-preview-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="asset-preview-image">
          <img src={asset.src} />
          {asset.boxes.map((box, index) => (
            <i
              key={box.id}
              style={{
                left: `${box.x}%`,
                top: `${box.y}%`,
                width: `${box.w}%`,
                height: `${box.h}%`,
                borderColor: classColor(project, box.label, index),
              }}
            >
              <span>{box.label}</span>
            </i>
          ))}
        </div>
        <div className="asset-preview-details">
          <header>
            <div>
              <span className="eyebrow">IMAGE DETAILS</span>
              <h2>{asset.name}</h2>
            </div>
            <button className="icon ghost" onClick={close}>
              <X />
            </button>
          </header>
          <div className="asset-facts">
            <span>
              <b>{asset.boxes.length}</b> annotations
            </span>
            <span>
              <b>{asset.split}</b> split
            </span>
            <span>
              <b>{asset.reviewStatus || "pending"}</b> review
            </span>
          </div>
          <label>
            Filename
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Tags
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="warehouse, night, camera-2"
            />
          </label>
          <label>
            Custom metadata
            <textarea
              value={metadata}
              onChange={(event) => setMetadata(event.target.value)}
              placeholder={"camera=loading-bay\nlocation=jakarta"}
            />
            <small>One key=value pair per line.</small>
          </label>
          <div className="asset-collaboration">
            <h3>Comments & revision history</h3>
            <div className="asset-comments">
              {collaboration.comments.map((item) => (
                <p key={item.id}>
                  <b>{item.actor}</b>
                  <span>{item.body}</span>
                  <small>{item.createdAt.slice(0, 16).replace("T", " ")}</small>
                </p>
              ))}
              {!collaboration.comments.length && (
                <small>No comments yet.</small>
              )}
            </div>
            <div className="comment-compose">
              <input
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Request a change or leave context…"
              />
              <button
                disabled={!comment.trim()}
                onClick={async () => {
                  await api.addAssetComment(
                    project.id,
                    asset.id,
                    comment.trim(),
                  );
                  setComment("");
                  loadCollaboration();
                }}
              >
                Send
              </button>
            </div>
            {!!collaboration.revisions.length && (
              <details>
                <summary>
                  {collaboration.revisions.length} saved revisions
                </summary>
                {collaboration.revisions.slice(0, 10).map((item) => (
                  <p key={item.id}>
                    <b>{item.actor}</b>
                    <span>{item.annotations} annotations</span>
                    <small>
                      {item.createdAt.slice(0, 16).replace("T", " ")}
                    </small>
                  </p>
                ))}
              </details>
            )}
          </div>
          <footer>
            <button className="secondary" onClick={annotate}>
              <PenTool />
              Open in annotator
            </button>
            <button
              className="primary"
              disabled={!name.trim()}
              onClick={submit}
            >
              <Check />
              Save metadata
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}

function LocalSettings({
  notify,
  onRestored,
}: {
  notify: (message: string) => void;
  onRestored: () => Promise<void>;
}) {
  const [system, setSystem] = useState<Awaited<
    ReturnType<typeof api.system>
  > | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [activeMemberId, setActiveMemberId] = useState(
    () => localStorage.getItem("vf-active-member") || "",
  );
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoreStage, setRestoreStage] = useState<TransferStage>("uploading");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api
      .system()
      .then(setSystem)
      .catch(() => {});
    api
      .members()
      .then((items) => {
        setMembers(items);
        if (!activeMemberId && items[0]) setActiveMemberId(items[0].id);
      })
      .catch(() => {});
    api
      .activity()
      .then(setActivityLog)
      .catch(() => {});
  }, []);
  const restore = async (file?: File) => {
    if (
      !file ||
      !confirm(
        "Restore akan mengganti database aktif dan menimpa file dari backup. Safety copy akan dibuat otomatis. Lanjutkan?",
      )
    )
      return;
    setRestoring(true);
    setRestoreProgress(0);
    setRestoreStage("uploading");
    try {
      const result = await api.restore(file, setRestoreProgress, () =>
        setRestoreStage("processing"),
      );
      notify(
        `Restore selesai · ${result.projects} projects · safety copy dibuat`,
      );
      await onRestored();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Restore gagal");
    } finally {
      setRestoring(false);
      if (input.current) input.current.value = "";
    }
  };
  const gb = (bytes: number) => (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
  const addMember = async () => {
    const name = prompt("Nama anggota")?.trim();
    if (!name) return;
    const email = prompt("Email anggota")?.trim();
    if (!email) return;
    const password = prompt("Password awal (minimal 8 karakter)") || "";
    if (password.length < 8) {
      notify("Password minimal 8 karakter");
      return;
    }
    try {
      const created = await api.createMember({
        name,
        email,
        role: "annotator",
        password,
      });
      setMembers((current) => [...current, created]);
      notify("Anggota workspace ditambahkan");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Gagal menambah anggota");
    }
  };
  const activateMember = (member: WorkspaceMember) => {
    localStorage.setItem("vf-active-member", member.id);
    localStorage.setItem("vf-active-role", member.role);
    localStorage.setItem("vf-active-name", member.name);
    setActiveMemberId(member.id);
    notify(`Active account: ${member.name} (${member.role})`);
  };
  const permissionRows = [
    ["View projects & reports", true, true, true, true],
    ["Upload & annotate data", true, true, true, false],
    ["Versions, training & deploy", true, true, false, false],
    ["Members & recovery", true, true, false, false],
  ];
  return (
    <div className="content settings-page">
      <div className="project-title">
        <div>
          <span className="eyebrow">LOCAL WORKSPACE</span>
          <h1>System & recovery</h1>
          <p>Inspect local resources and protect the complete workspace.</p>
        </div>
      </div>
      {system && (
        <div className="system-grid">
          <section className="panel">
            <Database />
            <h3>Storage</h3>
            <b>{gb(system.disk.free)} free</b>
            <div className="storage-bar">
              <i
                style={{
                  width: (system.disk.used / system.disk.total) * 100 + "%",
                }}
              />
            </div>
            <small>
              {gb(system.disk.used)} used of {gb(system.disk.total)}
            </small>
          </section>
          <section className="panel">
            <BrainCircuit />
            <h3>Compute</h3>
            <b>{system.gpu.available ? system.gpu.name : "CPU mode"}</b>
            <small>
              {system.gpu.available
                ? `${system.gpu.count} CUDA device(s)`
                : "No CUDA GPU detected"}
            </small>
          </section>
          <section className="panel">
            <Layers3 />
            <h3>Workspace</h3>
            <b>{system.data.projects || 0} projects</b>
            <small>
              {system.data.assets || 0} assets · {system.data.models || 0}{" "}
              models
            </small>
          </section>
        </div>
      )}
      <div className="recovery-grid">
        <section className="panel">
          <Download />
          <div>
            <h2>Backup workspace</h2>
            <p>
              Download SQLite, images, versions, model weights, and manifest as
              one ZIP.
            </p>
          </div>
          <a className="primary" href={api.backupUrl} download>
            Download complete backup
          </a>
        </section>
        <section className="panel danger-zone">
          <Upload />
          <div>
            <h2>Restore workspace</h2>
            <p>
              Validates the backup and creates a safety database copy before
              replacement.
            </p>
            {restoring && (
              <TransferProgress
                percent={restoreProgress}
                stage={restoreStage}
                label="Uploading backup ZIP"
              />
            )}
          </div>
          <button
            className="secondary"
            disabled={restoring}
            onClick={() => input.current?.click()}
          >
            {restoring ? "Restoring…" : "Select backup ZIP"}
          </button>
          <input
            hidden
            ref={input}
            type="file"
            accept=".zip,application/zip"
            onChange={(e) => restore(e.target.files?.[0])}
          />
        </section>
      </div>
      <section className="panel members-panel">
        <div className="panel-head">
          <div>
            <h2>Workspace members</h2>
            <p>
              Local roles prepare datasets for owner, admin, annotator, and
              viewer workflows.
            </p>
          </div>
          <button className="primary small" onClick={addMember}>
            <Plus />
            Add member
          </button>
        </div>
        <div className="member-list">
          {members.map((member) => (
            <div key={member.id}>
              <span className="member-avatar">
                {member.name.slice(0, 2).toUpperCase()}
              </span>
              <span>
                <b>{member.name}</b>
                <small>{member.email}</small>
              </span>
              <select
                value={member.role}
                onChange={async (e) => {
                  try {
                    const updated = await api.updateMember(member.id, {
                      name: member.name,
                      email: member.email,
                      role: e.target.value,
                    });
                    setMembers((current) =>
                      current.map((item) =>
                        item.id === member.id ? updated : item,
                      ),
                    );
                  } catch (error) {
                    notify(
                      error instanceof Error
                        ? error.message
                        : "Gagal mengubah role",
                    );
                  }
                }}
              >
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="annotator">Annotator</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                className={activeMemberId === member.id ? "active-member" : ""}
                onClick={() => activateMember(member)}
              >
                {activeMemberId === member.id ? "Active" : "Use account"}
              </button>
              <button
                onClick={async () => {
                  const password =
                    prompt("Password baru (minimal 8 karakter)") || "";
                  if (password.length < 8) return;
                  try {
                    const updated = await api.updateMember(member.id, {
                      name: member.name,
                      email: member.email,
                      role: member.role,
                      password,
                    });
                    setMembers((current) =>
                      current.map((item) =>
                        item.id === member.id ? updated : item,
                      ),
                    );
                    notify("Password anggota diperbarui");
                  } catch (error) {
                    notify(
                      error instanceof Error
                        ? error.message
                        : "Gagal mengubah password",
                    );
                  }
                }}
              >
                Password
              </button>
              <button
                className="delete"
                onClick={async () => {
                  if (!confirm(`Hapus ${member.name} dari workspace?`)) return;
                  try {
                    await api.deleteMember(member.id);
                    setMembers((current) =>
                      current.filter((item) => item.id !== member.id),
                    );
                  } catch (error) {
                    notify(
                      error instanceof Error
                        ? error.message
                        : "Gagal menghapus anggota",
                    );
                  }
                }}
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      </section>
      <div className="workspace-governance">
        <section className="panel permission-panel">
          <div className="panel-head">
            <div>
              <h2>Role permissions</h2>
              <p>Mutation requests are enforced by the local API.</p>
            </div>
          </div>
          <div className="permission-table">
            <div>
              <b>Capability</b>
              <b>Owner</b>
              <b>Admin</b>
              <b>Annotator</b>
              <b>Viewer</b>
            </div>
            {permissionRows.map(([label, ...roles]) => (
              <div key={String(label)}>
                <span>{String(label)}</span>
                {roles.map((allowed, index) => (
                  <span key={index}>{allowed ? <Check /> : "—"}</span>
                ))}
              </div>
            ))}
          </div>
        </section>
        <section className="panel activity-panel">
          <div className="panel-head">
            <div>
              <h2>Workspace activity</h2>
              <p>Latest project, dataset, version, and model events.</p>
            </div>
            <History />
          </div>
          <div className="activity-list">
            {activityLog.slice(0, 12).map((entry) => (
              <div key={entry.id}>
                <i />
                <span>
                  <b>{entry.action.replaceAll(".", " ")}</b>
                  <small>{entry.detail || "Workspace updated"}</small>
                </span>
                <time>{entry.createdAt.slice(0, 16).replace("T", " ")}</time>
              </div>
            ))}
            {!activityLog.length && <p>No activity recorded yet.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}

export default App;
