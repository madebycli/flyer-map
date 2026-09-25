import { preparationFailureMessage } from '../domain/preparationDiagnostics.ts';
import { useEffect,useMemo,useRef,useState } from 'react';
import type { AccessInfo, AreaPreparationPublicState } from '../data/campaignApi.ts';
import type { Area,CampaignSnapshot,DistributionTask,LngLat,TaskStatus } from '../domain/campaign.ts';
import { RoadIndex,networkRoutes,applyNetworkCoverage,type NetworkRoute,type RoadSnap } from '../domain/streetNetwork.ts';
import { SMART_POINT_FALLBACK_RADIUS_METERS,smartPointCandidates } from '../domain/smartStreetPointSelection.ts';
import { screenDistributionStreets,type StreetScreeningMode } from '../domain/streetScreening.ts';
import { enqueueNetworkIntent,flushNetworkIntents,queuedNetworkIntents,discardNetworkIntent } from '../data/networkIntentQueue.ts';
import { MAX_NETWORK_POINTS,joinNetworkRoutes,resolveNetworkIntent,networkSelectionState,type NetworkIntent } from '../domain/networkSelection.ts';
import { AREA_PREPARATION_POLL_INTERVAL_MS } from '../areaPreparation/preparationPolling.ts';


async function preparationRequestError(response:Response) {
  let code:string|null=null;
  try {
    const payload=await response.clone().json() as {error?:{code?:unknown}};
    code=typeof payload?.error?.code==='string'?payload.error.code:null;
  } catch {
  }
  if(response.status===404&&code==='area_not_found') {
    return 'Dieses lokale Gebiet ist nicht mehr im gemeinsamen Serverstand. Die Synchronisierung wird aktualisiert.';
  }
  return `Vorbereitung derzeit nicht verfügbar (HTTP ${response.status}${code?`, ${code}`:''}).`;
}

const SCREENING_STORAGE_PREFIX='verteil-flyer:street-screening:';
function readScreeningMode(campaignId:string):StreetScreeningMode {
  if(typeof window==='undefined')return 'classic';
  try{return window.localStorage?.getItem(SCREENING_STORAGE_PREFIX+campaignId)==='delivery-v2'?'delivery-v2':'classic';}catch{return 'classic';}
}
function writeScreeningMode(campaignId:string,mode:StreetScreeningMode) {
  if(typeof window==='undefined')return;
  try{window.localStorage?.setItem(SCREENING_STORAGE_PREFIX+campaignId,mode);}catch{/* private/iOS storage can be unavailable */}
}

export function useNetworkWorkspace(snapshot:CampaignSnapshot,access:AccessInfo|null,refresh:()=>Promise<unknown>,canMark:(area:Area)=>boolean) {
  const [marking,setMarking]=useState(false);
  const [states,setStates]=useState<Record<string,AreaPreparationPublicState>>({});
  const [areaId,setAreaId]=useState<string|null>(null);
  const [points,setPoints]=useState<RoadSnap[]>([]);
  const [legs,setLegs]=useState<{routes:NetworkRoute[];selected:number|null}[]>([]);
  const [selectionTasks,setSelectionTasks]=useState<DistributionTask[]|null>(null);
  const [pendingPoint,setPendingPoint]=useState<LngLat|null>(null);
  const [message,setMessage]=useState(''),[saving,setSaving]=useState(false);
  const [screeningMode,setScreeningMode]=useState<StreetScreeningMode>(()=>readScreeningMode(snapshot.campaign.id));
  const committing=useRef(false);
  const [choices,setChoices]=useState<RoadSnap[]>([]),[pending,setPending]=useState<Awaited<ReturnType<typeof queuedNetworkIntents>>>([]);
  const [preparing,setPreparing]=useState<string|null>(null),[preparationError,setPreparationError]=useState('');
  const scope=[snapshot.campaign.id,access?.role,access?.teamId,access?.groupId??''].join(':');
  useEffect(()=>{setAreaId(null);setMarking(false);setPending([]);setPreparing(null);setPreparationError('');setStates({});setScreeningMode(readScreeningMode(snapshot.campaign.id));reset();},[scope]);
  const permittedAreas=snapshot.areas.filter(canMark);
  const permittedIds=permittedAreas.map(area=>area.id+':'+area.updatedAt).sort().join('|');
  const fullOptimistic=useMemo(()=>{
    let result=snapshot;
    for(const item of pending){
      if(item.blocked)break;
      const intent=item.intent;
      const roads=result.tasks.filter(task=>task.areaId===intent.areaId&&task.areaPreparationGeneration===intent.generation&&task.network);
      try{const route=resolveNetworkIntent(roads,intent);result={...result,...applyNetworkCoverage(result.tasks,result.houseTasks??[],route.ranges,intent.status,new Date(item.enqueuedAt).toISOString())};}catch{break;}
    }
    return result;
  },[snapshot,pending]);
  const screening=useMemo(()=>screenDistributionStreets(fullOptimistic.tasks,fullOptimistic.houseTasks??[],screeningMode),[fullOptimistic.tasks,fullOptimistic.houseTasks,screeningMode]);
  const optimistic=useMemo(()=>({...fullOptimistic,tasks:screening.tasks}),[fullOptimistic,screening.tasks]);
  const tasks=useMemo(()=>(selectionTasks??fullOptimistic.tasks).filter(task=>(!areaId||task.areaId===areaId)&&task.network&&permittedAreas.some(area=>area.id===task.areaId)),[selectionTasks,fullOptimistic.tasks,areaId,permittedIds]);
  const index=useMemo(()=>new RoadIndex(tasks),[tasks]);
  useEffect(()=>{
    let stopped=false;
    const flush=async()=>{try{if(navigator.onLine)await flushNetworkIntents(scope,refresh);}catch{/* retry later */}if(!stopped)setPending(await queuedNetworkIntents(scope));};
    void flush();const timer=window.setInterval(()=>void flush(),5000);window.addEventListener('online',flush);
    return()=>{stopped=true;window.clearInterval(timer);window.removeEventListener('online',flush);};
  },[scope]);
  const reset=()=>{if(committing.current)return;setPoints([]);setLegs([]);setSelectionTasks(null);setPendingPoint(null);setChoices([]);setMessage('Wähle einen Straßenabschnitt auf der Karte.');};
  const open=(id:string|null)=>{if(committing.current)return;setMarking(true);setAreaId(id);reset();};
  const changeScreening=(mode:StreetScreeningMode)=>{setScreeningMode(mode);writeScreeningMode(snapshot.campaign.id,mode);};
  const lastLeg=legs.at(-1);
  const routes=lastLeg?.routes??[],selected=lastLeg?.selected??null;
  let preview:NetworkRoute|null=null;
  try{preview=joinNetworkRoutes(legs.flatMap(leg=>leg.selected===null?[]:[leg.routes[leg.selected]]));}catch{/* explicit budget below */}
  const activeRoute=!saving&&!pendingPoint&&legs.length>0&&legs.every(leg=>leg.selected!==null)?preview:null;
  const accept=(snap:RoadSnap)=>{
    if(committing.current||points.length>=MAX_NETWORK_POINTS)return;
    setChoices([]);setPendingPoint(null);setAreaId(snap.task.areaId);
    if(!points.length){setSelectionTasks(tasks);setPoints([snap]);setMessage('Punkt 1 gesetzt. Wähle jetzt den nächsten Punkt.');return;}
    try{
      const shortest=networkRoutes(tasks,points.at(-1)!,snap)[0];
      if(!shortest){setMessage('Kein Weg gefunden. Punkt wurde zurückgesetzt.');return;}
      setPoints([...points,snap]);
      setLegs([...legs,{routes:[shortest],selected:0}]);
      setMessage('Punkt gesetzt. Kürzester Weg übernommen. Weiteren Punkt setzen oder Status wählen.');
    }catch{setMessage('Kein sicherer Weg gefunden. Punkt wurde zurückgesetzt.');}
  };
  const onPoint=(point:LngLat,sourceIds:string[])=>{
    if(committing.current)return;
    if(points.length>=MAX_NETWORK_POINTS){setMessage(`Maximal ${MAX_NETWORK_POINTS} Punkte. Auswahl speichern oder rückgängig machen.`);return;}
    const rawCandidates=index.candidates(point,sourceIds.length?45:SMART_POINT_FALLBACK_RADIUS_METERS);
    const candidates=smartPointCandidates(rawCandidates,sourceIds);
    if(!candidates.length){setPendingPoint(null);setChoices([]);setMessage('Keine Straße gefunden. Punkt wurde zurückgesetzt.');return;}
    if(!points.length){accept(candidates[0]);return;}
    const from=points.at(-1)!;
    let best:{snap:RoadSnap;route:NetworkRoute}|null=null;
    for(const candidate of candidates.slice(0,8)){
      try{
        const route=networkRoutes(tasks,from,candidate)[0];
        if(!route)continue;
        if(!best||route.length<best.route.length-0.001||(Math.abs(route.length-best.route.length)<0.001&&(candidate.distance<best.snap.distance-0.001||(Math.abs(candidate.distance-best.snap.distance)<0.001&&candidate.task.id.localeCompare(best.snap.task.id)<0))))best={snap:candidate,route};
      }catch{/* another crossing candidate may still be routable */}
    }
    if(!best){setPendingPoint(null);setChoices([]);setMessage('Kein Weg gefunden. Punkt wurde zurückgesetzt.');return;}
    setChoices([]);setPendingPoint(null);setAreaId(best.snap.task.areaId);
    setPoints([...points,best.snap]);
    setLegs([...legs,{routes:[best.route],selected:0}]);
    setMessage('Punkt gesetzt. Kürzester Weg übernommen. Weiteren Punkt setzen oder Status wählen.');
  };
  const undo=()=>{
    if(committing.current)return;
    if(pendingPoint){setPendingPoint(null);setChoices([]);}
    else{setPoints(points.slice(0,-1));setLegs(legs.slice(0,-1));if(points.length<=1)setSelectionTasks(null);}
    setMessage('Letzter Punkt entfernt. Weiteren Punkt setzen oder Auswahl prüfen.');
  };
  const refreshPending=async()=>setPending(await queuedNetworkIntents(scope));
  const queue=async(intent:NetworkIntent)=>{
    await enqueueNetworkIntent(scope,snapshot.campaign.id,intent);
    await refreshPending();
    if(navigator.onLine){
      void (async()=>{
        try{await flushNetworkIntents(scope,refresh);}catch{/* periodic/online retry owns remote failures */}
        finally{await refreshPending();}
      })();
    }
  };
  const commit=async(status:TaskStatus)=>{
    if(committing.current||!activeRoute||!areaId)return;
    committing.current=true;setSaving(true);
    const anchor=(snap:RoadSnap)=>({point:snap.point,taskId:snap.task.id});
    try{
      await queue({id:`network_${crypto.randomUUID()}`,areaId,generation:points[0].task.areaPreparationGeneration!,start:anchor(points[0]),end:anchor(points.at(-1)!),via:points.slice(1,-1).map(anchor),paths:legs.map(leg=>leg.routes[leg.selected!].ranges.map(range=>range.taskId)),selectedPath:activeRoute.ranges.map(range=>range.taskId),expectedState:await networkSelectionState(tasks,activeRoute.ranges),status});
    }catch{setMessage('Änderung konnte auf diesem Gerät nicht gespeichert werden. Bitte erneut versuchen.');return;}
    finally{committing.current=false;setSaving(false);}
    setAreaId(null);reset();
  };
  const whole=(task:DistributionTask)=>{
    if(committing.current)return;
    open(task.areaId);
    const localTasks=fullOptimistic.tasks.filter(candidate=>candidate.areaId===task.areaId&&candidate.network);
    const localIndex=new RoadIndex(localTasks);
    const a=localIndex.candidates(task.geometry.coordinates[0]).find(s=>s.task.id===task.id),b=localIndex.candidates(task.geometry.coordinates.at(-1)!).find(s=>s.task.id===task.id);
    if(!a||!b)return;
    setSelectionTasks(localTasks);setPoints([a,b]);
    try{const found=networkRoutes(localTasks,a,b);const direct=found.find(route=>route.ranges.length===1&&route.ranges[0].taskId===task.id)??found[0];setLegs(direct?[{routes:[direct],selected:0}]:[]);setMessage(direct?'Nur diesen Straßenabschnitt markieren. Prüfe die Vorschau.':'Kein Weg gefunden. Auswahl wurde zurückgesetzt.');}catch{setPoints([]);setLegs([]);setMessage('Kein Weg gefunden. Auswahl wurde zurückgesetzt.');}
  };
  const closeMarking=()=>{if(committing.current)return;setAreaId(null);setMarking(false);reset();};
  const discard=async(key:string)=>{await discardNetworkIntent(key);setPending(await queuedNetworkIntents(scope));};
  const panelState=marking?{title:points[0]?.task.label??'Neue Straße',message:legs.length&&legs.every(leg=>leg.selected!==null)&&!preview?'Auswahl zu groß. Letzten Punkt rückgängig machen.':message,choices,routes,selected,activeRoute,pointCount:points.length,maxPoints:MAX_NETWORK_POINTS,saving,pending:pending.map(item=>({key:item.key,blocked:Boolean(item.blocked)})),onChoice:accept,onRouteSelect:(routeIndex:number)=>{if(!committing.current&&routes[routeIndex])setLegs(legs.map((leg,i)=>i===legs.length-1?{...leg,selected:routeIndex}:leg));},onCommit:commit,onUndo:undo,onReset:reset,onClose:closeMarking,onDiscard:discard}:null;
  const preparationUrl=(id:string)=>`/api/campaigns/${encodeURIComponent(snapshot.campaign.id)}/areas/${encodeURIComponent(id)}/preparation`;
  useEffect(()=>{
    let stopped=false;
    let timer:number|undefined;
    const known:Record<string,AreaPreparationPublicState>={};
    const retryAt:Record<string,number>={};
    const retryCounts:Record<string,number>={};
    const stoppedAreas=new Set<string>();
    let reading=false;
    const canRead=()=>navigator.onLine&&(typeof document==='undefined'||document.visibilityState!=='hidden');
    const retryDelay=(attempt:number)=>Math.min(30_000,AREA_PREPARATION_POLL_INTERVAL_MS*2**Math.min(4,attempt-1));
    const acceptState=(id:string,state:AreaPreparationPublicState)=>{
      if(stopped||!permittedAreas.some(area=>area.id===id))return;
      if(known[id]?.updatedAt&&state.updatedAt&&known[id].updatedAt!>state.updatedAt)return;
      const prior=known[id];known[id]=state;setStates(current=>({...current,[id]:state}));
      retryCounts[id]=0;delete retryAt[id];stoppedAreas.delete(id);
      if(state.status==='ready'&&(!prior||prior.status==='pending'))void refresh();
      if(state.status==='pending'&&!reading&&timer===undefined)schedulePoll();
    };
    const onProgress=(event:Event)=>{const value=(event as CustomEvent).detail;if(value?.campaignId===snapshot.campaign.id&&value.state)acceptState(value.areaId,value.state);};
    window.addEventListener('campaign-preparation',onProgress);
    const noteFailure=(id:string,status?:number)=>{
      if(status===401||status===403){stoppedAreas.add(id);delete retryAt[id];return;}
      const attempt=(retryCounts[id]??0)+1;retryCounts[id]=attempt;
      if(attempt>5){stoppedAreas.add(id);delete retryAt[id];return;}
      retryAt[id]=Date.now()+retryDelay(attempt);
    };
    const schedulePoll=()=>{
      if(stopped||timer!==undefined||!canRead())return;
      const delays=permittedAreas.filter(area=>!stoppedAreas.has(area.id)&&(!known[area.id]||known[area.id].status==='pending')).map(area=>Math.max(AREA_PREPARATION_POLL_INTERVAL_MS,(retryAt[area.id]??0)-Date.now()));
      if(!delays.length)return;
      timer=window.setTimeout(()=>{timer=undefined;void poll();},Math.min(...delays));
    };
    const poll=async()=>{
      if(stopped||reading||!canRead()){schedulePoll();return;}reading=true;
      for(const area of permittedAreas){
        if(stopped)break;
        if(stoppedAreas.has(area.id)||(known[area.id]&&known[area.id].status!=='pending')||(retryAt[area.id]??0)>Date.now())continue;
        try{
          const response=await fetch(preparationUrl(area.id),{credentials:'same-origin',signal:AbortSignal.timeout(10000)});
          if(!response.ok){
            if(response.status===404){
              const message=await preparationRequestError(response);
              if(message.startsWith('Dieses lokale Gebiet')){
                stoppedAreas.add(area.id);delete retryAt[area.id];setPreparationError(message);void refresh().catch(()=>undefined);continue;
              }
            }
            noteFailure(area.id,response.status);continue;
          }
          const state=await response.json() as AreaPreparationPublicState;
          if(stopped)return;
          acceptState(area.id,state);
        }catch{noteFailure(area.id);}
      }
      reading=false;
      if(!stopped)schedulePoll();
    };
    const resume=()=>{if(stopped||reading)return;if(timer!==undefined){window.clearTimeout(timer);timer=undefined;}void poll();};
    window.addEventListener('online',resume);
    if(typeof document!=='undefined')document.addEventListener('visibilitychange',resume);
    void poll();
    return()=>{stopped=true;window.removeEventListener('campaign-preparation',onProgress);window.removeEventListener('online',resume);if(typeof document!=='undefined')document.removeEventListener('visibilitychange',resume);if(timer!==undefined)window.clearTimeout(timer);};
  },[scope,permittedIds]);
  const prepare=async(area:Area)=>{
    if(preparing)return;
    setPreparing(area.id);setPreparationError('');setMessage('');
    try{
      const response=await fetch(preparationUrl(area.id),{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(25000)});
      if(!response.ok){
        const message=await preparationRequestError(response);
        if(response.status===404){void refresh().catch(()=>undefined);}
        throw new Error(message);
      }
      const state=await response.json() as AreaPreparationPublicState;
      setStates(current=>({...current,[area.id]:state}));
      window.dispatchEvent(new CustomEvent('campaign-preparation',{detail:{campaignId:snapshot.campaign.id,areaId:area.id,state}}));
      setMessage('');
    }catch(error){setPreparationError(error instanceof Error?error.message:'Vorbereitung fehlgeschlagen.');}
    finally{setPreparing(null);}
  };
  const areaActions=(area:Area,editable:boolean,canMark:boolean)=>{
    const roads=fullOptimistic.tasks.filter(task=>task.areaId===area.id);
    const houses=(fullOptimistic.houseTasks??[]).filter(house=>house.areaId===area.id);
    const screenedArea=screenDistributionStreets(roads,houses,screeningMode);
    const state=states[area.id];
    const running=state?.status==='pending';
    const phaseLabel=({
      roads:'Straßen laden',graph:'Straßennetz aufbauen',buildings:'Gebäude laden',addresses:'Adressen prüfen',link:'Häuser zuordnen',publish:'Speichern',ready:'Bereit',
      'v4-plan':'Quelldaten planen','v4-source':'Quelldaten laden','v4-node-usage':'Kreuzungen prüfen','v4-graph':'Straßennetz aufbauen','v4-address':'Adressen prüfen','v4-address-dedupe':'Adressen abgleichen','v4-address-final':'Adressen zuordnen','v4-link':'Häuser zuordnen','v4-base':'Daten vorbereiten','v4-publish':'Speichern',
    } as Record<string,string>)[state?.progress?.phase??'']??'Vorbereitung';
    return <div className="area-actions-content">
      {(roads.some(task=>task.network)?canMark:editable)?<button className="button primary full-width" disabled={Boolean(preparing)||running} onClick={()=>roads.some(task=>task.network)?open(area.id):void prepare(area)}>{preparing===area.id||running?'Vorbereitung läuft …':roads.some(task=>task.network)?'Straßen bearbeiten':'Straßen und Häuser vorbereiten'}</button>:null}
      {roads.some(task=>task.network)?<div className="area-screening-beta" role="group" aria-label="Beta Straßen-Screening"><p><strong>Straßen-Screening · Beta</strong><br/>Nach der StreetEngine umschaltbar. Das erzeugte Netz bleibt unverändert.</p><div className="mode-actions"><button className={'button '+(screeningMode==='classic'?'primary':'secondary')} type="button" onClick={()=>changeScreening('classic')}>Filter V1 · Klassisch</button><button className={'button '+(screeningMode==='delivery-v2'?'primary':'secondary')} type="button" onClick={()=>changeScreening('delivery-v2')}>Screening V2 · Beta</button></div><small>{screeningMode==='delivery-v2'?`V2 zeigt ${screenedArea.tasks.length} von ${roads.length} Straßen. ${screenedArea.hiddenTaskIds.length} unbenannte Abschnitte ohne zugeordnete Häuser sind ausgeblendet.`:'V1 zeigt alle vorbereiteten Straßen.'}</small></div>:null}
      {state?.progress && running?<div className="area-preparation-progress" role="status">
        <div className="area-preparation-progress-header"><strong>{state.progress.percent} %</strong><span>{phaseLabel}</span></div>
        <progress max={100} value={state.progress.percent} aria-label="Vorbereitung" />
        <p>{state.progress.phase.startsWith('v4-')
          ? state.progress.totalTiles>0
            ? `Straßen-Shards ${state.progress.completedRoadTiles}/${state.progress.totalTiles} · Gebäude-Shards ${state.progress.completedBuildingTiles}/${state.progress.totalTiles}`
            : 'Quell-Shards werden ermittelt'
          : `Straßen-Tiles ${state.progress.completedRoadTiles}/${state.progress.totalTiles} · Gebäude-Tiles ${state.progress.completedBuildingTiles}/${state.progress.totalTiles}`} · {state.progress.processedBuildings}/{state.progress.totalBuildings} Gebäude · {state.houseCount} Häuser</p>
      </div>:null}
      {state?.status==='failed'?<div role="alert"><p>{preparationFailureMessage(state.failure?.code??state.errorCode??undefined)}</p>{state.failure?<details><summary>Fehlerdetails</summary><p>{phaseLabel} · Cursor {state.failure.cursor} · Versuch {state.failure.attempt} · {state.failure.code}</p></details>:null}</div>:null}
      {state?.quality?.rejectedBuildings?<div role="status"><p>{state.quality.rejectedBuildings} von {state.quality.receivedBuildings} Gebäudeobjekten konnten nicht verwendet werden. Die Hausliste kann dadurch unvollständig sein.</p><details><summary>Betroffene Quelldaten (maximal 10)</summary><ul>{state.quality.samples.map((sample,index)=><li key={index}>OSM {sample.osmId??'unbekannt'} · Tile {sample.tile} · {sample.reason}</li>)}</ul></details></div>:null}
      {state?.status==='ready'&&state.houseCount===0?<p role="status">Die Vorbereitung ist abgeschlossen, aber es wurden keine adressierbaren Häuser gefunden.</p>:null}
      {preparationError?<p role="alert">{preparationError}</p>:null}
    </div>;
  };
  const anchors=points.map(snap=>({sourceId:snap.task.id,snapped:snap.point,segmentIndex:0,segmentT:0,distanceMeters:snap.distance}));
  const selectedSourceIds=[...new Set([...points.map(snap=>snap.task.id),...(preview?.ranges.map(range=>range.taskId)??[])])];
  return {optimistic,screeningMode,screening,open,available:permittedAreas.some(area=>fullOptimistic.tasks.some(task=>task.areaId===area.id&&task.network)),active:marking,panelState,areaActions,whole,mapProps:{smartRoads:[],smartSelectedSourceIds:selectedSourceIds,smartStartAnchor:anchors[0]??null,smartEndAnchor:anchors.length>1?anchors.at(-1)!:null,smartWaypointAnchors:anchors.slice(1,-1),smartPreviewGeometry:preview?.geometry??null,smartStreetColor:'#7c3aed',onSmartStreetPoint:onPoint}};
}
