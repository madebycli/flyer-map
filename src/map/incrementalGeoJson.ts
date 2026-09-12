import type { Feature,FeatureCollection } from 'geojson';
import type { GeoJSONSourceDiff } from 'maplibre-gl';

type Source={setData(data:FeatureCollection):unknown;updateData(diff:GeoJSONSourceDiff):unknown};
type Cached={version:string;features:Feature[]};
const sources=new WeakMap<Source,Map<string,Cached>>();
/** Keep geometry in MapLibre's worker. A status edit sends changed properties only. */
export function syncIncrementalGeoJson<T extends {id:string}>(source:Source,entities:readonly T[],version:(entity:T)=>string,render:(entities:T[])=>FeatureCollection){
  const previous=sources.get(source);
  const next=new Map<string,Cached>();
  const diff:GeoJSONSourceDiff={add:[],remove:[],update:[]};
  for(const entity of entities){
    const key=version(entity),old=previous?.get(entity.id);
    if(old?.version===key){next.set(entity.id,old);continue;}
    const features=render([entity]).features;
    next.set(entity.id,{version:key,features});
    if(!previous)continue;
    const oldFeatures=new Map((old?.features??[]).map(feature=>[feature.id,feature]));
    for(const feature of features){
      const prior=oldFeatures.get(feature.id);oldFeatures.delete(feature.id);
      if(!prior){diff.add!.push(feature);continue;}
      const properties=Object.entries(feature.properties??{}).filter(([key,value])=>prior.properties?.[key]!==value).map(([key,value])=>({key,value}));
      const geometryChanged=JSON.stringify(prior.geometry)!==JSON.stringify(feature.geometry);
      if(properties.length||geometryChanged)diff.update!.push({id:feature.id!,...(properties.length?{addOrUpdateProperties:properties}:{}),...(geometryChanged?{newGeometry:feature.geometry}:{})});
    }
    diff.remove!.push(...[...oldFeatures.keys()].filter((id):id is string|number=>id!==undefined));
  }
  if(!previous)source.setData({type:'FeatureCollection',features:[...next.values()].flatMap(row=>row.features)});
  else if(!next.size&&previous.size)source.updateData({removeAll:true});
  else{
    for(const [id,row] of previous)if(!next.has(id))diff.remove!.push(...row.features.map(feature=>feature.id!));
    if(diff.add!.length||diff.remove!.length||diff.update!.length)source.updateData(diff);
  }
  sources.set(source,next);
}
