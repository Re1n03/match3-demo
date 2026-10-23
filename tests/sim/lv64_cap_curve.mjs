#!/usr/bin/env node
/** lv64_cap_curve.mjs - Lv64 mixed 步数上限曲线（N=2000） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSimulation } from './run_sim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
const GAMES = Number(process.env.SIM_GAMES || 2000);
const CAPS = [19, 21, 24, 30];

async function main() {
  const rows = [];
  for (const cap of CAPS) {
    const summary = await runSimulation({
      level: 64, bot: 'mixed', games: GAMES, seedBase: 1042, mixedRate: 0.5, quiet: true, cap
    });
    const row = {
      cap,
      wins: summary.wins,
      winRate: summary.winRate,
      stepsMean: summary.stepsUsed.mean,
      stepsMedian: summary.stepsUsed.median,
      remainingMedian: summary.remainingMovesOnWin.median
    };
    rows.push(row);
    console.log(`[curve] cap=${cap}: ${summary.wins}/${GAMES} (${(summary.winRate * 100).toFixed(2)}%), ` +
      `steps mean/median ${summary.stepsUsed.mean}/${summary.stepsUsed.median}`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'lv64_cap_curve.json'), JSON.stringify(rows, null, 2), 'utf8');
  const header = ['cap', 'wins', 'games', 'winRate', 'stepsMean', 'stepsMedian', 'remainingMedian'];
  const csv = [header.join(','), ...rows.map(r => [r.cap, r.wins, GAMES, r.winRate.toFixed(4), r.stepsMean, r.stepsMedian, r.remainingMedian].join(','))].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'lv64_cap_curve.csv'), csv, 'utf8');
  console.log(`[curve] 输出: ${path.join(OUT_DIR, 'lv64_cap_curve.csv')}`);
}
main().catch(e => { console.error(e); process.exit(1); });
