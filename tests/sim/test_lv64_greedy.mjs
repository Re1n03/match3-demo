#!/usr/bin/env node
/**
 * test_lv64_greedy.mjs - 验证 Lv64 greedy 评分确实会按蜂蜜目标选步
 * （旧实现检查蜂蜜自身格，该格永远没有棋子，蜂蜜评分从未生效）
 */

import { Match3Engine } from '../../js/engine/Match3Engine.js';
import { MatchFinder } from '../../js/engine/MatchFinder.js';
import { Level64Config } from '../../js/levels/level64.js';
import { scoreMove } from './run_sim.mjs';

const engine = new Match3Engine({ ...Level64Config, stepDelay: 0 });
const moves = MatchFinder.findPossibleMoves(engine.grid);

function honeyHits(move) {
  const set = new Set();
  for (const key of move.matchResult.matchedCells) {
    const [r, c] = key.split(',').map(Number);
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (!engine.grid.isValid(nr, nc)) continue;
      const cell = engine.grid.getCell(nr, nc);
      if (cell && cell.obstacle && cell.obstacle.type === 'HONEY' && cell.obstacle.hp > 0) {
        set.add(`${nr},${nc}`);
      }
    }
  }
  return set;
}

let best = null;
let maxHoney = -Infinity;
let maxNonHoney = -Infinity;
for (const move of moves) {
  const score = scoreMove(engine, move);
  const hits = honeyHits(move);
  if (hits.size > 0) maxHoney = Math.max(maxHoney, score);
  else maxNonHoney = Math.max(maxNonHoney, score);
  if (!best || score > best.score) best = { score, hits, move };
}

const ok = best && best.hits.size > 0 && maxHoney > maxNonHoney;
console.log(`[${ok ? 'PASS' : 'FAIL'}] greedy 蜂蜜/目标评分: best=${best ? best.score : 0}, ` +
  `honeyHits=${best ? best.hits.size : 0}, maxHoney=${maxHoney}, maxNonHoney=${maxNonHoney}, ` +
  `moves=${moves.length}`);

// 评分方向必须与关卡 honeyDamageAdjacency 同步：
// (5,5) 与蜂蜜 (6,6) 仅斜邻；正交模式不加蜂蜜分，diagonal 模式必须加。
const probeMove = { matchResult: { matchedCells: new Set(['5,5']) } };
engine.config.honeyDamageAdjacency = 'orthogonal';
const orthogonalScore = scoreMove(engine, probeMove);
engine.config.honeyDamageAdjacency = 'diagonal';
const diagonalScore = scoreMove(engine, probeMove);
const adjacencyOk = diagonalScore > orthogonalScore;
console.log(`[${adjacencyOk ? 'PASS' : 'FAIL'}] greedy 蜂蜜方向同步: orthogonal=${orthogonalScore}, diagonal=${diagonalScore}`);
if (!adjacencyOk) process.exit(1);
if (!ok) process.exit(1);
