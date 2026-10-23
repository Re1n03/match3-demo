#!/usr/bin/env node
/**
 * lv64_cap_analysis.mjs - Lv64 步数上限基线（cap=19 vs cap=40）
 *
 * - cap=19：正常关卡步数上限，统计失败局；
 * - cap=40：扩展步数上限，记录“通关所需步数”分布；
 * - 对 cap=19 失败局，用同 seed/bot 的 cap=40 结果判断“所需步数 - 19”≤2 / ≤5 的惜败窗口；
 *   cap=40 仍失败的对局按 >5 计入分母（无法确定所需步数）。
 *
 * 输出：tests/sim/out/lv64_cap_analysis.json / lv64_cap_analysis.csv
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
const BOTS = ['random', 'greedy', 'mixed'];
const MIXED_RATE = 0.5;

function summarize(values) {
  if (!values.length) return { mean: 0, median: 0, p15: 0, p85: 0, min: 0, max: 0, histogram: {} };
  const sorted = [...values].sort((a, b) => a - b);
  const pick = p => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))];
  const histogram = {};
  for (const value of values) histogram[value] = (histogram[value] || 0) + 1;
  return {
    mean: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)),
    median: pick(0.5),
    p15: pick(0.15),
    p85: pick(0.85),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    histogram
  };
}

async function main() {
  const rows = [];
  const detail = {};

  for (const bot of BOTS) {
    const cap19Results = [];
    const cap40Results = [];
    for (let i = 0; i < GAMES; i++) {
      const gameSeed = SEED + i;
      const rngSeed = botRngSeed(bot, SEED, i);
      const config19 = { ...Level64Config, maxMoves: 19, stepDelay: 0 };
      const config40 = { ...Level64Config, maxMoves: 40, stepDelay: 0 };
      const result19 = await simulateGame(config19, bot, gameSeed, rngSeed, MIXED_RATE);
      const result40 = await simulateGame(config40, bot, gameSeed, rngSeed, MIXED_RATE);
      cap19Results.push(result19);
      cap40Results.push(result40);
    }

    const cap19Wins = cap19Results.filter(r => r.win).length;
    const cap19Losses = GAMES - cap19Wins;
    const cap40Wins = cap40Results.filter(r => r.win).length;
    const requiredSteps = cap40Results.filter(r => r.win).map(r => r.steps);

    let lossWindows2 = 0;
    let lossWindows5 = 0;
    let lossUnknown = 0;
    for (let i = 0; i < GAMES; i++) {
      if (cap19Results[i].win) continue;
      if (cap40Results[i].win) {
        const deficit = cap40Results[i].steps - 19;
        if (deficit <= 2) lossWindows2++;
        if (deficit <= 5) lossWindows5++;
      } else {
        lossUnknown++;
      }
    }

    const row = {
      bot,
      games: GAMES,
      cap19Wins,
      cap19WinRate: cap19Wins / GAMES,
      cap19Losses,
      cap40Wins,
      cap40WinRate: cap40Wins / GAMES,
      requiredSteps: summarize(requiredSteps),
      nearMiss: {
        cap19Losses,
        winWithin2: lossWindows2,
        winWithin5: lossWindows5,
        unknownBeyond40: lossUnknown,
        within2Rate: cap19Losses ? lossWindows2 / cap19Losses : 0,
        within5Rate: cap19Losses ? lossWindows5 / cap19Losses : 0
      }
    };
    rows.push(row);
    detail[bot] = row;
    console.log(`[cap] ${bot}: cap19 win ${(row.cap19WinRate * 100).toFixed(1)}% (${cap19Wins}/${GAMES}), ` +
      `cap40 win ${(row.cap40WinRate * 100).toFixed(1)}% (${cap40Wins}/${GAMES}), ` +
      `required median ${row.requiredSteps.median}, ` +
      `near-miss <=2 ${(row.nearMiss.within2Rate * 100).toFixed(1)}% / <=5 ${(row.nearMiss.within5Rate * 100).toFixed(1)}% ` +
      `(unknown ${lossUnknown})`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'lv64_cap_analysis.json'), JSON.stringify(detail, null, 2), 'utf8');

  const header = ['bot', 'games', 'cap19Wins', 'cap19WinRate', 'cap19Losses', 'cap40Wins', 'cap40WinRate',
    'requiredMean', 'requiredMedian', 'requiredP15', 'requiredP85',
    'near2', 'near5', 'unknownBeyond40', 'near2Rate', 'near5Rate'];
  const csv = [header.join(','), ...rows.map(r => [
    r.bot, r.games, r.cap19Wins, r.cap19WinRate.toFixed(4), r.cap19Losses,
    r.cap40Wins, r.cap40WinRate.toFixed(4),
    r.requiredSteps.mean, r.requiredSteps.median, r.requiredSteps.p15, r.requiredSteps.p85,
    r.nearMiss.winWithin2, r.nearMiss.winWithin5, r.nearMiss.unknownBeyond40,
    r.nearMiss.within2Rate.toFixed(4), r.nearMiss.within5Rate.toFixed(4)
  ].join(','))].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'lv64_cap_analysis.csv'), csv, 'utf8');
  console.log(`[cap] 输出: ${path.join(OUT_DIR, 'lv64_cap_analysis.csv')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
