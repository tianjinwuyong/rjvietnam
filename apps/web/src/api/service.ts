import { apiClient, type ListEnvelope, type MutateEnvelope } from "./client";
import type { RmaRequest, ServiceTicket } from "../../../../packages/shared-types/src/factory";

// ── Service Registry ────────────────────────────────────────────────
// Local registry of companion services. It used to ship four fictional entries;
// it now starts empty so nothing shows up that was not registered for real.

export type ServiceUpdateStatus = "active" | "deprecated" | "removed";

export interface ServiceRegistryEntry {
  id: number;
  name: string;
  version: string;
  updateStatus: ServiceUpdateStatus;
  registeredAt: string; // ISO date string
  description: string;
}

let registryNextId = 1;
const registryStore: ServiceRegistryEntry[] = [];

export const serviceRegistryApi = {
  list(): ServiceRegistryEntry[] {
    return registryStore.filter((e) => e.updateStatus !== "removed");
  },

  create(data: { name: string; version: string; description: string }): ServiceRegistryEntry {
    const entry: ServiceRegistryEntry = {
      id: registryNextId++,
      name: data.name,
      version: data.version,
      updateStatus: "active",
      registeredAt: new Date().toISOString().slice(0, 10),
      description: data.description,
    };
    registryStore.push(entry);
    return entry;
  },

  remove(id: number): void {
    const idx = registryStore.findIndex((e) => e.id === id);
    if (idx !== -1) {
      registryStore[idx] = { ...registryStore[idx], updateStatus: "removed" };
    }
  },

  restore(id: number): void {
    const idx = registryStore.findIndex((e) => e.id === id);
    if (idx !== -1) {
      registryStore[idx] = { ...registryStore[idx], updateStatus: "active" };
    }
  },
};

// ── Ticket API ────────────────────────────────────────────────────

export interface TicketFormData {
  customerCode: string;
  category: string;
  priority: string;
  subject: string;
  description: string;
  sourceChannel: string;
  assignee?: string;
}

export const serviceApi = {
  async listTickets(): Promise<ListEnvelope<ServiceTicket>> {
    return apiClient.get<ListEnvelope<ServiceTicket>>("/api/service/tickets");
  },

  async createTicket(form: TicketFormData): Promise<MutateEnvelope<ServiceTicket>> {
    return apiClient.post<MutateEnvelope<ServiceTicket>>("/api/service/tickets", form);
  },

  async listRmas(): Promise<ListEnvelope<RmaRequest>> {
    return apiClient.get<ListEnvelope<RmaRequest>>("/api/service/rmas");
  },

  async createRma(form: Omit<RmaRequest, "id" | "rmaNumber" | "createdAt">): Promise<MutateEnvelope<RmaRequest>> {
    return apiClient.post<MutateEnvelope<RmaRequest>>("/api/service/rmas", form);
  },
};
