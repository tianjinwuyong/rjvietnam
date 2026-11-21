import { apiClient, type ListEnvelope, type MutateEnvelope } from "./client";
import type { AppEntry, AppStatus, ProjectFormData } from "../projects/index";

// ── API module ────────────────────────────────────────────────────

export const projectsApi = {
  async list(): Promise<ListEnvelope<AppEntry>> {
    return apiClient.get<ListEnvelope<AppEntry>>("/api/projects");
  },

  async getById(id: number): Promise<MutateEnvelope<AppEntry>> {
    return apiClient.get<MutateEnvelope<AppEntry>>(`/api/projects/${id}`);
  },

  async register(form: ProjectFormData): Promise<MutateEnvelope<AppEntry>> {
    return apiClient.post<MutateEnvelope<AppEntry>>("/api/projects", form);
  },

  async update(id: number, form: ProjectFormData): Promise<MutateEnvelope<AppEntry>> {
    return apiClient.patch<MutateEnvelope<AppEntry>>(`/api/projects/${id}`, form);
  },

  async remove(id: number): Promise<void> {
    return apiClient.delete(`/api/projects/${id}`);
  },

  async updateStatus(id: number, status: AppStatus): Promise<MutateEnvelope<AppEntry>> {
    return apiClient.patch<MutateEnvelope<AppEntry>>(`/api/projects/${id}/status`, { status });
  },
};
