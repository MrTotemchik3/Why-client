import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createPresenceServer} from './server.mjs';
test('real HTTP presence, duplicate session, visual filters, TTL and validation',async()=>{
 let clock=100000;const server=createPresenceServer({now:()=>clock});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`,session=randomUUID();
 const send=(body)=>fetch(base+'/v1/presence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await(await fetch(base+'/v1/online')).json()).online,0);
  for(let i=0;i<3;i++)assert.equal((await(await send({session,playing:true,visuals:true})).json()).online,1);
  assert.equal((await(await send({session:randomUUID(),playing:false,visuals:true})).json()).online,1);
  assert.equal((await(await send({session:randomUUID(),playing:true,visuals:false})).json()).online,1);
  assert.equal((await send({session:'bad',playing:true,visuals:true})).status,400);
  assert.equal((await send({session:randomUUID(),playing:'true',visuals:true})).status,400);
  clock+=89999;assert.equal((await(await fetch(base+'/v1/online')).json()).online,1);
  clock++;assert.equal((await(await fetch(base+'/v1/online')).json()).online,0);
  assert.equal((await(await send({session,playing:true,visuals:true})).json()).online,1);
  assert.equal((await(await send({session,playing:false,visuals:true})).json()).online,0);
 }finally{await new Promise(r=>server.close(r));}
});
test('bounded session capacity',async()=>{const server=createPresenceServer({maxSessions:1});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/v1/presence`;try{for(const code of [200,503])assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session:randomUUID(),playing:true,visuals:true})})).status,code);}finally{await new Promise(r=>server.close(r));}});
