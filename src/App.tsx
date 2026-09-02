import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import {
  Activity,
  Archive,
  ArrowLeft,
  BarChart3,
  Bell,
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
  Eye,
  FlaskConical,
  FolderKanban,
  GalleryHorizontalEnd,
  History,
  Home,
  Image as ImageIcon,
  Keyboard,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Network,
  Pencil,
  PenTool,
  Play,
  Plus,
  Redo2,
  Rocket,
  Search,
  Send,
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
  AdvanceCategory,
  AdvanceJob,
  AnnotationJob,
  AuthStatus,
  DatasetHealth,
  DatasetHealthProgress,
  EvaluationArtifact,
  GlobalJob,
  ModelEvaluation,
  ProjectCollaboration,
  TrainingWorker,
  WorkflowNode,
  WorkflowRun,
  WorkspaceMember,
  WorkspaceNotification,
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
  | "advance"
  | "models"
  | "templates"
  | "settings";
type TrainingRoute = "this-pc" | "own-device" | "nas" | "colab";
type SetupPlatform = "windows" | "linux";

function SupernovaMark({ className = "" }: { className?: string }) {
  return (
    <span className={`supernova-mark ${className}`} aria-hidden="true">
      <i className="supernova-core" />
      <i className="supernova-flare flare-a" />
      <i className="supernova-flare flare-b" />
      <i className="supernova-ring" />
    </span>
  );
}

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
const modelCanDeploy = (model: Model) =>
  model.deployable ?? model.status === "ready";
const copyText = async (value: string) => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the HTTP/LAN-compatible copy method below.
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  return copied;
};
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
      "advance",
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

const augmentationPreviewStyle = (
  key: string,
  amount: number,
): CSSProperties => {
  const styles: CSSProperties = {};
  if (key === "horizontalFlip") styles.transform = "scaleX(-1)";
  if (key === "verticalFlip") styles.transform = "scaleY(-1)";
  if (key === "rotate") styles.transform = `scale(0.82) rotate(${amount}deg)`;
  if (key === "translate")
    styles.transform = `scale(0.82) translate(${amount / 2}%, ${amount / 3}%)`;
  if (key === "shear")
    styles.transform = `scale(0.82) skew(${amount}deg, ${amount / 2}deg)`;
  if (key === "crop") styles.transform = `scale(${1 + amount / 55})`;
  if (key === "brightness") styles.filter = `brightness(${1 + amount / 100})`;
  if (key === "contrast") styles.filter = `contrast(${1 + amount / 100})`;
  if (key === "saturation") styles.filter = `saturate(${1 + amount / 50})`;
  if (key === "hue") styles.filter = `hue-rotate(${amount}deg)`;
  if (key === "grayscale") styles.filter = "grayscale(1)";
  if (key === "blur") styles.filter = `blur(${amount}px)`;
  if (key === "sharpen")
    styles.filter = `contrast(${1 + amount / 8}) saturate(${1 + amount / 12})`;
  if (key === "jpeg") {
    styles.filter = `contrast(${1 + (100 - amount) / 180}) saturate(${Math.max(0.55, amount / 80)})`;
    styles.imageRendering = "pixelated";
  }
  return styles;
};
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
  registrationAllowed,
  onAuthenticated,
}: {
  setup: boolean;
  registrationAllowed: boolean;
  onAuthenticated: () => Promise<void>;
}) {
  const [authMode, setAuthMode] = useState<"signin" | "signup">(
    setup ? "signup" : "signin",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"otp" | "password">("password");
  const [setupStep, setSetupStep] = useState<"email" | "profile">("email");
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (authMode === "signup") await api.register(name, email, password);
      else await api.login(email, password);
      await onAuthenticated();
      return;
      /* Legacy OTP flow retained behind the API for compatibility. */
      if (mode === "otp" && setup && setupStep === "profile") {
        await api.bootstrapAuth({ name, email, password });
        await onAuthenticated();
        return;
      }
      if (mode === "otp") {
        if (!otpSent) {
          const response = await api.requestOtp(
            email,
            setup ? name : undefined,
          );
          setOtpSent(true);
          setDevCode(response.devCode || "");
          return;
        }
        await api.verifyOtp(email, code, setup ? name : undefined);
        if (setup) {
          setSetupStep("profile");
          setPassword("");
          return;
        }
      } else {
        if (setup) await api.bootstrapAuth({ name, email, password });
        await api.login(email, password);
      }
      await onAuthenticated();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Login gagal");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <div className="auth-supernova" aria-hidden="true">
        <div className="auth-supernova-cloud cloud-one" />
        <div className="auth-supernova-cloud cloud-two" />
        <div className="auth-supernova-stars" />
        <SupernovaMark className="auth-supernova-mark" />
      </div>
      <form className="auth-card" onSubmit={submit}>
        <span className="brand-mark">
          <SupernovaMark />
        </span>
        <span className="eyebrow">SALNOVA SECURE WORKSPACE</span>
        <h1>
          {authMode === "signup" ? "Buat akun baru" : "Selamat datang kembali"}
        </h1>
        <p>
          {authMode === "signup"
            ? "Daftarkan username, email, dan password untuk menggunakan Salnova."
            : "Sign In memakai akun yang sudah pernah didaftarkan."}
        </p>
        {authMode === "signup" && (
          <label>
            Username akun
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              minLength={2}
              maxLength={80}
              required
              autoFocus
            />
          </label>
        )}
        {false && (
          <div className="auth-methods">
            <button
              type="button"
              className={mode === "otp" ? "active" : ""}
              onClick={() => {
                setMode("otp");
                setError("");
              }}
            >
              Gmail OTP
            </button>
            <button
              type="button"
              className={mode === "password" ? "active" : ""}
              onClick={() => {
                setMode("password");
                setError("");
              }}
            >
              Password
            </button>
          </div>
        )}
        <label>
          Email
          <input
            type="email"
            value={email}
            disabled={mode === "otp" && otpSent}
            placeholder="nama@example.com"
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        {setup && setupStep === "profile" ? (
          <label>
            Password akun
            <input
              type="password"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={
                authMode === "signup" ? "new-password" : "current-password"
              }
              required
              autoFocus
            />
          </label>
        ) : mode === "otp" && otpSent ? (
          <>
            <label>
              Kode OTP 6 digit
              <input
                className="otp-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                placeholder="000000"
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                required
                autoFocus
              />
            </label>
            <p className="otp-delivery">
              Kode dikirim ke <b>{email}</b> dan berlaku selama 10 menit.
              {devCode && <small>Development OTP: {devCode}</small>}
            </p>
            <button
              type="button"
              className="auth-back"
              onClick={() => {
                setOtpSent(false);
                setCode("");
                setDevCode("");
              }}
            >
              Ganti email atau kirim ulang
            </button>
          </>
        ) : mode === "password" ? (
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
        ) : (
          <p className="otp-hint">
            Kami akan mengirim kode sekali pakai melalui Gmail. Tidak perlu
            mengingat password.
          </p>
        )}
        {error && <p className="auth-error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy
            ? "Mohon tunggu…"
            : authMode === "signup"
              ? "Daftar & masuk"
              : "Sign In"}
        </button>
        {(registrationAllowed || authMode === "signup") && (
          <p className="auth-switch">
            {authMode === "signin"
              ? "Belum memiliki akun?"
              : "Sudah memiliki akun?"}{" "}
            <button
              type="button"
              onClick={() => {
                setAuthMode((current) =>
                  current === "signin" ? "signup" : "signin",
                );
                setError("");
                setPassword("");
              }}
            >
              {authMode === "signin" ? "Buat akun baru" : "Kembali ke Sign In"}
            </button>
          </p>
        )}
      </form>
    </main>
  );
}

type AssistantUiMessage = {
  role: "user" | "assistant";
  content: string;
};

function GeminiAssistant({
  page,
  project,
  member,
}: {
  page: Page;
  project?: Project;
  member?: AuthStatus["member"];
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<AssistantUiMessage[]>([
    {
      role: "assistant",
      content:
        "Halo! Saya siap membantu memakai Salnova. Tanyakan tentang dataset, training, deployment, atau inference.",
    },
  ]);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [open, messages, busy]);
  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || busy) return;
    const nextMessages = [...messages, { role: "user" as const, content }];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);
    try {
      const response = await api.assistantChat(
        nextMessages.slice(-12),
        [
          `halaman=${page}`,
          project ? `project=${project.name}` : "project=tidak dipilih",
          member
            ? `pengguna=${member.name}, role=${member.role}`
            : "pengguna=unknown",
        ].join("; "),
      );
      setMessages((current) => [
        ...current,
        { role: "assistant", content: response.reply },
      ]);
    } catch (chatError) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            chatError instanceof Error
              ? chatError.message
              : "Chatbot sedang tidak dapat dihubungi.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`gemini-assistant ${open ? "open" : ""}`}>
      {open && (
        <section className="gemini-panel" aria-label="Salnova AI Assistant">
          <header>
            <span className="gemini-avatar">
              <Sparkles />
            </span>
            <div>
              <b>Salnova Assistant</b>
              <small>Powered by Gemini</small>
            </div>
            <button
              type="button"
              aria-label="Tutup chatbot"
              onClick={() => setOpen(false)}
            >
              <X />
            </button>
          </header>
          <div className="gemini-messages" aria-live="polite">
            {messages.map((message, index) => (
              <div className={`gemini-message ${message.role}`} key={index}>
                {message.content}
              </div>
            ))}
            {busy && (
              <div className="gemini-message assistant typing">
                <i />
                <i />
                <i />
              </div>
            )}
            <div ref={endRef} />
          </div>
          <form onSubmit={sendMessage}>
            <textarea
              value={input}
              maxLength={4000}
              rows={2}
              placeholder="Tanyakan cara menggunakan Salnova..."
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Kirim pesan"
            >
              <Send />
            </button>
          </form>
          <small className="gemini-note">
            Gemini dapat membuat kesalahan. Periksa kembali konfigurasi penting.
          </small>
        </section>
      )}
      <button
        type="button"
        className="gemini-launcher"
        aria-label={open ? "Tutup chatbot" : "Buka chatbot"}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <X /> : <MessageCircle />}
      </button>
    </div>
  );
}

function WorkspaceBoot({
  member,
  failed,
  progress,
  retry,
  switchAccount,
}: {
  member?: AuthStatus["member"];
  failed?: boolean;
  progress: number;
  retry: () => void;
  switchAccount: () => void;
}) {
  return (
    <main className="workspace-boot">
      <section className="workspace-boot-card">
        <span className="brand-mark">
          <Boxes />
        </span>
        <span className="eyebrow">SALNOVA SECURE WORKSPACE</span>
        {failed ? (
          <>
            <h1>Workspace belum siap</h1>
            <p>
              Backend belum dapat memuat project. Pastikan API sudah aktif lalu
              coba kembali.
            </p>
          </>
        ) : (
          <>
            <LoaderCircle className="workspace-boot-spinner" />
            <h1>Menyiapkan workspace{member?.name ? ` ${member.name}` : ""}</h1>
            <p>
              Memuat project, dataset, model, deployment, dan tutorial. Halaman
              akan terbuka otomatis setelah semuanya siap.
            </p>
          </>
        )}
        <div className="workspace-boot-steps">
          <span className="done">
            <Check /> Sesi login terverifikasi
          </span>
          <span className={failed ? "failed" : "active"}>
            {failed ? <X /> : <LoaderCircle />} Memuat data dari backend
          </span>
          <span>
            <CircleHelp /> Menyiapkan tutorial dan halaman project
          </span>
        </div>
        {!failed && (
          <div className="workspace-boot-progress">
            <div>
              <i style={{ width: `${progress}%` }} />
            </div>
            <b>{progress}%</b>
          </div>
        )}
        {failed && (
          <button className="primary" type="button" onClick={retry}>
            Coba lagi
          </button>
        )}
        <button
          className="workspace-switch-account"
          type="button"
          onClick={switchAccount}
        >
          Gunakan akun lain
        </button>
      </section>
    </main>
  );
}

function AccountResume({
  member,
  proceed,
  switchAccount,
}: {
  member: NonNullable<AuthStatus["member"]>;
  proceed: () => void;
  switchAccount: () => void;
}) {
  return (
    <main className="auth-page">
      <div className="auth-supernova" aria-hidden="true">
        <div className="auth-supernova-cloud cloud-one" />
        <div className="auth-supernova-cloud cloud-two" />
        <div className="auth-supernova-stars" />
        <SupernovaMark className="auth-supernova-mark" />
      </div>
      <section className="auth-card account-resume-card">
        <span className="brand-mark">
          <SupernovaMark />
        </span>
        <span className="eyebrow">SALNOVA SECURE WORKSPACE</span>
        <h1>Lanjutkan sesi?</h1>
        <p>Pilih akun sebelum Salnova memuat workspace.</p>
        <div className="account-resume-identity">
          <span>{member.name.slice(0, 2).toUpperCase()}</span>
          <div>
            <b>{member.name}</b>
            <small>{member.email}</small>
          </div>
        </div>
        <button className="primary" type="button" onClick={proceed}>
          Lanjut sebagai {member.name}
        </button>
        <button
          className="workspace-switch-account"
          type="button"
          onClick={switchAccount}
        >
          Gunakan akun lain
        </button>
      </section>
    </main>
  );
}

// Matched against a project's demoKey, not its id: every member gets their own
// private copy of the tutorial projects, so the ids differ per account while the
// key stays the same. Falling back to the id keeps the original seed projects
// working on installs that predate per-account copies.
const TOUR_PROJECTS = {
  detection: { key: "e2e-coco8-detection-20260828-153649-2637" },
  instance: { key: "e2e-coco8-instance-segmentation-20260829-tour-5af4" },
  semantic: { key: "e2e-coco8-semantic-segmentation-20260829-175031-3006" },
  obb: { key: "e2e-obb-20260829-181530-0418" },
  keypoint: { key: "e2e-coco8-pose-20260829-182820-485e" },
  single: { key: "e2e-single-label-20260829-181530-cc1b" },
  multi: { key: "e2e-multi-label-20260829-182820-77f6" },
} as const;
type TourProjectKey = keyof typeof TOUR_PROJECTS;
type TourStep = {
  page: Page;
  projectKey?: TourProjectKey;
  eyebrow: string;
  title: string;
  description: string;
};

const ONBOARDING_TOUR: TourStep[] = [
  {
    page: "dashboard",
    eyebrow: "1 · DASHBOARD",
    title: "Selamat datang di Salnova",
    description:
      "Tutorial dimulai dari Dashboard dan akan membawa Anda melihat tujuh jenis project computer vision, dari dataset sampai hasil deployment.",
  },
  {
    page: "project",
    projectKey: "detection",
    eyebrow: "2 · OBJECT DETECTION",
    title: "Deteksi objek dengan bounding box",
    description:
      "Ini adalah project Object Detection lengkap yang sudah melewati import data, training, dan deployment.",
  },
  {
    page: "dataset",
    projectKey: "detection",
    eyebrow: "3 · DATASET",
    title: "Periksa gambar dan bounding box",
    description:
      "Dataset berisi delapan gambar COCO8 nyata dan anotasi objek yang menjadi sumber pembelajaran model.",
  },
  {
    page: "annotate",
    projectKey: "instance",
    eyebrow: "4 · INSTANCE SEGMENTATION",
    title: "Pisahkan setiap objek dengan polygon mask",
    description:
      "Instance Segmentation memberi mask terpisah pada setiap objek, sehingga dua objek dengan class sama tetap dapat dibedakan.",
  },
  {
    page: "annotate",
    projectKey: "semantic",
    eyebrow: "5 · SEMANTIC SEGMENTATION",
    title: "Petakan area gambar per class",
    description:
      "Semantic Segmentation mewarnai setiap pixel berdasarkan class area. Periksa mask, class, dan dataset version yang sudah dibuat.",
  },
  {
    page: "annotate",
    projectKey: "obb",
    eyebrow: "6 · ORIENTED BOUNDING BOX",
    title: "Deteksi objek yang berotasi",
    description:
      "OBB menggunakan empat titik sudut agar kotak mengikuti arah objek. Ini cocok untuk drone, dokumen, dan objek miring.",
  },
  {
    page: "annotate",
    projectKey: "keypoint",
    eyebrow: "7 · KEYPOINT DETECTION",
    title: "Temukan pose dan titik penting",
    description:
      "Keypoint Detection mempelajari titik yang berurutan, seperti 17 titik tubuh manusia pada COCO Pose.",
  },
  {
    page: "annotate",
    projectKey: "single",
    eyebrow: "8 · SINGLE-LABEL CLASSIFICATION",
    title: "Pilih satu class untuk setiap gambar",
    description:
      "Single-Label Classification menetapkan tepat satu class utama. Hasil training ditampilkan sebagai Top-1 accuracy.",
  },
  {
    page: "annotate",
    projectKey: "multi",
    eyebrow: "9 · MULTI-LABEL CLASSIFICATION",
    title: "Pilih beberapa label sekaligus",
    description:
      "Multi-Label Classification memungkinkan satu gambar memiliki beberapa label. Label tersimpan otomatis dan dataset dapat diekspor.",
  },
  {
    page: "train",
    projectKey: "detection",
    eyebrow: "10 · TRAINING RESULTS",
    title: "Baca epoch, loss, F1, precision, dan recall",
    description:
      "Buka subbagian hasil training untuk melihat ringkasan metrik, kurva, confusion matrix, serta gambar train dan validation batch.",
  },
  {
    page: "registry",
    projectKey: "detection",
    eyebrow: "11 · MODEL REGISTRY",
    title: "Kelola best.pt dan lifecycle model",
    description:
      "Model Registry menyimpan checkpoint, metrik, download weights, resume, fine-tuning, export, dan status production.",
  },
  {
    page: "deploy",
    projectKey: "detection",
    eyebrow: "12 · DEPLOYMENT",
    title: "Jalankan inference objek nyata",
    description:
      "Model production dimuat dari best.pt. Uji gambar, video, atau webcam untuk melihat bounding box, class, dan confidence.",
  },
];

function OnboardingTour({
  steps,
  step,
  project,
  next,
  previous,
  finish,
}: {
  steps: TourStep[];
  step: number;
  project?: Project;
  next: () => void;
  previous: () => void;
  finish: () => Promise<void>;
}) {
  const item = steps[step];
  const model =
    project?.models.find((candidate) => candidate.stage === "production") ||
    project?.models.at(-1);
  return (
    <div className="onboarding-layer" role="dialog" aria-modal="true">
      <div className="onboarding-spotlight" />
      <aside className="onboarding-card">
        <header>
          <span>{item.eyebrow}</span>
          <small>
            {step + 1}/{steps.length}
          </small>
        </header>
        <div className="tour-progress">
          {steps.map((_, index) => (
            <i className={index <= step ? "active" : ""} key={index} />
          ))}
        </div>
        <h2>{item.title}</h2>
        <p>{item.description}</p>
        {item.projectKey && project && (
          <div className="tour-project-context">
            <span>{project.type}</span>
            <b>{project.name}</b>
          </div>
        )}
        {item.page === "project" && project && (
          <div className="tour-facts">
            <span>
              <b>{project.assets.length}</b> images
            </span>
            <span>
              <b>
                {project.assets.reduce(
                  (total, asset) => total + asset.boxes.length,
                  0,
                )}
              </b>{" "}
              boxes
            </span>
            <span>
              <b>{project.classes.length}</b> classes
            </span>
          </div>
        )}
        {step === steps.length - 1 && model && (
          <div className="tour-deploy-result">
            <Rocket />
            <span>
              <b>{model.alias || model.name}</b>
              <small>
                Production · mAP50 {model.map}% · precision {model.precision}%
              </small>
            </span>
          </div>
        )}
        <footer>
          <button className="ghost" onClick={() => void finish()}>
            Lewati tutorial
          </button>
          <span>
            {step > 0 && <button onClick={previous}>Kembali</button>}
            {step < steps.length - 1 ? (
              <button className="primary" onClick={next}>
                Lanjut <ChevronRight />
              </button>
            ) : (
              <button className="primary" onClick={() => void finish()}>
                Selesai <Check />
              </button>
            )}
          </span>
        </footer>
      </aside>
    </div>
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
  const [jobCenter, setJobCenter] = useState(false);
  const [jobs, setJobs] = useState<GlobalJob[]>([]);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>(
    [],
  );
  const [backend, setBackend] = useState<"checking" | "online" | "offline">(
    "checking",
  );
  const [workspaceReload, setWorkspaceReload] = useState(0);
  const [bootProgress, setBootProgress] = useState(20);
  const [toast, setToast] = useState("");
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [sessionConfirmed, setSessionConfirmed] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [manualTour, setManualTour] = useState(false);
  const inviteHandled = useRef("");
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
      .then((status) => {
        setAuth(status);
        // A valid httpOnly session cookie is already proof of authentication.
        // Do not ask the same user to confirm their saved account after every
        // browser refresh; reserve the account chooser for an explicit switch.
        setSessionConfirmed(Boolean(status.member));
      })
      // Never fall through to the workspace when the auth backend is
      // unreachable. A failed status check must remain a locked state.
      .catch(() => {
        setSessionConfirmed(false);
        setAuth({ required: true, setupRequired: false, member: null });
      });
  }, []);
  useEffect(() => {
    if (!auth || (auth.required && (!auth.member || !sessionConfirmed))) return;
    let cancelled = false;
    setBackend("checking");
    setBootProgress(24);
    const progressTimer = window.setInterval(
      () => setBootProgress((current) => Math.min(92, current + 3)),
      280,
    );
    api
      .projects()
      .then((remote) => {
        if (cancelled) return;
        setProjects(remote);
        if (auth.member?.onboardingCompleted === false) {
          setPage("dashboard");
          window.location.hash = "/dashboard";
        } else {
          setSelectedId((current) =>
            remote.some((project) => project.id === current)
              ? current
              : remote[0]?.id || "",
          );
        }
        setBootProgress(100);
        window.setTimeout(() => {
          if (!cancelled) setBackend("online");
        }, 280);
      })
      .catch(() => {
        if (!cancelled) setBackend("offline");
      })
      .finally(() => window.clearInterval(progressTimer));
    return () => {
      cancelled = true;
      window.clearInterval(progressTimer);
    };
  }, [auth?.required, auth?.member?.id, sessionConfirmed, workspaceReload]);
  useEffect(() => {
    if (backend !== "online" || !auth?.member) return;
    const url = new URL(window.location.href);
    const inviteCode = (url.searchParams.get("invite") || "").toUpperCase();
    if (
      !/^[A-Z0-9]{8}$/.test(inviteCode) ||
      inviteHandled.current === inviteCode
    )
      return;
    inviteHandled.current = inviteCode;
    api
      .requestProjectJoin(inviteCode)
      .then((result) => {
        notify(
          result.status === "accepted"
            ? "Anda sudah menjadi kolaborator project"
            : "Permintaan bergabung dikirim. Tunggu persetujuan kolaborator.",
        );
        url.searchParams.delete("invite");
        window.history.replaceState(
          {},
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
      })
      .catch((joinError) => {
        inviteHandled.current = "";
        notify(
          joinError instanceof Error
            ? joinError.message
            : "Undangan tidak dapat diproses",
        );
      });
  }, [backend, auth?.member?.id]);
  useEffect(() => {
    if (backend !== "online") return;
    let cancelled = false;
    const loadJobs = () =>
      Promise.all([api.jobs(), api.notifications()])
        .then(([nextJobs, nextNotifications]) => {
          if (!cancelled) {
            setJobs(nextJobs);
            setNotifications(nextNotifications);
          }
        })
        .catch(() => {});
    loadJobs();
    const timer = window.setInterval(loadJobs, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [backend]);
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
  useEffect(() => {
    if (
      backend !== "online" ||
      !PROJECT_PAGES.includes(page) ||
      !project?.summary
    )
      return;
    let cancelled = false;
    api
      .project(project.id)
      .then((loaded) => {
        if (cancelled) return;
        setProjects((current) =>
          current.map((item) => (item.id === loaded.id ? loaded : item)),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setToast(
          error instanceof Error
            ? error.message
            : "Gagal memuat detail project",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [backend, page, project?.id, project?.summary]);
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
  /* Redeeming a code is a workspace-level action, not a project-level one: the
     project being joined is by definition one the member cannot open yet. */
  const joinWithCode = async (raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) {
      notify("Kode undangan harus terdiri dari 8 karakter");
      return false;
    }
    try {
      const result = await api.requestProjectJoin(code);
      if (result.status === "accepted") {
        // Already a collaborator, so the project is visible now: reload the list
        // rather than leaving the member staring at a dashboard without it.
        setProjects(await api.projects());
        notify("Anda sudah menjadi kolaborator project");
      } else {
        notify("Join request terkirim. Pengundang akan melihatnya otomatis.");
      }
      return true;
    } catch (joinError) {
      notify(
        joinError instanceof Error
          ? joinError.message
          : "Kode undangan gagal diproses",
      );
      return false;
    }
  };
  const resolvedTourProjects = useMemo(() => {
    const result = {} as Partial<Record<TourProjectKey, Project>>;
    (
      Object.entries(TOUR_PROJECTS) as Array<
        [TourProjectKey, (typeof TOUR_PROJECTS)[TourProjectKey]]
      >
    ).forEach(([key, target]) => {
      result[key] = projects.find(
        (candidate) =>
          !candidate.archived &&
          (candidate.demoKey === target.key || candidate.id === target.key),
      );
    });
    return result;
  }, [projects]);
  const tourSteps = useMemo(
    () =>
      ONBOARDING_TOUR.filter(
        (item) =>
          !item.projectKey || Boolean(resolvedTourProjects[item.projectKey]),
      ),
    [resolvedTourProjects],
  );
  const activeTourStep = tourSteps[tourStep];
  const tourProject = activeTourStep?.projectKey
    ? resolvedTourProjects[activeTourStep.projectKey]
    : undefined;
  const tourActive = Boolean(
    auth?.member &&
    (auth.member.onboardingCompleted === false || manualTour) &&
    backend === "online" &&
    activeTourStep,
  );
  useEffect(() => {
    if (!tourActive || !activeTourStep) return;
    if (activeTourStep.page === "dashboard") {
      go("dashboard");
      return;
    }
    if (tourProject) go(activeTourStep.page, tourProject.id);
  }, [tourActive, activeTourStep?.page, tourProject?.id, tourStep]);
  const finishTour = async () => {
    if (auth?.member?.onboardingCompleted === false) {
      const member = await api.completeOnboarding();
      setAuth((current) => (current ? { ...current, member } : current));
    }
    setManualTour(false);
    notify("Tutorial selesai. Anda dapat membukanya kembali dari Dashboard.");
  };
  const startTour = () => {
    const projectCount =
      Object.values(resolvedTourProjects).filter(Boolean).length;
    if (!projectCount) {
      notify("Project contoh belum tersedia untuk menjalankan tutorial");
      return;
    }
    setTourStep(0);
    setManualTour(true);
    if (projectCount < Object.keys(TOUR_PROJECTS).length) {
      notify(
        `Tutorial dimulai dengan ${projectCount} tipe project yang tersedia`,
      );
    }
  };
  const switchAccount = async () => {
    await api.logout().catch(() => undefined);
    setSessionConfirmed(false);
    setBackend("checking");
    setBootProgress(20);
    setAuth(await api.authStatus());
  };
  if (!auth) return <div className="auth-loading">Loading Salnova...</div>;
  if (auth.required && !auth.member)
    return (
      <AuthGate
        setup={auth.setupRequired}
        registrationAllowed={auth.registrationAllowed !== false}
        onAuthenticated={async () => {
          setAuth(await api.authStatus());
          setSessionConfirmed(true);
        }}
      />
    );
  if (auth.required && auth.member && !sessionConfirmed)
    return (
      <AccountResume
        member={auth.member}
        proceed={() => setSessionConfirmed(true)}
        switchAccount={switchAccount}
      />
    );
  if (backend === "checking")
    return (
      <WorkspaceBoot
        member={auth.member}
        progress={bootProgress}
        retry={() => setWorkspaceReload((current) => current + 1)}
        switchAccount={switchAccount}
      />
    );
  if (backend === "offline")
    return (
      <WorkspaceBoot
        member={auth.member}
        failed
        progress={bootProgress}
        retry={() => setWorkspaceReload((current) => current + 1)}
        switchAccount={switchAccount}
      />
    );
  return (
    <div className="app">
      <Sidebar
        page={page}
        go={go}
        onHelp={() => setHelp(true)}
        onProfile={() => setProfile((value) => !value)}
        member={auth.member}
      />
      <main>
        <Topbar
          page={page}
          project={PROJECT_PAGES.includes(page) ? project : undefined}
          backend={backend}
          member={auth.member}
          onBack={() => go(page === "project" ? "dashboard" : "project")}
          onSearch={() => setPalette(true)}
          onHelp={() => setHelp(true)}
          unreadNotifications={
            notifications.filter((item) => !item.read).length
          }
          onJobs={() => setJobCenter((value) => !value)}
          onProfile={() => setProfile((value) => !value)}
        />
        {jobCenter && (
          <JobCenter
            jobs={jobs}
            notifications={notifications}
            close={() => setJobCenter(false)}
            openTarget={async (target, notificationId) => {
              if (notificationId) {
                await api
                  .readNotification(notificationId)
                  .catch(() => undefined);
                setNotifications((current) =>
                  current.map((item) =>
                    item.id === notificationId ? { ...item, read: true } : item,
                  ),
                );
              }
              if (target) window.location.hash = target.replace(/^#/, "");
              setJobCenter(false);
            }}
            readAll={async () => {
              await api.readAllNotifications();
              setNotifications((current) =>
                current.map((item) => ({ ...item, read: true })),
              );
            }}
          />
        )}
        {page === "dashboard" && (
          <Dashboard
            projects={projects}
            go={go}
            create={() => setModal(true)}
            startTour={startTour}
            join={joinWithCode}
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
            remove={async (target) => {
              if (
                !confirm(
                  `Hapus project "${target.name}" beserta seluruh gambar, anotasi, versi, dan model? Tindakan ini tidak dapat dibatalkan.`,
                )
              )
                return;
              try {
                await api.deleteProject(target.id);
                const remaining = projects.filter(
                  (item) => item.id !== target.id,
                );
                setProjects(remaining);
                if (selectedId === target.id) {
                  setSelectedId(remaining[0]?.id || "");
                }
                notify("Project dan seluruh file berhasil dihapus");
              } catch (error) {
                notify(
                  error instanceof Error
                    ? error.message
                    : "Gagal menghapus project",
                );
              }
            }}
          />
        )}
        {page === "advance" && (
          <AdvanceWorkspace
            projects={projects}
            go={go}
            notify={notify}
            onProjectUpdated={(loaded) =>
              setProjects((current) =>
                current.map((item) => (item.id === loaded.id ? loaded : item)),
              )
            }
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
          <ProjectInsights
            project={project}
            go={go}
            notify={notify}
            update={update}
          />
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
          uploadPhoto={async (file) => {
            try {
              const member = await api.uploadProfilePhoto(file);
              setAuth((current) =>
                current ? { ...current, member } : current,
              );
              notify("Foto profil berhasil diperbarui");
            } catch (error) {
              notify(
                error instanceof Error
                  ? error.message
                  : "Foto profil gagal diunggah",
              );
            }
          }}
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
      <GeminiAssistant page={page} project={project} member={auth.member} />
      {tourActive && activeTourStep && (
        <OnboardingTour
          steps={tourSteps}
          step={tourStep}
          project={tourProject}
          previous={() => setTourStep((current) => Math.max(0, current - 1))}
          next={() =>
            setTourStep((current) =>
              Math.min(tourSteps.length - 1, current + 1),
            )
          }
          finish={finishTour}
        />
      )}
    </div>
  );
}

function AdvanceWorkspace({
  projects,
  go,
  notify,
  onProjectUpdated,
}: {
  projects: Project[];
  go: (page: Page, id?: string) => void;
  notify: (message: string) => void;
  onProjectUpdated: (project: Project) => void;
}) {
  const availableProjects = projects.filter((project) => !project.archived);
  const [categories, setCategories] = useState<AdvanceCategory[]>([]);
  const [categoryId, setCategoryId] = useState("text-auto-label");
  const [engineId, setEngineId] = useState("yoloe");
  const [projectId, setProjectId] = useState(availableProjects[0]?.id || "");
  const [confidence, setConfidence] = useState(0.35);
  const [limit, setLimit] = useState(100);
  const [overwrite, setOverwrite] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [samModel, setSamModel] = useState("sam2.1_s.pt");
  const [slicing, setSlicing] = useState(false);
  const [jobs, setJobs] = useState<AdvanceJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<AdvanceJob | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedProject = projects.find((project) => project.id === projectId);
  const runtime = categories.find((category) => category.id === "runtime");
  const categoryOrder = [
    "smart-segmentation",
    "batch-masks",
    "text-auto-label",
    "model-assisted",
    "video-propagation",
    "quality-review",
  ];
  const featureCategories = categories
    .filter((category) => category.id !== "runtime")
    .sort(
      (left, right) =>
        categoryOrder.indexOf(left.id) - categoryOrder.indexOf(right.id),
    );
  const category = featureCategories.find((item) => item.id === categoryId);
  const engine = category?.engines.find((item) => item.id === engineId);

  const loadJobs = async (focusId?: string) => {
    const items = await api.advanceJobs(projectId || undefined);
    setJobs(items);
    const target = focusId || selectedJob?.id;
    if (target) {
      const detail = await api.advanceJob(target);
      setSelectedJob(detail);
    }
  };

  useEffect(() => {
    api
      .advanceProviders()
      .then(({ categories: items }) => setCategories(items))
      .catch((error) =>
        notify(
          error instanceof Error
            ? error.message
            : "Advance providers gagal dimuat",
        ),
      );
  }, []);
  useEffect(() => {
    if (!projectId && availableProjects[0])
      setProjectId(availableProjects[0].id);
  }, [availableProjects[0]?.id]);
  useEffect(() => {
    if (!projectId) return;
    void loadJobs();
  }, [projectId]);
  useEffect(() => {
    const active =
      jobs.some((job) => ["queued", "running"].includes(job.status)) ||
      (selectedJob && ["queued", "running"].includes(selectedJob.status));
    if (!active) return;
    const timer = window.setInterval(() => void loadJobs(), 1500);
    return () => window.clearInterval(timer);
  }, [jobs, selectedJob?.status, projectId]);

  const chooseCategory = (next: AdvanceCategory) => {
    setCategoryId(next.id);
    setEngineId(
      next.engines.find((item) => item.ready)?.id || next.engines[0]?.id || "",
    );
    setSelectedJob(null);
  };
  const chooseEngine = (id: string) => {
    setEngineId(id);
    if (categoryId === "smart-segmentation")
      localStorage.setItem("vf-advance-smart-engine", id);
  };
  const run = async () => {
    if (!projectId || !engine?.ready) return;
    if (categoryId === "smart-segmentation") {
      localStorage.setItem("vf-advance-smart-engine", engine.id);
      go("annotate", projectId);
      notify(`${engine.name} dipilih untuk Smart Mask`);
      return;
    }
    if (categoryId === "quality-review") {
      const latest = jobs.find((job) => job.status === "completed") || jobs[0];
      if (latest) {
        setSelectedJob(await api.advanceJob(latest.id));
        return;
      }
      notify("Belum ada AI draft untuk direview");
      return;
    }
    setBusy(true);
    try {
      const created = await api.createAdvanceJob({
        project_id: projectId,
        category: categoryId,
        engine: engine.id,
        confidence,
        limit,
        overwrite,
        prompt: prompt || selectedProject?.classes[0] || "",
        model_id:
          categoryId === "model-assisted"
            ? selectedProject?.models.find((model) => modelCanDeploy(model))?.id
            : undefined,
        sam_model: samModel,
        slicing,
      });
      setSelectedJob(created);
      await loadJobs(created.id);
      notify(`${engine.name} job dimulai`);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Advance job gagal dibuat",
      );
    } finally {
      setBusy(false);
    }
  };
  const review = async (draftId: string, action: "accept" | "reject") => {
    if (!selectedJob) return;
    await api.reviewAdvanceDraft(draftId, action);
    setSelectedJob(await api.advanceJob(selectedJob.id));
    if (action === "accept" && projectId)
      onProjectUpdated(await api.project(projectId));
    notify(action === "accept" ? "AI draft diterima" : "AI draft ditolak");
  };
  const reviewAll = async (action: "accept" | "reject") => {
    if (!selectedJob) return;
    const result = await api.reviewAdvanceJob(selectedJob.id, action);
    setSelectedJob(await api.advanceJob(selectedJob.id));
    if (action === "accept" && projectId)
      onProjectUpdated(await api.project(projectId));
    notify(
      `${result.reviewed} draft ${action === "accept" ? "diterima" : "ditolak"}`,
    );
  };
  const openDraft = (assetId: string) => {
    if (!projectId) return;
    localStorage.setItem(`vf-annotate-${projectId}`, assetId);
    go("annotate", projectId);
  };
  const pendingDrafts =
    selectedJob?.drafts?.filter((draft) => draft.status === "pending") || [];
  const isInteractive = categoryId === "smart-segmentation";
  const isReview = categoryId === "quality-review";
  const modeLabel = isInteractive
    ? "Interactive · one image at a time"
    : isReview
      ? "Review · no generation"
      : "Automatic batch · many images";

  return (
    <div className="content advance-page">
      <section className="advance-hero">
        <div>
          <span className="eyebrow">ADVANCED AI ANNOTATION</span>
          <h1>Detect, segment, propagate, and review.</h1>
          <p>
            Pilih kategori dan engine sesuai dataset. Semua hasil batch disimpan
            sebagai draft sampai Anda menerimanya.
          </p>
        </div>
        <div className="advance-runtime">
          <BrainCircuit />
          <span>
            <b>{runtime?.name || "Checking runtime"}</b>
            <small>
              {runtime?.description || "Mendeteksi model dan hardware"}
            </small>
          </span>
        </div>
      </section>

      <div className="advance-categories">
        {featureCategories.map((item) => (
          <button
            key={item.id}
            className={item.id === categoryId ? "active" : ""}
            onClick={() => chooseCategory(item)}
          >
            {item.id === "smart-segmentation" ? <WandSparkles /> : null}
            {item.id === "text-auto-label" ? <Sparkles /> : null}
            {item.id === "model-assisted" ? <BrainCircuit /> : null}
            {item.id === "batch-masks" ? <Layers3 /> : null}
            {item.id === "video-propagation" ? <Play /> : null}
            {item.id === "quality-review" ? <CheckSquare /> : null}
            <span>
              <strong>
                <b>{item.name}</b>
                <em>
                  {item.id === "smart-segmentation"
                    ? "Interactive"
                    : item.id === "quality-review"
                      ? "Review"
                      : "Batch auto"}
                </em>
              </strong>
              <small>{item.description}</small>
            </span>
          </button>
        ))}
      </div>

      <section
        className={`advance-mode-summary ${isInteractive ? "interactive" : "batch"}`}
      >
        <span>{isInteractive ? <PenTool /> : <Layers3 />}</span>
        <div>
          <small>MODE YANG DIPILIH</small>
          <b>{modeLabel}</b>
          <p>
            {isInteractive
              ? "Smart Mask tidak memproses semua gambar. Mode ini membuka Annotator agar Anda klik objek dan memperoleh satu mask presisi yang langsung bisa diedit."
              : isReview
                ? "Pilih job yang sudah selesai, periksa hasilnya, lalu accept atau reject draft."
                : `Sistem memproses hingga ${limit} gambar secara otomatis. Hasil disimpan sebagai draft dan tidak menimpa anotasi sebelum Anda menerimanya.`}
          </p>
        </div>
        {isInteractive && (
          <button
            className="secondary"
            onClick={() => {
              const batch = featureCategories.find(
                (item) => item.id === "batch-masks",
              );
              if (batch) chooseCategory(batch);
            }}
          >
            <Layers3 /> Auto-generate semua gambar
          </button>
        )}
      </section>

      <div className="advance-layout">
        <section className="panel advance-config">
          <div className="panel-head">
            <div>
              <span className="eyebrow">1. TARGET & ENGINE</span>
              <h2>{category?.name || "Choose a category"}</h2>
            </div>
          </div>
          <label>
            Project
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {availableProjects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.type}
                </option>
              ))}
            </select>
          </label>
          <div className="advance-engines">
            {category?.engines.map((item) => (
              <button
                key={item.id}
                disabled={!item.ready}
                className={item.id === engineId ? "active" : ""}
                onClick={() => chooseEngine(item.id)}
                title={item.reason || item.note}
              >
                <span>
                  <b>{item.name}</b>
                  <em>{item.tier}</em>
                </span>
                <small>{item.reason || item.note}</small>
                <i className={item.ready ? "ready" : "blocked"}>
                  {item.ready ? "Ready" : "Unavailable"}
                </i>
              </button>
            ))}
          </div>
          {!availableProjects.length && (
            <p className="advance-warning">
              Buat project terlebih dahulu sebelum menjalankan Advance.
            </p>
          )}
        </section>

        <section className="panel advance-run-config">
          <span className="eyebrow">2. RUN SETTINGS</span>
          <h2>
            {isInteractive
              ? "Interactive mask settings"
              : isReview
                ? "Review existing drafts"
                : "Automatic batch settings"}
          </h2>
          {categoryId === "smart-segmentation" ? (
            <div className="advance-explainer">
              <WandSparkles />
              <div>
                <b>Untuk satu gambar, dengan klik.</b>
                <p>
                  Pilih engine lalu buka Annotator. Pilih class dan klik objek
                  untuk membuat polygon yang dapat diedit per vertex.
                </p>
                <small>
                  Ini bukan auto-label seluruh dataset. Gunakan Automatic Batch
                  Masks untuk memproses banyak gambar sekaligus.
                </small>
              </div>
            </div>
          ) : categoryId === "quality-review" ? (
            <div className="advance-explainer">
              <CheckSquare />
              <p>
                Buka job yang selesai, periksa confidence dan provenance, lalu
                accept atau reject setiap draft.
              </p>
            </div>
          ) : (
            <>
              <div className="advance-form-grid">
                <label>
                  Confidence
                  <input
                    type="number"
                    min="0.01"
                    max="0.99"
                    step="0.01"
                    value={confidence}
                    onChange={(event) =>
                      setConfidence(Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  Image limit
                  <input
                    type="number"
                    min="1"
                    max="5000"
                    value={limit}
                    onChange={(event) => setLimit(Number(event.target.value))}
                  />
                </label>
              </div>
              <div className="advance-batch-scope">
                <Layers3 />
                <span>
                  <b>Maksimal {limit} gambar diproses otomatis</b>
                  <small>
                    Default hanya gambar yang belum dianotasi. Setelah job
                    selesai, periksa draft pada langkah 3 lalu pilih Accept.
                  </small>
                </span>
              </div>
              <label>
                Class for classless mask proposals
                <select
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                >
                  <option value="">Use first project class</option>
                  {selectedProject?.classes.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              {(engineId.includes("sam2") || engineId === "grounded-sam2") && (
                <label>
                  SAM refinement model
                  <select
                    value={samModel}
                    onChange={(event) => setSamModel(event.target.value)}
                  >
                    <option value="sam2.1_t.pt">SAM 2.1 Tiny</option>
                    <option value="sam2.1_s.pt">SAM 2.1 Small</option>
                    <option value="sam2.1_b.pt">SAM 2.1 Base+</option>
                    <option value="sam2.1_l.pt">SAM 2.1 Large</option>
                  </select>
                </label>
              )}
              <label className="advance-check">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(event) => setOverwrite(event.target.checked)}
                />
                Include already annotated images; accepted drafts replace
                existing labels
              </label>
              <label className="advance-check">
                <input
                  type="checkbox"
                  checked={slicing}
                  onChange={(event) => setSlicing(event.target.checked)}
                />
                High-resolution slicing metadata (SAHI-compatible provider)
              </label>
            </>
          )}
          <button
            className="primary advance-run"
            disabled={busy || !projectId || !engine?.ready}
            onClick={() => void run()}
          >
            {busy ? (
              <LoaderCircle className="spin" />
            ) : categoryId === "quality-review" ? (
              <CheckSquare />
            ) : categoryId === "smart-segmentation" ? (
              <PenTool />
            ) : (
              <Play />
            )}
            {categoryId === "smart-segmentation"
              ? "Open annotator"
              : categoryId === "quality-review"
                ? "Open latest drafts"
                : "Generate AI drafts"}
          </button>
          {engine?.weight && (
            <small className="advance-download-note">
              Checkpoint {engine.weight} is downloaded on first use.
            </small>
          )}
        </section>
      </div>

      <section className="panel advance-jobs">
        <div className="panel-head">
          <div>
            <span className="eyebrow">3. JOBS & REVIEW</span>
            <h2>AI draft history</h2>
          </div>
          <div className="advance-job-toolbar">
            {projectId && (
              <>
                <button
                  className="secondary"
                  onClick={() => go("dataset", projectId)}
                >
                  <Eye /> View dataset
                </button>
                <a
                  className="secondary advance-export-link"
                  href={api.annotatedExportUrl(projectId, "yolo")}
                  download
                >
                  <Download /> Download YOLO
                </a>
                <a
                  className="secondary advance-export-link"
                  href={api.annotatedExportUrl(projectId, "coco")}
                  download
                >
                  <Download /> Download COCO
                </a>
              </>
            )}
            <button className="secondary" onClick={() => void loadJobs()}>
              Refresh
            </button>
          </div>
        </div>
        <div className="advance-job-list">
          {jobs.map((job) => (
            <button
              key={job.id}
              className={selectedJob?.id === job.id ? "active" : ""}
              onClick={async () => setSelectedJob(await api.advanceJob(job.id))}
            >
              <span>
                <b>{job.engine}</b>
                <small>
                  {job.category} · {new Date(job.createdAt).toLocaleString()}
                </small>
              </span>
              <span className={`advance-status ${job.status}`}>
                {job.status}
              </span>
              <div>
                <i style={{ width: `${job.progress}%` }} />
              </div>
              <em>
                {job.processed}/{job.total || "?"} · {job.progress}%
              </em>
            </button>
          ))}
          {!jobs.length && <p>No Advance jobs for this project yet.</p>}
        </div>
        {selectedJob && (
          <div className="advance-review">
            <header>
              <div>
                <h3>{selectedJob.engine} drafts</h3>
                <p>
                  {selectedJob.error ||
                    `${selectedJob.drafts?.length || 0} images processed with stored provenance.`}
                </p>
              </div>
              {!!pendingDrafts.length && (
                <span>
                  <button onClick={() => void reviewAll("reject")}>
                    Reject pending
                  </button>
                  <button
                    className="primary"
                    onClick={() => void reviewAll("accept")}
                  >
                    Accept pending
                  </button>
                </span>
              )}
            </header>
            <div className="advance-drafts">
              {selectedJob.drafts?.map((draft) => (
                <article key={draft.id}>
                  <button
                    className="advance-draft-preview"
                    onClick={() => openDraft(draft.assetId)}
                    title="Buka hasil ini di annotator"
                  >
                    <img
                      src={`/files/${draft.assetId}`}
                      alt="AI draft preview"
                    />
                    <span>
                      <Eye /> View result
                    </span>
                  </button>
                  <div>
                    <span className={`advance-status ${draft.status}`}>
                      {draft.status}
                    </span>
                    <h4>{draft.annotations.length} annotations</h4>
                    <p>Confidence {(draft.confidence * 100).toFixed(1)}%</p>
                    <small>
                      {String(draft.provenance.weights || draft.engine)}
                    </small>
                  </div>
                  <footer>
                    <button
                      className="secondary"
                      onClick={() => openDraft(draft.assetId)}
                    >
                      <Eye /> View
                    </button>
                    {draft.status === "pending" && (
                      <>
                        <button onClick={() => void review(draft.id, "reject")}>
                          <X /> Reject
                        </button>
                        <button
                          className="primary"
                          onClick={() => void review(draft.id, "accept")}
                        >
                          <Check /> Accept
                        </button>
                      </>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function MemberAvatar({
  member,
  className = "",
}: {
  member?: AuthStatus["member"];
  className?: string;
}) {
  const initials = (member?.name || "Salnova User")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <span className={`member-profile-avatar ${className}`.trim()}>
      {member?.avatarUrl ? (
        <img src={member.avatarUrl} alt={`Foto profil ${member.name}`} />
      ) : (
        initials
      )}
    </span>
  );
}

function Sidebar({
  page,
  go,
  onHelp,
  onProfile,
  member,
}: {
  page: Page;
  go: (p: Page) => void;
  onHelp: () => void;
  onProfile: () => void;
  member?: AuthStatus["member"];
}) {
  const nav = [
    ["dashboard", LayoutDashboard, "Projects"],
    ["workflows", Workflow, "Workflows"],
    ["advance", Sparkles, "Advance"],
    ["deploy", Rocket, "Deployments"],
  ] as const;
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brandmark">
          <SupernovaMark />
        </span>
        <span>
          salnova <small>LOCAL</small>
        </span>
      </div>
      <button
        className="workspace"
        type="button"
        onClick={onProfile}
        aria-label={`Buka menu akun ${member?.name || "Salnova User"}`}
        title="Buka menu akun dan ganti akun"
      >
        <MemberAvatar member={member} className="avatar" />
        <div>
          <b>{member?.name || "Salnova User"}</b>
          <small>{member?.email || "Personal workspace"}</small>
        </div>
        <ChevronDown size={15} />
      </button>
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
  page,
  project,
  backend,
  member,
  onBack,
  onSearch,
  onHelp,
  onJobs,
  unreadNotifications,
  onProfile,
}: {
  page: Page;
  project?: Project;
  backend: "checking" | "online" | "offline";
  member?: AuthStatus["member"];
  onBack: () => void;
  onSearch: () => void;
  onHelp: () => void;
  onJobs: () => void;
  unreadNotifications: number;
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
            <h2>
              {(
                {
                  dashboard: "Projects",
                  workflows: "Workflows",
                  advance: "Advance",
                  models: "Model Library",
                  templates: "Templates",
                  settings: "Settings",
                } as Partial<Record<Page, string>>
              )[page] || "Salnova"}
            </h2>
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
        <button
          className="icon ghost notification-trigger"
          onClick={onJobs}
          title="Jobs and notifications"
          aria-label={`Jobs and notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ""}`}
        >
          <Bell size={18} />
          {!!unreadNotifications && <i>{Math.min(99, unreadNotifications)}</i>}
        </button>
        <button
          className="user"
          onClick={onProfile}
          title={`Akun ${member?.name || "Salnova User"}`}
          aria-label="Buka menu akun"
        >
          <MemberAvatar member={member} className="topbar-profile-avatar" />
        </button>
      </div>
    </header>
  );
}

function JobCenter({
  jobs,
  notifications,
  close,
  openTarget,
  readAll,
}: {
  jobs: GlobalJob[];
  notifications: WorkspaceNotification[];
  close: () => void;
  openTarget: (target?: string, notificationId?: string) => void;
  readAll: () => void;
}) {
  const [tab, setTab] = useState<"jobs" | "notifications">("jobs");
  return (
    <div
      className="job-center"
      role="dialog"
      aria-label="Jobs and notifications"
    >
      <header>
        <div>
          <b>Workspace activity</b>
          <small>Long-running work keeps going on the server.</small>
        </div>
        <button className="icon ghost" onClick={close} aria-label="Close jobs">
          <X />
        </button>
      </header>
      <nav>
        <button
          className={tab === "jobs" ? "active" : ""}
          onClick={() => setTab("jobs")}
        >
          Jobs
        </button>
        <button
          className={tab === "notifications" ? "active" : ""}
          onClick={() => setTab("notifications")}
        >
          Notifications {notifications.some((item) => !item.read) && <i />}
        </button>
        {tab === "notifications" &&
          notifications.some((item) => !item.read) && (
            <button className="ghost read-all" onClick={readAll}>
              Mark all read
            </button>
          )}
      </nav>
      <div className="job-center-list">
        {tab === "jobs" &&
          jobs.map((job) => (
            <button
              key={`${job.kind}-${job.id}`}
              onClick={() => openTarget(job.target)}
            >
              <span className={`job-kind ${job.kind}`}>
                <Activity />
              </span>
              <span>
                <b>{job.name}</b>
                <small>
                  {job.projectName || job.kind} · {job.detail || job.status}
                </small>
                {![
                  "ready",
                  "completed",
                  "failed",
                  "cancelled",
                  "paused",
                ].includes(job.status) && (
                  <progress value={job.progress} max="100" />
                )}
              </span>
              <em className={`status ${job.status}`}>{job.status}</em>
            </button>
          ))}
        {tab === "notifications" &&
          notifications.map((item) => (
            <button
              key={item.id}
              className={item.read ? "" : "unread"}
              onClick={() => openTarget(item.target, item.id)}
            >
              <span className={`job-kind ${item.kind}`}>
                <Bell />
              </span>
              <span>
                <b>{item.title}</b>
                <small>{item.message}</small>
              </span>
              <time>{item.createdAt.slice(0, 16).replace("T", " ")}</time>
            </button>
          ))}
        {((tab === "jobs" && !jobs.length) ||
          (tab === "notifications" && !notifications.length)) && (
          <div className="job-center-empty">
            <Check />
            <span>Nothing pending here.</span>
          </div>
        )}
      </div>
      {/*
        <div
          className="modal-bg video-upload-wizard-bg"
          onMouseDown={() => uploadProgress === null && closeVideoWizard()}
        >
          <section
            className="video-upload-wizard"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">VIDEO TO FRAMES</span>
                <h2>
                  {videoWizard.step === "settings"
                    ? "Atur ekstraksi frame"
                    : "Preview video"}
                </h2>
                <p>{videoWizard.file.name}</p>
              </div>
              <button
                className="icon ghost"
                aria-label="Close video upload"
                disabled={uploadProgress !== null}
                onClick={closeVideoWizard}
              >
                <X />
              </button>
            </header>
            <div className="video-upload-steps" aria-label="Video upload steps">
              <span className={videoWizard.step === "settings" ? "active" : ""}>
                1. Frame interval
              </span>
              <span className={videoWizard.step === "preview" ? "active" : ""}>
                2. Preview & extract
              </span>
            </div>
            <div
              className="video-upload-preview"
              onWheel={(event) => {
                event.preventDefault();
                seekVideoPreview(videoPreviewPercent + (event.deltaY < 0 ? 1 : -1));
              }}
            >
              <video
                ref={videoPreview}
                src={videoWizard.url}
                controls={videoWizard.step === "preview"}
                muted
                playsInline
                onLoadedMetadata={(event) => {
                  const duration = event.currentTarget.duration;
                  if (Number.isFinite(duration)) {
                    setVideoDuration(duration);
                    event.currentTarget.currentTime =
                      (duration * videoPreviewPercent) / 100;
                  }
                }}
                onTimeUpdate={(event) => {
                  if (!videoDuration) return;
                  setVideoPreviewPercent(
                    Math.round((event.currentTarget.currentTime / videoDuration) * 100),
                  );
                }}
              />
              <span>{videoPreviewPercent}% posisi video</span>
            </div>
            {videoWizard.step === "settings" ? (
              <div className="video-upload-controls">
                <label>
                  <span>Interval ekstraksi</span>
                  <b>{videoFrameInterval.toLocaleString()} detik/frame</b>
                  <input
                    type="range"
                    min="-4"
                    max="2"
                    step="0.01"
                    value={Math.log10(Math.max(0.0001, videoFrameInterval))}
                    onChange={(event) =>
                      setVideoFrameInterval(
                        Number((10 ** Number(event.target.value)).toPrecision(5)),
                      )
                    }
                  />
                </label>
                <label>
                  <span>Preview pada posisi video</span>
                  <b>{videoPreviewPercent}%</b>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={videoPreviewPercent}
                    onChange={(event) => seekVideoPreview(Number(event.target.value))}
                  />
                </label>
                <small>
                  Geser bar atau scroll mouse untuk mencari bagian video yang ingin diperiksa.
                  Interval ini akan dipakai untuk mengekstrak seluruh video menjadi gambar.
                </small>
              </div>
            ) : (
              <div className="video-upload-confirm">
                <b>Siap mengekstrak seluruh video</b>
                <small>
                  Satu gambar akan dibuat setiap {videoFrameInterval.toLocaleString()} detik.
                  Gunakan Back bila interval atau posisi preview belum sesuai.
                </small>
              </div>
            )}
            {uploadProgress !== null && (
              <TransferProgress
                percent={uploadProgress}
                stage={uploadStage}
                label="Mengunggah video"
                processingLabel="Mengekstrak frame video"
              />
            )}
            <footer>
              {videoWizard.step === "preview" && (
                <button
                  className="secondary"
                  disabled={uploadProgress !== null}
                  onClick={() => setVideoWizard({ ...videoWizard, step: "settings" })}
                >
                  Back
                </button>
              )}
              {videoWizard.step === "settings" ? (
                <button
                  className="primary"
                  onClick={() => setVideoWizard({ ...videoWizard, step: "preview" })}
                >
                  Next <ChevronRight size={15} />
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={uploadProgress !== null}
                  onClick={async () => {
                    if (await upload([videoWizard.file])) closeVideoWizard();
                  }}
                >
                  <Upload size={15} /> Extract frames
                </button>
              )}
            </footer>
          </section>
        </div>
      */}
    </div>
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
            <h2>Salnova help</h2>
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
            href="/docs"
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
  uploadPhoto,
  settings,
  logout,
  close,
}: {
  backend: "checking" | "online" | "offline";
  projects: number;
  member?: AuthStatus["member"];
  uploadPhoto: (file: File) => Promise<void>;
  settings: () => void;
  logout?: () => Promise<void>;
  close: () => void;
}) {
  const avatarInput = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  return (
    <div className="profile-popover">
      <button className="profile-close" onClick={close}>
        <X />
      </button>
      <div className="profile-identity">
        <MemberAvatar member={member} className="profile-menu-avatar" />
        <div>
          <b>{member?.name || "Salnova User"}</b>
          <small>
            {member ? `Full access | ${member.email}` : "Local workspace owner"}
          </small>
        </div>
      </div>
      <button
        className="profile-photo-upload"
        disabled={uploadingAvatar}
        onClick={() => avatarInput.current?.click()}
      >
        <Upload />
        <span>
          <b>{uploadingAvatar ? "Mengunggah foto..." : "Ganti foto profil"}</b>
          <small>JPG, PNG, atau WEBP, maksimum 5 MB</small>
        </span>
      </button>
      <input
        ref={avatarInput}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setUploadingAvatar(true);
          try {
            await uploadPhoto(file);
          } finally {
            setUploadingAvatar(false);
          }
        }}
      />
      <div className={"profile-backend " + backend}>
        {backend === "offline" ? <WifiOff /> : <Wifi />}
        <span>
          <b>Local API {backend}</b>
          <small>{projects} projects available</small>
        </span>
      </div>
      <button className="profile-action" onClick={settings}>
        <Settings />
        <span>
          <b>Workspace settings</b>
          <small>Members, collaboration, backup and restore</small>
        </span>
        <ChevronRight />
      </button>
      {logout && (
        <button className="profile-logout" onClick={() => void logout()}>
          <LogOut />
          Ganti akun
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

function JoinProjectCard({
  join,
}: {
  join: (code: string) => Promise<boolean>;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const ok = await join(code);
    setBusy(false);
    if (ok) setCode("");
  };
  return (
    <div className="join-code-form dashboard-join">
      <span>
        <b>Punya kode undangan?</b>
        <small>Masukkan kode untuk bergabung ke project orang lain.</small>
      </span>
      <input
        value={code}
        maxLength={8}
        placeholder="8 karakter"
        aria-label="Kode undangan project"
        onChange={(event) =>
          setCode(event.target.value.replace(/[^a-z0-9]/gi, "").toUpperCase())
        }
        onKeyDown={(event) => {
          if (event.key === "Enter" && code.length === 8) void submit();
        }}
      />
      <button
        onClick={() => void submit()}
        disabled={busy || code.length !== 8}
      >
        {busy ? "Mengirim…" : "Join project"}
      </button>
    </div>
  );
}

function Dashboard({
  projects,
  go,
  create,
  startTour,
  duplicate,
  archive,
  remove,
  join,
}: {
  projects: Project[];
  go: (p: Page, id?: string) => void;
  create: () => void;
  startTour: () => void;
  duplicate: (id: string) => void;
  archive: (id: string, archived: boolean) => void;
  remove: (project: Project) => Promise<void>;
  join: (code: string) => Promise<boolean>;
}) {
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [deletingProject, setDeletingProject] = useState<string | null>(null);
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
            Upload data, annotate, generate a version, train, and deploy, all on
            this machine.
          </p>
        </div>
        <div className="dashboard-welcome-actions">
          <button
            className="secondary dashboard-tour-button"
            onClick={startTour}
          >
            <BookOpen size={16} />
            Tutorial 7 project
          </button>
          <button className="primary" onClick={create}>
            <Plus size={17} />
            Create New Project
          </button>
        </div>
      </section>
      <JoinProjectCard join={join} />
      <div className="stats">
        <Stat
          icon={Database}
          val={projects.length}
          label="Projects"
          tone="purple"
        />
        <Stat
          icon={ImageIcon}
          val={projects.reduce(
            (a, p) => a + (p.assetCount ?? p.assets.length),
            0,
          )}
          label="Dataset images"
          tone="blue"
        />
        <Stat
          icon={BrainCircuit}
          val={projects.reduce(
            (a, p) => a + p.models.filter(modelCanDeploy).length,
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
          {filtered.map((p, i) => {
            const coverImage = p.coverImage || p.assets[0]?.src;
            return (
              <article className="project-card" key={p.id}>
                <button
                  className="project-card-main"
                  onClick={() => go("project", p.id)}
                >
                  <div
                    className={
                      "project-cover cover-" +
                      (i % 4) +
                      (coverImage ? " has-dataset-cover" : "")
                    }
                    style={
                      coverImage
                        ? {
                            backgroundImage: `linear-gradient(180deg, rgba(20, 15, 34, 0.08), rgba(20, 15, 34, 0.58)), url(${JSON.stringify(coverImage)})`,
                          }
                        : undefined
                    }
                  >
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
                        {(p.assetCount ?? p.assets.length) ||
                          (i ? 0 : 248)}{" "}
                        images
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
                    <button
                      className="delete-action"
                      disabled={deletingProject === p.id}
                      onClick={async () => {
                        setDeletingProject(p.id);
                        try {
                          await remove(p);
                          setMenu("");
                        } finally {
                          setDeletingProject(null);
                        }
                      }}
                    >
                      {deletingProject === p.id ? (
                        <LoaderCircle className="delete-spinner" />
                      ) : (
                        <Trash2 />
                      )}
                      {deletingProject === p.id
                        ? "Deleting project…"
                        : "Delete permanently"}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
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
  remove: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const uploadInFlight = useRef(false);
  const [draggingUpload, setDraggingUpload] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStage, setUploadStage] = useState<TransferStage>("uploading");
  const [videoFrameInterval, setVideoFrameInterval] = useState(1);
  const [videoWizard, setVideoWizard] = useState<{
    file: File;
    url: string;
    step: "settings" | "preview";
  } | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoPreviewPercent, setVideoPreviewPercent] = useState(0);
  const videoPreview = useRef<HTMLVideoElement>(null);
  const [deletingProject, setDeletingProject] = useState(false);
  const [deletingAsset, setDeletingAsset] = useState<string | null>(null);
  const [collaboration, setCollaboration] = useState<ProjectCollaboration>({
    invites: [],
    requests: [],
    collaborators: [],
  });
  const loadCollaboration = () =>
    api
      .projectCollaboration(project.id)
      .then(setCollaboration)
      .catch(() => undefined);
  useEffect(() => {
    void loadCollaboration();
    const refresh = window.setInterval(() => void loadCollaboration(), 5000);
    return () => window.clearInterval(refresh);
  }, [project.id]);
  const createInvite = async () => {
    try {
      const invite = await api.createProjectInvite(project.id);
      await loadCollaboration();
      const link = `${window.location.origin}${window.location.pathname}?invite=${invite.code}#/dashboard`;
      const copied = await copyText(link);
      notify(
        copied
          ? "Link undangan disalin. Berlaku selama 7 hari."
          : `Undangan dibuat. Bagikan kode ${invite.code}.`,
      );
    } catch (inviteError) {
      notify(
        inviteError instanceof Error
          ? inviteError.message
          : "Gagal membuat undangan",
      );
    }
  };
  const reviewJoin = async (requestId: string, action: "accept" | "reject") => {
    try {
      await api.reviewProjectJoin(project.id, requestId, action);
      await loadCollaboration();
      notify(
        action === "accept" ? "Kolaborator diterima" : "Permintaan ditolak",
      );
    } catch (reviewError) {
      notify(
        reviewError instanceof Error
          ? reviewError.message
          : "Gagal memproses permintaan",
      );
    }
  };
  const openFilePicker = () => {
    if (uploadInFlight.current) {
      notify("Tunggu upload yang sedang berjalan selesai");
      return;
    }
    if (input.current) {
      input.current.value = "";
      input.current.click();
    }
  };
  const upload = async (selectedFiles: FileList | File[] | null) => {
    if (!selectedFiles?.length) return false;
    if (uploadInFlight.current) {
      notify("Tunggu upload yang sedang berjalan selesai");
      return false;
    }
    if (
      !Number.isFinite(videoFrameInterval) ||
      videoFrameInterval < 0.0001 ||
      videoFrameInterval > 86400
    ) {
      notify("Interval video harus 0.0001 sampai 86400 detik per frame");
      return false;
    }
    const files = Array.from(selectedFiles);
    uploadInFlight.current = true;
    try {
      setUploadProgress(0);
      setUploadStage("uploading");
      const saved = await api.uploadWithProgress(
        project.id,
        files,
        setUploadProgress,
        () => setUploadStage("processing"),
        videoFrameInterval,
      );
      update(() => saved);
      notify(`${files.length} file disimpan ke dataset lokal`);
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : "Upload gagal");
      return false;
    } finally {
      uploadInFlight.current = false;
      if (input.current) input.current.value = "";
      setUploadProgress(null);
      setDraggingUpload(false);
    }
  };
  const closeVideoWizard = () => {
    if (videoWizard) URL.revokeObjectURL(videoWizard.url);
    setVideoWizard(null);
    setVideoDuration(0);
    setVideoPreviewPercent(0);
  };
  const chooseUpload = (selectedFiles: FileList | File[] | null) => {
    if (!selectedFiles?.length) return;
    const files = Array.from(selectedFiles);
    const videos = files.filter(
      (file) =>
        file.type.startsWith("video/") ||
        /\.(mp4|mov|webm|avi)$/i.test(file.name),
    );
    if (!videos.length) {
      void upload(files);
      return;
    }
    if (files.length !== 1) {
      notify(
        "Upload video satu per satu agar frame dapat dipreview terlebih dahulu",
      );
      return;
    }
    setVideoDuration(0);
    setVideoPreviewPercent(0);
    setVideoWizard({
      file: videos[0],
      url: URL.createObjectURL(videos[0]),
      step: "settings",
    });
  };
  const seekVideoPreview = (percent: number) => {
    const next = Math.max(0, Math.min(100, Math.round(percent)));
    setVideoPreviewPercent(next);
    if (videoPreview.current && videoDuration) {
      videoPreview.current.currentTime = (videoDuration * next) / 100;
    }
  };
  const deleteImage = async (id: string) => {
    if (!confirm("Hapus gambar ini dari dataset?")) return;
    setDeletingAsset(id);
    try {
      await api.deleteAsset(project.id, id);
      update((current) => ({
        ...current,
        assets: current.assets.filter((asset) => asset.id !== id),
        assetCount: Math.max(
          0,
          (current.assetCount ?? current.assets.length) - 1,
        ),
      }));
      notify("Gambar dihapus");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Gagal menghapus gambar");
    } finally {
      setDeletingAsset(null);
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
          <button
            className="danger"
            disabled={deletingProject}
            onClick={async () => {
              setDeletingProject(true);
              try {
                await remove();
              } finally {
                setDeletingProject(false);
              }
            }}
          >
            {deletingProject ? (
              <LoaderCircle className="delete-spinner" size={16} />
            ) : (
              <Trash2 size={16} />
            )}
            {deletingProject ? "Deleting…" : "Delete"}
          </button>
          <button
            className="primary"
            disabled={uploadProgress !== null}
            onClick={openFilePicker}
          >
            <Upload size={17} />
            {uploadProgress !== null ? "Uploading…" : "Upload data"}
          </button>
        </div>
        <input
          ref={input}
          hidden
          multiple
          type="file"
          accept="image/*,video/mp4,video/quicktime,video/webm"
          onChange={(event) => chooseUpload(event.currentTarget.files)}
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
                onClick={openFilePicker}
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
              setDraggingUpload(false);
              chooseUpload(event.dataTransfer.files);
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
            <div className="video-frame-interval">
              <div>
                <b>Video frame interval</b>
                <small>
                  Atur jarak ekstraksi untuk file video. Gambar tidak
                  terpengaruh.
                </small>
              </div>
              <label>
                <span>{videoFrameInterval.toLocaleString()} detik/frame</span>
                <input
                  aria-label="Video frame interval range"
                  type="range"
                  min="-4"
                  max="2"
                  step="0.01"
                  value={Math.log10(
                    Math.max(0.0001, videoFrameInterval || 0.0001),
                  )}
                  onChange={(event) =>
                    setVideoFrameInterval(
                      Number((10 ** Number(event.target.value)).toPrecision(5)),
                    )
                  }
                />
              </label>
              <label>
                Detik per frame
                <input
                  aria-label="Video seconds per frame"
                  type="number"
                  min="0.0001"
                  max="86400"
                  step="0.0001"
                  value={videoFrameInterval}
                  onChange={(event) =>
                    setVideoFrameInterval(Number(event.target.value))
                  }
                />
              </label>
              <small>
                1 = satu frame tiap detik · 0.0001 = setiap source frame jika
                FPS video tidak mencapai interval tersebut.
              </small>
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
                        disabled={deletingAsset === a.id}
                        onClick={() => deleteImage(a.id)}
                        title="Delete image"
                      >
                        {deletingAsset === a.id ? (
                          <LoaderCircle className="delete-spinner" />
                        ) : (
                          <Trash2 />
                        )}
                      </button>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="empty-drop" onClick={openFilePicker}>
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
          <section className="panel compact project-collaboration-card">
            <div className="collaboration-title">
              <div>
                <h3>Collaborators</h3>
                <small>
                  Semua kolaborator memiliki fungsi project yang sama.
                </small>
              </div>
              <button className="primary small" onClick={createInvite}>
                <Plus /> Invite
              </button>
            </div>
            {collaboration.invites[0] && (
              <div className="active-invite">
                <span>
                  <small>Kode aktif</small>
                  <b>{collaboration.invites[0].code}</b>
                </span>
                <button
                  onClick={async () => {
                    const code = collaboration.invites[0].code;
                    const link = `${window.location.origin}${window.location.pathname}?invite=${code}#/dashboard`;
                    const copied = await copyText(link);
                    notify(
                      copied ? "Link undangan disalin" : `Bagikan kode ${code}`,
                    );
                  }}
                >
                  <Copy /> Copy link
                </button>
              </div>
            )}
            {/* Redeeming a code now lives on the dashboard. Keeping it here as
                well would ask a member to open a project in order to join a
                different one they cannot see yet. */}
            {!!collaboration.requests.length && (
              <div className="join-request-list">
                <b>Menunggu persetujuan</b>
                {collaboration.requests.map((request) => (
                  <div key={request.id}>
                    <span>
                      <b>{request.name}</b>
                      <small>{request.email}</small>
                    </span>
                    <button
                      className="accept"
                      onClick={() => reviewJoin(request.id, "accept")}
                    >
                      <Check />
                    </button>
                    <button
                      className="reject"
                      onClick={() => reviewJoin(request.id, "reject")}
                    >
                      <X />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="collaborator-list">
              {collaboration.collaborators.map((collaborator) => (
                <div key={collaborator.id}>
                  <span>{collaborator.name.slice(0, 2).toUpperCase()}</span>
                  <div>
                    <b>{collaborator.name}</b>
                    <small>{collaborator.email}</small>
                  </div>
                  <em>Full access</em>
                </div>
              ))}
              {!collaboration.collaborators.length && (
                <p>Belum ada kolaborator yang disetujui.</p>
              )}
            </div>
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
      {videoWizard && (
        <VideoUploadWizard
          wizard={videoWizard}
          duration={videoDuration}
          setDuration={setVideoDuration}
          percent={videoPreviewPercent}
          interval={videoFrameInterval}
          progress={uploadProgress}
          stage={uploadStage}
          videoRef={videoPreview}
          close={closeVideoWizard}
          setWizard={setVideoWizard}
          seek={seekVideoPreview}
          setPercent={setVideoPreviewPercent}
          setInterval={setVideoFrameInterval}
          extract={async () => {
            if (await upload([videoWizard.file])) closeVideoWizard();
          }}
        />
      )}
    </div>
  );
}

function VideoUploadWizard({
  wizard,
  duration,
  setDuration,
  percent,
  interval,
  progress,
  stage,
  videoRef,
  close,
  setWizard,
  seek,
  setPercent,
  setInterval,
  extract,
}: {
  wizard: { file: File; url: string; step: "settings" | "preview" };
  duration: number;
  setDuration: (value: number) => void;
  percent: number;
  interval: number;
  progress: number | null;
  stage: TransferStage;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  close: () => void;
  setWizard: React.Dispatch<
    React.SetStateAction<{
      file: File;
      url: string;
      step: "settings" | "preview";
    } | null>
  >;
  seek: (percent: number) => void;
  setPercent: (percent: number) => void;
  setInterval: (value: number) => void;
  extract: () => Promise<void>;
}) {
  const [playingSamplePreview, setPlayingSamplePreview] = useState(false);
  useEffect(() => {
    if (!playingSamplePreview) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const next = video.currentTime + interval;
      if (duration && next >= duration) {
        video.currentTime = duration;
        setPlayingSamplePreview(false);
      } else {
        video.currentTime = next;
      }
    }, 550);
    return () => window.clearInterval(timer);
  }, [duration, interval, playingSamplePreview, videoRef]);
  return (
    <div
      className="modal-bg video-upload-wizard-bg"
      onMouseDown={() => progress === null && close()}
    >
      <section
        className="video-upload-wizard"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">VIDEO TO FRAMES</span>
            <h2>
              {wizard.step === "settings"
                ? "Atur ekstraksi frame"
                : "Preview video"}
            </h2>
            <p>{wizard.file.name}</p>
          </div>
          <button
            className="icon ghost"
            aria-label="Close video upload"
            disabled={progress !== null}
            onClick={close}
          >
            <X />
          </button>
        </header>
        <div className="video-upload-steps">
          <span className={wizard.step === "settings" ? "active" : ""}>
            1. Frame interval
          </span>
          <span className={wizard.step === "preview" ? "active" : ""}>
            2. Preview & extract
          </span>
        </div>
        <div
          className="video-upload-preview"
          onWheel={(event) => {
            event.preventDefault();
            seek(percent + (event.deltaY < 0 ? 1 : -1));
          }}
        >
          <video
            ref={videoRef}
            src={wizard.url}
            controls={false}
            muted
            playsInline
            onLoadedMetadata={(event) => {
              const nextDuration = event.currentTarget.duration;
              if (Number.isFinite(nextDuration)) {
                setDuration(nextDuration);
                event.currentTarget.currentTime =
                  (nextDuration * percent) / 100;
              }
            }}
            onTimeUpdate={(event) => {
              if (duration)
                setPercent(
                  Math.round(
                    (event.currentTarget.currentTime / duration) * 100,
                  ),
                );
            }}
          />
          <span>{percent}% posisi video</span>
          {wizard.step === "preview" && (
            <button
              type="button"
              className="video-sample-play"
              onClick={() => setPlayingSamplePreview((current) => !current)}
            >
              {playingSamplePreview ? <Square size={14} /> : <Play size={14} />}
              {playingSamplePreview ? "Pause preview" : "Play sampled preview"}
            </button>
          )}
        </div>
        {wizard.step === "settings" ? (
          <div className="video-upload-controls">
            <label>
              <span>Interval ekstraksi</span>
              <b>{interval.toLocaleString()} detik/frame</b>
              <input
                type="range"
                min="-4"
                max="2"
                step="0.01"
                value={Math.log10(Math.max(0.0001, interval))}
                onChange={(event) =>
                  setInterval(
                    Number((10 ** Number(event.target.value)).toPrecision(5)),
                  )
                }
              />
            </label>
            <label>
              <span>Preview pada posisi video</span>
              <b>{percent}%</b>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={percent}
                onChange={(event) => seek(Number(event.target.value))}
              />
            </label>
            <small>
              Geser bar atau scroll mouse untuk mencari bagian video. Interval
              dipakai saat mengekstrak seluruh video menjadi gambar.
            </small>
          </div>
        ) : (
          <div className="video-upload-confirm">
            <b>Siap mengekstrak seluruh video</b>
            <small>
              Preview melompat setiap {interval.toLocaleString()} detik, sama
              seperti frame yang akan diekstrak. Gunakan Back bila belum sesuai.
            </small>
          </div>
        )}
        {progress !== null && (
          <TransferProgress
            percent={progress}
            stage={stage}
            label="Mengunggah video"
            processingLabel="Mengekstrak frame video"
          />
        )}
        <footer>
          {wizard.step === "preview" && (
            <button
              className="secondary"
              disabled={progress !== null}
              onClick={() => {
                setPlayingSamplePreview(false);
                if (videoRef.current) {
                  videoRef.current.pause();
                  videoRef.current.currentTime = 0;
                }
                setPercent(0);
                setWizard({ ...wizard, step: "settings" });
              }}
            >
              Back
            </button>
          )}
          {wizard.step === "settings" ? (
            <button
              className="primary"
              onClick={() => setWizard({ ...wizard, step: "preview" })}
            >
              Next <ChevronRight size={15} />
            </button>
          ) : (
            <button
              className="primary"
              disabled={progress !== null}
              onClick={() => void extract()}
            >
              <Upload size={15} /> Extract frames
            </button>
          )}
        </footer>
      </section>
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
  const [lockedBy, setLockedBy] = useState("");
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
  useEffect(() => {
    if (!asset) return;
    let released = false;
    const acquire = () =>
      api
        .acquireAnnotationLock(project.id, asset.id)
        .then(() => !released && setLockedBy(""))
        .catch(
          (error) =>
            !released &&
            setLockedBy(
              error instanceof Error ? error.message : "Image is locked",
            ),
        );
    acquire();
    const heartbeat = window.setInterval(acquire, 120_000);
    return () => {
      released = true;
      window.clearInterval(heartbeat);
      api.releaseAnnotationLock(project.id, asset.id).catch(() => undefined);
    };
  }, [project.id, asset?.id]);
  const point = (e: any) => {
    const r = canvas.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)),
    };
  };
  const saveBoxes = (boxes: Box[]) => {
    if (!asset) return;
    if (lockedBy) {
      notify(lockedBy);
      return;
    }
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
    if (lockedBy) return;
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
      {lockedBy && (
        <div className="annotation-lock-warning">
          <WifiOff /> {lockedBy}. Editing is disabled until the lock is
          released.
        </div>
      )}
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
        <div className="classification-title">
          <span className="classification-title-icon">
            <Tag />
          </span>
          <div>
            <b>{multi ? "Multi-Label" : "Single-Label"} Classification</b>
            <span title={asset.name}>{asset.name}</span>
          </div>
        </div>
        <div className="image-nav">
          <button
            disabled={!index}
            onClick={() => setIndex((value) => value - 1)}
            aria-label="Gambar sebelumnya"
          >
            <ArrowLeft />
          </button>
          <span>
            {index + 1} / {project.assets.length}
          </span>
          <button
            disabled={index === project.assets.length - 1}
            onClick={() => setIndex((value) => value + 1)}
            aria-label="Gambar berikutnya"
          >
            <ChevronRight />
          </button>
        </div>
        <button className="primary small" onClick={() => go("versions")}>
          <Check />
          Tersimpan. Buat version
        </button>
      </div>
      <div className="classification-workspace">
        <section className="classification-image">
          <div className="classification-image-frame">
            <img src={asset.src} alt={asset.name} />
          </div>
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
            <div>
              <span className="eyebrow">LABEL GAMBAR</span>
              <strong>{asset.boxes.length} dipilih</strong>
            </div>
            <button
              onClick={addClass}
              title="Tambah class"
              aria-label="Tambah class"
            >
              <Plus />
            </button>
          </div>
          <p className="classification-instruction">
            {multi
              ? "Pilih semua class yang terlihat pada gambar ini. Perubahan langsung tersimpan."
              : "Pilih tepat satu class yang paling sesuai. Perubahan langsung tersimpan."}
          </p>
          <div className="classification-options">
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
                    <span className="classification-choice-name">{name}</span>
                    <span className="classification-check">
                      {selected ? <Check /> : null}
                    </span>
                  </button>
                  <label
                    className="classification-color"
                    title="Ubah warna class"
                  >
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
                  </label>
                  <button
                    className="classification-rename"
                    title="Ubah nama class"
                    aria-label={`Ubah nama class ${name}`}
                    onClick={() => renameClass(name, i)}
                  >
                    <Pencil />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="classification-shortcuts">
            <span className="classification-shortcut-icon">
              <Check />
            </span>
            <div>
              <b>Tersimpan otomatis</b>
              <span>
                Gunakan tombol panah di atas untuk memeriksa gambar berikutnya.
              </span>
            </div>
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
  const [arch, setArch] = useState("Salnova Detect Fast");
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
            "Salnova Detect Fast",
            "Salnova Detect Accurate",
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
  const ready = project.models.filter(modelCanDeploy);
  const deployedModel =
    ready.find((model) => model.stage === "production") || ready.at(-1);
  const [tab, setTab] = useState("image");
  const [preview, setPreview] = useState("");
  const [previewSize, setPreviewSize] = useState({ width: 1, height: 1 });
  const [viewerZoom, setViewerZoom] = useState(1);
  const [viewerPan, setViewerPan] = useState({ x: 0, y: 0 });
  const [viewerDragging, setViewerDragging] = useState(false);
  const [threshold, setThreshold] = useState(50);
  const [appliedThreshold, setAppliedThreshold] = useState(50);
  const [thresholdUpdating, setThresholdUpdating] = useState(false);
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
    timeline?: Array<{ second: number; counts: Record<string, number> }>;
    annotatedVideoUrl: string;
    annotatedVideoName: string;
  } | null>(null);
  const [videoSource, setVideoSource] = useState<{
    url: string;
    name: string;
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
  const [metrics, setMetrics] = useState<Awaited<
    ReturnType<typeof api.deploymentMetrics>
  > | null>(null);
  const [deploymentConfig, setDeploymentConfig] = useState<Awaited<
    ReturnType<typeof api.deploymentConfig>
  > | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const busy = useRef(false);
  const selectedImageFile = useRef<File | null>(null);
  const exampleRequested = useRef(false);
  const exampleProjectId = useRef("");
  const thresholdTimer = useRef<number | null>(null);
  const videoSourceUrl = useRef("");
  const thresholdRequest = useRef(0);
  const viewerDragOrigin = useRef({ x: 0, y: 0 });
  const resetViewer = () => {
    setViewerZoom(1);
    setViewerPan({ x: 0, y: 0 });
  };
  const startViewerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    viewerDragOrigin.current = {
      x: event.clientX - viewerPan.x,
      y: event.clientY - viewerPan.y,
    };
    setViewerDragging(true);
  };
  const moveViewer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!viewerDragging) return;
    setViewerPan({
      x: event.clientX - viewerDragOrigin.current.x,
      y: event.clientY - viewerDragOrigin.current.y,
    });
  };
  const stopViewerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setViewerDragging(false);
  };
  const zoomViewer = (next: number) =>
    setViewerZoom(Math.max(0.5, Math.min(4, next)));
  const wheelViewer = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    zoomViewer(viewerZoom + (event.deltaY < 0 ? 0.15 : -0.15));
  };
  const test = async (file?: File) => {
    if (!file) return;
    if (thresholdTimer.current) window.clearTimeout(thresholdTimer.current);
    setThresholdUpdating(false);
    selectedImageFile.current = file;
    const requestId = ++thresholdRequest.current;
    const reader = new FileReader();
    reader.onload = () => {
      setPreview(String(reader.result));
      resetViewer();
    };
    reader.readAsDataURL(file);
    setRunning(true);
    setTransferProgress(0);
    setTransferStage("uploading");
    setError("");
    setResult(null);
    try {
      const nextResult = await api.infer(
        project.id,
        file,
        threshold / 100,
        setTransferProgress,
        () => setTransferStage("processing"),
      );
      if (requestId === thresholdRequest.current) {
        setResult(nextResult);
        setAppliedThreshold(threshold);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inference gagal");
    } finally {
      if (requestId === thresholdRequest.current) {
        setRunning(false);
        setTransferProgress(null);
      }
    }
  };
  useEffect(() => {
    if (exampleProjectId.current !== project.id) {
      exampleProjectId.current = project.id;
      exampleRequested.current = false;
    }
    if (
      exampleRequested.current ||
      !project.name.startsWith("E2E COCO8 Detection") ||
      !deployedModel
    )
      return;
    const example =
      project.assets.find((asset) => asset.name === "000000000049.jpg") ||
      project.assets.find((asset) => asset.split === "valid") ||
      project.assets[0];
    if (!example) return;
    exampleRequested.current = true;
    // Show the tutorial image immediately; bounding boxes are overlaid as soon
    // as the inference response arrives.
    setPreview(example.src);
    setRunning(true);
    setError("");
    fetch(example.src)
      .then((response) => {
        if (!response.ok)
          throw new Error("Gambar contoh deployment tidak tersedia");
        return response.blob();
      })
      .then((blob) =>
        test(
          new File([blob], example.name, {
            type: blob.type || "image/jpeg",
          }),
        ),
      )
      .catch((exampleError) => {
        exampleRequested.current = false;
        setRunning(false);
        setError(
          exampleError instanceof Error
            ? exampleError.message
            : "Gagal menjalankan contoh deployment",
        );
      });
  }, [
    project.id,
    project.name,
    project.assets.length,
    project.assets[0]?.src,
    deployedModel?.id,
  ]);
  const changeImageThreshold = (value: number) => {
    setThreshold(value);
    if (tab !== "image" || !selectedImageFile.current) return;
    const requestId = ++thresholdRequest.current;
    if (thresholdTimer.current) window.clearTimeout(thresholdTimer.current);
    setThresholdUpdating(true);
    setTransferProgress(null);
    thresholdTimer.current = window.setTimeout(async () => {
      setRunning(true);
      setError("");
      try {
        const nextResult = await api.infer(
          project.id,
          selectedImageFile.current!,
          value / 100,
        );
        if (requestId !== thresholdRequest.current) return;
        setResult(nextResult);
        setAppliedThreshold(value);
      } catch (thresholdError) {
        if (requestId !== thresholdRequest.current) return;
        setError(
          thresholdError instanceof Error
            ? thresholdError.message
            : "Gagal memperbarui threshold",
        );
      } finally {
        if (requestId === thresholdRequest.current) {
          setRunning(false);
          setThresholdUpdating(false);
        }
      }
    }, 450);
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
  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  };
  const downloadJson = (value: unknown, filename: string) =>
    downloadBlob(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
      filename,
    );
  const downloadBatch = (format: "json" | "csv") => {
    if (format === "csv") {
      const csv = [
        "file,predictions,error",
        ...batchResults.map((item) =>
          [item.file, item.predictions, item.error || ""]
            .map((value) => `"${String(value).replaceAll('"', '""')}"`)
            .join(","),
        ),
      ].join("\n");
      downloadBlob(
        new Blob([csv], { type: "text/csv" }),
        "salnova-batch-results.csv",
      );
      return;
    }
    downloadJson(batchResults, "salnova-batch-results.json");
  };
  const testVideo = async (file?: File) => {
    if (!file) return;
    if (videoSourceUrl.current) URL.revokeObjectURL(videoSourceUrl.current);
    videoSourceUrl.current = URL.createObjectURL(file);
    setVideoSource({ url: videoSourceUrl.current, name: file.name });
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
  const endpoint = `${window.location.origin}/api/projects/${project.id}/infer`;
  const secureEndpoint = `${window.location.origin}/api/deploy/${project.id}/infer`;
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
      {i < 12 && (
        <span>
          {p.class} {Math.round(p.confidence * 100)}%
        </span>
      )}
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
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Webcam diblokir browser pada koneksi HTTP LAN. Buka Salnova melalui HTTPS atau localhost pada komputer ini.",
        );
      }
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
  useEffect(
    () => () => {
      stopCamera();
      if (thresholdTimer.current) window.clearTimeout(thresholdTimer.current);
      if (videoSourceUrl.current) URL.revokeObjectURL(videoSourceUrl.current);
    },
    [],
  );
  useEffect(() => {
    api
      .deploymentKeys(project.id)
      .then(setKeys)
      .catch(() => {});
    api
      .deploymentMetrics(project.id)
      .then(setMetrics)
      .catch(() => {});
    api
      .deploymentConfig(project.id)
      .then(setDeploymentConfig)
      .catch(() => {});
  }, [project.id]);
  const saveDeploymentConfig = async (next = deploymentConfig) => {
    if (!next) return;
    try {
      setDeploymentConfig(
        await api.updateDeploymentConfig(project.id, {
          primary_model_id: next.primaryModelId || null,
          canary_model_id: next.canaryModelId || null,
          canary_percent: next.canaryPercent,
          capture_samples: next.captureSamples,
        }),
      );
      setMetrics(await api.deploymentMetrics(project.id));
    } catch (configError) {
      setError(
        configError instanceof Error
          ? configError.message
          : "Deployment configuration failed",
      );
    }
  };
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
    thresholdRequest.current += 1;
    if (thresholdTimer.current) window.clearTimeout(thresholdTimer.current);
    setThresholdUpdating(false);
    setRunning(false);
    setTransferProgress(null);
    setTab(next);
    setError("");
    setResult(null);
    resetViewer();
  };
  const viewerSize = result?.image || previewSize;
  const viewerRatio = viewerSize.width / Math.max(1, viewerSize.height);
  const predictionGroups = result
    ? Object.entries(
        result.predictions.reduce<Record<string, number>>(
          (groups, prediction) => {
            groups[prediction.class] = (groups[prediction.class] || 0) + 1;
            return groups;
          },
          {},
        ),
      ).sort((a, b) => b[1] - a[1])
    : [];
  const drawResult = (
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
  ) => {
    if (!result) return;
    const scaleX = width / Math.max(1, result.image.width);
    const scaleY = height / Math.max(1, result.image.height);
    context.lineWidth = Math.max(2, width / 420);
    context.font = `600 ${Math.max(12, width / 55)}px sans-serif`;
    result.predictions.forEach((prediction) => {
      context.strokeStyle = "#7052e4";
      context.fillStyle = "#7052e4";
      if (prediction.points?.length) {
        context.beginPath();
        prediction.points.forEach((point, index) => {
          const x = point.x * scaleX;
          const y = point.y * scaleY;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.closePath();
        context.stroke();
      } else {
        context.strokeRect(
          prediction.x1 * scaleX,
          prediction.y1 * scaleY,
          (prediction.x2 - prediction.x1) * scaleX,
          (prediction.y2 - prediction.y1) * scaleY,
        );
      }
      const label = `${prediction.class} ${Math.round(prediction.confidence * 100)}%`;
      const x = prediction.x1 * scaleX;
      const y = Math.max(18, prediction.y1 * scaleY);
      const textWidth = context.measureText(label).width + 10;
      context.fillRect(x, y - 18, textWidth, 20);
      context.fillStyle = "#fff";
      context.fillText(label, x + 5, y - 4);
    });
  };
  const downloadAnnotatedImage = () => {
    if (!preview) return;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      drawResult(context, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, "salnova-detection.png");
      }, "image/png");
    };
    image.src = preview;
  };
  const downloadWebcamSnapshot = () => {
    if (!video.current?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.current.videoWidth;
    canvas.height = video.current.videoHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(video.current, 0, 0);
    drawResult(context, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, "salnova-webcam-detection.png");
    }, "image/png");
  };
  const cameraRequiresHttps =
    !window.isSecureContext || !navigator.mediaDevices?.getUserMedia;
  return (
    <div className="content deploy-page">
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
          {deployedModel && ` · ${deployedModel.alias || deployedModel.name}`}
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
                <div
                  className={
                    "preview inference-viewer " +
                    (viewerDragging ? "dragging" : "")
                  }
                  onPointerDown={startViewerDrag}
                  onPointerMove={moveViewer}
                  onPointerUp={stopViewerDrag}
                  onPointerCancel={stopViewerDrag}
                  onDoubleClick={resetViewer}
                  onWheel={wheelViewer}
                >
                  <div
                    className="inference-canvas"
                    style={{
                      aspectRatio: `${viewerSize.width} / ${viewerSize.height}`,
                      width: `min(100%, calc(380px * ${viewerRatio}))`,
                      transform: `translate(${viewerPan.x}px, ${viewerPan.y}px) scale(${viewerZoom})`,
                    }}
                  >
                    <img
                      src={preview}
                      alt="Inference preview"
                      draggable={false}
                      onLoad={(event) =>
                        setPreviewSize({
                          width: event.currentTarget.naturalWidth || 1,
                          height: event.currentTarget.naturalHeight || 1,
                        })
                      }
                    />
                    {boxes}
                  </div>
                  {(running || thresholdUpdating) && (
                    <div className="infer-loading">Running model…</div>
                  )}
                  <div className="inference-viewer-tools">
                    <button
                      title="Zoom out"
                      onClick={() => zoomViewer(viewerZoom - 0.25)}
                    >
                      <ZoomOut />
                    </button>
                    <span>{Math.round(viewerZoom * 100)}%</span>
                    <button
                      title="Zoom in"
                      onClick={() => zoomViewer(viewerZoom + 0.25)}
                    >
                      <ZoomIn />
                    </button>
                    <button onClick={resetViewer}>Fit</button>
                    <button
                      title="Download hasil dengan bounding box"
                      disabled={!result}
                      onClick={downloadAnnotatedImage}
                    >
                      <Download />
                    </button>
                  </div>
                  <small className="inference-viewer-hint">
                    Drag untuk menggeser · scroll untuk zoom · klik dua kali
                    untuk reset
                  </small>
                  <button
                    className="inference-preview-close"
                    title="Remove image"
                    onClick={() => {
                      setPreview("");
                      setResult(null);
                      setError("");
                      selectedImageFile.current = null;
                      thresholdRequest.current += 1;
                      if (thresholdTimer.current)
                        window.clearTimeout(thresholdTimer.current);
                      setThresholdUpdating(false);
                      setRunning(false);
                      resetViewer();
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
                {cameraRequiresHttps && (
                  <div className="camera-security-note">
                    <WifiOff />
                    <span>
                      <b>Webcam memerlukan koneksi aman</b>
                      <small>
                        Alamat HTTP LAN seperti {window.location.hostname}{" "}
                        diblokir browser. Gunakan HTTPS, atau buka localhost
                        jika Salnova berjalan di komputer ini.
                      </small>
                    </span>
                  </div>
                )}
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
                  disabled={!cameraOn && cameraRequiresHttps}
                  onClick={cameraOn ? stopCamera : startCamera}
                >
                  {cameraOn ? "Stop camera" : "Start camera"}
                </button>
                {cameraOn && result && (
                  <button
                    className="secondary media-download"
                    onClick={downloadWebcamSnapshot}
                  >
                    <Download /> Download snapshot
                  </button>
                )}
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
                      <button onClick={() => downloadBatch("json")}>
                        <Download /> JSON
                      </button>
                      <button onClick={() => downloadBatch("csv")}>
                        <Download /> CSV
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
                {videoSource && (
                  <div className="video-preview-card">
                    <video
                      key={videoResult?.annotatedVideoUrl || videoSource.url}
                      src={videoResult?.annotatedVideoUrl || videoSource.url}
                      controls
                      playsInline
                      preload="metadata"
                    />
                    <footer>
                      <span>
                        {videoResult
                          ? `Detection result · ${videoResult.annotatedVideoName}`
                          : `Original preview · ${videoSource.name}`}
                      </span>
                      {videoResult && (
                        <a
                          href={`${videoResult.annotatedVideoUrl}?download=true`}
                          download={videoResult.annotatedVideoName}
                        >
                          <Download /> Download detected video
                        </a>
                      )}
                    </footer>
                  </div>
                )}
                {running && transferProgress === null && (
                  <p className="infer-result">Processing video frames…</p>
                )}
                {videoResult && (
                  <div className="video-results">
                    <header>
                      <b>{videoResult.sampledFrames} frames analyzed</b>
                      <span>
                        {videoResult.durationSeconds}s video
                        <button
                          onClick={() =>
                            downloadJson(
                              videoResult,
                              "salnova-video-analysis.json",
                            )
                          }
                        >
                          <Download /> Download report
                        </button>
                      </span>
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
              <div className="inference-result-summary">
                <span>
                  <b>{result.predictions.length}</b>
                  <small>predictions found</small>
                </span>
                <div>
                  {predictionGroups.slice(0, 5).map(([name, count]) => (
                    <span key={name}>
                      <b>{name}</b>
                      <small>{count}</small>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="threshold">
              <span>
                Confidence threshold <b>{threshold}%</b>
              </span>
              <input
                type="range"
                value={threshold}
                onChange={(e) => changeImageThreshold(+e.target.value)}
              />
              <small className={thresholdUpdating ? "updating" : ""}>
                {thresholdUpdating
                  ? "Memperbarui prediksi…"
                  : `Hasil menggunakan threshold ${appliedThreshold}%`}
              </small>
            </div>
          </section>
          <section className="panel api">
            <h2>Use the local API</h2>
            <p>Connect your app to this model using HTTP.</p>
            <div className="endpoint">
              <span>POST</span>
              <code>{endpoint}</code>
              <button
                onClick={() => void copyText(endpoint)}
                title="Copy endpoint"
              >
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
            <code>{secureEndpoint}</code>
            <small>Header: X-API-Key</small>
          </div>
          <div className="deployment-summary">
            <span>
              <b>{metrics?.requests || 0}</b>
              <small>Recent requests</small>
            </span>
            <span>
              <b>{metrics?.p95LatencyMs || 0} ms</b>
              <small>P95 latency</small>
            </span>
            <span>
              <b>{metrics?.errorRate || 0}%</b>
              <small>Error rate</small>
            </span>
            <span>
              <b>{metrics?.driftScore || 0}%</b>
              <small>Class drift</small>
            </span>
          </div>
          {deploymentConfig && (
            <div className="traffic-routing">
              <div>
                <b>Traffic routing</b>
                <small>
                  Promote gradually, observe, and roll back without changing the
                  endpoint.
                </small>
              </div>
              <label>
                Primary model
                <select
                  value={deploymentConfig.primaryModelId || ""}
                  onChange={(event) =>
                    setDeploymentConfig({
                      ...deploymentConfig,
                      primaryModelId: event.target.value || null,
                    })
                  }
                >
                  <option value="">Automatic production model</option>
                  {ready.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.alias || model.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Canary model
                <select
                  value={deploymentConfig.canaryModelId || ""}
                  onChange={(event) =>
                    setDeploymentConfig({
                      ...deploymentConfig,
                      canaryModelId: event.target.value || null,
                      canaryPercent: event.target.value
                        ? deploymentConfig.canaryPercent
                        : 0,
                    })
                  }
                >
                  <option value="">No canary</option>
                  {ready
                    .filter(
                      (model) => model.id !== deploymentConfig.primaryModelId,
                    )
                    .map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.alias || model.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Canary traffic <b>{deploymentConfig.canaryPercent}%</b>
                <input
                  type="range"
                  min="0"
                  max="50"
                  step="5"
                  disabled={!deploymentConfig.canaryModelId}
                  value={deploymentConfig.canaryPercent}
                  onChange={(event) =>
                    setDeploymentConfig({
                      ...deploymentConfig,
                      canaryPercent: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="capture-samples">
                <span>
                  <input
                    type="checkbox"
                    checked={deploymentConfig.captureSamples}
                    onChange={(event) =>
                      setDeploymentConfig({
                        ...deploymentConfig,
                        captureSamples: event.target.checked,
                      })
                    }
                  />{" "}
                  Capture feedback samples
                </span>
                <small>
                  Incorrect requests become private active-learning items. Keep
                  off for sensitive inputs.
                </small>
              </label>
              <div className="traffic-actions">
                <button
                  className="primary"
                  onClick={() => saveDeploymentConfig()}
                >
                  <Check /> Save routing
                </button>
                <button
                  disabled={!deploymentConfig.previousModelId}
                  onClick={async () => {
                    if (!confirm("Roll back to the previous production model?"))
                      return;
                    setDeploymentConfig(
                      await api.rollbackDeployment(project.id),
                    );
                    setMetrics(await api.deploymentMetrics(project.id));
                  }}
                >
                  <History /> Roll back
                </button>
              </div>
            </div>
          )}
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
                <span>Feedback</span>
              </div>
              {metrics.recent.map((entry, index) => (
                <div key={`${entry.created_at}-${index}`}>
                  <span>{entry.created_at.slice(0, 19).replace("T", " ")}</span>
                  <span className={entry.status === "ok" ? "success" : "error"}>
                    {entry.status}
                  </span>
                  <span>{entry.predictions}</span>
                  <span>{Math.round(entry.latency_ms)} ms</span>
                  <span className="request-feedback">
                    {entry.feedback || (
                      <>
                        <button
                          title="Correct prediction"
                          onClick={async () => {
                            await api.inferenceFeedback(
                              project.id,
                              entry.id,
                              "correct",
                            );
                            setMetrics(await api.deploymentMetrics(project.id));
                          }}
                        >
                          ✓
                        </button>
                        <button
                          title="Incorrect · send to review"
                          onClick={async () => {
                            const note =
                              prompt(
                                "What was wrong with this prediction?",
                                "",
                              ) || "";
                            await api.inferenceFeedback(
                              project.id,
                              entry.id,
                              "incorrect",
                              note,
                            );
                            setMetrics(await api.deploymentMetrics(project.id));
                          }}
                        >
                          ×
                        </button>
                      </>
                    )}
                  </span>
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
      projectId: projects.find((p) => p.models.some(modelCanDeploy))?.id,
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
            ? projects.find((p) => p.models.some(modelCanDeploy))?.id
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
              .filter((p) => p.models.some(modelCanDeploy))
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
                      .filter((item) => item.models.some(modelCanDeploy))
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
  update,
}: {
  project: Project;
  go: (page: Page) => void;
  notify: (message: string) => void;
  update: (fn: (project: Project) => Project) => void;
}) {
  const [health, setHealth] = useState<DatasetHealth | null>(null);
  const [jobs, setJobs] = useState<AnnotationJob[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [queue, setQueue] = useState<ActiveLearningItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [activeLearningProgress, setActiveLearningProgress] = useState<
    Partial<DatasetHealthProgress>
  >({});
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(
    () => new Set(),
  );
  const [healthActionBusy, setHealthActionBusy] = useState(false);
  const [healthProgress, setHealthProgress] = useState<DatasetHealthProgress>({
    scanning: false,
    progress: 0,
    processed: 0,
    total: 0,
    stage: "Ready to scan",
    etaSeconds: 0,
  });
  const healthProgressTimer = useRef<number | null>(null);
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
    setActiveLearningProgress(active.progress || {});
  };
  const scanHealth = async () => {
    setLoadingHealth(true);
    setHealthProgress((current) => ({
      ...current,
      scanning: true,
      progress: 1,
      stage: "Preparing dataset scan",
    }));
    const pollProgress = () =>
      api
        .datasetHealthProgress(project.id)
        .then(setHealthProgress)
        .catch(() => {});
    await pollProgress();
    healthProgressTimer.current = window.setInterval(pollProgress, 500);
    try {
      setHealth(await api.datasetHealth(project.id));
      await pollProgress();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Dataset scan gagal");
    } finally {
      if (healthProgressTimer.current)
        window.clearInterval(healthProgressTimer.current);
      healthProgressTimer.current = null;
      setLoadingHealth(false);
    }
  };
  useEffect(() => {
    load().catch(() => {});
    scanHealth();
    return () => {
      if (healthProgressTimer.current)
        window.clearInterval(healthProgressTimer.current);
    };
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
  const applyIssueAction = async (
    action: "delete" | "review" | "approve" | "train" | "valid" | "test",
  ) => {
    const ids = [...selectedIssues];
    if (!ids.length) return;
    if (
      action === "delete" &&
      !confirm(`Delete ${ids.length} selected assets and their files?`)
    )
      return;
    setHealthActionBusy(true);
    try {
      const saved = await api.applyHealthAction(project.id, ids, action);
      update(() => saved);
      setSelectedIssues(new Set());
      setHealth(await api.datasetHealth(project.id));
      notify(`${ids.length} dataset issues updated`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Dataset action failed");
    } finally {
      setHealthActionBusy(false);
    }
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
      {loadingHealth && (
        <section className="panel health-scan-progress" aria-live="polite">
          <header>
            <span>
              <LoaderCircle />
              <b>Scanning dataset</b>
            </span>
            <strong>{healthProgress.progress}%</strong>
          </header>
          <progress max="100" value={healthProgress.progress} />
          <footer>
            <span>{healthProgress.stage}</span>
            <span>
              {healthProgress.processed}/
              {healthProgress.total || project.assets.length} files
              {healthProgress.etaSeconds > 0
                ? ` · sekitar ${Math.ceil(healthProgress.etaSeconds / 60)} menit lagi`
                : ""}
            </span>
          </footer>
        </section>
      )}
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
            <b>{health.imbalanceRatio || "N/A"}</b>
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
          {!!health?.issues.length && (
            <div className="health-actions">
              <label>
                <input
                  type="checkbox"
                  checked={selectedIssues.size === health.issues.length}
                  onChange={(event) =>
                    setSelectedIssues(
                      event.target.checked
                        ? new Set(health.issues.map((item) => item.assetId))
                        : new Set(),
                    )
                  }
                />{" "}
                {selectedIssues.size || "Select"} affected
              </label>
              <button
                disabled={!selectedIssues.size || healthActionBusy}
                onClick={() => applyIssueAction("review")}
              >
                Needs fix
              </button>
              <button
                disabled={!selectedIssues.size || healthActionBusy}
                onClick={() => applyIssueAction("approve")}
              >
                Approve
              </button>
              <button
                disabled={!selectedIssues.size || healthActionBusy}
                onClick={() => applyIssueAction("valid")}
              >
                Move to valid
              </button>
              <button
                className="delete"
                disabled={!selectedIssues.size || healthActionBusy}
                onClick={() => applyIssueAction("delete")}
              >
                <Trash2 /> Delete
              </button>
            </div>
          )}
          {health?.issues.slice(0, 100).map((item) => (
            <div className="health-issue-row" key={item.assetId}>
              <input
                aria-label={`Select ${item.name}`}
                type="checkbox"
                checked={selectedIssues.has(item.assetId)}
                onChange={() =>
                  setSelectedIssues((current) => {
                    const next = new Set(current);
                    if (next.has(item.assetId)) next.delete(item.assetId);
                    else next.add(item.assetId);
                    return next;
                  })
                }
              />
              <button onClick={() => openAsset(item.assetId)}>
                <span>
                  <b>{item.name}</b>
                  <small>{item.issues.join(" · ")}</small>
                </span>
                <ChevronRight />
              </button>
            </div>
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
            disabled={scanning || !project.models.some(modelCanDeploy)}
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
        {scanning && (
          <div className="active-learning-progress" aria-live="polite">
            <span>
              <b>
                {activeLearningProgress.stage || "Scanning uncertain images"}
              </b>
              <strong>{activeLearningProgress.progress || 1}%</strong>
            </span>
            <progress max="100" value={activeLearningProgress.progress || 1} />
            <small>
              {activeLearningProgress.processed || 0}/
              {activeLearningProgress.total || 100} images
              {(activeLearningProgress.etaSeconds || 0) > 0
                ? ` · sekitar ${Math.ceil((activeLearningProgress.etaSeconds || 0) / 60)} menit lagi`
                : ""}
            </small>
          </div>
        )}
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

function SquareResizePreview({ src, size }: { src: string; size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [sourceSize, setSourceSize] = useState("");

  useEffect(() => {
    let active = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, size, size);
    setLoading(true);

    const image = new Image();
    image.onload = () => {
      if (!active || !context) return;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, size, size);
      setSourceSize(`${image.naturalWidth} x ${image.naturalHeight}`);
      setLoading(false);
    };
    image.onerror = () => {
      if (active) setLoading(false);
    };
    image.src = src;
    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [src, size]);

  return (
    <div
      className={"square-resize-stage" + (loading ? " is-loading" : "")}
      aria-label={`Square resize preview ${size} x ${size} pixels`}
    >
      <canvas
        ref={canvasRef}
        className="square-resize-canvas"
        style={
          { "--preview-scale": `${(size / 1280) * 100}%` } as CSSProperties
        }
      />
      {loading && <LoaderCircle className="spin" />}
      <span>
        {sourceSize
          ? `${sourceSize} to ${size} x ${size}`
          : `${size} x ${size}`}
      </span>
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
  const [enforceQuality, setEnforceQuality] = useState(true);
  const [splits, setSplits] = useState<[number, number, number]>([70, 20, 10]);
  const [recipe, setRecipe] =
    useState<AugmentationRecipe>(defaultAugmentations);
  const [generating, setGenerating] = useState(false);
  const [generationSeconds, setGenerationSeconds] = useState(0);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStage, setGenerationStage] = useState("Menyiapkan dataset");
  const [generationProcessed, setGenerationProcessed] = useState(0);
  const [generationTotal, setGenerationTotal] = useState(0);
  const [generationError, setGenerationError] = useState("");
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
  useEffect(() => {
    let active = true;
    api
      .versionProgress(project.id)
      .then((status) => {
        if (!active || status.status !== "running") return;
        setGenerationProgress(status.progress);
        setGenerationStage(status.stage);
        setGenerationProcessed(status.processed || 0);
        setGenerationTotal(status.total || estimatedTotal);
        setGenerationError("");
        setGenerating(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [estimatedTotal, project.id]);
  useEffect(() => {
    if (!generating) return;
    setGenerationSeconds(0);
    const timer = window.setInterval(
      () => setGenerationSeconds((seconds) => seconds + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [generating]);
  useEffect(() => {
    if (!generating) return;
    let active = true;
    const poll = async () => {
      try {
        const status = await api.versionProgress(project.id);
        if (!active) return;
        setGenerationProgress(status.progress);
        setGenerationStage(status.stage);
        setGenerationProcessed(status.processed || 0);
        setGenerationTotal(status.total || estimatedTotal);
        if (status.status === "completed") {
          const fresh = await api.project(project.id);
          if (!active) return;
          update(() => fresh);
          setGenerating(false);
          notify("Immutable dataset version selesai");
        } else if (status.status === "failed") {
          setGenerationError(status.error || "Generate version gagal");
          setGenerating(false);
        }
      } catch {}
    };
    void poll();
    const timer = window.setInterval(poll, 700);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [estimatedTotal, generating, project.id]);
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
    setGenerationError("");
    setGenerationProgress(1);
    setGenerationStage("Menyiapkan dataset");
    setGenerationProcessed(0);
    setGenerationTotal(estimatedTotal);
    setGenerating(true);
    try {
      const saved = await api.version(project.id, {
        resize,
        augment,
        splits,
        augmentations: recipe,
        augmentation_copies: copies,
        enforce_quality: enforceQuality,
      });
      setGenerationProgress(100);
      setGenerationStage("Immutable version selesai");
      setGenerationProcessed(generationTotal || estimatedTotal);
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      update(() => saved);
      notify(`Dataset version dibuat: sekitar ${estimatedTotal} gambar`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Gagal membuat version";
      setGenerationError(message);
      notify(message);
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
                : "N/A, must equal 100%"}
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
                  <img
                    src={previewAsset.src}
                    alt={`${previewAsset.name} original`}
                  />
                  <figcaption>Original</figcaption>
                </figure>
                <figure className="square-preview">
                  <SquareResizePreview src={previewAsset.src} size={resize} />
                  <figcaption>
                    {resize} x {resize} preview, relative resolution scale
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
                          <figure className="augment-preview">
                            {previewAsset ? (
                              <div>
                                <img
                                  src={previewAsset.src}
                                  alt={`Preview ${option.name}`}
                                  style={augmentationPreviewStyle(
                                    option.key,
                                    setting.amount,
                                  )}
                                />
                                {option.key === "noise" && (
                                  <i
                                    className="augment-noise"
                                    style={{
                                      opacity: Math.min(
                                        0.72,
                                        setting.amount / option.max,
                                      ),
                                    }}
                                  />
                                )}
                                {option.key === "cutout" && (
                                  <i
                                    className="augment-cutout"
                                    style={{
                                      width: `${setting.amount}%`,
                                      height: `${setting.amount}%`,
                                    }}
                                  />
                                )}
                                {option.key === "jpeg" && (
                                  <i
                                    className="augment-jpeg"
                                    style={{
                                      opacity: Math.max(
                                        0.08,
                                        (100 - setting.amount) / 130,
                                      ),
                                    }}
                                  />
                                )}
                              </div>
                            ) : (
                              <div className="augment-preview-empty">
                                <ImageIcon />
                              </div>
                            )}
                            <figcaption>
                              Preview · {Math.round(setting.probability * 100)}%
                            </figcaption>
                          </figure>
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
          <label className="quality-gate-toggle">
            <input
              type="checkbox"
              checked={enforceQuality}
              onChange={(event) => setEnforceQuality(event.target.checked)}
            />
            <span>
              <b>Enforce dataset quality gate</b>
              <small>
                Block immutable versions while assets are unlabeled, marked
                needs-fix, or contain invalid geometry.
              </small>
            </span>
          </label>
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
          {generationError && (
            <div className="version-generation-error" role="alert">
              <b>Version gagal dibuat</b>
              <span>{generationError}</span>
            </div>
          )}
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
      {generating && (
        <div
          className="version-generation-overlay"
          role="status"
          aria-live="polite"
        >
          <div className="version-generation-progress">
            <LoaderCircle />
            <div>
              <b>Membuat immutable dataset version</b>
              <span>
                {generationStage} · {generationSeconds}s
              </span>
            </div>
            <strong>{generationProgress}%</strong>
            <div className="version-generation-count">
              <b>
                {generationProcessed.toLocaleString("id-ID")} /{" "}
                {(generationTotal || estimatedTotal).toLocaleString("id-ID")}
              </b>
              <span>gambar dataset sudah terbentuk</span>
            </div>
            <i>
              <em style={{ width: `${generationProgress}%` }} />
            </i>
            <small>
              Proses tetap berjalan di server. Jangan tutup halaman ini.
            </small>
          </div>
        </div>
      )}
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
  const multiLabelExportOnly = project.type === "Multi-Label Classification";
  const classificationMetrics = project.type === "Single-Label Classification";
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
  const trainingLabel = {
    detect: "detection",
    segment: "segmentation",
    pose: "keypoint detection",
    obb: "oriented object detection",
    cls: "classification",
  }[trainingTask];
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
  const [baseModelId, setBaseModelId] = useState(
    () => sessionStorage.getItem(`visionflow-finetune-${project.id}`) || "",
  );
  const [freezeLayers, setFreezeLayers] = useState(0);
  const [weightDecay, setWeightDecay] = useState(0.0005);
  const [cosLr, setCosLr] = useState(false);
  const [closeMosaic, setCloseMosaic] = useState(10);
  const [amp, setAmp] = useState(true);
  const [device, setDevice] = useState("auto");
  const [executionTarget, setExecutionTarget] = useState<
    | "server"
    | "remote-auto"
    | "remote-gpu"
    | "remote-cpu"
    | "colab-auto"
    | "colab-gpu"
    | "colab-cpu"
  >("server");
  const [trainingRoute, setTrainingRoute] = useState<TrainingRoute>("nas");
  const [workerId, setWorkerId] = useState("");
  const [workers, setWorkers] = useState<TrainingWorker[]>([]);
  const [starting, setStarting] = useState(false);
  const colabTarget = executionTarget.startsWith("colab-");
  const gpuTarget =
    executionTarget === "remote-gpu" || executionTarget === "colab-gpu";
  const selectableWorkers = workers.filter(
    (worker) =>
      !worker.revoked &&
      worker.profile === trainingRoute &&
      (!colabTarget || worker.capabilities.provider === "google-colab") &&
      (!gpuTarget || worker.capabilities.cuda),
  );
  // Use the browser origin so laptop workers go through the same Vite/NAS
  // proxy as the UI. The API itself remains private on localhost in dev mode.
  const workerServer = window.location.origin;
  const computePreference = executionTarget.endsWith("-gpu")
    ? "gpu"
    : executionTarget.endsWith("-cpu")
      ? "cpu"
      : "auto";
  const selectedComputePreference =
    trainingRoute === "nas"
      ? device === "0"
        ? "gpu"
        : device
      : computePreference;
  const selectTrainingRoute = (route: TrainingRoute) => {
    setTrainingRoute(route);
    setWorkerId("");
    setExecutionTarget(
      route === "nas"
        ? "server"
        : route === "colab"
          ? "colab-gpu"
          : "remote-auto",
    );
  };
  const selectComputePreference = (preference: "auto" | "gpu" | "cpu") => {
    if (trainingRoute === "nas") {
      setDevice(preference === "gpu" ? "0" : preference);
      return;
    }
    const targetPrefix = trainingRoute === "colab" ? "colab" : "remote";
    setExecutionTarget(
      `${targetPrefix}-${preference}` as typeof executionTarget,
    );
    setWorkerId("");
  };
  const active = project.models.some(
    (model) => model.status === "training" || model.status === "queued",
  );
  useEffect(() => {
    let cancelled = false;
    api
      .project(project.id)
      .then((fresh) => {
        if (!cancelled) update(() => fresh);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [project.id]);
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
    const latestVersionId = project.versions.at(-1)?.id || "";
    if (
      !versionId ||
      !project.versions.some((version) => version.id === versionId)
    ) {
      setVersionId(latestVersionId);
    }
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
  const createWorker = async (profile: Exclude<TrainingRoute, "nas">) => {
    const defaults: Record<Exclude<TrainingRoute, "nas">, string> = {
      "this-pc": "PC RTX 50/60 Lab",
      "own-device": "Device training",
      colab: "Google Colab",
    };
    const name = prompt("Nama training worker", defaults[profile])?.trim();
    if (!name) return;
    try {
      const worker = await api.createTrainingWorker(name, profile);
      setWorkers((current) => [worker, ...current]);
      setWorkerId(worker.id);
      return worker;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Gagal membuat worker");
      return undefined;
    }
  };
  const downloadColabNotebook = async () => {
    const requestedTarget = colabTarget ? executionTarget : "colab-gpu";
    const suggested =
      window.location.protocol === "https:" ? workerServer : "https://";
    const entered = prompt(
      "URL HTTPS publik Salnova yang dapat diakses Google Colab",
      suggested,
    )?.trim();
    if (!entered) return;
    let publicServer: URL;
    try {
      publicServer = new URL(entered);
    } catch {
      notify("URL server tidak valid");
      return;
    }
    if (
      publicServer.protocol !== "https:" ||
      ["localhost", "127.0.0.1", "0.0.0.0"].includes(publicServer.hostname)
    ) {
      notify("Google Colab memerlukan URL HTTPS publik, bukan localhost");
      return;
    }
    try {
      const worker = await api.createTrainingWorker("Google Colab", "colab");
      const colabWorker: TrainingWorker = {
        ...worker,
        capabilities: { ...worker.capabilities, provider: "google-colab" },
      };
      setWorkers((current) => [colabWorker, ...current]);
      setWorkerId(worker.id);
      setTrainingRoute("colab");
      setExecutionTarget(requestedTarget);
      const server = publicServer.toString().replace(/\/$/, "");
      const source = [
        "import subprocess, sys, urllib.request",
        `SERVER = ${JSON.stringify(server)}`,
        `TOKEN = ${JSON.stringify(worker.token)}`,
        `WORK_DIR = ${JSON.stringify(`salnova-worker-${worker.id}`)}`,
        `REQUESTED_TARGET = ${JSON.stringify(requestedTarget)}`,
        'print("Installing Salnova worker dependencies...")',
        'urllib.request.urlretrieve(SERVER + "/api/training-workers/setup/visionflow_worker.py", "visionflow_worker.py")',
        'urllib.request.urlretrieve(SERVER + "/api/training-workers/setup/requirements.txt", "requirements.txt")',
        'subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "-r", "requirements.txt"])',
        "import torch",
        "CUDA_READY = torch.cuda.is_available()",
        'print("PyTorch:", torch.__version__, "| CUDA runtime:", torch.version.cuda, "| GPU ready:", CUDA_READY)',
        'if CUDA_READY: print("GPU:", torch.cuda.get_device_name(0))',
        'if REQUESTED_TARGET == "colab-gpu" and not CUDA_READY: raise RuntimeError("GPU Colab belum aktif. Pilih Runtime > Change runtime type > T4 GPU, lalu restart dan Run all.")',
        'print("Connecting Colab runtime to", SERVER)',
        'subprocess.check_call([sys.executable, "visionflow_worker.py", "--server", SERVER, "--token", TOKEN, "--provider", "google-colab", "--work-dir", WORK_DIR, "--keep-jobs"])',
      ].map((line) => line + "\n");
      const notebook = {
        nbformat: 4,
        nbformat_minor: 0,
        metadata: {
          colab: { name: "Salnova-Colab-Worker.ipynb" },
          kernelspec: { name: "python3", display_name: "Python 3" },
          accelerator: "GPU",
        },
        cells: [
          {
            cell_type: "markdown",
            metadata: {},
            source: [
              "# Salnova Google Colab Worker\n",
              "Keep this notebook private because it contains a worker token. For GPU training select **Runtime > Change runtime type > T4 GPU**, save it, then choose **Runtime > Run all**. The setup cell now stops with a clear message when CUDA is unavailable.\n",
            ],
          },
          {
            cell_type: "code",
            execution_count: null,
            metadata: {},
            outputs: [],
            source,
          },
        ],
      };
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(notebook, null, 2)], {
          type: "application/x-ipynb+json",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "Salnova-Colab-Worker.ipynb";
      anchor.click();
      URL.revokeObjectURL(url);
      notify(
        "Notebook Colab dibuat. Jangan bagikan karena berisi token worker.",
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Gagal membuat notebook Colab",
      );
    }
  };
  const downloadWorkerSetup = (
    profile: Exclude<TrainingRoute, "nas">,
    tokenValue: string,
    workerIdValue: string,
  ) => {
    if (!tokenValue || !workerIdValue) return;
    const quote = (value: string) => value.replace(/'/g, "''");
    const provider = profile === "colab" ? "google-colab" : "local";
    const script = `# Salnova Windows training worker bootstrap
# Generated by Salnova. Keep this file private because it contains a worker token.
# Windows PowerShell 5.1 converts stderr from native programs (Python, pip,
# nvidia-smi, and winget) into PowerShell error records.  Keeping the global
# preference at Stop would abort expected compatibility probes before their
# exit codes can be inspected and the CPU fallback can run.
$ErrorActionPreference = "Continue"
$PSDefaultParameterValues['*:ErrorAction'] = 'Stop'
$ProgressPreference = "SilentlyContinue"
$server = '${quote(workerServer)}'
$token = '${quote(tokenValue)}'
$provider = '${provider}'
$workerId = '${quote(workerIdValue)}'
$installAsLabWorker = ${profile === "this-pc" ? "$true" : "$false"}
$workerRoot = if ($env:SALNOVA_WORKER_HOME) {
  $env:SALNOVA_WORKER_HOME
} elseif (Test-Path -LiteralPath (Join-Path $env:USERPROFILE "VisionFlowWorker")) {
  Join-Path $env:USERPROFILE "VisionFlowWorker"
} elseif (Test-Path -LiteralPath 'F:\') {
  'F:\SalnovaWorker'
} else {
  Join-Path $env:USERPROFILE "SalnovaWorker"
}
$deviceRoot = Join-Path $workerRoot "devices/$workerId"

$serverUri = [Uri]$server
if ($serverUri.Host -in @('localhost', '127.0.0.1', '0.0.0.0')) {
  $enteredServer = Read-Host "Server masih localhost. Untuk device lain, masukkan URL Salnova LAN/HTTPS (Enter jika worker ada di PC ini)"
  if ($enteredServer.Trim()) { $server = $enteredServer.Trim().TrimEnd('/') }
}
$rawBase = "$server/api/training-workers/setup"

function Write-Step([string]$message) {
  Write-Host "[Salnova setup] $message" -ForegroundColor Cyan
}

function Test-Python([string]$command, [string[]]$prefix) {
  try {
    & $command @prefix -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)"
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

$pythonCommand = $null
$pythonPrefix = @()
if ((Get-Command py -ErrorAction SilentlyContinue) -and (Test-Python "py" @("-3"))) {
  $pythonCommand = "py"
  $pythonPrefix = @("-3")
} elseif ((Get-Command python -ErrorAction SilentlyContinue) -and (Test-Python "python" @())) {
  $pythonCommand = "python"
}

if (-not $pythonCommand) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Python 3.10+ tidak ditemukan dan winget tidak tersedia. Install Python dari python.org, aktifkan Add Python to PATH, lalu jalankan setup.ps1 lagi."
  }
  Write-Step "Python 3.12 belum tersedia. Memasang Python untuk user ini..."
  & winget install --exact --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements --silent
  $installedPython = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Programs/Python/Python*/python.exe") -File -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if (-not $installedPython -or -not (Test-Python $installedPython.FullName @())) {
    throw "Instalasi Python selesai tetapi executable belum ditemukan. Buka PowerShell baru lalu jalankan setup.ps1 lagi."
  }
  $pythonCommand = $installedPython.FullName
}

$venvPython = Join-Path $workerRoot ".venv/Scripts/python.exe"
if (!(Test-Path -LiteralPath $venvPython)) {
  $driveName = (Split-Path -Qualifier $workerRoot).TrimEnd('\\').TrimEnd(':')
  $driveInfo = Get-PSDrive -Name $driveName -ErrorAction SilentlyContinue
  if ($driveInfo -and $driveInfo.Free -lt 6GB) {
    throw "Drive $driveName membutuhkan minimal 6 GB kosong. Set SALNOVA_WORKER_HOME ke drive lain lalu jalankan ulang."
  }
}

New-Item -ItemType Directory -Force -Path (Join-Path $workerRoot "worker") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $workerRoot ".tmp") | Out-Null
New-Item -ItemType Directory -Force -Path $deviceRoot | Out-Null
$env:TEMP = Join-Path $workerRoot ".tmp"
$env:TMP = $env:TEMP
$env:PIP_NO_CACHE_DIR = "1"

Write-Step "Mengunduh worker terbaru dari $server"
Invoke-WebRequest -UseBasicParsing "$rawBase/visionflow_worker.py" -OutFile (Join-Path $workerRoot "worker/visionflow_worker.py")
Invoke-WebRequest -UseBasicParsing "$rawBase/requirements.txt" -OutFile (Join-Path $workerRoot "worker/requirements.txt")
if ($installAsLabWorker) {
  Invoke-WebRequest -UseBasicParsing "$rawBase/run-worker.ps1" -OutFile (Join-Path $workerRoot "worker/run-worker.ps1")
}

if (!(Test-Path $venvPython)) {
  Write-Step "Membuat virtual environment terisolasi"
  & $pythonCommand @pythonPrefix -m venv (Join-Path $workerRoot ".venv")
  if ($LASTEXITCODE -ne 0 -or !(Test-Path $venvPython)) { throw "Gagal membuat Python virtual environment." }
}

Write-Step "Memperbarui pip dan package build"
& $venvPython -m pip install --upgrade pip setuptools wheel
if ($LASTEXITCODE -ne 0) { throw "Gagal memperbarui pip dan package build. Periksa internet dan ruang disk." }
$cudaProbe = "import sys,torch,torchvision; sys.exit(1) if not torch.cuda.is_available() else torchvision.ops.nms(torch.tensor([[0.,0.,1.,1.]],device='cuda'),torch.tensor([1.],device='cuda'),0.5)"
$cpuProbe = "import torch,torchvision; torchvision.ops.nms(torch.tensor([[0.,0.,1.,1.]]),torch.tensor([1.]),0.5)"
$hasNvidia = $null -ne (Get-Command nvidia-smi -ErrorAction SilentlyContinue)
$gpuReady = $false
if ($hasNvidia) {
  & $venvPython -c $cudaProbe 2>$null
  $gpuReady = $LASTEXITCODE -eq 0
  if (-not $gpuReady) {
    $cudaText = (& nvidia-smi 2>$null | Out-String)
    $match = [regex]::Match($cudaText, "CUDA Version:[ ]*([0-9]+)[.]([0-9]+)")
    $cudaLevel = if ($match.Success) { ([int]$match.Groups[1].Value * 10) + [int]$match.Groups[2].Value } else { 126 }
    $cudaCandidates = @()
    if ($cudaLevel -ge 128) { $cudaCandidates += "cu128" }
    if ($cudaLevel -ge 126) { $cudaCandidates += "cu126" }
    if ($cudaLevel -ge 124) { $cudaCandidates += "cu124" }
    if ($cudaLevel -ge 121) { $cudaCandidates += "cu121" }
    if ($cudaLevel -ge 118) { $cudaCandidates += "cu118" }
    foreach ($cudaBuild in $cudaCandidates) {
      Write-Step "Mencoba runtime NVIDIA $cudaBuild yang cocok dengan driver"
      & $venvPython -m pip install --upgrade --force-reinstall torch torchvision --index-url "https://download.pytorch.org/whl/$cudaBuild"
      if ($LASTEXITCODE -eq 0) {
        & $venvPython -c $cudaProbe 2>$null
        if ($LASTEXITCODE -eq 0) {
          $gpuReady = $true
          Write-Host "Runtime GPU $cudaBuild siap." -ForegroundColor Green
          break
        }
      }
    }
  }
  if (-not $gpuReady) {
    Write-Warning "Tidak ada runtime CUDA yang lolos pengujian. Worker otomatis menggunakan CPU."
  }
}
if (-not $gpuReady) {
  & $venvPython -c $cpuProbe 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Step "Memasang runtime CPU yang kompatibel"
    & $venvPython -m pip install --upgrade --force-reinstall torch torchvision --index-url https://download.pytorch.org/whl/cpu
    if ($LASTEXITCODE -ne 0) { throw "PyTorch CPU gagal dipasang. Periksa internet dan ruang disk." }
    & $venvPython -c $cpuProbe
    if ($LASTEXITCODE -ne 0) { throw "Runtime CPU terpasang tetapi gagal menjalankan operasi training." }
  }
}

Write-Step "Memasang requests, Ultralytics, dan dependency training"
& $venvPython -m pip install --prefer-binary -r (Join-Path $workerRoot "worker/requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "Instalasi requirements gagal. Periksa internet dan ruang disk." }

Write-Step "Memverifikasi Python, Ultralytics, PyTorch, CPU, dan GPU"
& $venvPython -c "import requests,torch,ultralytics; print('Python packages: OK'); print('PyTorch:',torch.__version__); print('CUDA:',torch.version.cuda); print('GPU available:',torch.cuda.is_available()); print('Device:',torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
if ($LASTEXITCODE -ne 0) { throw "Verifikasi package gagal." }

Write-Host "Setup lengkap. Worker menghubungkan ke $server ..." -ForegroundColor Green
Write-Host "Log dan checkpoint device disimpan di $deviceRoot" -ForegroundColor Green
if ($installAsLabWorker) {
  Write-Host "PC RTX lab akan aktif otomatis saat PC menyala." -ForegroundColor Green
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $workerRoot "worker/run-worker.ps1") -Token $token -Server $server -Install
} else {
  & $venvPython (Join-Path $workerRoot "worker/visionflow_worker.py") --server $server --token $token --provider $provider --work-dir $deviceRoot --keep-jobs
}
`;
    const url = URL.createObjectURL(
      new Blob([script], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `salnova-${profile}-setup.ps1`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify(
      "Setup worker diunduh. Jalankan di laptop target dengan PowerShell.",
    );
  };
  const downloadUnixWorkerSetup = (
    profile: Exclude<TrainingRoute, "nas">,
    tokenValue: string,
    workerIdValue: string,
  ) => {
    if (!tokenValue || !workerIdValue) return;
    const quote = (value: string) => value.replace(/'/g, "'\"'\"'");
    const provider = profile === "colab" ? "google-colab" : "local";
    const script = [
      "#!/usr/bin/env bash",
      "# Salnova Linux training worker bootstrap. Keep this file private.",
      "set -euo pipefail",
      "server='" + quote(workerServer) + "'",
      "token='" + quote(tokenValue) + "'",
      "provider='" + provider + "'",
      "worker_id='" + quote(workerIdValue) + "'",
      'worker_root="${SALNOVA_WORKER_HOME:-$HOME/SalnovaWorker}"',
      'device_root="$worker_root/devices/$worker_id"',
      'case "$server" in http://localhost*|http://127.0.0.1*|http://0.0.0.0*) read -r -p "Server masih localhost. Masukkan URL Salnova LAN/HTTPS, atau Enter jika worker ada di device ini: " entered_server; [ -n "$entered_server" ] && server="${entered_server%/}" ;; esac',
      'raw_base="$server/api/training-workers/setup"',
      'step() { printf "\\n[Salnova setup] %s\\n" "$1"; }',
      'as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; elif command -v sudo >/dev/null 2>&1; then sudo "$@"; else echo "sudo/root diperlukan untuk memasang package sistem"; exit 1; fi; }',
      "install_system_dependencies() {",
      "  if command -v apt-get >/dev/null 2>&1; then as_root apt-get update; as_root apt-get install -y python3 python3-pip python3-venv curl ca-certificates;",
      "  elif command -v dnf >/dev/null 2>&1; then as_root dnf install -y python3 python3-pip curl ca-certificates;",
      "  elif command -v yum >/dev/null 2>&1; then as_root yum install -y python3 python3-pip curl ca-certificates;",
      "  elif command -v pacman >/dev/null 2>&1; then as_root pacman -Sy --needed --noconfirm python python-pip curl ca-certificates;",
      "  elif command -v zypper >/dev/null 2>&1; then as_root zypper --non-interactive install python3 python3-pip curl ca-certificates;",
      "  elif command -v brew >/dev/null 2>&1; then brew install python curl;",
      '  else echo "Package manager tidak dikenali. Install Python 3.10+, python3-venv, dan curl lalu jalankan setup.sh lagi."; exit 1; fi',
      "}",
      'if ! command -v python3 >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then step "Memasang Python, venv, pip, curl, dan sertifikat"; install_system_dependencies; fi',
      'python3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" || { echo "Python 3.10+ diperlukan."; exit 1; }',
      'available_kb=$(df -Pk "${worker_root%/*}" 2>/dev/null | awk "NR==2 {print \\$4}" || echo 0)',
      'if [ "$available_kb" -gt 0 ] && [ "$available_kb" -lt 6291456 ]; then echo "Minimal 6 GB ruang kosong diperlukan. Set SALNOVA_WORKER_HOME ke drive lain."; exit 1; fi',
      'mkdir -p "$worker_root/worker"',
      'mkdir -p "$worker_root/.tmp"',
      'mkdir -p "$device_root"',
      'export TMPDIR="$worker_root/.tmp" PIP_NO_CACHE_DIR=1',
      'step "Mengunduh worker terbaru dari $server"',
      'curl -fsSL "$raw_base/visionflow_worker.py" -o "$worker_root/worker/visionflow_worker.py"',
      'curl -fsSL "$raw_base/requirements.txt" -o "$worker_root/worker/requirements.txt"',
      'if [ ! -x "$worker_root/.venv/bin/python" ]; then step "Membuat virtual environment"; if ! python3 -m venv "$worker_root/.venv"; then install_system_dependencies; python3 -m venv "$worker_root/.venv"; fi; fi',
      'venv_python="$worker_root/.venv/bin/python"',
      'step "Memperbarui pip dan package build"',
      '"$venv_python" -m pip install --upgrade pip setuptools wheel',
      'cuda_probe="import sys,torch,torchvision; sys.exit(1) if not torch.cuda.is_available() else torchvision.ops.nms(torch.tensor([[0.,0.,1.,1.]],device=\\\"cuda\\\"),torch.tensor([1.],device=\\\"cuda\\\"),0.5)"',
      'cpu_probe="import torch,torchvision; torchvision.ops.nms(torch.tensor([[0.,0.,1.,1.]]),torch.tensor([1.]),0.5)"',
      "has_nvidia=0; gpu_ready=0; command -v nvidia-smi >/dev/null 2>&1 && has_nvidia=1",
      'if [ "$has_nvidia" -eq 1 ] && "$venv_python" -c "$cuda_probe" 2>/dev/null; then gpu_ready=1; fi',
      'if [ "$has_nvidia" -eq 1 ] && [ "$gpu_ready" -eq 0 ]; then',
      '  cuda_version="$(nvidia-smi | sed -n "s/.*CUDA Version: \\([0-9][0-9]*\\.[0-9][0-9]*\\).*/\\1/p" | head -n 1)"',
      '  cuda_level="$(printf "%s" "${cuda_version:-12.6}" | awk -F. "{print (\\$1 * 10) + \\$2}")"',
      '  cuda_candidates=""; [ "$cuda_level" -ge 128 ] && cuda_candidates="$cuda_candidates cu128"; [ "$cuda_level" -ge 126 ] && cuda_candidates="$cuda_candidates cu126"; [ "$cuda_level" -ge 124 ] && cuda_candidates="$cuda_candidates cu124"; [ "$cuda_level" -ge 121 ] && cuda_candidates="$cuda_candidates cu121"; [ "$cuda_level" -ge 118 ] && cuda_candidates="$cuda_candidates cu118"',
      '  for cuda_build in $cuda_candidates; do step "Mencoba runtime NVIDIA $cuda_build yang cocok dengan driver"; if "$venv_python" -m pip install --upgrade --force-reinstall torch torchvision --index-url "https://download.pytorch.org/whl/$cuda_build" && "$venv_python" -c "$cuda_probe" 2>/dev/null; then gpu_ready=1; echo "Runtime GPU $cuda_build siap."; break; fi; done',
      "fi",
      'if [ "$gpu_ready" -eq 0 ]; then echo "CUDA tidak tersedia atau tidak kompatibel. Worker otomatis menggunakan CPU."; if ! "$venv_python" -c "$cpu_probe" 2>/dev/null; then step "Memasang runtime CPU yang kompatibel"; "$venv_python" -m pip install --upgrade --force-reinstall torch torchvision --index-url https://download.pytorch.org/whl/cpu; "$venv_python" -c "$cpu_probe"; fi; fi',
      'step "Memasang requests, Ultralytics, dan dependency training"',
      '"$venv_python" -m pip install --prefer-binary -r "$worker_root/worker/requirements.txt"',
      'step "Memverifikasi Python, Ultralytics, PyTorch, CPU, dan GPU"',
      '"$venv_python" -c "import requests,torch,ultralytics; print(\"Python packages: OK\"); print(\"PyTorch:\",torch.__version__); print(\"CUDA:\",torch.version.cuda); print(\"GPU available:\",torch.cuda.is_available()); print(\"Device:\",torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"CPU\")"',
      'echo "Setup lengkap. Worker menghubungkan ke $server ..."',
      'echo "Log dan checkpoint device disimpan di $device_root"',
      'exec "$worker_root/.venv/bin/python" "$worker_root/worker/visionflow_worker.py" --server "$server" --token "$token" --provider "$provider" --work-dir "$device_root" --keep-jobs',
      "",
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([script], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `salnova-${profile}-setup.sh`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify(
      "Setup Linux/macOS diunduh. Script akan memasang dependency yang belum tersedia.",
    );
  };
  const downloadNasSetup = (platform: SetupPlatform) => {
    const server = workerServer.replace(/\/$/, "");
    const windows = `# Salnova NAS training readiness check
$ErrorActionPreference = "Stop"
$server = '${server.replace(/'/g, "''")}'
Write-Host "Memeriksa backend NAS di $server ..." -ForegroundColor Cyan
$ready = Invoke-RestMethod -UseBasicParsing "$server/api/ready"
if ($ready.status -ne "ready") { throw "Backend NAS belum ready." }
Write-Host "NAS siap untuk training. Tidak ada package yang perlu dipasang di PC ini." -ForegroundColor Green
Write-Host "Buka halaman Train, pilih NAS, lalu Start training."
`;
    const linux = [
      "#!/usr/bin/env bash",
      "# Salnova NAS training readiness check",
      "set -euo pipefail",
      `server='${server.replace(/'/g, "'\"'\"'")}'`,
      'printf "Memeriksa backend NAS di %s ...\\n" "$server"',
      'response="$(curl -fsSL "$server/api/ready")"',
      'printf "%s" "$response" | grep -Eq \'"status"[[:space:]]*:[[:space:]]*"ready"\' || { echo "Backend NAS belum ready."; exit 1; }',
      'echo "NAS siap untuk training. Tidak ada package yang perlu dipasang di device ini."',
      'echo "Buka halaman Train, pilih NAS, lalu Start training."',
      "",
    ].join("\n");
    const content = platform === "windows" ? windows : linux;
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `salnova-nas-setup.${platform === "windows" ? "ps1" : "sh"}`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify("Script verifikasi NAS diunduh.");
  };
  const prepareWorkerSetup = async (
    profile: Exclude<TrainingRoute, "nas">,
    platform: SetupPlatform,
  ) => {
    selectTrainingRoute(profile);
    const worker = await createWorker(profile);
    if (!worker) return;
    if (platform === "windows") {
      downloadWorkerSetup(profile, worker.token, worker.id);
    } else {
      downloadUnixWorkerSetup(profile, worker.token, worker.id);
    }
  };
  const start = async () => {
    if (!versionId) {
      notify("Buat dan pilih dataset version terlebih dahulu");
      return;
    }
    if (executionTarget !== "server") {
      if (!workerId) {
        notify(
          "Pilih satu dedicated worker. Job tidak boleh pindah ke device lain.",
        );
        return;
      }
      const compatibleOnlineWorkers = workers.filter(
        (worker) =>
          !worker.revoked &&
          worker.profile === trainingRoute &&
          worker.status !== "offline" &&
          (!colabTarget || worker.capabilities.provider === "google-colab") &&
          (!gpuTarget || worker.capabilities.cuda),
      );
      const selectedWorker = workerId
        ? compatibleOnlineWorkers.find((worker) => worker.id === workerId)
        : undefined;
      if (!compatibleOnlineWorkers.length || (workerId && !selectedWorker)) {
        notify(
          gpuTarget
            ? "Worker GPU belum online atau CUDA tidak terdeteksi. Aktifkan GPU, jalankan ulang worker, lalu tunggu status online."
            : "Worker yang kompatibel belum online. Jalankan worker lalu coba lagi.",
        );
        return;
      }
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
        worker_profile: trainingRoute === "nas" ? undefined : trainingRoute,
        base_model_id: baseModelId || undefined,
        freeze_layers: freezeLayers,
        weight_decay: weightDecay,
        cos_lr: cosLr,
        close_mosaic: closeMosaic,
        amp,
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
    if (executionTarget !== "server" && !workerId)
      return notify("Pilih satu dedicated worker untuk seluruh sweep");
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
      notify("Sweep membutuhkan 1-8 kombinasi valid");
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
          worker_profile: trainingRoute === "nas" ? undefined : trainingRoute,
          base_model_id: baseModelId || undefined,
          freeze_layers: freezeLayers,
          weight_decay: weightDecay,
          cos_lr: cosLr,
          close_mosaic: closeMosaic,
          amp,
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
  const resumeTraining = async (modelId: string) => {
    try {
      const saved = await api.retryTraining(project.id, modelId);
      update(() => saved);
      notify("Training dilanjutkan dari checkpoint terakhir yang tersedia");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Resume training gagal");
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
  if (multiLabelExportOnly) {
    return (
      <div className="content train-page">
        <ProjectTabs active="train" go={go} />
        <div className="project-title">
          <div>
            <span className="eyebrow">MULTI-LABEL DATASET</span>
            <h1>Training belum tersedia untuk proyek multi-label</h1>
            <p>
              Anotasi, immutable dataset version, dan export tetap dapat
              digunakan secara penuh.
            </p>
          </div>
        </div>
        <section className="panel">
          <div className="config-guide-note">
            <b>Mengapa tidak ada tombol Start training?</b> Checkpoint
            klasifikasi YOLO memakai satu label eksklusif per gambar. Dataset
            proyek ini dapat memiliki beberapa label pada gambar yang sama,
            sehingga memaksakan training akan menghasilkan model yang salah.
            Gunakan export untuk trainer multi-label berbasis sigmoid/BCE, atau
            buat proyek Single-Label Classification jika setiap gambar hanya
            memiliki satu kelas.
          </div>
          <div className="train-actions">
            <button className="secondary" onClick={() => go("dataset")}>
              Buka dataset
            </button>
            <button className="primary" onClick={() => go("versions")}>
              Buat atau export version
            </button>
          </div>
        </section>
      </div>
    );
  }
  return (
    <div className="content train-page">
      <ProjectTabs active="train" go={go} />
      <div className="project-title">
        <div>
          <span className="eyebrow">LOCAL MODEL TRAINING</span>
          <h1>Train a {trainingLabel} model</h1>
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
              Initial weights / fine-tune
              <select
                value={baseModelId}
                onChange={(event) => {
                  setBaseModelId(event.target.value);
                  if (event.target.value) {
                    sessionStorage.setItem(
                      `visionflow-finetune-${project.id}`,
                      event.target.value,
                    );
                  } else {
                    sessionStorage.removeItem(
                      `visionflow-finetune-${project.id}`,
                    );
                  }
                }}
              >
                <option value="">Official pretrained checkpoint</option>
                {project.models.filter(modelCanDeploy).map((model) => (
                  <option value={model.id} key={model.id}>
                    {model.alias || model.name} · v{model.version} ·{" "}
                    {model.status}
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
              Freeze first layers
              <input
                type="number"
                min="0"
                max="100"
                value={freezeLayers}
                onChange={(event) => setFreezeLayers(+event.target.value)}
              />
            </label>
            <label>
              Weight decay
              <input
                type="number"
                min="0"
                max=".1"
                step=".0001"
                value={weightDecay}
                onChange={(event) => setWeightDecay(+event.target.value)}
              />
            </label>
            <label>
              Close mosaic epochs
              <input
                type="number"
                min="0"
                max="50"
                value={closeMosaic}
                onChange={(event) => setCloseMosaic(+event.target.value)}
              />
            </label>
            <label>
              Learning schedule
              <select
                value={cosLr ? "cosine" : "linear"}
                onChange={(event) => setCosLr(event.target.value === "cosine")}
              >
                <option value="linear">Linear/default</option>
                <option value="cosine">Cosine LR</option>
              </select>
            </label>
            <label>
              Precision
              <select
                value={amp ? "amp" : "fp32"}
                onChange={(event) => setAmp(event.target.value === "amp")}
              >
                <option value="amp">AMP / mixed precision</option>
                <option value="fp32">FP32</option>
              </select>
            </label>
            <div className="training-location-field">
              <span>Training location</span>
              <div
                className="training-location-grid"
                role="radiogroup"
                aria-label="Training location"
              >
                {(
                  [
                    [
                      "this-pc",
                      "PC RTX 50/60 Lab",
                      "GPU lab bersama, langsung pilih saat online",
                    ],
                    [
                      "own-device",
                      "Device sendiri",
                      "Hanya tampil untuk akun pemilik device",
                    ],
                    ["nas", "NAS", "Jalankan langsung di server"],
                    ["colab", "Google Colab", "Runtime cloud dengan opsi GPU"],
                  ] as const
                ).map(([value, title, description]) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={trainingRoute === value}
                    className={trainingRoute === value ? "active" : ""}
                    onClick={() => selectTrainingRoute(value)}
                    key={value}
                  >
                    <b>{title}</b>
                    <small>{description}</small>
                  </button>
                ))}
              </div>
            </div>
            <label>
              Compute preference
              <select
                value={selectedComputePreference}
                onChange={(event) =>
                  selectComputePreference(
                    event.target.value as "auto" | "gpu" | "cpu",
                  )
                }
              >
                <option value="auto">Automatic</option>
                <option value="gpu">CUDA GPU / GPU 0</option>
                <option value="cpu">CPU</option>
              </select>
            </label>
            {executionTarget !== "server" && (
              <label>
                External worker
                <select
                  value={workerId}
                  onChange={(event) => setWorkerId(event.target.value)}
                >
                  <option value="">Select one dedicated worker</option>
                  {selectableWorkers.map((worker) => (
                    <option value={worker.id} key={worker.id}>
                      {worker.name} · {worker.status}
                      {worker.capabilities.cuda ? " · CUDA" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <details className="training-config-guide" open>
            <summary>
              <span>
                <CircleHelp />
                <b>Panduan memilih lokasi training</b>
              </span>
              <small>Klik untuk sembunyikan atau tampilkan penjelasan</small>
            </summary>
            <p className="config-guide-intro">
              Dataset selalu tersimpan di server, di mana pun training berjalan.
              Pilihan ini hanya menentukan mesin mana yang memproses, lalu
              mengirimkan kembali <code>best.pt</code> ke server.
            </p>
            <div className="config-guide-grid">
              <article>
                <b>NAS / web server</b>
                <p>
                  Tanpa setup apa pun, langsung jalan. Tetapi server tidak punya
                  GPU, jadi hanya cocok untuk dataset kecil atau uji coba
                  singkat. Dataset besar bisa memakan waktu berjam-jam.
                </p>
              </article>
              <article>
                <b>PC RTX 50/60 Lab</b>
                <p>
                  PC lab bersama. Admin mengelola worker agar aktif otomatis
                  saat PC menyala; user cukup memilihnya saat status online.
                </p>
              </article>
              <article>
                <b>Device sendiri</b>
                <p>
                  Hubungkan laptop atau workstation Windows/Linux lain ke NAS.
                  Script memasang environment terisolasi dan memilih GPU NVIDIA
                  jika kompatibel, dengan fallback CPU. Device ini hanya tampil
                  dan dapat dipilih oleh akun yang mendaftarkannya.
                </p>
              </article>
              <article>
                <b>Google Colab</b>
                <p>
                  Runtime cloud tanpa perangkat keras sendiri. Unduh notebook
                  dari Setup Center lalu jalankan selnya di Colab. Syaratnya
                  Salnova harus diakses lewat alamat HTTPS publik, karena
                  runtime Colab tidak bisa menjangkau alamat LAN.
                </p>
              </article>
              <article>
                <b>Dedicated worker wajib dipilih</b>
                <p>
                  Setiap run dikunci ke satu token device. Worker lain tidak
                  dapat mengambil job, log, atau checkpoint run tersebut. Folder
                  save lokal juga dipisahkan berdasarkan ID worker.
                </p>
              </article>
              <article>
                <b>Kalau tidak ada worker yang menyala</b>
                <p>
                  Job tetap menunggu dedicated worker yang dipilih. Device lain
                  tidak mengambil alih secara otomatis, sehingga hasil dan log
                  tidak tercampur.
                </p>
              </article>
            </div>
          </details>
          <details className="training-config-guide" open>
            <summary>
              <span>
                <CircleHelp />
                <b>Panduan dataset & configuration</b>
              </span>
              <small>Klik untuk sembunyikan atau tampilkan penjelasan</small>
            </summary>
            <p className="config-guide-intro">
              Konfigurasi menentukan sumber data, kebutuhan memori, kecepatan,
              dan cara model memperbarui bobot selama training.
            </p>
            <div className="config-guide-grid">
              <article>
                <b>Dataset version</b>
                <p>
                  Snapshot dataset yang akan dilatih. Isi gambar, anotasi,
                  class, resize, dan pembagian train/valid tidak berubah selama
                  run.
                </p>
              </article>
              <article>
                <b>Initial weights / fine-tune</b>
                <p>
                  Pilih pretrained resmi untuk run baru, atau best.pt sebelumnya
                  agar pengetahuan model lama dilanjutkan ke dataset/config
                  baru.
                </p>
              </article>
              <article>
                <b>Epochs</b>
                <p>
                  Jumlah putaran model membaca seluruh data train. Lebih banyak
                  dapat meningkatkan hasil, tetapi lebih lama dan bisa overfit.
                </p>
              </article>
              <article>
                <b>Image size</b>
                <p>
                  Resolusi input training. Ukuran besar membantu objek kecil,
                  tetapi memakai VRAM/RAM dan waktu komputasi lebih banyak.
                </p>
              </article>
              <article>
                <b>Batch size</b>
                <p>
                  Jumlah gambar yang diproses sekali update. Batch besar lebih
                  stabil tetapi membutuhkan memori lebih besar; turunkan jika
                  OOM.
                </p>
              </article>
              <article>
                <b>Optimizer</b>
                <p>
                  Algoritma pembaruan bobot. Auto paling aman; SGD cenderung
                  stabil, sedangkan Adam/AdamW sering lebih cepat untuk
                  fine-tuning.
                </p>
              </article>
              <article>
                <b>Learning rate</b>
                <p>
                  Besar langkah setiap pembaruan bobot. Terlalu tinggi dapat
                  tidak stabil, terlalu rendah membuat proses belajar sangat
                  lambat.
                </p>
              </article>
              <article>
                <b>Patience</b>
                <p>
                  Training berhenti lebih awal jika metrik tidak membaik selama
                  sejumlah epoch ini. Nilai 0 menonaktifkan early stopping.
                </p>
              </article>
              <article>
                <b>Freeze first layers</b>
                <p>
                  Mengunci layer awal agar tidak diperbarui. Berguna untuk
                  dataset kecil atau fine-tuning cepat; nilai 0 melatih semua
                  layer.
                </p>
              </article>
              <article>
                <b>Weight decay</b>
                <p>
                  Regularisasi untuk menahan bobot agar tidak terlalu besar dan
                  mengurangi overfitting. Default 0.0005 cocok sebagai titik
                  awal.
                </p>
              </article>
              <article>
                <b>Close mosaic epochs</b>
                <p>
                  Menonaktifkan augmentasi mosaic pada beberapa epoch terakhir
                  agar model beradaptasi kembali dengan tampilan gambar normal.
                </p>
              </article>
              <article>
                <b>Learning schedule</b>
                <p>
                  Mengatur perubahan learning rate. Cosine menurunkannya secara
                  halus; linear/default mengikuti jadwal standar trainer.
                </p>
              </article>
              <article>
                <b>Precision</b>
                <p>
                  AMP lebih cepat dan hemat VRAM pada GPU. FP32 lebih presisi
                  dan kompatibel, tetapi biasanya lebih berat dan lambat.
                </p>
              </article>
              <article>
                <b>Training location & device</b>
                <p>
                  Menentukan mesin eksekusi dan CPU/GPU. Worker harus online dan
                  server harus dapat diakses oleh laptop atau Google Colab.
                </p>
              </article>
            </div>
            <div className="config-guide-note">
              <b>Resume berbeda dengan fine-tune.</b> Resume dari last.pt
              memakai kembali konfigurasi dan state optimizer run lama.
              Fine-tune membuat run baru dari best.pt sehingga konfigurasi di
              atas dapat diubah.
            </div>
          </details>
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
                <b>Training setup center</b>
                <small>
                  Setup Windows/Linux untuk seluruh lokasi training.
                </small>
              </div>
            </header>
            <p className="muted">
              Setup device sendiri membuat token sekali pakai dan mengunduh
              script yang sudah berisi alamat server ini.
            </p>
            <details className="worker-setup-guide" open>
              <summary>
                <CircleHelp />
                <span>
                  <b>Setelah script terunduh</b>
                  <small>
                    Jalankan setup di device target hingga status worker online.
                  </small>
                </span>
              </summary>
              <div className="worker-setup-platforms">
                <article>
                  <b>Windows (PowerShell)</b>
                  <ol>
                    <li>
                      Masuk ke folder Downloads:
                      <code>cd "$env:USERPROFILE\Downloads"</code>
                    </li>
                    <li>
                      Buka blokir file hasil download:
                      <code>Unblock-File '.\salnova-own-device-setup.ps1'</code>
                    </li>
                    <li>
                      Jalankan setup:
                      <code>
                        powershell.exe -NoProfile -ExecutionPolicy Bypass -File
                        '.\salnova-own-device-setup.ps1'
                      </code>
                    </li>
                  </ol>
                  <small>
                    Jika nama file memiliki akhiran, misalnya <code>(2)</code>,
                    gunakan nama tersebut pada kedua perintah file.
                  </small>
                </article>
                <article>
                  <b>Linux / macOS (Terminal)</b>
                  <ol>
                    <li>
                      Masuk ke folder Downloads:
                      <code>cd ~/Downloads</code>
                    </li>
                    <li>
                      Berikan izin eksekusi:
                      <code>chmod +x salnova-own-device-setup.sh</code>
                    </li>
                    <li>
                      Jalankan setup:
                      <code>./salnova-own-device-setup.sh</code>
                    </li>
                  </ol>
                </article>
              </div>
            </details>
            <div className="training-setup-grid">
              <article>
                <b>1. PC RTX 50/60 Lab</b>
                <ol>
                  <li>Resource GPU bersama yang dikelola admin lab.</li>
                  <li>
                    Pastikan status worker <b>online</b>.
                  </li>
                  <li>Pilih PC RTX 50/60 Lab lalu Start training.</li>
                </ol>
                <details className="lab-worker-admin">
                  <summary>Admin lab: daftarkan PC RTX sekali</summary>
                  <p>
                    Jalankan ini hanya dari PC RTX lab. Setup menyimpan token
                    secara lokal dan membuat worker aktif otomatis setiap PC
                    menyala. Semua user kemudian langsung memakai worker ini;
                    mereka tidak perlu mengunduh apa pun.
                  </p>
                  <span className="worker-downloads">
                    <button
                      onClick={() =>
                        void prepareWorkerSetup("this-pc", "windows")
                      }
                    >
                      <Download /> Daftarkan PC RTX (Windows)
                    </button>
                    <button
                      onClick={() =>
                        void prepareWorkerSetup("this-pc", "linux")
                      }
                    >
                      <Download /> Daftarkan PC RTX (Linux)
                    </button>
                  </span>
                </details>
              </article>
              <article>
                <b>2. Device sendiri</b>
                <ol>
                  <li>Buka Salnova melalui alamat LAN/HTTPS.</li>
                  <li>Unduh dan pindahkan script ke device target.</li>
                  <li>Jalankan hingga worker online.</li>
                  <li>Pilih nama worker lalu Start training.</li>
                </ol>
                <span className="worker-downloads">
                  <button
                    onClick={() =>
                      void prepareWorkerSetup("own-device", "windows")
                    }
                  >
                    <Download /> Windows .ps1
                  </button>
                  <button
                    onClick={() =>
                      void prepareWorkerSetup("own-device", "linux")
                    }
                  >
                    <Download /> Linux .sh
                  </button>
                </span>
              </article>
              <article>
                <b>3. NAS</b>
                <ol>
                  <li>Unduh script pengecekan opsional.</li>
                  <li>Jalankan untuk memastikan backend ready.</li>
                  <li>Pilih NAS dan Automatic/CPU.</li>
                  <li>Klik Start training; tidak perlu worker.</li>
                </ol>
                <span className="worker-downloads">
                  <button onClick={() => downloadNasSetup("windows")}>
                    <Download /> Windows .ps1
                  </button>
                  <button onClick={() => downloadNasSetup("linux")}>
                    <Download /> Linux .sh
                  </button>
                </span>
              </article>
              <article>
                <b>4. Google Colab</b>
                <ol>
                  <li>Aktifkan runtime GPU di Colab.</li>
                  <li>Unduh notebook (cara utama) atau script.</li>
                  <li>Run all dan biarkan runtime tersambung.</li>
                  <li>Pilih worker Colab lalu Start training.</li>
                </ol>
                <span className="worker-downloads">
                  <button onClick={() => void downloadColabNotebook()}>
                    <Download /> Notebook
                  </button>
                  <button
                    onClick={() => void prepareWorkerSetup("colab", "windows")}
                  >
                    <Download /> Windows .ps1
                  </button>
                  <button
                    onClick={() => void prepareWorkerSetup("colab", "linux")}
                  >
                    <Download /> Linux .sh
                  </button>
                </span>
              </article>
            </div>
            {workers
              .filter((worker) => !worker.revoked)
              .map((worker) => (
                <div className="worker-row" key={worker.id}>
                  <i className={worker.status} />
                  <span>
                    <b>{worker.name}</b>
                    <small>
                      {worker.status} ·{" "}
                      {worker.profile === "this-pc"
                        ? "PC RTX 50/60 Lab"
                        : worker.profile === "colab"
                          ? "Google Colab"
                          : "Device sendiri"}
                      {" · "}
                      {worker.capabilities.gpuName ||
                        worker.capabilities.cpu ||
                        "Not connected yet"}
                    </small>
                  </span>
                  {worker.manageable && (
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
                  )}
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
                      : model.status === "paused"
                        ? "Paused"
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
                      {model.trainingDetail?.stage ||
                        (model.status === "queued"
                          ? String(
                              model.config?.execution_target || "server",
                            ) !== "server"
                            ? "Waiting for external worker"
                            : "Waiting for server compute"
                          : String(
                                model.config?.execution_target || "server",
                              ) !== "server"
                            ? `Training on ${workers.find((worker) => worker.id === model.workerId)?.name || "laptop"}`
                            : "Training on server")}
                    </span>
                    <b>{model.progress}%</b>
                  </div>
                  {model.trainingDetail && (
                    <div className="training-detail">
                      {model.trainingDetail.archivePercent !== undefined && (
                        <span>
                          Archive {model.trainingDetail.archivePercent}%
                          {model.trainingDetail.totalFiles
                            ? ` · ${model.trainingDetail.processedFiles || 0}/${model.trainingDetail.totalFiles} files`
                            : ""}
                        </span>
                      )}
                      {model.trainingDetail.epoch !== undefined && (
                        <span>
                          Epoch {model.trainingDetail.epoch}/
                          {model.trainingDetail.totalEpochs || "?"}
                        </span>
                      )}
                      {model.trainingDetail.batch !== undefined && (
                        <span>
                          Batch {model.trainingDetail.batch}/
                          {model.trainingDetail.totalBatches || "?"}
                        </span>
                      )}
                      {model.trainingDetail.loss !== undefined &&
                        model.trainingDetail.loss !== null && (
                          <span>
                            Loss {model.trainingDetail.loss.toFixed(4)}
                          </span>
                        )}
                    </div>
                  )}
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
                    {model.status === "queued"
                      ? "Cancel queued job"
                      : "Pause training"}
                  </button>
                </>
              )}
              {(["paused", "failed", "cancelled"] as const).includes(
                model.status as "paused" | "failed" | "cancelled",
              ) && (
                <div className="train-actions">
                  {(model.resumable || modelCanDeploy(model)) && (
                    <button
                      className="resume-training"
                      onClick={() => resumeTraining(model.id)}
                    >
                      <Redo2 /> Resume training
                    </button>
                  )}
                  {modelCanDeploy(model) && (
                    <>
                      <a
                        className="download-best"
                        href={api.modelWeightsUrl(project.id, model.id)}
                        download
                      >
                        Download partial best.pt
                      </a>
                      <button
                        className="secondary"
                        onClick={() => go("deploy")}
                      >
                        <Rocket /> Use partial best.pt
                      </button>
                    </>
                  )}
                </div>
              )}
              {model.status === "ready" && (
                <>
                  <div className="metrics">
                    <span>
                      <b>{model.map}%</b>
                      <small>
                        {classificationMetrics ? "Top-1 accuracy" : "mAP50"}
                      </small>
                    </span>
                    {!classificationMetrics && (
                      <>
                        <span>
                          <b>{model.precision}%</b>
                          <small>Precision</small>
                        </span>
                        <span>
                          <b>{model.recall}%</b>
                          <small>Recall</small>
                        </span>
                      </>
                    )}
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
              {modelCanDeploy(model) && (
                <ModelEvaluationArtifacts
                  projectId={project.id}
                  model={model}
                  classification={classificationMetrics}
                />
              )}
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
        : page === "train" && project.models.some(modelCanDeploy)
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
        engine: localStorage.getItem("vf-advance-smart-engine") || "grabcut",
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

function ModelEvaluationArtifacts({
  projectId,
  model,
  classification = false,
}: {
  projectId: string;
  model: Model;
  classification?: boolean;
}) {
  const [artifacts, setArtifacts] = useState<EvaluationArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"summary" | "curves" | "batches">("summary");
  useEffect(() => {
    let cancelled = false;
    api
      .modelEvaluationArtifacts(projectId, model.id)
      .then((items) => {
        if (!cancelled) setArtifacts(items);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, model.id, model.status]);
  const f1 =
    model.precision + model.recall > 0
      ? (2 * model.precision * model.recall) / (model.precision + model.recall)
      : 0;
  const curves = artifacts.filter((artifact) =>
    /(curve|results|confusion_matrix)/i.test(artifact.name),
  );
  const batches = artifacts.filter((artifact) =>
    /^(train_batch|val_batch)|labels/i.test(artifact.name),
  );
  const visibleArtifacts = tab === "curves" ? curves : batches;
  const history = (model.metricsHistory || []).slice(-8);
  const historyMetric = (entry: Record<string, number>, names: string[]) => {
    const found = Object.entries(entry).find(([key]) =>
      names.some((name) => key.toLowerCase().includes(name)),
    );
    return found ? Number(found[1]) : null;
  };
  return (
    <details className="evaluation-artifacts">
      <summary>
        <span>
          <BarChart3 />
          <b>Lihat hasil training</b>
          <small>
            {loading
              ? "Memeriksa grafik dan gambar..."
              : `${artifacts.length} grafik dan gambar tersedia`}
          </small>
        </span>
        <ChevronDown />
      </summary>
      <div className="training-results-body">
        <nav
          className="training-results-tabs"
          aria-label="Bagian hasil training"
        >
          <button
            className={tab === "summary" ? "active" : ""}
            onClick={() => setTab("summary")}
          >
            Ringkasan
          </button>
          <button
            className={tab === "curves" ? "active" : ""}
            onClick={() => setTab("curves")}
          >
            Grafik & kurva <span>{curves.length}</span>
          </button>
          <button
            className={tab === "batches" ? "active" : ""}
            onClick={() => setTab("batches")}
          >
            Train & validation <span>{batches.length}</span>
          </button>
        </nav>
        {tab === "summary" && (
          <div className="training-results-summary">
            <div className="training-result-metrics">
              <span>
                <small>{classification ? "Top-1 accuracy" : "mAP50"}</small>
                <b>{model.map.toFixed(1)}%</b>
              </span>
              {!classification && (
                <>
                  <span>
                    <small>F1 score</small>
                    <b>{f1.toFixed(1)}%</b>
                  </span>
                  <span>
                    <small>Precision</small>
                    <b>{model.precision.toFixed(1)}%</b>
                  </span>
                  <span>
                    <small>Recall</small>
                    <b>{model.recall.toFixed(1)}%</b>
                  </span>
                </>
              )}
            </div>
            <MetricSparkline model={model} />
            {!!history.length && (
              <div className="epoch-results">
                <header>
                  <b>Epoch terakhir</b>
                  <small>{history.length} baris terbaru</small>
                </header>
                <div className="epoch-results-table">
                  <span>Epoch</span>
                  <span>Box loss</span>
                  <span>Class loss</span>
                  <span>{classification ? "Accuracy" : "mAP50"}</span>
                  {history.map((entry, index) => {
                    const boxLoss = historyMetric(entry, [
                      "train/box_loss",
                      "box_loss",
                    ]);
                    const classLoss = historyMetric(entry, [
                      "train/cls_loss",
                      "train/loss",
                      "cls_loss",
                    ]);
                    const score = historyMetric(
                      entry,
                      classification
                        ? ["accuracy_top1"]
                        : ["map50(b)", "map50(m)", "map50"],
                    );
                    return (
                      <div className="epoch-results-row" key={index}>
                        <b>
                          {model.metricsHistory!.length -
                            history.length +
                            index +
                            1}
                        </b>
                        <span>
                          {boxLoss === null ? "-" : boxLoss.toFixed(4)}
                        </span>
                        <span>
                          {classLoss === null ? "-" : classLoss.toFixed(4)}
                        </span>
                        <span>
                          {score === null
                            ? "-"
                            : `${(score * 100).toFixed(1)}%`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        {tab !== "summary" && !!visibleArtifacts.length && (
          <div className="evaluation-gallery training-results-gallery">
            {visibleArtifacts.map((artifact) => {
              const url = api.modelEvaluationArtifactUrl(
                projectId,
                model.id,
                artifact.name,
              );
              return (
                <article key={artifact.name}>
                  {artifact.preview ? (
                    <a href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt={artifact.label} loading="lazy" />
                    </a>
                  ) : (
                    <div className="evaluation-file-icon">
                      <BarChart3 />
                    </div>
                  )}
                  <footer>
                    <span>
                      <b>{artifact.label}</b>
                      <small>
                        {Math.max(1, Math.round(artifact.size / 1024))} KB
                      </small>
                    </span>
                    <a
                      href={url}
                      download={artifact.name}
                      title={`Download ${artifact.label}`}
                    >
                      <Download />
                    </a>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
        {tab !== "summary" && !loading && !visibleArtifacts.length && (
          <div className="training-results-empty">
            <BarChart3 />
            <b>Belum ada artefak pada bagian ini</b>
            <span>
              Artefak akan muncul setelah trainer selesai mengunggah hasil
              evaluasi.
            </span>
          </div>
        )}
      </div>
    </details>
  );
}

function EvaluationWorkbench({
  project,
  model,
  notify,
  go,
}: {
  project: Project;
  model: Model;
  notify: (message: string) => void;
  go: (page: Page) => void;
}) {
  const [evaluations, setEvaluations] = useState<ModelEvaluation[]>([]);
  const [split, setSplit] = useState<"train" | "valid" | "test" | "all">(
    "test",
  );
  const [confidence, setConfidence] = useState(0.25);
  const [running, setRunning] = useState(false);
  const active = evaluations.some((item) =>
    ["queued", "running"].includes(item.status),
  );
  const load = () =>
    api
      .modelEvaluations(project.id, model.id)
      .then(setEvaluations)
      .catch(() => {});
  useEffect(() => {
    load();
    if (!active) return;
    const timer = window.setInterval(load, 2000);
    return () => window.clearInterval(timer);
  }, [project.id, model.id, active]);
  const latest = evaluations[0];
  const run = async () => {
    setRunning(true);
    try {
      const created = await api.createModelEvaluation(project.id, model.id, {
        split,
        confidence,
        iou_threshold: 0.5,
        limit: 250,
      });
      setEvaluations((current) => [created, ...current]);
      notify("Error analysis queued. You can leave this page.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Evaluation failed to start",
      );
    } finally {
      setRunning(false);
    }
  };
  return (
    <details className="evaluation-workbench">
      <summary>
        <FlaskConical /> Evaluation workbench
      </summary>
      <div className="evaluation-controls">
        <label>
          Dataset split
          <select
            value={split}
            onChange={(event) => setSplit(event.target.value as typeof split)}
          >
            <option value="test">Test</option>
            <option value="valid">Validation</option>
            <option value="train">Train</option>
            <option value="all">All assets</option>
          </select>
        </label>
        <label>
          Confidence
          <input
            type="number"
            min="0.01"
            max="0.95"
            step="0.05"
            value={confidence}
            onChange={(event) => setConfidence(Number(event.target.value))}
          />
        </label>
        <button className="primary" disabled={running || active} onClick={run}>
          <Play /> Run error analysis
        </button>
      </div>
      {latest && (
        <div className="evaluation-result">
          <header>
            <span>
              <b>{latest.split} split</b>
              <small>
                {latest.summary.assets || 0} assets · IoU {latest.iouThreshold}
              </small>
            </span>
            <em className={`status ${latest.status}`}>{latest.status}</em>
          </header>
          {["queued", "running"].includes(latest.status) && (
            <progress value={latest.progress} max="100" />
          )}
          {latest.status === "failed" && (
            <p className="error">{latest.error}</p>
          )}
          {latest.status === "completed" && (
            <>
              <div className="evaluation-score-grid">
                <span>
                  <b>{latest.summary.precision}%</b>
                  <small>Precision</small>
                </span>
                <span>
                  <b>{latest.summary.recall}%</b>
                  <small>Recall</small>
                </span>
                <span>
                  <b>{latest.summary.f1}%</b>
                  <small>F1</small>
                </span>
                <span className={latest.summary.qualityGate ? "pass" : "fail"}>
                  <b>{latest.summary.qualityGate ? "PASS" : "REVIEW"}</b>
                  <small>Production gate</small>
                </span>
              </div>
              <p>
                Recommended confidence:{" "}
                <b>
                  {Math.round((latest.summary.recommendedThreshold || 0) * 100)}
                  %
                </b>{" "}
                · {latest.summary.fp || 0} false positives ·{" "}
                {latest.summary.fn || 0} false negatives
              </p>
              {!!latest.errors.length && (
                <div className="evaluation-errors">
                  {latest.errors.slice(0, 12).map((item, index) => (
                    <button
                      key={`${item.assetId}-${item.type}-${index}`}
                      onClick={() => {
                        sessionStorage.setItem(
                          `visionflow-focus-asset-${project.id}`,
                          item.assetId,
                        );
                        go("dataset");
                      }}
                    >
                      <span className={item.type}>
                        {item.type === "false-positive" ? "FP" : "FN"}
                      </span>
                      <b>{item.name}</b>
                      <small>
                        {item.class}
                        {item.confidence
                          ? ` · ${Math.round(item.confidence * 100)}%`
                          : ""}
                      </small>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </details>
  );
}

const cleanTerminalError = (message: string) =>
  message
    .replace(/(?:\u001b|\u241b)\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\s+See https?:\/\/\S+\s*$/i, "")
    .trim();

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
  const classificationMetrics = project.type === "Single-Label Classification";
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
                  {classificationMetrics ? "Top-1 accuracy" : "mAP50"}{" "}
                  <strong>{model.map}%</strong>
                </span>
                {!classificationMetrics && (
                  <>
                    <span>
                      Precision <strong>{model.precision}%</strong>
                    </span>
                    <span>
                      Recall <strong>{model.recall}%</strong>
                    </span>
                  </>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="registry-grid">
        {[...project.models].reverse().map((model) => (
          <article className="registry-card" key={model.id}>
            <div className="registry-head">
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
            {modelCanDeploy(model) && (
              <div className="registry-model-controls">
                <label title="Pilih maksimal dua model untuk dibandingkan">
                  <input
                    type="checkbox"
                    checked={selectedModels.includes(model.id)}
                    onChange={() => toggleModel(model.id)}
                  />
                  <span>Compare</span>
                </label>
                {model.stage === "production" ? (
                  <span className="active-deployment">
                    <Check /> Active deployment
                  </span>
                ) : (
                  <button
                    onClick={() =>
                      updateLifecycle(model.id, "production", model.alias)
                    }
                  >
                    <Rocket /> Use for deploy
                  </button>
                )}
              </div>
            )}
            {modelCanDeploy(model) && (
              <div className="registry-metrics">
                <span>
                  <b>{model.map}%</b>
                  <small>
                    {classificationMetrics ? "Top-1 accuracy" : "mAP50"}
                  </small>
                </span>
                {!classificationMetrics && (
                  <>
                    <span>
                      <b>{model.precision}%</b>
                      <small>Precision</small>
                    </span>
                    <span>
                      <b>{model.recall}%</b>
                      <small>Recall</small>
                    </span>
                  </>
                )}
              </div>
            )}
            {model.status === "training" && (
              <div className="registry-training-progress">
                <span>
                  Training progress <b>{model.progress}%</b>
                </span>
                <progress max="100" value={model.progress} />
              </div>
            )}
            {modelCanDeploy(model) && (
              <>
                <ModelEvaluationArtifacts
                  projectId={project.id}
                  model={model}
                  classification={classificationMetrics}
                />
                <EvaluationWorkbench
                  project={project}
                  model={model}
                  notify={notify}
                  go={go}
                />
              </>
            )}
            <div className="registry-config">
              <span>
                Epochs <b>{String(model.config?.epochs || "N/A")}</b>
              </span>
              <span>
                Image <b>{String(model.config?.image_size || "N/A")}</b>
              </span>
              <span>
                Batch <b>{String(model.config?.batch_size || "N/A")}</b>
              </span>
              <span>
                Optimizer <b>{String(model.config?.optimizer || "N/A")}</b>
              </span>
            </div>
            <div className="model-lifecycle">
              <label>
                Stage
                <select
                  value={model.stage || "development"}
                  disabled={!modelCanDeploy(model)}
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
                disabled={!modelCanDeploy(model)}
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
            {modelCanDeploy(model) && (
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
              {(model.status === "paused" ||
                model.status === "failed" ||
                model.status === "cancelled") && (
                <button onClick={() => retry(model.id)}>
                  <Redo2 />
                  {model.resumable
                    ? "Resume from last.pt"
                    : modelCanDeploy(model)
                      ? "Recover from best.pt"
                      : "Retry"}
                </button>
              )}
              {modelCanDeploy(model) && (
                <button
                  onClick={() => {
                    sessionStorage.setItem(
                      `visionflow-finetune-${project.id}`,
                      model.id,
                    );
                    go("train");
                    notify(`${model.name} dipilih sebagai base fine-tuning`);
                  }}
                >
                  <BrainCircuit /> Fine-tune
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
            {model.error && (
              <div className="registry-error" role="alert">
                <b>Training gagal</b>
                <p>{cleanTerminalError(model.error)}</p>
                <a
                  href="https://docs.ultralytics.com/datasets/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Buka panduan format dataset
                </a>
              </div>
            )}
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
  const [deletingAsset, setDeletingAsset] = useState<string | null>(null);
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
  useEffect(() => {
    const focusId = sessionStorage.getItem(
      `visionflow-focus-asset-${project.id}`,
    );
    if (!focusId) return;
    const target = project.assets.find((asset) => asset.id === focusId);
    if (target) {
      setQuery(target.name);
      setPreviewAsset(target);
    }
    sessionStorage.removeItem(`visionflow-focus-asset-${project.id}`);
  }, [project.id]);
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
    setDeletingAsset(id);
    try {
      await api.deleteAsset(project.id, id);
      update((current) => ({
        ...current,
        assets: current.assets.filter((asset) => asset.id !== id),
        assetCount: Math.max(
          0,
          (current.assetCount ?? current.assets.length) - 1,
        ),
      }));
      notify("Gambar dan anotasi berhasil dihapus");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Gagal menghapus gambar");
    } finally {
      setDeletingAsset(null);
    }
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
              <button
                disabled={deletingAsset === asset.id}
                onClick={() => remove(asset.id)}
              >
                {deletingAsset === asset.id ? (
                  <LoaderCircle className="delete-spinner" />
                ) : (
                  <Trash2 />
                )}
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
          restored={(saved) => {
            update(() => saved);
            setPreviewAsset(
              saved.assets.find((item) => item.id === previewAsset.id) || null,
            );
            notify("Annotation revision restored and sent back to review");
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
  restored,
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
  restored: (project: Project) => void;
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
      boxes: Box[];
    }>;
    comments: Array<{
      id: string;
      actor: string;
      body: string;
      createdAt: string;
    }>;
  }>({ revisions: [], comments: [] });
  const [revisionPreview, setRevisionPreview] = useState<Box[] | null>(null);
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
          <div className="asset-preview-canvas">
            <img src={asset.src} />
            {(revisionPreview || asset.boxes).map((box, index) => (
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
            {revisionPreview && (
              <button
                className="revision-preview-label"
                onClick={() => setRevisionPreview(null)}
              >
                Previewing saved revision · show current
              </button>
            )}
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
                  <div className="revision-row" key={item.id}>
                    <span>
                      <b>{item.actor}</b>
                      <small>
                        {item.annotations} annotations ·{" "}
                        {item.createdAt.slice(0, 16).replace("T", " ")}
                      </small>
                    </span>
                    <button onClick={() => setRevisionPreview(item.boxes)}>
                      Preview
                    </button>
                    <button
                      onClick={async () => {
                        if (
                          !confirm(
                            `Restore revision from ${item.createdAt.slice(0, 16).replace("T", " ")}?`,
                          )
                        )
                          return;
                        restored(
                          await api.restoreAnnotationRevision(
                            project.id,
                            asset.id,
                            item.id,
                          ),
                        );
                        setRevisionPreview(null);
                        loadCollaboration();
                      }}
                    >
                      Restore
                    </button>
                  </div>
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
        role: "owner",
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
    localStorage.setItem("vf-active-role", "owner");
    localStorage.setItem("vf-active-name", member.name);
    setActiveMemberId(member.id);
    notify(`Active account: ${member.name} (full access)`);
  };
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
              Semua anggota memiliki fungsi workspace yang sama. Label akun
              hanya digunakan sebagai identitas kolaborator.
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
              <span className="member-access">
                <Check /> Full access
              </span>
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
      <div className="workspace-governance single">
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
