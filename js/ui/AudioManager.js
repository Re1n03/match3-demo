/**
 * AudioManager.js - 浏览器原生 Web Audio API 实时合成音频系统
 * 
 * 设计规范与鲁棒性保证：
 * 1. 零外部依赖：100% 纯代码程序化合成，无需下载任何 mp3/wav 文件；
 * 2. 故障隔离：所有音频调用均包裹在 try-catch 中，音频被禁用或报错绝不中断游戏逻辑；
 * 3. 手势解锁：安全响应现代浏览器对 AudioContext 的自动播放限制；
 * 4. 连续升调：连消触发半音阶梯升调，配合柔和的正弦波与高频平滑，避免爆音与刺耳感；
 * 5. 全局静音控制：支持随时开关音效。
 */

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.isUnlocked = false;

    // 基础音高频率 (C4 = 261.63Hz)
    this.basePitch = 261.63;
    // 连续升调音阶半音步进系数
    this.semitoneRatio = 1.059463; // 2^(1/12)

    this.bindUnlockListener();
  }

  /**
   * 监听玩家首次手势操作以解锁 AudioContext
   */
  bindUnlockListener() {
    const unlockHandler = () => {
      this.ensureContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          this.isUnlocked = true;
        }).catch(() => {});
      } else if (this.ctx && this.ctx.state === 'running') {
        this.isUnlocked = true;
      }
      // 解锁后移除全局监听
      window.removeEventListener('pointerdown', unlockHandler);
      window.removeEventListener('touchstart', unlockHandler);
      window.removeEventListener('keydown', unlockHandler);
    };

    window.addEventListener('pointerdown', unlockHandler, { once: true });
    // iOS Safari 首次触摸必须显式解锁 AudioContext
    window.addEventListener('touchstart', unlockHandler, { once: true, passive: true });
    window.addEventListener('keydown', unlockHandler, { once: true });
  }

  /**
   * 延迟安全初始化 AudioContext
   */
  ensureContext() {
    if (!this.ctx) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      } catch (e) {
        console.warn('[AudioManager] Web Audio API is not supported or restricted:', e);
      }
    }
  }

  /**
   * 切换静音状态
   * @returns {boolean} 当前是否静音
   */
  toggleMute() {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }

  /**
   * 播放连消阶梯升调音效 (Juice 爽感核心)
   * @param {number} cascadeIndex 当前连击次数 (1, 2, 3...)
   */
  playCascadeMatch(cascadeIndex = 1) {
    if (this.isMuted) return;

    try {
      this.ensureContext();
      if (!this.ctx || this.ctx.state !== 'running') return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      // 计算升调频率：每提升 1 阶连消，上升 2 个半音 (全音阶递进)
      // 上限钳位在 880Hz (A5)，防止刺耳
      const semitoneSteps = Math.min((cascadeIndex - 1) * 2, 16);
      const targetFreq = this.basePitch * Math.pow(this.semitoneRatio, semitoneSteps);

      osc.type = 'sine'; // 柔和纯净的正弦波
      osc.frequency.setValueAtTime(targetFreq, now);

      // 音量包络：微弱起音 (0.01s) -> 指数衰减 (0.12s)
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.15);
    } catch (e) {
      // 静默降级，绝不影响业务逻辑
    }
  }

  /**
   * 播放无效交换回弹音效 (低音双击短鸣)
   */
  playSwapRollback() {
    if (this.isMuted) return;

    try {
      this.ensureContext();
      if (!this.ctx || this.ctx.state !== 'running') return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.linearRampToValueAtTime(110, now + 0.08);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.11);
    } catch (e) {}
  }

  /**
   * 播放棋子点击/选中音效 (轻快微鸣)
   */
  playTileSelect() {
    if (this.isMuted) return;

    try {
      this.ensureContext();
      if (!this.ctx || this.ctx.state !== 'running') return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.05);
    } catch (e) {}
  }

  /**
   * 播放果酱罐腾跃空投音效 (柔和弧线滑音 Whoosh)
   */
  playJarLeap() {
    if (this.isMuted) return;
    try {
      this.ensureContext();
      if (!this.ctx || this.ctx.state !== 'running') return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      // 抛物线频率滑音: 280Hz -> 580Hz -> 350Hz
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(580, now + 0.18);
      osc.frequency.exponentialRampToValueAtTime(350, now + 0.35);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.4);
    } catch (e) {}
  }

  /**
   * 播放果酱罐十字爆破音效 (低音冲击 + 爆浆清场)
   */
  playJarBurst() {
    if (this.isMuted) return;
    try {
      this.ensureContext();
      if (!this.ctx || this.ctx.state !== 'running') return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(50, now + 0.22);

      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.26);
    } catch (e) {}
  }

  /**
   * 播放通关胜利大和弦音效
   */
  playVictory() {
    if (this.isMuted) return;

    try {
      this.ensureContext();
      if (!this.ctx || this.ctx.state !== 'running') return;

      const chord = [261.63, 329.63, 392.00, 523.25]; // C大调琶音 (C4, E4, G4, C5)
      chord.forEach((freq, idx) => {
        const now = this.ctx.currentTime + idx * 0.08;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.45);
      });
    } catch (e) {}
  }

  /**
   * 播放步数耗尽失败提示音
   */
  playDefeat() {
    if (this.isMuted) return;

    try {
      this.ensureContext();
      if (!this.ctx || this.ctx.state !== 'running') return;

      const notes = [330, 311, 293, 277]; // 下行沉降音
      notes.forEach((freq, idx) => {
        const now = this.ctx.currentTime + idx * 0.12;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.22);
      });
    } catch (e) {}
  }
}
