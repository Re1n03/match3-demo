/**
 * level62.js - Lv62 机制引入关 · 8x8 确定性首步引导
 *
 * 【原案明确规定依据】：
 * 1. 目标：激活果酱罐 × 1
 * 2. 步数：22 步 | 色数：4 色 (红/蓝/绿/黄) | 种子：Seed #1042
 * 3. 确定性首步：仅留唯一三消解 Swap (1,4) <-> (2,4) -> 消除红心 -> 罐体吸收能量
 * 4. 空间降落法则：预设安全落点 (右下方裸露棋子格)，落地引爆十字清空初始目标，0弹窗内化
 *
 * 【本轮坐标对齐 PDF 说明】：
 * - 罐体位置：PDF 位图 1-based (4,4) -> 0-based (3,3)；
 * - 唯一首步：PDF 位图第 4 行、第 2↔3 列横向交换 -> 0-based (3,1) <-> (3,2)；
 * - 安全落点：PDF 位图 1-based (6,7) -> 0-based (5,6)；
 * - initialCharge = 2：首步唯一三消 +1 充能即满 3/3，立即起跳；
 * - 其余格重新配色，保证全盘仅此一个合法交换、首步匹配紧邻罐子、爆浆后自发连消；
 * - 矩阵与首步由 tests/solve_lv62.mjs 穷举验证，结果固化在 tests/test_suite.js。
 */

import { JamJarBlastScope } from '../mechanics/JamJarConfig.js';
import { JamJarSystem } from '../mechanics/JamJarSystem.js';

const JAR_INITIAL_POS = { row: 3, col: 3 };
const SAFE_LANDING_POS = { row: 5, col: 6 };

// 通用果酱罐系统实例：所有机制参数都来自关卡配置
const jamJarSystem = new JamJarSystem({
  initialCharge: 2,
  maxCharge: 3,
  burstShape: JamJarBlastScope.STRICT_CROSS,
  landingScope: 'global',
  activationsRequired: 1,
  targetType: 'ACTIVATE_JAM_JAR',
  preferredLandingPos: SAFE_LANDING_POS,
  jars: [{ id: 'jar_entity_62', pos: JAR_INITIAL_POS }]
});

export const Level62Config = {
  id: 'lvl_62',
  levelNumber: 62,
  title: 'Lv62 机制引入关',
  subtitle: '确定性首步因果链教学 (Seed #1042)',
  rows: 8,
  cols: 8,
  colors: ['red', 'blue', 'green', 'yellow'],
  maxMoves: 22,
  seed: 1042,
  stepDelay: 300, // 动画节奏控制：每个关键阶段之间的最小等待窗口（毫秒）
  targets: [
    { id: 'target_jar', type: 'ACTIVATE_JAM_JAR', count: 1, current: 0, label: '激活果酱罐 🍯' }
  ],

  // 8x8 棋盘：按 PDF 坐标放置罐体 (3,3)，其余格重新配色。
  initialTiles: [
    ['blue',   'yellow', 'green',  'blue',   'yellow', 'green',  'blue',   'yellow'],
    ['green',  'blue',   'yellow', 'green',  'blue',   'yellow', 'green',  'blue'],
    ['yellow', 'green',  'red',    'yellow', 'green',  'blue',   'yellow', 'green'],
    ['blue',   'red',    'blue',   null,     'yellow', 'green',  'blue',   'yellow'],
    ['green',  'yellow', 'red',    'green',  'blue',   'yellow', 'green',  'blue'],
    ['red',    'green',  'blue',   'yellow', 'green',  'blue',   'yellow', 'green'],
    ['red',    'yellow', 'green',  'blue',   'yellow', 'green',  'blue',   'yellow'],
    ['green',  'blue',   'yellow', 'green',  'blue',   'yellow', 'green',  'blue']
  ],

  jarInitialPos: JAR_INITIAL_POS,
  safeLandingPos: SAFE_LANDING_POS,

  // 求解器/测试使用的唯一首步（PDF 位图第 4 行第 2↔3 列，0-based 即 (3,1)<->(3,2)）
  firstMove: {
    from: { row: 3, col: 1 },
    to: { row: 3, col: 2 }
  },

  customMechanics: jamJarSystem
};
