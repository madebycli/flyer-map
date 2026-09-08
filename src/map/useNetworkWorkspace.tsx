import { useEffect,useMemo,useState } from 'react';
import type { AccessInfo } from '../data/campaignApi.ts';
import type { Area,CampaignSnapshot,DistributionTask,LngLat,TaskStatus } from '../domain/campaign.ts';
import { RoadIndex,networkRoutes,networkProgress,applyNetworkCoverage,type NetworkRoute,type RoadSnap } from '../domain/streetNetwork.ts';
import { enqueueNetworkIntent,flushNetworkIntents,queuedNetworkIntents,discardNetworkIntent } from '../data/networkIntentQueue.ts';
import type { NetworkIntent } from '../../worker/streetNetwork/api.ts';

export function useNetworkWorkspace(snapshot:CampaignSnapshot,access:AccessInfo|null,refresh:()=>Promise<unknown>) {
  const [areaId,setAreaId]=useState<string|null>(null),[start,setStart]=useState<RoadSnap|null>(null),[end,setEnd]=useState<RoadSnap|null>(null);
  const [routes,setRoutes]=useState<NetworkRoute[]>([]),[selected,setSelected]=useState<number|null>(null),[message,setMessage]=useState('');
  const [choices,setChoices]=useState<RoadSnap[]>([]),[pending,setPending]=useState<Awaited<ReturnType<typeof queuedNetworkIntents>>>([]);
  const [preparing,setPreparing]=useState<string|null>(null);
  const scope=[snapshot.campaign.id,access?.role,access?.teamId,access?.groupId??''].join(':');
  const tasks=useMemo(()=>snapshot.tasks.filter(task=>task.areaId===areaId&&task.network),[snapshot.tasks,areaId]);
  const index=useMemo(()=>new RoadIndex(tasks),[tasks]);
  useEffect(()=>{
    let stopped=false;
    const flush=async()=>{try{if(navigator.onLine)await flushNetworkIntents(scope,refresh);}catch{/* retry later */}if(!stopped)setPending(await queuedNetworkIntents(scope));};
    void flush();const timer=window.setInterval(()=>void flush(),5000);window.addEventListener('online',flush);
    return()=>{stopped=true;window.clearInterval(timer);window.removeEventListener('online',flush);};
  },[scope]);
  const reset=()=>{setStart(null);setEnd(null);setRoutes([]);setSelected(null);setChoices([]);setMessage('Tippe auf den Startpunkt A.');};
  const open=(id:string)=>{setAreaId(id);reset();};
  const accept=(snap:RoadSnap)=>{
    setChoices([]);
    if(!start||end){setStart(snap);setEnd(null);setRoutes([]);setSelected(null);setMessage('Tippe auf den Endpunkt B.');return;}
    setEnd(snap);
    try{const found=networkRoutes(tasks,start,snap);setRoutes(found);setSelected(found.length===1?0:null);setMessage(found.length?'Prüfe die Vorschau und wähle einen Status.':'Keine Verbindung. Bitte neu auswählen.');}
    catch{setRoutes([]);setMessage('Die Route ist zu mehrdeutig. Wähle einen kürzeren Abschnitt.');}
  };
  const onPoint=(point:LngLat,sourceIds:string[])=>{
    const candidates=index.candidates(point).filter(snap=>!sourceIds.length||sourceIds.includes(snap.task.id));
    if(!candidates.length){setMessage('Bitte näher auf eine vorbereitete Straße tippen.');return;}
    if(candidates[1]&&candidates[1].distance-candidates[0].distance<4){setChoices(candidates.slice(0,5));setMessage('Welche Straße meinst du?');return;}
    accept(candidates[0]);
  };
  const queue=async(intent:NetworkIntent)=>{
    await enqueueNetworkIntent(scope,snapshot.campaign.id,intent);setPending(await queuedNetworkIntents(scope));setMessage(navigator.onLine?'Wird gespeichert …':'Offline vorgemerkt. Wird bei Verbindung geprüft.');
    try{if(navigator.onLine)await flushNetworkIntents(scope,refresh);}catch{setMessage('Vorgemerkt. Erneuter Versuch bei Verbindung.');}
    setPending(await queuedNetworkIntents(scope));
  };
  const commit=async(status:TaskStatus)=>{
    if(!start||!end||selected===null||!areaId)return;
    await queue({id:`network_${crypto.randomUUID()}`,areaId,generation:start.task.areaPreparationGeneration!,start:{point:start.point,taskId:start.task.id},end:{point:end.point,taskId:end.task.id},selectedPath:routes[selected].ranges.map(range=>range.taskId),status});
    setStart(null);setEnd(null);setRoutes([]);setSelected(null);
  };
  const whole=(task:DistributionTask)=>{
    open(task.areaId);
    const localTasks=snapshot.tasks.filter(candidate=>candidate.areaId===task.areaId&&candidate.network);
    const localIndex=new RoadIndex(localTasks);
    const a=localIndex.candidates(task.geometry.coordinates[0]).find(s=>s.task.id===task.id),b=localIndex.candidates(task.geometry.coordinates.at(-1)!).find(s=>s.task.id===task.id);
    if(!a||!b)return;
    setStart(a);setEnd(b);
    try{const found=networkRoutes(localTasks,a,b);setRoutes(found);const choice=found.findIndex(route=>route.ranges.length===1&&route.ranges[0].taskId===task.id);setSelected(choice<0?null:choice);setMessage('Nur diesen Straßenabschnitt markieren. Prüfe die Vorschau.');}catch{setMessage('Bitte A/B innerhalb dieses Abschnitts wählen.');}
  };
  const prepare=async(area:Area)=>{
    if(preparing)return;setPreparing(area.id);setMessage('Straßen und Häuser werden vorbereitet …');
    try{
      for(let step=0;step<1100;step++){
        const response=await fetch(`/api/campaigns/${encodeURIComponent(snapshot.campaign.id)}/areas/${encodeURIComponent(area.id)}/preparation`,{method:'POST',credentials:'same-origin'});
        const state=await response.json();
        if(!response.ok)throw new Error('Vorbereitung derzeit nicht verfügbar. Bitte später erneut versuchen.');
        if(state.status==='ready'){await refresh();setMessage('Straßen und Häuser sind bereit.');return;}
        if(state.status==='failed')throw new Error('Vorbereitung unterbrochen. Erneut versuchen setzt die Arbeit fort.');
        await new Promise(resolve=>window.setTimeout(resolve,2000));
      }
    }catch(error){setMessage(error instanceof Error?error.message:'Vorbereitung fehlgeschlagen.');}finally{setPreparing(null);}
  };
  const optimistic=useMemo(()=>{
    let result=snapshot;
    for(const item of pending){
      if(item.blocked)continue;
      const intent=item.intent;
      const roads=result.tasks.filter(task=>task.areaId===intent.areaId&&task.areaPreparationGeneration===intent.generation&&task.network);
      const spatial=new RoadIndex(roads);
      const a=spatial.candidates(intent.start.point).find(snap=>snap.task.id===intent.start.taskId),b=spatial.candidates(intent.end.point).find(snap=>snap.task.id===intent.end.taskId);
      if(!a||!b)continue;
      try{const route=networkRoutes(roads,a,b).find(route=>JSON.stringify(route.ranges.map(range=>range.taskId))===JSON.stringify(intent.selectedPath));if(route)result={...result,...applyNetworkCoverage(result.tasks,result.houseTasks??[],route.ranges,intent.status,new Date(item.enqueuedAt).toISOString())};}catch{/* surface conflict after canonical validation */}
    }
    return result;
  },[snapshot,pending]);
  const activeRoute=selected!==null&&selected>=0?routes[selected]:null;
  const panel=areaId?<section className="mode-sheet" aria-label="Straßenabschnitt markieren">
    <strong>Straßenabschnitt markieren</strong><p role="status">{message}</p>
    {choices.map(choice=><button className="button secondary" key={choice.task.id} onClick={()=>accept(choice)}>{choice.task.label}</button>)}
    {routes.length>1?<div className="mode-actions">{routes.map((route,i)=><button className={`button ${selected===i?'primary':'secondary'}`} key={i} onClick={()=>setSelected(i)}>Route {i+1} · {route.ranges.length} Abschnitte</button>)}</div>:null}
    <div className="mode-actions">{(['completed','later','not-deliverable','open'] as const).map((status,i)=><button className="button secondary" key={status} disabled={!activeRoute} onClick={()=>void commit(status)}>{['Erledigt','Später','Nicht zustellbar','Wieder öffnen'][i]}</button>)}</div>
    <div className="mode-actions"><button className="button secondary" onClick={reset}>A/B neu wählen</button><button className="button secondary" onClick={()=>setAreaId(null)}>Schließen</button></div>
    {pending.map(item=><p key={item.key}>{item.blocked?'Änderung braucht eine neue Auswahl.':'Änderung vorgemerkt.'} <button onClick={()=>void discardNetworkIntent(item.key).then(async()=>setPending(await queuedNetworkIntents(scope)))}>Verwerfen</button></p>)}
  </section>:null;
  const areaActions=(area:Area,editable:boolean)=>{
    const roads=optimistic.tasks.filter(task=>task.areaId===area.id),houses=(optimistic.houseTasks??[]).filter(house=>house.areaId===area.id);
    const progress=networkProgress(roads,houses);
    return <div><p>{Math.round(progress.percent)} % erledigt{houses.length?` · ${houses.filter(house=>house.status==='completed').length} von ${houses.length} Häusern`:''}</p>
      {editable?<button className="button primary full-width" disabled={Boolean(preparing)} onClick={()=>roads.some(task=>task.network)?open(area.id):void prepare(area)}>{preparing===area.id?'Vorbereitung läuft …':roads.some(task=>task.network)?'Straßen bearbeiten':'Straßen und Häuser vorbereiten'}</button>:null}
      {!areaId&&message?<p role="status">{message}</p>:null}</div>;
  };
  return {optimistic,active:Boolean(areaId),panel,areaActions,whole,mapProps:{smartRoads:tasks.map(task=>({sourceId:task.id,osmId:task.source?.objectIds[0]??0,name:task.label,ref:null,highway:'residential',geometry:task.geometry})),smartSelectedSourceIds:[],smartStartAnchor:start?{sourceId:start.task.id,snapped:start.point,segmentIndex:0,segmentT:0,distanceMeters:start.distance}:null,smartEndAnchor:end?{sourceId:end.task.id,snapped:end.point,segmentIndex:0,segmentT:0,distanceMeters:end.distance}:null,smartPreviewGeometry:activeRoute?.geometry??null,smartStreetColor:'#16a34a',onSmartStreetPoint:onPoint}};
}
