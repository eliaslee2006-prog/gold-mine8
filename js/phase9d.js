import { initPhase9DNexus } from './phase9d-nexus.js';
import { initPhase9DSources } from './phase9d-sources.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(){for(let i=0;i<180;i++){if(document.documentElement.dataset.phase9c==='ready'||window.NeonPhase9C)return true;await sleep(100);}return false;}
async function boot(){const attached=await wait();if(!attached){console.warn('NEON OPS // 9D WAITED FOR 9C AND TIMED OUT');return;}const status={};for(const [name,fn] of [['nexus',initPhase9DNexus],['sources',initPhase9DSources]]){try{await fn();status[name]='ready';}catch(e){status[name]=`error: ${e.message}`;console.error('9D',name,e);}}document.documentElement.dataset.phase9d='ready';window.NeonPhase9D={version:'9D.1',workerTarget:'9.13.0',status};console.info('NEON OPS // PHASE 9D.1 READY',status);}
boot();
