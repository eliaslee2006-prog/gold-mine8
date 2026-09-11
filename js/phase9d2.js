import { initPhase9D2Nexus } from './phase9d2-nexus.js';
import { initPhase9D2TaskAudio } from './phase9d2-task-audio.js';
import { initPhase9D2Pinboard } from './phase9d2-pinboard.js';
import { initPhase9D2Finance } from './phase9d2-finance.js';
import { initPhase9D2Customize } from './phase9d2-customize.js';
import { initPhase9D2Intel } from './phase9d2-intel.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(){for(let i=0;i<220;i++){if(document.documentElement.dataset.phase9d==='ready'||window.NeonPhase9D)return true;await sleep(100);}return false;}
async function boot(){if(!await wait()){console.warn('NEON OPS // 9D.2 WAITED FOR 9D.1 AND TIMED OUT');return;}const status={};const safe=async(name,fn)=>{try{const out=await fn();status[name]='ready';return out;}catch(e){status[name]=`error: ${e.message}`;console.error('9D.2',name,e);return null;}};await safe('customize',()=>initPhase9D2Customize());await safe('nexusVoice',()=>initPhase9D2Nexus());await safe('taskAudio',()=>initPhase9D2TaskAudio());await safe('pinboard',()=>initPhase9D2Pinboard());await safe('finance',()=>initPhase9D2Finance());await safe('intelligence',()=>initPhase9D2Intel());document.documentElement.dataset.phase9d2='ready';window.NeonPhase9D2={version:'9D.2',workerTarget:'9.14.0',status,aiRouterDeferred:true};console.info('NEON OPS // PHASE 9D.2 READY',status);}
boot();
