#!/usr/bin/env node
/**
 * diagnose_lv63.mjs - Lv63 诊断
 *
 * 1. 统一激活口径：jarResolution 事件（一次结算） vs 每次激活事件；
 * 2. 左右镜像棋盘 + 镜像罐位，重新跑 random/greedy，判断 A/B 首次激活偏差来自代码顺序还是棋盘布局。
 *
 * 用法：node tests/sim/diagnose_lv63.mjs [--games 2000]
 */

import { runSimulation } from './run_sim.mjs';
import { buildLv63Variant } from './variants.mjs';

function parseGames() {
  const index = process.argv.indexOf('--games');
  if (index >= 0) return Number(process.argv[index + 1]);
  return 2000;
}

function pick(summary) {
  return {
    winRate: summary.winRate,
    first: summary.firstResolution,
    order: summary.activationOrder,
    resonanceGameRate: summary.resolution.resonanceGameRate,
    resonanceActivationShare: summary.resolution.resonanceActivationShare,
    dualResolutions: summary.resolution.dual,
    totalResolutions: summary.resolution.total
  };
}

function pct(value) {
  return (value * 100).toFixed(1) + '%';
}

async function main() {
  const games = parseGames();
  const baseConfig = buildLv63Variant({ board: 'base' });
  const mirrorConfig = buildLv63Variant({ board: 'mirror' });
  const idSwapConfig = buildLv63Variant({ board: 'base', swapJarIds: true });

  console.log(`[diagnose] games=${games}`);
  const rows = [];
  for (const bot of ['random', 'greedy']) {
    const base = await runSimulation({ level: 63, bot, games, seedBase: 1042, quiet: true, configOverride: baseConfig });
    const mirror = await runSimulation({ level: 63, bot, games, seedBase: 1042, quiet: true, configOverride: mirrorConfig });
    const idSwap = await runSimulation({ level: 63, bot, games, seedBase: 1042, quiet: true, configOverride: idSwapConfig });
    rows.push({ bot, base: pick(base), mirror: pick(mirror), idSwap: pick(idSwap) });
  }

  for (const row of rows) {
    console.log(`\n=== ${row.bot} ===`);
    console.log(`base    first A/B/dual = ${row.base.first.A}/${row.base.first.B}/${row.base.first.dual}, ` +
      `singleA/B/dual = ${row.base.order.singleA}/${row.base.order.singleB}/${row.base.order.dual}, ` +
      `resonance games=${pct(row.base.resonanceGameRate)} share=${pct(row.base.resonanceActivationShare)}, ` +
      `dualResolutions=${row.base.dualResolutions}/${row.base.totalResolutions}`);
    console.log(`mirror  first A/B/dual = ${row.mirror.first.A}/${row.mirror.first.B}/${row.mirror.first.dual}, ` +
      `singleA/B/dual = ${row.mirror.order.singleA}/${row.mirror.order.singleB}/${row.mirror.order.dual}, ` +
      `resonance games=${pct(row.mirror.resonanceGameRate)} share=${pct(row.mirror.resonanceActivationShare)}, ` +
      `dualResolutions=${row.mirror.dualResolutions}/${row.mirror.totalResolutions}`);
    console.log(`idSwap  first A/B/dual = ${row.idSwap.first.A}/${row.idSwap.first.B}/${row.idSwap.first.dual}, ` +
      `singleA/B/dual = ${row.idSwap.order.singleA}/${row.idSwap.order.singleB}/${row.idSwap.order.dual}, ` +
      `resonance games=${pct(row.idSwap.resonanceGameRate)} share=${pct(row.idSwap.resonanceActivationShare)}, ` +
      `dualResolutions=${row.idSwap.dualResolutions}/${row.idSwap.totalResolutions}`);
    const baseConsistent = Math.abs(row.base.first.dual / games - row.base.resonanceGameRate) < 1e-9 &&
      Math.abs(row.base.dualResolutions / games - row.base.resonanceGameRate) < 1e-9;
    console.log(`口径一致性(firstDual == resonance games == dualResolutions): ${baseConsistent ? 'PASS' : 'CHECK'}`);
  }

  // 判断：镜像后 A/B 是否跟随“位置”翻转；只换 ID 后 A/B 是否跟随“位置”翻转
  for (const row of rows) {
    const baseBias = row.base.first.A - row.base.first.B;
    const mirrorBias = row.mirror.first.A - row.mirror.first.B;
    const idSwapBias = row.idSwap.first.A - row.idSwap.first.B;
    const followsPosition = Math.sign(baseBias) === -Math.sign(mirrorBias) && baseBias !== 0 && mirrorBias !== 0;
    const idSwapFollowsPosition = Math.sign(baseBias) === -Math.sign(idSwapBias) && idSwapBias !== 0;
    console.log(`\n[${row.bot}] base A-B=${baseBias}, mirror A-B=${mirrorBias}, idSwap A-B=${idSwapBias}`);
    console.log(`  base vs mirror: ${followsPosition ? '偏差方向翻转 -> 布局/位置因素明显' : '偏差方向未翻转 -> 存在代码/ID顺序因素'}`);
    console.log(`  base vs idSwap: ${idSwapFollowsPosition ? '偏差随位置翻转 -> 布局/位置因素为主' : '偏差不随位置翻转 -> 代码/ID顺序因素为主'}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
