export type Point = { x: number; y: number; visibility?: 0 | 1 | 2 };
export type Box = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  type?: "box" | "polygon" | "classification" | "keypoint" | "obb";
  points?: Point[];
};
export type Asset = {
  id: string;
  name: string;
  src: string;
  split: "train" | "valid" | "test";
  boxes: Box[];
  status: "unannotated" | "annotated";
  reviewStatus?: "pending" | "approved" | "needs-fix";
};
export type AugmentationSetting = {
  enabled: boolean;
  probability: number;
  amount: number;
};
export type AugmentationRecipe = Record<string, AugmentationSetting>;
export type Version = {
  id: string;
  number: number;
  createdAt: string;
  images: number;
  generatedImages?: number;
  resize: number;
  augment: boolean;
  splits: [number, number, number];
  augmentations?: { copies?: number; transforms?: AugmentationRecipe };
};
export type Model = {
  id: string;
  name: string;
  version: number;
  status: "queued" | "training" | "ready" | "failed" | "cancelled";
  progress: number;
  map: number;
  precision: number;
  recall: number;
  error?: string;
  createdAt?: string;
  config?: Record<string, unknown>;
  metricsHistory?: Array<Record<string, number>>;
};
export type Project = {
  id: string;
  name: string;
  type: string;
  description: string;
  createdAt: string;
  classes: string[];
  colors: Record<string, string>;
  assets: Asset[];
  versions: Version[];
  models: Model[];
};
