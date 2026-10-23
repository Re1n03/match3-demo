/**
 * level63.js - Lv63 情绪释放关 · 双罐共鸣（8x8）
 *
 * 位置按作品集 PDF 位图（1-based -> 0-based）：
 * - 罐体 A：第 5 行第 4 列 -> (4,3)
 * - 罐体 B：第 5 行第 6 列 -> (4,5)
 * - 共鸣交叠格：两罐之间 (4,4)
 * - 果冻底衬 16 格：第 4-7 行、第 3-6 列 -> 0-based 行 3-6、列 2-5
 *
 * 机制参数：
 * - 8x8 / 4 色 / 24 步 / Seed #1042；
 * - 初始充能 0/3；
 * - 原地爆浆（leapOnActivate=false），当两罐同时激活时计算爆浆范围重叠格：
 *   重叠格受到 2 倍伤害并触发共鸣闪光，爆浆范围本身不改变；
 * - 目标：激活罐子 ×2 + 清除果冻 ×16。
 *
 * 数值（24 步）为初版，后续用模拟器调优。
 */

import { JamJarBlastScope } from '../mechanics/JamJarConfig.js';
import { JamJarSystem } from '../mechanics/JamJarSystem.js';

const JAR_A_POS = { row: 4, col: 3 };
const JAR_B_POS = { row: 4, col: 5 };

// 0-based 行 3-6、列 2-5 = 16 格果冻
const JELLY_CELLS = [];
for (let r = 3; r <= 6; r++) {
  for (let c = 2; c <= 5; c++) {
    JELLY_CELLS.push({ row: r, col: c, type: 'JELLY', hp: 1 });
  }
}

const jamJarSystem = new JamJarSystem({
  initialCharge: 0,
  maxCharge: 3,
  burstShape: JamJarBlastScope.STRICT_CROSS,
  landingScope: 'global',
  leapOnActivate: false, // 双罐原地爆浆，形成“共鸣交叠”
  removeAfterActivation: true, // 原地爆浆后罐体消失并由重力补料
  chargeMetric: 'chebyshev', // 调参扫描选定：邻近判定含斜邻（chebyshev 1）
  chargeRange: 1,
  activationsRequired: 1,
  targetType: 'ACTIVATE_JAM_JAR',
  jars: [
    { id: 'jar_63_a', pos: JAR_A_POS },
    { id: 'jar_63_b', pos: JAR_B_POS }
  ]
});

// 8x8 可玩矩阵（无现成三消，运行时 jar 格由系统放置）
// 配色配比：red 15 / blue 15 / green 16 / yellow 16（各色占 64 格 23.4%~25%）
const INITIAL_TILES = [
  ['green',  'yellow', 'yellow', 'green',  'red',    'red',    'yellow', 'green'],
  ['green',  'yellow', 'blue',   'blue',   'yellow', 'green',  'yellow', 'green'],
  ['red',    'red',    'blue',   'green',  'red',    'blue',   'green',  'blue'],
  ['yellow', 'red',    'green',  'red',    'green',  'yellow', 'yellow', 'blue'],
  ['yellow', 'yellow', 'red',    null,     'green',  null,     'blue',   'red'],
  ['green',  'yellow', 'blue',   'red',    'red',    'blue',   'yellow', 'green'],
  ['red',    'blue',   'yellow', 'blue',   'blue',   'red',    'green',  'red'],
  ['green',  'blue',   'green',  'blue',   'yellow', 'yellow', 'blue',   'red']
];
// 罐体 A/B 所在格置空，由 JamJarSystem 放置实体
INITIAL_TILES[JAR_A_POS.row][JAR_A_POS.col] = null;
INITIAL_TILES[JAR_B_POS.row][JAR_B_POS.col] = null;

export const Level63Config = {
  id: 'lvl_63',
  levelNumber: 63,
  title: 'Lv63 情绪释放关',
  subtitle: '双罐共鸣 · 宽通道果冻清场',
  rows: 8,
  cols: 8,
  colors: ['red', 'blue', 'green', 'yellow'],
  maxMoves: 24,
  seed: 1042,
  stepDelay: 300,
  targets: [
    { id: 'target_jar', type: 'ACTIVATE_JAM_JAR', count: 2, current: 0, label: '激活罐子' },
    { id: 'target_jelly', type: 'CLEAR_JELLY', count: 16, current: 0, label: '清除果冻' }
  ],
  initialTiles: INITIAL_TILES,
  initialUnderlays: JELLY_CELLS,

  jarPositions: [JAR_A_POS, JAR_B_POS],
  jellyCells: JELLY_CELLS,

  customMechanics: jamJarSystem
};
