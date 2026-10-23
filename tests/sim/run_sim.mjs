#!/usr/bin/env node
/**
 * run_sim.mjs - Node 无头关卡模拟器（复用真实引擎，不碰 DOM）
 *
 * 用法：
 *   node tests/sim/run_sim.mjs                       # 默认 2000 局，Lv62/Lv63 × random/greedy/mixed
 *   node tests/sim/run_sim.mjs --games 500 --seed 1042
 *   node tests/sim/run_sim.mjs --levels 63 --bots mixed --mixed-rate 0.5
 *
 * 口径：
 * - 每局使用固定初始棋盘（关卡配置），只改变补料/洗牌 seed（seedBase + 局号）；
 * - random：在所有合法交换中等概率选取；
 * - greedy：优先“推进目标”的交换（邻近罐子、覆盖果冻/蜂蜜、消除数多者）；
 * - mixed：每步以 mixedRate 概率走 greedy，否则 random（默认 0.5）；
 * - 激活口径以 jarResolution 事件为准：一次结算内 1 罐 = 单罐，2 罐 = 双罐/共鸣。
 *
 * 同参数同结果：机器人随机数使用独立 PRNG，引擎 seed 确定。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Match3Engine, GameState } from '../../js/engine/Match3Engine.js';
import { MatchFinder } from '../../js/engine/MatchFinder.js';
import { PRNG } from '../../js/engine/PRNG.js';
import { Level62Config } from '../../js/levels/level62.js';
import { Level63Config } from '../../js/levels/level63.js';
import { Level64Config } from '../../js/levels/level64.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');

const LEVELS = {
  62: Level62Config,
  63: Level63Config,
  64: Level64Config
};

const BOTS = ['random', 'greedy', 'mixed'];

// ---------------------------------------------------------------- 统计工具

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((sortedValues.length - 1) * p)));
  return sortedValues[index];
}

function summarizeNumbers(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const histogram = {};
  for (const value of values) histogram[value] = (histogram[value] || 0) + 1;
  return {
    mean: Number(mean(values).toFixed(3)),
    median: percentile(sorted, 0.5),
    p15: percentile(sorted, 0.15),
    p85: percentile(sorted, 0.85),
    min: sorted.length ? sorted[0] : 0,
    max: sorted.length ? sorted[sorted.length - 1] : 0,
    histogram
  };
}

// ---------------------------------------------------------------- 贪心评分

export function scoreMove(engine, move) {
  let score = 0;
  const matched = move.matchResult.matchedCells;
  score += matched.size * 5;

  const targets = engine.activeTargets || [];
  const honeyTarget = targets.find(target => target.type === 'CLEAR_HONEY');
  const jarTarget = targets.find(target => target.type === 'ACTIVATE_JAM_JAR');
  const honeyRemaining = honeyTarget ? honeyTarget.count - honeyTarget.current : 0;
  const jarRemaining = jarTarget ? jarTarget.count - jarTarget.current : 0;
  const runtimes = engine.customMechanics && engine.customMechanics.runtime
    ? Array.from(engine.customMechanics.runtime.values())
    : [];

  // 蜂蜜只能被“相邻消除”伤害；方向必须与关卡配置的 honeyDamageAdjacency 同步
  const honeyDirections = engine.config && engine.config.honeyDamageAdjacency === 'diagonal'
    ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]
    : [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const honeyHit = new Set();
  for (const key of matched) {
    const [r, c] = key.split(',').map(Number);
    const cell = engine.grid.getCell(r, c);
    if (!cell) continue;
    if (cell.underlay && cell.underlay.hp > 0) score += 30; // 果冻

    if (honeyRemaining > 0) {
      for (const [dr, dc] of honeyDirections) {
        const nr = r + dr;
        const nc = c + dc;
        if (!engine.grid.isValid(nr, nc)) continue;
        const neighbor = engine.grid.getCell(nr, nc);
        if (neighbor && neighbor.obstacle && neighbor.obstacle.type === 'HONEY' &&
          neighbor.obstacle.hp > 0) {
          honeyHit.add(`${nr},${nc}`);
        }
      }
    }

    if (jarRemaining > 0) {
      for (const runtime of runtimes) {
        if (runtime.completed) continue;
        const dr = Math.abs(r - runtime.pos.row);
        const dc = Math.abs(c - runtime.pos.col);
        if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
          score += 60; // 罐子邻近（与旧评分一致，避免改变 Lv62/Lv63 基线）
          if (runtime.charge >= runtime.maxCharge - 1) score += 80; // 即将满充优先
        }
      }
    }
  }

  // 每个会被本轮伤害的蜂蜜单独计分；HP=1 的蜂蜜优先
  for (const key of honeyHit) {
    score += 160;
    const [r, c] = key.split(',').map(Number);
    const cell = engine.grid.getCell(r, c);
    if (cell && cell.obstacle && cell.obstacle.hp === 1) score += 40;
  }

  return score;
}

function greedyMove(engine, moves) {
  let best = null;
  let bestScore = -Infinity;
  for (const move of moves) {
    const score = scoreMove(engine, move);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

function chooseMove(engine, moves, bot, rng, mixedRate) {
  if (bot === 'random') return moves[rng.nextInt(0, moves.length - 1)];
  if (bot === 'greedy') return greedyMove(engine, moves);
  // mixed：按比例混合
  if (rng.next() < mixedRate) return greedyMove(engine, moves);
  return moves[rng.nextInt(0, moves.length - 1)];
}

// ---------------------------------------------------------------- 单局模拟

/** 与 runSimulation 内保持一致的机器人随机种子 */
export function botRngSeed(bot, seedBase, gameIndex) {
  const botOffset = bot === 'random' ? 17 : bot === 'greedy' ? 29 : 43;
  return (seedBase * 7919 + gameIndex * 104729 + botOffset) >>> 0;
}

export async function simulateGame(config, bot, gameSeed, rngSeed, mixedRate, options = {}) {
  const engine = new Match3Engine({ ...config, seed: gameSeed, stepDelay: 0 });
  const rng = new PRNG(rngSeed);
  const diagnostics = options.diagnostics ? {
    resolutions: 0,
    rightEmptySamples: [],
    rightEmptyMax: 0,
    rightEmptySum: 0,
    col7EmptySamples: [],
    col7EmptyMax: 0,
    shuffles: [],
    jarActivations: 0,
    jarActivationSteps: [],
    jarLeaps: [],
    honeyClearStep: null,
    honeyDestroyed: [],
    moveLog: [],
    finalHoneyCells: [],
    finalTargets: [],
    portalStats: null
  } : null;
  const rightCols = options.rightCols || [5, 6, 7];
  const leftCols = options.leftCols || [0, 1, 2];
  let moveNumber = 0;

  const collectHoneyCells = () => {
    const result = [];
    for (let r = 0; r < engine.rows; r++) {
      for (let c = 0; c < engine.cols; c++) {
        const cell = engine.grid.getCell(r, c);
        if (cell.obstacle && cell.obstacle.type === 'HONEY' && cell.obstacle.hp > 0) {
          result.push(`${r},${c}`);
        }
      }
    }
    return result;
  };

  const collectHoneyHpTotal = () => {
    let total = 0;
    for (let r = 0; r < engine.rows; r++) {
      for (let c = 0; c < engine.cols; c++) {
        const cell = engine.grid.getCell(r, c);
        if (cell.obstacle && cell.obstacle.type === 'HONEY' && cell.obstacle.hp > 0) {
          total += cell.obstacle.hp;
        }
      }
    }
    return total;
  };

  const honeyPotential = (move, currentHoney) => {
    const directions = engine.config && engine.config.honeyDamageAdjacency === 'diagonal'
      ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]
      : [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const hit = new Set();
    for (const key of move.matchResult.matchedCells) {
      const [r, c] = key.split(',').map(Number);
      for (const [dr, dc] of directions) {
        const nr = r + dr;
        const nc = c + dc;
        if (currentHoney.has(`${nr},${nc}`)) hit.add(`${nr},${nc}`);
      }
    }
    return hit.size;
  };

  const countEmpty = (cols) => {
    let count = 0;
    for (let r = 0; r < engine.rows; r++) {
      for (const c of cols) {
        if (!engine.grid.isPlayable(r, c)) continue;
        const cell = engine.grid.getCell(r, c);
        if (cell.obstacle && cell.obstacle.blocksMovement) continue;
        if (cell.tile === null) count++;
      }
    }
    return count;
  };

  if (diagnostics) {
    if (engine.portalSystem && typeof engine.portalSystem.resetStats === 'function') {
      engine.portalSystem.resetStats();
    }
    let previousHoney = new Set(collectHoneyCells());
    engine.on('tilesCleared', () => {
      const current = new Set(collectHoneyCells());
      for (const key of previousHoney) {
        if (!current.has(key)) {
          const [row, col] = key.split(',').map(Number);
          diagnostics.honeyDestroyed.push({
            row,
            col,
            step: moveNumber,
            order: diagnostics.honeyDestroyed.length + 1
          });
        }
      }
      previousHoney = current;
    });
    engine.on('gravityApplied', () => {
      const rightEmpty = countEmpty(rightCols);
      const col7Empty = countEmpty([7]);
      diagnostics.resolutions++;
      diagnostics.rightEmptySamples.push(rightEmpty);
      diagnostics.rightEmptySum += rightEmpty;
      diagnostics.rightEmptyMax = Math.max(diagnostics.rightEmptyMax, rightEmpty);
      diagnostics.col7EmptySamples.push(col7Empty);
      diagnostics.col7EmptyMax = Math.max(diagnostics.col7EmptyMax, col7Empty);
    });
    engine.on('jarActivated', () => {
      diagnostics.jarActivations++;
      diagnostics.jarActivationSteps.push(moveNumber);
    });
    engine.on('jarLeap', (event) => {
      diagnostics.jarLeaps.push({
        step: moveNumber,
        jarId: event.jarId,
        from: { ...event.from },
        to: { ...event.to }
      });
    });
    engine.on('targetsUpdated', (event) => {
      if (diagnostics.honeyClearStep !== null) return;
      const honeyTarget = (event.targets || []).find(target => target.type === 'CLEAR_HONEY');
      if (honeyTarget && honeyTarget.current >= honeyTarget.count) {
        diagnostics.honeyClearStep = moveNumber;
      }
    });
    engine.on('boardShuffled', (event) => {
      diagnostics.shuffles.push({
        attempts: event && event.attempts ? event.attempts : null,
        leftEmpty: countEmpty(leftCols),
        rightEmpty: countEmpty(rightCols),
        col7Empty: countEmpty([7]),
        rightEntriesEmpty: [5, 6].filter(c => {
          const cell = engine.grid.getCell(0, c);
          return cell && cell.tile === null;
        }).length
      });
    });
  }

  let steps = 0;
  let cascadeSteps = 0;
  let multiCascadeSteps = 0;
  let shuffleCount = 0;
  let fuseCount = 0;
  const resolutions = [];

  engine.on('cascadeStep', () => { cascadeSteps++; });
  engine.on('boardShuffled', () => { shuffleCount++; });
  engine.on('error', (error) => {
    if (error && error.code === 'CASCADE_LIMIT_EXCEEDED') fuseCount++;
  });
  engine.on('jarResolution', (event) => {
    resolutions.push({
      mode: event.mode,
      jarIds: [...event.jarIds],
      resonance: !!event.resonance
    });
  });

  const maxStepsSafety = (config.maxMoves || 30) + 50;
  let safety = 0;

  while (engine.state === GameState.IDLE && engine.movesRemaining > 0 && safety++ < maxStepsSafety) {
    let moves = MatchFinder.findPossibleMoves(engine.grid);
    if (moves.length === 0) {
      engine.resolveDeadlock();
      if (!engine.hasPlayableMove()) break;
      moves = MatchFinder.findPossibleMoves(engine.grid);
    }

    const chosen = chooseMove(engine, moves, bot, rng, mixedRate);
    if (!chosen) break;

    cascadeSteps = 0;
    const movesBefore = engine.movesRemaining;
    moveNumber++;
    let moveMeta = null;
    if (diagnostics) {
      const honeySet = new Set(collectHoneyCells());
      const potential = honeyPotential(chosen, honeySet);
      let jarAdjacent = 0;
      const runtimes = engine.customMechanics?.runtime ? [...engine.customMechanics.runtime.values()] : [];
      for (const key of chosen.matchResult.matchedCells) {
        const [r, c] = key.split(',').map(Number);
        for (const rt of runtimes) {
          if (rt.completed) continue;
          const dr = Math.abs(r - rt.pos.row);
          const dc = Math.abs(c - rt.pos.col);
          if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
            jarAdjacent++;
            break;
          }
        }
      }
      moveMeta = {
        step: moveNumber,
        posA: { ...chosen.posA },
        posB: { ...chosen.posB },
        matched: chosen.matchResult.matchedCells.size,
        honeyPotential: potential,
        jarAdjacent,
        honeyHpBefore: collectHoneyHpTotal(),
        honeyDestroyedBefore: diagnostics.honeyDestroyed.length
      };
    }
    await engine.trySwap(chosen.posA, chosen.posB);
    if (diagnostics && moveMeta) {
      moveMeta.honeyHpDelta = moveMeta.honeyHpBefore - collectHoneyHpTotal();
      delete moveMeta.honeyHpBefore;
      moveMeta.honeyDestroyed = diagnostics.honeyDestroyed.length - moveMeta.honeyDestroyedBefore;
      moveMeta.honeyRemainingAfter = collectHoneyCells().length;
      moveMeta.category = moveMeta.honeyPotential > 0
        ? 'honey-adjacent'
        : moveMeta.jarAdjacent > 0 ? 'jar-adjacent' : 'generic';
      delete moveMeta.honeyDestroyedBefore;
      diagnostics.moveLog.push(moveMeta);
    }
    steps += Math.max(0, movesBefore - engine.movesRemaining);
    if (cascadeSteps >= 2) multiCascadeSteps++;
  }

  if (diagnostics) {
    diagnostics.finalHoneyCells = collectHoneyCells();
    const finalHoney = engine.activeTargets.find(target => target.type === 'CLEAR_HONEY');
    if (finalHoney && finalHoney.current >= finalHoney.count && diagnostics.honeyClearStep === null) {
      diagnostics.honeyClearStep = moveNumber;
    }
    diagnostics.finalTargets = engine.activeTargets.map(target => ({
      type: target.type,
      current: target.current,
      count: target.count
    }));
    diagnostics.portalStats = engine.portalSystem && engine.portalSystem.stats
      ? JSON.parse(JSON.stringify(engine.portalSystem.stats))
      : null;
  }

  return {
    win: engine.state === GameState.VICTORY,
    steps,
    remainingMoves: engine.movesRemaining,
    cascades: { steps, multi: multiCascadeSteps },
    shuffles: shuffleCount,
    fuses: fuseCount,
    resolutions,
    diagnostics
  };
}

// ---------------------------------------------------------------- 汇总

export async function runSimulation({
  level,
  bot,
  games = 2000,
  seedBase = 1042,
  mixedRate = 0.5,
  quiet = false,
  configOverride = null,
  cap = null
} = {}) {
  const baseConfig = configOverride || LEVELS[level];
  if (!baseConfig) throw new Error(`未知关卡: ${level}`);
  if (!BOTS.includes(bot)) throw new Error(`未知机器人: ${bot}`);
  const config = cap ? { ...baseConfig, maxMoves: cap } : baseConfig;

  const stepValues = [];
  const remainingOnWin = [];
  let wins = 0;
  let errors = 0;
  let totalSteps = 0;
  let totalMultiCascadeSteps = 0;
  let totalShuffles = 0;
  let gamesWithShuffle = 0;
  let totalFuses = 0;

  let totalResolutions = 0;
  let singleResolutions = 0;
  let dualResolutions = 0;
  let totalActivationEvents = 0;
  let resonanceResolutions = 0;
  let resonanceActivationEvents = 0;
  let gamesWithResonance = 0;
  const activationOrder = { singleA: 0, singleB: 0, dual: 0, other: 0 };
  const firstResolution = { A: 0, B: 0, dual: 0, none: 0 };

  for (let i = 0; i < games; i++) {
    const gameSeed = seedBase + i;
    const botSeed = (seedBase * 7919 + i * 104729 + (bot === 'random' ? 17 : bot === 'greedy' ? 29 : 43)) >>> 0;
    const result = await simulateGame(config, bot, gameSeed, botSeed, mixedRate);

    stepValues.push(result.steps);
    totalSteps += result.cascades.steps;
    totalMultiCascadeSteps += result.cascades.multi;
    totalShuffles += result.shuffles;
    if (result.shuffles > 0) gamesWithShuffle++;
    totalFuses += result.fuses;
    if (result.fuses > 0) errors++;
    if (result.win) {
      wins++;
      remainingOnWin.push(result.remainingMoves);
    }

    const resolutions = result.resolutions || [];
    totalResolutions += resolutions.length;
    for (const resolution of resolutions) {
      totalActivationEvents += resolution.jarIds.length;
      if (resolution.mode === 'dual') {
        dualResolutions++;
        activationOrder.dual += resolution.jarIds.length;
        if (resolution.resonance) {
          resonanceResolutions++;
          resonanceActivationEvents += resolution.jarIds.length;
          gamesWithResonance++;
        }
      } else {
        singleResolutions++;
        const jarId = resolution.jarIds[0];
        if (jarId === 'jar_63_a') activationOrder.singleA++;
        else if (jarId === 'jar_63_b') activationOrder.singleB++;
        else activationOrder.other++;
      }
    }

    if (resolutions.length > 0) {
      const first = resolutions[0];
      if (first.mode === 'dual') firstResolution.dual++;
      else if (first.jarIds[0] === 'jar_63_a') firstResolution.A++;
      else if (first.jarIds[0] === 'jar_63_b') firstResolution.B++;
      else firstResolution.none++;
    } else {
      firstResolution.none++;
    }
  }

  const stepSummary = summarizeNumbers(stepValues);
  const remainingSummary = summarizeNumbers(remainingOnWin);
  const cascadeRate = totalSteps > 0 ? totalMultiCascadeSteps / totalSteps : 0;

  const summary = {
    level: config.levelNumber,
    levelTitle: config.title,
    bot,
    games,
    seedBase,
    mixedRate,
    cap,
    winRate: wins / games,
    wins,
    losses: games - wins,
    errors,
    stepsUsed: stepSummary,
    remainingMovesOnWin: remainingSummary,
    cascade: {
      totalSteps,
      multiCascadeSteps: totalMultiCascadeSteps,
      rate: cascadeRate
    },
    shuffles: {
      total: totalShuffles,
      avgPerGame: totalShuffles / games,
      gamesWithShuffle
    },
    fuses: {
      total: totalFuses,
      games: errors
    },
    resolution: {
      total: totalResolutions,
      single: singleResolutions,
      dual: dualResolutions,
      totalActivationEvents,
      resonanceResolutions,
      resonanceActivationEvents,
      // 口径 1：含共鸣的对局占比
      resonanceGameRate: gamesWithResonance / games,
      // 口径 2：每次激活事件中属于共鸣的占比
      resonanceActivationShare: totalActivationEvents > 0
        ? resonanceActivationEvents / totalActivationEvents
        : 0
    },
    activationOrder,
    firstResolution,
    lv63: config.levelNumber === 63 ? {
      resonance: {
        games: gamesWithResonance,
        totalResolutions,
        gameRate: gamesWithResonance / games,
        activationShare: totalActivationEvents > 0 ? resonanceActivationEvents / totalActivationEvents : 0
      },
      activationOrder,
      firstResolution
    } : null
  };

  if (!quiet) {
    const resonanceInfo = summary.lv63
      ? `, resonance games ${(summary.lv63.resonance.gameRate * 100).toFixed(1)}%` +
        ` / activation share ${(summary.lv63.resonance.activationShare * 100).toFixed(1)}%`
      : '';
    console.log(`[sim] Lv${summary.level} ${bot}: ${wins}/${games} wins (${(summary.winRate * 100).toFixed(1)}%), ` +
      `steps mean ${stepSummary.mean}, remaining median ${remainingSummary.median}, ` +
      `cascade ${(cascadeRate * 100).toFixed(1)}%${resonanceInfo}, shuffles ${totalShuffles}, fuses ${totalFuses}`);
  }

  return summary;
}

// ---------------------------------------------------------------- 输出

function writeOutputs(summaries, tag = '') {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const index = {};
  for (const summary of summaries) {
    const key = `lv${summary.level}_${summary.bot}${tag}`;
    index[key] = summary;
    fs.writeFileSync(path.join(OUT_DIR, `${key}.json`), JSON.stringify(summary, null, 2), 'utf8');
  }

  const header = [
    'level', 'bot', 'games', 'wins', 'winRate', 'mixedRate',
    'stepsMean', 'stepsMedian', 'stepsP15', 'stepsP85',
    'remainingMean', 'remainingMedian', 'remainingP15', 'remainingP85',
    'cascadeRate', 'shuffleTotal', 'shuffleAvgPerGame', 'fuseGames',
    'resonanceGameRate', 'resonanceActivationShare', 'resonanceResolutions',
    'dualResolutions', 'singleA', 'singleB', 'firstA', 'firstB', 'firstDual'
  ];
  const rows = summaries.map(s => [
    s.level, s.bot, s.games, s.wins, s.winRate.toFixed(4), s.mixedRate,
    s.stepsUsed.mean, s.stepsUsed.median, s.stepsUsed.p15, s.stepsUsed.p85,
    s.remainingMovesOnWin.mean, s.remainingMovesOnWin.median, s.remainingMovesOnWin.p15, s.remainingMovesOnWin.p85,
    s.cascade.rate.toFixed(4), s.shuffles.total, s.shuffles.avgPerGame.toFixed(3), s.fuses.games,
    s.lv63 ? s.lv63.resonance.gameRate.toFixed(4) : '',
    s.lv63 ? s.lv63.resonance.activationShare.toFixed(4) : '',
    s.lv63 ? s.lv63.resonance.totalResolutions : '',
    s.lv63 ? s.activationOrder.dual : '',
    s.lv63 ? s.activationOrder.singleA : '',
    s.lv63 ? s.activationOrder.singleB : '',
    s.lv63 ? s.firstResolution.A : '',
    s.lv63 ? s.firstResolution.B : '',
    s.lv63 ? s.firstResolution.dual : ''
  ]);
  fs.writeFileSync(path.join(OUT_DIR, `metrics${tag ? '_' + tag : ''}.csv`),
    [header.join(','), ...rows.map(r => r.join(','))].join('\n'), 'utf8');

  // cap 覆盖跑只输出 JSON/CSV，不覆盖主 baseline 的 summary.js
  if (!tag) {
    fs.writeFileSync(path.join(OUT_DIR, 'summary.js'),
      `window.SIM_DATA = ${JSON.stringify(summaries.reduce((acc, s) => {
        acc[`lv${s.level}_${s.bot}`] = s;
        return acc;
      }, {}), null, 2)};\n`, 'utf8');
  }

  return index;
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const args = { games: 2000, seed: 1042, levels: [62, 63, 64], bots: [...BOTS], mixedRate: 0.5, cap: null };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--games') { args.games = Number(value); i++; }
    else if (key === '--seed') { args.seed = Number(value); i++; }
    else if (key === '--levels') { args.levels = value.split(',').map(Number); i++; }
    else if (key === '--bots') { args.bots = value.split(','); i++; }
    else if (key === '--mixed-rate') { args.mixedRate = Number(value); i++; }
    else if (key === '--cap') { args.cap = Number(value); i++; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[sim] games=${args.games}, seed=${args.seed}, levels=${args.levels.join(',')}, ` +
    `bots=${args.bots.join(',')}, mixedRate=${args.mixedRate}` +
    (args.cap ? `, cap=${args.cap}` : ''));
  const summaries = [];
  for (const level of args.levels) {
    for (const bot of args.bots) {
      summaries.push(await runSimulation({
        level, bot, games: args.games, seedBase: args.seed, mixedRate: args.mixedRate, cap: args.cap
      }));
    }
  }
  const tag = args.cap ? `cap${args.cap}` : '';
  const index = writeOutputs(summaries, tag);
  console.log(`[sim] 输出目录: ${OUT_DIR}`);
  console.log(`[sim] 文件: ${Object.keys(index).map(k => `${k}.json`).join(', ')}, ` +
    `metrics${tag ? '_' + tag : ''}.csv, summary.js`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
