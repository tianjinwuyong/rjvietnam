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
  // 体系文件（原版 /docs 组首页 + 三个独立台账入口页；
  // /doc-ledger、/docs/new 原版不在侧边栏，由文档库页内按钮进入）
  | "docs"
  | "docNew"
  | "docLedger"
  | "docIssueRecord"
  | "docObsolete"
  | "docExternal";

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
  // 原版 single:"/drive"、single:"/knowledge"：组头即链接，无子项
  { titleKey: "menu.drive", items: [] },
  { titleKey: "menu.knowledge", items: [] },
  {
    titleKey: "menu.qualityMgr",
    items: [],
    sections: [
      { titleKey: "menu.iqcGroup", items: [{ titleKey: "menu.iqcInspect" }] },
      { titleKey: "menu.mrbGroup", items: [{ titleKey: "menu.mrbReview" }] },
      {
        titleKey: "menu.qcIpqc",
        items: [
          { titleKey: "ipqcMod.fillTitle" },
          { titleKey: "ipqcMod.recordsTitle" },
          { titleKey: "faiMod.fillTitle" },
          { titleKey: "faiMod.recordsTitle" },
          { titleKey: "inspectRt.fillTitle" },
          { titleKey: "inspectRt.recordsTitle" },
        ],
      },
      { titleKey: "menu.qcOqc", items: [{ titleKey: "menu.oqcInspect" }] },
      {
        titleKey: "menu.qualityTemplates",
        items: [
          { titleKey: "menu.modelIqc", adminOnly: true },
          { titleKey: "menu.modelIpqc", adminOnly: true },
          { titleKey: "menu.modelOqc", adminOnly: true },
          { titleKey: "menu.modelFai", adminOnly: true },
          { titleKey: "menu.modelInspect", adminOnly: true },
        ],
      },
    ],
  },
  {
    titleKey: "menu.equipmentMgr",
    items: [
      { titleKey: "menu.equipment" },
      { titleKey: "menu.equipStocktake" },
      { titleKey: "menu.equipTasks" },
      { titleKey: "menu.equipCalib" },
      { titleKey: "menu.equipAlerts" },
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
          { titleKey: "menu.orgImport" },
        ],
      },
      {
        titleKey: "menu.hrAttendance",
        items: [
          { titleKey: "menu.attendance" },
          { titleKey: "menu.cardRule" },
          { titleKey: "menu.workCalendar" },
          { titleKey: "menu.schedule" },
        ],
      },
      {
        titleKey: "menu.hrSalary",
        items: [
          { titleKey: "menu.salary" },
          { titleKey: "menu.salaryTemplate" },
          { titleKey: "menu.perfFlow" },
        ],
      },
      {
        titleKey: "menu.hrTraining",
        items: [
          { titleKey: "menu.training" },
          { titleKey: "exam.myExams" },
          { titleKey: "menu.handover" },
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
          { titleKey: "menu.meetingList" },
          { titleKey: "menu.meetingCreate" },
          { titleKey: "menu.meetingSeries" },
          { titleKey: "menu.meetingActions" },
          { titleKey: "menu.meetingMinutes" },
        ],
      },
    ],
  },
  {
    titleKey: "menu.sysMgr",
    items: [
      { titleKey: "menu.ledger" },
      { titleKey: "menu.flowVersions" },
      { titleKey: "customField.manageTitle" },
      { titleKey: "menu.flowDesign", adminOnly: true },
      { titleKey: "menu.system", adminOnly: true },
    ],
  },
];

/** 菜单文案：词典键 → 当前语言文本 */
export function menuText(key: string, locale: Locale): string {
  return t(key, locale) === key ? key : t(key, locale);
}
