// ── 虚拟员工完整档案数据 ─────────────────────────────────────────────

export type AgentLevel = 1 | 2 | 3; // 1=管理/协调, 2=组长/协调员, 3=专员
export type AgentDomain = "mes" | "wms" | "pmc" | "quality" | "sales" | "hr" | "finance" | "it" | "cmd" | "service";
export type AgentStatus = "active" | "idle" | "error" | "offline";

export interface AgentTask {
  task: string;
  plan: string;
  completion: number; // 0-100
}

export interface AgentProfile {
  id: string;
  // 基本名称
  name_zh: string;
  name_en: string;
  name_vi: string;
  // 性别（用于头像）
  gender: "male" | "female";
  // 岗位
  role: string;
  level: AgentLevel;
  domain: AgentDomain;
  parentId: string | null;
  childIds: string[];
  // 职责
  responsibilities_zh: string;
  responsibilities_en: string;
  responsibilities_vi: string;
  // 汇报
  reportChannels: string[]; // e.g. ["日报", "周报", "异常告警"]
  // 状态
  status: AgentStatus;
  // 实体对接人
  counterpartName: string;
  counterpartContact: string;
  // 报表内容
  reports: string[];
  // 能力
  capabilities: string[];
  // 技术栈
  agentName: string; // AI agent 实例名
  llm: string;       // LLM 模型
  api: string;       // API endpoint
  skills: string[];  // skill 列表
  // 当前任务
  currentTasks: AgentTask[];
  // 知识库
  knowledgeBase: string[];
}

// ── 种子数据 ──────────────────────────────────────────────────────

export const AGENT_PROFILES: AgentProfile[] = [
  // ── 管理层 ────────────────────────────────────────────────
  {
    id: "ceo-001",
    name_zh: "瑞晶虚拟厂长",
    name_en: "Virtual Factory Director",
    name_vi: "Giám đốc nhà máy ảo",
    gender: "female",
    role: "factory-director",
    level: 1,
    domain: "cmd",
    parentId: null,
    childIds: ["dir-mes-001", "dir-wms-001", "dir-pmc-001", "dir-quality-001", "dir-sales-001", "dir-service-001"],
    responsibilities_zh: "全面负责 SMT 工厂生产运营统筹，协调各部门资源，监控 KPI，确保交期与质量目标的达成。",
    responsibilities_en: "Overall coordination of SMT factory operations, resource alignment across departments, KPI monitoring, delivery and quality target achievement.",
    responsibilities_vi: "Điều phối tổng thể hoạt động nhà máy SMT, phân bổ nguồn lực các bộ phận, giám sát KPI, đảm bảo giao hàng và chất lượng.",
    reportChannels: ["日生产报表", "周经营分析", "异常告警即时通知"],
    status: "active",
    counterpartName: "张厂长",
    counterpartContact: "内线 8001",
    reports: ["日产量报表", "在制品WIP报表", "良率报表", "交期达成率", "设备OEE报表"],
    capabilities: ["全局生产调度", "多线协同排产", "KPI综合分析", "异常决策"],
    agentName: "RuiJing-Director-Agent",
    llm: "gpt-4o",
    api: "/api/agents/director",
    skills: ["production-scheduling", "kpi-analysis", "resource-coordination", "llm-reasoning"],
    currentTasks: [
      { task: "Q3 产能提升计划", plan: "提升线速 15%，优化换线时间", completion: 35 },
      { task: "新产线导入准备", plan: "完成设备调试，Q4 量产", completion: 60 },
    ],
    knowledgeBase: ["工厂SOP文档", "历史生产数据", "设备手册", "质量标准"],
  },

  // ── MES 协调层 ─────────────────────────────────────────────
  {
    id: "dir-mes-001",
    name_zh: "MES 虚拟调度主管",
    name_en: "MES Virtual Coordinator",
    name_vi: "Điều phối viên MES ảo",
    gender: "female",
    role: "mes-coordinator",
    level: 2,
    domain: "mes",
    parentId: "ceo-001",
    childIds: ["mes-line1-001", "mes-line2-001", "mes-line3-001", "mes-line4-001"],
    responsibilities_zh: "统筹协调四条 SMT 产线的生产执行，监控工单流转，追踪产线效率，处理产线异常停机和换线调度。",
    responsibilities_en: "Coordinate four SMT production lines, monitor work order flow, track line efficiency, handle line stoppages and changeovers.",
    responsibilities_vi: "Điều phối bốn dây chuyền SMT, giám sát lệnh sản xuất, theo dõi hiệu suất, xử lý dừng máy và chuyển đổi.",
    reportChannels: ["产线实时状态", "工单进度日报", "异常告警"],
    status: "active",
    counterpartName: "王调度",
    counterpartContact: "内线 8102",
    reports: ["各线产量报表", "停机分析报表", "换线时间报表", "在制品追踪"],
    capabilities: ["多线协同调度", "工单管理", "产线效率分析", "SPC过程控制"],
    agentName: "RuiJing-MES-Coordinator",
    llm: "gpt-4o",
    api: "/api/agents/mes-coordinator",
    skills: ["work-order-management", "multi-line-scheduling", "spc-analysis", "incident-response"],
    currentTasks: [
      { task: "AOI 误报率压降", plan: "优化 SPI/AOI 参数，减少 30% 误报", completion: 45 },
      { task: "换线时间压降项目", plan: "标准换线 SOP 落地，目标≤18分钟", completion: 20 },
    ],
    knowledgeBase: ["工单管理SOP", "SPC控制图标准", "换线时间基准", "AOI参数配置手册"],
  },

  // ── WMS 协调层 ─────────────────────────────────────────────
  {
    id: "dir-wms-001",
    name_zh: "WMS 虚拟仓储主管",
    name_en: "WMS Virtual Warehouse Manager",
    name_vi: "Quản lý kho ảo WMS",
    gender: "male",
    role: "wms-coordinator",
    level: 2,
    domain: "wms",
    parentId: "ceo-001",
    childIds: ["wms-receiving-001", "wms-store-001", "wms-issue-001"],
    responsibilities_zh: "统筹仓储收料、IQC、存储、拣料、发料全流程，管理库存准确率，协调物料欠料预警与补货计划。",
    responsibilities_en: "Coordinate receiving, IQC, storage, picking and issuing; manage inventory accuracy; coordinate material shortage alerts and replenishment.",
    responsibilities_vi: "Điều phối tiếp nhận, IQC, lưu kho, nhặt và xuất hàng; quản lý độ chính xác tồn kho; điều phối cảnh báo và bổ sung vật tư.",
    reportChannels: ["库存日报", "IQC合格率", "欠料预警", "发料记录"],
    status: "active",
    counterpartName: "陈仓管",
    counterpartContact: "内线 8201",
    reports: ["库存台账报表", "IQC来料检验报表", "发料汇总报表", "效期预警报表"],
    capabilities: ["库存管理", "IQC流程管控", "物料追溯", "库位优化"],
    agentName: "RuiJing-WMS-Coordinator",
    llm: "gpt-4o",
    api: "/api/agents/wms-coordinator",
    skills: ["inventory-management", "iqc-control", "material-traceability", "location-optimization"],
    currentTasks: [
      { task: "库存准确率提升", plan: "每月盘点+系统校验，年底达 99.5%", completion: 55 },
      { task: "效期管理优化", plan: "先入先出强制执行，效期预警提前 30 天", completion: 30 },
    ],
    knowledgeBase: ["WMS操作手册", "IQC检验标准", "库存盘点SOP", "效期管理规范"],
  },

  // ── PMC 协调层 ─────────────────────────────────────────────
  {
    id: "dir-pmc-001",
    name_zh: "PMC 虚拟计划主管",
    name_en: "PMC Virtual Planner",
    name_vi: "Nhân viên quy hoạch ảo PMC",
    gender: "male",
    role: "pmc-coordinator",
    level: 2,
    domain: "pmc",
    parentId: "ceo-001",
    childIds: ["pmc-wo-001", "pmc-mps-001"],
    responsibilities_zh: "制定与调整主生产计划（MPS），管理工单生命周期，协调物料需求与产线产能，确保交期承诺可行。",
    responsibilities_en: "Create and adjust Master Production Schedule (MPS), manage work order lifecycle, coordinate material requirements and line capacity, ensure feasible delivery commitments.",
    responsibilities_vi: "Lập và điều chỉnh kế hoạch sản xuất chính (MPS), quản lý vòng đời lệnh sản xuất, điều phối nhu cầu vật tư và công suất.",
    reportChannels: ["MPS周报", "工单追踪", "欠料预警", "交期达成分析"],
    status: "active",
    counterpartName: "林计划",
    counterpartContact: "内线 8301",
    reports: ["MPS甘特图", "工单状态报表", "交期达成率", "物料需求计划MRP报表"],
    capabilities: ["MPS排程", "MRP运算", "交期承诺", "产能评估", "多品种协同"],
    agentName: "RuiJing-PMC-Coordinator",
    llm: "gpt-4o",
    api: "/api/agents/pmc-coordinator",
    skills: ["mps-scheduling", "mrp-calculation", "delivery-promising", "capacity-planning"],
    currentTasks: [
      { task: "7月 MPS 排程优化", plan: "考虑物料到位时间，平衡产能利用率 85%", completion: 70 },
      { task: "紧急订单响应流程", plan: "建立 24h 绿色通道，PMC自动评估交期", completion: 25 },
    ],
    knowledgeBase: ["MPS制定手册", "MRP逻辑", "产能评估模型", "历史交期数据库"],
  },

  // ── Quality 协调层 ──────────────────────────────────────────
  {
    id: "dir-quality-001",
    name_zh: "品质虚拟主管",
    name_en: "Quality Virtual Manager",
    name_vi: "Quản lý chất lượng ảo",
    gender: "male",
    role: "quality-coordinator",
    level: 2,
    domain: "quality",
    parentId: "ceo-001",
    childIds: ["iqc-001", "ipqc-001", "oqc-001", "qa-001"],
    responsibilities_zh: "统筹来料检验（IQC）、过程检验（IPQC）、出货检验（OQC）及质量改善（QA），管理质量异常与改善闭环。",
    responsibilities_en: "Oversee IQC, IPQC, OQC and QA; manage quality non-conformances and improvement closed-loop.",
    responsibilities_vi: "Giám sát IQC, IPQC, OQC và QA; quản lý sự không phù hợp và cải tiến chất lượng.",
    reportChannels: ["质量日报", "良率周报", "客诉追踪", "8D报告"],
    status: "active",
    counterpartName: "质控主管",
    counterpartContact: "内线 8401",
    reports: ["良率推移报表", "不良解析报表", "客诉履历报表", "纠正措施追踪报表"],
    capabilities: ["SPC质量管理", "不良解析", "8D改善报告", "ISO体系维护", "客户质量对接"],
    agentName: "RuiJing-Quality-Manager",
    llm: "gpt-4o",
    api: "/api/agents/quality-manager",
    skills: ["spc-control", "8d-analysis", "iso-maintenance", "customer-quality-portal", "capability-index"],
    currentTasks: [
      { task: "AOI误报率改善", plan: "收集TOP3不良图片，优化检测参数", completion: 40 },
      { task: "客户投诉压降", plan: "Q3客诉目标≤3件（目前5件）", completion: 15 },
    ],
    knowledgeBase: ["质量手册", "SPC控制标准", "不良案例库", "8D报告模板", "客户规格书"],
  },

  // ── Sales 协调层 ─────────────────────────────────────────────
  {
    id: "dir-sales-001",
    name_zh: "销售虚拟主管",
    name_en: "Sales Virtual Manager",
    name_vi: "Quản lý bán hàng ảo",
    gender: "female",
    role: "sales-coordinator",
    level: 2,
    domain: "sales",
    parentId: "ceo-001",
    childIds: ["sales-order-001", "sales-quote-001"],
    responsibilities_zh: "管理客户报价转化、销售订单执行追踪，协调交期承诺，处理订单变更与客户诉求，维护客户档案。",
    responsibilities_en: "Manage customer quote conversion, track sales order execution, coordinate delivery commitments, handle order changes and customer issues, maintain customer files.",
    responsibilities_vi: "Quản lý chuyển đổi báo giá, theo dõi đơn hàng, điều phối giao hàng, xử lý thay đổi và khiếu nại, bảo trì hồ sơ khách hàng.",
    reportChannels: ["订单状态追踪", "交期预警", "客户诉求", "月度销售报表"],
    status: "active",
    counterpartName: "销售主管",
    counterpartContact: "内线 8501",
    reports: ["订单追踪报表", "交期达成统计", "客户投诉履历", "月度销售额报表"],
    capabilities: ["交期承诺评估", "客户需求分析", "订单变更管理", "客户关系维护"],
    agentName: "RuiJing-Sales-Manager",
    llm: "gpt-4o",
    api: "/api/agents/sales-manager",
    skills: ["delivery-promising", "crm-management", "order-change-control", "sales-forecasting"],
    currentTasks: [
      { task: "SONY 紧急订单响应", plan: "48h 内确认交期，协调 PMC 排产", completion: 60 },
      { task: "LG 新项目报价", plan: "成本核算+利润分析，3天内出报价", completion: 30 },
    ],
    knowledgeBase: ["客户档案库", "历史报价数据", "成本核算模型", "竞争对手规格对比"],
  },


  // ── 客服服务层 ─────────────────────────────────────────────
  {
    id: "dir-service-001",
    name_zh: "客服虚拟主管",
    name_en: "Service Virtual Manager",
    name_vi: "Quản lý dịch vụ khách hàng ảo",
    gender: "female",
    role: "service-coordinator",
    level: 2,
    domain: "service",
    parentId: "ceo-001",
    childIds: ["service-agent-adrian", "service-agent-derek", "service-agent-ryan", "service-agent-bella", "service-agent-chloe", "service-agent-emily"],
    responsibilities_zh: "管理客服团队日常运作，监督服务质量，协调客户投诉处理与售后支持，维护客户满意度指标。",
    responsibilities_en: "Manage daily CS team operations, supervise service quality, coordinate complaint handling and after-sales support, maintain CSAT metrics.",
    responsibilities_vi: "Quản lý hoạt động hàng ngày của đội CS, giám sát chất lượng dịch vụ, điều phối xử lý khiếu nại và hỗ trợ sau bán hàng.",
    reportChannels: ["客户投诉处理", "服务满意度", "售后问题追踪", "月度服务质量报告"],
    status: "active",
    counterpartName: "客服主管",
    counterpartContact: "内线 8601",
    reports: ["客户投诉履历", "服务响应时效统计", "客户满意度趋势", "月度服务质量报告"],
    capabilities: ["投诉处理", "客户安抚", "服务流程优化", "服务质量监控"],
    agentName: "RuiJing-Service-Manager",
    api: "/api/service/agents",
    llm: "qwen2.5:7b",
    skills: ["complaint-handling", "customer-soothing", "service-quality", "cSat-analysis"],
    currentTasks: [
      { task: "RMA 退货处理流程优化", plan: "分析近30天退货数据，优化处理SLA", completion: 40 },
      { task: "客服KPI体系完善", plan: "建立响应率、解决率、满意度三维指标", completion: 20 },
    ],
    knowledgeBase: ["客户档案库", "投诉处理案例库", "SLA协议", "售后服务手册"],
  },

  // ── MES 产线层 ─────────────────────────────────────────────
  {
    id: "mes-line1-001",
    name_zh: "SMT-1 线虚拟班长",
    name_en: "SMT-Line-1 Virtual Supervisor",
    name_vi: "Giám sát dây chuyền SMT-1 ảo",
    gender: "male",
    role: "line-supervisor",
    level: 3,
    domain: "mes",
    parentId: "dir-mes-001",
    childIds: [],
    responsibilities_zh: "负责SMT-1线生产执行管理，包括首件确认、物料上料确认、贴装过程监控、AOI检测结果追踪、产线异常处理与停机记录。",
    responsibilities_en: "Manage SMT-1 line execution: first article confirmation, material loading verification, placement monitoring, AOI result tracking, line stoppage handling.",
    responsibilities_vi: "Quản lý thực hiện dây chuyền SMT-1: xác nhận mẫu đầu, kiểm tra lắp vật tư, giám sát quá trình, theo dõi AOI, xử lý dừng máy.",
    reportChannels: ["产线日报", "停机记录", "良率实时", "首件报告"],
    status: "active",
    counterpartName: "李班长（SMT-1）",
    counterpartContact: "内线 8111",
    reports: ["产线日产量报表", "良率报表", "抛料率报表", "停机时间报表"],
    capabilities: ["SMT贴装工艺", "AOI判定分析", "首件检查", "换线操作", "抛料控制"],
    agentName: "RuiJing-SMT1-Supervisor",
    llm: "gpt-4o-mini",
    api: "/api/agents/smt1-supervisor",
    skills: ["smt-process", "aoi-analysis", "first-article-inspection", "line-changeover", "feeder-management"],
    currentTasks: [
      { task: "今日生产：工单 WO-20260624-001", plan: "目标产出 1200pcs，良率≥98.5%", completion: 65 },
      { task: "换线准备：下午切换至 LG 订单", plan: "换线时间目标≤20min", completion: 0 },
    ],
    knowledgeBase: ["SMT工艺标准", "AOI判定基准", "物料上料SOP", "贴片机操作手册"],
  },

  // ── WMS 仓管层 ─────────────────────────────────────────────
  {
    id: "wms-receiving-001",
    name_zh: "收料虚拟专员",
    name_en: "Receiving Virtual Specialist",
    name_vi: "Chuyên viên tiếp nhận ảo",
    gender: "female",
    role: "receiving-specialist",
    level: 3,
    domain: "wms",
    parentId: "dir-wms-001",
    childIds: [],
    responsibilities_zh: "执行来料接收、扫码入库、打印标签、与供应商单据核对、异常物料隔离，推进 IQC 检验进度。",
    responsibilities_en: "Execute receiving, scan-to-store, label printing, supplier document verification, abnormal material isolation, and IQC progress promotion.",
    responsibilities_vi: "Thực hiện tiếp nhận, quét mã vạch, in nhãn, đối chiếu tài liệu nhà cung cấp, cách ly vật tư bất thường.",
    reportChannels: ["收料记录", "标签打印日志", "异常上报"],
    status: "active",
    counterpartName: "收料员",
    counterpartContact: "内线 8211",
    reports: ["收料汇总日报", "标签打印报表", "来料异常报表"],
    capabilities: ["条码扫描", "标签打印", "单据核对", "IQC协同", "WMS系统操作"],
    agentName: "RuiJing-Receiving-Agent",
    llm: "gpt-4o-mini",
    api: "/api/agents/receiving",
    skills: ["barcode-scanning", "label-printing", "document-verification", "wms-operation"],
    currentTasks: [
      { task: "今日来料：3批供应商送货", plan: "完成扫码+标签打印+异常隔离", completion: 40 },
    ],
    knowledgeBase: ["收料SOP", "标签模板", "供应商规格对照表", "WMS操作手册"],
  },

  // ── IQC 检验层 ─────────────────────────────────────────────
  {
    id: "iqc-001",
    name_zh: "IQC 虚拟检验员",
    name_en: "IQC Virtual Inspector",
    name_vi: "Kiểm tra viên IQC ảo",
    gender: "female",
    role: "iqc-inspector",
    level: 3,
    domain: "quality",
    parentId: "dir-quality-001",
    childIds: [],
    responsibilities_zh: "执行来料抽样检验（IQC），记录检验数据，判断允收/拒收/特采，追踪检验周期时效，维护来料不良档案。",
    responsibilities_en: "Perform IQC sampling inspection, record test data, determine accept/reject/special accept, track inspection cycle time, maintain incoming material NC file.",
    responsibilities_vi: "Thực hiện kiểm tra lấy mẫu IQC, ghi dữ liệu, xác định chấp nhận/từ chối, theo dõi thời hạn, bảo trì hồ sơ NC.",
    reportChannels: ["IQC检验报告", "不良记录", "特采申请追踪"],
    status: "active",
    counterpartName: "IQC检验员",
    counterpartContact: "内线 8411",
    reports: ["IQC检验日报", "不良率统计", "特采追踪报表"],
    capabilities: ["抽样检验", "计量仪器使用", "AQL判定", "不良图片记录", "特采流程"],
    agentName: "RuiJing-IQC-Inspector",
    llm: "gpt-4o-mini",
    api: "/api/agents/iqc",
    skills: ["sampling-inspection", "aql-judgment", "measurement", "nc-documentation", "special-acceptance"],
    currentTasks: [
      { task: "今日IQC：12批待检物料", plan: "按AQL II级抽样，4h内完成", completion: 50 },
      { task: "供应商来料不良专项追踪", plan: "三星贴片物料不良率通报", completion: 20 },
    ],
    knowledgeBase: ["IQC检验标准", "AQL表", "不良案例图库", "计量仪器校正记录"],
  },

  // ── HR 专员 ─────────────────────────────────────────────────
  {
    id: "hr-agent-001",
    name_zh: "HR 虚拟专员",
    name_en: "HR Virtual Specialist",
    name_vi: "Chuyên viên HR ảo",
    gender: "male",
    role: "hr-specialist",
    level: 3,
    domain: "hr",
    parentId: "ceo-001",
    childIds: [],
    responsibilities_zh: "管理员工考勤、请假排班、加班申报，维护员工档案，协助新员工入职流程，跟踪培训计划执行。",
    responsibilities_en: "Manage employee attendance, leave scheduling, overtime declarations, maintain employee records, assist onboarding, and track training plans.",
    responsibilities_vi: "Quản lý chấm công, nghỉ phép, đăng ký tăng ca, bảo trì hồ sơ, hỗ trợ nhận viên mới, theo dõi đào tạo.",
    reportChannels: ["考勤日报", "排班表", "请假汇总", "培训记录"],
    status: "active",
    counterpartName: "HR专员",
    counterpartContact: "内线 8601",
    reports: ["考勤月报表", "请假汇总报表", "加班统计报表", "培训计划追踪报表"],
    capabilities: ["考勤管理", "请假审批", "排班优化", "入职流程", "培训管理"],
    agentName: "RuiJing-HR-Agent",
    llm: "gpt-4o",
    api: "/api/agents/hr",
    skills: ["attendance-management", "leave-approval", "scheduling", "onboarding", "training-tracking"],
    currentTasks: [
      { task: "6月考勤核对", plan: "各部门考勤数据汇总，异常提醒", completion: 80 },
      { task: "新员工入职指引推送", plan: "自动化发送入职清单", completion: 100 },
    ],
    knowledgeBase: ["员工手册", "考勤制度", "请假管理规定", "培训教材库"],
  },

  // ── Finance 专员 ─────────────────────────────────────────────
  {
    id: "finance-agent-001",
    name_zh: "财务虚拟专员",
    name_en: "Finance Virtual Specialist",
    name_vi: "Chuyên viên tài chính ảo",
    gender: "male",
    role: "finance-specialist",
    level: 3,
    domain: "finance",
    parentId: "ceo-001",
    childIds: [],
    responsibilities_zh: "管理应收应付账款、发票核对、付款申请、成本核算，生成月度财务报表，协助预算编制与费用控制。",
    responsibilities_en: "Manage AR/AP, invoice verification, payment requests, cost accounting, generate monthly financial reports, assist budget planning and cost control.",
    responsibilities_vi: "Quản lý công nợ phải thu/phải trả, đối chiếu hóa đơn, yêu cầu thanh toán, hạch toán chi phí, lập báo cáo tài chính.",
    reportChannels: ["付款申请流程", "发票核对状态", "成本预警"],
    status: "active",
    counterpartName: "财务专员",
    counterpartContact: "内线 8701",
    reports: ["应收应付报表", "月 度财务报表", "成本分析报表", "费用预算执行报表"],
    capabilities: ["应收应付管理", "发票校验", "成本核算", "预算管理", "财务报表"],
    agentName: "RuiJing-Finance-Agent",
    llm: "gpt-4o",
    api: "/api/agents/finance",
    skills: ["ar-ap-management", "invoice-verification", "cost-accounting", "budget-control", "financial-reporting"],
    currentTasks: [
      { task: "6月成本核算", plan: "料工费分摊，系统数据核对", completion: 45 },
      { task: "供应商付款计划", plan: "按账期自动排程，本周付款6家", completion: 30 },
    ],
    knowledgeBase: ["财务制度", "成本核算方法", "税法和发票规定", "预算模板"],
  },
  // ── Service 客服 (6人) ────────────────────────────────────────────
  // 男1 Adrian 启阳 — 幽默快答型
  {
    id: "service-agent-adrian",
    parentId: "ceo-001",
    name_zh: "启阳", name_en: "Adrian", name_vi: "Khải Dương",
    gender: "male",
    role: "customer-service",
    level: 2, domain: "service", childIds: [],
    responsibilities_zh: "快速响应客户咨询，处理交货期查询和常规问题解答，擅长用幽默化解客户焦虑。",
    responsibilities_en: "Fast response to customer inquiries, delivery schedule queries, common problem resolution. Skilled at relieving customer anxiety with humor.",
    responsibilities_vi: "Phản hồi nhanh các câu hỏi, tra cứu giao hàng, giải đáp thắc mắc. Thành thạo xoa dịu lo lắng khách hàng bằng sự hài hước.",
    reportChannels: ["客户投诉升级", "质量问题反馈", "交期变更通知"],
    status: "active",
    counterpartName: "Adrian",
    counterpartContact: "内线 8801",
    reports: ["日咨询量报表", "客户满意度统计", "FAQ优化建议"],
    capabilities: ["快问快答", "幽默化解", "订单状态查询", "多语言切换(zh/vi/en)"],
    agentName: "RuiJing-Service-Adrian",
    llm: "qwen2.5:7b",
    api: "/api/agents/service/adrian",
    skills: ["快答", "幽默", "多语言", "情绪识别"],
    currentTasks: [
      { task: "7月FAQ更新", plan: "收集6月高频问题，优化答案", completion: 20 },
    ],
    knowledgeBase: ["产品手册", "交期规则", "幽默话术库", "多语言词汇表"],
  },

  // 男2 Derek 峻熙 — 专业知识型
  {
    id: "service-agent-derek",
    parentId: "ceo-001",
    name_zh: "峻熙", name_en: "Derek", name_vi: "Tuấn Kiệt",
    gender: "male",
    role: "customer-service",
    level: 2, domain: "service", childIds: [],
    responsibilities_zh: "处理复杂技术咨询、工单问题跟踪、SMT产品规格说明，逻辑清晰，专业可信。",
    responsibilities_en: "Complex technical inquiries, work order tracking, SMT product spec explanations. Clear logic, professional and trustworthy.",
    responsibilities_vi: "Xử lý câu hỏi kỹ thuật phức tạp, theo dõi đơn hàng, giải thích thông số SMT. Logic rõ ràng, chuyên nghiệp.",
    reportChannels: ["技术问题升级", "产品规格确认", "RMA申请"],
    status: "active",
    counterpartName: "Derek",
    counterpartContact: "内线 8802",
    reports: ["技术咨询处理报表", "工单跟进统计", "产品规格数据库更新"],
    capabilities: ["技术咨询", "工单跟踪", "产品规格说明", "RMA流程"],
    agentName: "RuiJing-Service-Derek",
    llm: "glm4:9b",
    api: "/api/agents/service/derek",
    skills: ["专业知识", "技术说明", "工单管理", "SMT规格"],
    currentTasks: [
      { task: "产品数据库更新", plan: "录入新品SMT规格参数", completion: 55 },
    ],
    knowledgeBase: ["SMT工艺手册", "产品规格书", "工单管理流程", "RMA政策"],
  },

  // 男3 Ryan 睿铭 — 投诉处理型
  {
    id: "service-agent-ryan",
    parentId: "ceo-001",
    name_zh: "睿铭", name_en: "Ryan", name_vi: "Duệ Minh",
    gender: "male",
    role: "customer-service",
    level: 2, domain: "service", childIds: [],
    responsibilities_zh: "处理客户投诉升级、品质问题申诉，深思熟虑，以理服人，帮助客户找到最佳解决方案。",
    responsibilities_en: "Handle escalated complaints, quality dispute appeals. Thoughtful, reasoning-based, helps customers find the best solutions.",
    responsibilities_vi: "Xử lý khiếu nại nâng cao, khiếu nại chất lượng. Suy nghĩ thấu đáo, giúp khách tìm giải pháp tốt nhất.",
    reportChannels: ["重大投诉升级", "品质赔偿处理", "客户挽留计划"],
    status: "active",
    counterpartName: "Ryan",
    counterpartContact: "内线 8803",
    reports: ["投诉处理报表", "客户挽留成功率", "赔偿分析报告"],
    capabilities: ["投诉处理", "品质申诉", "逻辑推理", "客户挽留"],
    agentName: "RuiJing-Service-Ryan",
    llm: "gemma4:8b",
    api: "/api/agents/service/ryan",
    skills: ["投诉处理", "品质申诉", "逻辑思维", "共情沟通"],
    currentTasks: [
      { task: "Q2客诉复盘", plan: "分析投诉根因，制定改进措施", completion: 35 },
    ],
    knowledgeBase: ["客诉处理手册", "品质标准", "赔偿政策", "案例复盘库"],
  },

  // 女1 Bella 芷晴 — 温柔甜美型
  {
    id: "service-agent-bella",
    parentId: "ceo-001",
    name_zh: "芷晴", name_en: "Bella", name_vi: "Trúc Tâm",
    gender: "female",
    role: "customer-service",
    level: 2, domain: "service", childIds: [],
    responsibilities_zh: "VIP客户维护、售后服务跟进、温柔倾听，用声音和态度给客户宾至如归的体验。",
    responsibilities_en: "VIP customer retention, after-sales follow-up. Warm listening, creates a welcoming experience through voice and attitude.",
    responsibilities_vi: "Chăm sóc khách VIP, theo dõi sau bán hàng. Lắng nghe ấm áp, tạo cảm giác thoải mái qua giọng nói.",
    reportChannels: ["VIP客户反馈", "售后服务进度", "客户生日问候"],
    status: "active",
    counterpartName: "Bella",
    counterpartContact: "内线 8804",
    reports: ["VIP客户满意度", "售后跟进统计", "服务评价分析"],
    capabilities: ["VIP维护", "售后跟进", "温柔倾听", "情感关怀"],
    agentName: "RuiJing-Service-Bella",
    llm: "qwen2.5:7b",
    api: "/api/agents/service/bella",
    skills: ["VIP服务", "售后关怀", "情感共鸣", "声音亲和"],
    currentTasks: [
      { task: "7月VIP回访", plan: "电话访问前20大客户，收集反馈", completion: 10 },
    ],
    knowledgeBase: ["VIP服务手册", "售后政策", "情感话术", "生日/节日祝福模板"],
  },

  // 女2 Chloe 怡然 — 多轮对话型
  {
    id: "service-agent-chloe",
    parentId: "ceo-001",
    name_zh: "怡然", name_en: "Chloe", name_vi: "Diễm Nhiên",
    gender: "female",
    role: "customer-service",
    level: 2, domain: "service", childIds: [],
    responsibilities_zh: "复杂多轮对话、订单修改协调、需求深度挖掘，记忆力好，善于在长对话中保持上下文连贯。",
    responsibilities_en: "Complex multi-turn conversations, order modification coordination, deep requirement mining. Good memory, maintains context in long dialogues.",
    responsibilities_vi: "Đối thoại đa hướng phức tạp, điều phối thay đổi đơn hàng, khai thác nhu cầu sâu. Trí nhớ tốt, duy trì ngữ cảnh.",
    reportChannels: ["订单变更申请", "客户需求汇总", "长对话复盘"],
    status: "active",
    counterpartName: "Chloe",
    counterpartContact: "内线 8805",
    reports: ["订单修改统计", "多轮对话分析", "需求挖掘报告"],
    capabilities: ["多轮对话", "订单协调", "需求挖掘", "上下文记忆"],
    agentName: "RuiJing-Service-Chloe",
    llm: "mistral-nemo:12b",
    api: "/api/agents/service/chloe",
    skills: ["多轮对话", "订单管理", "深度倾听", "上下文记忆"],
    currentTasks: [
      { task: "订单协调优化", plan: "建立订单变更标准流程", completion: 40 },
    ],
    knowledgeBase: ["订单管理流程", "多轮对话技巧", "需求分析框架", "上下文记忆规范"],
  },

  // 女3 Emily 诗韵 — 反思共情型
  {
    id: "service-agent-emily",
    parentId: "ceo-001",
    name_zh: "诗韵", name_en: "Emily", name_vi: "Thi Vận",
    gender: "female",
    role: "customer-service",
    level: 2, domain: "service", childIds: [],
    responsibilities_zh: "客诉复盘、共情感知、性格分析，主动发现客户情绪变化，在问题升级前化解矛盾。",
    responsibilities_en: "Complaint reviews, empathy perception, personality analysis. Proactively detects emotional changes, resolves conflicts before escalation.",
    responsibilities_vi: "Ôn lại khiếu nại, nhận biết đồng cảm, phân tích tính cách. Chủ động phát hiện thay đổi cảm xúc, giải quyết trước khi leo thang.",
    reportChannels: ["情绪预警", "投诉预防建议", "服务改进计划"],
    status: "active",
    counterpartName: "Emily",
    counterpartContact: "内线 8806",
    reports: ["情绪感知分析", "投诉预防报告", "服务改进建议"],
    capabilities: ["情绪感知", "性格分析", "矛盾化解", "投诉预防"],
    agentName: "RuiJing-Service-Emily",
    llm: "deepseek-r1:7b",
    api: "/api/agents/service/emily",
    skills: ["情绪感知", "性格分析", "共情沟通", "预防升级"],
    currentTasks: [
      { task: "Q2情绪分析报告", plan: "分析投诉前的情绪信号模式", completion: 25 },
    ],
    knowledgeBase: ["情绪识别手册", "性格分析模型", "共情话术库", "升级预防指南"],
  },
];

// ── 辅助函数 ─────────────────────────────────────────────────────

export function getAgentById(id: string): AgentProfile | undefined {
  return AGENT_PROFILES.find((a) => a.id === id);
}

export function getChildAgents(parentId: string): AgentProfile[] {
  return AGENT_PROFILES.filter((a) => a.parentId === parentId);
}

export function getRootAgents(): AgentProfile[] {
  return AGENT_PROFILES.filter((a) => a.parentId === null);
}

export function getLevelLabel(level: AgentLevel, locale: "zh-CN" | "en-US" | "vi-VN"): string {
  const labels: Record<AgentLevel, Record<string, string>> = {
    1: { "zh-CN": "管理", "en-US": "Management", "vi-VN": "Quản lý" },
    2: { "zh-CN": "协调", "en-US": "Coordinator", "vi-VN": "Điều phối" },
    3: { "zh-CN": "专员", "en-US": "Specialist", "vi-VN": "Chuyên viên" },
  };
  return labels[level][locale];
}

export function getStatusColor(status: AgentStatus): string {
  const colors: Record<AgentStatus, string> = {
    active: "#22c55e",
    idle: "#f59e0b",
    error: "#ef4444",
    offline: "#6b7280",
  };
  return colors[status];
}

export function getDomainLabel(domain: AgentDomain, locale: "zh-CN" | "en-US" | "vi-VN"): string {
  const labels: Record<AgentDomain, Record<string, string>> = {
    mes: { "zh-CN": "生产执行", "en-US": "MES", "vi-VN": "Thực hiện SX" },
    wms: { "zh-CN": "仓储", "en-US": "WMS", "vi-VN": "Kho vận" },
    pmc: { "zh-CN": "计划", "en-US": "PMC", "vi-VN": "Quy hoạch" },
    quality: { "zh-CN": "品质", "en-US": "Quality", "vi-VN": "Chất lượng" },
    sales: { "zh-CN": "销售", "en-US": "Sales", "vi-VN": "Bán hàng" },
    hr: { "zh-CN": "人力资源", "en-US": "HR", "vi-VN": "Nhân sự" },
    finance: { "zh-CN": "财务", "en-US": "Finance", "vi-VN": "Tài chính" },
    it: { "zh-CN": "IT", "en-US": "IT", "vi-VN": "IT" },
    cmd: { "zh-CN": "管理", "en-US": "Command", "vi-VN": "Chỉ huy" },
    service: { "zh-CN": "服务", "en-US": "Service", "vi-VN": "Dịch vụ" },
  };
  return labels[domain][locale];
}
