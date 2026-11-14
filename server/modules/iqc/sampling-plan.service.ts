import { Injectable, BadRequestException } from '@nestjs/common';
import type { SamplingPlanResult } from '@shared/api.interface';

// ============================================================
// GB/T 2828.1-2012 计数抽样检验
// 表1: 样本量字码
// ============================================================

export type InspectionLevel = 'S-1' | 'S-2' | 'S-3' | 'S-4' | 'I' | 'II' | 'III';
export type StrictnessLevel = 'normal' | 'tightened' | 'reduced';

const INSPECTION_LEVELS: InspectionLevel[] = ['S-1', 'S-2', 'S-3', 'S-4', 'I', 'II', 'III'];

interface BatchRange {
  min: number;
  max: number;
  letters: Record<InspectionLevel, string>;
}

/** 表1 批量范围 × 检验水平 → 字码 */
const BATCH_RANGES: BatchRange[] = [
  { min: 2,      max: 8,        letters: { 'S-1': 'A', 'S-2': 'A', 'S-3': 'A', 'S-4': 'A', I: 'A', II: 'A', III: 'B' } },
  { min: 9,      max: 15,       letters: { 'S-1': 'A', 'S-2': 'A', 'S-3': 'A', 'S-4': 'A', I: 'A', II: 'B', III: 'C' } },
  { min: 16,     max: 25,       letters: { 'S-1': 'A', 'S-2': 'A', 'S-3': 'B', 'S-4': 'B', I: 'B', II: 'C', III: 'D' } },
  { min: 26,     max: 50,       letters: { 'S-1': 'A', 'S-2': 'B', 'S-3': 'B', 'S-4': 'C', I: 'C', II: 'D', III: 'E' } },
  { min: 51,     max: 90,       letters: { 'S-1': 'B', 'S-2': 'B', 'S-3': 'C', 'S-4': 'C', I: 'C', II: 'E', III: 'F' } },
  { min: 91,     max: 150,      letters: { 'S-1': 'B', 'S-2': 'B', 'S-3': 'C', 'S-4': 'D', I: 'D', II: 'F', III: 'G' } },
  { min: 151,    max: 280,      letters: { 'S-1': 'B', 'S-2': 'C', 'S-3': 'D', 'S-4': 'E', I: 'E', II: 'G', III: 'H' } },
  { min: 281,    max: 500,      letters: { 'S-1': 'B', 'S-2': 'C', 'S-3': 'D', 'S-4': 'E', I: 'F', II: 'H', III: 'J' } },
  { min: 501,    max: 1200,     letters: { 'S-1': 'C', 'S-2': 'C', 'S-3': 'E', 'S-4': 'F', I: 'G', II: 'J', III: 'K' } },
  { min: 1201,   max: 3200,     letters: { 'S-1': 'C', 'S-2': 'D', 'S-3': 'E', 'S-4': 'G', I: 'H', II: 'K', III: 'L' } },
  { min: 3201,   max: 10000,    letters: { 'S-1': 'C', 'S-2': 'D', 'S-3': 'F', 'S-4': 'G', I: 'J', II: 'L', III: 'M' } },
  { min: 10001,  max: 35000,    letters: { 'S-1': 'C', 'S-2': 'D', 'S-3': 'F', 'S-4': 'H', I: 'K', II: 'M', III: 'N' } },
  { min: 35001,  max: 150000,   letters: { 'S-1': 'D', 'S-2': 'E', 'S-3': 'G', 'S-4': 'J', I: 'L', II: 'N', III: 'P' } },
  { min: 150001, max: 500000,   letters: { 'S-1': 'D', 'S-2': 'E', 'S-3': 'G', 'S-4': 'J', I: 'M', II: 'P', III: 'Q' } },
  { min: 500001, max: Infinity, letters: { 'S-1': 'D', 'S-2': 'E', 'S-3': 'H', 'S-4': 'K', I: 'N', II: 'Q', III: 'R' } },
];

/** 正常检验样本量字码对应样本量 */
const NORMAL_SAMPLE_SIZE: Record<string, number> = {
  A: 2, B: 3, C: 5, D: 8, E: 13, F: 20, G: 32,
  H: 50, J: 80, K: 125, L: 200, M: 315, N: 500,
  P: 800, Q: 1250, R: 2000,
};

/** 加严检验样本量字码对应样本量（与正常相同，多一个S=3150） */
const TIGHTENED_SAMPLE_SIZE: Record<string, number> = {
  ...NORMAL_SAMPLE_SIZE, S: 3150,
};

/** 放宽检验样本量字码对应样本量（减少） */
const REDUCED_SAMPLE_SIZE: Record<string, number> = {
  A: 2, B: 2, C: 2, D: 3, E: 5, F: 8, G: 13,
  H: 20, J: 32, K: 50, L: 80, M: 125, N: 200,
  P: 315, Q: 500, R: 800,
};

/** AQL列（从左到右） */
const AQL_COLUMNS = [
  '0.010', '0.015', '0.025', '0.040', '0.065', '0.10', '0.15', '0.25',
  '0.40', '0.65', '1.0', '1.5', '2.5', '4.0', '6.5', '10',
  '15', '25', '40', '65', '100', '150', '250', '400', '650', '1000',
];

/**
 * 单元格值: [Ac, Re] 或 '↓' 或 '↑'
 * 键为字码
 */
type CellValue = [number, number] | '↓' | '↑';

// ============================================================
// 表2-A 正常检验一次抽样方案
// AQL列: 0.010,0.015,0.025,0.040,0.065,0.10,0.15,0.25,0.40,0.65,1.0,1.5,2.5,4.0,6.5,10,15,25,40,65,100,150,250,400,650,1000
// ============================================================

const NORMAL_TABLE: Record<string, CellValue[]> = {
  //                    0.010 0.015 0.025 0.040 0.065 0.10  0.15  0.25  0.40  0.65  1.0   1.5   2.5   4.0   6.5   10    15    25    40    65    100   150   250   400   650   1000
  A: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  B: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  C: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  D: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  E: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  F: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[6,7],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  G: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  H: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  J: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  K: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15],[21,22],[24,25], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  L: [                  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15],[21,22],  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑'],
  M: [                  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15],[21,22], '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑'],
  N: [                  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15],[21,22], '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑'],
  P: [                  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15],[21,22], '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑'],
  Q: [                  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15],[21,22], '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑'],
  R: [                  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[10,11],[14,15],[21,22], '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑'],
};

// ============================================================
// 表2-B 加严检验一次抽样方案
// ============================================================

const TIGHTENED_TABLE: Record<string, CellValue[]> = {
  //                    0.010 0.015 0.025 0.040 0.065 0.10  0.15  0.25  0.40  0.65  1.0   1.5   2.5   4.0   6.5   10    15    25    40    65    100   150   250   400   650   1000
  A: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  B: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  C: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  D: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  E: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  F: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  G: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  H: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  J: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  K: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10],[12,13],[16,17], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  L: [                  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10],[12,13],[16,17],[21,22], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  M: [                  '↓',  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10],[12,13],[16,17],[21,22],[27,28], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  N: [                  '↓',  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10],[12,13],[16,17],[21,22],[27,28],[34,35], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  P: [                  '↓',  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10],[12,13],[16,17],[21,22],[27,28],[34,35],[43,44], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  Q: [                  '↓',[0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10],[12,13],[16,17],[21,22],[27,28],[34,35], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  R: [                [0,1],[1,2],[2,3],[3,4],[5,6],[7,8],[9,10],[12,13],[16,17],[21,22],[27,28],[34,35], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  S: [                  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',  '↑',[18,19],[22,23]],
};

// ============================================================
// 表2-C 放宽检验一次抽样方案
// ============================================================

const REDUCED_TABLE: Record<string, CellValue[]> = {
  //                    0.010 0.015 0.025 0.040 0.065 0.10  0.15  0.25  0.40  0.65  1.0   1.5   2.5   4.0   6.5   10    15    25    40    65    100   150   250   400   650   1000
  A: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  B: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  C: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  D: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  E: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[2,3],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  F: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[5,6],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  G: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  H: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  J: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  K: [                  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  L: [                  '↓',  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  M: [                  '↓',  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  N: [                  '↓',  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  P: [                  '↓',  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  Q: [                  '↓',[0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
  R: [                [0,1],[0,1],[1,2],[1,2],[2,3],[3,4],[5,6],[6,7],[8,9],[10,11],[12,13], '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓',  '↓'],
};

// 字码排序（用于箭头查找）
const CODE_LETTERS_ORDER = ['A','B','C','D','E','F','G','H','J','K','L','M','N','P','Q','R','S'];

function normalizeLevel(level: string): InspectionLevel {
  const s = (level || 'II').trim().toUpperCase()
    .replace(/[ⅡⅡ]/g, 'II')
    .replace(/G-/, '')
    .replace(/[-_\s]/g, '-');
  if (s === 'S-1' || s === 'S1') return 'S-1';
  if (s === 'S-2' || s === 'S2') return 'S-2';
  if (s === 'S-3' || s === 'S3') return 'S-3';
  if (s === 'S-4' || s === 'S4') return 'S-4';
  if (s === 'I' || s === '1') return 'I';
  if (s === 'II' || s === '2' || s === 'G2' || s === 'GII') return 'II';
  if (s === 'III' || s === '3' || s === 'G3' || s === 'GIII') return 'III';
  return 'II';
}

function normalizeAql(aql: string): string {
  const s = (aql || '0.4').trim();
  // 标准化为表格中的字符串形式
  const num = parseFloat(s);
  return AQL_COLUMNS.find(c => parseFloat(c) === num) || s;
}

function getSampleSizeTable(strictness: StrictnessLevel): Record<string, number> {
  if (strictness === 'tightened') return TIGHTENED_SAMPLE_SIZE;
  if (strictness === 'reduced') return REDUCED_SAMPLE_SIZE;
  return NORMAL_SAMPLE_SIZE;
}

function getPlanTable(strictness: StrictnessLevel): Record<string, CellValue[]> {
  if (strictness === 'tightened') return TIGHTENED_TABLE;
  if (strictness === 'reduced') return REDUCED_TABLE;
  return NORMAL_TABLE;
}

/** 批量计算入参：一个检验项目 */
export interface SamplingPlanItemInput {
  /** 检验工段：packaging / appearance / dimension / reliability / environmental */
  sectionType?: string;
  /** 抽样方案文本：G-II / S-2 / N=5 / 全检 等 */
  samplingPlanText?: string;
  aql?: string;
  sampleSize?: number;
  ac?: number;
  re?: number;
}

/** 批量计算结果：与入参 items 一一对应 */
export interface SamplingPlanItemResult {
  sampleSize: number;
  ac: number;
  re: number;
  /** 计算时采用的严格度（normal / tightened / reduced），非国标方案为 fixed */
  strictness: string;
  /** 是否按严格度重新计算（false = 沿用模板固定值） */
  applied: boolean;
  codeLetter?: string;
}

@Injectable()
export class SamplingPlanService {
  /**
   * 完整国标一次抽样方案计算
   * @param strictness 严格度: normal/tightened/reduced
   * @param inspectionLevel 检验水平: S-1..S-4, I, II, III
   * @param aql 接收质量限
   * @param lotSize 批量
   */
  calculateSamplingPlan(
    strictness: StrictnessLevel,
    inspectionLevel: string,
    aql: string,
    lotSize: number,
  ): SamplingPlanResult & { codeLetter: string; actualSampleSize: number } {
    if (!lotSize || lotSize < 2) {
      throw new BadRequestException('批量必须大于等于2');
    }

    const level = normalizeLevel(inspectionLevel);
    const aqlStr = normalizeAql(aql);
    const aqlIdx = AQL_COLUMNS.indexOf(aqlStr);
    if (aqlIdx === -1) {
      throw new BadRequestException(`不支持的AQL值: ${aql}，常用值: ${AQL_COLUMNS.slice(4, 15).join(', ')}`);
    }

    // 查表1: 批量范围 → 字码
    const range = BATCH_RANGES.find(r => lotSize >= r.min && lotSize <= r.max);
    if (!range) {
      throw new BadRequestException('批量超出计算范围');
    }
    const codeLetter = range.letters[level];

    // 查表2: 箭头规则解析
    const sampleSizeMap = getSampleSizeTable(strictness);
    const planTable = getPlanTable(strictness);

    let currentLetter = codeLetter;
    let guard = 0;
    while (guard++ < 20) {
      const row = planTable[currentLetter];
      if (!row) break;
      const cell = row[aqlIdx];
      if (Array.isArray(cell)) {
        // 找到有效抽样方案
        const sampleSize = sampleSizeMap[currentLetter];
        return {
          sampleSize,
          ac: cell[0],
          re: cell[1],
          level,
          aql: aqlStr,
          lotSize,
          codeLetter: currentLetter,
          actualSampleSize: sampleSize,
        };
      }
      // 箭头处理
      const letterIdx = CODE_LETTERS_ORDER.indexOf(currentLetter);
      if (cell === '↓') {
        // 使用箭头下面第一个抽样方案
        if (letterIdx + 1 < CODE_LETTERS_ORDER.length) {
          currentLetter = CODE_LETTERS_ORDER[letterIdx + 1];
        } else {
          break;
        }
      } else if (cell === '↑') {
        // 使用箭头上面第一个抽样方案
        if (letterIdx - 1 >= 0) {
          currentLetter = CODE_LETTERS_ORDER[letterIdx - 1];
        } else {
          break;
        }
      }
    }

    // 兜底：返回字码对应的样本量，Ac=0, Re=1
    const fallbackSize = sampleSizeMap[codeLetter] || 2;
    return {
      sampleSize: fallbackSize,
      ac: 0,
      re: 1,
      level,
      aql: aqlStr,
      lotSize,
      codeLetter,
      actualSampleSize: fallbackSize,
    };
  }

  /**
   * 兼容旧接口：calculate(lotSize, level, aql)
   * 默认为正常检验
   */
  calculate(
    lotSize: number,
    level: string,
    aql: string,
  ): SamplingPlanResult {
    const result = this.calculateSamplingPlan('normal', level, aql, lotSize);
    return {
      sampleSize: result.sampleSize,
      ac: result.ac,
      re: result.re,
      level: result.level,
      aql: result.aql,
      lotSize: result.lotSize,
    };
  }

  /**
   * 便捷方法：根据抽样方案和批量直接返回抽样数量与 Ac/Re
   * 支持 S-1/S-2/S-3/S-4/G-Ⅰ/G-Ⅱ/G-Ⅲ（含罗马数字和阿拉伯数字写法）
   * 使用正常检验，AQL 可选 0.10~2.5，默认 0.40
   */
  getSamplingInfo(
    scheme: string,
    lotSize: number,
    aql?: string,
  ): { sampleSize: number; ac: number; re: number } {
    if (!lotSize || lotSize < 2) {
      return { sampleSize: 2, ac: 0, re: 1 };
    }
    try {
      const normalized = (scheme || '').trim().toUpperCase()
        .replace(/G-Ⅰ/g, 'I').replace(/G-Ⅱ/g, 'II').replace(/G-Ⅲ/g, 'III')
        .replace(/Ⅰ/g, 'I').replace(/Ⅱ/g, 'II').replace(/Ⅲ/g, 'III')
        .replace(/G-/, '');
      const level = normalizeLevel(normalized);
      const aqlStr = aql || '0.40';
      const result = this.calculateSamplingPlan('normal', level, aqlStr, lotSize);
      return { sampleSize: result.sampleSize, ac: result.ac, re: result.re };
    } catch {
      return { sampleSize: 2, ac: 0, re: 1 };
    }
  }

  /**
   * 批量计算检验项目的抽样方案（严格度驱动）。
   *
   * 用途：检验单打开时，按物料的当前严格度把「正常/加严/放宽」抽样表套到每个检验项目上。
   * - 国标方案（S-1~S-4 / G-Ⅰ~G-Ⅲ）→ 按严格度重新查表，样本量、Ac/Re 都会变；
   * - 固定样本量（N=5）、全检、自定义文本 → 沿用模板值，不受严格度影响；
   * - 免检 / 暂停：免检按正常表计算（是否免检由批次免检确认流程决定），暂停由调用方拦截。
   */
  planForItems(params: {
    lotSize: number;
    items: SamplingPlanItemInput[];
    strictness: { appearance?: string; dimensional?: string };
  }): SamplingPlanItemResult[] {
    const { lotSize, items } = params;
    const strictnessMap = params.strictness || {};

    return (items || []).map((item) => {
      const scheme = (item.samplingPlanText || 'G-II').trim();
      const fallback = {
        sampleSize: Number(item.sampleSize) || 0,
        ac: Number(item.ac) || 0,
        re: Number(item.re) || 1,
      };

      // 固定样本量：N=5 这类写法不参与国标查表
      if (/^N\s*=/i.test(scheme)) {
        const m = scheme.match(/N\s*=\s*(\d+)/i);
        return {
          sampleSize: m ? parseInt(m[1], 10) : fallback.sampleSize,
          ac: fallback.ac,
          re: fallback.re || 1,
          strictness: 'fixed',
          applied: false,
        };
      }

      // 只有内置国标方案才自动计算；「全检」「自定义」等文本沿用模板值
      const autoLevel = autoSchemeLevel(scheme);
      if (!autoLevel) {
        return { ...fallback, strictness: 'fixed', applied: false };
      }

      const rawState = (item.sectionType === 'dimension'
        ? strictnessMap.dimensional
        : strictnessMap.appearance) || 'normal';
      const strictness: StrictnessLevel =
        rawState === 'tightened' ? 'tightened' : rawState === 'reduced' ? 'reduced' : 'normal';

      try {
        const plan = this.calculateSamplingPlan(
          strictness,
          autoLevel,
          item.aql || '0.40',
          lotSize,
        );
        return {
          sampleSize: plan.sampleSize,
          ac: plan.ac,
          re: plan.re,
          strictness,
          applied: true,
          codeLetter: plan.codeLetter,
        };
      } catch {
        return { ...fallback, strictness, applied: false };
      }
    });
  }
}

/**
 * 判断抽样方案文本是否为内置国标方案，并归一成检验水平。
 * 支持 S-1~S-4、S1~S4、I/II/III、G-Ⅰ~G-Ⅲ、G1~G3；
 * 「全检」「免检」「N=5」等自定义文本返回 null（沿用模板值）。
 */
function autoSchemeLevel(scheme: string): InspectionLevel | null {
  const raw = (scheme || '')
    .trim()
    .toUpperCase()
    .replace(/Ⅰ/g, 'I')
    .replace(/Ⅱ/g, 'II')
    .replace(/Ⅲ/g, 'III');
  const m = raw.match(/^(?:G[-_ ]?)?(S[-_ ]?[1-4]|[123]|I{1,3})$/);
  if (!m) return null;
  const body = m[1].replace(/[-_ ]/g, '');
  const map: Record<string, InspectionLevel> = {
    S1: 'S-1', S2: 'S-2', S3: 'S-3', S4: 'S-4',
    '1': 'I', '2': 'II', '3': 'III',
    I: 'I', II: 'II', III: 'III',
  };
  return map[body] || null;
}
