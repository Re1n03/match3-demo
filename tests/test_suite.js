/**
 * test_suite.js - 三消核心通用引擎自动化测试套件 (审计强化版)
 * 包含 52 项严格的逻辑断言，覆盖随机数可复现性、VOID物理镂空阻断、级联熔断与状态机生命周期。
 * 新增覆盖：罐体机制/斜向补位/果冻/死局洗牌/双罐共鸣/传送门/蜂蜜/Lv64 配置。
 */

import { PRNG } from '../js/engine/PRNG.js';
import { Grid, CellType } from '../js/engine/Grid.js';
import { MatchFinder } from '../js/engine/MatchFinder.js';
import { Gravity } from '../js/engine/Gravity.js';
import { Match3Engine, GameState } from '../js/engine/Match3Engine.js';
import { JamJarConfig, JamJarBlastScope, JamJarState } from '../js/mechanics/JamJarConfig.js';
import { JamJarSystem } from '../js/mechanics/JamJarSystem.js';
import { Level62Config } from '../js/levels/level62.js';
import { Level63Config } from '../js/levels/level63.js';
import { Level64Config } from '../js/levels/level64.js';

export class TestRunner {
  constructor() {
    this.results = [];
  }

  assert(condition, testName, message = '') {
    if (condition) {
      this.results.push({ name: testName, status: 'PASS', detail: message });
    } else {
      this.results.push({ name: testName, status: 'FAIL', detail: message || '断言失败' });
    }
  }

  async runAllTests() {
    this.results = [];

    // [Test 1] PRNG 确定性种子跨实例一致性测试
    (() => {
      const prng1 = new PRNG(1042);
      const prng2 = new PRNG(1042);
      const seq1 = [prng1.next(), prng1.next(), prng1.nextInt(0, 10)];
      const seq2 = [prng2.next(), prng2.next(), prng2.nextInt(0, 10)];
      const isIdentical = seq1.every((v, i) => v === seq2[i]);
      this.assert(isIdentical, 'PRNG 确定性种子跨实例一致性', 'Seed #1042 两个独立实例序列完全吻合');
    })();

    // [Test 2] 开局无现成三消自消断言
    (() => {
      const engine = new Match3Engine({ rows: 9, cols: 9, seed: 1042, stepDelay: 0 });
      const initialMatches = MatchFinder.findMatches(engine.grid);
      this.assert(initialMatches.matches.length === 0, '开局无现成三消自消断言', `初始匹配数: ${initialMatches.matches.length}`);
    })();

    // [Test 3] 相邻性四向与斜向判定断言
    (() => {
      const grid = new Grid(9, 9);
      const isAdjHorizontal = grid.isAdjacent({ row: 2, col: 3 }, { row: 2, col: 4 });
      const isAdjVertical = grid.isAdjacent({ row: 2, col: 3 }, { row: 3, col: 3 });
      const isDiag = grid.isAdjacent({ row: 2, col: 3 }, { row: 3, col: 4 });
      const isFar = grid.isAdjacent({ row: 2, col: 3 }, { row: 2, col: 5 });
      this.assert(isAdjHorizontal && isAdjVertical && !isDiag && !isFar, '四向相邻与对角排他判定断言', '仅正交曼哈顿距离为1时判定为相邻');
    })();

    // [Test 4] 横向与纵向三消精确匹配扫描断言
    (() => {
      const grid = new Grid(9, 9);
      grid.getCell(0, 0).tile = grid.createTile('red');
      grid.getCell(0, 1).tile = grid.createTile('red');
      grid.getCell(0, 2).tile = grid.createTile('red');
      grid.getCell(0, 3).tile = grid.createTile('blue');

      grid.getCell(2, 5).tile = grid.createTile('green');
      grid.getCell(3, 5).tile = grid.createTile('green');
      grid.getCell(4, 5).tile = grid.createTile('green');
      grid.getCell(5, 5).tile = grid.createTile('green');

      const result = MatchFinder.findMatches(grid);
      const hasHorizontal = result.matches.some(m => m.type === 'HORIZONTAL' && m.cells.length === 3 && m.color === 'red');
      const hasVertical = result.matches.some(m => m.type === 'VERTICAL' && m.cells.length === 4 && m.color === 'green');

      this.assert(hasHorizontal && hasVertical, '横向3消与纵向4消精确扫描断言', `检测到 ${result.matches.length} 组匹配`);
    })();

    // [Test 5] 无效交换受控隔离回弹且步数不扣减断言 (重构：消除随机棋盘假阳性干扰)
    await (async () => {
      // 构造一个受控的 3x3 棋盘，全盘交替排列，确保交换 (0,0) 与 (0,1) 后绝无三消
      const engine = new Match3Engine({
        rows: 3,
        cols: 3,
        maxMoves: 10,
        initialTiles: [
          ['red', 'blue', 'green'],
          ['yellow', 'green', 'blue'],
          ['blue', 'red', 'yellow']
        ],
        stepDelay: 0
      });

      const movesBefore = engine.movesRemaining;
      const res = await engine.trySwap({ row: 0, col: 0 }, { row: 0, col: 1 });
      const movesAfter = engine.movesRemaining;

      const positionRestored = engine.grid.getCell(0, 0).tile.color === 'red' &&
                               engine.grid.getCell(0, 1).tile.color === 'blue';

      this.assert(
        res.success === false && movesBefore === movesAfter && positionRestored,
        '受控环境无效交换回弹且步数不扣减',
        `返回失败, 步数维持 ${movesBefore}, 棋子严格复位`
      );
    })();

    // [Test 6] 有效三消交换执行与步数扣除断言
    await (async () => {
      const engine = new Match3Engine({ rows: 5, cols: 5, maxMoves: 10, stepDelay: 0 });
      engine.grid.getCell(0, 0).tile = engine.grid.createTile('red');
      engine.grid.getCell(0, 1).tile = engine.grid.createTile('red');
      engine.grid.getCell(0, 2).tile = engine.grid.createTile('blue');
      engine.grid.getCell(0, 3).tile = engine.grid.createTile('red');

      const initialMoves = engine.movesRemaining;
      const res = await engine.trySwap({ row: 0, col: 2 }, { row: 0, col: 3 });

      this.assert(
        res.success === true && engine.movesRemaining === initialMoves - 1,
        '有效三消交换与步数准确扣除断言',
        `交换成功，步数由 ${initialMoves} 变为 ${engine.movesRemaining}`
      );
    })();

    // [Test 7] 消除后重力纵向下落与补齐断言
    (() => {
      const grid = new Grid(4, 4);
      const prng = new PRNG(1042);
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          grid.getCell(r, c).tile = grid.createTile('blue');
        }
      }
      grid.getCell(3, 1).tile = null;
      grid.getCell(2, 1).tile = null;

      const gravityResult = Gravity.applyGravity(grid, prng, ['red', 'blue', 'green', 'yellow']);
      
      let hasEmpty = false;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          if (grid.getCell(r, c).tile === null) hasEmpty = true;
        }
      }

      this.assert(
        !hasEmpty && gravityResult.drops.length > 0 && gravityResult.spawns.length > 0,
        '重力垂直下落与顶部补料断言',
        `下落位移 ${gravityResult.drops.length} 次，顶部新生成补料 ${gravityResult.spawns.length} 格`
      );
    })();

    // [Test 8] 关卡步数耗尽失败 (DEFEAT) 判定断言
    await (async () => {
      const engine = new Match3Engine({
        rows: 5,
        cols: 5,
        maxMoves: 1,
        targets: [{ id: 't1', type: 'COLLECT_RED', count: 999, current: 0 }],
        stepDelay: 0
      });
      engine.grid.getCell(0, 0).tile = engine.grid.createTile('red');
      engine.grid.getCell(0, 1).tile = engine.grid.createTile('red');
      engine.grid.getCell(0, 2).tile = engine.grid.createTile('blue');
      engine.grid.getCell(0, 3).tile = engine.grid.createTile('red');

      await engine.trySwap({ row: 0, col: 2 }, { row: 0, col: 3 });

      this.assert(
        engine.state === GameState.DEFEAT && engine.movesRemaining === 0,
        '步数耗尽且目标未达成失败判定断言',
        `引擎状态正确转为 ${engine.state}`
      );
    })();

    // [Test 9] 关卡目标达成胜利 (VICTORY) 判定断言
    await (async () => {
      const engine = new Match3Engine({
        rows: 5,
        cols: 5,
        maxMoves: 10,
        targets: [{ id: 't1', type: 'COLLECT_RED', count: 3, current: 0 }],
        stepDelay: 0
      });
      engine.grid.getCell(0, 0).tile = engine.grid.createTile('red');
      engine.grid.getCell(0, 1).tile = engine.grid.createTile('red');
      engine.grid.getCell(0, 2).tile = engine.grid.createTile('blue');
      engine.grid.getCell(0, 3).tile = engine.grid.createTile('red');

      await engine.trySwap({ row: 0, col: 2 }, { row: 0, col: 3 });

      this.assert(
        engine.state === GameState.VICTORY,
        '目标达成胜利状态判定断言',
        `达成 3 个红心收集，引擎状态正确转为 ${engine.state}`
      );
    })();

    // [Test 10] 全盘可行解搜索器 findPossibleMoves 断言
    (() => {
      const grid = new Grid(4, 4);
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          grid.getCell(r, c).tile = grid.createTile((r + c) % 2 === 0 ? 'green' : 'yellow');
        }
      }
      grid.getCell(0, 0).tile = grid.createTile('red');
      grid.getCell(0, 1).tile = grid.createTile('red');
      grid.getCell(0, 2).tile = grid.createTile('blue');
      grid.getCell(0, 3).tile = grid.createTile('red');

      const possibleMoves = MatchFinder.findPossibleMoves(grid);
      this.assert(
        possibleMoves.length > 0,
        '全盘可行解搜索器 findPossibleMoves 断言',
        `成功搜索到 ${possibleMoves.length} 个合法三消交换解`
      );
    })();

    // [Test 11] 果酱罐方案 A 严格十字 5 格及边界截断断言
    (() => {
      const centerCells = JamJarConfig.getBlastCells(4, 4, 9, 9, JamJarBlastScope.STRICT_CROSS);
      const isFiveCells = centerCells.length === 5;
      const expectedKeys = new Set(['4,4', '3,4', '5,4', '4,3', '4,5']);
      const matchesAll = centerCells.every(c => expectedKeys.has(`${c.row},${c.col}`));

      const cornerCells = JamJarConfig.getBlastCells(0, 0, 9, 9, JamJarBlastScope.STRICT_CROSS);
      const isCornerThree = cornerCells.length === 3;

      this.assert(
        isFiveCells && matchesAll && isCornerThree,
        '果酱罐方案 A 严格十字 5 格及边界截断断言',
        `中心产生 5 格，左上角产生 ${cornerCells.length} 格`
      );
    })();

    // [Test 12] 关卡重置 Reset 数据与状态完全恢复断言
    await (async () => {
      const engine = new Match3Engine({ rows: 5, cols: 5, maxMoves: 10, seed: 1042, stepDelay: 0 });
      engine.movesRemaining = 5;
      engine.score = 500;
      engine.state = GameState.DEFEAT;

      engine.reset();

      this.assert(
        engine.movesRemaining === 10 && engine.score === 0 && engine.state === GameState.IDLE,
        '关卡重置 Reset 数据与状态完全恢复断言',
        `步数恢复为 ${engine.movesRemaining}, 得分重置为 ${engine.score}, 状态为 ${engine.state}`
      );
    })();

    // ==========================================
    // 审计针对性补充测试 (覆盖四大关键高风险点)
    // ==========================================

    // [Test 13] 单实例 PRNG.reset() 序列复原重现性断言 (审计补充)
    (() => {
      const prng = new PRNG(1042);
      const round1 = [prng.next(), prng.next(), prng.nextInt(1, 100), prng.next()];
      prng.reset(); // 单实例复位
      const round2 = [prng.next(), prng.next(), prng.nextInt(1, 100), prng.next()];
      const isPerfectMatch = round1.every((v, i) => v === round2[i]);
      this.assert(
        isPerfectMatch,
        '单实例 PRNG.reset() 随机序列复原重现性',
        '调用 reset() 后重新生成的 4 组伪随机数值与初次完全恒等'
      );
    })();

    // [Test 14] 相同种子下重开 (reset) 执行相同操作序列的棋盘状态绝对一致性断言 (审计补充)
    await (async () => {
      const engine = new Match3Engine({ rows: 5, cols: 5, maxMoves: 10, seed: 1042, stepDelay: 0 });

      // 手工制造一次消除：在 (0,2) 与 (0,3) 交换红心
      engine.grid.getCell(0, 0).tile = engine.grid.createTile('red');
      engine.grid.getCell(0, 1).tile = engine.grid.createTile('red');
      engine.grid.getCell(0, 2).tile = engine.grid.createTile('blue');
      engine.grid.getCell(0, 3).tile = engine.grid.createTile('red');

      await engine.trySwap({ row: 0, col: 2 }, { row: 0, col: 3 });
      // 记录第一轮消除补料后的全盘棋子颜色快照
      const snapshot1 = engine.grid.cells.map(r => r.map(c => c.tile ? c.tile.color : 'null')).flat().join(',');

      // 执行重置
      engine.reset();

      // 在重置后的棋盘上重新执行完全相同的初始消除
      engine.grid.getCell(0, 0).tile = engine.grid.createTile('red');
      engine.grid.getCell(0, 1).tile = engine.grid.createTile('red');
      engine.grid.getCell(0, 2).tile = engine.grid.createTile('blue');
      engine.grid.getCell(0, 3).tile = engine.grid.createTile('red');

      await engine.trySwap({ row: 0, col: 2 }, { row: 0, col: 3 });
      const snapshot2 = engine.grid.cells.map(r => r.map(c => c.tile ? c.tile.color : 'null')).flat().join(',');

      this.assert(
        snapshot1 === snapshot2,
        '重置后相同操作序列落料补全绝对一致性',
        '重置后重新执行相同交换，全盘 25 格补料棋子颜色排列与第 1 轮 100% 相同'
      );
    })();

    // [Test 15] 物理镂空格 (VOID) 严格阻断重力落料与虚空补料断言 (审计补充：Lv64 双岛拓扑核心)
    (() => {
      const grid = new Grid(5, 3);
      const prng = new PRNG(1042);

      // 将第 1 列的 (2, 1) 设置为物理镂空 VOID
      grid.setVoid(2, 1, true);

      // 上方 (0, 1) 和 (1, 1) 填充棋子
      grid.getCell(0, 1).tile = grid.createTile('red');
      grid.getCell(1, 1).tile = grid.createTile('red');

      // 下方 (3, 1) 和 (4, 1) 留空
      grid.getCell(3, 1).tile = null;
      grid.getCell(4, 1).tile = null;

      // 执行重力下落
      const result = Gravity.applyGravity(grid, prng, ['red', 'blue', 'green', 'yellow'], null);

      // 验证断言：
      // 1. (1, 1) 棋子绝不能穿透 (2, 1) 的 VOID 掉落到 (3, 1) 或 (4, 1)
      const tileAboveVoidStayed = grid.getCell(1, 1).tile !== null && grid.getCell(1, 1).tile.color === 'red';
      // 2. 在没有传送门挂接时，VOID 下方的 (3, 1) 和 (4, 1) 绝不能无端凭空生成新棋子 (必须保持为 null)
      const voidBelowStayedEmpty = grid.getCell(3, 1).tile === null && grid.getCell(4, 1).tile === null;

      this.assert(
        tileAboveVoidStayed && voidBelowStayedEmpty,
        '物理镂空 VOID 垂直重力阻断与虚空落料防御',
        '上方棋子未穿透镂空，无传送门时镂空下方绝不凭空生成棋子'
      );
    })();

    // [Test 16] 级联死循环安全熔断保护与非正常胜利阻断断言 (审计强化修复)
    await (async () => {
      const engine = new Match3Engine({
        rows: 3,
        cols: 3,
        maxCascadeLimit: 5,
        targets: [{ id: 't1', type: 'COLLECT_RED', count: 1, current: 0 }],
        stepDelay: 0
      });

      const dummyMatch = {
        matchedCells: new Set(['0,0', '0,1', '0,2']),
        matches: [{ type: 'HORIZONTAL', color: 'red', cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }] }]
      };

      // 模拟虽然目标计数达到了，但是由于数据死锁，持续返回匹配导致无限循环
      engine.clearMatchedTiles = () => {
        engine.updateTargetProgress('COLLECT_RED', 1);
        return { clearedCount: 3, clearedColors: { red: 3 } };
      };

      const originalFindMatches = MatchFinder.findMatches;
      // 劫持让 MatchFinder 持续返回匹配以模拟极端死锁 bug
      MatchFinder.findMatches = () => dummyMatch;

      try {
        await engine.runCascadeLoop(dummyMatch);
      } finally {
        MatchFinder.findMatches = originalFindMatches; // 确保恢复现场
      }

      // 断言：触发熔断后，状态必须为 ERROR，绝对不能被错误判定为 VICTORY！
      const preventedFalseVictory = (engine.state === GameState.ERROR) && (engine.state !== GameState.VICTORY);
      const errorRecorded = engine.lastError && engine.lastError.code === 'CASCADE_LIMIT_EXCEEDED';

      this.assert(
        preventedFalseVictory && errorRecorded,
        '极端死锁级联死循环安全熔断与防伪胜利保护',
        `成功熔断，状态为 ${engine.state}，未发生错误胜利，错误码: ${engine.lastError ? engine.lastError.code : 'none'}`
      );
    })();

    // ==========================================
    // Lv62 机制引入关专属验证 (Step 3: Lv62 验收断言)
    // ==========================================

    // [Test 17] Lv62 初始棋盘开局 0 自发三消断言
    (() => {
      const engine = new Match3Engine(Level62Config);
      const initialMatches = MatchFinder.findMatches(engine.grid);
      this.assert(
        initialMatches.matches.length === 0,
        'Lv62 开局初始棋盘 0 自发三消断言',
        `初始状态检测到 ${initialMatches.matches.length} 处现成三消，开局完全静态稳定`
      );
    })();

    // [Test 18] Lv62 全盘穷举【正交三消规则下唯一有效首步】断言（可交换对数从棋盘拓扑动态推导）
    (() => {
      const engine = new Match3Engine(Level62Config);
      const grid = engine.grid;

      // 统计全盘实际参与扫描的相邻交换对数 (排除罐子等不可交换实体)
      let scannedPairs = 0;
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          if (!grid.canSwap(r, c)) continue;
          if (c + 1 < grid.cols && grid.canSwap(r, c + 1)) scannedPairs++;
          if (r + 1 < grid.rows && grid.canSwap(r + 1, c)) scannedPairs++;
        }
      }

      // 从 rows/cols 推导总相邻对数，再扣除所有“至少一端不可交换”的相邻对
      const totalAdjacentPairs = grid.rows * (grid.cols - 1) + (grid.rows - 1) * grid.cols;
      const blockedPairKeys = new Set();
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          if (grid.canSwap(r, c)) continue;
          for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nr = r + dr;
            const nc = c + dc;
            if (!grid.isValid(nr, nc)) continue;
            const key = r < nr || (r === nr && c < nc) ? `${r},${c}-${nr},${nc}` : `${nr},${nc}-${r},${c}`;
            blockedPairKeys.add(key);
          }
        }
      }
      const expectedPairs = totalAdjacentPairs - blockedPairKeys.size;
      const isExpectedPairs = (scannedPairs === expectedPairs);

      // 算法穷举全盘所有合法交换解
      const possibleMoves = MatchFinder.findPossibleMoves(grid);
      const expectedMove = Level62Config.firstMove;
      const isSingleMove = (possibleMoves.length === 1);
      let isExactTarget = false;
      let moveDesc = '无解';

      if (possibleMoves.length > 0) {
        const m = possibleMoves[0];
        const matchesForward = m.posA.row === expectedMove.from.row && m.posA.col === expectedMove.from.col &&
          m.posB.row === expectedMove.to.row && m.posB.col === expectedMove.to.col;
        const matchesBackward = m.posA.row === expectedMove.to.row && m.posA.col === expectedMove.to.col &&
          m.posB.row === expectedMove.from.row && m.posB.col === expectedMove.from.col;
        isExactTarget = matchesForward || matchesBackward;
        moveDesc = `(${m.posA.row},${m.posA.col}) <-> (${m.posB.row},${m.posB.col})`;
      }

      this.assert(
        isExpectedPairs && isSingleMove && isExactTarget,
        'Lv62 全盘穷举【正交三消规则下唯一有效首步】程序验证',
        `按 ${grid.rows}x${grid.cols} 拓扑推导可交换对 ${expectedPairs}，实际扫描 ${scannedPairs} 对；` +
          `仅有 ${possibleMoves.length} 个合法三消解，坐标为 ${moveDesc}，期望 ${JSON.stringify(expectedMove)}`
      );
    })();

    // [Test 19] Lv62 唯一首步满充起跳、爆浆后自发连消并通关（求解器结果固化）
    await (async () => {
      const engine = new Match3Engine({ ...Level62Config, stepDelay: 0 });
      const mech = engine.customMechanics;
      const cascadeSteps = [];
      let sawActive = false;
      let leapInfo = null;
      let landingWasBare = false;
      let blastCellCount = 0;

      engine.on('jarActive', () => { sawActive = true; });
      engine.on('jarLeap', ({ from, to }) => {
        leapInfo = { from, to };
        const landingCell = engine.grid.getCell(to.row, to.col);
        landingWasBare = !!landingCell && !!landingCell.tile && !landingCell.obstacle &&
          landingCell.tile.special !== 'JAM_JAR';
      });
      engine.on('jarBurst', ({ blastCells }) => {
        blastCellCount = blastCells.length;
      });
      engine.on('cascadeStep', ({ cascadeIndex }) => cascadeSteps.push(cascadeIndex));

      const res = await engine.trySwap(Level62Config.firstMove.from, Level62Config.firstMove.to);

      const safe = Level62Config.safeLandingPos;
      const expectedBlastCells = JamJarConfig.getBlastCells(
        safe.row, safe.col, engine.rows, engine.cols, JamJarBlastScope.STRICT_CROSS
      ).length;
      const target = engine.activeTargets[0];
      const jarLandedAtSafe = mech.jarPos &&
        mech.jarPos.row === safe.row && mech.jarPos.col === safe.col;
      const targetDone = target.current >= target.count;
      const hasSpontaneousCascade = cascadeSteps.length >= 2; // 第 1 次为首步匹配，第 2 次起为爆浆后自发连消

      this.assert(
        res.success && engine.movesRemaining === 21 && sawActive &&
          leapInfo && leapInfo.from.row === Level62Config.jarInitialPos.row &&
          leapInfo.from.col === Level62Config.jarInitialPos.col && landingWasBare &&
          blastCellCount === expectedBlastCells && hasSpontaneousCascade &&
          jarLandedAtSafe && targetDone && engine.state === GameState.VICTORY,
        'Lv62 唯一首步满充起跳、爆浆后自发连消并通关',
        `1 步合法交换后剩 ${engine.movesRemaining} 步；罐体 (${Level62Config.jarInitialPos.row},${Level62Config.jarInitialPos.col})` +
          ` -> (${mech.jarPos ? mech.jarPos.row : '?'},${mech.jarPos ? mech.jarPos.col : '?'})；` +
          `爆浆 ${blastCellCount}/${expectedBlastCells} 格；级联 ${cascadeSteps.length} 次；目标 ${target.current}/${target.count}；状态 ${engine.state}`
      );
    })();

    // [Test 19b] Lv62 8x8 / 4 色 / 22 步 / initialCharge=2 配置生效
    (() => {
      const engine = new Match3Engine({ ...Level62Config, stepDelay: 0 });
      const jarCell = engine.grid.getCell(Level62Config.jarInitialPos.row, Level62Config.jarInitialPos.col);
      const jarTile = jarCell ? jarCell.tile : null;
      this.assert(
        engine.rows === 8 && engine.cols === 8 && engine.colors.length === 4 &&
          engine.movesRemaining === 22 && jarTile && jarTile.id === 'jar_entity_62' &&
          jarTile.charge === 2 && jarTile.maxCharge === 3,
        'Lv62 8x8 / 4色 / 22步 / initialCharge=2 配置生效',
        `${engine.rows}x${engine.cols}, colors=${engine.colors.length}, moves=${engine.movesRemaining}, jarCharge=${jarTile ? jarTile.charge : 'none'}`
      );
    })();

    // [Test 20] 果酱罐落点算法：优先格被特殊物件占据时严格避让并降级选裸露普通格
    (() => {
      const grid = new Grid(9, 9);
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          grid.getCell(r, c).tile = grid.createTile('blue');
        }
      }
      grid.getCell(7, 7).tile = grid.createTile('red', 'BOMB');

      const landing = JamJarConfig.findBestLandingCell(grid, { row: 2, col: 5 }, { preferredPos: { row: 7, col: 7 } });
      const avoidedBomb = !(landing.row === 7 && landing.col === 7);
      const isBareNormal = grid.isBareNormalTile(landing.row, landing.col);

      this.assert(
        avoidedBomb && isBareNormal,
        '果酱罐落点算法：优先格被特殊物件占据时严格避让断言',
        `避让特殊炸弹格(7,7)，安全降级选中裸露普通格(${landing.row},${landing.col})`
      );
    })();

    // [Test 21] Lv62 Seed #1042 操作序列可重现性断言
    await (async () => {
      const engine = new Match3Engine({ ...Level62Config, stepDelay: 0 });

      await engine.trySwap({ row: 1, col: 4 }, { row: 2, col: 4 });
      const snap1 = engine.grid.cells.map(r => r.map(c => c.tile ? c.tile.color : 'null')).flat().join(',');

      engine.reset();

      await engine.trySwap({ row: 1, col: 4 }, { row: 2, col: 4 });
      const snap2 = engine.grid.cells.map(r => r.map(c => c.tile ? c.tile.color : 'null')).flat().join(',');

      this.assert(
        snap1 === snap2,
        'Lv62 Seed #1042 重置后相同操作落料复现性',
        `两次执行首步后，全盘 ${engine.rows * engine.cols} 格所有下落与补料棋子矩阵 100% 逐格完全恒等`
      );
    })();

    // [Test 22] Lv62 非首步无效交换全盘拦截与步数保护断言
    await (async () => {
      const engine = new Match3Engine({ ...Level62Config, stepDelay: 0 });

      const res = await engine.trySwap({ row: 0, col: 0 }, { row: 0, col: 1 });

      this.assert(
        res.success === false && engine.movesRemaining === 22 && engine.state === GameState.IDLE,
        'Lv62 非首步无效交换回弹与步数保护断言',
        `交换非法被拒，步数锁定维持 22 步，状态保持 IDLE`
      );
    })();

    // [Test 23] 果酱罐落点算法：优先格为 VOID 或实体障碍不可落时严格降级选普通格
    (() => {
      const grid = new Grid(9, 9);
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          grid.getCell(r, c).tile = grid.createTile('green');
        }
      }
      grid.setVoid(7, 7, true);
      grid.getCell(6, 6).obstacle = { type: 'HONEY', hp: 2, blocksMovement: true };

      const landing = JamJarConfig.findBestLandingCell(grid, { row: 2, col: 5 }, { preferredPos: { row: 7, col: 7 } });
      const isNotVoid = !(landing.row === 7 && landing.col === 7);
      const isNotObstacle = !(landing.row === 6 && landing.col === 6);
      const isNormal = grid.isBareNormalTile(landing.row, landing.col);

      this.assert(
        isNotVoid && isNotObstacle && isNormal,
        '果酱罐落点算法：优先格为VOID或障碍实体时降级断言',
        `拒绝VOID(7,7)与障碍(6,6)，安全落入裸露普通格(${landing.row},${landing.col})`
      );
    })();

    // [Test 24] 果酱罐落点算法极端防护：全盘无任何裸露普通格时安全返回 null 且平稳降级
    (() => {
      const grid = new Grid(3, 3);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          grid.getCell(r, c).obstacle = { type: 'HONEY', hp: 2, blocksMovement: true };
        }
      }
      const landing = JamJarConfig.findBestLandingCell(grid, { row: 0, col: 0 });

      this.assert(
        landing === null,
        '果酱罐落点算法极端防护：全盘无裸露格安全返回 null',
        '极端无可用格边界下，函数安全返回 null 绝不产生越界或非法落点'
      );
    })();

    // [Test 25] 胜负时序严格性与因果链防早产断言 (修正版: 严密捕获满载提前胜利缺陷)
    await (async () => {
      const engine = new Match3Engine({ ...Level62Config, stepDelay: 0 });

      const timeline = [];
      let prematureVictory = false;
      let jarPosDuringLeap = null;

      engine.on('jarActive', () => {
        timeline.push('ACTIVE');
        if (engine.state === GameState.VICTORY || engine.activeTargets[0].current > 0) {
          prematureVictory = true; // 捕获缺陷：满载瞬间绝不能为 VICTORY，目标绝不能提前完成
        }
      });

      engine.on('jarLeap', ({ from, to }) => {
        timeline.push('LEAP');
        jarPosDuringLeap = { from, to };
        if (engine.state === GameState.VICTORY || engine.activeTargets[0].current > 0) {
          prematureVictory = true; // 捕获缺陷：腾跃未落地前绝不能为 VICTORY
        }
      });

      engine.on('jarBurst', () => {
        timeline.push('BURST');
      });

      engine.on('targetsUpdated', () => {
        timeline.push('TARGET_DONE');
      });

      engine.on('victory', () => {
        timeline.push('VICTORY');
      });

      // 执行唯一首步（initialCharge=2，一次邻接三消即满充起跳）
      await engine.trySwap(Level62Config.firstMove.from, Level62Config.firstMove.to);

      // 严格时序校验
      const expectedOrder = ['ACTIVE', 'LEAP', 'BURST', 'TARGET_DONE', 'VICTORY'];
      const isOrderStrict = timeline.length >= 5 &&
        timeline.indexOf('ACTIVE') < timeline.indexOf('LEAP') &&
        timeline.indexOf('LEAP') < timeline.indexOf('BURST') &&
        timeline.indexOf('BURST') <= timeline.indexOf('TARGET_DONE') &&
        timeline.indexOf('TARGET_DONE') <= timeline.indexOf('VICTORY');

      const safe = Level62Config.safeLandingPos;
      const leapCoordCorrect = jarPosDuringLeap &&
        jarPosDuringLeap.from.row === Level62Config.jarInitialPos.row &&
        jarPosDuringLeap.from.col === Level62Config.jarInitialPos.col &&
        jarPosDuringLeap.to.row === safe.row && jarPosDuringLeap.to.col === safe.col;

      this.assert(
        !prematureVictory && isOrderStrict && leapCoordCorrect,
        '胜负时序严格性与因果链防早产断言 (防提前胜利)',
        `因果链依序执行: [${timeline.join('->')}], 腾跃坐标(${jarPosDuringLeap.from.row},${jarPosDuringLeap.from.col})->(${jarPosDuringLeap.to.row},${jarPosDuringLeap.to.col}), 零早产违规`
      );
    })();

    // [Test 26] 罐体为固定机制实体：重力不下落，逻辑坐标与实体 ID 保持同步 (P1 修复)
    (() => {
      const engine = new Match3Engine({ ...Level62Config, stepDelay: 0 });
      const mech = engine.customMechanics;
      const jarPos = { ...mech.jarPos };
      const jarCell = engine.grid.getCell(jarPos.row, jarPos.col);
      const jarId = jarCell.tile.id;

      // 清空罐体正下方所有格子，制造“普通棋子会掉落”的重力条件
      for (let r = jarPos.row + 1; r < engine.rows; r++) {
        engine.grid.getCell(r, jarPos.col).tile = null;
      }

      Gravity.applyGravity(engine.grid, new PRNG(1042), engine.colors);

      const jarAfter = engine.grid.getCell(jarPos.row, jarPos.col).tile;
      let jarCount = 0;
      for (let r = 0; r < engine.rows; r++) {
        for (let c = 0; c < engine.cols; c++) {
          const tile = engine.grid.getCell(r, c).tile;
          if (tile && tile.special === 'JAM_JAR') jarCount++;
        }
      }

      this.assert(
        jarAfter && jarAfter.id === jarId && jarCount === 1 && mech.findJarPos(engine) &&
          mech.findJarPos(engine).row === jarPos.row && mech.findJarPos(engine).col === jarPos.col,
        '罐体固定实体：重力不下落且实体 ID/坐标唯一',
        `重力后罐体仍在 (${jarPos.row},${jarPos.col})，全盘果酱罐数量 ${jarCount}，实体 ID ${jarAfter ? jarAfter.id : 'none'}`
      );
    })();

    // [Test 27] 同一罐体可连续激活两次，且腾跃后坐标/实体 ID 始终同步 (通用系统多激活配置)
    await (async () => {
      // 使用独立 JamJarSystem 实例验证 activationsRequired=2，不修改 Level62Config 数据
      const twoActivationsSystem = new JamJarSystem({
        initialCharge: 0,
        maxCharge: 3,
        burstShape: JamJarBlastScope.STRICT_CROSS,
        landingScope: 'global',
        activationsRequired: 2,
        preferredLandingPos: Level62Config.safeLandingPos,
        jars: [{ id: 'jar_entity_62', pos: Level62Config.jarInitialPos }]
      });
      const twoActivationsConfig = {
        ...Level62Config,
        stepDelay: 0,
        targets: [{ id: 'target_jar', type: 'ACTIVATE_JAM_JAR', count: 2, current: 0, label: '激活果酱罐 🍯' }],
        customMechanics: twoActivationsSystem
      };
      const engine = new Match3Engine(twoActivationsConfig);
      const mech = engine.customMechanics;
      const neighborKey = () => {
        const p = mech.jarPos;
        const col = p.col + 1 < engine.cols ? p.col + 1 : p.col - 1;
        return `${p.row},${col}`;
      };
      const chargeUp = async () => {
        for (let i = 0; i < mech.maxCharge; i++) {
          await mech.onMatchesResolved(engine, { matchedCells: new Set([neighborKey()]) });
        }
      };
      const jarSnapshot = () => {
        const pos = mech.findJarPos(engine);
        const tile = pos ? engine.grid.getCell(pos.row, pos.col).tile : null;
        return { pos, id: tile ? tile.id : null };
      };

      await chargeUp();
      await mech.onPostGravityResolved(engine);
      const afterFirst = jarSnapshot();
      const firstTarget = engine.activeTargets[0].current;
      const firstSynced = afterFirst.pos &&
        afterFirst.pos.row === mech.jarPos.row && afterFirst.pos.col === mech.jarPos.col;

      await chargeUp();
      await mech.onPostGravityResolved(engine);
      const afterSecond = jarSnapshot();
      const secondTarget = engine.activeTargets[0].current;
      const secondSynced = afterSecond.pos &&
        afterSecond.pos.row === mech.jarPos.row && afterSecond.pos.col === mech.jarPos.col;
      engine.checkGameEnd();

      this.assert(
        firstTarget === 1 && secondTarget === 2 && firstSynced && secondSynced &&
          afterFirst.id === 'jar_entity_62' && afterSecond.id === 'jar_entity_62' &&
          engine.state === GameState.VICTORY,
        '同一罐体连续激活两次且实体 ID/坐标全程同步',
        `第一次目标 ${firstTarget}/2 @ (${afterFirst.pos ? afterFirst.pos.row : '?'},${afterFirst.pos ? afterFirst.pos.col : '?'}) -> ` +
          `第二次目标 ${secondTarget}/2 @ (${afterSecond.pos ? afterSecond.pos.row : '?'},${afterSecond.pos ? afterSecond.pos.col : '?'})，最终状态 ${engine.state}`
      );
    })();

    // [Test 28] 重置/重开必须广播 stateChange，供渲染层解除输入锁 (P0 修复)
    (() => {
      const engine = new Match3Engine({ ...Level62Config, stepDelay: 0 });
      const stateChanges = [];
      engine.on('stateChange', (event) => stateChanges.push(event));
      engine.setState(GameState.VICTORY);

      engine.reset();

      const resetEmittedIdle = stateChanges.some(e => e.newState === GameState.IDLE);
      this.assert(
        engine.state === GameState.IDLE && resetEmittedIdle,
        '重置广播 stateChange 且状态回到 IDLE',
        `reset() 触发 ${stateChanges.length} 次状态变更，其中回到 IDLE: ${resetEmittedIdle}`
      );
    })();

    // [Test 29] 罐体固定时上方补料正常；起跳后原格置空并由重力正常补料，稳定后无永久空格
    await (async () => {
      // A. 罐体固定在 (2,5)：清空其正上方两格，重力补料后仍应保持全盘无空格
      const fixedEngine = new Match3Engine({ ...Level62Config, stepDelay: 0 });
      const fixedMech = fixedEngine.customMechanics;
      const fixedJarPos = { ...fixedMech.jarPos };
      for (let r = 0; r < fixedJarPos.row; r++) {
        fixedEngine.grid.getCell(r, fixedJarPos.col).tile = null;
      }
      Gravity.applyGravity(fixedEngine.grid, new PRNG(1042), fixedEngine.colors);
      const aboveRefilled = fixedEngine.grid.getCell(0, fixedJarPos.col).tile !== null &&
        fixedEngine.grid.getCell(1, fixedJarPos.col).tile !== null;
      const jarStillFixed = fixedEngine.grid.getCell(fixedJarPos.row, fixedJarPos.col).tile &&
        fixedEngine.grid.getCell(fixedJarPos.row, fixedJarPos.col).tile.id === 'jar_entity_62';
      const countHoles = (engine) => {
        let holes = 0;
        for (let r = 0; r < engine.rows; r++) {
          for (let c = 0; c < engine.cols; c++) {
            if (!engine.grid.getCell(r, c).tile) holes++;
          }
        }
        return holes;
      };
      const fixedNoHoles = countHoles(fixedEngine) === 0;

      // B. 空降落点设为底行 (7,7)：起跳后原格 (2,5) 置空，再由重力补料，全盘不得有永久空格
      const bottomLandingSystem = new JamJarSystem({
        initialCharge: 2,
        maxCharge: 3,
        burstShape: JamJarBlastScope.STRICT_CROSS,
        landingScope: 'global',
        activationsRequired: 1,
        preferredLandingPos: { row: 7, col: 7 },
        jars: [{ id: 'jar_entity_62', pos: Level62Config.jarInitialPos }]
      });
      const leapEngine = new Match3Engine({
        ...Level62Config,
        stepDelay: 0,
        customMechanics: bottomLandingSystem
      });
      const leapMech = leapEngine.customMechanics;
      await leapEngine.trySwap(Level62Config.firstMove.from, Level62Config.firstMove.to);

      const originCell = leapEngine.grid.getCell(Level62Config.jarInitialPos.row, Level62Config.jarInitialPos.col);
      const originRefilled = originCell.tile !== null &&
        originCell.tile.special !== 'JAM_JAR' &&
        originCell.tile.id !== 'jar_entity_62';
      const landedAtBottom = leapMech.jarPos.row === 7 && leapMech.jarPos.col === 7;
      const leapNoHoles = countHoles(leapEngine) === 0;

      this.assert(
        aboveRefilled && jarStillFixed && fixedNoHoles && originRefilled && landedAtBottom && leapNoHoles,
        '罐体上方补料正常；起跳原格置空并补料，稳定后无永久空格',
        `固定时上方补料=${aboveRefilled}、全盘空格=${countHoles(fixedEngine)}；起跳后原格补料=${originRefilled}、` +
          `落点=(${leapMech.jarPos.row},${leapMech.jarPos.col})、全盘空格=${countHoles(leapEngine)}`
      );
    })();

    // [Test 30] 通用 JamJarSystem 多实例：两个独立罐体可分别充能并各自激活
    await (async () => {
      const colors4 = ['red', 'blue', 'green', 'yellow'];
      const rows = 7;
      const cols = 7;
      const initialTiles = [];
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) row.push(colors4[(r * 2 + c) % 4]);
        initialTiles.push(row);
      }
      const system = new JamJarSystem({
        initialCharge: 0,
        maxCharge: 2,
        burstShape: JamJarBlastScope.STRICT_CROSS,
        landingScope: 'global',
        activationsRequired: 1,
        targetType: 'ACTIVATE_JAM_JAR',
        jars: [
          { id: 'jar_a', pos: { row: 2, col: 2 } },
          { id: 'jar_b', pos: { row: 4, col: 4 } }
        ]
      });
      const engine = new Match3Engine({
        rows,
        cols,
        colors: colors4,
        maxMoves: 10,
        seed: 1042,
        stepDelay: 0,
        initialTiles,
        targets: [{ id: 't', type: 'ACTIVATE_JAM_JAR', count: 2, current: 0 }],
        customMechanics: system
      });

      const chargeJar = async (jarId) => {
        const runtime = system.getRuntime(jarId);
        for (let i = 0; i < runtime.maxCharge; i++) {
          const p = runtime.pos;
          const neighborCol = p.col + 1 < cols ? p.col + 1 : p.col - 1;
          await system.onMatchesResolved(engine, { matchedCells: new Set([`${p.row},${neighborCol}`]) });
        }
      };
      await chargeJar('jar_a');
      await chargeJar('jar_b');
      const bothActive = system.getRuntime('jar_a').state === JamJarState.ACTIVE &&
        system.getRuntime('jar_b').state === JamJarState.ACTIVE;

      await system.onPostGravityResolved(engine);

      const runtimeA = system.getRuntime('jar_a');
      const runtimeB = system.getRuntime('jar_b');
      const posA = system.findJarPos(engine, 'jar_a');
      const posB = system.findJarPos(engine, 'jar_b');
      const positionsSynced = posA && posB &&
        posA.row === runtimeA.pos.row && posA.col === runtimeA.pos.col &&
        posB.row === runtimeB.pos.row && posB.col === runtimeB.pos.col;
      let jarTileCount = 0;
      const jarIds = new Set();
      for (let r = 0; r < engine.rows; r++) {
        for (let c = 0; c < engine.cols; c++) {
          const tile = engine.grid.getCell(r, c).tile;
          if (tile && tile.special === 'JAM_JAR') {
            jarTileCount++;
            jarIds.add(tile.id);
          }
        }
      }
      engine.checkGameEnd();
      const target = engine.activeTargets[0];

      this.assert(
        bothActive && runtimeA.activations === 1 && runtimeB.activations === 1 &&
          positionsSynced && jarTileCount === 2 && jarIds.has('jar_a') && jarIds.has('jar_b') &&
          target.current === 2 && engine.state === GameState.VICTORY,
        '通用系统多实例：两个罐体分别充能/激活且目标累计',
        `twoActive=${bothActive}，activations=(${runtimeA.activations},${runtimeB.activations})，` +
          `posA=(${posA ? posA.row : '?'},${posA ? posA.col : '?'})，posB=(${posB ? posB.row : '?'},${posB ? posB.col : '?'})，` +
          `jarTiles=${jarTileCount}，目标=${target.current}/${target.count}，状态=${engine.state}`
      );
    })();

    // [Test 31] 通用 JamJarSystem 配置：burstShape=FULL_3X3 与 landingScope=island 生效
    await (async () => {
      const colors4 = ['red', 'blue', 'green', 'yellow'];
      const rows = 6;
      const cols = 6;
      const initialTiles = [];
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) row.push(colors4[(r * 2 + c) % 4]);
        initialTiles.push(row);
      }
      const system = new JamJarSystem({
        initialCharge: 1,
        maxCharge: 1,
        burstShape: JamJarBlastScope.FULL_3X3,
        landingScope: 'island',
        activationsRequired: 1,
        targetType: 'ACTIVATE_JAM_JAR',
        preferredLandingPos: { row: 2, col: 4 }, // 右侧区域，island 模式下应被拒绝
        jars: [{ id: 'jar_island', pos: { row: 2, col: 1 } }]
      });
      const engine = new Match3Engine({
        rows,
        cols,
        colors: colors4,
        maxMoves: 10,
        seed: 1042,
        stepDelay: 0,
        initialTiles,
        targets: [{ id: 't', type: 'ACTIVATE_JAM_JAR', count: 1, current: 0 }],
        customMechanics: system
      });

      // 用第 2 列 VOID 把棋盘切成左右两个连通区域
      for (let r = 0; r < rows; r++) engine.grid.setVoid(r, 2, true);
      const allowed = system.getAllowedLandingCells(engine, 'jar_island');
      const allowedOnlyLeftIsland = !!allowed &&
        Array.from(allowed).every(key => Number(key.split(',')[1]) < 2);

      let burst = null;
      let leap = null;
      engine.on('jarBurst', (event) => { burst = event; });
      engine.on('jarLeap', (event) => { leap = event; });

      await system.onPostGravityResolved(engine);

      const pos = system.findJarPos(engine, 'jar_island');
      const expectedBlastCount = pos
        ? JamJarConfig.getBlastCells(pos.row, pos.col, rows, cols, JamJarBlastScope.FULL_3X3).length
        : -1;
      const stayedInIsland = !!pos && pos.col < 2;
      const preferredRejected = leap && !(leap.to.row === 2 && leap.to.col === 4);

      this.assert(
        allowedOnlyLeftIsland && stayedInIsland && preferredRejected &&
          burst && burst.burstShape === JamJarBlastScope.FULL_3X3 &&
          burst.blastCells.length === expectedBlastCount,
        '通用配置：burstShape=FULL_3X3 与 landingScope=island 生效',
        `allowedOnlyLeft=${allowedOnlyLeftIsland}，落点=(${pos ? pos.row : '?'},${pos ? pos.col : '?'})，` +
          `爆浆=${burst ? burst.blastCells.length : '?'}/${expectedBlastCount}，shape=${burst ? burst.burstShape : 'none'}`
      );
    })();

    // [Test 33] 风险复现：固定罐体正下方的消除格必须能通过斜向滑入补料（不得留下永久空格）
    (() => {
      const engine = new Match3Engine({ ...Level62Config, stepDelay: 0 });
      const mech = engine.customMechanics;
      const jarPos = { ...mech.jarPos };
      const clearedRows = [];
      for (let r = jarPos.row + 1; r < engine.rows; r++) {
        engine.grid.getCell(r, jarPos.col).tile = null;
        clearedRows.push(r);
      }

      Gravity.applyGravity(engine.grid, new PRNG(1042), engine.colors);

      let holes = 0;
      for (let r = 0; r < engine.rows; r++) {
        for (let c = 0; c < engine.cols; c++) {
          if (!engine.grid.getCell(r, c).tile) holes++;
        }
      }
      const jarStillFixed = engine.grid.getCell(jarPos.row, jarPos.col).tile &&
        engine.grid.getCell(jarPos.row, jarPos.col).tile.id === 'jar_entity_62';

      this.assert(
        holes === 0 && jarStillFixed,
        '固定罐体下方消除格可斜向滑入补位（无永久空格）',
        `清空下方 ${clearedRows.length} 格后，重力结算剩余空格 ${holes} 个；罐体固定=${!!jarStillFixed}`
      );
    })();

    // [Test 34] 果冻底衬配置：匹配消除扣果冻 HP 并推进 CLEAR_JELLY 目标
    await (async () => {
      const engine = new Match3Engine({
        rows: 5,
        cols: 5,
        maxMoves: 1,
        seed: 1042,
        stepDelay: 0,
        colors: ['red', 'blue', 'green', 'yellow'],
        initialTiles: [
          ['red', 'red', 'blue', 'red', 'green'],
          ['blue', 'green', 'yellow', 'blue', 'red'],
          ['green', 'blue', 'red', 'green', 'yellow'],
          ['yellow', 'red', 'green', 'blue', 'blue'],
          ['blue', 'yellow', 'blue', 'green', 'red']
        ],
        initialUnderlays: [
          { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }
        ],
        targets: [{ id: 'jelly', type: 'CLEAR_JELLY', count: 3, current: 0, label: '清除果冻' }]
      });

      await engine.trySwap({ row: 0, col: 2 }, { row: 0, col: 3 });

      const underlayGone = [0, 1, 2].every(c => engine.grid.getCell(0, c).underlay === null);
      const target = engine.activeTargets[0];
      this.assert(
        underlayGone && target.current === 3,
        '果冻底衬 HP=1：匹配消除后清果冻并推进 CLEAR_JELLY 目标',
        `三格果冻均已清除=${underlayGone}，目标进度 ${target.current}/${target.count}`
      );
    })();

    // [Test 35] 爆浆覆盖格同样清果冻并推进 CLEAR_JELLY 目标
    await (async () => {
      const blastCells = JamJarConfig.getBlastCells(
        Level62Config.safeLandingPos.row,
        Level62Config.safeLandingPos.col,
        Level62Config.rows,
        Level62Config.cols,
        JamJarBlastScope.STRICT_CROSS
      );
      const engine = new Match3Engine({
        ...Level62Config,
        stepDelay: 0,
        initialUnderlays: blastCells.map(cell => ({ row: cell.row, col: cell.col, type: 'JELLY', hp: 1 })),
        targets: [
          ...Level62Config.targets,
          { id: 'jelly', type: 'CLEAR_JELLY', count: blastCells.length, current: 0, label: '清除果冻' }
        ]
      });

      await engine.trySwap(Level62Config.firstMove.from, Level62Config.firstMove.to);

      const jellyTarget = engine.activeTargets.find(t => t.type === 'CLEAR_JELLY');
      const allCleared = blastCells.every(cell => engine.grid.getCell(cell.row, cell.col).underlay === null);
      this.assert(
        jellyTarget && jellyTarget.current === blastCells.length && allCleared,
        '爆浆覆盖格清除果冻并推进 CLEAR_JELLY 目标',
        `爆浆 ${blastCells.length} 格果冻已清除=${allCleared}，目标 ${jellyTarget ? jellyTarget.current : '?'}/${jellyTarget ? jellyTarget.count : '?'}`
      );
    })();

    // [Test 36] 死局洗牌：同 seed 结果确定、洗后无现成三消且存在合法交换
    (() => {
      const colors4 = ['red', 'blue', 'green', 'yellow'];
      const deadlockedTiles = [];
      for (let r = 0; r < 4; r++) {
        const row = [];
        for (let c = 0; c < 4; c++) row.push(colors4[(r % 2) * 2 + (c % 2)]);
        deadlockedTiles.push(row);
      }
      const makeEngine = () => new Match3Engine({
        rows: 4,
        cols: 4,
        colors: colors4,
        seed: 1042,
        maxMoves: 10,
        stepDelay: 0,
        initialTiles: deadlockedTiles
      });
      const buildTwo = () => {
        const engine = makeEngine();
        const initialDeadlocked = !engine.hasPlayableMove();
        let shuffledEvents = 0;
        engine.on('boardShuffled', () => shuffledEvents++);
        const result = engine.resolveDeadlock();
        return { engine, initialDeadlocked, result, shuffledEvents };
      };

      const first = buildTwo();
      const second = buildTwo();
      const snapshot = (engine) => engine.grid.cells
        .map(row => row.map(cell => cell.tile ? cell.tile.color : 'null').join(','))
        .join(';');

      const deterministic = snapshot(first.engine) === snapshot(second.engine);
      const noMatches = MatchFinder.findMatches(first.engine.grid).matches.length === 0;
      const hasMove = first.engine.hasPlayableMove();
      const eventEmitted = first.shuffledEvents === 1 && first.result.shuffled === true;

      this.assert(
        first.initialDeadlocked && deterministic && noMatches && hasMove && eventEmitted,
        '死局洗牌：同 seed 确定性、洗后无三消且有合法交换',
        `初始死局=${first.initialDeadlocked}，洗牌尝试=${first.result.attempts} 次，确定性=${deterministic}，` +
          `洗后三消=${MatchFinder.findMatches(first.engine.grid).matches.length}，合法交换=${hasMove}`
      );
    })();

    // [Test 37] 双罐共鸣：爆浆范围重叠格受 2 倍伤害并发出闪光事件，范围本身不改变
    await (async () => {
      const colors4 = ['red', 'blue', 'green', 'yellow'];
      const rows = 6;
      const cols = 6;
      const initialTiles = [];
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) row.push(colors4[(r * 2 + c) % 4]);
        initialTiles.push(row);
      }
      const system = new JamJarSystem({
        initialCharge: 1,
        maxCharge: 1,
        burstShape: JamJarBlastScope.STRICT_CROSS,
        landingScope: 'global',
        leapOnActivate: false, // 原地爆浆以形成共鸣
        activationsRequired: 1,
        targetType: 'ACTIVATE_JAM_JAR',
        jars: [
          { id: 'jar_res_a', pos: { row: 2, col: 2 } },
          { id: 'jar_res_b', pos: { row: 2, col: 4 } }
        ]
      });
      const engine = new Match3Engine({
        rows,
        cols,
        colors: colors4,
        maxMoves: 10,
        seed: 1042,
        stepDelay: 0,
        initialTiles,
        initialUnderlays: [
          { row: 2, col: 3, type: 'JELLY', hp: 2 }, // 双罐十字范围重叠格
          { row: 1, col: 2, type: 'JELLY', hp: 2 }  // 仅单罐覆盖
        ],
        targets: [{ id: 't', type: 'ACTIVATE_JAM_JAR', count: 2, current: 0 }],
        customMechanics: system
      });

      const leapEvents = [];
      const bursts = [];
      let resonance = null;
      engine.on('jarLeap', (event) => leapEvents.push(event));
      engine.on('jarBurst', (event) => bursts.push(event));
      engine.on('jarResonance', (event) => { resonance = event; });

      await system.onPostGravityResolved(engine);
      engine.checkGameEnd();

      const overlapCell = engine.grid.getCell(2, 3);
      const normalCell = engine.grid.getCell(1, 2);
      const overlapTookDouble = overlapCell.underlay === null; // HP2 被 2 倍伤害清空
      const normalTookSingle = normalCell.underlay && normalCell.underlay.hp === 1; // HP2 只扣 1
      const resonanceReported = !!resonance &&
        resonance.cells.some(cell => cell.row === 2 && cell.col === 3) &&
        resonance.multiplier === 2;
      const noLeap = leapEvents.length === 0;
      const burstCountCorrect = bursts.length === 2;
      const target = engine.activeTargets[0];

      this.assert(
        overlapTookDouble && normalTookSingle && resonanceReported && noLeap &&
          burstCountCorrect && target.current === 2 && engine.state === GameState.VICTORY,
        '双罐共鸣：范围重叠格 2 倍伤害 + 闪光事件，且不改变爆浆范围',
        `重叠格清空=${overlapTookDouble}，普通格剩余HP=${normalCell.underlay ? normalCell.underlay.hp : 'null'}，` +
          `resonanceCells=${resonance ? resonance.cells.length : 0}，leap=${leapEvents.length}，目标=${target.current}/${target.count}`
      );
    })();

    // [Test 38] Lv63 配置：8x8/4色/24步、双罐 PDF 坐标、16 格果冻、双目标
    (() => {
      const engine = new Match3Engine({ ...Level63Config, stepDelay: 0 });
      const jars = [];
      let jellyCount = 0;
      for (let r = 0; r < engine.rows; r++) {
        for (let c = 0; c < engine.cols; c++) {
          const cell = engine.grid.getCell(r, c);
          if (cell.tile && cell.tile.special === 'JAM_JAR') jars.push({ id: cell.tile.id, row: r, col: c, charge: cell.tile.charge });
          if (cell.underlay && cell.underlay.type === 'JELLY') jellyCount++;
        }
      }
      const jarPositionsOk = jars.length === 2 &&
        jars.some(j => j.row === 4 && j.col === 3 && j.id === 'jar_63_a') &&
        jars.some(j => j.row === 4 && j.col === 5 && j.id === 'jar_63_b');
      const allChargeZero = jars.every(j => j.charge === 0);
      const targetTypes = engine.activeTargets.map(t => t.type).sort().join(',');
      const hasBothTargets = targetTypes === 'ACTIVATE_JAM_JAR,CLEAR_JELLY';
      const noInitialMatches = MatchFinder.findMatches(engine.grid).matches.length === 0;
      const hasMoves = engine.hasPlayableMove();
      const colorCounts = {};
      for (let r = 0; r < engine.rows; r++) {
        for (let c = 0; c < engine.cols; c++) {
          const tile = engine.grid.getCell(r, c).tile;
          if (tile && tile.special !== 'JAM_JAR') {
            colorCounts[tile.color] = (colorCounts[tile.color] || 0) + 1;
          }
        }
      }
      const totalCells = engine.rows * engine.cols;
      const ratiosInRange = engine.colors.every(color => {
        const ratio = (colorCounts[color] || 0) / totalCells;
        return ratio >= 0.22 && ratio <= 0.28;
      });
      const removeAfterActivation = engine.customMechanics.removeAfterActivation === true;
      const chargeMetricSelected = engine.customMechanics.chargeMetric === 'chebyshev';

      this.assert(
        engine.rows === 8 && engine.cols === 8 && engine.colors.length === 4 &&
          engine.movesRemaining === 24 && jarPositionsOk && allChargeZero && jellyCount === 16 &&
          hasBothTargets && noInitialMatches && hasMoves && ratiosInRange && removeAfterActivation &&
          chargeMetricSelected,
        'Lv63 配置：双罐 PDF 坐标 / 16 果冻 / 双目标 / 24 步 / 各色 22%-28% / 激活后移除 / chebyshev 邻近',
        `${engine.rows}x${engine.cols}, jars=${jars.map(j => `${j.id}@(${j.row},${j.col})`).join('|')}, ` +
          `jelly=${jellyCount}, colors=${JSON.stringify(colorCounts)}, ratiosOk=${ratiosInRange}, ` +
          `removeAfterActivation=${removeAfterActivation}, chargeMetric=${engine.customMechanics.chargeMetric}, ` +
          `initialMatches=${MatchFinder.findMatches(engine.grid).matches.length}, moves=${hasMoves}`
      );
    })();

    // [Test 39] Lv64 配置（本轮只定配置）：蜂蜜×4 HP2、单罐激活2次、island 落点限制
    (() => {
      const system = Level64Config.customMechanics;
      const jarConfig = system.jarConfigs.find(cfg => cfg.id === 'jar_64');
      const configOk = Level64Config.enabled === true &&
        Level64Config.rows === 8 && Level64Config.cols === 8 && Level64Config.colors.length === 5 &&
        Level64Config.maxMoves === 19;
      const honeyOk = Level64Config.honeyCells.length === 4 &&
        Level64Config.honeyCells.every(cell => cell.hp === 2) &&
        Level64Config.targets.some(t => t.type === 'CLEAR_HONEY' && t.count === 4);
      const jarOk = jarConfig && jarConfig.landingScope === 'island' &&
        jarConfig.activationsRequired === 2 && jarConfig.pos.row === 3 && jarConfig.pos.col === 1 &&
        jarConfig.pos.col < Math.min(...Level64Config.voidColumns) &&
        Level64Config.targets.some(t => t.type === 'ACTIVATE_JAM_JAR' && t.count === 2);

      this.assert(
        configOk && honeyOk && jarOk,
        'Lv64 配置：蜂蜜×4(HP2) / 单罐激活2次 / island 限左岛',
        `8x8/5色/19步=${configOk}, honey=${Level64Config.honeyCells.length}, ` +
          `jar=(${jarConfig ? jarConfig.pos.row : '?'},${jarConfig ? jarConfig.pos.col : '?'}) ` +
          `scope=${jarConfig ? jarConfig.landingScope : '?'} activations=${jarConfig ? jarConfig.activationsRequired : '?'}`
      );
    })();

    // [Test 40] Lv63 双罐同时激活：共鸣重叠格 (4,4) 闪光事件 + 激活目标 2/2
    await (async () => {
      const engine = new Match3Engine({ ...Level63Config, stepDelay: 0 });
      const system = engine.customMechanics;
      const chargeJar = async (jarId, adjacentKey) => {
        for (let i = 0; i < 3; i++) {
          await system.onMatchesResolved(engine, { matchedCells: new Set([adjacentKey]) });
        }
      };
      // A(4,3) 用邻格 (4,2) 充能；B(4,5) 用邻格 (4,6) 充能
      await chargeJar('jar_63_a', '4,2');
      await chargeJar('jar_63_b', '4,6');
      const bothActive = system.getRuntime('jar_63_a').state === JamJarState.ACTIVE &&
        system.getRuntime('jar_63_b').state === JamJarState.ACTIVE;

      let resonance = null;
      engine.on('jarResonance', (event) => { resonance = event; });
      await system.onPostGravityResolved(engine);

      const jarTarget = engine.activeTargets.find(t => t.type === 'ACTIVATE_JAM_JAR');
      const overlapCell = engine.grid.getCell(4, 4);
      const resonanceHitOverlap = resonance &&
        resonance.cells.some(cell => cell.row === 4 && cell.col === 4) &&
        resonance.multiplier === 2;
      const overlapJellyCleared = overlapCell.underlay === null;

      this.assert(
        bothActive && resonanceHitOverlap && overlapJellyCleared &&
          jarTarget.current === 2 && engine.state === GameState.IDLE,
        'Lv63 双罐同时激活触发共鸣并推进激活目标 2/2',
        `bothActive=${bothActive}，重叠格=(${resonance ? resonance.cells.map(c => `${c.row},${c.col}`).join('|') : 'none'})，` +
          `果冻清除=${overlapJellyCleared}，激活目标=${jarTarget.current}/${jarTarget.count}，状态=${engine.state}`
      );
    })();

    // [Test 41] removeAfterActivation：Lv63 罐体激活后从棋盘移除并由重力补料
    await (async () => {
      const engine = new Match3Engine({ ...Level63Config, stepDelay: 0 });
      const system = engine.customMechanics;
      const removed = [];
      engine.on('jarRemoved', (event) => removed.push(event.jarId));
      const countHoles = () => {
        let holes = 0;
        for (let r = 0; r < engine.rows; r++) {
          for (let c = 0; c < engine.cols; c++) if (!engine.grid.getCell(r, c).tile) holes++;
        }
        return holes;
      };
      const chargeFull = async (jarId, adjacentKey) => {
        for (let i = 0; i < 3; i++) {
          await system.onMatchesResolved(engine, { matchedCells: new Set([adjacentKey]) });
        }
      };

      await chargeFull('jar_63_a', '4,2');
      await system.onPostGravityResolved(engine);
      const aGone = system.findJarPos(engine, 'jar_63_a') === null;
      const bStillThere = system.findJarPos(engine, 'jar_63_b') !== null;
      const holesAfterA = countHoles();
      const targetAfterA = engine.activeTargets.find(t => t.type === 'ACTIVATE_JAM_JAR').current;

      await chargeFull('jar_63_b', '4,6');
      await system.onPostGravityResolved(engine);
      const bGone = system.findJarPos(engine, 'jar_63_b') === null;
      const holesAfterB = countHoles();
      const targetAfterB = engine.activeTargets.find(t => t.type === 'ACTIVATE_JAM_JAR').current;
      let jarTilesLeft = 0;
      for (let r = 0; r < engine.rows; r++) {
        for (let c = 0; c < engine.cols; c++) {
          const tile = engine.grid.getCell(r, c).tile;
          if (tile && tile.special === 'JAM_JAR') jarTilesLeft++;
        }
      }

      this.assert(
        aGone && bStillThere && holesAfterA === 0 && targetAfterA === 1 &&
          bGone && holesAfterB === 0 && targetAfterB === 2 && jarTilesLeft === 0 &&
          removed.length === 2,
        'removeAfterActivation：Lv63 罐体激活后移除并补料无空洞',
        `A移除=${aGone}, B仍在=${bStillThere}, 目标=${targetAfterA}->${targetAfterB}, ` +
          `空洞=${holesAfterA}/${holesAfterB}, 剩余罐体=${jarTilesLeft}, jarRemoved事件=${removed.length}`
      );
    })();

    // [Test 42] 邻近判定范围配置：chebyshev1 能识别斜邻，默认 manhattan1 不识别
    await (async () => {
      const makeEngine = (chargeMetric) => {
        const system = new JamJarSystem({
          initialCharge: 0,
          maxCharge: 3,
          chargeMetric,
          chargeRange: 1,
          leapOnActivate: false,
          removeAfterActivation: false,
          activationsRequired: 1,
          targetType: 'ACTIVATE_JAM_JAR',
          jars: [{ id: 'jar_charge', pos: { row: 4, col: 3 } }]
        });
        return new Match3Engine({ ...Level63Config, stepDelay: 0, customMechanics: system });
      };

      const manhattanEngine = makeEngine('manhattan');
      const chebyshevEngine = makeEngine('chebyshev');
      // (3,2) 相对罐体 (4,3) 是斜对角
      await manhattanEngine.customMechanics.onMatchesResolved(manhattanEngine, { matchedCells: new Set(['3,2']) });
      await chebyshevEngine.customMechanics.onMatchesResolved(chebyshevEngine, { matchedCells: new Set(['3,2']) });
      const manhattanCharge = manhattanEngine.customMechanics.getRuntime('jar_charge').charge;
      const chebyshevCharge = chebyshevEngine.customMechanics.getRuntime('jar_charge').charge;

      this.assert(
        manhattanCharge === 0 && chebyshevCharge === 1,
        '邻近判定范围：manhattan1 不识别斜邻 / chebyshev1 识别',
        `manhattan charge=${manhattanCharge}, chebyshev charge=${chebyshevCharge}`
      );
    })();

    // [Test 43] 单次玩家交换充能上限：maxChargesPerSwap 生效
    await (async () => {
      const system = new JamJarSystem({
        initialCharge: 0,
        maxCharge: 3,
        maxChargesPerSwap: 1,
        leapOnActivate: false,
        removeAfterActivation: false,
        activationsRequired: 1,
        targetType: 'ACTIVATE_JAM_JAR',
        jars: [{ id: 'jar_cap', pos: { row: 4, col: 3 } }]
      });
      const engine = new Match3Engine({ ...Level63Config, stepDelay: 0, customMechanics: system });
      engine.swapNumber = 0;
      await system.onMatchesResolved(engine, { matchedCells: new Set(['4,2']) });
      await system.onMatchesResolved(engine, { matchedCells: new Set(['4,2']) });
      const afterSameSwap = system.getRuntime('jar_cap').charge;

      engine.swapNumber = 1; // 模拟下一次玩家交换
      await system.onMatchesResolved(engine, { matchedCells: new Set(['4,2']) });
      const afterNextSwap = system.getRuntime('jar_cap').charge;

      this.assert(
        afterSameSwap === 1 && afterNextSwap === 2,
        '单次交换充能上限 maxChargesPerSwap=1 生效',
        `同一交换内两次邻近消除后 charge=${afterSameSwap}；下一次交换后 charge=${afterNextSwap}`
      );
    })();

    // [Test 44] 激活结算口径：单罐 / 双罐各发一次 jarResolution，双罐共鸣标记正确
    await (async () => {
      // 单罐：Lv62 首步
      const lv62 = new Match3Engine({ ...Level62Config, stepDelay: 0 });
      const lv62Resolutions = [];
      lv62.on('jarResolution', (event) => lv62Resolutions.push(event));
      await lv62.trySwap(Level62Config.firstMove.from, Level62Config.firstMove.to);
      const singleOk = lv62Resolutions.length === 1 &&
        lv62Resolutions[0].mode === 'single' && lv62Resolutions[0].jarIds.length === 1 &&
        lv62Resolutions[0].resonance === false;

      // 双罐同时：Lv63
      const lv63 = new Match3Engine({ ...Level63Config, stepDelay: 0 });
      const system = lv63.customMechanics;
      for (let i = 0; i < 3; i++) {
        await system.onMatchesResolved(lv63, { matchedCells: new Set(['4,2']) });
        await system.onMatchesResolved(lv63, { matchedCells: new Set(['4,6']) });
      }
      const lv63Resolutions = [];
      lv63.on('jarResolution', (event) => lv63Resolutions.push(event));
      await system.onPostGravityResolved(lv63);
      const dualOk = lv63Resolutions.length === 1 &&
        lv63Resolutions[0].mode === 'dual' && lv63Resolutions[0].jarIds.length === 2 &&
        lv63Resolutions[0].resonance === true;

      this.assert(
        singleOk && dualOk,
        'jarResolution 口径：单罐/双罐各一次结算且共鸣标记正确',
        `Lv62=${JSON.stringify(lv62Resolutions)}, Lv63=${JSON.stringify(lv63Resolutions)}`
      );
    })();

    // [Test 45] 传送门：右岛入口从对应的左岛出口列取最下方普通棋子，保持颜色并补位
    (() => {
      const engine = new Match3Engine({ ...Level64Config, stepDelay: 0 });
      const entry = engine.grid.getCell(0, 5);
      const exitCell = engine.grid.getCell(7, 1);
      const sourceColor = exitCell.tile.color;
      entry.tile = null;

      const result = Gravity.applyGravity(engine.grid, new PRNG(1042), engine.colors, engine.portalSystem);
      const entryAfter = engine.grid.getCell(0, 5).tile;
      const exitRefilled = engine.grid.getCell(7, 1).tile !== null;

      this.assert(
        result.portals.length >= 1 && entryAfter && entryAfter.color === sourceColor && exitRefilled,
        '传送门：入口取出口列最下方棋子并保持颜色，出口列正常补料',
        `transfers=${result.portals.length}, entry=${entryAfter ? entryAfter.color : 'null'}, source=${sourceColor}, exitRefilled=${exitRefilled}`
      );
    })();

    // [Test 46] 传送门：出口无料时入口保持为空；右岛顶部不随机补料
    (() => {
      const engine = new Match3Engine({ ...Level64Config, stepDelay: 0 });
      const entry = engine.grid.getCell(0, 6);
      entry.tile = null;
      for (let r = 0; r < 8; r++) engine.grid.getCell(r, 2).tile = null; // 清空配对出口列

      const directTransfers = engine.portalSystem.feedEntries(engine.grid);
      const entryAfterFeed = engine.grid.getCell(0, 6).tile;

      // 右岛顶部非入口格 (0,7)：即使为空也不应随机补料
      engine.grid.getCell(0, 7).tile = null;
      Gravity.applyGravity(engine.grid, new PRNG(1042), engine.colors, engine.portalSystem);
      const rightTopNonEntry = engine.grid.getCell(0, 7).tile;

      this.assert(
        directTransfers.length === 0 && entryAfterFeed === null && rightTopNonEntry === null,
        '传送门：出口取不到料时入口保持空，右岛顶部不随机补料',
        `transfers=${directTransfers.length}, entry(0,6)=${entryAfterFeed ? entryAfterFeed.color : 'null'}, ` +
          `rightTop(0,7)=${rightTopNonEntry ? rightTopNonEntry.color : 'null'}, ` +
          `randomSpawnAllowed(0,7)=${engine.portalSystem.isRandomSpawnAllowed(0, 7)}`
      );
    })();

    // [Test 47] 蜂蜜：每轮每块最多受伤 1 次；HP2 两轮击破，目标推进并正常补位
    (() => {
      const initialTiles = [];
      for (let r = 0; r < 5; r++) {
        const row = [];
        for (let c = 0; c < 5; c++) row.push('blue');
        initialTiles.push(row);
      }
      const engine = new Match3Engine({
        rows: 5,
        cols: 5,
        colors: ['red', 'blue', 'green', 'yellow'],
        maxMoves: 10,
        seed: 1042,
        stepDelay: 0,
        initialTiles,
        initialObstacles: [{ row: 2, col: 2, type: 'HONEY', hp: 2, blocksMovement: true }],
        targets: [{ id: 'honey', type: 'CLEAR_HONEY', count: 1, current: 0 }]
      });

      // 同一轮：蜂蜜同时与两个消除格 (1,2)/(3,2) 相邻，只应受伤 1 次
      engine.grid.getCell(1, 2).tile = engine.grid.createTile('red');
      engine.grid.getCell(3, 2).tile = engine.grid.createTile('red');
      engine.clearMatchedTiles({ matchedCells: new Set(['1,2', '3,2']) });
      const hpAfterFirst = engine.grid.getCell(2, 2).obstacle ? engine.grid.getCell(2, 2).obstacle.hp : null;
      const targetAfterFirst = engine.activeTargets[0].current;

      // 第二轮：再次相邻消除，HP 归零并推进目标
      engine.grid.getCell(1, 2).tile = engine.grid.createTile('red');
      engine.grid.getCell(3, 2).tile = engine.grid.createTile('red');
      engine.clearMatchedTiles({ matchedCells: new Set(['1,2', '3,2']) });
      const honeyGone = engine.grid.getCell(2, 2).obstacle === null;
      const targetAfterSecond = engine.activeTargets[0].current;

      Gravity.applyGravity(engine.grid, new PRNG(1042), engine.colors);
      const refilled = engine.grid.getCell(2, 2).tile !== null;

      this.assert(
        hpAfterFirst === 1 && targetAfterFirst === 0 &&
          honeyGone && targetAfterSecond === 1 && refilled,
        '蜂蜜固定障碍：每轮 1 次伤害、HP2 两轮击破并补位',
        `第一轮 HP=${hpAfterFirst} 目标=${targetAfterFirst}；第二轮 honeyGone=${honeyGone} 目标=${targetAfterSecond}；补位=${refilled}`
      );
    })();

    // [Test 48] 死局洗牌：只改原格颜色，不移动棋子、不跨岛、不动蜂蜜
    (() => {
      const engine = new Match3Engine({ ...Level64Config, stepDelay: 0 });
      const before = new Map();
      const honeyBefore = new Map();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const cell = engine.grid.getCell(r, c);
          before.set(`${r},${c}`, {
            hasTile: !!cell.tile,
            id: cell.tile ? cell.tile.id : null,
            special: cell.tile ? cell.tile.special : null
          });
          if (cell.obstacle) honeyBefore.set(`${r},${c}`, { type: cell.obstacle.type, hp: cell.obstacle.hp });
        }
      }

      engine.recolorBoardNoMatches();

      let positionsIntact = true;
      let honeyIntact = true;
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const cell = engine.grid.getCell(r, c);
          const prev = before.get(`${r},${c}`);
          if (!!cell.tile !== prev.hasTile) positionsIntact = false;
          if (cell.tile && cell.tile.id !== prev.id) positionsIntact = false;
          if (cell.tile && cell.tile.special !== prev.special) positionsIntact = false;
        }
      }
      for (const [key, prev] of honeyBefore.entries()) {
        const [r, c] = key.split(',').map(Number);
        const cell = engine.grid.getCell(r, c);
        if (!cell.obstacle || cell.obstacle.type !== prev.type || cell.obstacle.hp !== prev.hp) honeyIntact = false;
      }
      const noMatches = MatchFinder.findMatches(engine.grid).matches.length === 0;

      this.assert(
        positionsIntact && honeyIntact && noMatches,
        '死局洗牌不跨岛移动棋子、不动蜂蜜，且洗后无现成三消',
        `positionsIntact=${positionsIntact}, honeyIntact=${honeyIntact}, noMatches=${noMatches}`
      );
    })();

    // [Test 49] Lv64 配置：8x8/5色/19步、双岛 VOID、罐子/蜂蜜/传送门坐标
    (() => {
      const engine = new Match3Engine({ ...Level64Config, stepDelay: 0 });
      const system = engine.customMechanics;
      const jarRuntime = system.getRuntime('jar_64');
      let voidCount = 0;
      let honeyCount = 0;
      let normalTileCount = 0;
      const colorCounts = {};
      const honeyHp = [];
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const cell = engine.grid.getCell(r, c);
          if (cell.type === 'VOID') voidCount++;
          if (cell.obstacle && cell.obstacle.type === 'HONEY') {
            honeyCount++;
            honeyHp.push(cell.obstacle.hp);
          }
          if (cell.tile && cell.tile.special !== 'JAM_JAR') {
            normalTileCount++;
            colorCounts[cell.tile.color] = (colorCounts[cell.tile.color] || 0) + 1;
          }
        }
      }
      const ratios = engine.colors.map(color => (colorCounts[color] || 0) / normalTileCount);
      const ratiosOk = ratios.every(ratio => ratio >= 0.16 && ratio <= 0.24);
      const jarOk = jarRuntime && jarRuntime.pos.row === 3 && jarRuntime.pos.col === 1 &&
        jarRuntime.activationsRequired === 2 && jarRuntime.landingScope === 'island' &&
        jarRuntime.removeAfterActivation === false;
      const honeyOk = honeyCount === 4 && honeyHp.every(hp => hp === 2);
      const portalsOk = Level64Config.portalPairs.length === 2 &&
        Level64Config.portalPairs.every(pair => pair.exit.row === 7 && pair.entry.row === 0);
      const noMatches = MatchFinder.findMatches(engine.grid).matches.length === 0;
      const hasMoves = engine.hasPlayableMove();

      this.assert(
        engine.rows === 8 && engine.cols === 8 && engine.colors.length === 5 &&
          engine.movesRemaining === 19 && voidCount === 16 && jarOk && honeyOk && portalsOk &&
          ratiosOk && noMatches && hasMoves,
        'Lv64 配置：8x8/5色/19步、双岛、罐子/蜂蜜/传送门',
        `void=${voidCount}, honey=${honeyCount}(HP ${honeyHp.join('/')}), jar=${jarRuntime ? `${jarRuntime.pos.row},${jarRuntime.pos.col}` : '?'}, ` +
          `colors=${JSON.stringify(colorCounts)}, ratiosOk=${ratiosOk}, portals=${portalsOk}, noMatches=${noMatches}, moves=${hasMoves}`
      );
    })();

    // [Test 50] 修复 b：右岛无垂直供料空格（第7列）可从斜邻右岛格滑入，不跨 VOID
    (() => {
      const engine = new Match3Engine({ ...Level64Config, stepDelay: 0 });
      for (let r = 0; r <= 4; r++) engine.grid.getCell(r, 7).tile = null;
      const result = Gravity.applyGravity(engine.grid, engine.prng, engine.colors, engine.portalSystem);

      let rightEmpty = 0;
      for (let r = 0; r < 8; r++) {
        const cell = engine.grid.getCell(r, 7);
        if (cell.tile === null && !(cell.obstacle && cell.obstacle.blocksMovement)) rightEmpty++;
      }
      const diagonalDrops = result.drops.filter(drop => drop.rightIslandDiagonal);
      const noVoidCrossing = diagonalDrops.every(drop =>
        drop.from.col >= 5 && drop.from.col <= 7 && drop.to.col >= 5 && drop.to.col <= 7);

      this.assert(
        rightEmpty <= 1 && diagonalDrops.length > 0 && noVoidCrossing,
        '右岛无垂直供料空格：斜向滑入补位且不跨 VOID',
        `rightEmpty=${rightEmpty}, diagonalDrops=${diagonalDrops.length}, noVoidCrossing=${noVoidCrossing}`
      );
    })();

    // [Test 51] 传送接料：一次重力内循环到入口无空位（两个入口都接到料）
    (() => {
      const engine = new Match3Engine({ ...Level64Config, stepDelay: 0 });
      engine.grid.getCell(0, 5).tile = null;
      engine.grid.getCell(0, 6).tile = null;
      engine.portalSystem.resetStats();

      const result = Gravity.applyGravity(engine.grid, engine.prng, engine.colors, engine.portalSystem);
      const entryA = engine.grid.getCell(0, 5).tile;
      const entryB = engine.grid.getCell(0, 6).tile;
      const feedsA = engine.portalSystem.stats.entryFeeds['0,5'] || 0;
      const feedsB = engine.portalSystem.stats.entryFeeds['0,6'] || 0;

      this.assert(
        entryA && entryB && result.portals.length >= 2 && feedsA >= 1 && feedsB >= 1,
        '传送接料循环到稳定：两入口在一次重力内均接到料',
        `entries=${!!entryA}/${!!entryB}, transfers=${result.portals.length}, feeds=${feedsA}/${feedsB}`
      );
    })();

    // [Test 52] 蜂蜜受伤范围可配置：含斜向模式下，斜邻消除也能造成 1 点伤害
    (() => {
      const makeEngine = (honeyDamageAdjacency) => {
        const initialTiles = [];
        for (let r = 0; r < 5; r++) {
          const row = [];
          for (let c = 0; c < 5; c++) row.push('blue');
          initialTiles.push(row);
        }
        const engine = new Match3Engine({
          rows: 5,
          cols: 5,
          colors: ['red', 'blue', 'green', 'yellow'],
          maxMoves: 10,
          seed: 1042,
          stepDelay: 0,
          honeyDamageAdjacency,
          initialTiles,
          initialObstacles: [{ row: 2, col: 2, type: 'HONEY', hp: 2, blocksMovement: true }],
          targets: [{ id: 'honey', type: 'CLEAR_HONEY', count: 1, current: 0 }]
        });
        engine.grid.getCell(1, 1).tile = engine.grid.createTile('red'); // 与蜂蜜 (2,2) 斜邻
        engine.clearMatchedTiles({ matchedCells: new Set(['1,1']) });
        return engine.grid.getCell(2, 2).obstacle ? engine.grid.getCell(2, 2).obstacle.hp : 0;
      };

      const orthogonalHp = makeEngine('orthogonal');
      const diagonalHp = makeEngine('diagonal');
      this.assert(
        orthogonalHp === 2 && diagonalHp === 1,
        '蜂蜜受伤范围：正交模式不判定斜邻 / diagonal 模式判定斜邻',
        `orthogonal HP=${orthogonalHp}, diagonal HP=${diagonalHp}`
      );
    })();

    return this.results;
  }
}
