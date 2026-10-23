#!/usr/bin/env node
/**
 * capture.mjs - 作品集截图脚本
 *
 * 输出 tests/shots/out/：
 * - desktop/ 与 mobile/ 各一套 2x PNG：Lv62 初始 / 起跳 / 爆浆、Lv63 初始 / 共鸣闪光、Lv64 初始；
 * - simulator/：Lv63 mixed 通关剩余步数、Lv64 mixed cap40 所需步数（标注“机器人模拟”）。
 *
 * 用法：node tests/shots/capture.mjs
 * 依赖：playwright-core（可用 PLAYWRIGHT_CORE 指定路径）+ 本机 Edge。
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(path.dirname(HERE));
const OUT = path.join(HERE, 'out');
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
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png'
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

async function pauseAnimation(page, selector, offsetSeconds) {
  await page.evaluate(({ selector, offsetSeconds }) => {
    let style = document.getElementById('shot-pause');
    if (!style) {
      style = document.createElement('style');
      style.id = 'shot-pause';
      document.head.appendChild(style);
    }
    style.textContent = `${selector}{animation-play-state:paused!important;animation-delay:-${offsetSeconds}s!important;}`;
  }, { selector, offsetSeconds });
}

async function resumeAnimation(page) {
  await page.evaluate(() => document.getElementById('shot-pause')?.remove());
}

async function closeModalIfOpen(page) {
  await page.waitForTimeout(900);
  const open = await page.evaluate(() => {
    const modal = document.getElementById('game-over-modal');
    return modal && !modal.classList.contains('hidden');
  });
  if (open) {
    await page.locator('#modal-restart-btn').click();
    await page.waitForFunction(() => {
      const modal = document.getElementById('game-over-modal');
      return modal && modal.classList.contains('hidden');
    }, null, { timeout: 5000 });
  }
}

async function shot(page, filePath, fullPage = true) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await page.screenshot({ path: filePath, fullPage });
  console.log(`[shot] ${path.relative(ROOT, filePath)}`);
}

async function clickCell(page, row, col) {
  await page.locator(`.board-cell[data-row="${row}"][data-col="${col}"]`).click();
}

async function openGame(page, url) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__demoE2E && window.__demoE2E.getEngine(), null, { timeout: 15000 });
  await page.evaluate(() => window.__demoE2E.dismissIntro());
}

async function captureSet(browser, name, viewport, url) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const dir = path.join(OUT, name);
  const newPage = async () => {
    const page = await context.newPage();
    await openGame(page, url);
    return page;
  };

  // Lv62：初始 + 起跳（同一局内抓取，避免重开干扰）
  let page = await newPage();
  await page.locator('#btn-lvl-62').click();
  await page.waitForFunction(() => window.__demoE2E.getEngine().movesRemaining === 22, null, { timeout: 5000 });
  await shot(page, path.join(dir, 'lv62-01-initial.png'));
  await clickCell(page, 3, 1);
  await clickCell(page, 3, 2);
  await page.waitForSelector('.tile-jar.jar-leaping', { timeout: 4000 });
  await page.evaluate(() => {
    const jar = document.querySelector('.tile-jar.jar-leaping');
    if (jar) {
      jar.style.transform = 'translateY(-24px) scale(1.3)';
      jar.style.zIndex = '20';
    }
  });
  await pauseAnimation(page, '.tile-jar.jar-leaping', 0.16);
  await shot(page, path.join(dir, 'lv62-02-jar-leap.png'));
  await page.close();

  // Lv62：爆浆（全新页面；首步结束后在安全落点重放爆浆粒子，便于稳定截帧）
  page = await newPage();
  await page.locator('#btn-lvl-62').click();
  await page.waitForFunction(() => window.__demoE2E.getEngine().movesRemaining === 22, null, { timeout: 5000 });
  await clickCell(page, 3, 1);
  await clickCell(page, 3, 2);
  await page.waitForFunction(() => {
    const state = window.__demoE2E.getEngine().state;
    return state === 'VICTORY' || state === 'DEFEAT';
  }, null, { timeout: 8000 });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    document.getElementById('game-over-modal').classList.add('hidden');
    const positions = [
      { row: 5, col: 6 }, { row: 4, col: 6 }, { row: 6, col: 6 }, { row: 5, col: 5 }, { row: 5, col: 7 }
    ];
    for (const pos of positions) {
      const cell = document.querySelector(`.board-cell[data-row="${pos.row}"][data-col="${pos.col}"]`);
      if (!cell) continue;
      const splash = document.createElement('div');
      splash.className = 'cell-burst-splash';
      splash.style.cssText = 'position:absolute;inset:-2px;border-radius:8px;z-index:15;pointer-events:none;' +
        'background:radial-gradient(circle, rgba(251,191,36,.96) 0%, rgba(245,158,11,.55) 58%, rgba(245,158,11,0) 80%);' +
        'box-shadow:0 0 18px rgba(245,158,11,.95);';
      cell.appendChild(splash);
    }
  });
  await page.waitForSelector('.cell-burst-splash', { timeout: 3000 });
  await pauseAnimation(page, '.cell-burst-splash', 0.12);
  await shot(page, path.join(dir, 'lv62-03-burst.png'));
  await page.close();

  // Lv63：初始
  page = await newPage();
  await page.locator('#btn-lvl-63').click();
  await page.waitForFunction(() => window.__demoE2E.getEngine().movesRemaining === 24, null, { timeout: 5000 });
  await shot(page, path.join(dir, 'lv63-01-initial.png'));
  await page.close();

  // Lv63：共鸣闪光（全新页面，直接构造双罐同时激活）
  page = await newPage();
  await page.locator('#btn-lvl-63').click();
  await page.waitForFunction(() => window.__demoE2E.getEngine().movesRemaining === 24, null, { timeout: 5000 });
  await page.evaluate(async () => {
    const engine = window.__demoE2E.getEngine();
    engine.config = { ...engine.config, stepDelay: 0 };
    const system = engine.customMechanics;
    for (const key of ['4,2', '4,6']) {
      for (let i = 0; i < 3; i++) {
        await system.onMatchesResolved(engine, { matchedCells: new Set([key]) });
      }
    }
    await system.onPostGravityResolved(engine);
  });
  await page.waitForSelector('.cell-resonance-flash', { timeout: 4000 });
  await pauseAnimation(page, '.board-cell.cell-resonance-flash::after', 0.25);
  await page.evaluate(() => {
    document.getElementById('game-over-modal').classList.add('hidden');
    const cell = document.querySelector('.board-cell[data-row="4"][data-col="4"]');
    if (cell) cell.classList.add('cell-resonance-flash');
    const style = document.createElement('style');
    style.id = 'shot-resonance-force';
    style.textContent = '.board-cell.cell-resonance-flash::after{animation:none!important;opacity:1!important;transform:scale(1.15)!important;}';
    document.head.appendChild(style);
  });
  await shot(page, path.join(dir, 'lv63-02-resonance.png'));
  await page.close();

  // Lv64：初始（传送门 + 蜂蜜标记）
  page = await newPage();
  await page.locator('#btn-lvl-64').click();
  await page.waitForFunction(() => window.__demoE2E.getEngine().movesRemaining === 19, null, { timeout: 5000 });
  await page.waitForSelector('.portal-marker', { timeout: 3000 });
  await shot(page, path.join(dir, 'lv64-01-initial.png'));
  await page.close();

  await context.close();
}

function histogramHtml(title, histogram, xLabel) {
  const entries = Object.entries(histogram || {}).map(([k, v]) => [Number(k), v]).sort((a, b) => a[0] - b[0]);
  const W = 1000, H = 430, pad = { l: 64, r: 28, t: 34, b: 54 };
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
  const maxV = Math.max(...entries.map(([, v]) => v), 1);
  const barW = plotW / Math.max(entries.length, 1);
  const grid = Array.from({ length: 5 }, (_, i) => {
    const y = pad.t + (plotH * i) / 4;
    return `<line x1="${pad.l}" y1="${y}" x2="${W - pad.r}" y2="${y}" stroke="#334155"/>`;
  }).join('');
  const bars = entries.map(([key, count], i) => {
    const h = (plotH * count) / maxV;
    const x = pad.l + i * barW + 4;
    const y = pad.t + plotH - h;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(2, barW - 8).toFixed(1)}" height="${h.toFixed(1)}" fill="#38bdf8" rx="2"/>`;
  }).join('');
  const labelStep = Math.max(1, Math.ceil(entries.length / 14));
  const labels = entries.map(([key], i) => {
    if (i % labelStep !== 0 && i !== entries.length - 1) return '';
    const x = pad.l + i * barW + barW / 2;
    return `<text x="${x.toFixed(1)}" y="${H - 24}" fill="#94a3b8" font-size="13" text-anchor="middle">${key}</text>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8">
  <style>body{margin:0;background:#0f172a;color:#e2e8f0;font-family:-apple-system,"Segoe UI",sans-serif}
  .wrap{padding:26px 28px}.title{font-size:22px;font-weight:700;color:#38bdf8;margin-bottom:4px}
  .sub{font-size:13px;color:#94a3b8;margin-bottom:14px}svg{display:block;border-radius:10px;background:#111827}</style>
  </head><body><div class="wrap"><div class="title">${title}</div><div class="sub">机器人模拟 · mixed 机器人 · N=2000</div>
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  ${grid}${bars}
  <text x="${pad.l}" y="20" fill="#cbd5e1" font-size="14">${xLabel}</text>
  <text x="18" y="${pad.t + 8}" fill="#64748b" font-size="12">对局数</text>
  ${labels}
  </svg></div></body></html>`;
}

async function captureHistograms(browser) {
  const lv63 = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/sim/out/lv63_mixed.json'), 'utf8'));
  const cap = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/sim/out/lv64_cap_analysis.json'), 'utf8'));
  const lv64 = cap.mixed.requiredSteps.histogram;
  const context = await browser.newContext({ viewport: { width: 1080, height: 520 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const dir = path.join(OUT, 'simulator');

  await page.setContent(histogramHtml(
    'Lv63 mixed · 通关时剩余步数分布',
    lv63.remainingMovesOnWin.histogram,
    '剩余步数'
  ));
  await shot(page, path.join(dir, 'lv63-mixed-remaining.png'));

  await page.setContent(histogramHtml(
    'Lv64 mixed · cap40 通关所需步数分布',
    lv64,
    '通关所需步数'
  ));
  await shot(page, path.join(dir, 'lv64-mixed-cap40-required.png'));

  await context.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = await loadPlaywright();
  const server = await startServer();
  const url = `http://127.0.0.1:${server.address().port}/index.html?e2e=1`;
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    await captureSet(browser, 'desktop', { width: 1280, height: 900 }, url);
    await captureSet(browser, 'mobile', { width: 390, height: 844 }, url);
    await captureHistograms(browser);
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n[shots] 输出目录：${OUT}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
