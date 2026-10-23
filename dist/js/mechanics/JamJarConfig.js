/**
 * JamJarConfig.js - 果酱罐机制独立配置与寻路算法
 * 
 * 【重要规则声明】：
 * 1. 本模块当前默认采用【方案 A：严格十字 5 格】（中心格及上下左右相邻格）作为爆炸打击范围。
 * 2. 该规则属于【Demo 临时实现规则】，并非原 PDF 已明确规定的原始绝对规则。
 * 3. 爆炸范围通过独立枚举与纯函数实现解耦，便于后续随时切换为方案 B (完整 3x3 九宫格 9 格) 进行对比测试。
 */

export const JamJarState = {
  IDLE: 'IDLE',                       // 状态 1: 静默监听与充能 (0/3)
  ACTIVE: 'ACTIVE',                   // 状态 2: 满载待发 (3/3 Juice 蓄力)
  LEAP_AND_DROP: 'LEAP_AND_DROP',     // 状态 3: 实体空降寻路与腾跃
  BURST_AND_SPLASH: 'BURST_AND_SPLASH'// 状态 4: 着陆顿帧破障与重置
};

export const JamJarBlastScope = {
  STRICT_CROSS: 'STRICT_CROSS', // 方案 A: 严格十字 (中心 + 上下左右共 5 格) [当前临时默认]
  FULL_3X3: 'FULL_3X3'          // 方案 B: 完整 3x3 区域 (九宫格共 9 格)
};

export class JamJarConfig {
  static defaultScope = JamJarBlastScope.STRICT_CROSS;
  static maxCharge = 3;

  /**
   * 计算指定落点在给定爆炸范围方案下的所有受创波及坐标
   * @param {number} centerR 
   * @param {number} centerC 
   * @param {number} rows 
   * @param {number} cols 
   * @param {string} [scope=JamJarBlastScope.STRICT_CROSS] 
   * @returns {Array<{row: number, col: number}>}
   */
  static getBlastCells(centerR, centerC, rows, cols, scope = JamJarConfig.defaultScope) {
    const cells = [];

    if (scope === JamJarBlastScope.STRICT_CROSS) {
      // 方案 A: 严格十字 (中心 + 上下左右，曼哈顿距离 <= 1)
      const offsets = [
        { dr: 0, dc: 0 },
        { dr: -1, dc: 0 },
        { dr: 1, dc: 0 },
        { dr: 0, dc: -1 },
        { dr: 0, dc: 1 }
      ];
      for (const { dr, dc } of offsets) {
        const nr = centerR + dr;
        const nc = centerC + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          cells.push({ row: nr, col: nc });
        }
      }
    } else if (scope === JamJarBlastScope.FULL_3X3) {
      // 方案 B: 完整 3x3 九宫格 (Chebyshev 距离 <= 1)
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = centerR + dr;
          const nc = centerC + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            cells.push({ row: nr, col: nc });
          }
        }
      }
    }

    return cells;
  }

  /**
   * 按照原案第 2 页规则，寻找最优空降落点：
   * 1. 实体空降与碰撞判定：仅限裸露普通棋子格，绝不重叠障碍物或踩空 (isBareNormalTile)；
   * 2. 避让判定：绝不踩踏玩家炸弹/彩球等特殊元素；
   * 3. 落点优先级：寻找落地后周围 3x3 障碍总血量最大的格子；
   * 4. 平局策略：优先匹配意向偏好格 (若处于最优集且未被污染)，否则稳定选序。
   * 
   * @param {Grid} grid 
   * @param {{row: number, col: number}} currentJarPos 果酱罐当前所在坐标
   * @param {Object} [options={}] 可选参数，如 { preferredPos }
   * @returns {{row: number, col: number}|null} 最优落点坐标，若无合法格则返回 null
   */
  static findBestLandingCell(grid, currentJarPos, options = {}) {
    let bestCell = null;
    let maxObstacleHp = -1;
    let candidates = [];
    const allowedCells = options.allowedCells || null;

    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        // 不能落在原位置
        if (currentJarPos && r === currentJarPos.row && c === currentJarPos.col) continue;

        // island 模式：只能落在同一连通区域内
        if (allowedCells && !allowedCells.has(`${r},${c}`)) continue;

        // 仅限裸露普通棋子格 (无障碍、非镂空、有棋子)
        if (!grid.isBareNormalTile(r, c)) continue;

        const cell = grid.getCell(r, c);
        // 核心避让规则：绝不踩踏炸弹、彩球等玩家特殊元素
        if (cell.tile && cell.tile.special && cell.tile.special !== 'NORMAL') continue;

        // 计算该候选格周围 3x3 范围内的所有障碍物 HP 总和
        let sumObstacleHp = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr;
            const nc = c + dc;
            if (grid.isValid(nr, nc)) {
              const neighborCell = grid.getCell(nr, nc);
              if (neighborCell && neighborCell.obstacle && neighborCell.obstacle.hp > 0) {
                sumObstacleHp += neighborCell.obstacle.hp;
              }
            }
          }
        }

        candidates.push({ row: r, col: c, obstacleHp: sumObstacleHp });

        if (sumObstacleHp > maxObstacleHp) {
          maxObstacleHp = sumObstacleHp;
          bestCell = { row: r, col: c };
        }
      }
    }

    if (candidates.length === 0) {
      return null; // 全盘无合法裸露普通格
    }

    // 过滤出拥有最高障碍物总血量的一组最优候选格 (Top Candidates)
    const topCandidates = candidates.filter(c => c.obstacleHp === maxObstacleHp);

    // 平局决策：若关卡配置指定了意向落点 (例如 Lv62 预设安全区)，且该意向格确属最高优先级候选集，则优先选用
    if (options.preferredPos) {
      const matchPreferred = topCandidates.find(
        c => c.row === options.preferredPos.row && c.col === options.preferredPos.col
      );
      if (matchPreferred) {
        return { row: matchPreferred.row, col: matchPreferred.col };
      }
    }

    // 否则稳定选取候选集中的首选格
    return { row: topCandidates[0].row, col: topCandidates[0].col };
  }
}
