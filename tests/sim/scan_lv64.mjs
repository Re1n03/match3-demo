#!/usr/bin/env node
/**
 * scan_lv64.mjs - Lv64 调参扫描（mixed，N=2000）
 *
 * 目标：
 * - cap40 通关率 >= 90%
 * - 通关所需步数（cap40）：中位 19-21，P15≈16，P85≈24-26
 * - cap19 通关率 35%-55%
 *
 * 仅扫描 PDF 未规定杠杆：初始棋盘布局、罐子初始充能、蜂蜜受伤范围。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSimulation } from './run_sim.mjs';
import { buildLv64Variant } from './lv64_variants.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
const GAMES = Number(process.env.SIM_GAMES || 2000);
const SEED = 1042;
const MIXED_RATE = 0.5;

const CANDIDATES = [
  {
    id: 'A_base_orth0',
    desc: 'boardA · charge0 · 蜂蜜正交',
    variant: () => buildLv64Variant({ board: 'base', initialCharge: 0, honeyDamageAdjacency: 'orthogonal' })
  },
  {
    id: 'B_diag0',
    desc: 'boardA · charge0 · 蜂蜜含斜向',
    variant: () => buildLv64Variant({ board: 'base', initialCharge: 0, honeyDamageAdjacency: 'diagonal' })
  },
  {
    id: 'C_diag1',
    desc: 'boardA · charge1 · 蜂蜜含斜向',
    variant: () => buildLv64Variant({ board: 'base', initialCharge: 1, honeyDamageAdjacency: 'diagonal' })
  },
  {
    id: 'D_boardD_diag0',
    desc: 'boardD(3个蜂蜜邻接起手) · charge0 · 蜂蜜含斜向',
    variant: () => buildLv64Variant({ board: 'D', initialCharge: 0, honeyDamageAdjacency: 'diagonal' })
  },
  {
    id: 'E_base_diag2',
    desc: 'boardA · charge2 · 蜂蜜含斜向',
    variant: () => buildLv64Variant({ board: 'base', initialCharge: 2, honeyDamageAdjacency: 'diagonal' })
  }
];

function requiredStepsFromSummary(summary, cap) {
  const values = [];
  const histogram = summary.remainingMovesOnWin.histogram || {};
  for (const [remaining, count] of Object.entries(histogram)) {
    const steps = cap - Number(remaining);
    for (let i = 0; i < count; i++) values.push(steps);
  }
  values.sort((a, b) => a - b);
  if (!values.length) return { mean: 0, median: 0, p15: 0, p85: 0, min: 0, max: 0 };
  const pick = p => values[Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * p)))];
  return {
    mean: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)),
    median: pick(0.5),
    p15: pick(0.15),
    p85: pick(0.85),
    min: values[0],
    max: values[values.length - 1]
  };
}

function targets(win40, required, win19) {
  const win40Ok = win40 >= 0.90;
  const medianOk = required.median >= 19 && required.median <= 21;
  const p15Ok = Math.abs(required.p15 - 16) <= 1; // 15-17 视为“约 16”
  const p85Ok = required.p85 >= 24 && required.p85 <= 26;
  const win19Ok = win19 >= 0.35 && win19 <= 0.55;
  return {
    win40: win40Ok,
    median: medianOk,
    p15: p15Ok,
    p85: p85Ok,
    win19: win19Ok,
    count: [win40Ok, medianOk, p15Ok, p85Ok, win19Ok].filter(Boolean).length
  };
}

async function main() {
  const rows = [];
  for (const candidate of CANDIDATES) {
    const config = candidate.variant();
    const cap19 = await runSimulation({
      level: 64, bot: 'mixed', games: GAMES, seedBase: SEED, mixedRate: MIXED_RATE,
      quiet: true, configOverride: config, cap: 19
    });
    const cap40 = await runSimulation({
      level: 64, bot: 'mixed', games: GAMES, seedBase: SEED, mixedRate: MIXED_RATE,
      quiet: true, configOverride: config, cap: 40
    });
    const required = requiredStepsFromSummary(cap40, 40);
    const target = targets(cap40.winRate, required, cap19.winRate);
    const row = {
      id: candidate.id,
      desc: candidate.desc,
      win19: cap19.winRate,
      win40: cap40.winRate,
      required,
      target
    };
    rows.push(row);
    console.log(`[scan] ${candidate.id}: cap19 ${(row.win19 * 100).toFixed(1)}%, ` +
      `cap40 ${(row.win40 * 100).toFixed(1)}%, req ${required.mean}/${required.median}/${required.p15}/${required.p85}, ` +
      `target ${target.count}/5 ${JSON.stringify(target)}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'lv64_scan.json'), JSON.stringify(rows, null, 2), 'utf8');
  const header = ['id', 'win19', 'win40', 'reqMean', 'reqMedian', 'reqP15', 'reqP85', 'targetMet', 'targetDetail'];
  const csv = [header.join(','), ...rows.map(r => [
    r.id, r.win19.toFixed(4), r.win40.toFixed(4), r.required.mean, r.required.median,
    r.required.p15, r.required.p85, r.target.count, JSON.stringify(r.target).replaceAll(',', ';')
  ].join(','))].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'lv64_scan.csv'), csv, 'utf8');
  console.log(`\n[scan] 输出: ${path.join(OUT_DIR, 'lv64_scan.csv')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
