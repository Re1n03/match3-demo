#!/usr/bin/env node
/**
 * scan_lv63.mjs - Lv63 调参扫描（mixed 机器人，N=2000/组）
 *
 * 只扫描 PDF 未规定参数：
 * - 邻近判定（manhattan1 / chebyshev1）
 * - 单次交换充能上限（Inf / 1）
 * - 爆浆形状（十字 / 3x3）
 * - 初始棋盘布局（base / alt）
 *
 * 输出对比表 + tests/sim/out/scan.csv / scan.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSimulation } from './run_sim.mjs';
import { buildLv63Variant } from './variants.mjs';
import { JamJarBlastScope } from '../../js/mechanics/JamJarConfig.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
const GAMES = 2000;
const SEED = 1042;
const MIXED_RATE = 0.5;

const CANDIDATES = [
  {
    id: 'A_baseline',
    desc: 'manhattan1 · cap∞ · 十字 · boardA',
    variant: () => buildLv63Variant({ board: 'base' })
  },
  {
    id: 'B_charge8',
    desc: 'chebyshev1 · cap∞ · 十字 · boardA',
    variant: () => buildLv63Variant({ board: 'base', chargeMetric: 'chebyshev' })
  },
  {
    id: 'C_charge8_cap1',
    desc: 'chebyshev1 · cap1 · 十字 · boardA',
    variant: () => buildLv63Variant({ board: 'base', chargeMetric: 'chebyshev', maxChargesPerSwap: 1 })
  },
  {
    id: 'D_charge8_cap1_3x3',
    desc: 'chebyshev1 · cap1 · 3x3 · boardA',
    variant: () => buildLv63Variant({
      board: 'base', chargeMetric: 'chebyshev', maxChargesPerSwap: 1,
      burstShape: JamJarBlastScope.FULL_3X3
    })
  },
  {
    id: 'E_charge8_cap1_3x3_boardB',
    desc: 'chebyshev1 · cap1 · 3x3 · boardB',
    variant: () => buildLv63Variant({
      board: 'alt', chargeMetric: 'chebyshev', maxChargesPerSwap: 1,
      burstShape: JamJarBlastScope.FULL_3X3
    })
  }
];

function targetsMet(summary) {
  const win = summary.winRate >= 0.90;
  const remainingMedian = summary.remainingMovesOnWin.median;
  const remaining = remainingMedian >= 6 && remainingMedian <= 8;
  const cascade = summary.cascade.rate > 0.65;
  const resonance = summary.lv63.resonance.gameRate >= 0.50;
  return { win, remaining, cascade, resonance, count: [win, remaining, cascade, resonance].filter(Boolean).length };
}

async function main() {
  const rows = [];
  for (const candidate of CANDIDATES) {
    const config = candidate.variant();
    const summary = await runSimulation({
      level: 63,
      bot: 'mixed',
      games: GAMES,
      seedBase: SEED,
      mixedRate: MIXED_RATE,
      quiet: true,
      configOverride: config
    });
    const met = targetsMet(summary);
    rows.push({
      id: candidate.id,
      desc: candidate.desc,
      winRate: summary.winRate,
      remainingMedian: summary.remainingMovesOnWin.median,
      remainingP15: summary.remainingMovesOnWin.p15,
      remainingP85: summary.remainingMovesOnWin.p85,
      stepsMedian: summary.stepsUsed.median,
      cascadeRate: summary.cascade.rate,
      resonanceGameRate: summary.lv63.resonance.gameRate,
      resonanceActivationShare: summary.lv63.resonance.activationShare,
      firstResolution: summary.firstResolution,
      activationOrder: summary.activationOrder,
      targetMet: met.count,
      targetDetail: met
    });
    console.log(`[scan] ${candidate.id}: win ${(summary.winRate * 100).toFixed(1)}%, ` +
      `remaining median ${summary.remainingMovesOnWin.median}, cascade ${(summary.cascade.rate * 100).toFixed(1)}%, ` +
      `resonance games ${(summary.lv63.resonance.gameRate * 100).toFixed(1)}% -> ${met.count}/4`);
  }

  console.log('\n候选对比 (mixed, N=' + GAMES + ')');
  for (const row of rows) {
    console.log(`${row.id}: win ${(row.winRate * 100).toFixed(1)}% | remMed ${row.remainingMedian} | ` +
      `cascade ${(row.cascadeRate * 100).toFixed(1)}% | resonance ${(row.resonanceGameRate * 100).toFixed(1)}% | ` +
      `target ${row.targetMet}/4 (${JSON.stringify(row.targetDetail)})`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'scan.json'), JSON.stringify(rows, null, 2), 'utf8');
  const header = ['id', 'winRate', 'remainingMedian', 'remainingP15', 'remainingP85', 'stepsMedian',
    'cascadeRate', 'resonanceGameRate', 'resonanceActivationShare', 'targetMet'];
  const csv = [header.join(','), ...rows.map(r => [r.id, r.winRate.toFixed(4), r.remainingMedian,
    r.remainingP15, r.remainingP85, r.stepsMedian, r.cascadeRate.toFixed(4),
    r.resonanceGameRate.toFixed(4), r.resonanceActivationShare.toFixed(4), r.targetMet].join(','))].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'scan.csv'), csv, 'utf8');
  console.log(`\n[scan] 输出: ${path.join(OUT_DIR, 'scan.csv')}, scan.json`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
