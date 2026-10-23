/**
 * MatchFinder.js - 三消模式识别与全盘解穷举搜索器
 * 提供标准的横向/纵向 3消、4消、5消识别，以及用于死局检测与首步唯一性验证的全局搜索算法。
 */

export class MatchFinder {
  /**
   * 扫描当前网格中的所有三消及以上匹配
   * @param {Grid} grid 
   * @returns {{ matchedCells: Set<string>, matches: Array<{type: string, color: string, cells: Array<{row: number, col: number}>}> }}
   */
  static findMatches(grid) {
    const matchedCells = new Set();
    const matches = [];

    // 1. 横向扫描 (Horizontal)
    for (let r = 0; r < grid.rows; r++) {
      let matchLength = 1;
      for (let c = 0; c < grid.cols; c++) {
        const currentCell = grid.getCell(r, c);
        const currentTile = currentCell && grid.isPlayable(r, c) ? currentCell.tile : null;
        
        let hasNextMatch = false;
        if (c < grid.cols - 1 && currentTile && currentTile.color) {
          const nextCell = grid.getCell(r, c + 1);
          const nextTile = nextCell && grid.isPlayable(r, c + 1) ? nextCell.tile : null;
          if (nextTile && nextTile.color === currentTile.color) {
            hasNextMatch = true;
          }
        }

        if (hasNextMatch) {
          matchLength++;
        } else {
          if (matchLength >= 3 && currentTile && currentTile.color) {
            const cells = [];
            for (let k = 0; k < matchLength; k++) {
              const matchedC = c - k;
              matchedCells.add(`${r},${matchedC}`);
              cells.unshift({ row: r, col: matchedC });
            }
            matches.push({
              type: 'HORIZONTAL',
              color: currentTile.color,
              cells
            });
          }
          matchLength = 1;
        }
      }
    }

    // 2. 纵向扫描 (Vertical)
    for (let c = 0; c < grid.cols; c++) {
      let matchLength = 1;
      for (let r = 0; r < grid.rows; r++) {
        const currentCell = grid.getCell(r, c);
        const currentTile = currentCell && grid.isPlayable(r, c) ? currentCell.tile : null;

        let hasNextMatch = false;
        if (r < grid.rows - 1 && currentTile && currentTile.color) {
          const nextCell = grid.getCell(r + 1, c);
          const nextTile = nextCell && grid.isPlayable(r + 1, c) ? nextCell.tile : null;
          if (nextTile && nextTile.color === currentTile.color) {
            hasNextMatch = true;
          }
        }

        if (hasNextMatch) {
          matchLength++;
        } else {
          if (matchLength >= 3 && currentTile && currentTile.color) {
            const cells = [];
            for (let k = 0; k < matchLength; k++) {
              const matchedR = r - k;
              matchedCells.add(`${matchedR},${c}`);
              cells.unshift({ row: matchedR, col: c });
            }
            matches.push({
              type: 'VERTICAL',
              color: currentTile.color,
              cells
            });
          }
          matchLength = 1;
        }
      }
    }

    return { matchedCells, matches };
  }

  /**
   * 穷举搜索全盘所有合法的相邻交换解
   * 用于：
   * 1. 验证 Lv62 是否仅存在唯一步有效解；
   * 2. 运行时死局检测 (Shuffle 判定)；
   * 3. 算法求解器生成行动树。
   * @param {Grid} grid 
   * @returns {Array<{posA: {row: number, col: number}, posB: {row: number, col: number}, matchResult: Object}>}
   */
  static findPossibleMoves(grid) {
    const validMoves = [];

    // 遍历每一个可交换的格子，向右和向下探测相邻交换
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (!grid.canSwap(r, c)) continue;
        const posA = { row: r, col: c };

        // 1. 尝试向右交换 (r, c) <-> (r, c + 1)
        if (c + 1 < grid.cols && grid.canSwap(r, c + 1)) {
          const posB = { row: r, col: c + 1 };
          grid.swapTiles(posA, posB);
          const matchResult = MatchFinder.findMatches(grid);
          if (matchResult.matches.length > 0) {
            validMoves.push({ posA, posB, matchResult });
          }
          grid.swapTiles(posA, posB); // 还原交换
        }

        // 2. 尝试向下交换 (r, c) <-> (r + 1, c)
        if (r + 1 < grid.rows && grid.canSwap(r + 1, c)) {
          const posB = { row: r + 1, col: c };
          grid.swapTiles(posA, posB);
          const matchResult = MatchFinder.findMatches(grid);
          if (matchResult.matches.length > 0) {
            validMoves.push({ posA, posB, matchResult });
          }
          grid.swapTiles(posA, posB); // 还原交换
        }
      }
    }

    return validMoves;
  }
}
