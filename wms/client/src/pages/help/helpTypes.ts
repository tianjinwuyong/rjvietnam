import type { LanguageCode } from '@shared/api.interface';

/**
 * 帮助手册内容模型
 * ------------------------------------------------------------------
 * 为什么单独建模块、不塞进 i18n/locales：
 *   主语言包（zh/vi/en）三份必须**键完全一致**，类型是 `typeof zh`。
 *   手册正文体量极大（数万字），一旦某语言漏一处键，界面就会回退显示
 *   原始键名（如 `help.xxx.yyy`）。因此手册内容独立成模块，
 *   只复用全局 lang 状态，不参与主语言包的键一致性约束。
 *
 * 三语就地书写（T(zh, vi, en) 写在一起）的好处：
 *   改文案时三种语言在同一行，漏译一眼可见；拆成三份文件极易漂移。
 */

export type Tri = Record<LanguageCode, string>;

/** 内容块类型 */
export type HelpBlock =
  /** 段落 */
  | { k: 'p'; v: Tri }
  /** 小节标题（章内二级标题） */
  | { k: 'h3'; v: Tri }
  /** 无序要点列表 */
  | { k: 'ul'; v: Tri[] }
  /** 有序步骤列表 */
  | { k: 'ol'; v: Tri[] }
  /** 提示条：info=说明 / warn=注意禁止 / tip=技巧 */
  | { k: 'note'; tone: 'info' | 'warn' | 'tip'; v: Tri }
  /** 表格：head 为表头，rows 为数据行 */
  | { k: 'table'; head: Tri[]; rows: Tri[][] }
  /** 流程链：横向箭头串联的步骤名（用于“全流程一图”） */
  | { k: 'flow'; v: Tri[] };

export interface HelpChapter {
  /** 锚点 id，同时用于目录跳转 */
  id: string;
  /** 图标名，在页面里映射到 lucide 图标 */
  icon: string;
  /** 目录显示名 */
  title: Tri;
  /** 目录摘要（详情页顶部说明） */
  summary: Tri;
  /** 章内小节，每个小节自带锚点，便于目录树展开 */
  sections: HelpSection[];
}

export interface HelpSection {
  id: string;
  title: Tri;
  blocks: HelpBlock[];
}

// ---------------------------------------------------------------- 构造辅助
// 位置参数顺序固定为 (中文, 越南语, 英语)，与项目语言顺序 zh/vi/en 一致。

/** 三语字符串 */
export const T = (zh: string, vi: string, en: string): Tri => ({ zh, vi, en });

/** 段落 */
export const p = (zh: string, vi: string, en: string): HelpBlock => ({ k: 'p', v: T(zh, vi, en) });

/** 章内小节标题 */
export const h3 = (zh: string, vi: string, en: string): HelpBlock => ({ k: 'h3', v: T(zh, vi, en) });

/** 要点列表：每个参数 = 一条要点 */
export const ul = (...rows: [string, string, string][]): HelpBlock => ({
  k: 'ul',
  v: rows.map((r) => T(r[0], r[1], r[2])),
});

/** 步骤列表：每个参数 = 一步 */
export const ol = (...rows: [string, string, string][]): HelpBlock => ({
  k: 'ol',
  v: rows.map((r) => T(r[0], r[1], r[2])),
});

/** 提示条 */
export const note = (tone: 'info' | 'warn' | 'tip', zh: string, vi: string, en: string): HelpBlock => ({
  k: 'note',
  tone,
  v: T(zh, vi, en),
});

/** 表格：head 三语表头数组，rows 每行三语单元格数组 */
export const table = (head: [string, string, string][], rows: [string, string, string][][]): HelpBlock => ({
  k: 'table',
  head: head.map((r) => T(r[0], r[1], r[2])),
  rows: rows.map((row) => row.map((c) => T(c[0], c[1], c[2]))),
});

/** 流程链 */
export const flow = (...rows: [string, string, string][]): HelpBlock => ({
  k: 'flow',
  v: rows.map((r) => T(r[0], r[1], r[2])),
});

// ---------------------------------------------------------------- 检索辅助

/** 把一章的所有文本摊平，供全文搜索使用（大小写不敏感） */
export function chapterSearchText(ch: HelpChapter): string {
  const parts: string[] = [ch.title.zh, ch.title.vi, ch.title.en, ch.summary.zh, ch.summary.vi, ch.summary.en];
  for (const s of ch.sections) {
    parts.push(s.title.zh, s.title.vi, s.title.en);
    for (const b of s.blocks) {
      switch (b.k) {
        case 'p':
        case 'h3':
        case 'note':
          parts.push(b.v.zh, b.v.vi, b.v.en);
          break;
        case 'ul':
        case 'ol':
        case 'flow':
          for (const it of b.v) parts.push(it.zh, it.vi, it.en);
          break;
        case 'table':
          for (const c of b.head) parts.push(c.zh, c.vi, c.en);
          for (const row of b.rows) for (const c of row) parts.push(c.zh, c.vi, c.en);
          break;
      }
    }
  }
  return parts.join(' \u0001 ').toLowerCase();
}
