export const state={user:null,events:[],tasks:[],fitness:{movements:[],sessions:[]},finance:{settings:{currency:'SGD',startingBalance:0,portfolioCash:0,cashUpColor:'#2fd69a',cashDownColor:'#ff405c'},transactions:[],positions:[],journal:[]},integrations:{},taskFilter:'active'};
export function upsert(list,item){const i=list.findIndex(x=>x.id===item.id);if(i>=0)list[i]=item;else list.push(item);return item;}
export function remove(list,id){const i=list.findIndex(x=>x.id===id);if(i>=0)list.splice(i,1);}
