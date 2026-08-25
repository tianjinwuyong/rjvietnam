import type { ListEnvelope, MutateEnvelope } from "./client";

export type ProjectType =
  | "engineering"    // 工程项目
  | "rd"             // 研发项目
  | "tech_improvement" // 技改项目
  | "new_product"    // 新产品项目
  | "cooperation"       // 合作项目
  | "cooperation_outsource"; // 外协合作项目

export type ProjectStatus =
  | "planning"
  | "in_progress"
  | "on_hold"
  | "completed"
  | "cancelled";

export interface Project {
  id: number;
  code: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  type: ProjectType;
  status: ProjectStatus;
  department: string;
  manager: string;
  budget: number;
  currency: string;
  startDate: string;
  endDate: string;
  description_zh: string;
  description_en: string;
  description_vi: string;
  objectives_zh: string;
  objectives_en: string;
  objectives_vi: string;
  deliverables_zh: string;
  deliverables_en: string;
  deliverables_vi: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFormData {
  code: string;
  name_zh: string;
  name_en: string;
  name_vi: string;
  type: ProjectType;
  status: ProjectStatus;
  department: string;
  manager: string;
  budget: string;
  currency: string;
  startDate: string;
  endDate: string;
  description_zh: string;
  description_en: string;
  description_vi: string;
  objectives_zh: string;
  objectives_en: string;
  objectives_vi: string;
  deliverables_zh: string;
  deliverables_en: string;
  deliverables_vi: string;
}

const SEED_PROJECTS: Project[] = [
  {
    id: 1,
    code: "PRJ-ENG-001",
    name_zh: "SMT 产线自动化改造",
    name_en: "SMT Line Automation Upgrade",
    name_vi: "Nâng cấp tự động hóa dây chuyền SMT",
    type: "engineering",
    status: "in_progress",
    department: "工程部",
    manager: "张工",
    budget: 1200000,
    currency: "CNY",
    startDate: "2026-01-15",
    endDate: "2026-06-30",
    description_zh: "将现有 SMT 产线改造为全自动化，引入 AOI 和 SPI 设备",
    description_en: "Upgrade existing SMT line to full automation with AOI and SPI equipment",
    description_vi: "Nâng cấp dây chuyền SMT hiện có lên tự động hóa hoàn toàn với thiết bị AOI và SPI",
    objectives_zh: "提升产能 30%，降低人工干预",
    objectives_en: "Increase capacity by 30%, reduce manual intervention",
    objectives_vi: "Tăng công suất 30%, giảm can thiệp thủ công",
    deliverables_zh: "3 台 AOI + 2 台 SPI 设备部署",
    deliverables_en: "Deployment of 3 AOI + 2 SPI machines",
    deliverables_vi: "Triển khai 3 máy AOI + 2 máy SPI",
    createdBy: "admin",
    createdAt: "2026-01-10T08:00:00Z",
    updatedAt: "2026-06-15T10:30:00Z",
  },
  {
    id: 2,
    code: "PRJ-RD-001",
    name_zh: "新型无铅焊膏研发",
    name_en: "Lead-Free Solder Paste R&D",
    name_vi: "Nghiên cứu mối hàn không chì mới",
    type: "rd",
    status: "in_progress",
    department: "研发部",
    manager: "李博士",
    budget: 800000,
    currency: "CNY",
    startDate: "2026-03-01",
    endDate: "2026-12-31",
    description_zh: "开发符合 IPC/JEDEC 标准的新型无铅焊膏",
    description_en: "Develop new lead-free solder paste meeting IPC/JEDEC standards",
    description_vi: "Phát triển mối hàn không chì mới đáp ứng tiêu chuẩn IPC/JEDEC",
    objectives_zh: "通过可靠性测试，替代现有进口焊膏",
    objectives_en: "Pass reliability tests, replace existing imported solder paste",
    objectives_vi: "Vượt qua kiểm tra độ tin cậy, thay thế mối hàn nhập khẩu hiện có",
    deliverables_zh: "实验室样品 + 测试报告",
    deliverables_en: "Lab samples + test report",
    deliverables_vi: "Mẫu phòng thí nghiệm + báo cáo kiểm tra",
    createdBy: "admin",
    createdAt: "2026-02-20T09:00:00Z",
    updatedAt: "2026-06-18T14:00:00Z",
  },
  {
    id: 3,
    code: "PRJ-TI-001",
    name_zh: "贴片机飞达校准系统",
    name_en: "Feeder Calibration System",
    name_vi: "Hệ thống hiệu chuẩn feeder",
    type: "tech_improvement",
    status: "completed",
    department: "技术部",
    manager: "陈工",
    budget: 300000,
    currency: "CNY",
    startDate: "2025-11-01",
    endDate: "2026-03-31",
    description_zh: "开发贴片机飞达自动校准与寿命监控系统",
    description_en: "Develop automated feeder calibration and lifespan monitoring system",
    description_vi: "Phát triển hệ thống hiệu chuẩn feeder tự động và giám sát tuổi thọ",
    objectives_zh: "减少飞达故障导致的抛料率",
    objectives_en: "Reduce throw-away rate caused by feeder failures",
    objectives_vi: "Giảm tỷ lệ phế phẩm do lỗi feeder",
    deliverables_zh: "监控系统上线，故障率下降 25%",
    deliverables_en: "Monitoring system online, failure rate down 25%",
    deliverables_vi: "Hệ thống giám sát trực tuyến, tỷ lệ lỗi giảm 25%",
    createdBy: "admin",
    createdAt: "2025-10-15T08:00:00Z",
    updatedAt: "2026-04-01T16:00:00Z",
  },
  {
    id: 4,
    code: "PRJ-NP-001",
    name_zh: "车载摄像头模组新产品导入",
    name_en: "Automotive Camera Module NPI",
    name_vi: "Đưa sản phẩm camera ô tô mới vào sản xuất",
    type: "new_product",
    status: "planning",
    department: "NPI 部",
    manager: "王经理",
    budget: 2500000,
    currency: "CNY",
    startDate: "2026-07-01",
    endDate: "2027-06-30",
    description_zh: "从样品到量产，导入车载摄像头模组新产品线",
    description_en: "NPI for automotive camera module from sample to mass production",
    description_vi: "Đưa vào sản xuất module camera ô tô từ mẫu đến sản xuất hàng loạt",
    objectives_zh: "完成 IATF 16949 认证并进入量产",
    objectives_en: "Complete IATF 16949 certification and enter mass production",
    objectives_vi: "Hoàn thành chứng nhận IATF 16949 và đi vào sản xuất hàng loạt",
    deliverables_zh: "IATF 16949 认证 + 月产能 50K",
    deliverables_en: "IATF 16949 certification + 50K monthly capacity",
    deliverables_vi: "Chứng nhận IATF 16949 + công suất 50K/tháng",
    createdBy: "admin",
    createdAt: "2026-05-20T10:00:00Z",
    updatedAt: "2026-06-01T09:00:00Z",
  },
  {
    id: 5,
    code: "PRJ-COOP-001",
    name_zh: "与华为合作 5G 通信模组项目",
    name_en: "Huawei 5G Communication Module Cooperation",
    name_vi: "Hợp tác mô-đun 5G với Huawei",
    type: "cooperation",
    status: "in_progress",
    department: "战略合作部",
    manager: "刘总",
    budget: 5000000,
    currency: "CNY",
    startDate: "2026-02-01",
    endDate: "2027-01-31",
    description_zh: "与华为合作开发 5G 通信模组，进入其全球供应链",
    description_en: "Cooperate with Huawei to develop 5G communication module for global supply chain",
    description_vi: "Hợp tác với Huawei phát triển mô-đun 5G cho chuỗi cung ứng toàn cầu",
    objectives_zh: "通过华为供应商审核，进入其全球供应商名录",
    objectives_en: "Pass Huawei supplier audit, enter global supplier directory",
    objectives_vi: "Vượt qua kiểm toán nhà cung cấp Huawei, vào danh mục nhà cung cấp toàn cầu",
    deliverables_zh: "华为供应商认证 + 首个批量订单",
    deliverables_en: "Huawei supplier certification + first batch order",
    deliverables_vi: "Chứng nhận nhà cung cấp Huawei + đơn hàng lô đầu tiên",
    createdBy: "admin",
    createdAt: "2026-01-25T08:00:00Z",
    updatedAt: "2026-06-20T11:00:00Z",
  },
];

let nextId = 100;

const store: Project[] = [...SEED_PROJECTS];

export const projectMgmtApi = {
  list(): Promise<ListEnvelope<Project>> {
    return Promise.resolve({ items: [...store], total: store.length });
  },

  get(id: number): Promise<Project | undefined> {
    return Promise.resolve(store.find((p) => p.id === id));
  },

  register(data: ProjectFormData): Promise<MutateEnvelope<Project>> {
    const item: Project = {
      id: ++nextId,
      code: data.code,
      name_zh: data.name_zh,
      name_en: data.name_en,
      name_vi: data.name_vi,
      type: data.type,
      status: data.status,
      department: data.department,
      manager: data.manager,
      budget: parseFloat(data.budget) || 0,
      currency: data.currency,
      startDate: data.startDate,
      endDate: data.endDate,
      description_zh: data.description_zh,
      description_en: data.description_en,
      description_vi: data.description_vi,
      objectives_zh: data.objectives_zh,
      objectives_en: data.objectives_en,
      objectives_vi: data.objectives_vi,
      deliverables_zh: data.deliverables_zh,
      deliverables_en: data.deliverables_en,
      deliverables_vi: data.deliverables_vi,
      createdBy: "admin",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.push(item);
    return Promise.resolve({ item });
  },

  update(id: number, data: ProjectFormData): Promise<MutateEnvelope<Project>> {
    const idx = store.findIndex((p) => p.id === id);
    if (idx === -1) return Promise.reject("Not found");
    const updated: Project = {
      ...store[idx],
      name_zh: data.name_zh,
      name_en: data.name_en,
      name_vi: data.name_vi,
      type: data.type,
      status: data.status,
      department: data.department,
      manager: data.manager,
      budget: parseFloat(data.budget) || 0,
      currency: data.currency,
      startDate: data.startDate,
      endDate: data.endDate,
      description_zh: data.description_zh,
      description_en: data.description_en,
      description_vi: data.description_vi,
      objectives_zh: data.objectives_zh,
      objectives_en: data.objectives_en,
      objectives_vi: data.objectives_vi,
      deliverables_zh: data.deliverables_zh,
      deliverables_en: data.deliverables_en,
      deliverables_vi: data.deliverables_vi,
      updatedAt: new Date().toISOString(),
    };
    store[idx] = updated;
    return Promise.resolve({ item: updated });
  },

  remove(id: number): Promise<void> {
    const idx = store.findIndex((p) => p.id === id);
    if (idx !== -1) store.splice(idx, 1);
    return Promise.resolve();
  },
};
