import { apiClient, authStorage, type ListEnvelope, type MutateEnvelope } from "./client";
import type { AppEntry, AppStatus, ProjectFormData } from "../projects/index";

// ── Demo-mode in-memory store ─────────────────────────────────────

const SEED_APPS: AppEntry[] = [
  {
    id: 1, code: "APP-WEB", type: "web", version: "2.4.0",
    status: "running",
    endpoint: "http://localhost:5173",
    name_zh: "工厂管理 Web", name_en: "Factory Web App", name_vi: "Web quản lý nhà máy",
    description_zh: "主操作界面，包括仪表盘、WMS、MES、PMC 等模块",
    description_en: "Main UI covering dashboard, WMS, MES, PMC modules",
    description_vi: "Giao diện chính: dashboard, WMS, MES, PMC",
    lastHeartbeat: new Date().toISOString(), owner: "Wang Wei", createdAt: "2026-05-01T00:00:00Z",
  },
  {
    id: 2, code: "SVC-API", type: "service", version: "2.4.0",
    status: "running",
    endpoint: "http://localhost:3001/api",
    name_zh: "后端 API 服务", name_en: "Backend API Service", name_vi: "Dịch vụ API",
    description_zh: "RESTful API 网关，提供所有业务模块的数据接口",
    description_en: "RESTful API gateway for all business modules",
    description_vi: "Cổng API RESTful cho tất cả module nghiệp vụ",
    lastHeartbeat: new Date().toISOString(), owner: "Li Ming", createdAt: "2026-05-01T00:00:00Z",
  },
  {
    id: 3, code: "SVC-WMS", type: "service", version: "1.2.0",
    status: "running",
    endpoint: "http://localhost:3002/api",
    name_zh: "WMS 仓储服务", name_en: "WMS Service", name_vi: "Dịch vụ kho WMS",
    description_zh: "物料收发、IQC、库存、拣料、发料到线",
    description_en: "Material receiving, IQC, inventory, picking, line issue",
    description_vi: "Nhận/xuất vật tư, IQC, tồn kho, lấy hàng, cấp phát",
    lastHeartbeat: new Date().toISOString(), owner: "Li Ming", createdAt: "2026-05-10T00:00:00Z",
  },
  {
    id: 4, code: "SVC-MES", type: "service", version: "1.1.0",
    status: "running",
    endpoint: "http://localhost:3003/api",
    name_zh: "MES 生产执行服务", name_en: "MES Service", name_vi: "Dịch vụ MES",
    description_zh: "SMT 产线执行、飞达绑定、首件确认、产出记录",
    description_en: "SMT line execution, feeder binding, first article, output",
    description_vi: "Vận hành dây chuyền SMT, gắn feeder, kiểm tra đầu, ghi nhận sản lượng",
    lastHeartbeat: new Date(Date.now() - 120_000).toISOString(), owner: "Chen Yu", createdAt: "2026-05-15T00:00:00Z",
  },
  {
    id: 5, code: "DB-PG", type: "database", version: "16.4",
    status: "running",
    endpoint: "postgresql://localhost:5432/smt_factory",
    name_zh: "PostgreSQL 主数据库", name_en: "PostgreSQL Main DB", name_vi: "CSDL PostgreSQL",
    description_zh: "主业务数据库，存储工单、物料、库存、质量等数据",
    description_en: "Main DB for work orders, materials, inventory, quality",
    description_vi: "CSDL chính: lệnh SX, vật tư, tồn kho, chất lượng",
    lastHeartbeat: new Date().toISOString(), owner: "DBA Team", createdAt: "2026-05-01T00:00:00Z",
  },
  {
    id: 6, code: "AI-HOLO", type: "ai-model", version: "3.1",
    status: "running",
    endpoint: "http://localhost:11434/v1",
    name_zh: "Holo3.1 推理模型", name_en: "Holo3.1 Reasoning Model", name_vi: "Mô hình suy luận Holo3.1",
    description_zh: "深度推理和视觉分析 Agent",
    description_en: "Deep reasoning & vision analysis agent",
    description_vi: "Suy luận sâu & phân tích hình ảnh",
    lastHeartbeat: new Date().toISOString(), owner: "AI Team", createdAt: "2026-06-20T00:00:00Z",
  },
  {
    id: 7, code: "AI-PHI4", type: "ai-model", version: "mini",
    status: "running",
    endpoint: "http://localhost:11434/v1",
    name_zh: "Phi-4-mini 轻量模型", name_en: "Phi-4-mini Lightweight", name_vi: "Mô hình nhẹ Phi-4-mini",
    description_zh: "快速分类、过滤，OpenCode small_model",
    description_en: "Fast classification, OpenCode small_model",
    description_vi: "Phân loại nhanh, small_model của OpenCode",
    lastHeartbeat: new Date().toISOString(), owner: "AI Team", createdAt: "2026-06-22T00:00:00Z",
  },
  {
    id: 8, code: "INT-BAR", type: "integration", version: "1.0.0",
    status: "building",
    endpoint: "",
    name_zh: "条码扫描集成", name_en: "Barcode Scanner", name_vi: "Máy quét mã vạch",
    description_zh: "解析工单号、PCB SN、料盘码、库位码",
    description_en: "Parse work order codes, PCB SNs, reel codes, location codes",
    description_vi: "Phân tích mã lệnh SX, mã PCB, mã cuộn, mã vị trí",
    lastHeartbeat: "", owner: "Engineer Team", createdAt: "2026-06-22T00:00:00Z",
  },
  {
    id: 9, code: "WKR-REPORT", type: "worker", version: "0.5.0",
    status: "stopped",
    endpoint: "",
    name_zh: "报表生成 Worker", name_en: "Report Worker", name_vi: "Worker báo cáo",
    description_zh: "定时生成生产/质量/库存报表",
    description_en: "Scheduled production/quality/inventory reports",
    description_vi: "Tạo báo cáo SX/CL/tồn kho theo lịch",
    lastHeartbeat: "2026-06-21T10:00:00Z", owner: "BI Team", createdAt: "2026-06-01T00:00:00Z",
  },
];

let nextId = 10;
let store: AppEntry[] = [...SEED_APPS];

function delay<T>(value: T, ms = 120): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function isDemoMode(): boolean {
  return !authStorage.getToken();
}

// ── API module ────────────────────────────────────────────────────

export const projectsApi = {
  async list(): Promise<ListEnvelope<AppEntry>> {
    if (isDemoMode()) return delay({ items: [...store], total: store.length });
    return apiClient.get<ListEnvelope<AppEntry>>("/api/projects");
  },

  async getById(id: number): Promise<MutateEnvelope<AppEntry>> {
    if (isDemoMode()) {
      const item = store.find((a) => a.id === id);
      if (!item) throw new Error(`App id ${id} not found`);
      return delay({ item });
    }
    return apiClient.get<MutateEnvelope<AppEntry>>(`/api/projects/${id}`);
  },

  async register(form: ProjectFormData): Promise<MutateEnvelope<AppEntry>> {
    if (isDemoMode()) {
      const existing = store.find((a) => a.code === form.code);
      if (existing) throw new Error(`App code "${form.code}" already exists`);
      const now = new Date().toISOString();
      const entry: AppEntry = {
        id: nextId++, code: form.code, type: form.type, version: form.version,
        status: "building", endpoint: form.endpoint,
        name_zh: form.name_zh, name_en: form.name_en, name_vi: form.name_vi,
        description_zh: form.description_zh, description_en: form.description_en,
        description_vi: form.description_vi, lastHeartbeat: "", owner: form.owner, createdAt: now,
      };
      store.push(entry);
      return delay({ item: entry, auditEventId: 1 });
    }
    return apiClient.post<MutateEnvelope<AppEntry>>("/api/projects", form);
  },

  async update(id: number, form: ProjectFormData): Promise<MutateEnvelope<AppEntry>> {
    if (isDemoMode()) {
      const idx = store.findIndex((a) => a.id === id);
      if (idx === -1) throw new Error(`App id ${id} not found`);
      store[idx] = { ...store[idx], ...form };
      return delay({ item: store[idx], auditEventId: 2 });
    }
    return apiClient.patch<MutateEnvelope<AppEntry>>(`/api/projects/${id}`, form);
  },

  async remove(id: number): Promise<void> {
    if (isDemoMode()) {
      const idx = store.findIndex((a) => a.id === id);
      if (idx === -1) throw new Error(`App id ${id} not found`);
      store.splice(idx, 1);
      return delay(undefined);
    }
    return apiClient.delete(`/api/projects/${id}`);
  },

  async updateStatus(id: number, status: AppStatus): Promise<MutateEnvelope<AppEntry>> {
    if (isDemoMode()) {
      const idx = store.findIndex((a) => a.id === id);
      if (idx === -1) throw new Error(`App id ${id} not found`);
      store[idx] = {
        ...store[idx],
        status,
        lastHeartbeat: status === "running" ? new Date().toISOString() : store[idx].lastHeartbeat,
      };
      return delay({ item: store[idx] });
    }
    return apiClient.patch<MutateEnvelope<AppEntry>>(`/api/projects/${id}/status`, { status });
  },
};
