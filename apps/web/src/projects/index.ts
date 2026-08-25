export type ProjectTabKey = "dashboard" | "register" | "list";

export const projectTabKeys: ProjectTabKey[] = ["dashboard", "register", "list"];

export const projectTabTranslationKeys: Record<ProjectTabKey, string> = {
  dashboard: "project.subnav.dashboard",
  register: "project.subnav.register",
  list: "project.subnav.list",
};

export type AppType = "web" | "service" | "integration" | "database" | "ai-model" | "worker";
export type AppStatus = "running" | "stopped" | "error" | "maintenance" | "building";

export interface AppEntry {
  id: number;
  code: string;
  type: AppType;
  version: string;
  status: AppStatus;
  endpoint: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  description_zh: string;
  description_en: string;
  description_vi: string;
  lastHeartbeat: string;
  owner: string;
  createdAt: string;
}

export interface ProjectFormData {
  code: string;
  type: AppType;
  version: string;
  endpoint: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  description_zh: string;
  description_en: string;
  description_vi: string;
  owner: string;
}

export { ProjectDashboard } from "./ProjectDashboard";
export { ProjectRegistration } from "./ProjectRegistration";
export { ProjectList } from "./ProjectList";
