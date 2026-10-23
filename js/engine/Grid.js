/**
 * Grid.js - 棋盘网格与拓扑数据结构
 * 管理棋盘的行列、镂空（VOID）、棋子（tile）、障碍物（obstacle）和底衬（underlay）。
 */

export const CellType = {
  NORMAL: 'NORMAL', // 常规可玩格
  VOID: 'VOID'      // 物理镂空格 (不可移动、不可落子、阻断重力)
};

export class Grid {
  constructor(rows = 9, cols = 9) {
    this.rows = rows;
    this.cols = cols;
    this.cells = [];
    this.tileIdCounter = 1;
    this.init();
  }

  /**
   * 初始化空网格
   */
  init() {
    this.cells = [];
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        row.push({
          row: r,
          col: c,
          type: CellType.NORMAL,
          tile: null,      // { id, color, special }
          obstacle: null,  // { type: 'HONEY', hp: 2, maxHp: 2 }
          underlay: null   // { type: 'JELLY', hp: 1 }
        });
      }
      this.cells.push(row);
    }
  }

  /**
   * 坐标边界合法性检查
   */
  isValid(r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }

  /**
   * 是否在可玩区域内 (非镂空格)
   */
  isPlayable(r, c) {
    return this.isValid(r, c) && this.cells[r][c].type !== CellType.VOID;
  }

  /**
   * 获取单元格
   */
  getCell(r, c) {
    if (!this.isValid(r, c)) return null;
    return this.cells[r][c];
  }

  /**
   * 设置镂空格 (用于 Lv64 双岛拓扑)
   */
  setVoid(r, c, isVoid = true) {
    if (this.isValid(r, c)) {
      this.cells[r][c].type = isVoid ? CellType.VOID : CellType.NORMAL;
      if (isVoid) {
        this.cells[r][c].tile = null;
        this.cells[r][c].obstacle = null;
        this.cells[r][c].underlay = null;
      }
    }
  }

  /**
   * 格子是否为裸露普通棋子格 (果酱罐合法落点核心判定)
   */
  isBareNormalTile(r, c) {
    if (!this.isPlayable(r, c)) return false;
    const cell = this.cells[r][c];
    // 必须有棋子，且不能有障碍物实体覆盖
    return cell.tile !== null && cell.obstacle === null;
  }

  /**
   * 格子是否允许玩家手动交换
   * 规则：在可玩区、有棋子、且没有阻挡型障碍物
   */
  canSwap(r, c) {
    if (!this.isPlayable(r, c)) return false;
    const cell = this.cells[r][c];
    if (!cell.tile) return false;
    if (cell.obstacle && cell.obstacle.blocksMovement) return false;
    // 核心规则：特殊实体 (如果酱罐 JAM_JAR) 为固定机制实体，不能由玩家直接拖动交换
    if (cell.tile.special === 'JAM_JAR') return false;
    return true;
  }

  /**
   * 两坐标是否四向相邻 (曼哈顿距离 == 1)
   */
  isAdjacent(posA, posB) {
    const dr = Math.abs(posA.row - posB.row);
    const dc = Math.abs(posA.col - posB.col);
    return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
  }

  /**
   * 交换两格棋子
   */
  swapTiles(posA, posB) {
    if (!this.isValid(posA.row, posA.col) || !this.isValid(posB.row, posB.col)) return false;
    const cellA = this.cells[posA.row][posA.col];
    const cellB = this.cells[posB.row][posB.col];
    const temp = cellA.tile;
    cellA.tile = cellB.tile;
    cellB.tile = temp;
    return true;
  }

  /**
   * 创建一个新棋子对象
   */
  createTile(color, special = null) {
    return {
      id: this.tileIdCounter++,
      color,
      special
    };
  }

  /**
   * 深拷贝当前网格状态 (用于算法搜索与解谜模拟)
   */
  clone() {
    const copy = new Grid(this.rows, this.cols);
    copy.tileIdCounter = this.tileIdCounter;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const src = this.cells[r][c];
        copy.cells[r][c] = {
          row: r,
          col: c,
          type: src.type,
          tile: src.tile ? { ...src.tile } : null,
          obstacle: src.obstacle ? { ...src.obstacle } : null,
          underlay: src.underlay ? { ...src.underlay } : null
        };
      }
    }
    return copy;
  }
}
