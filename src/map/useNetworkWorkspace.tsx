import { useEffect,useMemo,useState } from 'react';
import type { AccessInfo, AreaPreparationPublicState } from '../data/campaignApi.ts';
import type { Area,CampaignSnapshot,DistributionTask,LngLat,TaskStatus } from '../domain/campaign.ts';
import { RoadIndex,networkRoutes,networkProgress,applyNetworkCoverage,type NetworkRoute,type RoadSnap } from '../domain/streetNetwork.ts';
import { enqueueNetworkIntent,flushNetworkIntents,queuedNetworkIntents,discardNetworkIntent } from '../data/networkIntentQueue.ts';
import type { NetworkIntent } from '../../worker/streetNetwork/api.ts';
import { AREA_PREPARATION_POLL_INTERVAL_MS } from '../areaPreparation/preparationPolling.ts';

export function useNetworkWorkspace(snapshot:CampaignSnapshot,access:AccessInfo|null,refresh:()=>Promise<unknown>,canMark:(area:Area)=>boolean) {
  const [marking,setMarking]=useState(false);
  const [states,setStates]=useState<Record<string,AreaPreparationPublicState>>({});
  const [areaId,setAreaId]=useState<string|null>(null),[start,setStart]=useState<RoadSnap|null>(null),[end,setEnd]=useState<RoadSnap|null>(null);
  const [routes,setRoutes]=useState<NetworkRoute[]>([]),[selected,setSelected]=useState<number|null>(null),[message,setMessage]=useState('');
  const [choices,setChoices]=useState<RoadSnap[]>([]),[pending,setPending]=useState<Awaited<ReturnType<typeof queuedNetworkIntents>>>([]);
  const [preparing,setPreparing]=useState<string|null>(null);
  const scope=[snapshot.campaign.id,access?.role,access?.teamId,access?.groupId??''].join(':');
  useEffect(()=>{setAreaId(null);setMarking(false);setPending([]);setPreparing(null);setStates({});},[scope]);
  const permittedAreas=snapshot.areas.filter(canMark);
  const permittedIds=permittedAreas.map(area=>area.id+':'+area.updatedAt).sort().join('|');
  const tasks=useMemo(()=>snapshot.tasks.filter(task=>(!areaId||task.areaId===areaId)&&task.network&&permittedAreas.some(area=>area.id===task.areaId)),[snapshot.tasks,areaId,permittedIds]);
  const index=useMemo(()=>new RoadIndex(tasks),[tasks]);
  useEffect(()=>{
    let stopped=false;
    const flush=async()=>{try{if(navigator.onLine)await flushNetworkIntents(scope,refresh);}catch{/* retry later */}if(!stopped)setPending(await queuedNetworkIntents(scope));};
    void flush();const timer=window.setInterval(()=>void flush(),5000);window.addEventListener('online',flush);
    return()=>{stopped=true;window.clearInterval(timer);window.removeEventListener('online',flush);};
  },[scope]);
  const reset=()=>{setStart(null);setEnd(null);setRoutes([]);setSelected(null);setChoices([]);setMessage('Tippe auf den Startpunkt A.');};
  const open=(id:string|null)=>{setMarking(true);setAreaId(id);reset();};
  const accept=(snap:RoadSnap)=>{
    setChoices([]);
    setAreaId(snap.task.areaId);
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
    try{await queue({id:`network_${crypto.randomUUID()}`,areaId,generation:start.task.areaPreparationGeneration!,start:{point:start.point,taskId:start.task.id},end:{point:end.point,taskId:end.task.id},selectedPath:routes[selected].ranges.map(range=>range.taskId),status});}catch{setMessage('Änderung konnte auf diesem Gerät nicht gespeichert werden. Bitte erneut versuchen.');return;}
    setStart(null);setEnd(null);setRoutes([]);setSelected(null);setAreaId(null);setMessage('Gespeichert oder vorgemerkt. Tippe auf den nächsten Startpunkt A.');
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
  const preparationUrl=(id:string)=>`/api/campaigns/${encodeURIComponent(snapshot.campaign.id)}/areas/${encodeURIComponent(id)}/preparation`;
  useEffect(()=>{
    let stopped=false;
    let timer:number|undefined;
    const known:Record<string,AreaPreparationPublicState>={};
    let reading=false;
    const acceptState=(id:string,state:AreaPreparationPublicState)=>{
      if(stopped||!permittedAreas.some(area=>area.id===id))return;
      if(known[id]?.updatedAt&&state.updatedAt&&known[id].updatedAt!>state.updatedAt)return;
      const prior=known[id];known[id]=state;setStates(current=>({...current,[id]:state}));
      if(state.status==='ready'&&(!prior||prior.status==='pending'))void refresh();
      if(state.status==='pending'&&!reading&&timer===undefined)schedulePoll();
    };
    const onProgress=(event:Event)=>{const value=(event as CustomEvent).detail;if(value?.campaignId===snapshot.campaign.id&&value.state)acceptState(value.areaId,value.state);};
    window.addEventListener('campaign-preparation',onProgress);
    const schedulePoll=()=>{if(!stopped&&timer===undefined)timer=window.setTimeout(()=>void poll(),AREA_PREPARATION_POLL_INTERVAL_MS);};
    const poll=async()=>{
      timer=undefined;
      if(reading)return;reading=true;
      for(const area of permittedAreas){
        if(stopped)return;
        if(known[area.id] && known[area.id].status!=='pending')continue;
        try{
          const response=await fetch(preparationUrl(area.id),{credentials:'same-origin',signal:AbortSignal.timeout(10000)});
          if(!response.ok)continue;
          const state=await response.json() as AreaPreparationPublicState;
          if(stopped)return;
          acceptState(area.id,state);
        }catch{/* A later read retries transport errors without creating jobs. */}
      }
      reading=false;
      if(!stopped&&permittedAreas.some(area=>!known[area.id]||known[area.id].status==='pending'))schedulePoll();
    };
    void poll();
    return()=>{stopped=true;window.removeEventListener('campaign-preparation',onProgress);if(timer!==undefined)window.clearTimeout(timer);};
  },[scope,permittedIds,preparing]);
  const prepare=async(area:Area)=>{
    if(preparing)return;
    setPreparing(area.id);setMessage('');
    try{
      const response=await fetch(preparationUrl(area.id),{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(25000)});
      if(!response.ok)throw new Error(`Vorbereitung derzeit nicht verfügbar (HTTP ${response.status}).`);
      const state=await response.json() as AreaPreparationPublicState;
      setStates(current=>({...current,[area.id]:state}));
      setMessage('');
    }catch(error){setMessage(error instanceof Error?error.message:'Vorbereitung fehlgeschlagen.');}
    finally{setPreparing(null);}
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
  const closeMarking=()=>{setAreaId(null);setMarking(false);reset()};
  const discard=async(key:string)=>{await discardNetworkIntent(key);setPending(await queuedNetworkIntents(scope));};
  const panelState=marking?{message,choices,routes,selected,activeRoute,pending:pending.map(item=>({key:item.key,blocked:Boolean(item.blocked)})),onChoice:accept,onRouteSelect:(index:number)=>setSelected(index),onCommit:commit,onReset:reset,onClose:closeMarking,onDiscard:discard}:null;
  const areaActions=(area:Area,editable:boolean,canMark:boolean)=>{
    const roads=optimistic.tasks.filter(task=>task.areaId===area.id),houses=(optimistic.houseTasks??[]).filter(house=>house.areaId===area.id);
    const progress=networkProgress(roads,houses);
    const state=states[area.id];
    const running=state?.status==='pending';
    const phaseLabel=({roads:'Straßen laden',graph:'Straßennetz aufbauen',buildings:'Gebäude laden',addresses:'Adressen prüfen',link:'Häuser zuordnen',publish:'Speichern',ready:'Bereit'} as Record<string,string>)[state?.progress?.phase??'']??'Vorbereitung';
    return <div className="area-actions-content">
      <p className="area-preparation-summary">{Math.round(progress.percent) + " % erledigt" + (houses.length ? " · " + houses.filter(house=>house.status==='completed').length + " von " + houses.length + " Häusern" : "")}</p>
      {(roads.some(task=>task.network)?canMark:editable)?<button className="button primary full-width" disabled={Boolean(preparing)||running} onClick={()=>roads.some(task=>task.network)?open(area.id):void prepare(area)}>{preparing===area.id||running?'Vorbereitung läuft …':roads.some(task=>task.network)?'Straßen bearbeiten':'Straßen und Häuser vorbereiten'}</button>:null}
      {state?.progress && running?<div className="area-preparation-progress" role="status">
        <div className="area-preparation-progress-header"><strong>{state.progress.percent} %</strong><span>{phaseLabel}</span></div>
        <progress max={100} value={state.progress.percent} aria-label="Vorbereitung" />
        <p>Straßen-Tiles {state.progress.completedRoadTiles}/{state.progress.totalTiles} · Gebäude-Tiles {state.progress.completedBuildingTiles}/{state.progress.totalTiles} · {state.progress.processedBuildings}/{state.progress.totalBuildings} Gebäude · {state.houseCount} Häuser</p>
      </div>:null}
      {state?.status==='failed'?<p role="alert">Vorbereitung fehlgeschlagen. Erneut versuchen setzt den gespeicherten Job fort.</p>:null}
      {!marking&&message?<p role="status">{message}</p>:null}
    </div>;
  };
  return {optimistic,open,available:permittedAreas.some(area=>snapshot.tasks.some(task=>task.areaId===area.id&&task.network)),active:marking,panelState,areaActions,whole,mapProps:{smartRoads:tasks.map(task=>({sourceId:task.id,osmId:task.source?.objectIds[0]??0,name:task.label,ref:null,highway:'residential',geometry:task.geometry})),smartSelectedSourceIds:[],smartStartAnchor:start?{sourceId:start.task.id,snapped:start.point,segmentIndex:0,segmentT:0,distanceMeters:start.distance}:null,smartEndAnchor:end?{sourceId:end.task.id,snapped:end.point,segmentIndex:0,segmentT:0,distanceMeters:end.distance}:null,smartPreviewGeometry:activeRoute?.geometry??null,smartStreetColor:'#7c3aed',onSmartStreetPoint:onPoint}};
}
