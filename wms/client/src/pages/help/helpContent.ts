import type { HelpChapter } from './helpTypes';
import { basicsChapters } from './chaptersBasics';
import { qcChapters } from './chaptersQc';
import { stockChapters } from './chaptersStock';
import { productionChapters } from './chaptersProduction';
import { qualityChapters } from './chaptersQuality';

/**
 * 全部帮助章节，顺序即目录顺序。
 * 章节内容按业务链路排列：先认识系统 → 基础数据 → 收料/IQC → 库存/盘点
 * → 工单/生产/发料/BOM → MRB/系统设置/PDA → 速查附录。
 */
export const HELP_CHAPTERS: HelpChapter[] = [
  ...basicsChapters,
  ...qcChapters,
  ...stockChapters,
  ...productionChapters,
  ...qualityChapters,
];

export { chapterSearchText } from './helpTypes';
export type { HelpChapter, HelpSection, HelpBlock, Tri } from './helpTypes';
