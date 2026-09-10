const DB_NAME='neon_ops_phase9a';
const DB_VERSION=1;
const STORE='eventAvatar';

let dbPromise=null;
function openDb(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'eventId'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  return dbPromise;
}
function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'));});}

export async function putEventAvatar(eventId,file,meta={}){
  if(!eventId||!file)return null;
  const db=await openDb(),tx=db.transaction(STORE,'readwrite');
  const rec={eventId:String(eventId),blob:file,name:file.name||'event-avatar',type:file.type||'application/octet-stream',size:Number(file.size)||0,updatedAt:new Date().toISOString(),priority:Number(meta.priority)||50};
  tx.objectStore(STORE).put(rec);await txDone(tx);return rec;
}
export async function getEventAvatar(eventId){
  if(!eventId)return null;const db=await openDb();return new Promise((resolve,reject)=>{const req=db.transaction(STORE,'readonly').objectStore(STORE).get(String(eventId));req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});
}
export async function listEventAvatars(){
  const db=await openDb();return new Promise((resolve,reject)=>{const req=db.transaction(STORE,'readonly').objectStore(STORE).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});
}
export async function deleteEventAvatar(eventId){
  if(!eventId)return;const db=await openDb(),tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(String(eventId));await txDone(tx);
}
export function objectUrl(rec){return rec?.blob?URL.createObjectURL(rec.blob):null;}
