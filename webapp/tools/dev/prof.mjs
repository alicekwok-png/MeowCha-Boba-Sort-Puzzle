import { CAMPAIGN } from '../../src/core/levels.js';
import { randomFill, colorSafe, ordersReachable, frostedMeaningful } from '../../src/core/generator.js';
import { solveEx, countOptimalPaths, safeOpening } from '../../src/core/solver.js';
import { countSegments } from '../../src/core/board.js';
import { isComplete, legalMoves } from '../../src/core/rules.js';
import { mulberry32 } from '../../src/core/prng.js';
const id = Number(process.argv[2]||20); const cfg = CAMPAIGN[id-1];
const rng = mulberry32(12345+id);
for (let a=0;a<40;a++){
  const b = randomFill(cfg, rng); if(!b) continue;
  if (b.cups.some(isComplete)) continue;
  if (Math.abs(countSegments(b)-cfg.segments)>1) continue;
  if (!colorSafe(b)||!ordersReachable(b)||!frostedMeaningful(b)) continue;
  let t=Date.now(); const r=solveEx(b, cfg.optimalMax+2, 1_500_000); const tS=Date.now()-t;
  console.log(`attempt ${a}: solve ${tS}ms nodes=${r.nodes} aborted=${r.aborted} len=${r.moves?r.moves.length:null} legal=${legalMoves(b).length}`);
  if(!r.moves) continue;
  t=Date.now(); const c=countOptimalPaths(b, r.moves.length, 2); console.log(`  countOptimal ${Date.now()-t}ms -> ${c}`);
  t=Date.now(); const s=safeOpening(b, cfg.cups<=8?3:2, r.moves.length+4); console.log(`  safeOpening ${Date.now()-t}ms -> ${s}`);
  break;
}
