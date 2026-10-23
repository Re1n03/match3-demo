# 三消关卡系统设计 Demo（Lv62–Lv64）

游戏策划求职作品集原型：纯静态 HTML/CSS/ES Modules，无构建步骤、无外部资源依赖。
包含 Lv62 罐体引导关、Lv63 双罐共鸣关、Lv64 双岛传送门+蜂蜜卡点关，以及 Node 无头模拟器与测试脚本。

## 本地运行

在项目根目录启动任意静态文件服务器：

```bash
python -m http.server 8080
```

浏览器打开 <http://127.0.0.1:8080/>。

Windows 也可双击 `启动本地体验.bat`。

> 直接双击 `index.html`（file://）会因浏览器模块 CORS 限制无法加载 ES Modules，请使用本地 HTTP 服务。

## 部署（静态托管）

- 整个仓库/目录可直接上传到 GitHub Pages、Netlify、Vercel、对象存储等静态托管；
- `index.html`、`css/`、`js/` 均使用相对路径，无后端、无构建、无环境变量；
- 音频由 Web Audio API 实时合成，不依赖 mp3/wav；
- 手机端首次触摸后自动解锁音频。

## 测试命令

```bash
# 单元/机制回归（headless Edge，52 项）
python run_tests.py

# 桌面真实浏览器 E2E（输入锁、切关、Lv62–64 点击结算）
python tests/run_e2e.py

# 一键验收（单元 + E2E + Lv62 求解器 + 模拟器确定性 + greedy 评分）
python tests/run_all.py

# Lv62 8x8 约束求解器
node tests/solve_lv62.mjs

# 模拟器确定性
node tests/sim/test_determinism.mjs

# Lv64 greedy 评分回归
node tests/sim/test_lv64_greedy.mjs
```

### 手机 E2E（Playwright）

```bash
npm install playwright-core   # 或设置 PLAYWRIGHT_CORE 指向已有 playwright-core/index.mjs
node tests/run_mobile_e2e.mjs
```

覆盖 iPhone SE (3rd gen)、Pixel 5，以及 360px 窄屏：三关点击到结算、无横向滚动、单格 ≥40px、首次触摸解锁音频。

### 模拟器

```bash
node tests/sim/run_sim.mjs --games 2000
node tests/sim/run_sim.mjs --levels 64 --bots mixed --cap 40
node tests/sim/lv64_cap_analysis.mjs
node tests/sim/lv64_cap_curve.mjs
node tests/sim/lv64_match_metrics.mjs
```

输出在 `tests/sim/out/`（JSON/CSV/summary.js）。直方图页面：`tests/sim/histogram.html`。

设计事实与 PDF 差异汇总：[docs/design_facts.md](docs/design_facts.md)。

## 截图

```bash
npm install playwright-core
node tests/shots/capture.mjs
```

输出 `tests/shots/out/`：
- `desktop/`、`mobile/`：2x PNG，Lv62 初始/起跳/爆浆、Lv63 初始/共鸣、Lv64 初始；
- `simulator/`：Lv63 mixed 剩余步数、Lv64 mixed cap40 所需步数直方图（标注“机器人模拟”）。

## 目录

```
index.html              入口（Lv62 默认）
css/                    全局/棋盘样式与手机适配
js/engine/              引擎、匹配、重力、随机数
js/mechanics/           罐体、传送门
js/levels/              Lv62/Lv63/Lv64 关卡配置
js/ui/                  棋盘渲染、音频
tests/                  单元/E2E/求解器/模拟器/截图
tests/sim/out/          模拟器基线数据
tests/shots/out/        截图输出
```

## 移动端说明

- viewport 使用 `viewport-fit=cover`，适配 safe-area；
- 360px 宽下 8×8 棋盘完整显示，单格点击区域约 40.4px；
- `100dvh` 避免移动浏览器地址栏导致的 100vh 跳动；
- 首次进入显示 3 行试玩说明，可关闭；音频在首次触摸/按键后解锁。
