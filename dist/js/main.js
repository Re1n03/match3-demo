/**
 * main.js - Demo 运行时主调度器 (支持引擎基准与 Lv62 机制引入关切换)
 */

import { Match3Engine } from './engine/Match3Engine.js';
import { MatchFinder } from './engine/MatchFinder.js';
import { BoardRenderer } from './ui/BoardRenderer.js';
import { AudioManager } from './ui/AudioManager.js';
import { Level62Config } from './levels/level62.js';
import { Level63Config } from './levels/level63.js';
import { Level64Config } from './levels/level64.js';

document.addEventListener('DOMContentLoaded', () => {
  const audioManager = new AudioManager();

  // 基础引擎配置 (阶段 1 基准)
  const baseConfig = {
    rows: 9,
    cols: 9,
    colors: ['red', 'blue', 'green', 'yellow'],
    maxMoves: 20,
    seed: 1042,
    targets: [
      { id: 'target_red', type: 'COLLECT_RED', count: 15, current: 0, label: '红心 ❤️' }
    ],
    stepDelay: 120
  };

  let currentConfig = Level62Config; // 默认直接进入 Lv62 机制引入关
  let engine = new Match3Engine(currentConfig);

  const boardGridEl = document.getElementById('board-grid');
  let renderer = new BoardRenderer(boardGridEl, engine, audioManager);
  renderer.buildBoard();

  // 首次进入试玩说明：仅首次显示，可关闭；e2e/截图可通过 hook 关闭
  const introOverlay = document.getElementById('intro-overlay');
  const introDismiss = document.getElementById('intro-dismiss');
  const INTRO_KEY = 'm3_intro_seen_v1';
  const dismissIntro = () => {
    if (!introOverlay) return;
    introOverlay.classList.add('hidden');
    try { localStorage.setItem(INTRO_KEY, '1'); } catch (e) { /* 隐私模式忽略 */ }
  };
  if (introOverlay) {
    let introSeen = false;
    try { introSeen = localStorage.getItem(INTRO_KEY) === '1'; } catch (e) { introSeen = false; }
    if (!introSeen) introOverlay.classList.remove('hidden');
    if (introDismiss) introDismiss.addEventListener('click', dismissIntro);
  }

  const movesEl = document.getElementById('hud-moves');
  const targetEl = document.getElementById('hud-targets');
  const targetLabelEl = document.getElementById('hud-target-label');
  const scoreEl = document.getElementById('hud-score');
  const specBannerEl = document.getElementById('spec-banner');

  const updateHUD = () => {
    movesEl.innerText = engine.movesRemaining;
    scoreEl.innerText = engine.score;
    const targets = engine.activeTargets || [];
    if (targets.length === 0) {
      targetEl.innerText = '--';
      if (targetLabelEl) targetLabelEl.innerText = '';
      return;
    }
    if (targets.length === 1) {
      // 单目标保持原格式，下方补目标名，避免 HUD 只有数字没有语义
      const target = targets[0];
      targetEl.innerText = `${target.current} / ${target.count}`;
      if (targetLabelEl) targetLabelEl.innerText = target.label || '';
      return;
    }
    // 多目标：显示“目标名 当前/总数”，用分隔符并排展示
    targetEl.innerText = targets
      .map(t => `${t.label ? t.label + ' ' : ''}${t.current}/${t.count}`)
      .join(' · ');
    if (targetLabelEl) targetLabelEl.innerText = '';
  };

  const bindEngineEvents = () => {
    engine.on('movesChanged', updateHUD);
    engine.on('targetsUpdated', updateHUD);
    engine.on('tilesCleared', updateHUD);
  };

  bindEngineEvents();
  updateHUD();

  // 根据当前关卡刷新顶部设计意图横幅（首次加载与切换关卡共用）
  const updateBanner = (config) => {
    if (config.levelNumber === 62) {
      specBannerEl.innerHTML = `
        <div class="spec-text">
          <strong>Lv62 机制引入关（原案确定性引导）</strong><br>
          目标：激活果酱罐 × 1 | 步数：22步 | 种子：Seed #1042<br>
          <span style="color:#f59e0b;">💡 唯一首步指引：点击交换 (3,1) 与 (3,2) 消除红心，罐体充能并腾跃至安全落点！</span>
        </div>
        <span class="tag">Lv62 已激活</span>
      `;
    } else if (config.levelNumber === 63) {
      specBannerEl.innerHTML = `
        <div class="spec-text">
          <strong>Lv63 情绪释放关（双罐共鸣）</strong><br>
          目标：激活罐子 × 2 | 清除果冻 × 16 | 步数：24步 | 4色<br>
          <span style="color:#f59e0b;">💡 双罐原地爆浆：两罐同时激活时，爆浆范围重叠格受到 2 倍伤害并闪光。</span>
        </div>
        <span class="tag">Lv63 已激活</span>
      `;
    } else if (config.levelNumber === 64) {
      specBannerEl.innerHTML = `
        <div class="spec-text">
          <strong>Lv64 卡点关（物理镂空双岛 · 传送门）</strong><br>
          目标：消除蜂蜜 × 4 | 激活罐子 × 2 | 步数：19步 | 5色<br>
          <span style="color:#f59e0b;">💡 罐子限左岛；右岛顶部入口从左岛底部出口取料，蜂蜜需由相邻消除击破。</span>
        </div>
        <span class="tag">Lv64 已激活</span>
      `;
    } else {
      specBannerEl.innerHTML = `
        <div class="spec-text">
          <strong>第一阶段通用核心引擎基准</strong><br>
          测试基础三消规则、无匹配回弹保护与重力下落。
        </div>
        <span class="tag">基准测试</span>
      `;
    }
  };

  const loadLevel = (config, levelTag) => {
    engine.removeAllListeners();
    currentConfig = config;
    engine = new Match3Engine(config);
    renderer = new BoardRenderer(boardGridEl, engine, audioManager);
    renderer.buildBoard();
    // 显式同步输入锁：新关卡一律从可交互状态开始。
    renderer.updateInputLockState();
    bindEngineEvents();
    updateHUD();
    document.getElementById('game-over-modal').classList.add('hidden');

    // 更新横幅
    updateBanner(config);

    // 更新导航高亮
    document.querySelectorAll('.level-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`btn-lvl-${levelTag}`);
    if (activeBtn) activeBtn.classList.add('active');
  };

  // 绑定关卡切换
  const btnLvl62 = document.getElementById('btn-lvl-62');
  if (btnLvl62) {
    btnLvl62.addEventListener('click', () => loadLevel(Level62Config, '62'));
  }

  const btnLvl63 = document.getElementById('btn-lvl-63');
  if (btnLvl63) {
    btnLvl63.addEventListener('click', () => loadLevel(Level63Config, '63'));
  }

  const btnLvl64 = document.getElementById('btn-lvl-64');
  if (btnLvl64) {
    btnLvl64.addEventListener('click', () => loadLevel(Level64Config, '64'));
  }

  const btnLvlEngine = document.getElementById('btn-lvl-engine');
  if (btnLvlEngine) {
    btnLvlEngine.addEventListener('click', () => loadLevel(baseConfig, 'engine'));
  }

  // 默认高亮 Lv62
  const activeBtn62 = document.getElementById('btn-lvl-62');
  if (activeBtn62) {
    document.querySelectorAll('.level-btn').forEach(btn => btn.classList.remove('active'));
    activeBtn62.classList.add('active');
  }

  // 首次加载即为 Lv62：同步横幅（此前只在切换关卡时更新，导致初始横幅停留在 Phase 1）
  updateBanner(currentConfig);

  // 重开与控制按钮
  const resetBtn = document.getElementById('btn-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      engine.reset();
      renderer.buildBoard();
      updateHUD();
      document.getElementById('game-over-modal').classList.add('hidden');
    });
  }

  const modalRestartBtn = document.getElementById('modal-restart-btn');
  if (modalRestartBtn) {
    modalRestartBtn.addEventListener('click', () => {
      engine.reset();
      renderer.buildBoard();
      updateHUD();
      document.getElementById('game-over-modal').classList.add('hidden');
    });
  }

  const soundBtn = document.getElementById('btn-sound');
  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      const isMuted = audioManager.toggleMute();
      soundBtn.innerText = isMuted ? '🔇 音效: 关' : '🔊 音效: 开';
      soundBtn.style.opacity = isMuted ? '0.6' : '1';
    });
  }

  // 仅在 ?e2e=1 时暴露测试句柄，供 tests/e2e.html 驱动真实 UI；正常演示不受影响。
  if (new URLSearchParams(window.location.search).has('e2e')) {
    window.__demoE2E = {
      getEngine: () => engine,
      getRenderer: () => renderer,
      getAudio: () => audioManager,
      getConfig: () => currentConfig,
      findPossibleMoves: () => MatchFinder.findPossibleMoves(engine.grid),
      dismissIntro
    };
  }
});
