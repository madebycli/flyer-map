import { useEffect, useMemo, useRef, useState } from "react";
import { CampaignApiError, campaignIdFromUrl, fetchCanonicalAreas } from "../data/campaignApi";
import "./street-engine-diagnostics.css";

type AreaOption = { id:string;name:string;updatedAt:string };
type DiagnosticMetrics = {
  engineVersion?:string;sourcePolicy?:string;manifestHash?:string|null;sourcePackVersion?:string|null;algorithmVersion?:string|null;selectedShardIds?:string[];shardCount?:number;objectGets?:number;compressedBytes?:number;decodedBytes?:number;legacyOverpassRequests?:number|null;resultHash?:string|null;
  cacheHits?:number;cacheMisses?:number;requests?:number;retries?:number;bytes?:number;observedSourceBytes?:number;activeMs?:number|null;sourceMs?:number;fetchMs?:number;parseMs?:number;normalizationMs?:number;graphMs?:number;addressMs?:number;linkMs?:number;publishMs?:number;roads?:number;buildings?:number;addressableBuildings?:number;houses?:number;sourceTimestamp?:string|null;baseStep?:string|null;baseFailureClass?:string|null;
  lastError?:null|{phase:string;cursor:number;code:string;attempt:number};
};
type StreetDiagnostic = {generation:string;status:"pending"|"ready"|"failed";engineVersion?:string;phase:string;cursor:number;attempts:number;errorCode:string|null;leaseUntil:string|null;retryWaitRemainingMs:number;startedAt:string|null;finishedAt:string|null;updatedAt:string;elapsedMs:number|null;activeElapsedMs?:number|null;wallElapsedMs?:number|null;staleForMs:number|null;roadCount:number;houseCount:number;metrics:DiagnosticMetrics};
type PreparationPayload = {status:"missing"|"pending"|"ready"|"failed";roadCount:number;houseCount:number;sourceTimestamp:string|null;errorCode:string|null;updatedAt:string|null;progress?:{phase:string;percent:number;totalTiles:number;completedRoadTiles:number;completedBuildingTiles:number;processedBuildings:number;totalBuildings:number};diagnostics?:StreetDiagnostic|null};
type RuntimeInfo={ok?:boolean;version?:string;environment?:string;sourceCommit?:string|null;streetEngineVersion?:string|null;releaseChannel?:string|null};
type Observation={at:string;status:string;phase:string;cursor:number;attempts:number;errorCode:string|null;pollMs:number;elapsedMs:number|null};

const SNAPSHOT_STORAGE_KEY="verteil-flyer:campaign-snapshot";
function diagnosticsEnabled(){return typeof window!=="undefined"&&new URL(window.location.href).searchParams.get("diag")==="1";}
function localAreas():AreaOption[]{try{const raw=window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);if(!raw)return[];const parsed=JSON.parse(raw) as {areas?:unknown[]};if(!Array.isArray(parsed.areas))return[];return parsed.areas.flatMap((value)=>{if(!value||typeof value!=="object"||Array.isArray(value))return[];const area=value as Record<string,unknown>;if(typeof area.id!=="string")return[];return[{id:area.id,name:typeof area.name==="string"&&area.name.trim()?area.name.trim():area.id,updatedAt:typeof area.updatedAt==="string"?area.updatedAt:""}];}).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt));}catch{return[];}}
function formatDuration(ms:number|null|undefined){if(ms===null||ms===undefined||!Number.isFinite(ms))return"–";if(ms<1000)return`${Math.round(ms)} ms`;const seconds=ms/1000;if(seconds<60)return`${seconds.toFixed(seconds<10?2:1)} s`;const minutes=Math.floor(seconds/60);return`${minutes}:${(seconds-minutes*60).toFixed(1).padStart(4,"0")} min`;}
function formatBytes(value:number|null|undefined){if(!value||!Number.isFinite(value)||value<=0)return"0 B";if(value<1024)return`${Math.round(value)} B`;if(value<1024*1024)return`${(value/1024).toFixed(1)} KiB`;return`${(value/1024/1024).toFixed(2)} MiB`;}
function shortHash(value:string|null|undefined){return value?`${value.slice(0,12)}…`:"–";}
function value(value:unknown){return value===null||value===undefined||value===""?"–":String(value);}

export function StreetEngineDiagnosticsV4(){
  const enabled=useMemo(diagnosticsEnabled,[]);const campaignId=useMemo(()=>campaignIdFromUrl(),[]);
  const [expanded,setExpanded]=useState(false);const [copied,setCopied]=useState(false);const [areas,setAreas]=useState<AreaOption[]>(()=>enabled?localAreas():[]);const [areaSource,setAreaSource]=useState<"server"|"local">("local");const [selectedAreaId,setSelectedAreaId]=useState(()=>enabled?localAreas()[0]?.id??"":"");const [payload,setPayload]=useState<PreparationPayload|null>(null);const [runtime,setRuntime]=useState<RuntimeInfo|null>(null);const [error,setError]=useState<string|null>(null);const [canonicalAreaError,setCanonicalAreaError]=useState<string|null>(null);const [pollMs,setPollMs]=useState(0);const [observations,setObservations]=useState<Observation[]>([]);const lastSignature=useRef("");

  useEffect(()=>{
    if(!enabled||!campaignId)return;
    let cancelled=false,loading=false,timer:number|undefined;
    const refresh=async()=>{
      if(cancelled||loading||document.visibilityState==="hidden")return;
      loading=true;
      try{
        const next=await fetchCanonicalAreas(campaignId);
        if(cancelled)return;
        setAreas(next);setAreaSource("server");setCanonicalAreaError(null);
        setSelectedAreaId((current)=>current&&next.some((area)=>area.id===current)?current:next[0]?.id??"");
      }catch(cause){
        if(cancelled)return;
        const next=localAreas();setAreas(next);setAreaSource("local");setPayload(null);
        setObservations([]);lastSignature.current="";
        setCanonicalAreaError(cause instanceof CampaignApiError?`${cause.code} (HTTP ${cause.status})`:cause instanceof Error?cause.message:"canonical_area_lookup_failed");
        setSelectedAreaId((current)=>current&&next.some((area)=>area.id===current)?current:next[0]?.id??"");
      }finally{
        loading=false;
        if(!cancelled)timer=window.setTimeout(()=>void refresh(),30_000);
      }
    };
    const resume=()=>{if(document.visibilityState!=="visible"||loading)return;if(timer!==undefined)window.clearTimeout(timer);timer=undefined;void refresh();};
    document.addEventListener("visibilitychange",resume);
    void refresh();
    return()=>{cancelled=true;if(timer!==undefined)window.clearTimeout(timer);document.removeEventListener("visibilitychange",resume);};
  },[enabled,campaignId]);
  useEffect(()=>{if(!enabled)return;let cancelled=false;const load=async()=>{try{const response=await fetch(`/api/runtime?diag=${Date.now()}`,{cache:"no-store",credentials:"same-origin"});if(response.ok&&!cancelled)setRuntime(await response.json() as RuntimeInfo);}catch{/* preparation diagnostics remain useful */}};void load();return()=>{cancelled=true;};},[enabled]);
  useEffect(()=>{
    if(!enabled||!campaignId||!selectedAreaId||areaSource!=="server")return;
    let cancelled=false,reading=false,timer:number|undefined;
    const poll=async()=>{
      if(cancelled||reading||document.visibilityState==="hidden")return;
      reading=true;
      const started=performance.now();
      let delay=30_000;
      try{
        const response=await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/areas/${encodeURIComponent(selectedAreaId)}/preparation?diag=1&t=${Date.now()}`,{cache:"no-store",credentials:"same-origin"});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const next=await response.json() as PreparationPayload;
        if(cancelled)return;
        delay=next.status==="pending"?5_000:30_000;
        const elapsed=performance.now()-started;setPollMs(elapsed);setPayload(next);setError(null);
        const diag=next.diagnostics;
        const observation:Observation={at:new Date().toISOString(),status:next.status,phase:diag?.phase??next.progress?.phase??"–",cursor:diag?.cursor??0,attempts:diag?.attempts??0,errorCode:diag?.errorCode??next.errorCode,pollMs:elapsed,elapsedMs:diag?.elapsedMs??null};
        const signature=JSON.stringify([observation.status,observation.phase,observation.cursor,observation.attempts,observation.errorCode,diag?.generation]);
        if(signature!==lastSignature.current){lastSignature.current=signature;setObservations((current)=>[observation,...current].slice(0,100));}
      }catch(cause){
        if(!cancelled)setError(cause instanceof Error?cause.message:"diagnostic_request_failed");
      }finally{
        reading=false;
        if(!cancelled)timer=window.setTimeout(()=>void poll(),delay);
      }
    };
    const resume=()=>{if(document.visibilityState!=="visible"||reading)return;if(timer!==undefined)window.clearTimeout(timer);timer=undefined;void poll();};
    document.addEventListener("visibilitychange",resume);
    void poll();
    return()=>{cancelled=true;if(timer!==undefined)window.clearTimeout(timer);document.removeEventListener("visibilitychange",resume);};
  },[enabled,campaignId,selectedAreaId,areaSource]);

  if(!enabled)return null;const selected=areas.find((area)=>area.id===selectedAreaId);const diag=payload?.diagnostics??null;const metrics=diag?.metrics??{};const isV4=(diag?.engineVersion??metrics.engineVersion)==="v4";const overpassViolation=isV4&&(metrics.legacyOverpassRequests??0)!==0;const runtimeViolation=runtime!==null&&(runtime.streetEngineVersion!=="v4"||runtime.releaseChannel!=="beta");const headline=diag?`${diag.status} · ${formatDuration(diag.elapsedMs)}`:payload?.status??"warte";
  const copy=async()=>{const report={schema:"street-engine-diag-v4",at:new Date().toISOString(),page:window.location.href,campaignId,areaSource,canonicalAreaError,areas,selectedArea:selected??null,runtime,payload,observations};const text=JSON.stringify(report,null,2);try{await navigator.clipboard.writeText(text);setCopied(true);window.setTimeout(()=>setCopied(false),1500);}catch{window.prompt("V4 Diagnose kopieren",text);}};
  return <div className="street-engine-diagnostics">
    <button type="button" className="street-engine-diagnostics-toggle" onClick={()=>setExpanded((value)=>!value)}>STREET DIAG V4 · {headline}</button>
    {expanded?<section className="street-engine-diagnostics-panel" aria-label="Street Engine V4 Diagnose">
      <div className="street-engine-diagnostics-heading"><strong>Street Engine V4 Timeline</strong><span>{headline}</span></div>
      <label>Gebiet <select value={selectedAreaId} onChange={(event)=>setSelectedAreaId(event.target.value)}>{areas.map((area)=><option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
      <small>Gebietsliste: {areaSource==="server"?"Server-RxDB-Bootstrap (autoritativ)":"LocalStorage nur zur Fehleranalyse, nicht autoritativ"} · {areas.length} Gebiete</small>
      {canonicalAreaError?<div className="street-engine-diagnostics-error">Kanonische Gebietsliste nicht verfügbar: {canonicalAreaError}. Für lokale/veraltete Gebiete wird keine Vorbereitung abgefragt.</div>:null}
      {error?<div className="street-engine-diagnostics-error">Diagnose-Request: {error}</div>:null}
      {overpassViolation?<div className="street-engine-diagnostics-error">V4-INVARIANTE VERLETZT: legacyOverpassRequests={metrics.legacyOverpassRequests}</div>:null}
      {runtimeViolation?<div className="street-engine-diagnostics-error">V4-RUNTIME-INVARIANTE VERLETZT: engine={value(runtime?.streetEngineVersion)} · channel={value(runtime?.releaseChannel)}</div>:null}
      <div className="street-engine-diagnostics-grid"><span>Engine</span><b>{value(diag?.engineVersion??metrics.engineVersion)}</b><span>Status</span><b>{value(payload?.status)}</b><span>Generation</span><b>{value(diag?.generation)}</b><span>Phase / Cursor</span><b>{value(diag?.phase)} / {value(diag?.cursor)}</b><span>Job-Attempts</span><b>{value(diag?.attempts)}</b><span>Retry-Wartezeit</span><b>{formatDuration(diag?.retryWaitRemainingMs)}</b><span>Fortschritt</span><b>{payload?.progress?`${payload.progress.percent}%`:"–"}</b><span>Browser-Poll</span><b>{formatDuration(pollMs)}</b><span>Seit Server-Update</span><b>{formatDuration(diag?.staleForMs)}</b></div>
      <details open><summary>V4 Source Pack</summary><div className="street-engine-diagnostics-grid"><span>Source Policy</span><b>{value(metrics.sourcePolicy)}</b><span>Live Overpass Requests</span><b>{value(metrics.legacyOverpassRequests)}</b><span>Manifest</span><b title={metrics.manifestHash??undefined}>{shortHash(metrics.manifestHash)}</b><span>Source Pack</span><b>{value(metrics.sourcePackVersion)}</b><span>Algorithmus</span><b>{value(metrics.algorithmVersion)}</b><span>OSM Timestamp</span><b>{value(metrics.sourceTimestamp??payload?.sourceTimestamp)}</b><span>Shards</span><b>{value(metrics.shardCount)}</b><span>Worker Asset GETs</span><b>{value(metrics.objectGets)}</b><span>Komprimiert</span><b>{formatBytes(metrics.compressedBytes)}</b><span>Dekodiert</span><b>{formatBytes(metrics.decodedBytes)}</b><span>Result Hash</span><b title={metrics.resultHash??undefined}>{shortHash(metrics.resultHash)}</b></div>{metrics.selectedShardIds?.length?<pre>{metrics.selectedShardIds.join("\n")}</pre>:null}</details>
      <details open><summary>Server-Zeiten</summary><div className="street-engine-diagnostics-grid"><span>Wall</span><b>{formatDuration(diag?.wallElapsedMs)}</b><span>Aktiv</span><b>{formatDuration(diag?.activeElapsedMs)}</b><span>Source Pack Read</span><b>{formatDuration(metrics.sourceMs)}</b><span>Graph</span><b>{formatDuration(metrics.graphMs)}</b><span>Adressen</span><b>{formatDuration(metrics.addressMs)}</b><span>House-Link</span><b>{formatDuration(metrics.linkMs)}</b><span>Publish</span><b>{formatDuration(metrics.publishMs)}</b></div></details>
      <details open><summary>Mengen / I/O</summary><div className="street-engine-diagnostics-grid"><span>Straßen</span><b>{value(metrics.roads??diag?.roadCount)}</b><span>Gebäude</span><b>{value(metrics.buildings)}</b><span>Adressierbar</span><b>{value(metrics.addressableBuildings)}</b><span>Häuser</span><b>{value(metrics.houses??diag?.houseCount)}</b><span>Pack Cache Hits/Misses</span><b>{value(metrics.cacheHits)} / {value(metrics.cacheMisses)}</b></div></details>
      <details open><summary>Fehlerdetails</summary>{diag?.errorCode||metrics.lastError?<><div className="street-engine-diagnostics-error">{value(metrics.lastError?.phase??diag?.phase)} · Cursor {value(metrics.lastError?.cursor??diag?.cursor)} · Versuch {value(metrics.lastError?.attempt??diag?.attempts)} · {value(metrics.lastError?.code??diag?.errorCode)}</div><pre>{JSON.stringify({errorCode:diag?.errorCode,lastError:metrics.lastError,leaseUntil:diag?.leaseUntil,startedAt:diag?.startedAt,finishedAt:diag?.finishedAt,updatedAt:diag?.updatedAt},null,2)}</pre></>:<span>Kein Fehler.</span>}</details>
      {metrics.baseStep?<div className="street-engine-diagnostics-error">Base-Schritt: {metrics.baseStep} · Fehlerklasse: {value(metrics.baseFailureClass)}</div>:null}
      <details><summary>Runtime / Release</summary><pre>{JSON.stringify(runtime,null,2)}</pre></details>
      <details><summary>Vollständiger allowlisteter V4 Snapshot</summary><pre>{JSON.stringify(payload,null,2)}</pre></details>
      <details><summary>Client Timeline ({observations.length})</summary><div className="street-engine-diagnostics-list street-engine-diagnostics-timeline">{observations.map((entry,index)=><div key={`${entry.at}-${index}`}><b>{entry.status} · {entry.phase}:{entry.cursor}</b><span>{entry.at}</span><small>attempt {entry.attempts} · elapsed {formatDuration(entry.elapsedMs)} · poll {formatDuration(entry.pollMs)} · {entry.errorCode??"ok"}</small></div>)}</div></details>
      <button type="button" onClick={()=>void copy()}>{copied?"V4 Log kopiert":"Extrem detaillierten V4 Log kopieren"}</button>
      <small>V4 ist providerfrei. Private Coffee / mail.ru dürfen in diesem Pfad nicht angefragt werden.</small>
    </section>:null}
  </div>;
}
