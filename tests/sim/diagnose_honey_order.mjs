#!/usr/bin/env node
/**
 * diagnose_honey_order.mjs - mixed cap40，统计 4 块蜂蜜的破坏顺序与步序中位数。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Level64Config } from '../../js/levels/level64.js';
import { simulateGame, botRngSeed } from './run_sim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, 'out');
const GAMES = Number(process.env.SIM_GAMES || 2000);
const SEED = 1042;
const config = { ...Level64Config, maxMoves: 40, stepDelay: 0 };

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * 0.5)];
}
function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

async function main() {
  const cells = ['6,6', '6,7', '7,6', '7,7'];
  const destroyedSteps = Object.fromEntries(cells.map(k => [k, []]));
  const orderPositions = Object.fromEntries(cells.map(k => [k, []]));
  const lastLocation = Object.fromEntries(cells.map(k => [k, 0]));
  const sequences = {};
  let games = 0;
  let gamesWith4 = 0;

  for (let i = 0; i < GAMES; i++) {
    const game = await simulateGame(
      config, 'mixed', SEED + i, botRngSeed('mixed', SEED, i), 0.5,
      { diagnostics: true }
    );
    games++;
    const records = game.diagnostics.honeyDestroyed;
    if (records.length !== 4) continue;
    gamesWith4++;
    records.sort((a, b) => a.order - b.order);
    const sequence = records.map(r => `${r.row},${r.col}`);
    sequences[sequence.join('>')] = (sequences[sequence.join('>')] || 0) + 1;
    const last = sequence[sequence.length - 1];
    lastLocation[last] = (lastLocation[last] || 0) + 1;
    records.forEach((record, index) => {
      const key = `${record.row},${record.col}`;
      destroyedSteps[key].push(record.step);
      orderPositions[key].push(index + 1);
    });
  }

  const result = {
    games,
    bot: 'mixed',
    cap: 40,
    gamesWith4,
    lastLocation,
    lastLocationRate: Object.fromEntries(
      Object.entries(lastLocation).map(([k, v]) => [k, gamesWith4 ? v / gamesWith4 : 0])
    ),
    sequences,
    perCell: Object.fromEntries(cells.map(key => [key, {
      count: destroyedSteps[key].length,
      medianStep: median(destroyedSteps[key]),
      meanStep: mean(destroyedSteps[key]),
      meanOrder: mean(orderPositions[key])
    }]))
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'honey_order_diagnostics.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
