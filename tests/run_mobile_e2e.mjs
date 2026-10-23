#!/usr/bin/env node
/**
 * run_mobile_e2e.mjs - Playwright 手机竖屏 E2E
 *
 * 覆盖：
 * - iPhone SE (3rd gen) / Pixel 5：三关各点击玩到结算（Lv62 通关；Lv63/Lv64 允许胜/负）；
 * - 360x640 额外检查：8x8 完整显示、无横向滚动、单格点击区域 >= 40px；
 * - 首次试玩说明最多 3 行且可关闭；
 * - 首次触摸后 AudioContext 解锁。
 *
 * 用法：
 *   node tests/run_mobile_e2e.mjs
 * 依赖：playwright-core + 本机 Edge；可设置 PLAYWRIGHT_CORE 指向 playwright-core/index.mjs。
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_CORE,
    path.join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'),
    'C:/Users/86173/Documents/deepseek-harness/default-workspace/node_modules/playwright-core/index.mjs'
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const mod = await import(pathToFileURL(candidate).href);
      if (mod.chromium) return mod;
    } catch (e) { /* try next */ }
  }
  throw new Error('未找到 playwright-core；请执行 npm install playwright-core 或设置 PLAYWRIGHT_CORE');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function startServer() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail });
}

async function loadGame(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__demoE2E && window.__demoE2E.getEngine(), null, { timeout: 15000 });
}

async function dismissIntro(page) {
  const visible = await page.evaluate(() => {
    const overlay = document.getElementById('intro-overlay');
    return overlay ? !overlay.classList.contains('hidden') : false;
  });
  if (visible) await page.locator('#intro-dismiss').tap();
  await page.evaluate(() => window.__demoE2E.dismissIntro());
}

async function clickCell(page, row, col) {
  await page.locator(`.board-cell[data-row="${row}"][data-col="${col}"]`).tap();
}

async function waitSettled(page) {
  await page.waitForFunction(() => {
    const engine = window.__demoE2E.getEngine();
    const modal = document.getElementById('game-over-modal');
    return engine.state === 'IDLE' || engine.state === 'VICTORY' || engine.state === 'DEFEAT' ||
      (modal && !modal.classList.contains('hidden'));
  }, null, { timeout: 20000 });
}

async function closeModalIfOpen(page) {
  const open = await page.evaluate(() => {
    const modal = document.getElementById('game-over-modal');
    return modal && !modal.classList.contains('hidden');
  });
  if (open) {
    await page.locator('#modal-restart-btn').tap();
    await page.waitForFunction(() => {
      const modal = document.getElementById('game-over-modal');
      return modal && modal.classList.contains('hidden');
    }, null, { timeout: 5000 });
  }
}

async function playToSettlement(page, levelButton, maxMoves) {
  await page.locator(levelButton).tap();
  await page.waitForFunction(() => window.__demoE2E.getEngine().state === 'IDLE', null, { timeout: 8000 });
  await page.evaluate(() => {
    const engine = window.__demoE2E.getEngine();
    engine.config = { ...engine.config, stepDelay: 0 };
  });

  for (let i = 0; i < maxMoves; i++) {
    const modalOpen = await page.evaluate(() => {
      const modal = document.getElementById('game-over-modal');
      return modal && !modal.classList.contains('hidden');
    });
    if (modalOpen) break;

    const moves = await page.evaluate(() => {
      let possible = window.__demoE2E.findPossibleMoves();
      if (!possible.length) {
        window.__demoE2E.getEngine().resolveDeadlock();
        possible = window.__demoE2E.findPossibleMoves();
      }
      const move = possible[0];
      return move ? {
        a: { row: move.posA.row, col: move.posA.col },
        b: { row: move.posB.row, col: move.posB.col }
      } : null;
    });
    if (!moves) break;
    await clickCell(page, moves.a.row, moves.a.col);
    await clickCell(page, moves.b.row, moves.b.col);
    await waitSettled(page);
  }

  await page.waitForFunction(() => {
    const modal = document.getElementById('game-over-modal');
    return modal && !modal.classList.contains('hidden');
  }, null, { timeout: 15000 });
  const title = await page.locator('#modal-title').textContent();
  return title.trim();
}

async function runDevice(browser, deviceName, url) {
  const { devices } = await loadPlaywright();
  const context = await browser.newContext({ ...devices[deviceName] });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await loadGame(page, url);
  const intro = await page.evaluate(() => {
    const overlay = document.getElementById('intro-overlay');
    return {
      visible: overlay ? !overlay.classList.contains('hidden') : false,
      lines: overlay ? overlay.querySelectorAll('p').length : 0
    };
  });
  check(`${deviceName} 首次进入显示试玩说明（3行内）`, intro.visible && intro.lines <= 3,
    `visible=${intro.visible}, lines=${intro.lines}`);
  await dismissIntro(page);

  const layout = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.board-cell')];
    const rects = cells.map(cell => cell.getBoundingClientRect());
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      minCell: Math.min(...rects.map(rect => Math.min(rect.width, rect.height))),
      boardRight: document.querySelector('.board-grid').getBoundingClientRect().right
    };
  });
  check(`${deviceName} 无横向滚动`, layout.scrollWidth <= layout.innerWidth + 1,
    `scroll=${layout.scrollWidth}/${layout.innerWidth}`);
  check(`${deviceName} 单格点击区域≥40px`, layout.minCell >= 40,
    `minCell=${layout.minCell.toFixed(2)}, boardRight=${layout.boardRight.toFixed(1)}`);

  // 首次触摸解锁音频
  await page.locator('.header-container').tap();
  await page.waitForTimeout(300);
  const audioUnlocked = await page.evaluate(() => {
    const audio = window.__demoE2E.getAudio();
    return !!(audio && audio.isUnlocked);
  });
  check(`${deviceName} 首次触摸后音效解锁`, audioUnlocked, `isUnlocked=${audioUnlocked}`);

  // Lv62：唯一首步通关
  await page.locator('#btn-lvl-62').tap();
  await page.waitForFunction(() => window.__demoE2E.getEngine().movesRemaining === 22, null, { timeout: 5000 });
  await page.evaluate(() => {
    const engine = window.__demoE2E.getEngine();
    engine.config = { ...engine.config, stepDelay: 0 };
  });
  await clickCell(page, 3, 1);
  await clickCell(page, 3, 2);
  await page.waitForFunction(() => {
    const modal = document.getElementById('game-over-modal');
    return modal && !modal.classList.contains('hidden');
  }, null, { timeout: 15000 });
  const lv62Title = (await page.locator('#modal-title').textContent()).trim();
  check(`${deviceName} Lv62 点击通关`, lv62Title.includes('成功'), lv62Title);
  await closeModalIfOpen(page);

  // Lv63 / Lv64：点击到结算（胜/负均可）
  const lv63Title = await playToSettlement(page, '#btn-lvl-63', 24);
  check(`${deviceName} Lv63 点击到结算`, /成功|失败/.test(lv63Title), lv63Title);
  await closeModalIfOpen(page);
  const lv64Title = await playToSettlement(page, '#btn-lvl-64', 19);
  check(`${deviceName} Lv64 点击到结算`, /成功|失败/.test(lv64Title), lv64Title);
  await closeModalIfOpen(page);

  check(`${deviceName} 页面无 JS 异常`, pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
  await context.close();
}

async function main() {
  const { chromium } = await loadPlaywright();
  const server = await startServer();
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/index.html?e2e=1`;
  const browser = await chromium.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  });

  try {
    await runDevice(browser, 'iPhone SE (3rd gen)', url);
    await runDevice(browser, 'Pixel 5', url);

    // 360px 窄屏专项：竖屏完整显示
    const context = await browser.newContext({
      viewport: { width: 360, height: 640 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2
    });
    const page = await context.newPage();
    await loadGame(page, url);
    await dismissIntro(page);
    const narrow = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.board-cell')];
      const rects = cells.map(cell => cell.getBoundingClientRect());
      const board = document.querySelector('.board-grid').getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        minCell: Math.min(...rects.map(rect => Math.min(rect.width, rect.height))),
        boardLeft: board.left,
        boardRight: board.right
      };
    });
    check('360px 竖屏 8x8 完整显示且无横向滚动',
      narrow.scrollWidth <= 360 && narrow.boardLeft >= 0 && narrow.boardRight <= 360 + 0.5,
      JSON.stringify(narrow));
    check('360px 单格点击区域≥40px', narrow.minCell >= 40, `minCell=${narrow.minCell.toFixed(2)}`);
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }

  const passCount = results.filter(item => item.pass).length;
  const failCount = results.length - passCount;
  for (const item of results) {
    console.log(`[${item.pass ? 'PASS' : 'FAIL'}] ${item.name}${item.detail ? ' -> ' + item.detail : ''}`);
  }
  console.log(`\n共 ${results.length} 项：${passCount} PASS / ${failCount} FAIL`);
  if (failCount > 0) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
