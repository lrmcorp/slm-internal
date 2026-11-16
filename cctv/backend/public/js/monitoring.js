(() => {
 const cards=new Map([...document.querySelectorAll('[data-camera-id]')].map(card=>[Number(card.dataset.cameraId),{card,hls:null,retryAt:0,url:null,busy:false}]));
 const feed=document.getElementById('invoice-feed'),time=document.getElementById('dashboard-update-time');
 let polling=false,submitting=false;
 function video(item,id){
  const player=item.card.querySelector('[data-camera-video]');
  if(item.hls || player.dataset.started || Date.now()<item.retryAt) return;
  const src=`/cameras/${id}/live/stream.m3u8`;
  function failed(){item.retryAt=Date.now()+15000;item.hls?.destroy();item.hls=null;delete player.dataset.started;player.hidden=true;}
  if(window.Hls && Hls.isSupported()){
   const hls=new Hls({maxBufferLength:4,liveSyncDurationCount:2,liveMaxLatencyDurationCount:4,maxLiveSyncPlaybackRate:1.15});item.hls=hls;hls.attachMedia(player);hls.loadSource(src);
   hls.on(Hls.Events.MANIFEST_PARSED,()=>{player.hidden=false;item.card.querySelector('[data-media-summary]').textContent='Video langsung DVR · AI diproses terpisah';item.card.querySelector('[data-camera-frame]').hidden=true;item.card.querySelector('[data-camera-placeholder]').hidden=true;player.play().catch(()=>{});});
   hls.on(Hls.Events.ERROR,(_,data)=>{if(data.fatal)failed();});
  }else if(player.canPlayType('application/vnd.apple.mpegurl')){
   player.dataset.started='1';player.src=src;player.onloadeddata=()=>{player.hidden=false;item.card.querySelector('[data-media-summary]').textContent='Video langsung DVR · AI diproses terpisah';item.card.querySelector('[data-camera-frame]').hidden=true;item.card.querySelector('[data-camera-placeholder]').hidden=true;};player.onerror=failed;
  }
 }
 async function frame(item,id){
  const player=item.card.querySelector('[data-camera-video]');if(!player.hidden || item.busy)return;
  item.busy=true;
  try{
   const result=await fetch(`/cameras/${id}/live-frame`,{cache:'no-store'});if(!result.ok)throw Error();
   const when=Date.parse(result.headers.get('X-Frame-Time'));if(!Number.isFinite(when)||Date.now()-when>20000)throw Error();
   const image=item.card.querySelector('[data-camera-frame]'),url=URL.createObjectURL(await result.blob());
   if(item.url)URL.revokeObjectURL(item.url);item.url=url;image.src=url;
   image.hidden=!player.hidden;if(!image.hidden)item.card.querySelector('[data-media-summary]').textContent='Gambar terbaru · cadangan';item.card.querySelector('[data-camera-placeholder]').hidden=true;
  }catch(e){item.card.querySelector('[data-camera-placeholder] span').textContent='Gambar belum tersedia';}
  finally{item.busy=false;}
 }
 async function update(){
  if(document.hidden||polling)return;polling=true;
  try{
   const result=await fetch('/dashboard/state'+location.search,{cache:'no-store',headers:{Accept:'application/json'}});
   if(result.status===401||result.status===419){location.assign('/login');return;}if(!result.ok)throw Error();
   const state=await result.json();
   for(const [key,value] of Object.entries({...state.totals,online:state.cameras.filter(c=>c.online).length}))document.querySelectorAll(`[data-metric="${key}"]`).forEach(el=>el.textContent=value);
   if(feed&&!submitting&&!feed.contains(document.activeElement)&&!feed.querySelector('.pagination-wrap:hover')){
    if(feed.innerHTML!==state.invoices_html)feed.innerHTML=state.invoices_html;
   }
   if(time)time.textContent='Pembaruan terakhir: '+new Date(state.updated_at).toLocaleTimeString('id-ID',{timeZone:'Asia/Jakarta'})+' WIB · otomatis setiap 8 detik';
   const erpPill=document.getElementById('erp-health-pill'),erpLabel=document.getElementById('erp-health-label');
   if(erpPill&&state.erp_health){
    const h=state.erp_health;
    erpPill.className='badge erp-health-pill '+(h.status==='connected'?'good':(h.status==='degraded'?'warn':(h.status==='disconnected'?'bad':'')));
    erpPill.title=h.message||'';
    if(erpLabel)erpLabel.textContent='ERP SLM: '+(h.label||'Memeriksa...');
   }
   const erp=document.getElementById('erp-connection-status');
   if(erp){
    if(!state.erp_configured){erp.textContent='ERP belum dikonfigurasi. Invoice dan bukti disimpan di aplikasi; belum dikirim ke SLM.';}
    else if(state.erp_health?.status==='connected'){erp.textContent='🟢 '+state.erp_health.message+' · Sinkronisasi otomatis siap mengirim invoice dan konfirmasi packing.';}
    else if(state.erp_health?.status==='disconnected'){erp.textContent='🔴 '+state.erp_health.message+' · Invoice tetap dicatat lokal dan otomatis dikirim saat server terhubung kembali.';}
    else if(state.erp_health?.status==='degraded'){erp.textContent='🟡 '+state.erp_health.message+' · Layanan ERP merespons dengan kendala.';}
    else{erp.textContent='Sinkronisasi otomatis tersedia. Status pengiriman terlihat pada setiap invoice.';}
   }
   for(const camera of state.cameras){
    const item=cards.get(camera.id);if(!item)continue;
    item.card.querySelector('[data-track-summary]').textContent=camera.online&&camera.detector_ready&&camera.fresh?`${camera.people_count} orang · ${camera.objects_count} objek`:(camera.detector_ready?'AI menunggu frame':'Model AI belum aktif');
    const badge=item.card.querySelector('[data-camera-badge]');badge.className='badge badge-dot '+(camera.online?'good':'bad');badge.textContent=camera.online?'Aktif':'Terhenti / belum aktif';
    item.card.querySelector('[data-camera-time]').textContent=camera.last_seen_at?new Date(camera.last_seen_at).toLocaleTimeString('id-ID',{timeZone:'Asia/Jakarta'})+' WIB':'Belum tersambung';
    if(camera.online&&camera.fresh){video(item,camera.id);void frame(item,camera.id);}
    else{item.card.querySelector('[data-media-summary]').textContent='Video belum tersedia';item.hls?.destroy();item.hls=null;const player=item.card.querySelector('[data-camera-video]');player.pause();player.hidden=true;delete player.dataset.started;item.card.querySelector('[data-camera-frame]').hidden=true;item.card.querySelector('[data-camera-placeholder]').hidden=false;item.card.querySelector('[data-camera-placeholder] span').textContent=camera.online?'Menunggu gambar terbaru':'Kamera belum aktif';}
   }
  }catch(e){
   if(time)time.textContent='Pembaruan terputus. Data terakhir belum diperbarui.';
   const erpPill=document.getElementById('erp-health-pill'),erpLabel=document.getElementById('erp-health-label');
   if(erpPill){erpPill.className='badge erp-health-pill bad';erpPill.title='Koneksi dashboard lokal terputus';}
   if(erpLabel)erpLabel.textContent='CCTV SLM: Terputus';
  }
  finally{polling=false;}
 }
 function notify(msg, type='info'){
  let toast=document.getElementById('cctv-toast');
  if(!toast){
   toast=document.createElement('div');toast.id='cctv-toast';
   toast.style.cssText='position:fixed;bottom:24px;right:24px;z-index:9999;background:var(--card-bg,#1e293b);color:var(--text-color,#f1f5f9);border:1px solid var(--border-color,#334155);border-radius:10px;padding:12px 18px;box-shadow:0 10px 30px rgba(0,0,0,0.35);font-size:14px;max-width:420px;display:flex;align-items:center;gap:10px;transition:opacity 0.3s ease;';
   document.body.appendChild(toast);
  }
  const icon=type==='error'?'❌':(type==='success'?'✅':'ℹ️');
  toast.innerHTML=`<span style="font-size:18px;">${icon}</span><span style="line-height:1.4;">${msg}</span>`;
  toast.style.opacity='1';toast.style.display='flex';
  clearTimeout(toast._timer);
  toast._timer=setTimeout(()=>{toast.style.opacity='0';setTimeout(()=>{toast.style.display='none';},300);},4500);
 }
 document.addEventListener('submit',async event=>{
  const form=event.target;if(!form.matches('[data-packing-form],[data-sync-form]'))return;event.preventDefault();if(submitting)return;submitting=true;
  const button=form.querySelector('button');
  const originalHtml=button?button.innerHTML:'';
  if(button){button.disabled=true;button.innerHTML='⏳ Memproses...';}
  try{
   const result=await fetch(form.action,{method:'POST',body:new FormData(form),headers:{Accept:'application/json'}});
   const data=await result.json().catch(()=>({}));
   if(!result.ok)throw Error(data.message||'Gagal memproses permintaan.');
   notify(data.message||'Berhasil diproses.','success');
  }
  catch(e){notify(e.message||'Terjadi kendala.','error');}
  finally{
   submitting=false;
   if(button){button.disabled=false;button.innerHTML=originalHtml;button.blur();}
   void update();
  }
 });
 document.querySelectorAll('[data-grid]').forEach(button=>button.addEventListener('click',()=>{document.getElementById('camera-wall').dataset.columns=button.dataset.grid;document.querySelectorAll('[data-grid]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));}));
 document.querySelectorAll('[data-camera-fullscreen]').forEach(button=>button.addEventListener('click',async()=>{const tile=button.closest('[data-camera-id]');try{if(document.fullscreenElement)await document.exitFullscreen();else await tile.requestFullscreen();}catch(e){location.assign('/cameras/'+tile.dataset.cameraId);}}));
 update();setInterval(update,8000);
 window.addEventListener('pagehide',()=>{for(const item of cards.values()){item.hls?.destroy();if(item.url)URL.revokeObjectURL(item.url);}});
})();
