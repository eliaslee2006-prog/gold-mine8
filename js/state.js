export const state={
  user:null,
  events:[],
  tasks:[],
  fitness:{movements:[],sessions:[]},
  finance:{
    settings:{currency:'SGD',startingBalance:0,portfolioCash:0,cashUpColor:'#2fd69a',cashDownColor:'#ff405c'},
    transactions:[],positions:[],journal:[],
    risk:{maxPositionPct:20,maxSectorPct:35,maxDailyLossPct:3,riskPerTradePct:1,maxDrawdownPct:12,targetCashPct:20,targetEquityPct:70,targetCommodityPct:5,targetOtherPct:5,equityColor:'#45e8ff',drawdownColor:'#ff405c'},
    snapshots:[],trades:[]
  },
  avatar:{states:[],assets:[],logic:{dueSoonHours:24,anxiousActive:6,anxiousDueSoon:2,panicOverdue:4,panicHighOverdue:2,successCompletedToday:3},system:{offlineEnabled:true,analyzingEnabled:true,masterEffectIntensity:1,motionMode:'system',moodHoldSeconds:1.5,transitionMs:220}},
  media:{overview:null,loaded:false},
  appearance:{settings:{preset:'TACTICAL',hudMaxWidth:1900,panelGap:14,panelPadding:16,radius:15,borderOpacity:.62,shadowIntensity:.30,interfaceScale:1,headingScale:1,telemetryScale:1,density:'COMFORTABLE',mobileDensity:'COMPACT',palette:{cyan:'#00d9ff',mag:'#ff3ea5',red:'#ff405c',amber:'#ffba4a',green:'#6ee7a7',violet:'#8b6cff'}},assets:[],assignments:[]},
  settings:{},fonts:[],integrations:{},taskFilter:'active'
};
export function upsert(list,item){const i=list.findIndex(x=>x.id===item.id);if(i>=0)list[i]=item;else list.push(item);return item;}
export function remove(list,id){const i=list.findIndex(x=>x.id===id);if(i>=0)list.splice(i,1);}
