import { t } from "./i18n";
import type { Locale } from "../../../../packages/shared-types/src/factory";

/**
 * OA 二级侧边栏菜单 —— 结构逐项对齐原版 BasicLayout 的菜单数组
 * （D:\rj\repos\OA-full-extracted\OA\app\web\dist\assets\BasicLayout-BfNiJr1b.js）。
 * 分组 / 小节 / 菜单文案全部复用原版 menu.* 词典键；
 * 未实现的叶子点击显示「建设中」（wip.title）。
 *
 * 原版 workbench 组只挂「首页」单链接（todo/mine/cc/done 由工作台页内跳转），
 * 原生版把已实现的流程视图直接挂进 workbench 组，便于侧边栏直达。
 * 原版 /announcements 不在侧边栏（面包屑 menu.announcements），原生版同样挂 workbench 组。
 */

export interface OaMenuItem {
  /** 菜单文案词典键 */
  titleKey: string;
  /** 已实现的视图 id；undefined = 建设中 */
  view?: OaViewId;
  /** 发起申请快捷入口（hrDocs 组的 flowDef.* 项）：进入发起页并自动选中该流程 */
  flowCode?: string;
  /** 仅管理员可见（原版 admin:!0 的项） */
  adminOnly?: boolean;
}

export interface OaMenuSection {
  /** 小节标题词典键（原版 sections[].title） */
  titleKey: string;
  items: OaMenuItem[];
}

export interface OaMenuGroup {
  /** 组标题词典键（原版 group） */
  titleKey: string;
  items: OaMenuItem[];
  /** 原版 sections 结构（品质/人事组） */
  sections?: OaMenuSection[];
  /** 组头即入口（原版 /docs 组首页：组头链接到文档库） */
  homeView?: OaViewId;
}

export type OaViewId =
  | "overview"
  | "start"
  | "todo"
  | "mine"
  | "done"
  | "cc"
  | "notifications"
  | "announcements"
  | "org"
  | "orgImport"
  // 体系文件（原版 /docs 组首页 + 三个独立台账入口页；
  // /doc-ledger、/docs/new 原版不在侧边栏，由文档库页内按钮进入）
  | "docs"
  | "docNew"
  | "docLedger"
  | "docIssueRecord"
  | "docObsolete"
  | "docExternal"
  // 公共盘（原版 single:"/drive"：组头即链接）
  | "drive"
  // 知识共享（原版 single:"/knowledge"：组头即链接）
  | "knowledge"
  // 设备管理组（5 页）
  | "equipment"
  | "equipStocktake"
  | "equipTasks"
  | "equipCalib"
  | "equipAlerts"
  // 系统管理组（流程设计/系统设置暂留建设中）
  | "ledger"
  | "flowVersions"
  | "flowDesign"
  | "customField"
  // 人事管理组（组织导入/发起会议暂留建设中）
  | "attendance"
  | "cardRule"
  | "workCalendar"
  | "schedule"
  | "salary"
  | "salaryTemplate"
  | "perfFlow"
  | "training"
  | "myExams"
  | "handover"
  | "meetingCreate"
  | "meetingList"
  | "meetingSeries"
  | "meetingActions"
  | "meetingMinutes"
  // 品质管理组（全部实现）
  | "iqcInspect"
  | "mrbReview"
  | "ipqcFill"
  | "ipqcRecords"
  | "faiFill"
  | "faiRecords"
  | "inspectFill"
  | "inspectRecords"
  | "inspectRecords"
  | "oqcInspect"
  | "qcTemplates"
  // 系统设置（个人设置）
  | "settings";

export const OA_MENU: OaMenuGroup[] = [
  {
    titleKey: "menu.workbench",
    items: [
      { titleKey: "menu.home", view: "overview" },
      { titleKey: "menu.startFlow", view: "start" },
      { titleKey: "menu.todo", view: "todo" },
      { titleKey: "menu.mine", view: "mine" },
      { titleKey: "menu.done", view: "done" },
      { titleKey: "menu.cc", view: "cc" },
      { titleKey: "layout.notify", view: "notifications" },
      { titleKey: "menu.announcements", view: "announcements" },
    ],
  },
  {
    titleKey: "menu.docSystem",
    homeView: "docs",
    // 原版 hidden: /doc-ledger、/docs/new（由文档库页内「新建文件」「台账」按钮进入）；
    // /docs 是组首页（组头即入口），不重复列为菜单项
    items: [
      { titleKey: "menu.docIssueRecord", view: "docIssueRecord" },
      { titleKey: "menu.docObsolete", view: "docObsolete" },
      { titleKey: "menu.docExternal", view: "docExternal" },
    ],
  },
  // 原版 single:"/drive"、single:"/knowledge"：组头即链接（均已原生实现）
  { titleKey: "menu.drive", items: [], homeView: "drive" },
  { titleKey: "menu.knowledge", items: [], homeView: "knowledge" },
  {
    titleKey: "menu.qualityMgr",
    items: [],
    sections: [
      { titleKey: "menu.iqcGroup", items: [{ titleKey: "menu.iqcInspect", view: "iqcInspect" }] },
      { titleKey: "menu.mrbGroup", items: [{ titleKey: "menu.mrbReview", view: "mrbReview" }] },
      {
        titleKey: "menu.qcIpqc",
        items: [
          { titleKey: "ipqcMod.fillTitle", view: "ipqcFill" },
          { titleKey: "ipqcMod.recordsTitle", view: "ipqcRecords" },
          { titleKey: "faiMod.fillTitle", view: "faiFill" },
          { titleKey: "faiMod.recordsTitle", view: "faiRecords" },
          { titleKey: "inspectRt.fillTitle", view: "inspectFill" },
          { titleKey: "inspectRt.recordsTitle", view: "inspectRecords" },
        ],
      },
      { titleKey: "menu.qcOqc", items: [{ titleKey: "menu.oqcInspect", view: "oqcInspect" }] },
      {
        titleKey: "menu.qualityTemplates",
        items: [
          { titleKey: "menu.modelIqc", adminOnly: true, view: "qcTemplates" },
          { titleKey: "menu.modelIpqc", adminOnly: true, view: "qcTemplates" },
          { titleKey: "menu.modelOqc", adminOnly: true, view: "qcTemplates" },
          { titleKey: "menu.modelFai", adminOnly: true, view: "qcTemplates" },
          { titleKey: "menu.modelInspect", adminOnly: true, view: "qcTemplates" },
        ],
      },
    ],
  },
  {
    titleKey: "menu.equipmentMgr",
    items: [
      { titleKey: "menu.equipment", view: "equipment" },
      { titleKey: "menu.equipStocktake", view: "equipStocktake" },
      { titleKey: "menu.equipTasks", view: "equipTasks" },
      { titleKey: "menu.equipCalib", view: "equipCalib" },
      { titleKey: "menu.equipAlerts", view: "equipAlerts" },
    ],
  },
  {
    titleKey: "menu.hr",
    items: [],
    sections: [
      {
        titleKey: "menu.hrOrg",
        items: [
          // 原版 perm:org:manage；原生只读版对全员开放（只读无风险）
          { titleKey: "menu.org", view: "org" },
          { titleKey: "menu.orgImport", view: "orgImport" },
        ],
      },
      {
        titleKey: "menu.hrAttendance",
        items: [
          { titleKey: "menu.attendance", view: "attendance" },
          { titleKey: "menu.cardRule", view: "cardRule" },
          { titleKey: "menu.workCalendar", view: "workCalendar" },
          { titleKey: "menu.schedule", view: "schedule" },
        ],
      },
      {
        titleKey: "menu.hrSalary",
        items: [
          { titleKey: "menu.salary", view: "salary" },
          { titleKey: "menu.salaryTemplate", view: "salaryTemplate" },
          { titleKey: "menu.perfFlow", view: "perfFlow" },
        ],
      },
      {
        titleKey: "menu.hrTraining",
        items: [
          { titleKey: "menu.training", view: "training" },
          { titleKey: "exam.myExams", view: "myExams" },
          { titleKey: "menu.handover", view: "handover" },
        ],
      },
      {
        titleKey: "menu.hrDocs",
        items: [
          { titleKey: "flowDef.leave", view: "start", flowCode: "leave" },
          { titleKey: "flowDef.miss_card", view: "start", flowCode: "miss_card" },
          { titleKey: "flowDef.comp_day", view: "start", flowCode: "comp_day" },
          { titleKey: "flowDef.headcount", view: "start", flowCode: "headcount" },
        ],
      },
      {
        titleKey: "menu.hrMeeting",
        items: [
          { titleKey: "menu.meetingList", view: "meetingList" },
          { titleKey: "menu.meetingCreate", view: "meetingCreate" },
          { titleKey: "menu.meetingSeries", view: "meetingSeries" },
          { titleKey: "menu.meetingActions", view: "meetingActions" },
          { titleKey: "menu.meetingMinutes", view: "meetingMinutes" },
        ],
      },
    ],
  },
  {
    titleKey: "menu.sysMgr",
    items: [
      { titleKey: "menu.ledger", view: "ledger" },
      { titleKey: "menu.flowVersions", view: "flowVersions" },
      { titleKey: "customField.manageTitle", view: "customField" },
      { titleKey: "menu.flowDesign", adminOnly: true, view: "flowDesign" },
      { titleKey: "menu.system", adminOnly: true, view: "settings" },
    ],
  },
];

/** 菜单文案：词典键 → 当前语言文本 */
export function menuText(key: string, locale: Locale): string {
  return t(key, locale) === key ? key : t(key, locale);
}
