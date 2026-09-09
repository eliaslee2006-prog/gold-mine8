export const API_BASE='https://api.eliaslhx.com';
export async function api(path, options={}){
  const init={credentials:'include',headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})},...options};
  if(options.body && typeof options.body!=='string') init.body=JSON.stringify(options.body);
  const res=await fetch(`${API_BASE}${path}`,init);
  let data=null;try{data=await res.json();}catch{}
  if(!res.ok){const err=new Error(data?.error||`HTTP ${res.status}`);err.status=res.status;err.data=data;throw err;}
  return data;
}
export async function apiForm(path,form,options={}){
  const res=await fetch(`${API_BASE}${path}`,{credentials:'include',method:options.method||'POST',body:form,headers:options.headers||{}});
  let data=null;try{data=await res.json();}catch{}
  if(!res.ok){const err=new Error(data?.error||`HTTP ${res.status}`);err.status=res.status;err.data=data;throw err;}
  return data;
}
export async function apiBlob(path){
  const res=await fetch(`${API_BASE}${path}`,{credentials:'include'});if(!res.ok){let msg=`HTTP ${res.status}`;try{const d=await res.json();msg=d?.error||msg;}catch{}throw new Error(msg);}return res.blob();
}
export const connectGoogle=()=>location.assign(`${API_BASE}/auth/google?returnTo=${encodeURIComponent(location.href.split('?')[0])}`);
