import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {createVisualRelay} from './visual-relay.mjs';

// RAM only. Counts active visual sessions; stale sessions expire after 90 seconds.
export function createPresenceServer({now=Date.now,ttl=90000,maxSessions=20000,trustProxy=false}={}) {
  const sessions=new Map(),rates=new Map();
  const relay=createVisualRelay({now,maxSessions});
  const sweep=()=>{const t=now();for(const [id,s] of sessions)if(t-s.at>=ttl)sessions.delete(id);for(const [ip,r] of rates)if(t-r.at>=60000)rates.delete(ip);};
  const count=()=>{sweep();let n=0;for(const s of sessions.values())if(s.playing&&s.visuals)n++;return n;};
  const server=http.createServer(async(req,res)=>{
    const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
    const path=req.url?.split('?')[0];sweep();relay.sweep();
    const ip=trustProxy?String(req.headers['x-forwarded-for']??req.socket.remoteAddress).split(',')[0].trim():req.socket.remoteAddress;
    const rateKey=ip+(path==='/v1/visuals/sync'?':visual':':presence');
    let r=rates.get(rateKey);if(!r){if(rates.size>=20000)return reply(503,{error:'busy'});r={at:now(),n:0};rates.set(rateKey,r);}if(++r.n>(path==='/v1/visuals/sync'?20000:120))return reply(429,{error:'rate_limit'});
    if(req.method==='GET'&&path==='/health')return reply(200,{ok:true});
    if(req.method==='GET'&&path==='/v1/capabilities')return reply(200,{visualVersion:14,menu:true,menuImage:true,menuHands:true,customHits:true,customDeaths:true,wingForms:true,effectStudio:true,customModel:true,drone:true});
    if(req.method==='GET'&&path==='/v1/online')return reply(200,{online:count(),ttlSeconds:ttl/1000});
    if(req.method!=='POST'||!['/v1/presence','/v1/visuals/sync'].includes(path))return reply(404,{error:'not_found'});
    if(!String(req.headers['content-type']??'').startsWith('application/json'))return reply(415,{error:'json_required'});
    let body='',length=0;
    try{for await(const chunk of req){length+=chunk.length;if(length>(path==='/v1/visuals/sync'?262144:1024)){reply(413,{error:'too_large'});req.destroy();return;}body+=chunk;}body=JSON.parse(body);}catch{return reply(400,{error:'invalid_json'});}
    if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,{error:'invalid_json'});
    if(path==='/v1/visuals/sync'){const [status,result]=relay.sync(body,ip);return reply(status,result);}
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.session??'')||typeof body.playing!=='boolean'||typeof body.visuals!=='boolean')return reply(400,{error:'invalid_presence'});
    const old=sessions.get(body.session);
    if(!old){if(sessions.size>=maxSessions)return reply(503,{error:'capacity'});let n=0;for(const s of sessions.values())if(s.ip===ip)n++;if(n>=64)return reply(429,{error:'session_limit'});}
    else if(old.ip!==ip)return reply(409,{error:'session_conflict'});
    sessions.set(body.session,{at:now(),ip,playing:body.playing,visuals:body.visuals});
    reply(200,{online:count(),ttlSeconds:ttl/1000});
  });
  server.requestTimeout=8000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
  const timer=setInterval(()=>{sweep();relay.sweep();},15000);timer.unref();server.on('close',()=>{clearInterval(timer);sessions.clear();rates.clear();relay.clear();});return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const server=createPresenceServer({trustProxy:process.env.TRUST_PROXY==='1'});
  server.listen(Number(process.env.PORT??8080),process.env.HOST??'0.0.0.0',()=>console.log('Why client presence server started'));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
