import type { Project } from "./types";

export const starterProjects: Project[] = [
  {
    id: "warehouse-safety",
    name: "Warehouse Safety",
    type: "Object Detection",
    description: "Detect people, helmets, and forklifts in warehouse zones.",
    createdAt: "2026-08-18",
    classes: ["person", "helmet", "forklift"],
    colors: { person: "#ffcf4a", helmet: "#7a62ed", forklift: "#24c7bd" },
    assets: [],
    versions: [
      {
        id: "v1",
        number: 1,
        createdAt: "2026-08-19",
        images: 248,
        resize: 640,
        augment: true,
        splits: [70, 20, 10],
      },
    ],
    models: [
      {
        id: "m1",
        name: "VisionFlow Detect Fast",
        version: 1,
        status: "ready",
        progress: 100,
        map: 87.4,
        precision: 91.2,
        recall: 84.8,
      },
    ],
  },
  {
    id: "surface-defects",
    name: "Surface Defects",
    type: "Instance Segmentation",
    description: "Quality inspection for scratches and dents.",
    createdAt: "2026-08-12",
    classes: ["scratch", "dent"],
    colors: { scratch: "#ffcf4a", dent: "#7a62ed" },
    assets: [],
    versions: [],
    models: [],
  },
];

export const uid = () => Math.random().toString(36).slice(2, 10);
