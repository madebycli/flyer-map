import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { NetworkD1,seedNetwork } from '../tests/helpers/networkD1.ts';
import { handleRxdbPull,handleRxdbCheckpoint } from '../worker/rxdbSync.ts';
import { isRxdbCollectionName } from '../src/data/rxdbSyncProtocol.ts';
const db=new NetworkD1(true);seedNetwork(db);db.sqlite.exec('DELETE FROM areas; DELETE FROM teams;');
const access={campaignId:'campaign_n',role:'admin' as const,teamId:null,label:'Local benchmark',grantId:'fixture'};
const root=resolve(process.env.BROWSER_BUILD_ROOT??'dist/client');
const requests:{path:string;durationMs:number}[]=[];
const server=createServer(async(req,res)=>{
 const start=performance.now(),url=new URL(req.url!,'http://localhost');
 let response:Response;
 try{
  if(url.pathname==='/benchmark-requests')response=Response.json(requests);
  else if(url.pathname==='/api/access/current')response=Response.json({access});
  else if(url.pathname==='/api/campaigns/campaign_n/rxdb/checkpoint')response=await handleRxdbCheckpoint(db,'campaign_n',access);
  else if(url.pathname.includes('/rxdb/')){
   const parts=url.pathname.split('/'),collection=parts.at(-2),operation=parts.at(-1);
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');
   response=isRxdbCollectionName(collection)&&operation==='pull'?await handleRxdbPull(db,'campaign_n',collection,access,body):Response.json({error:{code:'benchmark_read_only'}},{status:405});
  }else if(url.pathname.startsWith('/api/'))response=Response.json({error:{code:'benchmark_unavailable'}},{status:404});
  else{
   let file=resolve(root,'.'+url.pathname);if(!file.startsWith(root+'/')||!existsSync(file)||url.pathname==='/')file=resolve(root,'index.html');
   const type=({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.json':'application/json'} as Record<string,string>)[extname(file)]??'application/octet-stream';
   let body=readFileSync(file);if(extname(file)==='.html')body=Buffer.from(body.toString().replace('<head>','<head><script>window.__benchmark={longTasks:[],paints:[]};new PerformanceObserver(l=>window.__benchmark.longTasks.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:"longtask",buffered:true});new PerformanceObserver(l=>window.__benchmark.paints.push(...l.getEntries().map(e=>({name:e.name,start:e.startTime})))).observe({type:"paint",buffered:true});</script>'));
   response=new Response(body,{headers:{'content-type':type}});
  }
 }catch(error){response=Response.json({error:String(error)},{status:500});}
 requests.push({path:url.pathname,durationMs:performance.now()-start});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
});
server.listen(4173,'0.0.0.0',()=>console.log('Local synthetic benchmark: http://127.0.0.1:4173/?campaign=campaign_n'));
