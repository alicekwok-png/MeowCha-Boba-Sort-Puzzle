// client/solver.worker.js — 喺 Web Worker 入面跑 IDA* / 關卡生成，唔阻塞 UI。
// 呢個 worker 屬於「server 側」：佢見到完整盤面。

import { decodeBoard, encodeBoard } from '../core/board.js';
import { solveEx } from '../core/solver.js';
import { generateLevelEx } from '../core/generator.js';

self.onmessage = (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'solve') {
      const b = decodeBoard(e.data.board);
      const r = solveEx(b, e.data.maxDepth ?? 40, e.data.maxNodes ?? 600_000);
      self.postMessage({ id, result: { moves: r.moves, nodes: r.nodes, aborted: r.aborted } });
    } else if (type === 'generate') {
      const r = generateLevelEx(e.data.cfg, e.data.seed, { maxAttempts: e.data.maxAttempts ?? 400 });
      self.postMessage({ id, result: r ? { board: encodeBoard(r.board), optimal: r.optimal, thresholds: r.thresholds, attempts: r.attempts } : null });
    } else {
      self.postMessage({ id, error: 'unknown type ' + type });
    }
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
