#!/usr/bin/env node
/**
 * diagnose_lv64.mjs - Lv64 诊断（cap=40，N=2000）
 *
 * 只采样、不改玩法逻辑：
 * 1. 目标漏斗：罐子激活 ≥1/≥2、蜂蜜破坏 0..4 的对局占比；
 * 2. 右岛健康：每次重力结算后右岛空格均值/最大、第7列空格、入口接料、出口无料；
 * 3. 洗牌触发时左右岛空格快照；
 * 4. random/greedy/mixed 目标推进对比，用于定位 greedy 评分问题。
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

async function main() {
  const config = { ...Level64Config, maxMoves: 40, stepDelay: 0 };
  const result = { games: GAMES, seed: SEED, cap: 40, bots: {} };

  for (const bot of BOTS) {
    const agg = {
      wins: 0,
      jarAtLeast1: 0,
      jarAtLeast2: 0,
      honeyDestroyed: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 },
      resolutions: 0,
      rightEmptySum: 0,
      rightEmptyMax: 0,
      col7EmptySum: 0,
      col7EmptyMax: 0,
      gamesWithShuffle: 0,
      shuffleEvents: 0,
      shuffleLeftEmptySum: 0,
      shuffleRightEmptySum: 0,
      shuffleRightEntriesEmptySum: 0,
      shuffleCol7EmptySum: 0,
      entryFeeds: {},
      exitNoSupply: 0,
      portalTransfers: 0
    };

    for (let i = 0; i < GAMES; i++) {
      const game = await simulateGame(
        config,
        bot,
        SEED + i,
        botRngSeed(bot, SEED, i),
        0.5,
        { diagnostics: true, rightCols: [5, 6, 7], leftCols: [0, 1, 2] }
      );
      const d = game.diagnostics;
      if (game.win) agg.wins++;
      if (d.jarActivations >= 1) agg.jarAtLeast1++;
      if (d.jarActivations >= 2) agg.jarAtLeast2++;

      const honeyTarget = d.finalTargets.find(t => t.type === 'CLEAR_HONEY');
      const honeyDestroyed = honeyTarget ? honeyTarget.current : 0;
      agg.honeyDestroyed[honeyDestroyed] = (agg.honeyDestroyed[honeyDestroyed] || 0) + 1;

      agg.resolutions += d.resolutions;
      agg.rightEmptySum += d.rightEmptySum;
      agg.rightEmptyMax = Math.max(agg.rightEmptyMax, d.rightEmptyMax);
      agg.col7EmptySum += d.col7EmptySamples.reduce((a, b) => a + b, 0);
      agg.col7EmptyMax = Math.max(agg.col7EmptyMax, d.col7EmptyMax);

      if (d.shuffles.length > 0) {
        agg.gamesWithShuffle++;
        agg.shuffleEvents += d.shuffles.length;
        for (const shuffle of d.shuffles) {
          agg.shuffleLeftEmptySum += shuffle.leftEmpty;
          agg.shuffleRightEmptySum += shuffle.rightEmpty;
          agg.shuffleRightEntriesEmptySum += shuffle.rightEntriesEmpty;
          agg.shuffleCol7EmptySum += shuffle.col7Empty;
        }
      }

      if (d.portalStats) {
        for (const [key, count] of Object.entries(d.portalStats.entryFeeds || {})) {
          agg.entryFeeds[key] = (agg.entryFeeds[key] || 0) + count;
        }
        agg.exitNoSupply += d.portalStats.exitNoSupply || 0;
        agg.portalTransfers += d.portalStats.transferCount || 0;
      }
    }

    const summary = {
      games: GAMES,
      wins: agg.wins,
      winRate: agg.wins / GAMES,
      jarAtLeast1: agg.jarAtLeast1,
      jarAtLeast1Rate: agg.jarAtLeast1 / GAMES,
      jarAtLeast2: agg.jarAtLeast2,
      jarAtLeast2Rate: agg.jarAtLeast2 / GAMES,
      honeyDestroyed: agg.honeyDestroyed,
      honeyDestroyedRate: Object.fromEntries(Object.entries(agg.honeyDestroyed).map(([k, v]) => [k, v / GAMES])),
      resolutions: agg.resolutions,
      rightEmptyMean: agg.resolutions ? agg.rightEmptySum / agg.resolutions : 0,
      rightEmptyMax: agg.rightEmptyMax,
      col7EmptyMean: agg.resolutions ? agg.col7EmptySum / agg.resolutions : 0,
      col7EmptyMax: agg.col7EmptyMax,
      gamesWithShuffle: agg.gamesWithShuffle,
      gamesWithShuffleRate: agg.gamesWithShuffle / GAMES,
      shuffleEvents: agg.shuffleEvents,
      shuffleLeftEmptyMean: agg.shuffleEvents ? agg.shuffleLeftEmptySum / agg.shuffleEvents : 0,
      shuffleRightEmptyMean: agg.shuffleEvents ? agg.shuffleRightEmptySum / agg.shuffleEvents : 0,
      shuffleRightEntriesEmptyMean: agg.shuffleEvents ? agg.shuffleRightEntriesEmptySum / agg.shuffleEvents : 0,
      shuffleCol7EmptyMean: agg.shuffleEvents ? agg.shuffleCol7EmptySum / agg.shuffleEvents : 0,
      entryFeeds: agg.entryFeeds,
      entryFeedTotal: Object.values(agg.entryFeeds).reduce((a, b) => a + b, 0),
      exitNoSupply: agg.exitNoSupply,
      portalTransfers: agg.portalTransfers
    };
    result.bots[bot] = summary;

    console.log(`\n=== ${bot} (cap40, N=${GAMES}) ===`);
    console.log(`win ${(summary.winRate * 100).toFixed(1)}%, jar>=1 ${(summary.jarAtLeast1Rate * 100).toFixed(1)}%, ` +
      `jar>=2 ${(summary.jarAtLeast2Rate * 100).toFixed(1)}%`);
    console.log('honey destroyed distribution:', summary.honeyDestroyed,
      Object.fromEntries(Object.entries(summary.honeyDestroyedRate).map(([k, v]) => [k, (v * 100).toFixed(1) + '%'])));
    console.log(`right empty mean/max ${summary.rightEmptyMean.toFixed(2)}/${summary.rightEmptyMax}, ` +
      `col7 empty mean/max ${summary.col7EmptyMean.toFixed(2)}/${summary.col7EmptyMax}, ` +
      `entry feeds ${JSON.stringify(summary.entryFeeds)} (total ${summary.entryFeedTotal}), ` +
      `exitNoSupply ${summary.exitNoSupply}, transfers ${summary.portalTransfers}`);
    console.log(`shuffle games ${summary.gamesWithShuffle} (${(summary.gamesWithShuffleRate * 100).toFixed(1)}%), ` +
      `events ${summary.shuffleEvents}, at shuffle left/right empty ${summary.shuffleLeftEmptyMean.toFixed(2)}/` +
      `${summary.shuffleRightEmptyMean.toFixed(2)}, rightEntriesEmpty ${summary.shuffleRightEntriesEmptyMean.toFixed(2)}, ` +
      `col7Empty ${summary.shuffleCol7EmptyMean.toFixed(2)}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'lv64_diagnostics.json'), JSON.stringify(result, null, 2), 'utf8');

  const header = ['bot', 'games', 'winRate', 'jar1Rate', 'jar2Rate',
    'honey0', 'honey1', 'honey2', 'honey3', 'honey4',
    'rightEmptyMean', 'rightEmptyMax', 'col7EmptyMean', 'col7EmptyMax',
    'entryFeed0', 'entryFeed1', 'exitNoSupply',
    'shuffleGames', 'shuffleEvents', 'shuffleLeftEmptyMean', 'shuffleRightEmptyMean'];
  const rows = BOTS.map(bot => {
    const s = result.bots[bot];
    return [bot, s.games, s.winRate.toFixed(4), s.jarAtLeast1Rate.toFixed(4), s.jarAtLeast2Rate.toFixed(4),
      ...['0', '1', '2', '3', '4'].map(k => s.honeyDestroyed[k] || 0),
      s.rightEmptyMean.toFixed(2), s.rightEmptyMax, s.col7EmptyMean.toFixed(2), s.col7EmptyMax,
      s.entryFeeds['0,5'] || 0, s.entryFeeds['0,6'] || 0, s.exitNoSupply,
      s.gamesWithShuffle, s.shuffleEvents, s.shuffleLeftEmptyMean.toFixed(2), s.shuffleRightEmptyMean.toFixed(2)];
  });
  fs.writeFileSync(path.join(OUT_DIR, 'lv64_diagnostics.csv'),
    [header.join(','), ...rows.map(r => r.join(','))].join('\n'), 'utf8');
  console.log(`\n[diagnose] 输出: ${path.join(OUT_DIR, 'lv64_diagnostics.csv')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
