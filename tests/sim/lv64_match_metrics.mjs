#!/usr/bin/env node
/**
 * lv64_match_metrics.mjs - Lv64 mixed 专项测量（B 组）
 *
 * 输出：
 * - 罐子第 2 次激活的平均步序（仅统计发生第 2 次激活的对局）
 * - 蜂蜜 4 块全清的平均步序（仅统计完成蜂蜜目标的对局）
 * - 每局传送门转移棋子数均值
 * 同时输出 cap19 / cap40 两套，替换 PDF 手算的“14步主区+3步过料”。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Level64Config } from '../../js/levels/level64.js';
import { simulateGame, botRngSeed } from './run_sim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
const GAMES = Number(process.env.SIM_GAMES || 2000);
const SEED = 1042;

function stats(values) {
  if (!values.length) return { count: 0, mean: 0, median: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const pick = p => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))];
  return {
    count: values.length,
    mean: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)),
    median: pick(0.5)
  };
}

async function measure(cap) {
  const config = { ...Level64Config, maxMoves: cap, stepDelay: 0 };
  const jar2Steps = [];
  const honeyClearSteps = [];
  const portalTransfers = [];
  let wins = 0;

  for (let i = 0; i < GAMES; i++) {
    const result = await simulateGame(
      config,
      'mixed',
      SEED + i,
      botRngSeed('mixed', SEED, i),
      0.5,
      { diagnostics: true }
    );
    if (result.win) wins++;
    if (result.diagnostics.jarActivationSteps.length >= 2) {
      jar2Steps.push(result.diagnostics.jarActivationSteps[1]);
    }
    if (result.diagnostics.honeyClearStep !== null) {
      honeyClearSteps.push(result.diagnostics.honeyClearStep);
    }
    portalTransfers.push(result.diagnostics.portalStats ? result.diagnostics.portalStats.transferCount : 0);
  }

  return {
    cap,
    games: GAMES,
    winRate: wins / GAMES,
    jar2: stats(jar2Steps),
    honeyClear: stats(honeyClearSteps),
    portalTransfersPerGame: Number((portalTransfers.reduce((a, b) => a + b, 0) / GAMES).toFixed(2))
  };
}

async function main() {
  const results = [await measure(19), await measure(40)];
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'lv64_match_metrics.json'), JSON.stringify(results, null, 2), 'utf8');
  const header = ['cap', 'games', 'winRate', 'jar2Count', 'jar2MeanStep', 'jar2MedianStep',
    'honeyClearCount', 'honeyClearMeanStep', 'honeyClearMedianStep', 'portalTransfersPerGame'];
  const csv = [header.join(','), ...results.map(r => [
    r.cap, r.games, r.winRate.toFixed(4), r.jar2.count, r.jar2.mean, r.jar2.median,
    r.honeyClear.count, r.honeyClear.mean, r.honeyClear.median, r.portalTransfersPerGame
  ].join(','))].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'lv64_match_metrics.csv'), csv, 'utf8');

  for (const r of results) {
    console.log(`[match] cap${r.cap}: win ${(r.winRate * 100).toFixed(1)}%, ` +
      `jar2 ${r.jar2.count}局 平均第${r.jar2.mean}步 (中位${r.jar2.median}), ` +
      `honey4 ${r.honeyClear.count}局 平均第${r.honeyClear.mean}步 (中位${r.honeyClear.median}), ` +
      `portal ${r.portalTransfersPerGame}/局`);
  }
  console.log(`[match] 输出: ${path.join(OUT_DIR, 'lv64_match_metrics.csv')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
