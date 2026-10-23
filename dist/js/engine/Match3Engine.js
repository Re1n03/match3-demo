/**
 * Match3Engine.js - 三消通用核心游戏逻辑引擎 (熔断安全修复版)
 */

import { Grid, CellType } from './Grid.js';
import { MatchFinder } from './MatchFinder.js';
import { Gravity } from './Gravity.js';
import { PRNG } from './PRNG.js';

export const GameState = {
  IDLE: 'IDLE',       // 空闲就绪，等待玩家输入
  BUSY: 'BUSY',       // 动画或级联结算中，输入锁死
  VICTORY: 'VICTORY', // 关卡胜利
  DEFEAT: 'DEFEAT',   // 关卡失败 (步数耗尽且目标未达成)
  ERROR: 'ERROR'      // 异常熔断保护状态 (防非正常结算)
};

export class Match3Engine {
  constructor(config = {}) {
    this.config = config;
    this.rows = config.rows || 9;
    this.cols = config.cols || 9;
    this.colors = config.colors || ['red', 'blue', 'green', 'yellow'];
    this.maxMoves = config.maxMoves || 20;
    this.seed = config.seed !== undefined ? config.seed : 1042;
    this.targets = config.targets || [];
    this.customMechanics = config.customMechanics || null;
    // 传送门系统为关卡级配置（入口/出口坐标对），重力补料时读取
    this.portalSystem = config.portalSystem
      || (config.customMechanics && config.customMechanics.portalSystem)
      || null;

    // 安全熔断上限：防止极端死锁导致级联死循环卡死浏览器
    this.MAX_CASCADE_SAFETY_LIMIT = config.maxCascadeLimit || 50;

    this.prng = new PRNG(this.seed);
    this.grid = new Grid(this.rows, this.cols);
    this.state = GameState.IDLE;
    this.movesRemaining = this.maxMoves;
    this.score = 0;
    this.currentCascade = 0;
    this.swapNumber = 0; // 有效交换序号：供机制按“单次玩家交换”限流
    this.lastError = null; // 异常熔断记录

    this.listeners = {
      stateChange: [],
      swapStart: [],
      swapRollback: [],
      tilesCleared: [],
      gravityApplied: [],
      cascadeStep: [],
      movesChanged: [],
      targetsUpdated: [],
      victory: [],
      defeat: [],
      error: []
    };

    this.initBoard();
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  removeAllListeners(event = null) {
    if (event && this.listeners[event]) {
      this.listeners[event] = [];
    } else if (!event) {
      for (const key of Object.keys(this.listeners)) {
        this.listeners[key] = [];
      }
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      for (const cb of this.listeners[event]) {
        try {
          cb(data);
        } catch (e) {
          console.error(`[Match3Engine] Error in listener for ${event}:`, e);
        }
      }
    }
  }

  setState(newState) {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      this.emit('stateChange', { oldState, newState });
    }
  }

  initBoard() {
    this.prng.reset();
    this.grid.init();
    this.movesRemaining = this.maxMoves;
    this.score = 0;
    this.currentCascade = 0;
    this.swapNumber = 0;
    this.lastError = null;
    // 关键修复：重开/重置必须走 setState，确保向渲染层广播 stateChange，
    // 否则结算后重置不会解除 BoardRenderer 的 input-locked 输入锁。
    this.setState(GameState.IDLE);

    this.activeTargets = JSON.parse(JSON.stringify(this.targets));

    // 物理镂空岛（Lv64）：在铺棋前设置，重力/匹配均会阻断
    if (Array.isArray(this.config.initialVoids)) {
      for (const voidCell of this.config.initialVoids) {
        this.grid.setVoid(voidCell.row, voidCell.col, true);
      }
    }

    if (this.config.initialTiles && Array.isArray(this.config.initialTiles)) {
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const tileDef = this.config.initialTiles[r] ? this.config.initialTiles[r][c] : null;
          if (tileDef) {
            // 支持字符串颜色或完整对象 { color, special, charge }
            if (typeof tileDef === 'string') {
              const tile = this.grid.createTile(tileDef);
              this.grid.getCell(r, c).tile = tile;
            } else if (typeof tileDef === 'object') {
              const tile = this.grid.createTile(tileDef.color, tileDef.special);
              if (tileDef.charge !== undefined) tile.charge = tileDef.charge;
              this.grid.getCell(r, c).tile = tile;
            }
          }
        }
      }
    } else {
      this.generateNoMatchBoard();
    }

    // 关卡底衬配置（果冻 HP=1 等）：独立于棋子层，被消除或爆浆覆盖时扣 HP
    if (Array.isArray(this.config.initialUnderlays)) {
      for (const underlayDef of this.config.initialUnderlays) {
        const cell = this.grid.getCell(underlayDef.row, underlayDef.col);
        if (!cell) continue;
        cell.underlay = {
          type: underlayDef.type || 'JELLY',
          hp: underlayDef.hp !== undefined ? underlayDef.hp : 1
        };
      }
    }

    // 固定实体障碍（Lv64 蜂蜜）：blocksMovement，格上不叠放普通棋子
    if (Array.isArray(this.config.initialObstacles)) {
      for (const obstacleDef of this.config.initialObstacles) {
        const cell = this.grid.getCell(obstacleDef.row, obstacleDef.col);
        if (!cell) continue;
        const hp = obstacleDef.hp !== undefined ? obstacleDef.hp : 2;
        cell.obstacle = {
          type: obstacleDef.type || 'HONEY',
          hp,
          maxHp: obstacleDef.maxHp !== undefined ? obstacleDef.maxHp : hp,
          blocksMovement: obstacleDef.blocksMovement !== false
        };
        if (cell.obstacle.blocksMovement) cell.tile = null;
      }
    }

    if (this.customMechanics && typeof this.customMechanics.onInitLevel === 'function') {
      this.customMechanics.onInitLevel(this);
    }

    this.emit('movesChanged', { moves: this.movesRemaining });
    this.emit('targetsUpdated', { targets: this.activeTargets });
  }

  generateNoMatchBoard() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.grid.isPlayable(r, c)) continue;
        
        const excludedColors = new Set();
        if (c >= 2) {
          const t1 = this.grid.getCell(r, c - 1).tile;
          const t2 = this.grid.getCell(r, c - 2).tile;
          if (t1 && t2 && t1.color === t2.color) {
            excludedColors.add(t1.color);
          }
        }
        if (r >= 2) {
          const t1 = this.grid.getCell(r - 1, c).tile;
          const t2 = this.grid.getCell(r - 2, c).tile;
          if (t1 && t2 && t1.color === t2.color) {
            excludedColors.add(t1.color);
          }
        }

        const validColors = this.colors.filter(c => !excludedColors.has(c));
        const chosenColor = validColors.length > 0 ? this.prng.choice(validColors) : this.prng.choice(this.colors);
        this.grid.getCell(r, c).tile = this.grid.createTile(chosenColor);
      }
    }
  }

  async trySwap(posA, posB) {
    if (this.state === GameState.VICTORY || this.state === GameState.DEFEAT || this.state === GameState.ERROR) {
      return { success: false, reason: 'GAME_OVER' };
    }
    if (this.state !== GameState.IDLE) {
      return { success: false, reason: 'ENGINE_BUSY' };
    }

    if (!this.grid.isAdjacent(posA, posB)) {
      return { success: false, reason: 'NOT_ADJACENT' };
    }
    if (!this.grid.canSwap(posA.row, posA.col) || !this.grid.canSwap(posB.row, posB.col)) {
      return { success: false, reason: 'CANNOT_SWAP_CELL' };
    }

    this.grid.swapTiles(posA, posB);
    const matchResult = MatchFinder.findMatches(this.grid);

    if (matchResult.matches.length === 0) {
      this.grid.swapTiles(posA, posB);
      this.emit('swapRollback', { posA, posB });
      return { success: false, reason: 'NO_MATCH' };
    }

    this.setState(GameState.BUSY);
    this.movesRemaining--;
    this.swapNumber++;
    this.emit('movesChanged', { moves: this.movesRemaining });
    this.emit('swapStart', { posA, posB });

    await this.runCascadeLoop(matchResult);

    return { success: true };
  }

  async runCascadeLoop(initialMatchResult) {
    let currentMatch = initialMatchResult;
    this.currentCascade = 0;
    let loopTrippedSafetyLimit = false;

    while (currentMatch && currentMatch.matches.length > 0) {
      // 熔断安全拦截
      if (this.currentCascade >= this.MAX_CASCADE_SAFETY_LIMIT) {
        loopTrippedSafetyLimit = true;
        this.lastError = {
          code: 'CASCADE_LIMIT_EXCEEDED',
          message: `级联消除超过最大安全深度 (${this.MAX_CASCADE_SAFETY_LIMIT})，强制中断！`
        };
        console.error(`[Match3Engine] ${this.lastError.message}`);
        this.emit('error', this.lastError);
        break;
      }

      this.currentCascade++;
      this.emit('cascadeStep', { cascadeIndex: this.currentCascade });

      // 1. 消除匹配棋子
      const clearedInfo = this.clearMatchedTiles(currentMatch);
      this.emit('tilesCleared', {
        cascadeIndex: this.currentCascade,
        matches: currentMatch.matches,
        clearedCount: clearedInfo.clearedCount,
        clearedColors: clearedInfo.clearedColors
      });

      if (this.config.stepDelay > 0) {
        await this.sleep(this.config.stepDelay);
      }

      // 2. 特殊机制挂钩 (前置: 如果酱罐监听相邻匹配与充能)
      if (this.customMechanics && typeof this.customMechanics.onMatchesResolved === 'function') {
        await this.customMechanics.onMatchesResolved(this, currentMatch);
      }

      // 3. 重力下落与补料（有传送门时走专用路径）
      const gravityResult = Gravity.applyGravity(
        this.grid,
        this.prng,
        this.colors,
        this.portalSystem
      );
      this.emit('gravityApplied', gravityResult);

      if (this.config.stepDelay > 0) {
        await this.sleep(this.config.stepDelay);
      }

      // 4. 特殊机制挂钩 (后置: 满载果酱罐寻路腾跃与爆浆)
      if (this.customMechanics && typeof this.customMechanics.onPostGravityResolved === 'function') {
        await this.customMechanics.onPostGravityResolved(this);
      }

      // 5. 扫描新的连消
      currentMatch = MatchFinder.findMatches(this.grid);
    }

    this.currentCascade = 0;

    // 关键审计安全路径：若触发了熔断，绝对不能执行正常胜负结算，直接转为 ERROR 终态
    if (loopTrippedSafetyLimit) {
      this.setState(GameState.ERROR);
      return;
    }

    // 死局检测：仍有步数且目标未达成时，执行确定性洗牌（保证洗后无现成三消）
    const allTargetsCompleted = this.activeTargets.length > 0 &&
      this.activeTargets.every(t => t.current >= t.count);
    if (this.movesRemaining > 0 && !allTargetsCompleted && !this.hasPlayableMove()) {
      this.resolveDeadlock();
    }

    this.checkGameEnd();
  }

  /** 当前棋盘是否存在至少一个能产生三消的相邻交换 */
  hasPlayableMove() {
    return MatchFinder.findPossibleMoves(this.grid).length > 0;
  }

  /**
   * 在当前棋盘上重排普通棋子颜色，构造“无现成三消”的布局。
   * 保留固定实体（如果酱罐）、障碍与底衬；只改普通棋子颜色。
   */
  recolorBoardNoMatches() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.grid.isPlayable(r, c)) continue;
        const cell = this.grid.getCell(r, c);
        if (!cell.tile || cell.tile.special === 'JAM_JAR') continue;
        if (cell.obstacle && cell.obstacle.blocksMovement) continue;

        const excludedColors = new Set();
        if (c >= 2) {
          const t1 = this.grid.getCell(r, c - 1).tile;
          const t2 = this.grid.getCell(r, c - 2).tile;
          if (t1 && t2 && t1.color === t2.color) excludedColors.add(t1.color);
        }
        if (r >= 2) {
          const t1 = this.grid.getCell(r - 1, c).tile;
          const t2 = this.grid.getCell(r - 2, c).tile;
          if (t1 && t2 && t1.color === t2.color) excludedColors.add(t1.color);
        }

        const validColors = this.colors.filter(color => !excludedColors.has(color));
        const chosenColor = validColors.length > 0
          ? this.prng.choice(validColors)
          : this.prng.choice(this.colors);
        cell.tile.color = chosenColor;
      }
    }
  }

  /**
   * 死局洗牌：使用当前 PRNG 序列重排，直到“无现成三消且至少有一个合法交换”。
   * 同一 seed / 操作序列下结果确定可复现。
   * @returns {{shuffled:boolean, attempts:number}}
   */
  resolveDeadlock() {
    if (this.hasPlayableMove()) {
      return { shuffled: false, attempts: 0 };
    }

    const maxAttempts = 100;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.recolorBoardNoMatches();
      const noMatches = MatchFinder.findMatches(this.grid).matches.length === 0;
      if (noMatches && this.hasPlayableMove()) {
        this.emit('boardShuffled', { attempts: attempt });
        return { shuffled: true, attempts: attempt };
      }
    }

    // 极端情况下无法构造可玩棋盘：保持无三消并记录错误，避免死循环
    this.lastError = {
      code: 'SHUFFLE_FAILED',
      message: `死局洗牌在 ${maxAttempts} 次尝试内未能生成可玩棋盘`
    };
    console.error(`[Match3Engine] ${this.lastError.message}`);
    this.emit('error', this.lastError);
    return { shuffled: false, attempts: maxAttempts };
  }

  clearMatchedTiles(matchResult) {
    let clearedCount = 0;
    const clearedColors = {};
    const honeyHitThisRound = new Set();

    for (const cellKey of matchResult.matchedCells) {
      const [r, c] = cellKey.split(',').map(Number);
      const cell = this.grid.getCell(r, c);
      if (cell && cell.tile) {
        const color = cell.tile.color;
        clearedColors[color] = (clearedColors[color] || 0) + 1;
        cell.tile = null;
        clearedCount++;

        if (cell.underlay && cell.underlay.hp > 0) {
          cell.underlay.hp--;
          if (cell.underlay.hp <= 0) {
            cell.underlay = null;
            this.updateTargetProgress('CLEAR_JELLY', 1);
          }
        }

        // 蜂蜜受伤：默认正交相邻；可配置为含斜向；同一结算轮同一蜂蜜最多受伤 1 次
        const honeyDirections = this.config.honeyDamageAdjacency === 'diagonal'
          ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]
          : [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of honeyDirections) {
          const nr = r + dr;
          const nc = c + dc;
          if (!this.grid.isValid(nr, nc)) continue;
          const neighbor = this.grid.getCell(nr, nc);
          if (neighbor && neighbor.obstacle && neighbor.obstacle.type === 'HONEY' &&
            neighbor.obstacle.hp > 0) {
            honeyHitThisRound.add(`${nr},${nc}`);
          }
        }
      }
    }

    for (const honeyKey of honeyHitThisRound) {
      const [hr, hc] = honeyKey.split(',').map(Number);
      const honeyCell = this.grid.getCell(hr, hc);
      if (!honeyCell || !honeyCell.obstacle) continue;
      honeyCell.obstacle.hp -= 1;
      if (honeyCell.obstacle.hp <= 0) {
        honeyCell.obstacle = null;
        this.updateTargetProgress('CLEAR_HONEY', 1);
      }
    }

    for (const [color, count] of Object.entries(clearedColors)) {
      this.updateTargetProgress(`COLLECT_${color.toUpperCase()}`, count);
      this.updateTargetProgress('COLLECT_ANY', count);
    }

    this.score += clearedCount * 10 * this.currentCascade;
    return { clearedCount, clearedColors };
  }

  updateTargetProgress(targetType, amount = 1) {
    let changed = false;
    for (const target of this.activeTargets) {
      if (target.type === targetType && target.current < target.count) {
        target.current = Math.min(target.count, target.current + amount);
        changed = true;
      }
    }
    if (changed) {
      this.emit('targetsUpdated', { targets: this.activeTargets });
    }
  }

  checkGameEnd() {
    const isAllTargetsCompleted = this.activeTargets.length > 0 &&
      this.activeTargets.every(t => t.current >= t.count);

    if (isAllTargetsCompleted) {
      this.setState(GameState.VICTORY);
      this.emit('victory', { score: this.score, movesLeft: this.movesRemaining });
      return;
    }

    if (this.movesRemaining <= 0) {
      this.setState(GameState.DEFEAT);
      this.emit('defeat', { score: this.score, targets: this.activeTargets });
      return;
    }

    this.setState(GameState.IDLE);
  }

  reset() {
    this.initBoard();
  }

  sleep(ms) {
    if (ms <= 0) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
