import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  canonicalStreetEngineV3SourceManifestJson,
  streetEngineV3SourceManifestHash,
  streetEngineV3SourceObjectKey,
  type StreetEngineV3Bounds,
} from '../src/domain/streetEngineV3SourcePack.ts';
import { buildStreetEngineV3PbfPack, type StreetEngineV3PbfFeature } from '../worker/streetNetwork/v3PbfPackBuilder.ts';
import { streetEngineV3ManifestObjectKey, streetEngineV3PointerKey } from '../worker/streetNetwork/v3SourceRuntime.ts';

function parseFeatures(raw:string):StreetEngineV3PbfFeature[]{
  const features:StreetEngineV3PbfFeature[]=[];
  for(const rawLine of raw.split(/\r?\n/u)){
    const line=rawLine.replace(/^\u001e/u,'').trim();if(!line)continue;
    let value:unknown;try{value=JSON.parse(line);}catch{throw new Error('street_engine_v4_pbf_geojsonseq_invalid');}
    if(!value||typeof value!=='object'||(value as {type?:unknown}).type!=='Feature')throw new Error('street_engine_v4_pbf_geojsonseq_invalid');
    const feature=value as StreetEngineV3PbfFeature;
    if(feature.geometry?.type==='Point'||feature.geometry?.type==='LineString'||feature.geometry?.type==='Polygon')features.push(feature);
  }
  return features;
}
function parseBounds(value:string):StreetEngineV3Bounds{
  const parts=value.split(',').map(Number);if(parts.length!==4||parts.some((part)=>!Number.isFinite(part)))throw new Error('street_engine_v4_pbf_cli_bounds_invalid');
  return parts as unknown as StreetEngineV3Bounds;
}

const [,,inputArg,boundsArg,timestampArg,outputArg='/tmp/street-engine-v4-pack',channelArg='beta',providerArg='geofabrik-pbf']=process.argv;
if(!inputArg||!boundsArg||!timestampArg){
  console.error('usage: node --experimental-transform-types scripts/build-street-engine-v4-pbf-pack.ts <geojsonseq> <west,south,east,north> <source-timestamp> [output-dir] [channel] [provider]');
  process.exit(2);
}
const outputDir=resolve(outputArg);
const built=await buildStreetEngineV3PbfPack({features:parseFeatures(await readFile(resolve(inputArg),'utf8')),coverageBounds:parseBounds(boundsArg),sourceTimestamp:timestampArg,provider:providerArg});
const manifest={...built.manifest,algorithmVersion:'v4-pbf-builder-1'};
const manifestJson=canonicalStreetEngineV3SourceManifestJson(manifest);
const manifestHash=await streetEngineV3SourceManifestHash(manifest);
await rm(outputDir,{recursive:true,force:true});await mkdir(resolve(outputDir,'shards'),{recursive:true});
for(const [id,bytes] of built.shardObjects)await writeFile(resolve(outputDir,'shards',`${id}.bin`),bytes);
const pointer=JSON.stringify({schemaVersion:1,channel:channelArg,manifestHash});
await writeFile(resolve(outputDir,'manifest.json'),manifestJson);await writeFile(resolve(outputDir,'pointer.json'),pointer);
const summary={engineVersion:'v4',channel:channelArg,manifestHash,manifestKey:streetEngineV3ManifestObjectKey(manifestHash),pointerKey:streetEngineV3PointerKey(channelArg),sourcePackVersion:manifest.sourcePackVersion,algorithmVersion:manifest.algorithmVersion,sourceTimestamp:manifest.source.timestamp,provider:manifest.source.provider,coverageBounds:manifest.coverageBounds,shardCount:manifest.shards.length,compressedBytes:manifest.shards.reduce((sum,shard)=>sum+shard.compressedBytes,0),counts:manifest.shards.reduce((totals,shard)=>({roads:totals.roads+shard.counts.roads,buildings:totals.buildings+shard.counts.buildings,addressableBuildings:totals.addressableBuildings+shard.counts.addressableBuildings,addressNodes:totals.addressNodes+(shard.counts.addressNodes??0)}),{roads:0,buildings:0,addressableBuildings:0,addressNodes:0}),shards:manifest.shards.map((shard)=>({id:shard.id,key:streetEngineV3SourceObjectKey(shard.id),file:`shards/${shard.id}.bin`,compressedBytes:shard.compressedBytes,counts:shard.counts}))};
await writeFile(resolve(outputDir,'summary.json'),`${JSON.stringify(summary,null,2)}\n`);console.log(JSON.stringify(summary));
