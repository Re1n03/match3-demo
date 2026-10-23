/**
 * level64.js - Lv64 卡点关（8x8 · 双岛 · 传送门 · 蜂蜜）
 *
 * PDF 固定参数：
 * - 8x8、5 色（红/蓝/绿/黄/紫）、19 步；
 * - 左岛 3 列 + 中间 2 列 VOID + 右岛 3 列；
 * - 罐子 (3,1)，激活 2 次（激活后重置充能，不移除），landingScope='island'；
 * - 右下 2x2 蜂蜜 HP=2；
 * - 传送门：右岛顶部入口 (0,5)/(0,6) ← 左岛底部出口 (7,1)/(7,2)。
 *
 * 初始棋盘为 5 色配比版（各色约占可染色格 16%-24%），无现成三消、有合法交换。
 */

import { JamJarSystem } from '../mechanics/JamJarSystem.js';
import { JamJarBlastScope } from '../mechanics/JamJarConfig.js';
import { PortalSystem } from '../mechanics/PortalSystem.js';

const JAR_POS = { row: 3, col: 1 };

const HONEY_CELLS = [
  { row: 6, col: 6, type: 'HONEY', hp: 2, blocksMovement: true },
  { row: 6, col: 7, type: 'HONEY', hp: 2, blocksMovement: true },
  { row: 7, col: 6, type: 'HONEY', hp: 2, blocksMovement: true },
  { row: 7, col: 7, type: 'HONEY', hp: 2, blocksMovement: true }
];

// 物理镂空：中间 2 列
const VOID_CELLS = [];
for (let r = 0; r < 8; r++) {
  VOID_CELLS.push({ row: r, col: 3 }, { row: r, col: 4 });
}

// 传送门：左岛底部出口 -> 右岛顶部入口
const PORTAL_PAIRS = [
  { exit: { row: 7, col: 1 }, entry: { row: 0, col: 5 } },
  { exit: { row: 7, col: 2 }, entry: { row: 0, col: 6 } }
];

// 右岛全部格禁止随机补料：只能由入口传送门送料；入口取不到料则空着
const NO_RANDOM_SPAWN_CELLS = [];
for (let r = 0; r < 8; r++) {
  for (let c = 5; c <= 7; c++) NO_RANDOM_SPAWN_CELLS.push({ row: r, col: c });
}

const portalSystem = new PortalSystem({
  pairs: PORTAL_PAIRS,
  noRandomSpawnCells: NO_RANDOM_SPAWN_CELLS
});

const jamJarSystem = new JamJarSystem({
  initialCharge: 0,
  maxCharge: 3,
  burstShape: JamJarBlastScope.STRICT_CROSS,
  landingScope: 'island', // 罐子只能落在左岛连通区域
  leapOnActivate: true,
  removeAfterActivation: false, // 同一罐子激活 2 次，不移除
  activationsRequired: 2,
  targetType: 'ACTIVATE_JAM_JAR',
  jars: [{ id: 'jar_64', pos: JAR_POS }]
});

// 5 色初始矩阵：null = VOID / 罐子格 / 蜂蜜格（由系统放置）
const INITIAL_TILES = [
  ['yellow', 'green', 'purple', null, null, 'blue', 'purple', 'blue'],
  ['blue', 'red', 'red', null, null, 'red', 'green', 'purple'],
  ['green', 'blue', 'red', null, null, 'green', 'yellow', 'red'],
  ['green', null, 'blue', null, null, 'purple', 'green', 'red'],
  ['yellow', 'green', 'purple', null, null, 'blue', 'blue', 'yellow'],
  ['green', 'purple', 'yellow', null, null, 'blue', 'green', 'blue'],
  ['red', 'purple', 'yellow', null, null, 'yellow', null, null],
  ['yellow', 'red', 'purple', null, null, 'red', null, null]
];

export const Level64Config = {
  id: 'lvl_64',
  levelNumber: 64,
  title: 'Lv64 卡点关',
  subtitle: '物理镂空双岛 · 传送门 · 19步',
  enabled: true,
  rows: 8,
  cols: 8,
  colors: ['red', 'blue', 'green', 'yellow', 'purple'],
  maxMoves: 19,
  seed: 1042,
  stepDelay: 300,
  targets: [
    { id: 'target_honey', type: 'CLEAR_HONEY', count: 4, current: 0, label: '消除蜂蜜' },
    { id: 'target_jar', type: 'ACTIVATE_JAM_JAR', count: 2, current: 0, label: '激活罐子' }
  ],
  initialTiles: INITIAL_TILES,
  initialVoids: VOID_CELLS,
  initialObstacles: HONEY_CELLS,
  honeyDamageAdjacency: 'diagonal', // 调参扫描选定：蜂蜜受伤含斜向

  honeyCells: HONEY_CELLS,
  voidColumns: [3, 4],
  jarPositions: [JAR_POS],
  portalPairs: PORTAL_PAIRS,
  portalSystem,

  customMechanics: jamJarSystem
};
