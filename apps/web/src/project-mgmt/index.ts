export type ProjectMgmtTabKey = "dashboard" | "register" | "list";

export const projectMgmtTabKeys: ProjectMgmtTabKey[] = ["dashboard", "register", "list"];

export const projectMgmtTabTranslationKeys: Record<ProjectMgmtTabKey, string> = {
  dashboard: "projectMgmt.subnav.dashboard",
  register: "projectMgmt.subnav.register",
  list: "projectMgmt.subnav.list",
};

export { ProjectMgmt } from "./ProjectMgmt";
export type { Project, ProjectType, ProjectStatus, ProjectFormData } from "../api/projectMgmt";
