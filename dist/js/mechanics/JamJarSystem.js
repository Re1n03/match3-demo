/**
 * JamJarSystem.js - 果酱罐通用机制系统（多实例 / 配置驱动）
 *
 * 设计目标：
 * 1. 与具体关卡解耦：initialCharge / burstShape / landingScope / activationsRequired 均由关卡配置传入；
 * 2. 按实体 ID 管理多个罐体实例，每个实例独立充能、寻路、爆浆、重置；
 * 3. 落点判定复用 JamJarConfig.findBestLandingCell，爆浆范围复用 JamJarConfig.getBlastCells；
 * 4. 罐体为固定实体（Gravity 负责不移动），起跳后原格置空，由后续重力正常补料。
 *
 * 引擎钩子协议（与 Match3Engine.customMechanics 一致）：
 *   onInitLevel(engine)
 *   onMatchesResolved(engine, currentMatch)
 *   onPostGravityResolved(engine)
 */

import { JamJarConfig, JamJarState, JamJarBlastScope } from './JamJarConfig.js';
import { Gravity } from '../engine/Gravity.js';

export class JamJarSystem {
  /**
   * @param {Object} [options]
   * @param {number} [options.initialCharge=0] 初始充能
   * @param {number} [options.maxCharge=3] 满充阈值
   * @param {string} [options.burstShape=JamJarBlastScope.STRICT_CROSS] 爆浆形状
   * @param {'global'|'island'} [options.landingScope='global'] 落点范围
   * @param {number} [options.activationsRequired=1] 每个罐体需要激活的次数
   * @param {string} [options.targetType='ACTIVATE_JAM_JAR'] 激活时推进的目标类型
   * @param {boolean} [options.leapOnActivate=true] 激活时是否腾跃（false=原地爆浆，用于双罐共鸣关）
   * @param {boolean} [options.removeAfterActivation=false] 完成全部激活后是否从棋盘移除罐体并由重力补料
   * @param {'manhattan'|'chebyshev'} [options.chargeMetric='manhattan'] 邻近判定距离口径
   * @param {number} [options.chargeRange=1] 邻近判定范围（默认曼哈顿 1 = 四向相邻）
   * @param {number} [options.maxChargesPerSwap=Infinity] 单次玩家交换内每个罐体最多充能次数
   * @param {{row:number,col:number}} [options.preferredLandingPos=null] 平局优先落点
   * @param {Array<{id:string,pos:{row:number,col:number}}>} [options.jars=[]] 罐体实例定义
   */
  constructor(options = {}) {
    this.initialCharge = options.initialCharge ?? 0;
    this.maxCharge = options.maxCharge ?? 3;
    this.burstShape = options.burstShape ?? JamJarBlastScope.STRICT_CROSS;
    this.landingScope = options.landingScope ?? 'global';
    this.activationsRequired = options.activationsRequired ?? 1;
    this.targetType = options.targetType ?? 'ACTIVATE_JAM_JAR';
    this.preferredLandingPos = options.preferredLandingPos ?? null;
    this.leapOnActivate = options.leapOnActivate !== false;
    this.removeAfterActivation = options.removeAfterActivation === true;
    this.chargeMetric = options.chargeMetric ?? 'manhattan';
    this.chargeRange = options.chargeRange ?? 1;
    this.maxChargesPerSwap = options.maxChargesPerSwap ?? Infinity;

    this.jarConfigs = (options.jars || []).map((jar) => ({
      id: jar.id,
      pos: { row: jar.pos.row, col: jar.pos.col },
      initialCharge: jar.initialCharge ?? this.initialCharge,
      maxCharge: jar.maxCharge ?? this.maxCharge,
      burstShape: jar.burstShape ?? this.burstShape,
      landingScope: jar.landingScope ?? this.landingScope,
      activationsRequired: jar.activationsRequired ?? this.activationsRequired,
      preferredLandingPos: jar.preferredLandingPos ?? this.preferredLandingPos,
      leapOnActivate: jar.leapOnActivate !== undefined ? jar.leapOnActivate : this.leapOnActivate,
      removeAfterActivation: jar.removeAfterActivation !== undefined ? jar.removeAfterActivation : this.removeAfterActivation,
      chargeMetric: jar.chargeMetric ?? this.chargeMetric,
      chargeRange: jar.chargeRange ?? this.chargeRange,
      maxChargesPerSwap: jar.maxChargesPerSwap ?? this.maxChargesPerSwap
    }));

    /** @type {Map<string, Object>} 运行时状态（按实体 ID） */
    this.runtime = new Map();

    // 单次交换内的充能计数（按实体 ID），用于 maxChargesPerSwap 限流
    this.lastSwapNumber = -1;
    this.chargesThisSwap = new Map();
  }

  // ---------------------------------------------------------------- 初始化

  onInitLevel(engine) {
    this.runtime.clear();
    this.lastSwapNumber = -1;
    this.chargesThisSwap.clear();

    for (const cfg of this.jarConfigs) {
      const charge = Math.max(0, Math.min(cfg.initialCharge, cfg.maxCharge));
      const runtime = {
        ...cfg,
        pos: { ...cfg.pos },
        charge,
        state: charge >= cfg.maxCharge ? JamJarState.ACTIVE : JamJarState.IDLE,
        activations: 0,
        completed: false
      };

      const cell = engine.grid.getCell(cfg.pos.row, cfg.pos.col);
      if (!cell) {
        console.warn(`[JamJarSystem] 罐体 ${cfg.id} 初始坐标越界，已跳过`);
        continue;
      }
      cell.tile = {
        id: cfg.id,
        color: 'jar',
        special: 'JAM_JAR',
        charge,
        maxCharge: cfg.maxCharge,
        state: runtime.state
      };

      this.runtime.set(cfg.id, runtime);
    }
  }

  // ---------------------------------------------------------------- 实体查询

  /** 按实体 ID 扫描罐体当前位置（唯一真源） */
  findJarPos(engine, jarId = null) {
    const targetId = jarId ?? this._primaryId();
    if (!targetId) return null;
    for (let r = 0; r < engine.rows; r++) {
      for (let c = 0; c < engine.cols; c++) {
        const tile = engine.grid.getCell(r, c).tile;
        if (tile && tile.special === 'JAM_JAR' && tile.id === targetId) {
          return { row: r, col: c };
        }
      }
    }
    return null;
  }

  /** 以实体实际位置回写运行时坐标 */
  syncJarPos(engine, jarId = null) {
    const targetId = jarId ?? this._primaryId();
    if (!targetId) return null;
    const pos = this.findJarPos(engine, targetId);
    const runtime = this.runtime.get(targetId);
    if (pos && runtime) runtime.pos = pos;
    return pos;
  }

  getRuntime(jarId) {
    return this.runtime.get(jarId) || null;
  }

  _primaryId() {
    const first = this.runtime.keys().next();
    if (!first.done) return first.value;
    if (this.jarConfigs.length) return this.jarConfigs[0].id;
    return null;
  }

  // 单罐关卡的兼容访问器（多罐请使用 getRuntime(id)）
  get jarPos() {
    const runtime = this.getRuntime(this._primaryId());
    return runtime ? { ...runtime.pos } : null;
  }

  get jarCharge() {
    const runtime = this.getRuntime(this._primaryId());
    return runtime ? runtime.charge : 0;
  }

  get jarState() {
    const runtime = this.getRuntime(this._primaryId());
    return runtime ? runtime.state : JamJarState.IDLE;
  }

  // ---------------------------------------------------------------- 充能

  async onMatchesResolved(engine, currentMatch) {
    // 单次玩家交换内限流：新交换重置计数
    if (engine.swapNumber !== this.lastSwapNumber) {
      this.lastSwapNumber = engine.swapNumber;
      this.chargesThisSwap.clear();
    }

    for (const runtime of this.runtime.values()) {
      if (runtime.completed || runtime.state !== JamJarState.IDLE) continue;
      if (!this.syncJarPos(engine, runtime.id)) continue;
      if (!this._isWithinChargeRange(runtime.pos, currentMatch, runtime.chargeMetric, runtime.chargeRange)) continue;

      const chargedThisSwap = this.chargesThisSwap.get(runtime.id) || 0;
      if (chargedThisSwap >= runtime.maxChargesPerSwap) continue; // 单次交换充能上限

      runtime.charge = Math.min(runtime.maxCharge, runtime.charge + 1);
      this.chargesThisSwap.set(runtime.id, chargedThisSwap + 1);

      const jarCell = engine.grid.getCell(runtime.pos.row, runtime.pos.col);
      if (jarCell && jarCell.tile && jarCell.tile.id === runtime.id) {
        jarCell.tile.charge = runtime.charge;
      }
      engine.emit('jarCharged', {
        jarId: runtime.id,
        pos: { ...runtime.pos },
        charge: runtime.charge,
        maxCharge: runtime.maxCharge
      });

      if (runtime.charge >= runtime.maxCharge) {
        runtime.state = JamJarState.ACTIVE;
        if (jarCell && jarCell.tile && jarCell.tile.id === runtime.id) {
          jarCell.tile.state = JamJarState.ACTIVE;
        }
        engine.emit('jarActive', { jarId: runtime.id, pos: { ...runtime.pos } });
      }
    }
  }

  _isWithinChargeRange(jarPos, currentMatch, metric = 'manhattan', range = 1) {
    for (const cellKey of currentMatch.matchedCells) {
      const [r, c] = cellKey.split(',').map(Number);
      const dr = Math.abs(r - jarPos.row);
      const dc = Math.abs(c - jarPos.col);
      const distance = metric === 'chebyshev' ? Math.max(dr, dc) : (dr + dc);
      if (distance >= 1 && distance <= range) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- 腾跃 + 爆浆

  async onPostGravityResolved(engine) {
    const activeJars = Array.from(this.runtime.values())
      .filter(rt => !rt.completed && rt.state === JamJarState.ACTIVE);

    if (activeJars.length === 0) return;

    // 双罐及以上且全部为“原地爆浆”配置时，进入共鸣同时结算：
    // 各自爆浆范围不变，重叠格伤害翻倍并发出闪光事件。
    const allStationary = activeJars.every(rt => rt.leapOnActivate === false);
    if (activeJars.length >= 2 && allStationary) {
      await this._activateJarsInPlace(engine, activeJars);
      return;
    }

    for (const runtime of activeJars) {
      if (runtime.completed || runtime.state !== JamJarState.ACTIVE) continue;
      await this._activateJar(engine, runtime);
    }
  }

  /**
   * 多罐原地同时爆浆：计算范围重叠格并对重叠格施加 2 倍伤害。
   */
  async _activateJarsInPlace(engine, activeJars) {
    const plans = activeJars.map((runtime) => ({
      runtime,
      blastCells: JamJarConfig.getBlastCells(
        runtime.pos.row,
        runtime.pos.col,
        engine.rows,
        engine.cols,
        runtime.burstShape
      )
    }));

    // 统计每个格子被几个罐体覆盖（1=普通伤害，>=2=共鸣 2 倍伤害）
    const damageByCell = new Map();
    for (const plan of plans) {
      for (const cell of plan.blastCells) {
        const key = `${cell.row},${cell.col}`;
        damageByCell.set(key, (damageByCell.get(key) || 0) + 1);
      }
    }
    const resonanceCells = [];
    for (const [key, coverage] of damageByCell.entries()) {
      if (coverage >= 2) {
        const [row, col] = key.split(',').map(Number);
        resonanceCells.push({ row, col });
      }
    }

    for (const plan of plans) {
      plan.runtime.state = JamJarState.BURST_AND_SPLASH;
      engine.emit('jarBurst', {
        jarId: plan.runtime.id,
        pos: { ...plan.runtime.pos },
        blastCells: plan.blastCells,
        burstShape: plan.runtime.burstShape,
        resonance: resonanceCells.length > 0
      });
    }
    if (resonanceCells.length > 0) {
      engine.emit('jarResonance', {
        cells: resonanceCells,
        jars: plans.map(p => p.runtime.id),
        multiplier: 2
      });
    }
    if (engine.config.stepDelay > 0) {
      await engine.sleep(350);
    }

    let clearedTiles = 0;
    for (const [key, coverage] of damageByCell.entries()) {
      const [row, col] = key.split(',').map(Number);
      const cell = engine.grid.getCell(row, col);
      if (!cell) continue;
      const damage = coverage >= 2 ? 2 : 1;

      // 果冻/障碍等底衬按伤害扣 HP；重叠格伤害翻倍
      if (cell.underlay && cell.underlay.hp > 0) {
        cell.underlay.hp -= damage;
        if (cell.underlay.hp <= 0) {
          cell.underlay = null;
          engine.updateTargetProgress('CLEAR_JELLY', 1);
        }
      }

      // 罐体自身格不被清掉
      if (cell.tile && cell.tile.special !== 'JAM_JAR') {
        cell.tile = null;
        clearedTiles++;
      }
    }
    engine.score += clearedTiles * 30;

    // 统一重力补料
    Gravity.applyGravity(engine.grid, engine.prng, engine.colors, engine.portalSystem || null);
    engine.emit('gravityApplied', {});
    if (engine.config.stepDelay > 0) {
      await engine.sleep(150);
    }

    for (const plan of plans) {
      const runtime = plan.runtime;
      this.syncJarPos(engine, runtime.id);
      runtime.activations += 1;
      engine.updateTargetProgress(this.targetType, 1);
      engine.emit('jarActivated', {
        jarId: runtime.id,
        pos: { ...runtime.pos },
        activations: runtime.activations,
        activationsRequired: runtime.activationsRequired,
        resonance: resonanceCells.length > 0
      });

      runtime.charge = 0;
      runtime.state = JamJarState.IDLE;
      const jarCell = engine.grid.getCell(runtime.pos.row, runtime.pos.col);
      if (jarCell && jarCell.tile && jarCell.tile.id === runtime.id) {
        jarCell.tile.charge = 0;
        jarCell.tile.state = JamJarState.IDLE;
      }
      if (runtime.activations >= runtime.activationsRequired) {
        runtime.completed = true;
        engine.emit('jarCompleted', { jarId: runtime.id, pos: { ...runtime.pos } });
      }
    }

    // 共鸣结算后：removeAfterActivation=true 的罐体移除并统一补料
    const removedJars = [];
    for (const plan of plans) {
      const runtime = plan.runtime;
      if (runtime.completed && runtime.removeAfterActivation && this._removeJar(engine, runtime)) {
        removedJars.push(runtime.id);
      }
    }
    if (removedJars.length > 0) {
      Gravity.applyGravity(engine.grid, engine.prng, engine.colors, engine.portalSystem || null);
      engine.emit('gravityApplied', {});
    }

    engine.emit('jarResolution', {
      mode: 'dual',
      jarIds: plans.map(plan => plan.runtime.id),
      resonance: resonanceCells.length > 0,
      resonanceCells: resonanceCells.map(cell => ({ ...cell }))
    });
  }

  /** 从棋盘移除指定罐体实体（不改变目标进度/激活计数） */
  _removeJar(engine, runtime) {
    const pos = this.findJarPos(engine, runtime.id);
    if (!pos) return false;
    const cell = engine.grid.getCell(pos.row, pos.col);
    if (cell && cell.tile && cell.tile.id === runtime.id) {
      cell.tile = null;
    }
    engine.emit('jarRemoved', { jarId: runtime.id, pos: { ...pos } });
    return true;
  }

  /**
   * 计算 island 落点范围：从罐体当前格出发的四向连通区域
   * @returns {Set<string>|null} null 表示 global（不限制）
   */
  getAllowedLandingCells(engine, jarId = null) {
    const targetId = jarId ?? this._primaryId();
    const runtime = this.runtime.get(targetId);
    if (!runtime || runtime.landingScope !== 'island') return null;

    const allowed = new Set();
    const start = runtime.pos;
    if (!engine.grid.isPlayable(start.row, start.col)) {
      // 罐体所在格本身不可用时，退化为全盘
      return null;
    }
    const queue = [start];
    allowed.add(`${start.row},${start.col}`);
    while (queue.length) {
      const { row, col } = queue.shift();
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = row + dr;
        const nc = col + dc;
        if (!engine.grid.isValid(nr, nc) || !engine.grid.isPlayable(nr, nc)) continue;
        const cell = engine.grid.getCell(nr, nc);
        if (cell.obstacle && cell.obstacle.blocksMovement) continue;
        const key = `${nr},${nc}`;
        if (allowed.has(key)) continue;
        allowed.add(key);
        queue.push({ row: nr, col: nc });
      }
    }
    return allowed;
  }

  async _activateJar(engine, runtime) {
    if (!this.syncJarPos(engine, runtime.id)) {
      console.warn(`[JamJarSystem] 找不到罐体 ${runtime.id}，取消空降`);
      runtime.state = JamJarState.IDLE;
      return;
    }
    if (runtime.leapOnActivate) {
      runtime.state = JamJarState.LEAP_AND_DROP;

      const allowedCells = this.getAllowedLandingCells(engine, runtime.id);
      const targetPos = JamJarConfig.findBestLandingCell(engine.grid, runtime.pos, {
        preferredPos: runtime.preferredLandingPos,
        allowedCells
      });

      if (!targetPos) {
        console.warn(`[JamJarSystem] 罐体 ${runtime.id} 无合法落点，取消空降`);
        runtime.state = JamJarState.IDLE;
        return;
      }

      // 1. 腾跃
      engine.emit('jarLeap', { jarId: runtime.id, from: { ...runtime.pos }, to: { ...targetPos } });
      if (engine.config.stepDelay > 0) {
        await engine.sleep(400);
      }

      const oldCell = engine.grid.getCell(runtime.pos.row, runtime.pos.col);
      const newCell = engine.grid.getCell(targetPos.row, targetPos.col);
      const jarTile = oldCell ? oldCell.tile : null;
      if (!jarTile || jarTile.special !== 'JAM_JAR' || jarTile.id !== runtime.id || !newCell) {
        console.warn(`[JamJarSystem] 罐体 ${runtime.id} 实体校验失败，取消腾跃`);
        runtime.state = JamJarState.IDLE;
        return;
      }
      // 原格变空，由本阶段末尾的重力统一补料；新格放置罐体实体
      oldCell.tile = null;
      newCell.tile = jarTile;
      runtime.pos = { ...targetPos };
      this.syncJarPos(engine, runtime.id);
    } else {
      // 原地爆浆：罐体不移动（Lv63 双罐共鸣使用）
      const synced = this.syncJarPos(engine, runtime.id);
      if (synced) runtime.pos = { ...synced };
    }

    // 2. 爆浆
    runtime.state = JamJarState.BURST_AND_SPLASH;
    const blastCells = JamJarConfig.getBlastCells(
      runtime.pos.row,
      runtime.pos.col,
      engine.rows,
      engine.cols,
      runtime.burstShape
    );

    engine.emit('jarBurst', {
      jarId: runtime.id,
      pos: { ...runtime.pos },
      blastCells,
      burstShape: runtime.burstShape
    });
    if (engine.config.stepDelay > 0) {
      await engine.sleep(350);
    }

    let clearedInBurst = 0;
    for (const cellPos of blastCells) {
      const cell = engine.grid.getCell(cellPos.row, cellPos.col);
      if (!cell) continue;

      // 爆浆覆盖格同样清除果冻底衬（HP=1，扣完推进 CLEAR_JELLY 目标）
      if (cell.underlay && cell.underlay.hp > 0) {
        cell.underlay.hp -= 1;
        if (cell.underlay.hp <= 0) {
          cell.underlay = null;
          engine.updateTargetProgress('CLEAR_JELLY', 1);
        }
      }

      if (cellPos.row === runtime.pos.row && cellPos.col === runtime.pos.col) continue;
      if (cell.tile && cell.tile.special !== 'JAM_JAR') {
        cell.tile = null;
        clearedInBurst++;
      }
    }
    engine.score += clearedInBurst * 30;

    // 3. 重力补料：同时补齐被打掉的格子与罐体腾跃后留下的原格
    Gravity.applyGravity(engine.grid, engine.prng, engine.colors, engine.portalSystem || null);
    const syncedAfterGravity = this.syncJarPos(engine, runtime.id);
    engine.emit('gravityApplied', {});
    if (engine.config.stepDelay > 0) {
      await engine.sleep(150);
    }

    // 4. 目标结算与状态重置
    runtime.activations += 1;
    engine.updateTargetProgress(this.targetType, 1);
    engine.emit('jarActivated', {
      jarId: runtime.id,
      pos: { ...runtime.pos },
      activations: runtime.activations,
      activationsRequired: runtime.activationsRequired
    });

    runtime.charge = 0;
    runtime.state = JamJarState.IDLE;
    if (syncedAfterGravity) {
      const currentJarCell = engine.grid.getCell(syncedAfterGravity.row, syncedAfterGravity.col);
      if (currentJarCell && currentJarCell.tile && currentJarCell.tile.id === runtime.id) {
        currentJarCell.tile.charge = 0;
        currentJarCell.tile.state = JamJarState.IDLE;
      }
    }

    if (runtime.activations >= runtime.activationsRequired) {
      runtime.completed = true;
      engine.emit('jarCompleted', { jarId: runtime.id, pos: { ...runtime.pos } });
    }

    // 完成后移除罐体（Lv63）：罐体消失，由重力正常补料
    if (runtime.completed && runtime.removeAfterActivation && this._removeJar(engine, runtime)) {
      Gravity.applyGravity(engine.grid, engine.prng, engine.colors, engine.portalSystem || null);
      engine.emit('gravityApplied', {});
    }

    engine.emit('jarResolution', {
      mode: 'single',
      jarIds: [runtime.id],
      resonance: false
    });
  }
}
