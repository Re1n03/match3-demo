#!/usr/bin/env node
/**
 * diagnose_greedy_stuck.mjs - greedy 在 B 组 diagonal cap40 下停在 2/4 蜂蜜的只读诊断
 * 输出：剩余蜂蜜坐标分布、停滞阶段走法类型、重复交换/无蜂蜜进展走法。
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
const config = { ...Level64Config, maxMoves: 40, stepDelay: 0 };

async function main() {
  const honeyCoords = ['6,6', '6,7', '7,6', '7,7'];
  const remainingDistribution = Object.fromEntries(honeyCoords.map(k => [k, 0]));
  const remainingPairDistribution = {};
  const categoryCounts = { 'honey-adjacent': 0, 'jar-adjacent': 0, generic: 0 };
  let stuckGames = 0;
  let phaseMoves = 0;
  let noHoneyProgressMoves = 0;
  let honeyDamagedButNotDestroyedMoves = 0;
  let repeatedSwapEvents = 0;
  let gamesWithRepeat = 0;
  let maxRepeatInGame = 0;
  let gamesWithJarCompleted = 0;

  for (let i = 0; i < GAMES; i++) {
    const game = await simulateGame(
      config, 'greedy', SEED + i, botRngSeed('greedy', SEED, i), 0.5,
      { diagnostics: true }
    );
    const honeyTarget = game.diagnostics.finalTargets.find(t => t.type === 'CLEAR_HONEY');
    if (!honeyTarget || honeyTarget.current !== 2) continue;
    stuckGames++;

    const finalHoney = [...game.diagnostics.finalHoneyCells].sort();
    for (const key of finalHoney) {
      remainingDistribution[key] = (remainingDistribution[key] || 0) + 1;
    }
    const pairKey = finalHoney.join('+');
    remainingPairDistribution[pairKey] = (remainingPairDistribution[pairKey] || 0) + 1;

    if (game.diagnostics.jarActivationSteps.length >= 2) gamesWithJarCompleted++;

    const destroyed = game.diagnostics.honeyDestroyed;
    const secondStep = destroyed.length >= 2 ? destroyed[1].step : 0;
    const phase = game.diagnostics.moveLog.filter(move => move.step > secondStep);
    phaseMoves += phase.length;

    const swapCounts = new Map();
    for (const move of phase) {
      categoryCounts[move.category] = (categoryCounts[move.category] || 0) + 1;
      if (move.honeyHpDelta === 0) noHoneyProgressMoves++;
      if (move.honeyHpDelta > 0 && move.honeyDestroyed === 0) honeyDamagedButNotDestroyedMoves++;
      const a = `${move.posA.row},${move.posA.col}`;
      const b = `${move.posB.row},${move.posB.col}`;
      const key = [a, b].sort().join('|');
      swapCounts.set(key, (swapCounts.get(key) || 0) + 1);
    }
    let gameMaxRepeat = 0;
    for (const count of swapCounts.values()) {
      if (count > 1) {
        repeatedSwapEvents += count - 1;
        gameMaxRepeat = Math.max(gameMaxRepeat, count);
      }
    }
    if (gameMaxRepeat > 1) gamesWithRepeat++;
    maxRepeatInGame = Math.max(maxRepeatInGame, gameMaxRepeat);
  }

  const summary = {
    games: GAMES,
    bot: 'greedy',
    cap: 40,
    honeyDamageAdjacency: Level64Config.honeyDamageAdjacency,
    stuckGames,
    stuckRate: stuckGames / GAMES,
    remainingDistribution,
    remainingDistributionRate: Object.fromEntries(
      Object.entries(remainingDistribution).map(([k, v]) => [k, stuckGames ? v / stuckGames : 0])
    ),
    remainingPairDistribution,
    gamesWithJarCompleted,
    phaseMoves,
    avgPhaseMoves: stuckGames ? phaseMoves / stuckGames : 0,
    categoryCounts,
    noHoneyProgressMoves,
    noHoneyProgressRate: phaseMoves ? noHoneyProgressMoves / phaseMoves : 0,
    honeyDamagedButNotDestroyedMoves,
    honeyDamagedButNotDestroyedRate: phaseMoves ? honeyDamagedButNotDestroyedMoves / phaseMoves : 0,
    repeatedSwapEvents,
    gamesWithRepeat,
    gamesWithRepeatRate: stuckGames ? gamesWithRepeat / stuckGames : 0,
    maxRepeatInGame
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'greedy_stuck_diagnostics.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
