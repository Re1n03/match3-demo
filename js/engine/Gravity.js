/**
 * Gravity.js - 重力下落与补料系统
 * 处理纵向重力落料、固定实体/障碍下方空缺的斜向滑入补位、顶部补料，
 * 并预留传送门 (Portal) 的过料挂钩。
 */

export class Gravity {
  /**
   * 执行单次重力结算与顶部填充
   *
   * 补位规则：
   * 1. 常规空缺沿同列垂直下落；
   * 2. 若空缺被“固定实体/固定障碍”挡住（如果酱罐、blocksMovement 障碍），
   *    允许上方斜对角相邻列的棋子滑入补位（斜向滑入，不跨越 VOID）；
   * 3. VOID 造成的阻断不适用斜向补位，保持原有“需要传送门”的语义；
   * 4. 最终仍从列顶补料，被 VOID/固定实体阻断的列不会凭空生成棋子。
   *
   * @param {Grid} grid
   * @param {PRNG} prng 确定性伪随机数发生器
   * @param {Array<string>} availableColors 可用颜色列表
   * @param {Object} [portalSystem=null] 传送门管理模块
   * @returns {{ drops: Array<{from: Object, to: Object, tile: Object, diagonal?: boolean}>, spawns: Array<{to: Object, tile: Object}> }}
   */
  static applyGravity(grid, prng, availableColors, portalSystem = null) {
    if (portalSystem && typeof portalSystem.feedEntries === 'function') {
      return Gravity._applyGravityWithPortals(grid, prng, availableColors, portalSystem);
    }
    return Gravity._applyGravityBase(grid, prng, availableColors);
  }

  /**
   * 无传送门的常规重力路径（Lv62/Lv63 行为完全保持不变）。
   */
  static _applyGravityBase(grid, prng, availableColors) {
    const drops = [];
    const spawns = [];

    const isFixedBlocker = (cell) => !!cell && (
      (cell.tile && cell.tile.special === 'JAM_JAR') ||
      (cell.obstacle && cell.obstacle.blocksMovement)
    );

    const canReceiveTile = (r, c) => {
      if (!grid.isPlayable(r, c)) return false;
      const cell = grid.getCell(r, c);
      if (cell.obstacle && cell.obstacle.blocksMovement) return false;
      return cell.tile === null;
    };

    // 纵向下落：每个空格向上寻找可穿透的同列棋子
    const settleVertical = () => {
      let moved = false;
      for (let c = 0; c < grid.cols; c++) {
        for (let r = grid.rows - 1; r >= 0; r--) {
          if (!canReceiveTile(r, c)) continue;
          const targetCell = grid.getCell(r, c);

          let sourceRow = -1;
          for (let searchR = r - 1; searchR >= 0; searchR--) {
            const searchCell = grid.getCell(searchR, c);
            if (!grid.isPlayable(searchR, c)) break; // VOID 阻断
            if (searchCell.obstacle && searchCell.obstacle.blocksMovement) break;
            if (searchCell.tile && searchCell.tile.special === 'JAM_JAR') break;
            if (searchCell.tile !== null) {
              sourceRow = searchR;
              break;
            }
          }

          if (sourceRow !== -1) {
            const sourceCell = grid.getCell(sourceRow, c);
            targetCell.tile = sourceCell.tile;
            sourceCell.tile = null;
            drops.push({
              from: { row: sourceRow, col: c },
              to: { row: r, col: c },
              tile: targetCell.tile
            });
            moved = true;
          }
        }
      }
      return moved;
    };

    // 该空格是否被固定实体/固定障碍挡在下方（同列向上扫描，遇 VOID 则不适用斜向补位）
    const isStrandedByFixedBlocker = (r, c) => {
      for (let checkR = r - 1; checkR >= 0; checkR--) {
        const cell = grid.getCell(checkR, c);
        if (!grid.isPlayable(checkR, c)) return false; // VOID：保持原有阻断语义
        if (isFixedBlocker(cell)) return true;
        if (cell.tile !== null) return false;
      }
      return false;
    };

    // 斜向滑入：上方左/右斜对角格的棋子滑入被固定实体/障碍挡住的空格
    const settleDiagonal = () => {
      let moved = false;
      for (let r = grid.rows - 1; r >= 0; r--) {
        for (let c = 0; c < grid.cols; c++) {
          if (!canReceiveTile(r, c)) continue;
          if (!isStrandedByFixedBlocker(r, c)) continue;

          for (const dc of [-1, 1]) {
            const sourceRow = r - 1;
            const sourceCol = c + dc;
            if (!grid.isValid(sourceRow, sourceCol) || !grid.isPlayable(sourceRow, sourceCol)) continue;
            const sourceCell = grid.getCell(sourceRow, sourceCol);
            if (sourceCell.obstacle && sourceCell.obstacle.blocksMovement) continue;
            if (!sourceCell.tile || sourceCell.tile.special === 'JAM_JAR') continue;

            const targetCell = grid.getCell(r, c);
            targetCell.tile = sourceCell.tile;
            sourceCell.tile = null;
            drops.push({
              from: { row: sourceRow, col: sourceCol },
              to: { row: r, col: c },
              tile: targetCell.tile,
              diagonal: true
            });
            moved = true;
            break;
          }
        }
      }
      return moved;
    };

    // 反复执行纵向 + 斜向补位，直到稳定（斜向移动会在邻列制造新的可下落空缺）
    const maxSettleIterations = grid.rows * grid.cols * 4;
    for (let i = 0; i < maxSettleIterations; i++) {
      const verticalMoved = settleVertical();
      const diagonalMoved = settleDiagonal();
      if (!verticalMoved && !diagonalMoved) break;
    }

    // 顶部补料 (Spawns)：按列顺序、自底向上
    for (let c = 0; c < grid.cols; c++) {
      for (let r = grid.rows - 1; r >= 0; r--) {
        if (!grid.isPlayable(r, c)) continue;
        const emptyCell = grid.getCell(r, c);
        if (emptyCell.obstacle && emptyCell.obstacle.blocksMovement) continue;
        if (emptyCell.tile !== null) continue;

        // 检查该空位上方是否被阻挡或镂空阻断 (若阻断则由传送门处理，否则从列顶生成)
        let isBlockedAbove = false;
        for (let checkR = r - 1; checkR >= 0; checkR--) {
          const checkCell = grid.getCell(checkR, c);
          if (!grid.isPlayable(checkR, c)
            || (checkCell.obstacle && checkCell.obstacle.blocksMovement)
            || (checkCell.tile && checkCell.tile.special === 'JAM_JAR')) {
            isBlockedAbove = true;
            break;
          }
        }

        if (!isBlockedAbove) {
          const newColor = prng.choice(availableColors);
          const newTile = grid.createTile(newColor);
          emptyCell.tile = newTile;
          spawns.push({ to: { row: r, col: c }, tile: newTile });
        }
      }
    }

    return { drops, spawns };
  }

  /**
   * 传送门重力路径（Lv64 专用）：
   * - 纵向/斜向落稳后，从出口列最下方普通棋子向空入口送料；
   * - 送料后再次落稳；
   * - 左岛顶部照常随机补料；右岛全部禁止随机补料（入口/出口配置决定）。
   * 该路径与无传送门路径隔离，保证 Lv62/Lv63 行为不变。
   */
  static _applyGravityWithPortals(grid, prng, availableColors, portalSystem) {
    const drops = [];
    const spawns = [];
    const portals = [];

    const isFixedBlocker = (cell) => !!cell && (
      (cell.tile && cell.tile.special === 'JAM_JAR') ||
      (cell.obstacle && cell.obstacle.blocksMovement)
    );

    const canReceiveTile = (r, c) => {
      if (!grid.isPlayable(r, c)) return false;
      const cell = grid.getCell(r, c);
      if (cell.obstacle && cell.obstacle.blocksMovement) return false;
      return cell.tile === null;
    };

    const settleVertical = () => {
      let moved = false;
      for (let c = 0; c < grid.cols; c++) {
        for (let r = grid.rows - 1; r >= 0; r--) {
          if (!canReceiveTile(r, c)) continue;
          const targetCell = grid.getCell(r, c);
          let sourceRow = -1;
          for (let searchR = r - 1; searchR >= 0; searchR--) {
            const searchCell = grid.getCell(searchR, c);
            if (!grid.isPlayable(searchR, c)) break;
            if (searchCell.obstacle && searchCell.obstacle.blocksMovement) break;
            if (searchCell.tile && searchCell.tile.special === 'JAM_JAR') break;
            if (searchCell.tile !== null) {
              sourceRow = searchR;
              break;
            }
          }
          if (sourceRow !== -1) {
            const sourceCell = grid.getCell(sourceRow, c);
            targetCell.tile = sourceCell.tile;
            sourceCell.tile = null;
            drops.push({
              from: { row: sourceRow, col: c },
              to: { row: r, col: c },
              tile: targetCell.tile
            });
            moved = true;
          }
        }
      }
      return moved;
    };

    const isStrandedByFixedBlocker = (r, c) => {
      for (let checkR = r - 1; checkR >= 0; checkR--) {
        const cell = grid.getCell(checkR, c);
        if (!grid.isPlayable(checkR, c)) return false;
        if (isFixedBlocker(cell)) return true;
        if (cell.tile !== null) return false;
      }
      return false;
    };

    const settleDiagonal = () => {
      let moved = false;
      for (let r = grid.rows - 1; r >= 0; r--) {
        for (let c = 0; c < grid.cols; c++) {
          if (!canReceiveTile(r, c)) continue;
          if (!isStrandedByFixedBlocker(r, c)) continue;
          for (const dc of [-1, 1]) {
            const sourceRow = r - 1;
            const sourceCol = c + dc;
            if (!grid.isValid(sourceRow, sourceCol) || !grid.isPlayable(sourceRow, sourceCol)) continue;
            const sourceCell = grid.getCell(sourceRow, sourceCol);
            if (sourceCell.obstacle && sourceCell.obstacle.blocksMovement) continue;
            if (!sourceCell.tile || sourceCell.tile.special === 'JAM_JAR') continue;
            const targetCell = grid.getCell(r, c);
            targetCell.tile = sourceCell.tile;
            sourceCell.tile = null;
            drops.push({
              from: { row: sourceRow, col: sourceCol },
              to: { row: r, col: c },
              tile: targetCell.tile,
              diagonal: true
            });
            moved = true;
            break;
          }
        }
      }
      return moved;
    };

    /**
     * 右岛无垂直供料空格的斜向补位（Lv64 规则 b）：
     * - 仅处理“禁止随机补料”的右岛格（入口列由传送门接料，不在此列）；
     * - 目标格同列上方没有任何可下落棋子（即没有垂直供料）；
     * - 从上一行左右斜邻的右岛格滑入，保持不跨 VOID / 不跨岛。
     */
    const settleDiagonalRightIsland = () => {
      let moved = false;
      for (let r = grid.rows - 1; r >= 1; r--) {
        for (let c = 0; c < grid.cols; c++) {
          if (!canReceiveTile(r, c)) continue;
          if (portalSystem.isRandomSpawnAllowed(r, c)) continue; // 仅右岛禁止随机格

          // 同列上方若有棋子，垂直重力应已补齐，不触发本规则
          let hasVerticalSupply = false;
          for (let checkR = r - 1; checkR >= 0; checkR--) {
            if (!grid.isPlayable(checkR, c)) break;
            const cell = grid.getCell(checkR, c);
            if (cell.obstacle && cell.obstacle.blocksMovement) break;
            if (cell.tile !== null) {
              hasVerticalSupply = true;
              break;
            }
          }
          if (hasVerticalSupply) continue;

          for (const dc of [-1, 1]) {
            const sourceRow = r - 1;
            const sourceCol = c + dc;
            if (!grid.isValid(sourceRow, sourceCol) || !grid.isPlayable(sourceRow, sourceCol)) continue;
            if (portalSystem.isRandomSpawnAllowed(sourceRow, sourceCol)) continue; // 源也必须是右岛
            const sourceCell = grid.getCell(sourceRow, sourceCol);
            if (sourceCell.obstacle && sourceCell.obstacle.blocksMovement) continue;
            if (!sourceCell.tile || sourceCell.tile.special === 'JAM_JAR') continue;
            const targetCell = grid.getCell(r, c);
            targetCell.tile = sourceCell.tile;
            sourceCell.tile = null;
            drops.push({
              from: { row: sourceRow, col: sourceCol },
              to: { row: r, col: c },
              tile: targetCell.tile,
              diagonal: true,
              rightIslandDiagonal: true
            });
            moved = true;
            break;
          }
        }
      }
      return moved;
    };

    const spawnTopRuns = () => {
      let spawned = false;
      for (let c = 0; c < grid.cols; c++) {
        // 找到该列从顶部向下连续的“可随机补料”空位
        let runEnd = -1;
        for (let r = 0; r < grid.rows; r++) {
          if (!grid.isPlayable(r, c)) break;
          const cell = grid.getCell(r, c);
          if (cell.obstacle && cell.obstacle.blocksMovement) break;
          if (cell.tile !== null) break;
          if (typeof portalSystem.isRandomSpawnAllowed === 'function' &&
            !portalSystem.isRandomSpawnAllowed(r, c)) break; // 右岛：入口/禁止随机
          runEnd = r;
        }
        if (runEnd < 0) continue;
        // 与原路径一致：自下而上生成，保持同一 PRNG 顺序
        for (let r = runEnd; r >= 0; r--) {
          const cell = grid.getCell(r, c);
          const newTile = grid.createTile(prng.choice(availableColors));
          cell.tile = newTile;
          spawns.push({ to: { row: r, col: c }, tile: newTile });
        }
        spawned = true;
      }
      return spawned;
    };

    const maxIterations = grid.rows * grid.cols * 6;
    for (let i = 0; i < maxIterations; i++) {
      let changed = settleVertical();
      changed = settleDiagonal() || changed;

      const transfers = portalSystem.feedEntries(grid);
      if (transfers.length > 0) {
        portals.push(...transfers);
        changed = true;
      }

      // 修复 b：右岛第 7 列等无垂直供料空格，从斜邻右岛格滑入补位
      changed = settleDiagonalRightIsland() || changed;
      if (changed) continue;

      // 落稳且入口补料完成后，才从顶部随机补料
      if (!spawnTopRuns()) break;
    }

    return { drops, spawns, portals };
  }
}
