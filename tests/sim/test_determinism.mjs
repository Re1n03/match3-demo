#!/usr/bin/env node
/**
 * test_determinism.mjs - 模拟器确定性测试
 *
 * 同一关卡 / 机器人 / 局数 / seed 跑两次，指标必须逐字节一致。
 * 用法：node tests/sim/test_determinism.mjs
 */

import { runSimulation } from './run_sim.mjs';

function compare(name, a, b) {
  const left = JSON.stringify(a);
  const right = JSON.stringify(b);
  const ok = left === right;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  if (!ok) {
    console.log('  first :', left.slice(0, 300));
    console.log('  second:', right.slice(0, 300));
  }
  return ok;
}

const cases = [
  { name: 'Lv62 random x5', level: 62, bot: 'random', games: 5 },
  { name: 'Lv63 greedy x5', level: 63, bot: 'greedy', games: 5 },
  { name: 'Lv63 mixed x5', level: 63, bot: 'mixed', games: 5 },
  { name: 'Lv64 mixed x5', level: 64, bot: 'mixed', games: 5 }
];

let allOk = true;
for (const testCase of cases) {
  const params = { level: testCase.level, bot: testCase.bot, games: testCase.games, seedBase: 1042, quiet: true };
  const first = await runSimulation(params);
  const second = await runSimulation(params);
  allOk = compare(testCase.name, first, second) && allOk;
}

// 口径一致性：双罐首次激活数 / 对局数 应等于“含共鸣对局占比”，
// 也等于“共鸣激活事件 / 总激活事件”（当前 Lv63 每局恰好 2 次激活、每次双罐结算必共鸣）。
const metrics = await runSimulation({ level: 63, bot: 'mixed', games: 20, seedBase: 1042, quiet: true });
const gameRate = metrics.lv63.resonance.gameRate;
const activationShare = metrics.lv63.resonance.activationShare;
const firstDualRate = metrics.firstResolution.dual / metrics.games;
const dualResolutionRate = metrics.resolution.dual / metrics.games;
const consistent = Math.abs(gameRate - activationShare) < 1e-9 &&
  Math.abs(gameRate - firstDualRate) < 1e-9 &&
  Math.abs(gameRate - dualResolutionRate) < 1e-9;
console.log(`[${consistent ? 'PASS' : 'FAIL'}] 激活结算口径一致性 ` +
  `(gameRate=${gameRate.toFixed(4)}, activationShare=${activationShare.toFixed(4)}, ` +
  `firstDualRate=${firstDualRate.toFixed(4)}, dualResolutionRate=${dualResolutionRate.toFixed(4)})`);
allOk = consistent && allOk;

if (!allOk) {
  console.error('[FAILED] 模拟器存在非确定性结果');
  process.exit(1);
}
console.log('[SUCCESS] 模拟器同参数同结果。');
