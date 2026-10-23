/**
 * BoardRenderer.js - 棋盘 DOM 渲染与交互控制器
 * 
 * 核心功能：
 * 1. 响应式 CSS Grid 棋盘构建；
 * 2. 玩家点击选子、高亮与相邻交换交互；
 * 3. 交换回弹、消除动效与连消 Juice 视觉呈现；
 * 4. 动画期间全局输入锁（防止快速连击导致异步状态错乱）；
 * 5. HUD 步数、目标进度、胜利与失败弹窗交互。
 */

export class BoardRenderer {
  constructor(containerElement, engine, audioManager) {
    this.container = containerElement;
    this.engine = engine;
    this.audio = audioManager;
    this.selectedCell = null;
    this.isInputLocked = false;
    this.isHitStopped = false;
    this.hitStopTimer = null;

    // 颜色与视觉符号映射 (为求职作品集呈现高级而友好的设计质感)
    this.colorMap = {
      red: { label: '红心', symbol: '❤️', class: 'tile-red' },
      blue: { label: '水滴', symbol: '💧', class: 'tile-blue' },
      green: { label: '叶片', symbol: '🍃', class: 'tile-green' },
      yellow: { label: '星芒', symbol: '⭐', class: 'tile-yellow' },
      purple: { label: '晶体', symbol: '🔮', class: 'tile-purple' }
    };

    this.bindEngineEvents();

    // 关键修复：构造时主动同步一次输入锁，避免上一个渲染实例/上一个关卡
    // 留在容器上的 input-locked 类导致新棋盘无法点击。
    this.updateInputLockState();
  }

  /**
   * 绑定引擎事件
   */
  bindEngineEvents() {
    this.engine.on('stateChange', ({ newState }) => {
      this.isInputLocked = (newState !== 'IDLE');
      this.updateInputLockState();
    });

    this.engine.on('swapRollback', ({ posA, posB }) => {
      this.playRollbackAnim(posA, posB);
      this.audio.playSwapRollback();
    });

    this.engine.on('tilesCleared', ({ cascadeIndex, matches }) => {
      this.audio.playCascadeMatch(cascadeIndex);
      this.highlightMatches(matches);
    });

    this.engine.on('gravityApplied', () => {
      this.render();
    });

    this.engine.on('jarCharged', () => {
      this.render();
    });

    this.engine.on('jarActive', () => {
      this.render();
    });

    this.engine.on('jarLeap', ({ jarId, from, to }) => {
      this.audio.playJarLeap();
      this.playJarLeapAnim(from, to, jarId);
    });

    this.engine.on('jarBurst', ({ pos, blastCells }) => {
      this.audio.playJarBurst();
      this.playJarBurstAnim(pos, blastCells);
    });

    // 双罐共鸣：重叠格 2 倍伤害的闪光反馈
    this.engine.on('jarResonance', ({ cells }) => {
      this.playResonanceFlash(cells);
    });

    // 死局洗牌后立即重绘棋盘
    this.engine.on('boardShuffled', () => {
      this.render();
    });

    this.engine.on('victory', () => {
      // 关键修复：腾跃爆破全部演毕后延迟 550ms 优雅呈现结算弹窗，杜绝提前遮蔽棋盘
      setTimeout(() => {
        this.audio.playVictory();
        this.showGameOverModal(true);
      }, 550);
    });

    this.engine.on('defeat', () => {
      this.audio.playDefeat();
      this.showGameOverModal(false);
    });
  }

  /**
   * 根据当前网格完整构建 DOM 棋盘
   */
  buildBoard() {
    this.container.innerHTML = '';
    const grid = this.engine.grid;

    this.container.style.display = 'grid';
    this.container.style.gridTemplateRows = `repeat(${grid.rows}, 1fr)`;
    this.container.style.gridTemplateColumns = `repeat(${grid.cols}, 1fr)`;
    // 将棋盘尺寸暴露到 DOM，测试脚本从关卡渲染结果读取，避免硬编码 81/9x9
    this.container.dataset.rows = String(grid.rows);
    this.container.dataset.cols = String(grid.cols);

    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cellData = grid.getCell(r, c);
        const cellEl = document.createElement('div');
        cellEl.className = 'board-cell';
        cellEl.dataset.row = r;
        cellEl.dataset.col = c;

        if (cellData.type === 'VOID') {
          cellEl.classList.add('cell-void');
        } else {
          // 渲染底层果冻 (如果有)
          if (cellData.underlay) {
            const underlayEl = document.createElement('div');
            underlayEl.className = `underlay underlay-${cellData.underlay.type.toLowerCase()}`;
            cellEl.appendChild(underlayEl);
          }

          // 渲染棋子 (如果有)
          if (cellData.tile) {
            const tileEl = this.createTileElement(cellData.tile);
            cellEl.appendChild(tileEl);
          }

          // 渲染实体障碍物 (例如蜂蜜)
          if (cellData.obstacle) {
            const obsEl = document.createElement('div');
            obsEl.className = `obstacle obstacle-${cellData.obstacle.type.toLowerCase()}`;
            obsEl.dataset.hp = String(cellData.obstacle.hp);
            obsEl.innerText = `HP:${cellData.obstacle.hp}`;
            cellEl.appendChild(obsEl);
          }

          this.decorateCell(cellEl, r, c);

          // 绑定点击事件
          cellEl.addEventListener('click', () => this.handleCellClick(r, c));
        }

        this.container.appendChild(cellEl);
      }
    }

    // 每次重建棋盘后同步输入锁状态，确保重置/加载关卡后立即可交互。
    this.updateInputLockState();
  }

  /**
   * 传送门/岛屿/蜂蜜等关卡语义装饰（每次 build/render 都重新挂载）
   */
  decorateCell(cellEl, r, c) {
    const config = this.engine.config || {};
    const voidCols = Array.isArray(config.voidColumns) ? config.voidColumns : [];
    if (voidCols.length > 0 && c !== undefined) {
      const firstVoid = Math.min(...voidCols);
      const lastVoid = Math.max(...voidCols);
      if (c < firstVoid) {
        cellEl.classList.add('cell-island-left');
        cellEl.dataset.island = 'left';
      } else if (c > lastVoid) {
        cellEl.classList.add('cell-island-right');
        cellEl.dataset.island = 'right';
      }
    }

    const pairs = Array.isArray(config.portalPairs) ? config.portalPairs : [];
    pairs.forEach((pair, index) => {
      const pairNo = index + 1;
      if (pair.entry.row === r && pair.entry.col === c) {
        cellEl.classList.add('cell-portal-entry', `portal-pair-${pairNo}`);
        cellEl.dataset.portalPair = String(pairNo);
        cellEl.appendChild(this.createPortalMarker('entry', pairNo, pair));
      } else if (pair.exit.row === r && pair.exit.col === c) {
        cellEl.classList.add('cell-portal-exit', `portal-pair-${pairNo}`);
        cellEl.dataset.portalPair = String(pairNo);
        cellEl.appendChild(this.createPortalMarker('exit', pairNo, pair));
      }
    });
  }

  createPortalMarker(kind, pairNo, pair) {
    const marker = document.createElement('span');
    marker.className = `portal-marker portal-marker-${kind}`;
    marker.textContent = kind === 'entry' ? `入${pairNo}` : `出${pairNo}`;
    marker.title = `传送门${pairNo}：出口(${pair.exit.row},${pair.exit.col}) → 入口(${pair.entry.row},${pair.entry.col})`;
    marker.setAttribute('aria-label', marker.title);
    return marker;
  }

  /**
   * 创建棋子 DOM 节点 (含果酱罐实体支持)
   */
  createTileElement(tile) {
    const el = document.createElement('div');
    el.className = 'tile';

    if (tile.special === 'JAM_JAR') {
      el.classList.add('tile-jar');
      el.innerText = '🍯';
      if (tile.state === 'ACTIVE') {
        el.classList.add('jar-active');
      }
      const badge = document.createElement('div');
      badge.className = 'jar-badge';
      badge.innerText = `${tile.charge || 0}/${tile.maxCharge || 3}`;
      el.appendChild(badge);

      const maxCharge = Math.max(1, tile.maxCharge || 3);
      const charge = Math.max(0, Math.min(maxCharge, tile.charge || 0));
      const progress = document.createElement('div');
      progress.className = 'jar-progress';
      const fill = document.createElement('span');
      fill.style.width = `${(charge / maxCharge) * 100}%`;
      progress.appendChild(fill);
      el.appendChild(progress);

      // 满载溢出气泡：仅 ACTIVE 时挂载，CSS 上浮循环
      if (tile.state === 'ACTIVE') {
        const bubbles = document.createElement('div');
        bubbles.className = 'jar-bubbles';
        for (let i = 1; i <= 3; i++) {
          const bubble = document.createElement('span');
          bubble.className = `jar-bubble jar-bubble-${i}`;
          bubbles.appendChild(bubble);
        }
        el.appendChild(bubbles);
      }
    } else {
      const conf = this.colorMap[tile.color] || { symbol: '●', class: `tile-${tile.color}` };
      el.classList.add(conf.class);
      el.innerText = conf.symbol;
    }

    el.dataset.id = tile.id;
    return el;
  }

  /**
   * 刷新棋盘视图
   */
  render() {
    const grid = this.engine.grid;
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const cellEl = this.getCellElement(r, c);
        if (!cellEl) continue;

        const cellData = grid.getCell(r, c);
        cellEl.innerHTML = '';

        if (cellData.type !== 'VOID') {
          if (cellData.underlay) {
            const underlayEl = document.createElement('div');
            underlayEl.className = `underlay underlay-${cellData.underlay.type.toLowerCase()}`;
            cellEl.appendChild(underlayEl);
          }

          if (cellData.tile) {
            const tileEl = this.createTileElement(cellData.tile);
            cellEl.appendChild(tileEl);
          }

          if (cellData.obstacle) {
            const obsEl = document.createElement('div');
            obsEl.className = `obstacle obstacle-${cellData.obstacle.type.toLowerCase()}`;
            obsEl.dataset.hp = String(cellData.obstacle.hp);
            obsEl.innerText = `HP:${cellData.obstacle.hp}`;
            cellEl.appendChild(obsEl);
          }

          this.decorateCell(cellEl, r, c);
        } else {
          this.decorateCell(cellEl, r, c);
        }
      }
    }
    this.updateSelectedVisual();
  }

  /**
   * 获取指定坐标的格子元素
   */
  getCellElement(r, c) {
    return this.container.querySelector(`.board-cell[data-row="${r}"][data-col="${c}"]`);
  }

  /**
   * 处理玩家点击
   */
  async handleCellClick(r, c) {
    if (this.isInputLocked || this.isHitStopped) return;
    if (!this.engine.grid.canSwap(r, c)) return;

    if (!this.selectedCell) {
      // 首次选中
      this.selectedCell = { row: r, col: c };
      this.updateSelectedVisual();
      this.audio.playTileSelect();
    } else {
      // 点击了同一个格子，取消选中
      if (this.selectedCell.row === r && this.selectedCell.col === c) {
        this.selectedCell = null;
        this.updateSelectedVisual();
        return;
      }

      const posA = { ...this.selectedCell };
      const posB = { row: r, col: c };

      // 若点击的是四向相邻格，尝试交换
      if (this.engine.grid.isAdjacent(posA, posB)) {
        this.selectedCell = null;
        this.updateSelectedVisual();
        await this.engine.trySwap(posA, posB);
      } else {
        // 若点击非相邻格，改选为新格子
        this.selectedCell = { row: r, col: c };
        this.updateSelectedVisual();
        this.audio.playTileSelect();
      }
    }
  }

  /**
   * 更新选中框视觉反馈
   */
  updateSelectedVisual() {
    const allCells = this.container.querySelectorAll('.board-cell');
    allCells.forEach(el => el.classList.remove('selected'));

    if (this.selectedCell) {
      const cellEl = this.getCellElement(this.selectedCell.row, this.selectedCell.col);
      if (cellEl) {
        cellEl.classList.add('selected');
      }
    }
  }

  /**
   * 更新输入锁状态 (禁用操作)
   */
  updateInputLockState() {
    if (this.isInputLocked) {
      this.container.classList.add('input-locked');
    } else {
      this.container.classList.remove('input-locked');
    }
  }

  /**
   * 无效交换回弹动画
   */
  playRollbackAnim(posA, posB) {
    const elA = this.getCellElement(posA.row, posA.col);
    const elB = this.getCellElement(posB.row, posB.col);
    if (elA) elA.classList.add('shake-rollback');
    if (elB) elB.classList.add('shake-rollback');

    setTimeout(() => {
      if (elA) elA.classList.remove('shake-rollback');
      if (elB) elB.classList.remove('shake-rollback');
    }, 280);
  }

  /**
   * 匹配高亮与消除渐隐
   */
  highlightMatches(matches) {
    for (const match of matches) {
      for (const cell of match.cells) {
        const cellEl = this.getCellElement(cell.row, cell.col);
        if (cellEl) {
          const tileEl = cellEl.querySelector('.tile');
          if (tileEl) {
            tileEl.classList.add('tile-popping');
          }
        }
      }
    }
  }

  /**
   * 果酱罐腾跃抛物线动效演出
   */
  playJarLeapAnim(from, to, jarId = null) {
    const selector = jarId ? `.tile[data-id="${jarId}"]` : '.tile-jar';
    const jarEl = this.container.querySelector(selector);
    if (jarEl) {
      jarEl.classList.add('jar-leaping');
    }
    // 渲染网格更新
    setTimeout(() => {
      this.render();
      const newJarEl = this.container.querySelector(selector);
      if (newJarEl) {
        newJarEl.classList.add('jar-leaping');
        setTimeout(() => newJarEl.classList.remove('jar-leaping'), 300);
      }
    }, 150);
  }

  /**
   * 果酱罐十字爆破打击感演出 (0.1s顿帧微震 + 爆浆飞溅)
   */
  playJarBurstAnim(pos, blastCells) {
    // 爆浆着陆顿帧：暂停棋盘 CSS 动画与输入 100ms，不暂停引擎结算
    if (this.hitStopTimer) clearTimeout(this.hitStopTimer);
    this.isHitStopped = true;
    this.container.classList.add('board-hitstop');
    this.hitStopTimer = setTimeout(() => {
      this.isHitStopped = false;
      this.container.classList.remove('board-hitstop');
      this.hitStopTimer = null;
    }, 100);

    // 棋盘微震
    this.container.classList.add('board-shaking');
    setTimeout(() => this.container.classList.remove('board-shaking'), 200);

    // 十字爆浆飞溅粒子层
    for (const cellPos of blastCells) {
      const cellEl = this.getCellElement(cellPos.row, cellPos.col);
      if (cellEl) {
        const splashEl = document.createElement('div');
        splashEl.className = 'cell-burst-splash';
        cellEl.appendChild(splashEl);
        setTimeout(() => splashEl.remove(), 400);
      }
    }

    setTimeout(() => {
      this.render();
    }, 100);
  }

  /**
   * 双罐共鸣闪光：重叠格短暂高亮（不改变爆浆范围）
   */
  playResonanceFlash(cells) {
    for (const cellPos of cells) {
      const cellEl = this.getCellElement(cellPos.row, cellPos.col);
      if (!cellEl) continue;
      cellEl.classList.add('cell-resonance-flash');
      setTimeout(() => cellEl.classList.remove('cell-resonance-flash'), 650);
    }
  }

  /**
   * 弹出游戏结束弹窗 (胜利/失败)
   */
  showGameOverModal(isVictory) {
    const modal = document.getElementById('game-over-modal');
    if (!modal) return;
    const title = document.getElementById('modal-title');
    const desc = document.getElementById('modal-desc');

    if (isVictory) {
      title.innerText = '🎉 关卡挑战成功！';
      title.style.color = '#10b981';
      desc.innerText = `恭喜通关！剩余步数：${this.engine.movesRemaining} 步，得分：${this.engine.score}`;
    } else {
      title.innerText = '💔 步数耗尽，挑战失败';
      title.style.color = '#ef4444';
      desc.innerText = '步数已耗尽，关卡目标尚未完全达成。点击下方按钮重新挑战！';
    }
    modal.classList.remove('hidden');
  }
}
