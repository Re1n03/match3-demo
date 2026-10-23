/**
 * variants.mjs - Lv63 诊断/调参用的关卡变体构造器
 *
 * 只改 PDF 未规定参数：邻近判定范围、单次交换充能上限、爆浆形状、初始棋盘布局。
 * 固定不动：8x8、4 色、24 步、目标、果冻位置/HP、罐位置（除镜像诊断）、removeAfterActivation。
 */

import { Level63Config } from '../../js/levels/level63.js';
import { JamJarSystem } from '../../js/mechanics/JamJarSystem.js';
import { JamJarBlastScope } from '../../js/mechanics/JamJarConfig.js';

export const JAR_A = { row: 4, col: 3 };
export const JAR_B = { row: 4, col: 5 };

// 当前 Lv63 配平棋盘（red15/blue15/green16/yellow16）
export const BOARD_BASE = Level63Config.initialTiles.map(row => [...row]);

// 备选配平棋盘（同样 22%-28%，无现成三消）
export const BOARD_ALT = [
  ['red', 'green', 'yellow', 'blue', 'red', 'green', 'red', 'green'],
  ['blue', 'blue', 'green', 'red', 'blue', 'red', 'green', 'blue'],
  ['red', 'blue', 'green', 'yellow', 'yellow', 'green', 'red', 'red'],
  ['green', 'yellow', 'blue', 'green', 'yellow', 'yellow', 'red', 'yellow'],
  ['blue', 'red', 'blue', null, 'green', null, 'green', 'yellow'],
  ['blue', 'red', 'green', 'yellow', 'red', 'yellow', 'blue', 'blue'],
  ['green', 'yellow', 'green', 'yellow', 'blue', 'red', 'yellow', 'yellow'],
  ['yellow', 'red', 'yellow', 'blue', 'blue', 'green', 'green', 'red']
];

export function mirrorTiles(tiles) {
  return tiles.map(row => [...row].reverse());
}

function cloneUnderlays() {
  return Level63Config.initialUnderlays.map(cell => ({ ...cell }));
}

function buildConfig({ initialTiles, jarDefs, chargeMetric, chargeRange, maxChargesPerSwap, burstShape }) {
  const system = new JamJarSystem({
    initialCharge: 0,
    maxCharge: 3,
    burstShape,
    landingScope: 'global',
    leapOnActivate: false,
    removeAfterActivation: true,
    activationsRequired: 1,
    targetType: 'ACTIVATE_JAM_JAR',
    chargeMetric,
    chargeRange,
    maxChargesPerSwap,
    jars: jarDefs
  });

  return {
    ...Level63Config,
    initialTiles: initialTiles.map(row => [...row]),
    initialUnderlays: cloneUnderlays(),
    customMechanics: system
  };
}

/**
 * 构造 Lv63 变体。
 * @param {Object} opts
 * @param {'base'|'alt'|'mirror'} [opts.board='base']
 * @param {'manhattan'|'chebyshev'} [opts.chargeMetric='manhattan']
 * @param {number} [opts.chargeRange=1]
 * @param {number} [opts.maxChargesPerSwap=Infinity]
 * @param {string} [opts.burstShape=JamJarBlastScope.STRICT_CROSS]
 * @param {boolean} [opts.mirrorJars=false] 是否同时镜像两罐位置（诊断用）
 * @param {boolean} [opts.swapJarIds=false] 是否只交换 A/B 实体 ID、保持位置不变（诊断代码顺序用）
 */
export function buildLv63Variant(opts = {}) {
  const {
    board = 'base',
    chargeMetric = 'manhattan',
    chargeRange = 1,
    maxChargesPerSwap = Infinity,
    burstShape = JamJarBlastScope.STRICT_CROSS,
    mirrorJars = board === 'mirror',
    swapJarIds = false
  } = opts;

  let initialTiles;
  if (board === 'mirror') initialTiles = mirrorTiles(BOARD_BASE);
  else if (board === 'alt') initialTiles = BOARD_ALT.map(row => [...row]);
  else initialTiles = BOARD_BASE.map(row => [...row]);

  let jarDefs = mirrorJars
    ? [
        { id: 'jar_63_a', pos: { row: JAR_A.row, col: 7 - JAR_A.col } },
        { id: 'jar_63_b', pos: { row: JAR_B.row, col: 7 - JAR_B.col } }
      ]
    : [
        { id: 'jar_63_a', pos: { ...JAR_A } },
        { id: 'jar_63_b', pos: { ...JAR_B } }
      ];

  if (swapJarIds) {
    // 只交换实体 ID：A 去 B 的位置，B 去 A 的位置
    jarDefs = jarDefs.map(def => ({
      id: def.id === 'jar_63_a' ? 'jar_63_b' : 'jar_63_a',
      pos: def.pos
    }));
  }

  return buildConfig({ initialTiles, jarDefs, chargeMetric, chargeRange, maxChargesPerSwap, burstShape });
}
