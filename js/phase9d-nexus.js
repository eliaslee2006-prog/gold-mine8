import { api } from './api.js';
const $=s=>document.querySelector(s);
const KEY='neon.phase9d.providerPreference';
let preference=localStorage.getItem(KEY)||'auto';
let providers={};

function configured(keys){
  for(const k of keys){
    const v=providers?.[k];
    if(v===true)return true;
    if(v&&typeof v==='object'&&v.configured!==false)return !!(v.configured??v.available??v.enabled??true);
  }
  return false;
}
function option(value,label,keys){return{value,label,configured:configured(keys)};}
function choices(){return[
  {value:'auto',label:'AUTO',configured:true},
  option('gemini','GEMINI',['gemini','google']),
  option('gpt','GPT',['gpt','openai']),
  option('claude','CLAUDE',['claude','anthropic']),
  option('deepseek','DEEPSEEK',['deepseek'])
];}
function renderState(){const s=$('#p9dProviderState');if(!s)return;const c=choices().find(x=>x.value===preference);s.textContent=`ROUTER // ${(c?.label||preference).toUpperCase()}`;s.dataset.state=c?.configured?'ready':'warn';}
async function loadProviders(){
  try{
    const d=await api('/api/v8/nexus/settings');providers=d.providers||{};
    const sel=$('#p9dProviderSelect');if(!sel)return;
    sel.replaceChildren(...choices().map(c=>{const o=document.createElement('option');o.value=c.value;o.textContent=c.configured?c.label:`${c.label} // NOT CONFIGURED`;o.disabled=!c.configured;return o;}));
    if(!choices().find(x=>x.value===preference&&x.configured))preference='auto';
    sel.value=preference;renderState();
  }catch(e){console.warn('9D provider capabilities',e.message);renderState();}
}
function installFetchBridge(){
  if(window.__p9dProviderBridge)return;window.__p9dProviderBridge=true;
  const native=window.fetch.bind(window);
  window.fetch=async(input,init={})=>{
    try{
      const url=typeof input==='string'?input:input?.url||'';
      if(/\/api\/v8\/nexus\/chat(?:\?|$)/.test(url)&&String(init.method||'GET').toUpperCase()==='POST'&&init.body){
        const b=typeof init.body==='string'?JSON.parse(init.body):init.body;
        if(b&&typeof b==='object'){b.providerPreference=preference;init={...init,body:JSON.stringify(b)};}
      }
    }catch(e){console.warn('9D provider bridge',e);}
    return native(input,init);
  };
}
function inject(){
  const anchor=$('#p9cNexusResearch')||$('.nxc-composer-meta');if(!anchor||$('#p9dProviderRouter'))return;
  const bar=document.createElement('div');bar.id='p9dProviderRouter';bar.className='p9d-provider-router';
  bar.innerHTML=`<label>AI ROUTER<select id="p9dProviderSelect"><option value="auto">AUTO</option></select></label><span id="p9dProviderState" data-state="ready">ROUTER // AUTO</span><small>AUTO FALLS BACK ACROSS CONFIGURED PROVIDERS</small>`;
  anchor.insertAdjacentElement('afterend',bar);
  $('#p9dProviderSelect').onchange=e=>{preference=e.target.value;localStorage.setItem(KEY,preference);renderState();};
  loadProviders();
}
export function initPhase9DNexus(){installFetchBridge();inject();return{getProviderPreference:()=>preference,refreshProviders:loadProviders};}
