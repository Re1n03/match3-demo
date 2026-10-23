#!/usr/bin/env node
/**
 * solve_lv62.mjs - Lv62 (8x8) 关卡约束穷举验证脚本
 *
 * 验证目标：
 * 1. 开局无现成三消，且全盘只有 1 个合法交换（坐标必须等于 Level62Config.firstMove）；
 * 2. 该唯一交换使罐体由 initialCharge=2 充满至 3/3 并起跳，落点为裸露普通格；
 * 3. 爆浆后必然触发至少一次自发连消，目标达成并通关，稳定后棋盘无永久空格。
 *
 * 用法：node tests/solve_lv62.mjs
 * 退出码：0 = 全部约束满足；1 = 存在不满足项（便于 CI / 人工复核）
 */

import { Match3Engine, GameState } from '../js/engine/Match3Engine.js';
import { MatchFinder } from '../js/engine/MatchFinder.js';
import { JamJarConfig, JamJarBlastScope } from '../js/mechanics/JamJarConfig.js';
import { Level62Config } from '../js/levels/level62.js';

const failures = [];
const log = (...args) => console.log(...args);
const check = (name, condition, detail = '') => {
  if (condition) log(`[PASS] ${name}${detail ? ' -> ' + detail : ''}`);
  else {
    failures.push(name);
    log(`[FAIL] ${name}${detail ? ' -> ' + detail : ''}`);
  }
};

log('==========================================================');
log('Lv62 8x8 约束求解验证 (Seed #1042)');
log('==========================================================');

// 0. 配置
const engine = new Match3Engine({ ...Level62Config, stepDelay: 0 });
check('棋盘尺寸 8x8', engine.rows === 8 && engine.cols === 8, `${engine.rows}x${engine.cols}`);
check('4 色 / 22 步 / Seed #1042', engine.colors.length === 4 && engine.movesRemaining === 22 && engine.seed === 1042,
  `colors=${engine.colors.length}, moves=${engine.movesRemaining}, seed=${engine.seed}`);
const jarCell = engine.grid.getCell(Level62Config.jarInitialPos.row, Level62Config.jarInitialPos.col);
const jarTile = jarCell && jarCell.tile;
check('initialCharge=2 已写入罐体', !!jarTile && jarTile.charge === 2 && jarTile.maxCharge === 3,
  `charge=${jarTile ? jarTile.charge : 'none'}/${jarTile ? jarTile.maxCharge : '?'}`);

// 1. 开局 0 三消 & 唯一合法交换
const initialMatches = MatchFinder.findMatches(engine.grid);
check('开局无现成三消', initialMatches.matches.length === 0, `matches=${initialMatches.matches.length}`);

const possibleMoves = MatchFinder.findPossibleMoves(engine.grid);
const expectedMove = Level62Config.firstMove;
const moveMatchesExpected = possibleMoves.length === 1 && (
  (possibleMoves[0].posA.row === expectedMove.from.row && possibleMoves[0].posA.col === expectedMove.from.col &&
    possibleMoves[0].posB.row === expectedMove.to.row && possibleMoves[0].posB.col === expectedMove.to.col) ||
  (possibleMoves[0].posA.row === expectedMove.to.row && possibleMoves[0].posA.col === expectedMove.to.col &&
    possibleMoves[0].posB.row === expectedMove.from.row && possibleMoves[0].posB.col === expectedMove.from.col)
);
check('全盘仅 1 个合法交换且等于配置首步', moveMatchesExpected,
  possibleMoves.length === 1
    ? `(${possibleMoves[0].posA.row},${possibleMoves[0].posA.col})<->(${possibleMoves[0].posB.row},${possibleMoves[0].posB.col})`
    : `moves=${possibleMoves.length}`);

// 2/3. 执行唯一首步，验证充能、起跳、落点、爆浆、连消、目标、无空洞
const cascadeSteps = [];
let active = false;
let leap = null;
let landingBare = false;
let blastCount = 0;
engine.on('jarActive', () => { active = true; });
engine.on('jarLeap', ({ from, to }) => {
  leap = { from, to };
  const cell = engine.grid.getCell(to.row, to.col);
  landingBare = !!cell && !!cell.tile && !cell.obstacle && cell.tile.special !== 'JAM_JAR';
});
engine.on('jarBurst', ({ blastCells }) => { blastCount = blastCells.length; });
engine.on('cascadeStep', ({ cascadeIndex }) => cascadeSteps.push(cascadeIndex));

const res = await engine.trySwap(expectedMove.from, expectedMove.to);
const safe = Level62Config.safeLandingPos;
const expectedBlastCount = JamJarConfig.getBlastCells(
  safe.row, safe.col, engine.rows, engine.cols, JamJarBlastScope.STRICT_CROSS
).length;
let holes = 0;
for (let r = 0; r < engine.rows; r++) {
  for (let c = 0; c < engine.cols; c++) {
    if (!engine.grid.getCell(r, c).tile) holes++;
  }
}
const target = engine.activeTargets[0];

check('交步成功且步数扣减', res.success && engine.movesRemaining === 21, `moves=${engine.movesRemaining}`);
check('首步后罐体满充并激活', active === true, `jarActive=${active}`);
check('起跳落点为裸露普通格', landingBare === true && !!leap, JSON.stringify(leap));
check('落点等于配置安全落点', leap && leap.to.row === safe.row && leap.to.col === safe.col,
  `to=(${leap ? leap.to.row : '?'},${leap ? leap.to.col : '?'}), expected=(${safe.row},${safe.col})`);
check('爆浆范围符合配置十字 5 格规则 (边界截断)', blastCount === expectedBlastCount,
  `blastCells=${blastCount}/${expectedBlastCount}`);
check('爆浆后至少一次自发连消', cascadeSteps.length >= 2, `cascadeSteps=${cascadeSteps.length} (${cascadeSteps.join('->')})`);
check('目标达成', target.current >= target.count, `${target.current}/${target.count}`);
check('最终状态 VICTORY', engine.state === GameState.VICTORY, `state=${engine.state}`);
check('稳定后棋盘无永久空格', holes === 0, `holes=${holes}`);

// 打印执行后的棋盘矩阵
log('\nLv62 8x8 执行后矩阵（J = 果酱罐，坐标 0-based）：');
const symbols = { red: 'R', blue: 'B', green: 'G', yellow: 'Y' };
for (let r = 0; r < 8; r++) {
  const row = [];
  for (let c = 0; c < 8; c++) {
    const tile = engine.grid.getCell(r, c).tile;
    row.push(tile ? (tile.special === 'JAM_JAR' ? 'J' : (symbols[tile.color] || '?')) : '.');
  }
  log('  ' + row.join(' '));
}
log(`\n唯一首步：(${expectedMove.from.row},${expectedMove.from.col}) <-> (${expectedMove.to.row},${expectedMove.to.col})`);
log(`安全落点：(${safe.row},${safe.col})；级联次数：${cascadeSteps.length}；最终状态：${engine.state}`);

// 注意：上面打印的是执行后的棋盘；重新构造一份初始矩阵用于展示
const initialEngine = new Match3Engine({ ...Level62Config, stepDelay: 0 });
log('\nLv62 8x8 初始矩阵（执行前）：');
for (let r = 0; r < 8; r++) {
  const row = [];
  for (let c = 0; c < 8; c++) {
    const tile = initialEngine.grid.getCell(r, c).tile;
    row.push(tile ? (tile.special === 'JAM_JAR' ? 'J' : (symbols[tile.color] || '?')) : '.');
  }
  log('  ' + row.join(' '));
}

log('\n==========================================================');
if (failures.length === 0) {
  log('[SUCCESS] Lv62 8x8 全部关卡约束满足。');
  process.exit(0);
} else {
  log(`[FAILED] ${failures.length} 项不满足：${failures.join('; ')}`);
  process.exit(1);
}
