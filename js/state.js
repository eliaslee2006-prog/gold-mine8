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
  avatar:{states:[],assets:[],logic:{dueSoonHours:24,anxiousActive:6,anxiousDueSoon:2,panicOverdue:4,panicHighOverdue:2,successCompletedToday:3}},
  integrations:{},taskFilter:'active'
};
export function upsert(list,item){const i=list.findIndex(x=>x.id===item.id);if(i>=0)list[i]=item;else list.push(item);return item;}
export function remove(list,id){const i=list.findIndex(x=>x.id===id);if(i>=0)list.splice(i,1);}
