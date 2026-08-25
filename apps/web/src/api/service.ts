import { authStorage, type ListEnvelope, type MutateEnvelope } from "./client";
import type { RmaRequest, ServiceTicket } from "../../../../packages/shared-types/src/factory";

// ── Demo-mode in-memory store ─────────────────────────────────────

const SEED_TICKETS: ServiceTicket[] = [
  { id: "TKT-2026-0001", ticketNo: "TKT-2026-0001", customerCode: "CUST-SONY-002", category: "complaint", priority: "high", status: "in_progress", subject: "显示模块信号异常", slaDueAt: "2026-06-20T16:00:00Z", assignee: "VN_CS_001" },
  { id: "TKT-2026-0002", ticketNo: "TKT-2026-0002", customerCode: "CUST-LG-003", category: "quality_issue", priority: "urgent", status: "open", subject: "批量产品外观划痕", slaDueAt: "2026-06-19T20:00:00Z" },
  { id: "TKT-2026-0003", ticketNo: "TKT-2026-0003", customerCode: "CUST-VIETTEL-006", category: "defect_report", priority: "normal", status: "resolved", subject: "PCB 焊接缺陷反馈", slaDueAt: "2026-06-22T16:00:00Z", assignee: "VN_CS_002" },
  { id: "TKT-2026-0004", ticketNo: "TKT-2026-0004", customerCode: "CUST-SHARP-001", category: "complaint", priority: "low", status: "closed", subject: "包装数量短缺", slaDueAt: "2026-06-30T16:00:00Z", assignee: "VN_CS_001" },
];

const SEED_RMAS: RmaRequest[] = [
  { id: "RMA-2026-0001", rmaNumber: "RMA-2026-0001", customerCode: "CUST-SONY-002", productCode: "PROD-DISPLAY-D1", serialNo: "D1SN-260615-0042", qty: 50, reasonCode: "DEFECT-COSMETIC", customerComplaint: "50 个 D1 模块屏幕有划痕", receivedAt: "2026-06-17", inspectionResult: "fail", disposition: "repair", status: "inspecting", createdAt: "2026-06-15" },
  { id: "RMA-2026-0002", rmaNumber: "RMA-2026-0002", customerCode: "CUST-SHARP-001", productCode: "PROD-CPU-A1", serialNo: "A1SN-260610-0008", qty: 12, reasonCode: "DEFECT-FUNCTIONAL", customerComplaint: "12 块 CPU 板无法启动", inspectionResult: "pending", status: "submitted", createdAt: "2026-06-18" },
  { id: "RMA-2026-0003", rmaNumber: "RMA-2026-0003", customerCode: "CUST-LG-003", productCode: "PROD-POWER-C3", serialNo: "C3SN-260605-0220", qty: 25, reasonCode: "DEFECT-ELEC", customerComplaint: "电源管理板输出电压异常", inspectionResult: "pass", disposition: "replace", status: "closed", createdAt: "2026-06-05" },
];

let ticketNextNo = 5;
let rmaNextNo = 4;

let ticketStore: ServiceTicket[] = [...SEED_TICKETS];
let rmaStore: RmaRequest[] = [...SEED_RMAS];

function delay<T>(value: T, ms = 120): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function isDemoMode(): boolean {
  return !authStorage.getToken();
}

function makeTicketNo(): string {
  return `TKT-${new Date().getFullYear()}-${String(ticketNextNo++).padStart(4, "0")}`;
}

function makeRmaNo(): string {
  return `RMA-${new Date().getFullYear()}-${String(rmaNextNo++).padStart(4, "0")}`;
}

// ── Service Registry ────────────────────────────────────────────────

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
let registryStore: ServiceRegistryEntry[] = [
  { id: registryNextId++, name: "SMT 贴片机控制系统", version: "v2.4.1", updateStatus: "active", registeredAt: "2026-01-15", description: "西门子 SMT 产线贴片机控制软件" },
  { id: registryNextId++, name: "AOI 检测程序库", version: "v1.8.0", updateStatus: "active", registeredAt: "2026-02-20", description: "自动光学检测设备检测参数配置" },
  { id: registryNextId++, name: "MES 工控中间件", version: "v3.1.2", updateStatus: "active", registeredAt: "2026-03-10", description: "产线 MES 系统与设备通讯中间件" },
  { id: registryNextId++, name: "ERP 物料同步服务", version: "v1.2.0", updateStatus: "deprecated", registeredAt: "2025-11-05", description: "ERP 与 WMS 物料数据同步服务（已停用）" },
];

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
    if (isDemoMode()) return delay({ items: [...ticketStore], total: ticketStore.length });
    // TODO: replace with apiClient.get when backend is ready
    return delay({ items: [...ticketStore], total: ticketStore.length });
  },

  async createTicket(form: TicketFormData): Promise<MutateEnvelope<ServiceTicket>> {
    if (isDemoMode()) {
      const now = new Date();
      const due = new Date(now.getTime() + 24 * 60 * 60 * 1000); // SLA: +24h
      const entry: ServiceTicket = {
        id: makeTicketNo(),
        ticketNo: makeTicketNo(),
        customerCode: form.customerCode,
        category: form.category,
        priority: form.priority as ServiceTicket["priority"],
        status: "open",
        subject: form.subject,
        description: form.description,
        slaDueAt: due.toISOString(),
        assignee: form.assignee,
        sourceChannel: form.sourceChannel,
        openedAt: now.toISOString(),
      };
      ticketStore.push(entry);
      return delay({ item: entry });
    }
    // TODO: apiClient.post("/api/service/tickets", form)
    return delay({ item: {} as ServiceTicket });
  },

  async listRmas(): Promise<ListEnvelope<RmaRequest>> {
    if (isDemoMode()) return delay({ items: [...rmaStore], total: rmaStore.length });
    return delay({ items: [...rmaStore], total: rmaStore.length });
  },

  async createRma(form: Omit<RmaRequest, "id" | "rmaNumber" | "createdAt">): Promise<MutateEnvelope<RmaRequest>> {
    if (isDemoMode()) {
      const entry: RmaRequest = {
        id: makeRmaNo(),
        rmaNumber: makeRmaNo(),
        createdAt: new Date().toISOString().slice(0, 10),
        ...form,
      };
      rmaStore.push(entry);
      return delay({ item: entry });
    }
    // TODO: apiClient.post("/api/service/rmas", form)
    return delay({ item: {} as RmaRequest });
  },
};
