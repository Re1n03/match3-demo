/**
 * PRNG.js - 确定性伪随机数生成器 (Mulberry32 算法)
 * 用于确保同一 Seed (例如 Lv62 的 Seed #1042) 下，棋盘初始布局与落料序列完全可重复。
 */
export class PRNG {
  constructor(seed = 1042) {
    this.initialSeed = seed;
    this.seed = seed;
  }

  /**
   * 重置回初始种子
   */
  reset() {
    this.seed = this.initialSeed;
  }

  /**
   * 设置新种子
   * @param {number} seed 
   */
  setSeed(seed) {
    this.initialSeed = seed;
    this.seed = seed;
  }

  /**
   * 生成 [0, 1) 范围的伪随机浮点数
   * @returns {number}
   */
  next() {
    let t = (this.seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * 生成 [min, max] 范围内的整数 (两端闭区间)
   * @param {number} min 
   * @param {number} max 
   * @returns {number}
   */
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * 从数组中随机选取一个元素
   * @param {Array} array 
   * @returns {*}
   */
  choice(array) {
    if (!array || array.length === 0) return null;
    return array[this.nextInt(0, array.length - 1)];
  }
}
