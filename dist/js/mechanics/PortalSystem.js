/**
 * PortalSystem.js - 跨岛重力传送门（配置驱动）
 *
 * 规则（Lv64）：
 * - 右岛顶部入口格：当入口为空时，从配对出口列取“最下方普通棋子”，
 *   保持颜色不变移动到入口；左岛顶部照常随机补料；
 * - 右岛顶部不允许随机补料；入口取不到料则保持空；
 * - 传送完成并经过重力落稳后，引擎再判定匹配。
 *
 * 入口/出口坐标对完全由关卡配置传入，不在机制代码中写死。
 */

export class PortalSystem {
  /**
   * @param {Object} options
   * @param {Array<{exit:{row:number,col:number}, entry:{row:number,col:number}}>} options.pairs
   * @param {Array<{row:number,col:number}>} [options.noRandomSpawnCells=[]] 禁止随机补料的格子
   */
  constructor(options = {}) {
    this.pairs = (options.pairs || []).map(pair => ({
      exit: { row: pair.exit.row, col: pair.exit.col },
      entry: { row: pair.entry.row, col: pair.entry.col }
    }));
    this.noRandomSpawn = new Set(
      (options.noRandomSpawnCells || []).map(cell => `${cell.row},${cell.col}`)
    );

    // 只读诊断计数（不影响玩法逻辑）
    this.stats = { entryFeeds: {}, exitNoSupply: 0, transferCount: 0, feedCalls: 0 };
  }

  resetStats() {
    this.stats = { entryFeeds: {}, exitNoSupply: 0, transferCount: 0, feedCalls: 0 };
  }

  /** 该格是否允许随机补料 */
  isRandomSpawnAllowed(row, col) {
    return !this.noRandomSpawn.has(`${row},${col}`);
  }

  /** 按配置取出口列最下方普通棋子（跳过 VOID/固定实体） */
  _takeBottomTile(grid, exitCol) {
    for (let row = grid.rows - 1; row >= 0; row--) {
      if (!grid.isPlayable(row, exitCol)) continue;
      const cell = grid.getCell(row, exitCol);
      if (!cell || !cell.tile) continue;
      if (cell.tile.special === 'JAM_JAR') continue; // 机制实体不通过传送门
      const tile = cell.tile;
      cell.tile = null;
      return { from: { row, col: exitCol }, tile };
    }
    return null;
  }

  /**
   * 从出口向空入口送料。
   * @returns {Array<{from:Object,to:Object,tile:Object,fromPortal:true}>}
   */
  feedEntries(grid) {
    const transfers = [];
    this.stats.feedCalls += 1;
    for (const pair of this.pairs) {
      const entryCell = grid.getCell(pair.entry.row, pair.entry.col);
      if (!entryCell || !grid.isPlayable(pair.entry.row, pair.entry.col)) continue;
      if (entryCell.obstacle && entryCell.obstacle.blocksMovement) continue;
      if (entryCell.tile !== null) continue; // 入口已有棋子，等待下次空位

      const taken = this._takeBottomTile(grid, pair.exit.col);
      if (!taken) {
        this.stats.exitNoSupply += 1; // 入口为空且出口列无普通棋子
        continue;
      }
      entryCell.tile = taken.tile;
      const entryKey = `${pair.entry.row},${pair.entry.col}`;
      this.stats.entryFeeds[entryKey] = (this.stats.entryFeeds[entryKey] || 0) + 1;
      this.stats.transferCount += 1;
      transfers.push({
        from: taken.from,
        to: { row: pair.entry.row, col: pair.entry.col },
        tile: taken.tile,
        fromPortal: true
      });
    }
    return transfers;
  }
}
