import type { AugmentationRecipe, Box, Project } from "./types";

export type WorkflowNode = {
  id: string;
  type: string;
  x: number;
  y: number;
  title: string;
  subtitle: string;
  projectId?: string;
  config?: Record<string, string | number | boolean>;
};
export type WorkflowData = {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: Array<{ from: string; to: string; condition?: "true" | "false" }>;
  updatedAt?: string;
};
export type WorkspaceMember = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "annotator" | "viewer";
  createdAt: string;
  hasPassword?: boolean;
  emailVerified?: boolean;
  onboardingCompleted?: boolean;
  avatarUrl?: string | null;
};
export type AuthStatus = {
  required: boolean;
  setupRequired: boolean;
  member?: WorkspaceMember | null;
};
export type ProjectCollaboration = {
  invites: Array<{ id: string; code: string; created_at: string; expires_at: string }>;
  requests: Array<{
    id: string;
    status: string;
    created_at: string;
    member_id: string;
    name: string;
    email: string;
  }>;
  collaborators: Array<{
    id: string;
    name: string;
    email: string;
    added_at: string;
  }>;
};
export type ActivityEntry = {
  id: string;
  projectId?: string;
  action: string;
  detail: string;
  actor: string;
  createdAt: string;
};
export type WorkflowRun = {
  id: string;
  status: string;
  predictions: number;
  counts: Record<string, number>;
  error?: string;
  createdAt: string;
  durationMs: number;
};
export type DatasetHealth = {
  score: number;
  assets: number;
  issueAssets: number;
  issues: Array<{ assetId: string; name: string; issues: string[] }>;
  duplicateGroups: string[][];
  classCounts: Record<string, number>;
  splitCounts: Record<string, number>;
  imbalanceRatio: number;
  averageBlurScore: number;
};
export type DatasetHealthProgress = {
  scanning: boolean;
  progress: number;
  processed: number;
  total: number;
  stage: string;
  etaSeconds: number;
};
export type EvaluationArtifact = {
  name: string;
  label: string;
  size: number;
  preview: boolean;
};
export type AnnotationJob = {
  id: string;
  name: string;
  assigneeId?: string;
  assigneeName?: string;
  assetIds: string[];
  status: string;
  completed: number;
  approved: number;
  total: number;
  createdAt: string;
  updatedAt: string;
};
export type ActiveLearningItem = {
  id: string;
  assetId: string;
  name: string;
  modelId?: string;
  score: number;
  reason: string;
  status: string;
  createdAt: string;
};
export type TrainingWorker = {
  id: string;
  name: string;
  prefix: string;
  capabilities: {
    cuda?: boolean;
    gpuName?: string;
    gpuCount?: number;
    torchVersion?: string;
    cudaVersion?: string;
    cpu?: string;
    platform?: string;
    provider?: "local" | "google-colab" | "cloud-vm";
  };
  status: "online" | "busy" | "offline" | "revoked";
  currentModelId?: string;
  lastSeen?: string;
  createdAt: string;
  revoked: boolean;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  // Keep compatibility with older local backends without trusting a stale
  // browser role. Every Salnova account has the same capabilities.
  headers.set("X-Workspace-Role", "owner");
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

function uploadRequest<T>(
  path: string,
  body: FormData,
  onProgress?: (percent: number) => void,
  onProcessing?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.setRequestHeader("X-Workspace-Role", "owner");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.upload.onload = () => {
      onProgress?.(100);
      onProcessing?.();
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (xhr.status === 204) resolve(undefined as T);
        else {
          try {
            resolve(JSON.parse(xhr.responseText) as T);
          } catch {
            reject(new Error("Server returned an invalid response"));
          }
        }
        return;
      }
      try {
        const response = JSON.parse(xhr.responseText) as { detail?: string };
        reject(new Error(response.detail || `Upload failed (${xhr.status})`));
      } catch {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload connection failed"));
    xhr.onabort = () => reject(new Error("Upload dibatalkan"));
    xhr.send(body);
  });
}

export const api = {
  authStatus: () => request<AuthStatus>("/api/auth/status"),
  bootstrapAuth: (data: { name: string; email: string; password: string }) =>
    request<{ status: string }>("/api/auth/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  login: (email: string, password: string) =>
    request<{ token: string; member: WorkspaceMember }>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  register: (name: string, email: string, password: string) =>
    request<{ token: string; member: WorkspaceMember }>("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    }),
  requestOtp: (email: string, name?: string) =>
    request<{ status: string; expiresIn: number; devCode?: string }>(
      "/api/auth/otp/request",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: name || undefined }),
      },
    ),
  verifyOtp: (email: string, code: string, name?: string) =>
    request<{ token: string; member: WorkspaceMember }>(
      "/api/auth/otp/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, name: name || undefined }),
      },
    ),
  completeOnboarding: () =>
    request<WorkspaceMember>("/api/auth/onboarding/complete", {
      method: "POST",
    }),
  uploadProfilePhoto: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<WorkspaceMember>("/api/auth/profile/avatar", {
      method: "POST",
      body,
    });
  },
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  assistantChat: (
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    context: string,
  ) =>
    request<{ reply: string; model: string }>("/api/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, context }),
    }),
  health: () => request<{ status: string; mlReady: boolean }>("/api/health"),
  projects: () => request<Project[]>("/api/projects"),
  projectCollaboration: (projectId: string) =>
    request<ProjectCollaboration>(`/api/projects/${projectId}/collaboration`),
  createProjectInvite: (projectId: string) =>
    request<{ id: string; code: string; created_at: string; expires_at: string }>(
      `/api/projects/${projectId}/invites`,
      { method: "POST" },
    ),
  requestProjectJoin: (code: string) =>
    request<{ status: string; projectId: string }>("/api/collaboration/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.toUpperCase() }),
    }),
  reviewProjectJoin: (
    projectId: string,
    requestId: string,
    action: "accept" | "reject",
  ) =>
    request<{ status: string }>(
      `/api/projects/${projectId}/collaboration/requests/${requestId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
    ),
  project: (id: string) => request<Project>(`/api/projects/${id}`),
  updateProject: (id: string, data: { name: string; description: string }) =>
    request<Project>(`/api/projects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  archiveProject: (id: string, archived: boolean) =>
    request<Project>(`/api/projects/${id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    }),
  duplicateProject: (id: string) =>
    request<Project>(`/api/projects/${id}/duplicate`, { method: "POST" }),
  activity: (projectId?: string) =>
    request<ActivityEntry[]>(
      `/api/activity${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ""}`,
    ),
  datasetHealth: (projectId: string) =>
    request<DatasetHealth>(`/api/projects/${projectId}/health`),
  datasetHealthProgress: (projectId: string) =>
    request<DatasetHealthProgress>(`/api/projects/${projectId}/health/progress`),
  annotationJobs: (projectId: string) =>
    request<AnnotationJob[]>(`/api/projects/${projectId}/annotation-jobs`),
  createAnnotationJob: (
    projectId: string,
    data: { name: string; assignee_id?: string; asset_ids: string[] },
  ) =>
    request<{ id: string; status: string }>(
      `/api/projects/${projectId}/annotation-jobs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    ),
  updateAnnotationJob: (projectId: string, jobId: string, status: string) =>
    request<{ id: string; status: string }>(
      `/api/projects/${projectId}/annotation-jobs/${jobId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    ),
  activeLearning: (projectId: string) =>
    request<{
      scanning: boolean;
      progress: Partial<DatasetHealthProgress>;
      items: ActiveLearningItem[];
    }>(
      `/api/projects/${projectId}/active-learning`,
    ),
  startActiveLearning: (
    projectId: string,
    data: { model_id?: string; limit?: number; confidence?: number },
  ) =>
    request<{ status: string; modelId: string }>(
      `/api/projects/${projectId}/active-learning`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      },
    ),
  updateActiveLearning: (projectId: string, queueId: string, status: string) =>
    request<{ id: string; status: string }>(
      `/api/projects/${projectId}/active-learning/${queueId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    ),
  deleteProject: (id: string) =>
    request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  createProject: (data: {
    name: string;
    type: string;
    description: string;
    classes: string[];
    colors?: Record<string, string>;
  }) =>
    request<Project>("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  upload: (id: string, files: FileList) => {
    const body = new FormData();
    Array.from(files).forEach((file) => body.append("files", file));
    return request<Project>(`/api/projects/${id}/assets`, {
      method: "POST",
      body,
    });
  },
  uploadWithProgress: (
    id: string,
    files: FileList,
    onProgress: (percent: number) => void,
    onProcessing?: () => void,
  ) => {
    const body = new FormData();
    Array.from(files).forEach((file) => body.append("files", file));
    return uploadRequest<Project>(
      `/api/projects/${id}/assets`,
      body,
      onProgress,
      onProcessing,
    );
  },
  deleteAsset: (projectId: string, assetId: string) =>
    request<void>(`/api/projects/${projectId}/assets/${assetId}`, {
      method: "DELETE",
    }),
  importAnnotatedDataset: (
    projectId: string,
    file: File,
    onProgress?: (percent: number) => void,
    onProcessing?: () => void,
  ) => {
    const body = new FormData();
    body.append("file", file);
    return uploadRequest<Project>(
      `/api/projects/${projectId}/import/annotated`,
      body,
      onProgress,
      onProcessing,
    );
  },
  setAssetSplit: (
    projectId: string,
    assetId: string,
    split: "train" | "valid" | "test",
  ) =>
    request<Project>(`/api/projects/${projectId}/assets/${assetId}/split`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ split }),
    }),
  setAssetReview: (
    projectId: string,
    assetId: string,
    status: "pending" | "approved" | "needs-fix",
  ) =>
    request<Project>(`/api/projects/${projectId}/assets/${assetId}/review`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }),
  bulkAssets: (
    projectId: string,
    ids: string[],
    action: "split" | "review" | "delete",
    value?: string,
  ) =>
    request<Project>(`/api/projects/${projectId}/assets/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, action, value }),
    }),
  updateAssetMetadata: (
    projectId: string,
    assetId: string,
    data: { name: string; tags: string[]; metadata: Record<string, string> },
  ) =>
    request<Project>(`/api/projects/${projectId}/assets/${assetId}/metadata`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  interpolate: (projectId: string, startAssetId: string, endAssetId: string) =>
    request<Project>(`/api/projects/${projectId}/assets/interpolate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_asset_id: startAssetId,
        end_asset_id: endAssetId,
      }),
    }),
  autoLabel: (
    projectId: string,
    data: {
      confidence: number;
      overwrite: boolean;
      model_id?: string;
      limit?: number;
    },
  ) =>
    request<Project>(`/api/projects/${projectId}/auto-label`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  smartMask: (
    projectId: string,
    assetId: string,
    data: { x: number; y: number; label: string; size?: number },
  ) =>
    request<Box>(`/api/projects/${projectId}/assets/${assetId}/smart-mask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  exportUrl: (
    projectId: string,
    versionId: string,
    format: "yolo" | "coco" = "yolo",
  ) =>
    `/api/projects/${projectId}/versions/${versionId}/export?format=${format}`,
  annotatedExportUrl: (projectId: string, format: string) =>
    `/api/projects/${projectId}/export?format=${format}`,
  versionDiff: (projectId: string, versionId: string) =>
    request<{
      versionId: string;
      added: string[];
      removed: string[];
      changed: string[];
      unchanged: number;
    }>(`/api/projects/${projectId}/versions/${versionId}/diff`),
  rollbackVersion: (projectId: string, versionId: string) =>
    request<Project>(
      `/api/projects/${projectId}/versions/${versionId}/rollback`,
      { method: "POST" },
    ),
  assetCollaboration: (projectId: string, assetId: string) =>
    request<{
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
    }>(`/api/projects/${projectId}/assets/${assetId}/collaboration`),
  addAssetComment: (projectId: string, assetId: string, body: string) =>
    request<{ id: string; actor: string; body: string; createdAt: string }>(
      `/api/projects/${projectId}/assets/${assetId}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      },
    ),
  deleteVersion: (projectId: string, versionId: string) =>
    request<void>(`/api/projects/${projectId}/versions/${versionId}`, {
      method: "DELETE",
    }),
  updateVersion: (
    projectId: string,
    versionId: string,
    data: { name: string; notes: string; tags: string[] },
  ) =>
    request<Project>(`/api/projects/${projectId}/versions/${versionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  annotate: (projectId: string, assetId: string, boxes: Box[]) =>
    request<Project>(
      `/api/projects/${projectId}/assets/${assetId}/annotations`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boxes }),
      },
    ),
  classes: (projectId: string, classes: string[]) =>
    request<Project>(`/api/projects/${projectId}/classes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classes }),
    }),
  addClass: (projectId: string, name: string, color: string) =>
    request<Project>(`/api/projects/${projectId}/classes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color }),
    }),
  renameClass: (
    projectId: string,
    oldName: string,
    name: string,
    color: string,
  ) =>
    request<Project>(
      `/api/projects/${projectId}/classes/${encodeURIComponent(oldName)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color }),
      },
    ),
  deleteClass: (projectId: string, name: string) =>
    request<Project>(
      `/api/projects/${projectId}/classes/${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ),
  version: (
    id: string,
    data: {
      resize: number;
      augment: boolean;
      splits: [number, number, number];
      augmentations?: AugmentationRecipe;
      augmentation_copies?: number;
    },
  ) =>
    request<Project>(`/api/projects/${id}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  versionProgress: (id: string) =>
    request<{
      status: "idle" | "running" | "completed" | "failed";
      progress: number;
      stage: string;
      processed: number;
      total: number;
      error?: string | null;
      updatedAt: string;
    }>(`/api/projects/${id}/versions/progress`),
  train: (
    id: string,
    data: {
      architecture: string;
      epochs: number;
      image_size: number;
      version_id?: string;
      batch_size?: number;
      optimizer?: string;
      learning_rate?: number;
      patience?: number;
      device?: string;
      execution_target?: "server" | "remote-auto" | "remote-gpu" | "remote-cpu" | "colab-auto" | "colab-gpu" | "colab-cpu";
      worker_id?: string;
      base_model_id?: string;
      freeze_layers?: number;
      weight_decay?: number;
      cos_lr?: boolean;
      close_mosaic?: number;
      amp?: boolean;
    },
  ) =>
    request<Project>(`/api/projects/${id}/train`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  trainSweep: (
    id: string,
    data: {
      base: {
        architecture: string;
        epochs: number;
        image_size: number;
        version_id?: string;
        batch_size?: number;
        optimizer?: string;
        learning_rate?: number;
        patience?: number;
        device?: string;
        execution_target?:
          | "server"
          | "remote-auto"
          | "remote-gpu"
          | "remote-cpu"
          | "colab-auto"
          | "colab-gpu"
          | "colab-cpu";
        worker_id?: string;
        base_model_id?: string;
        freeze_layers?: number;
        weight_decay?: number;
        cos_lr?: boolean;
        close_mosaic?: number;
        amp?: boolean;
      };
      learning_rates: number[];
      optimizers: string[];
    },
  ) =>
    request<Project>(`/api/projects/${id}/train/sweep`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  cancelTraining: (projectId: string, modelId: string) =>
    request<{ status: string; modelId: string }>(
      `/api/projects/${projectId}/models/${modelId}/cancel`,
      { method: "POST" },
    ),
  renameModel: (projectId: string, modelId: string, name: string) =>
    request<Project>(`/api/projects/${projectId}/models/${modelId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  updateModelLifecycle: (
    projectId: string,
    modelId: string,
    data: { alias?: string; stage: string },
  ) =>
    request<Project>(`/api/projects/${projectId}/models/${modelId}/lifecycle`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  retryTraining: (projectId: string, modelId: string) =>
    request<Project>(`/api/projects/${projectId}/models/${modelId}/retry`, {
      method: "POST",
    }),
  deleteModel: (projectId: string, modelId: string) =>
    request<void>(`/api/projects/${projectId}/models/${modelId}`, {
      method: "DELETE",
    }),
  trainingWorkers: () => request<TrainingWorker[]>("/api/training-workers"),
  createTrainingWorker: (name: string) =>
    request<TrainingWorker & { token: string }>("/api/training-workers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  revokeTrainingWorker: (workerId: string) =>
    request<void>(`/api/training-workers/${workerId}`, { method: "DELETE" }),
  exportModel: (projectId: string, modelId: string, format: string) =>
    fetch(`/api/projects/${projectId}/models/${modelId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format }),
    }),
  modelWeightsUrl: (projectId: string, modelId: string) =>
    `/api/projects/${projectId}/models/${modelId}/weights`,
  importModel: (
    projectId: string,
    file: File,
    data: {
      name: string;
      version_id?: string;
      map50?: number;
      precision?: number;
      recall?: number;
    },
    onProgress?: (percent: number) => void,
    onProcessing?: () => void,
  ) => {
    const body = new FormData();
    body.append("file", file);
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) body.append(key, String(value));
    });
    return uploadRequest<Project>(
      `/api/projects/${projectId}/models/import`,
      body,
      onProgress,
      onProcessing,
    );
  },
  deploymentKeys: (projectId: string) =>
    request<
      Array<{
        id: string;
        name: string;
        prefix: string;
        createdAt: string;
        lastUsed?: string;
        revoked: boolean;
      }>
    >(`/api/projects/${projectId}/deployment/keys`),
  createDeploymentKey: (projectId: string, name: string) =>
    request<{
      id: string;
      name: string;
      key: string;
      prefix: string;
      createdAt: string;
      revoked: boolean;
    }>(`/api/projects/${projectId}/deployment/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  revokeDeploymentKey: (projectId: string, keyId: string) =>
    request<void>(`/api/projects/${projectId}/deployment/keys/${keyId}`, {
      method: "DELETE",
    }),
  deploymentMetrics: (projectId: string) =>
    request<{
      requests: number;
      averageLatencyMs: number;
      errors: number;
      recent: Array<{
        created_at: string;
        latency_ms: number;
        predictions: number;
        status: string;
      }>;
    }>(`/api/projects/${projectId}/deployment/metrics`),
  system: () =>
    request<{
      disk: { total: number; used: number; free: number };
      gpu: { available: boolean; name?: string; count: number };
      data: Record<string, number>;
    }>("/api/system"),
  members: () => request<WorkspaceMember[]>("/api/members"),
  createMember: (data: {
    name: string;
    email: string;
    role: string;
    password?: string;
  }) =>
    request<WorkspaceMember>("/api/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  updateMember: (
    id: string,
    data: { name: string; email: string; role: string; password?: string },
  ) =>
    request<WorkspaceMember>(`/api/members/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  deleteMember: (id: string) =>
    request<void>(`/api/members/${id}`, { method: "DELETE" }),
  backupUrl: "/api/backup",
  restore: (
    file: File,
    onProgress?: (percent: number) => void,
    onProcessing?: () => void,
  ) => {
    const body = new FormData();
    body.append("file", file);
    return uploadRequest<{
      status: string;
      safetyCopy: string;
      projects: number;
    }>("/api/restore", body, onProgress, onProcessing);
  },
  infer: (
    id: string,
    file: File,
    confidence = 0.5,
    onProgress?: (percent: number) => void,
    onProcessing?: () => void,
  ) => {
    const body = new FormData();
    body.append("file", file);
    return uploadRequest<{
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
    }>(
      `/api/projects/${id}/infer?confidence=${confidence}`,
      body,
      onProgress,
      onProcessing,
    );
  },
  inferVideo: (
    id: string,
    file: File,
    confidence = 0.5,
    onProgress?: (percent: number) => void,
    onProcessing?: () => void,
  ) => {
    const body = new FormData();
    body.append("file", file);
    return uploadRequest<{
      sampledFrames: number;
      durationSeconds: number;
      frameInterval: number;
      totals: Record<string, number>;
      timeline: Array<{ second: number; counts: Record<string, number> }>;
      annotatedVideoUrl: string;
      annotatedVideoName: string;
    }>(
      `/api/projects/${id}/infer/video?confidence=${confidence}`,
      body,
      onProgress,
      onProcessing,
    );
  },
  modelEvaluationArtifacts: (projectId: string, modelId: string) =>
    request<EvaluationArtifact[]>(
      `/api/projects/${projectId}/models/${modelId}/evaluation`,
    ),
  modelEvaluationArtifactUrl: (
    projectId: string,
    modelId: string,
    artifact: string,
  ) =>
    `/api/projects/${projectId}/models/${modelId}/evaluation/${encodeURIComponent(artifact)}`,
  workflows: () => request<WorkflowData[]>("/api/workflows"),
  saveWorkflow: (data: WorkflowData) =>
    request<WorkflowData>("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  duplicateWorkflow: (id: string) =>
    request<WorkflowData>(`/api/workflows/${id}/duplicate`, { method: "POST" }),
  workflowRuns: (id: string) =>
    request<WorkflowRun[]>(`/api/workflows/${id}/runs`),
  workflowSchedule: (id: string) =>
    request<{
      id?: string;
      enabled: boolean;
      intervalMinutes: number;
      nextRun: string;
      lastRun?: string;
    } | null>(`/api/workflows/${id}/schedule`),
  setWorkflowSchedule: (
    id: string,
    enabled: boolean,
    intervalMinutes: number,
  ) =>
    request<{ enabled: boolean; intervalMinutes: number; nextRun: string }>(
      `/api/workflows/${id}/schedule`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, interval_minutes: intervalMinutes }),
      },
    ),
  deleteWorkflowSchedule: (id: string) =>
    request<void>(`/api/workflows/${id}/schedule`, { method: "DELETE" }),
  deleteWorkflow: (id: string) =>
    request<void>(`/api/workflows/${id}`, { method: "DELETE" }),
  runWorkflow: (
    id: string,
    file: File,
    confidence = 0.5,
    onProgress?: (percent: number) => void,
    onProcessing?: () => void,
  ) => {
    const body = new FormData();
    body.append("file", file);
    return uploadRequest<{
      workflowId: string;
      status: string;
      predictions: Array<{ class: string; confidence: number }>;
      counts: Record<string, number>;
    }>(
      `/api/workflows/${id}/run?confidence=${confidence}`,
      body,
      onProgress,
      onProcessing,
    );
  },
};
