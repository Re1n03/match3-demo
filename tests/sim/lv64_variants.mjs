/**
 * lv64_variants.mjs - Lv64 调参变体构造器
 * 仅改 PDF 未规定杠杆：初始棋盘、罐子初始充能、蜂蜜受伤范围。
 */

import { Level64Config } from '../../js/levels/level64.js';
import { JamJarSystem } from '../../js/mechanics/JamJarSystem.js';
import { JamJarBlastScope } from '../../js/mechanics/JamJarConfig.js';
import { PortalSystem } from '../../js/mechanics/PortalSystem.js';

export const BOARD_BASE = Level64Config.initialTiles.map(row => [...row]);

// 备选棋盘：5 色 9/9/9/8/8，无现成三消、有合法交换
export const BOARD_B = [
  ['red', 'purple', 'green', null, null, 'red', 'blue', 'blue'],
  ['green', 'yellow', 'green', null, null, 'blue', 'yellow', 'yellow'],
  ['yellow', 'green', 'purple', null, null, 'red', 'purple', 'green'],
  ['yellow', null, 'purple', null, null, 'red', 'blue', 'yellow'],
  ['green', 'purple', 'yellow', null, null, 'purple', 'blue', 'blue'],
  ['red', 'blue', 'purple', null, null, 'green', 'yellow', 'green'],
  ['blue', 'red', 'red', null, null, 'purple', null, null],
  ['red', 'red', 'blue', null, null, 'green', null, null]
];

export const BOARD_C = [
  ['yellow', 'green', 'blue', null, null, 'purple', 'yellow', 'blue'],
  ['purple', 'purple', 'green', null, null, 'green', 'green', 'red'],
  ['purple', 'yellow', 'green', null, null, 'red', 'blue', 'green'],
  ['yellow', null, 'purple', null, null, 'blue', 'red', 'blue'],
  ['yellow', 'green', 'yellow', null, null, 'red', 'blue', 'yellow'],
  ['purple', 'red', 'red', null, null, 'red', 'red', 'purple'],
  ['green', 'blue', 'yellow', null, null, 'blue', null, null],
  ['red', 'purple', 'blue', null, null, 'green', null, null]
];

export const BOARD_D = [
  ['green', 'green', 'yellow', null, null, 'blue', 'blue', 'red'],
  ['yellow', 'green', 'purple', null, null, 'yellow', 'yellow', 'purple'],
  ['green', 'blue', 'green', null, null, 'blue', 'purple', 'yellow'],
  ['green', null, 'green', null, null, 'purple', 'yellow', 'yellow'],
  ['blue', 'blue', 'red', null, null, 'red', 'blue', 'purple'],
  ['purple', 'red', 'red', null, null, 'green', 'red', 'red'],
  ['yellow', 'purple', 'blue', null, null, 'red', null, null],
  ['blue', 'red', 'purple', null, null, 'green', null, null]
];

export const BOARD_E = [
  ['purple', 'red', 'blue', null, null, 'blue', 'red', 'blue'],
  ['blue', 'purple', 'purple', null, null, 'purple', 'green', 'blue'],
  ['green', 'green', 'red', null, null, 'purple', 'blue', 'green'],
  ['yellow', null, 'green', null, null, 'yellow', 'green', 'yellow'],
  ['yellow', 'purple', 'green', null, null, 'yellow', 'yellow', 'red'],
  ['blue', 'blue', 'red', null, null, 'purple', 'yellow', 'red'],
  ['yellow', 'purple', 'green', null, null, 'green', null, null],
  ['red', 'blue', 'red', null, null, 'red', null, null]
];

export function buildLv64Variant({ board = 'base', initialCharge = 0, honeyDamageAdjacency = 'orthogonal' } = {}) {
  const initialTiles = board === 'B' ? BOARD_B
    : board === 'C' ? BOARD_C
    : board === 'D' ? BOARD_D
    : board === 'E' ? BOARD_E
    : BOARD_BASE;
  const jarSystem = new JamJarSystem({
    initialCharge,
    maxCharge: 3,
    burstShape: JamJarBlastScope.STRICT_CROSS,
    landingScope: 'island',
    leapOnActivate: true,
    removeAfterActivation: false,
    activationsRequired: 2,
    targetType: 'ACTIVATE_JAM_JAR',
    jars: [{ id: 'jar_64', pos: { row: 3, col: 1 } }]
  });

  const portalPairs = Level64Config.portalPairs.map(pair => ({
    exit: { ...pair.exit },
    entry: { ...pair.entry }
  }));
  const noRandomSpawnCells = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 5; c <= 7; c++) noRandomSpawnCells.push({ row: r, col: c });
  }

  return {
    ...Level64Config,
    initialTiles: initialTiles.map(row => [...row]),
    initialObstacles: Level64Config.initialObstacles.map(cell => ({ ...cell })),
    honeyDamageAdjacency,
    customMechanics: jarSystem,
    portalSystem: new PortalSystem({ pairs: portalPairs, noRandomSpawnCells })
  };
}
