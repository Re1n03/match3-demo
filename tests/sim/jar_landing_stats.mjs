#!/usr/bin/env node
/**
 * jar_landing_stats.mjs - 罐子起跳落点实测
 * - Lv62：N=2000，首次（唯一）起跳落点；
 * - Lv64 mixed cap40：N=2000，第1/2次起跳落点分布。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Level62Config } from '../../js/levels/level62.js';
import { Level64Config } from '../../js/levels/level64.js';
import { simulateGame, botRngSeed } from './run_sim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
const GAMES = Number(process.env.SIM_GAMES || 2000);
const SEED = 1042;

function addDistribution(distribution, key) {
  distribution[key] = (distribution[key] || 0) + 1;
}

async function lv62() {
  const config = { ...Level62Config, stepDelay: 0 };
  const distribution = {};
  let gamesWithLeap = 0;
  for (let i = 0; i < GAMES; i++) {
    const game = await simulateGame(
      config, 'mixed', SEED + i, botRngSeed('mixed', SEED, i), 0.5, { diagnostics: true }
    );
    const leaps = game.diagnostics.jarLeaps;
    if (leaps.length >= 1) {
      gamesWithLeap++;
      addDistribution(distribution, `${leaps[0].to.row},${leaps[0].to.col}`);
    }
  }
  return { games: GAMES, bot: 'mixed', cap: config.maxMoves, gamesWithLeap, distribution };
}

async function lv64() {
  const config = { ...Level64Config, maxMoves: 40, stepDelay: 0 };
  const first = {};
  const second = {};
  let gamesWithFirst = 0;
  let gamesWithSecond = 0;
  for (let i = 0; i < GAMES; i++) {
    const game = await simulateGame(
      config, 'mixed', SEED + i, botRngSeed('mixed', SEED, i), 0.5, { diagnostics: true }
    );
    const leaps = game.diagnostics.jarLeaps;
    if (leaps.length >= 1) {
      gamesWithFirst++;
      addDistribution(first, `${leaps[0].to.row},${leaps[0].to.col}`);
    }
    if (leaps.length >= 2) {
      gamesWithSecond++;
      addDistribution(second, `${leaps[1].to.row},${leaps[1].to.col}`);
    }
  }
  return { games: GAMES, bot: 'mixed', cap: 40, gamesWithFirst, first, gamesWithSecond, second };
}

function toCsvRow(label, dist, total) {
  return Object.entries(dist)
    .sort((a, b) => b[1] - a[1])
    .map(([coord, count]) => `${label},${coord},${count},${(count / total).toFixed(4)}`)
    .join('\n');
}

async function main() {
  const result = { lv62: await lv62(), lv64: await lv64() };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'jar_landing_stats.json'), JSON.stringify(result, null, 2), 'utf8');
  const header = 'level,activation,coord,count,rate';
  const rows = [
    toCsvRow('Lv62,1', result.lv62.distribution, result.lv62.gamesWithLeap),
    toCsvRow('Lv64,1', result.lv64.first, result.lv64.gamesWithFirst),
    toCsvRow('Lv64,2', result.lv64.second, result.lv64.gamesWithSecond)
  ].filter(Boolean);
  fs.writeFileSync(path.join(OUT_DIR, 'jar_landing_stats.csv'), [header, ...rows].join('\n'), 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
