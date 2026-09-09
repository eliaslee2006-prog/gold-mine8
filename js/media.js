import { api,API_BASE } from './api.js';
import { state } from './state.js';

const $=s=>document.querySelector(s);
let toast=()=>{},refreshTimer=null,progressTimer=null,lastPaintAt=0,seekBusy=false,refreshInFlight=false,spotifyCooldownUntil=0,lastLikeHydrateAt=0,lastLikeHydrateKey='',lastRecentLoadAt=0;
let sdkPlayer=null,sdkDeviceId='',sdkReady=false,sdkLoading=null,sdkActivated=false,selectedOutputId='';
let searchType='tracks',libraryTab='liked',likedOffset=0,likedLimit=50,playlistOffset=0,playlistLimit=24,queueMode='neon',selectedPlaylist=null;
let lastLyricsKey='',lyricsRequestSeq=0,syncedLyricLines=[],activeLyricIndex=-1;
const likedMap=new Map();
const MEDIA_CACHE_KEY='neon_ops_v9_8b_media_cache';
let mediaCache=loadMediaCache();
function loadMediaCache(){try{const x=JSON.parse(localStorage.getItem(MEDIA_CACHE_KEY)||'{}');return{liked:x.liked||null,playlistPage:x.playlistPage||null,neonQueue:Array.isArray(x.neonQueue)?x.neonQueue:[],lyricScale:Number(x.lyricScale)||90,likedSyncedAt:x.likedSyncedAt||null,playlistsSyncedAt:x.playlistsSyncedAt||null};}catch{return{liked:null,playlistPage:null,neonQueue:[],lyricScale:90,likedSyncedAt:null,playlistsSyncedAt:null}}}
function saveMediaCache(){localStorage.setItem(MEDIA_CACHE_KEY,JSON.stringify(mediaCache));}

const connected=()=>!!state.integrations?.spotify;
const fmtMs=ms=>{ms=Math.max(0,Number(ms)||0);const s=Math.floor(ms/1000),m=Math.floor(s/60);return `${m}:${String(s%60).padStart(2,'0')}`;};
const artOf=t=>t?.album?.images?.[0]?.url||null;
const artistOf=t=>(t?.artists||[]).map(a=>a.name).join(', ')||'—';
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const img=(url,alt='')=>url?`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">`:`<div class="media-thumb-fallback">SP</div>`;
const spotifyConnect=(force=false)=>location.assign(`${API_BASE}/auth/spotify?returnTo=${encodeURIComponent(location.href.split('#')[0])}${force?'&force=1':''}`);
const isLocalOutput=()=>!!sdkDeviceId&&selectedOutputId===sdkDeviceId;

export function initMedia(t){
  toast=t;
  $('#spotifyConnectBtn').onclick=()=>spotifyConnect(false);
  $('#spotifyReconnectBtn').onclick=()=>spotifyConnect(true);
  $('#spotifyScopeReconnectBtn').onclick=()=>spotifyConnect(true);
  $('#spotifyRefreshBtn').onclick=()=>refreshMedia(true);
  $('#spotifyDisconnectBtn').onclick=disconnect;
  $('#spotifyActivateBtn').onclick=activateLocalPlayer;
  $('#spotifyPrev').onclick=()=>controlTransport('previous');
  $('#spotifyNext').onclick=()=>controlTransport('next');
  $('#spotifyPlayPause').onclick=()=>controlTransport('toggle');
  $('#spotifyShuffle').onclick=()=>action('shuffle',{state:!state.media?.overview?.playback?.shuffleState});
  $('#spotifyRepeat').onclick=()=>{const x=state.media?.overview?.playback?.repeatState||'off',n=x==='off'?'context':x==='context'?'track':'off';action('repeat',{state:n});};
  $('#spotifyNowLiked').onclick=()=>{const uri=state.media?.overview?.playback?.item?.uri;if(uri)toggleLike(uri);};
  $('#spotifyDevice').onchange=async e=>{const id=e.target.value;if(!id)return;selectedOutputId=id;if(id===sdkDeviceId)await activateLocalPlayer();else await action('transfer',{deviceId:id,play:!!state.media?.overview?.playback?.isPlaying});};
  $('#spotifyVolume').oninput=e=>$('#spotifyVolumeValue').textContent=`${e.target.value}%`;
  $('#spotifyVolume').onchange=e=>setVolume(Number(e.target.value));
  $('#spotifyProgress').oninput=()=>{seekBusy=true;paintProgress(Number($('#spotifyProgress').value));};
  $('#spotifyProgress').onchange=e=>seekTo(Number(e.target.value));
  $('#spotifySearchForm').onsubmit=e=>{e.preventDefault();runSearch($('#spotifySearchInput').value);};
  document.querySelectorAll('[data-search-type]').forEach(b=>b.onclick=()=>{searchType=b.dataset.searchType;document.querySelectorAll('[data-search-type]').forEach(x=>x.classList.toggle('active',x===b));renderSearch();});
  document.querySelectorAll('[data-library-tab]').forEach(b=>b.onclick=()=>{libraryTab=b.dataset.libraryTab;selectedPlaylist=null;document.querySelectorAll('[data-library-tab]').forEach(x=>x.classList.toggle('active',x===b));if(libraryTab==='recent'){if(Date.now()-lastRecentLoadAt>120000)refreshMedia(false,{includeRecent:true});else renderLibrary();}else if(libraryTab==='liked'){restoreLikedCache();renderLibrary();}else loadLibrary(true);});
  $('#spotifyLibraryPrev').onclick=()=>pageLibrary(-1);
  $('#spotifyLibraryNext').onclick=()=>pageLibrary(1);
  $('#spotifyLibrarySync').onclick=()=>syncCurrentLibraryView();
  document.querySelectorAll('[data-queue-tab]').forEach(b=>b.onclick=()=>{queueMode=b.dataset.queueTab;document.querySelectorAll('[data-queue-tab]').forEach(x=>x.classList.toggle('active',x===b));renderQueue(state.media?.overview?.queue);});
  $('#spotifyNeonQueueStart').onclick=()=>startNeonQueue();
  $('#spotifyNeonQueueClear').onclick=()=>{mediaCache.neonQueue=[];saveMediaCache();renderQueue(state.media?.overview?.queue);};
  const scale=$('#lyricsScale');if(scale){scale.value=String(mediaCache.lyricScale);applyLyricScale(mediaCache.lyricScale);scale.oninput=e=>applyLyricScale(Number(e.target.value));scale.onchange=e=>{mediaCache.lyricScale=Number(e.target.value);saveMediaCache();};}
  restoreLikedCache();restorePlaylistCache();
  if(!progressTimer)progressTimer=setInterval(tickProgress,500);
  if(!refreshTimer)refreshTimer=setInterval(()=>{if($('#pageMedia')?.classList.contains('active'))refreshMedia(false);},30000);
  renderShell();
}

export async function refreshMedia(showToast=false,{includeRecent=false}={}){
  renderShell();
  if(!connected()){state.media={overview:null,loaded:true};render();return;}
  if(refreshInFlight)return;
  const now=Date.now();if(now<spotifyCooldownUntil){if(showToast)toast(`SPOTIFY COOLDOWN // ${Math.ceil((spotifyCooldownUntil-now)/1000)}s`,true);return;}
  refreshInFlight=true;const btn=$('#spotifyRefreshBtn');if(btn)btn.disabled=true;
  try{
    const needRecent=includeRecent||(!state.media?.overview?.recent&&libraryTab==='recent');
    const o=await api(`/api/v8/spotify/overview${needRecent?'?include=recent':''}`),prev=state.media?.overview||{};
    state.media={...(state.media||{}),overview:{...prev,...o,recent:o.recent??prev.recent},loaded:true};lastPaintAt=Date.now();render();
    if(o.nativeReady)ensureSdkPlayer().catch(e=>setNativeState(`SDK // ${e.message}`,'danger'));
    if(needRecent)lastRecentLoadAt=Date.now();
    if(libraryTab==='recent')renderLibrary();else if(libraryTab==='liked'){restoreLikedCache();renderLibrary();}else if(libraryTab==='playlists'&&!state.media?.playlistPage){restorePlaylistCache();renderLibrary();}
    state.media.quotaExceeded=false;
    if(showToast)toast('SPOTIFY REFRESHED');
  }catch(e){
    const m=String(e?.message||'');const retry=(m.match(/Retry after (\d+)s/i)||[])[1];
    if(e?.status===429||/rate limit|too many requests|quota exceeded/i.test(m)){spotifyCooldownUntil=Date.now()+Math.max(30,Number(retry)||60)*1000;if(/quota exceeded/i.test(m))state.media.quotaExceeded=true;}
    renderError(m);if(showToast)toast(m,true);
  }finally{refreshInFlight=false;if(btn)btn.disabled=false;}
}

function renderShell(){
  const c=connected();
  $('#spotifyStatus').textContent=c?'CONNECTED':'NOT CONNECTED';$('#spotifyStatus').dataset.state=c?'success':'warning';
  $('#spotifyConnectBtn').classList.toggle('hidden',c);$('#spotifyDisconnectBtn').classList.toggle('hidden',!c);$('#spotifyRefreshBtn').disabled=!c;
  $('#spotifyDisconnected').classList.toggle('hidden',c);$('#spotifyConnected').classList.toggle('hidden',!c);$('#spotifySearchInput').disabled=!c;
}

function render(){
  renderShell();const o=state.media?.overview;if(!o?.connected){clearMedia();return;}
  const p=o.playback?._error?null:o.playback,track=p?.item||null;
  $('#spotifyReconnectBtn').classList.toggle('hidden',!!o.nativeReady);
  $('#spotifyScopeWarning').classList.toggle('hidden',!!o.nativeReady);
  $('#spotifyProfileName').textContent=o.profile?.displayName||state.integrations?.spotify?.metadata?.displayName||'SPOTIFY USER';
  $('#spotifyPlan').textContent=(o.profile?.product||state.integrations?.spotify?.metadata?.product||'UNKNOWN').toUpperCase();
  $('#spotifyTrack').textContent=track?.name||'Nothing playing';$('#spotifyArtist').textContent=artistOf(track);$('#spotifyPlaybackState').textContent=p?.isPlaying?'PLAYBACK // LIVE':'PLAYBACK // PAUSED';
  const art=artOf(track);$('#spotifyArt').classList.toggle('hidden',!art);$('#spotifyArtFallback').classList.toggle('hidden',!!art);if(art)$('#spotifyArt').src=art;const src=$('#spotifyNowSource');src.classList.toggle('hidden',!track?.externalUrl);if(track?.externalUrl)src.href=track.externalUrl;
  $('#spotifyPlayPause').textContent=p?.isPlaying?'❚❚':'▶';$('#spotifyShuffle').classList.toggle('active',!!p?.shuffleState);$('#spotifyRepeat').classList.toggle('active',(p?.repeatState||'off')!=='off');$('#spotifyRepeat').title=`Repeat // ${(p?.repeatState||'off').toUpperCase()}`;
  const liked=track?.uri?likedMap.get(track.uri):false;$('#spotifyNowLiked').textContent=liked?'♥':'♡';$('#spotifyNowLiked').classList.toggle('liked',!!liked);$('#spotifyNowLiked').disabled=!track?.uri;
  renderDevices(o.devices,p);renderQueue(o.queue);lastPaintAt=Date.now();paintProgress();$('#spotifyLastRefresh').textContent=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  refreshLyricsForTrack(track);
  if(libraryTab==='recent')renderLibrary();
}


function lyricsKey(track){
  if(!track)return '';
  return [track.id||track.uri||'',track.name||'',artistOf(track),track.album?.name||'',Math.round((Number(track.durationMs)||0)/1000)].join('|');
}

function parseSyncedLyrics(raw){
  const lines=[];for(const line of String(raw||'').split(/\r?\n/)){const m=line.match(/^\s*\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);if(!m)continue;const frac=String(m[3]||'0'),ms=(Number(m[1])*60+Number(m[2]))*1000+Number(frac.padEnd(3,'0').slice(0,3));const text=(m[4]||'').trim();if(text)lines.push({ms,text});}return lines.sort((a,b)=>a.ms-b.ms);
}
function renderLyricDocument(data){
  const body=$('#lyricsBody');if(!body)return;syncedLyricLines=parseSyncedLyrics(data?.syncedLyrics);activeLyricIndex=-1;body.dataset.state='success';body.classList.toggle('timed',syncedLyricLines.length>0);
  const source=syncedLyricLines.length?syncedLyricLines.map((x,i)=>`<div class="media-lyric-line" data-lyric-index="${i}">${escapeHtml(x.text)}</div>`).join(''):String(data?.plainLyrics||'').split(/\r?\n/).filter(Boolean).map(x=>`<div class="media-lyric-line plain">${escapeHtml(x)}</div>`).join('');
  body.innerHTML=source||'<div class="media-lyric-line plain">Lyrics unavailable.</div>';updateActiveLyric(state.media?.overview?.playback?.progressMs||0,true);
}
function updateActiveLyric(ms,force=false){
  if(!syncedLyricLines.length)return;ms=Math.max(0,Number(ms)||0);let i=-1;for(let n=0;n<syncedLyricLines.length;n++){if(syncedLyricLines[n].ms<=ms)i=n;else break;}if(!force&&i===activeLyricIndex)return;activeLyricIndex=i;const body=$('#lyricsBody');body?.querySelectorAll('.media-lyric-line.current').forEach(x=>x.classList.remove('current'));if(i<0)return;const el=body?.querySelector(`[data-lyric-index="${i}"]`);if(el){el.classList.add('current');const top=Math.max(0,el.offsetTop-body.clientHeight/2+el.offsetHeight/2);body.scrollTo({top,behavior:force?'auto':'smooth'});}}
function setLyricsState(status,text,stateName=''){
  const statusEl=$('#lyricsStatus'),body=$('#lyricsBody');
  if(statusEl){statusEl.textContent=status||'LYRICS';statusEl.dataset.state=stateName||'';}
  if(body){body.textContent=text||'';body.dataset.state=stateName||'';body.classList.remove('timed');}
  syncedLyricLines=[];activeLyricIndex=-1;
}

async function refreshLyricsForTrack(track){
  if(!$('#lyricsBody'))return;
  if(!track){lastLyricsKey='';lyricsRequestSeq++;setLyricsState('NO TRACK','Start Spotify playback to load lyrics.');return;}
  const key=lyricsKey(track);if(key===lastLyricsKey)return;lastLyricsKey=key;const seq=++lyricsRequestSeq;
  setLyricsState('LOOKUP','Loading lyrics…','warning');
  const q=new URLSearchParams({track:track.name||'',artist:artistOf(track),album:track.album?.name||'',duration:String(Math.round((Number(track.durationMs)||0)/1000))});
  try{
    const d=await api('/api/v8/media/lyrics?'+q.toString());if(seq!==lyricsRequestSeq)return;
    if(!d?.found){setLyricsState('NOT FOUND','No lyrics were returned for this track.','warning');return;}
    if(d.instrumental){setLyricsState('INSTRUMENTAL','This track is marked instrumental.','success');return;}
    const text=String(d.plainLyrics||'').trim();
    if(!text){setLyricsState('UNAVAILABLE','Lyrics are unavailable for this track.','warning');return;}
    const statusEl=$('#lyricsStatus');if(statusEl){statusEl.textContent=d.syncedAvailable?'LYRICS // TIMED':'LYRICS // PLAIN';statusEl.dataset.state='success';}
    renderLyricDocument(d);
  }catch(e){
    if(seq!==lyricsRequestSeq)return;
    const retry=e?.status===429?' Lyrics provider is rate limited; retry shortly.':'';
    setLyricsState('LYRICS // ERROR',(e?.message||'Lyrics lookup failed.')+retry,'danger');
  }
}

async function loadSpotifySdk(){
  if(window.Spotify?.Player)return;
  if(sdkLoading)return sdkLoading;
  sdkLoading=new Promise((resolve,reject)=>{
    const old=window.onSpotifyWebPlaybackSDKReady;window.onSpotifyWebPlaybackSDKReady=()=>{try{old?.();}catch{}resolve();};
    const existing=document.querySelector('script[data-neon-spotify-sdk]');if(existing){const t=setInterval(()=>{if(window.Spotify?.Player){clearInterval(t);resolve();}},100);setTimeout(()=>{clearInterval(t);if(!window.Spotify?.Player)reject(new Error('Spotify SDK load timeout'));},10000);return;}
    const s=document.createElement('script');s.src='https://sdk.scdn.co/spotify-player.js';s.async=true;s.dataset.neonSpotifySdk='1';s.onerror=()=>reject(new Error('Spotify SDK failed to load'));document.head.appendChild(s);
  });
  return sdkLoading;
}

async function ensureSdkPlayer(){
  if(sdkPlayer)return sdkPlayer;const o=state.media?.overview;if(!o?.nativeReady)throw new Error('Reconnect Spotify for native playback permissions');
  setNativeState('SDK // LOADING','warning');await loadSpotifySdk();
  sdkPlayer=new Spotify.Player({name:'NEON OPS // WEB PLAYER',enableMediaSession:true,volume:.65,getOAuthToken:async cb=>{try{const d=await api('/api/v8/spotify/sdk-token');cb(d.accessToken);}catch(e){toast(e.message,true);}}});
  sdkPlayer.addListener('ready',({device_id})=>{sdkDeviceId=device_id;sdkReady=true;selectedOutputId=selectedOutputId||device_id;setNativeState('SDK // READY','success');renderDevices(state.media?.overview?.devices,state.media?.overview?.playback);});
  sdkPlayer.addListener('not_ready',()=>{sdkReady=false;setNativeState('SDK // OFFLINE','danger');});
  sdkPlayer.addListener('player_state_changed',s=>{if(!s)return;applySdkState(s);});
  sdkPlayer.addListener('initialization_error',({message})=>setNativeState(`SDK // ${message}`,'danger'));
  sdkPlayer.addListener('authentication_error',({message})=>setNativeState(`AUTH // ${message}`,'danger'));
  sdkPlayer.addListener('account_error',({message})=>setNativeState(`PREMIUM // ${message}`,'danger'));
  sdkPlayer.addListener('playback_error',({message})=>{setNativeState('SDK // PLAYBACK ERROR','danger');toast(message,true);});
  sdkPlayer.addListener('autoplay_failed',()=>{setNativeState('SDK // ACTIVATE REQUIRED','warning');toast('Tap ACTIVATE NEON PLAYER to allow browser audio');});
  const ok=await sdkPlayer.connect();if(!ok)throw new Error('Spotify SDK could not connect');return sdkPlayer;
}

function applySdkState(s){
  const p=state.media?.overview?.playback;if(!p)return;const t=s.track_window?.current_track;
  p.isPlaying=!s.paused;p.progressMs=s.position||0;lastPaintAt=Date.now();
  if(t){p.item={id:t.id||null,uri:t.uri||null,name:t.name||'Unknown',durationMs:t.duration_ms||s.duration||0,artists:(t.artists||[]).map(a=>({id:a.uri?.split(':').pop()||null,name:a.name})),album:{id:t.album?.uri?.split(':').pop()||null,name:t.album?.name||'',images:(t.album?.images||[]).map(x=>({url:x.url}))},externalUrl:null,type:'track'};}
  render();
}

async function activateLocalPlayer(){
  try{await ensureSdkPlayer();if(!sdkReady||!sdkDeviceId)throw new Error('Neon player is not ready yet');await sdkPlayer.activateElement();sdkActivated=true;selectedOutputId=sdkDeviceId;setNativeState('SDK // ACTIVE','success');await action('transfer',{deviceId:sdkDeviceId,play:!!state.media?.overview?.playback?.isPlaying},false);renderDevices(state.media?.overview?.devices,state.media?.overview?.playback);toast('NEON PLAYER ACTIVE');}catch(e){toast(e.message,true);}
}

function setNativeState(text,status='warning'){const el=$('#spotifyNativeState');if(!el)return;el.textContent=text;el.dataset.state=status;$('#spotifyActivateBtn').textContent=sdkActivated?'NEON PLAYER ACTIVE':'ACTIVATE NEON PLAYER';}

function renderDevices(devices,p){
  const list=Array.isArray(devices)?[...devices]:[];if(sdkReady&&sdkDeviceId&&!list.some(d=>d.id===sdkDeviceId))list.unshift({id:sdkDeviceId,name:'NEON OPS // WEB PLAYER',type:'BROWSER',isActive:false,isRestricted:false,volumePercent:Number($('#spotifyVolume')?.value||65),supportsVolume:true,local:true});
  const active=p?.device?.id||list.find(x=>x.isActive)?.id||'';if(!selectedOutputId||!list.some(x=>x.id===selectedOutputId))selectedOutputId=active||sdkDeviceId||list[0]?.id||'';
  const sel=$('#spotifyDevice');sel.innerHTML=list.length?list.map(d=>`<option value="${escapeHtml(d.id||'')}" ${d.id===selectedOutputId?'selected':''}>${escapeHtml(d.id===sdkDeviceId?'NEON OPS // WEB PLAYER':d.name)} // ${escapeHtml((d.id===sdkDeviceId?'BROWSER':d.type||'DEVICE').toUpperCase())}${d.isActive?' // ACTIVE':''}</option>`).join(''):'<option value="">NO OUTPUTS</option>';
  const d=list.find(x=>x.id===selectedOutputId)||p?.device||null;$('#spotifyActiveDevice').textContent=d?.id===sdkDeviceId?'NEON OPS WEB PLAYER':d?.name||'NONE';$('#spotifyDeviceMeta').textContent=d?`${d.id===sdkDeviceId?'BROWSER':(d.type||'DEVICE').toUpperCase()} // ${d.id===sdkDeviceId?(sdkReady?'READY':'STANDBY'):(d.isActive?'ACTIVE':'AVAILABLE')}${d.isRestricted?' // RESTRICTED':''}`:'NO ACTIVE OUTPUT';
  if(d?.id===sdkDeviceId&&sdkPlayer){sdkPlayer.getVolume().then(v=>{$('#spotifyVolume').value=Math.round(v*100);$('#spotifyVolumeValue').textContent=`${Math.round(v*100)}%`;}).catch(()=>{});}else{const v=d?.volumePercent;$('#spotifyVolume').disabled=v==null||d?.supportsVolume===false;$('#spotifyVolume').value=v??50;$('#spotifyVolumeValue').textContent=v==null?'—':`${v}%`;}
  if(sdkReady)setNativeState(sdkActivated?'SDK // ACTIVE':'SDK // READY','success');
}

async function controlTransport(which){
  try{
    if(isLocalOutput()&&sdkPlayer&&sdkReady){if(which==='toggle')await sdkPlayer.togglePlay();else if(which==='previous')await sdkPlayer.previousTrack();else if(which==='next')await sdkPlayer.nextTrack();setTimeout(()=>refreshMedia(false),350);return;}
    if(which==='toggle')await action(state.media?.overview?.playback?.isPlaying?'pause':'play');else await action(which);
  }catch(e){toast(e.message,true);}
}
async function setVolume(v){try{if(isLocalOutput()&&sdkPlayer&&sdkReady){await sdkPlayer.setVolume(Math.max(0,Math.min(1,v/100)));return;}await action('volume',{volumePercent:v,deviceId:selectedOutputId||undefined});}catch(e){toast(e.message,true);}}
async function seekTo(slider){const p=state.media?.overview?.playback,item=p?.item;if(!item?.durationMs)return;const ms=Math.round(slider/1000*item.durationMs);seekBusy=false;try{if(isLocalOutput()&&sdkPlayer&&sdkReady)await sdkPlayer.seek(ms);else await action('seek',{positionMs:ms,deviceId:selectedOutputId||undefined});}catch(e){toast(e.message,true);}}

async function runSearch(q){q=String(q||'').trim();if(!q)return;const meta=$('#spotifySearchMeta');meta.textContent='SEARCHING';meta.dataset.state='warning';try{const r=await api(`/api/v8/spotify/search?q=${encodeURIComponent(q)}&type=track,artist,album,playlist&limit=8`);state.media.search=r;(r.tracks||[]).forEach(t=>{if(t.uri)likedMap.set(t.uri,!!t.liked);});meta.textContent=`${(r.tracks?.length||0)+(r.artists?.length||0)+(r.albums?.length||0)+(r.playlists?.length||0)} RESULTS`;meta.dataset.state='success';renderSearch();}catch(e){meta.textContent='SEARCH ERROR';meta.dataset.state='danger';toast(e.message,true);}}

function renderSearch(){const r=state.media?.search,box=$('#spotifySearchResults');if(!r){box.innerHTML='<div class="media-empty">SEARCH THE SPOTIFY CATALOG WITHOUT LEAVING NEON OPS</div>';return;}const list=r[searchType]||[];if(!list.length){box.innerHTML='<div class="media-empty">NO RESULTS IN THIS CATEGORY</div>';return;}if(searchType==='tracks'){box.innerHTML=`<div class="media-list">${list.map((t,i)=>trackRow(t,i,{queue:true,like:true,source:true})).join('')}</div>`;}else{box.innerHTML=`<div class="media-search-grid">${list.map(x=>resourceCard(x,{fromSearch:true})).join('')}</div>`;}bindMediaActions(box);bindPlaylistBrowse(box);}

function resourceCard(x,{fromSearch=false}={}){const art=x.images?.[0]?.url||null,sub=x.type==='artist'?'ARTIST':x.type==='album'?`${(x.artists||[]).map(a=>a.name).join(', ')} // ${x.releaseDate||''}`:`${x.owner||'PLAYLIST'} // ${x.tracksTotal||0} ITEMS`;const playlistAction=x.type==='playlist'?(fromSearch||x.catalogOnly?`<button class="ghost" data-playlist-embed="${escapeHtml(x.id||'')}">OPEN</button>`:`<button class="ghost" data-playlist-browse="${escapeHtml(x.id||'')}">BROWSE</button>`):'';return `<article class="media-result-card"><div class="result-art">${img(art,x.name)}</div><div><b>${escapeHtml(x.name)}</b><small>${escapeHtml(sub)}</small></div><div class="result-actions"><button class="primary" data-media-action="play-context" data-uri="${escapeHtml(x.uri||'')}">▶ PLAY</button>${playlistAction}${x.externalUrl?`<a class="spotify-source-link" href="${escapeHtml(x.externalUrl)}" target="_blank" rel="noopener">SPOTIFY ↗</a>`:''}</div></article>`;}

function trackRow(t,i,{queue=false,like=false,source=false,added=false}={}){const liked=t.uri?(likedMap.has(t.uri)?likedMap.get(t.uri):!!t.liked):false;return `<div class="media-list-row"><span class="media-index">${String((i||0)+1).padStart(2,'0')}</span><span class="media-thumb">${img(artOf(t),t.name)}</span><span class="media-track-copy"><b>${escapeHtml(t.name)}</b><small>${escapeHtml(artistOf(t))}${added&&t.addedAt?` // SAVED ${escapeHtml(new Date(t.addedAt).toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}))}`:''}</small><span class="media-row-actions"><button class="primary" data-media-action="play-track" data-uri="${escapeHtml(t.uri||'')}">PLAY</button>${queue?`<button class="ghost" data-media-action="queue" data-uri="${escapeHtml(t.uri||'')}">QUEUE</button>`:''}${like?`<button class="ghost media-inline-like ${liked?'liked':''}" data-media-action="like" data-uri="${escapeHtml(t.uri||'')}" aria-label="Toggle Liked Songs">${liked?'♥':'♡'}</button>`:''}${source&&t.externalUrl?`<a class="spotify-source-link" href="${escapeHtml(t.externalUrl)}" target="_blank" rel="noopener">SPOTIFY ↗</a>`:''}</span></span><span class="media-duration">${fmtMs(t.durationMs)}</span></div>`;}

function renderQueue(q){const spotifyList=q&&!q._error?q.items||[]:[],neon=mediaCache.neonQueue||[],list=queueMode==='neon'?neon:spotifyList;$('#spotifyQueueCount').textContent=`${list.length} ITEMS`;$('#spotifyNeonQueueStart').classList.toggle('hidden',queueMode!=='neon');$('#spotifyNeonQueueClear').classList.toggle('hidden',queueMode!=='neon');if(queueMode==='neon'){ $('#spotifyQueue').innerHTML=list.length?list.map((t,i)=>neonQueueRow(t,i)).join(''):'<div class="media-empty">ADD TRACKS FROM SEARCH, LIKED SONGS OR PLAYLISTS</div>';bindNeonQueueDrag(); }else{$('#spotifyQueue').innerHTML=list.length?list.map((t,i)=>trackRow(t,i,{like:true,source:true})).join(''):'<div class="media-empty">SPOTIFY QUEUE EMPTY / UNAVAILABLE</div>';bindMediaActions($('#spotifyQueue'));}}

async function loadLibrary(reset=false){if(!connected())return;if(reset){likedOffset=0;playlistOffset=0;selectedPlaylist=null;}const box=$('#spotifyLibrary');if(libraryTab==='liked'){restoreLikedCache();renderLibrary();return;}if(Date.now()<spotifyCooldownUntil){if(libraryTab==='playlists'&&state.media?.playlistPage){renderLibrary();return;}box.innerHTML=`<div class="media-empty">SPOTIFY COOLDOWN // RETRY IN ${Math.ceil((spotifyCooldownUntil-Date.now())/1000)}s</div>`;return;}box.innerHTML='<div class="media-empty">LOADING LIBRARY…</div>';try{
  if(libraryTab==='playlists'){state.media.playlistPage=await api(`/api/v8/spotify/playlists?limit=${playlistLimit}&offset=${playlistOffset}`);mediaCache.playlistPage=state.media.playlistPage;mediaCache.playlistsSyncedAt=new Date().toISOString();saveMediaCache();}
  state.media.libraryLoaded=true;renderLibrary();
}catch(e){handleSpotifyLimit(e);if(libraryTab==='playlists'&&state.media?.playlistPage)renderLibrary();else box.innerHTML=`<div class="media-empty">${escapeHtml(e.message||'Spotify request failed')}</div>`;toast(e.message,true);}}

async function syncCurrentLibraryView(){if(libraryTab==='liked')return syncLikedLibrary();if(libraryTab==='playlists')return loadLibrary(true);if(libraryTab==='recent')return refreshMedia(true,{includeRecent:true});}
async function syncLikedLibrary(){if(!connected())return;const btn=$('#spotifyLibrarySync'),box=$('#spotifyLibrary');if(Date.now()<spotifyCooldownUntil)return toast('SPOTIFY COOLDOWN ACTIVE',true);btn.disabled=true;box.innerHTML='<div class="media-empty">SYNCING A SINGLE 50-TRACK LIKED-SONGS PAGE…</div>';try{const r=await api('/api/v8/spotify/liked?limit=50&offset=0');state.media.liked=r;mediaCache.liked=r;mediaCache.likedSyncedAt=new Date().toISOString();saveMediaCache();(r.items||[]).forEach(t=>t.uri&&likedMap.set(t.uri,true));renderLibrary();toast('LIKED SONGS CACHE UPDATED');}catch(e){handleSpotifyLimit(e);restoreLikedCache();renderLibrary();toast(e.message,true);}finally{btn.disabled=false;}}
function restoreLikedCache(){if(!state.media)state.media={};if(!state.media.liked&&mediaCache.liked)state.media.liked=mediaCache.liked;(state.media.liked?.items||[]).forEach(t=>t.uri&&likedMap.set(t.uri,true));}
function restorePlaylistCache(){if(!state.media)state.media={};if(!state.media.playlistPage&&mediaCache.playlistPage)state.media.playlistPage=mediaCache.playlistPage;}
function handleSpotifyLimit(e){const m=String(e?.message||''),retry=(m.match(/Retry after (\d+)s/i)||[])[1];if(e?.status===429||/rate limit|too many requests|quota exceeded/i.test(m)){spotifyCooldownUntil=Date.now()+Math.max(30,Number(retry)||60)*1000;if(/quota exceeded/i.test(m))state.media.quotaExceeded=true;}}

function renderLibrary(){const box=$('#spotifyLibrary'),pager=$('#spotifyLibraryPager'),meta=$('#spotifyLibraryMeta'),note=$('#spotifyLibraryCacheNote');if(!box)return;
  note?.classList.toggle('hidden',libraryTab!=='liked');
  if(libraryTab==='liked'){const r=state.media?.liked||mediaCache.liked;if(!r){meta.textContent='CACHE EMPTY';box.innerHTML='<div class="media-empty">NO CACHED LIKED SONGS. USE SYNC VIEW ONCE SPOTIFY QUOTA IS AVAILABLE.</div>';pager.classList.add('hidden');return;}meta.textContent=`${r.items?.length||0} CACHED // ${mediaCache.likedSyncedAt?new Date(mediaCache.likedSyncedAt).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'UNKNOWN SYNC'}`;box.innerHTML=(r.items||[]).length?`<div class="media-list">${r.items.map((t,i)=>trackRow(t,i,{queue:true,like:true,source:true,added:true})).join('')}</div>`:'<div class="media-empty">NO LIKED SONGS RETURNED</div>';pager.classList.add('hidden');bindMediaActions(box);return;}
  if(libraryTab==='playlists'){if(selectedPlaylist){if(selectedPlaylist.embed){renderPlaylistEmbed(selectedPlaylist.playlist);return;}renderPlaylistDetail(selectedPlaylist);return;}const r=state.media?.playlistPage||mediaCache.playlistPage;if(!r){box.innerHTML='<div class="media-empty">PLAYLISTS NOT LOADED. PRESS SYNC VIEW.</div>';pager.classList.add('hidden');return;}meta.textContent=`${r.total||0} LISTS`;box.innerHTML=(r.items||[]).length?`<div class="playlist-library-grid">${r.items.map(p=>playlistCard(p)).join('')}</div>`:'<div class="media-empty">NO PLAYLISTS RETURNED</div>';pager.classList.remove('hidden');const a=r.total?Math.floor(r.offset/r.limit)+1:0,b=r.total?Math.ceil(r.total/r.limit):0;$('#spotifyLibraryPage').textContent=`PAGE ${a} / ${b}`;$('#spotifyLibraryPrev').disabled=!r.previous;$('#spotifyLibraryNext').disabled=!r.next;bindMediaActions(box);bindPlaylistBrowse(box);return;}
  const list=Array.isArray(state.media?.overview?.recent)?state.media.overview.recent:[];meta.textContent=`${list.length} RECENT`;pager.classList.add('hidden');box.innerHTML=list.length?`<div class="media-list">${list.map((t,i)=>trackRow(t,i,{queue:true,like:true,source:true})).join('')}</div>`:'<div class="media-empty">NO RECENT HISTORY RETURNED</div>';bindMediaActions(box);
}

function playlistCard(p){return `<article class="playlist-library-card"><div class="playlist-art">${img(p.images?.[0]?.url,p.name)}</div><div><b>${escapeHtml(p.name)}</b><small>${Number(p.tracksTotal)||0} ITEMS${p.owner?` // ${escapeHtml(p.owner)}`:''}</small></div><div class="result-actions"><button class="primary" data-media-action="play-context" data-uri="${escapeHtml(p.uri||'')}">▶ PLAY</button><button class="ghost" data-playlist-browse="${escapeHtml(p.id||'')}">BROWSE</button><button class="ghost" data-playlist-embed="${escapeHtml(p.id||'')}">EMBED</button>${p.externalUrl?`<a class="spotify-source-link" href="${escapeHtml(p.externalUrl)}" target="_blank" rel="noopener">SPOTIFY ↗</a>`:''}</div></article>`;}
async function pageLibrary(delta){if(libraryTab==='liked'){const r=state.media?.liked;if(!r)return;likedOffset=Math.max(0,likedOffset+delta*likedLimit);}else if(libraryTab==='playlists'){const r=state.media?.playlistPage;if(!r)return;playlistOffset=Math.max(0,playlistOffset+delta*playlistLimit);}else return;await loadLibrary(false);}

function bindMediaActions(root){root?.querySelectorAll('[data-media-action]').forEach(b=>b.onclick=async e=>{e.preventDefault();const a=b.dataset.mediaAction,uri=b.dataset.uri;if(!uri)return;try{if(a==='play-track')await playTrack(uri);else if(a==='play-context')await playContext(uri);else if(a==='play-context-track')await playContextTrack(b.dataset.contextUri,uri);else if(a==='queue')addNeonQueue(findTrackByUri(uri));else if(a==='like')await toggleLike(uri);}catch(err){toast(err.message,true);}});}
async function playTrack(uri){await ensureNativeForSelected();await action('play',{uris:[uri],deviceId:selectedOutputId||undefined});}
async function playContext(uri){await ensureNativeForSelected();await action('play',{contextUri:uri,deviceId:selectedOutputId||undefined});}
async function playContextTrack(contextUri,uri){await ensureNativeForSelected();await action('play',{contextUri,offsetUri:uri,deviceId:selectedOutputId||undefined});}
async function addQueue(uri){await action('queue',{uri,deviceId:selectedOutputId||undefined});toast('ADDED TO SPOTIFY QUEUE');}
async function ensureNativeForSelected(){if(selectedOutputId===sdkDeviceId&&sdkPlayer&&!sdkActivated){await sdkPlayer.activateElement();sdkActivated=true;setNativeState('SDK // ACTIVE','success');}}

async function toggleLike(uri){const current=!!likedMap.get(uri);try{await api('/api/v8/spotify/library',{method:'POST',body:{action:current?'remove':'save',uris:[uri]}});likedMap.set(uri,!current);syncLikedLocal(uri,!current);render();renderSearch();renderLibrary();toast(current?'REMOVED FROM LIKED SONGS':'ADDED TO LIKED SONGS');}catch(e){toast(e.message,true);}}
function syncLikedLocal(uri,value){const sets=[state.media?.search?.tracks,state.media?.liked?.items,state.media?.overview?.recent,state.media?.overview?.queue?.items];for(const list of sets){if(!Array.isArray(list))continue;const t=list.find(x=>x.uri===uri);if(t)t.liked=value;}if(!value&&Array.isArray(state.media?.liked?.items))state.media.liked.items=state.media.liked.items.filter(x=>x.uri!==uri);if(state.media?.liked){mediaCache.liked=state.media.liked;saveMediaCache();}}
async function hydrateLikes(){const o=state.media?.overview,uris=[];const add=t=>{if(t?.uri&&!uris.includes(t.uri))uris.push(t.uri);};add(o?.playback?.item);(o?.queue?.items||[]).forEach(add);(o?.recent||[]).forEach(add);(state.media?.search?.tracks||[]).forEach(add);if(!uris.length)return;const key=uris.slice(0,40).join(',');if(key===lastLikeHydrateKey&&Date.now()-lastLikeHydrateAt<120000)return;if(Date.now()<spotifyCooldownUntil)return;lastLikeHydrateKey=key;lastLikeHydrateAt=Date.now();try{const r=await api(`/api/v8/spotify/library/contains?uris=${encodeURIComponent(key)}`);Object.entries(r.contains||{}).forEach(([u,v])=>likedMap.set(u,!!v));renderLikeSurfaces();}catch(e){const m=String(e?.message||'');if(e?.status===429||/rate limit|too many requests|quota exceeded/i.test(m)){spotifyCooldownUntil=Date.now()+60000;if(/quota exceeded/i.test(m))state.media.quotaExceeded=true;}}}
function renderLikeSurfaces(){const t=state.media?.overview?.playback?.item,liked=t?.uri?!!likedMap.get(t.uri):false;$('#spotifyNowLiked').textContent=liked?'♥':'♡';$('#spotifyNowLiked').classList.toggle('liked',liked);renderQueue(state.media?.overview?.queue);if(state.media?.search)renderSearch();if(libraryTab==='recent'||libraryTab==='liked')renderLibrary();}


function applyLyricScale(v){v=Math.max(70,Math.min(130,Number(v)||90));document.documentElement.style.setProperty('--lyric-user-scale',String(v/100));const out=$('#lyricsScaleValue');if(out)out.textContent=`${v}%`;mediaCache.lyricScale=v;}
function findTrackByUri(uri){const pools=[state.media?.search?.tracks,state.media?.liked?.items,state.media?.overview?.recent,state.media?.overview?.queue?.items,selectedPlaylist?.items];for(const pool of pools){const x=Array.isArray(pool)?pool.find(t=>t?.uri===uri):null;if(x)return structuredClone(x);}return{uri,name:'Spotify Track',artists:[],album:{images:[]},durationMs:0};}
function addNeonQueue(track){if(!track?.uri)return;mediaCache.neonQueue=mediaCache.neonQueue||[];mediaCache.neonQueue.push(structuredClone(track));saveMediaCache();queueMode='neon';document.querySelectorAll('[data-queue-tab]').forEach(x=>x.classList.toggle('active',x.dataset.queueTab==='neon'));renderQueue(state.media?.overview?.queue);toast('ADDED TO NEON QUEUE');}
function neonQueueRow(t,i){return `<div class="media-list-row neon-queue-row" data-neon-index="${i}"><button class="queue-drag-handle" type="button" aria-label="Reorder track">⋮⋮</button><span class="media-thumb">${img(artOf(t),t.name)}</span><span class="media-track-copy"><b>${escapeHtml(t.name)}</b><small>${escapeHtml(artistOf(t))}</small><span class="media-row-actions"><button class="primary" data-media-action="play-track" data-uri="${escapeHtml(t.uri||'')}">PLAY</button><button class="ghost" data-neon-remove="${i}">REMOVE</button>${t.externalUrl?`<a class="spotify-source-link" href="${escapeHtml(t.externalUrl)}" target="_blank" rel="noopener">SPOTIFY ↗</a>`:''}</span></span><span class="media-duration">${fmtMs(t.durationMs)}</span></div>`;}
function bindNeonQueueDrag(){const box=$('#spotifyQueue');bindMediaActions(box);box?.querySelectorAll('[data-neon-remove]').forEach(b=>b.onclick=()=>{mediaCache.neonQueue.splice(Number(b.dataset.neonRemove),1);saveMediaCache();renderQueue(state.media?.overview?.queue);});box?.querySelectorAll('.queue-drag-handle').forEach(h=>h.onpointerdown=e=>startQueueDrag(e,h.closest('.neon-queue-row')));}
function startQueueDrag(e,row){if(!row)return;e.preventDefault();row.classList.add('dragging');const move=ev=>{const rows=[...$('#spotifyQueue').querySelectorAll('.neon-queue-row:not(.dragging)')],target=rows.find(r=>{const q=r.getBoundingClientRect();return ev.clientY<q.top+q.height/2;});if(target)$('#spotifyQueue').insertBefore(row,target);else $('#spotifyQueue').appendChild(row);};const up=()=>{row.classList.remove('dragging');const old=[...mediaCache.neonQueue],order=[...$('#spotifyQueue').querySelectorAll('.neon-queue-row')].map(r=>old[Number(r.dataset.neonIndex)]).filter(Boolean);mediaCache.neonQueue=order;saveMediaCache();window.removeEventListener('pointermove',move);renderQueue(state.media?.overview?.queue);};window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up,{once:true});}
async function startNeonQueue(){const uris=(mediaCache.neonQueue||[]).map(x=>x.uri).filter(Boolean).slice(0,50);if(!uris.length)return toast('NEON QUEUE IS EMPTY',true);try{await ensureNativeForSelected();await action('play',{uris,deviceId:selectedOutputId||undefined});toast(`NEON QUEUE STARTED // ${uris.length} TRACKS`);}catch(e){toast(e.message,true);}}
function bindPlaylistBrowse(root){root?.querySelectorAll('[data-playlist-browse]').forEach(b=>b.onclick=()=>openPlaylist(b.dataset.playlistBrowse));root?.querySelectorAll('[data-playlist-embed]').forEach(b=>b.onclick=()=>openPlaylistEmbed(b.dataset.playlistEmbed));}
async function openPlaylist(id){if(!id)return;const box=$('#spotifyLibrary'),known=[...(state.media?.playlistPage?.items||[]),...(state.media?.search?.playlists||[])].find(x=>x.id===id)||{id,name:'PLAYLIST',uri:`spotify:playlist:${id}`,owner:'',externalUrl:`https://open.spotify.com/playlist/${id}`};box.innerHTML='<div class="media-empty">LOADING PLAYLIST ITEMS…</div>';try{const d=await api(`/api/v8/spotify/playlists/${encodeURIComponent(id)}/items?limit=50&offset=0`);selectedPlaylist={...d,playlist:known};libraryTab='playlists';document.querySelectorAll('[data-library-tab]').forEach(x=>x.classList.toggle('active',x.dataset.libraryTab==='playlists'));renderLibrary();}catch(e){handleSpotifyLimit(e);if(e?.status===403||/own or collaborate|embedded spotify|playlist items restricted/i.test(String(e?.message||''))){openPlaylistEmbed(id,known);toast('PLAYLIST TRACK API RESTRICTED // OPENED SPOTIFY EMBED');return;}box.innerHTML=`<div class="media-empty">${escapeHtml(e.message||'Playlist items unavailable')}</div>`;toast(e.message,true);}}
function openPlaylistEmbed(id,known=null){if(!id)return;const p=known||[...(state.media?.playlistPage?.items||[]),...(state.media?.search?.playlists||[])].find(x=>x.id===id)||{id,name:'SPOTIFY PLAYLIST',owner:'',externalUrl:`https://open.spotify.com/playlist/${id}`};selectedPlaylist={embed:true,playlist:p};libraryTab='playlists';document.querySelectorAll('[data-library-tab]').forEach(x=>x.classList.toggle('active',x.dataset.libraryTab==='playlists'));renderLibrary();}
function renderPlaylistEmbed(p){const box=$('#spotifyLibrary'),pager=$('#spotifyLibraryPager');pager.classList.add('hidden');$('#spotifyLibraryMeta').textContent='SPOTIFY EMBED // NO WEB API TRACK QUOTA';const src=`https://open.spotify.com/embed/playlist/${encodeURIComponent(p.id)}?utm_source=generator&theme=0`;box.innerHTML=`<div class="playlist-detail-head"><button id="spotifyPlaylistBack" class="ghost small" type="button">← PLAYLISTS</button><div><b>${escapeHtml(p.name||'SPOTIFY PLAYLIST')}</b><small>${escapeHtml(p.owner||'CATALOG PLAYLIST')} // INTERACTIVE EMBED</small></div>${p.externalUrl?`<a class="spotify-source-link" href="${escapeHtml(p.externalUrl)}" target="_blank" rel="noopener">OPEN SPOTIFY ↗</a>`:''}</div><iframe class="spotify-playlist-embed" src="${src}" title="Spotify playlist ${escapeHtml(p.name||'playlist')}" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe><div class="media-empty playlist-embed-note">SEARCHED / FOLLOWED PLAYLIST TRACK LISTINGS ARE RESTRICTED BY SPOTIFY DEVELOPMENT MODE. THE EMBED REMAINS INTERACTIVE AND DOES NOT USE NEON'S WEB API PLAYLIST-ITEM QUOTA.</div>`;$('#spotifyPlaylistBack').onclick=()=>{selectedPlaylist=null;renderLibrary();};}

function renderPlaylistDetail(d){const box=$('#spotifyLibrary'),pager=$('#spotifyLibraryPager');pager.classList.add('hidden');$('#spotifyLibraryMeta').textContent=`${d.items?.length||0} / ${d.total||0} TRACKS`;box.innerHTML=`<div class="playlist-detail-head"><button id="spotifyPlaylistBack" class="ghost small" type="button">← PLAYLISTS</button><div><b>${escapeHtml(d.playlist?.name||'PLAYLIST')}</b><small>${escapeHtml(d.playlist?.owner||'')}</small></div><button class="primary small" data-media-action="play-context" data-uri="${escapeHtml(d.playlist?.uri||'')}">▶ PLAY ALL</button></div><div class="media-list">${(d.items||[]).map((t,i)=>playlistTrackRow(t,i,d.playlist?.uri||'')).join('')}</div>`;$('#spotifyPlaylistBack').onclick=()=>{selectedPlaylist=null;renderLibrary();};bindMediaActions(box);}
function playlistTrackRow(t,i,contextUri){return `<div class="media-list-row"><span class="media-index">${String(i+1).padStart(2,'0')}</span><span class="media-thumb">${img(artOf(t),t.name)}</span><span class="media-track-copy"><b>${escapeHtml(t.name)}</b><small>${escapeHtml(artistOf(t))}</small><span class="media-row-actions"><button class="primary" data-media-action="play-context-track" data-context-uri="${escapeHtml(contextUri)}" data-uri="${escapeHtml(t.uri||'')}">PLAY</button><button class="ghost" data-media-action="queue" data-uri="${escapeHtml(t.uri||'')}">QUEUE</button>${t.externalUrl?`<a class="spotify-source-link" href="${escapeHtml(t.externalUrl)}" target="_blank" rel="noopener">SPOTIFY ↗</a>`:''}</span></span><span class="media-duration">${fmtMs(t.durationMs)}</span></div>`;}

function paintProgress(forceValue=null){const p=state.media?.overview?.playback,item=p?.item;if(!item?.durationMs){$('#spotifyProgress').value=0;$('#spotifyElapsed').textContent='0:00';$('#spotifyDuration').textContent='0:00';return;}let ms=p.progressMs||0;if(forceValue==null&&p.isPlaying)ms+=Math.max(0,Date.now()-lastPaintAt);ms=Math.min(item.durationMs,ms);const ratio=forceValue==null?ms/item.durationMs:Number(forceValue)/1000,displayMs=ratio*item.durationMs;$('#spotifyProgress').value=Math.round(ratio*1000);$('#spotifyElapsed').textContent=fmtMs(displayMs);$('#spotifyDuration').textContent=fmtMs(item.durationMs);updateActiveLyric(displayMs);}
function tickProgress(){if(seekBusy)return;if($('#pageMedia')?.classList.contains('active'))paintProgress();}

async function action(actionName,extra={},doRefresh=true){if(!connected())return spotifyConnect();try{await api('/api/v8/spotify/player',{method:'POST',body:{action:actionName,...extra}});if(actionName==='pause'&&state.media?.overview?.playback)state.media.overview.playback.isPlaying=false;if(actionName==='play'&&state.media?.overview?.playback)state.media.overview.playback.isPlaying=true;if(doRefresh)setTimeout(()=>refreshMedia(false),400);return true;}catch(e){toast(e.message,true);throw e;}}
function clearMedia(){const q=$('#spotifyQueue');if(q){queueMode='neon';renderQueue(null);}const l=$('#spotifyLibrary');if(l){restoreLikedCache();renderLibrary();}$('#spotifySearchResults').innerHTML='<div class="media-empty">CONNECT SPOTIFY TO SEARCH</div>';$('#spotifyLibraryPager').classList.add('hidden');lastLyricsKey='';lyricsRequestSeq++;setLyricsState('NO TRACK','Connect Spotify and start playback to load lyrics.');}
function renderError(msg){$('#spotifyStatus').textContent='DEGRADED';$('#spotifyStatus').dataset.state='danger';$('#spotifyPlaybackState').textContent='SPOTIFY // ERROR';$('#spotifyTrack').textContent=msg||'Spotify request failed';}
async function disconnect(){if(!confirm('Disconnect Spotify from Neon Ops?'))return;try{sdkPlayer?.disconnect();sdkPlayer=null;sdkDeviceId='';sdkReady=false;sdkActivated=false;selectedOutputId='';await api('/api/v8/spotify',{method:'DELETE'});delete state.integrations.spotify;state.media={overview:null,loaded:true,quotaExceeded:false};likedMap.clear();renderShell();render();toast('SPOTIFY DISCONNECTED');}catch(e){toast(e.message,true);}}
