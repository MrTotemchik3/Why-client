import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPresenceServer} from './server.mjs';
import {createVisualRelay} from './visual-relay.mjs';
const room='a'.repeat(64),target=randomUUID();
const event=(id=1,kind='target')=>({id,kind,target,style:kind==='target'?4:0,duration:900,radius:2,amount:3,color:0xb2a3ff,glow:.9,seed:42,x:1,y:64,z:1,height:1.8});
const body=(session,player,extra={})=>({session,player,room,cursor:0,state:{target:{target,style:4,size:1,speed:1,glow:.9,quality:1,color:0xb2a3ff},mace:{strike:0,idle:0,strength:1,idleStrength:.7,tempo:1,idleTempo:1}},events:[],...extra});
test('two real HTTP peers: shared target, mace and death, room isolation, no self echo, dedup and TTL',async()=>{
 let clock=100000;const server=createPresenceServer({now:()=>clock});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}/v1/visuals/sync`,a=randomUUID(),b=randomUUID(),pa=randomUUID(),pb=randomUUID();
 const send=async payload=>{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});return {code:response.status,value:await response.json()};};
 try{
  let result=await send(body(a,pa,{events:[{...event(1),delayMs:125},event(2,'mace'),event(3,'death')]}));assert.equal(result.code,200);assert.equal(result.value.events.length,0);
  result=await send(body(b,pb));assert.equal(result.code,200);assert.equal(result.value.players[0].player,pa);assert.deepEqual(result.value.events.map(e=>e.kind),['target','mace','death']);assert.equal(result.value.events[0].owner,pa);assert.equal(result.value.events[0].ageMs,125);
  await send(body(a,pa,{events:[event(1),event(2,'mace')]}));result=await send(body(b,pb,{cursor:result.value.cursor}));assert.equal(result.value.events.length,0);
  result=await send(body(randomUUID(),randomUUID(),{room:'b'.repeat(64)}));assert.equal(result.value.players.length,0);assert.equal(result.value.events.length,0);
  clock+=6001;result=await send(body(b,pb));assert.equal(result.value.players.length,0);assert.equal(result.value.events.length,0);
  assert.equal((await send(null)).code,400);assert.equal((await send(body(b,pb,{events:Array.from({length:9},(_,i)=>event(i+10))}))).code,400);
  assert.equal((await send(body(b,pb,{state:{target:{target,style:99}}}))).code,400);
  assert.equal((await send(body(b,pb,{events:[{...event(10),x:1e30}]}))).code,400);
 }finally{await new Promise(r=>server.close(r));}
});
test('relay rate/capacity, session ownership and bounded event ring',()=>{
 let clock=100;const relay=createVisualRelay({now:()=>clock,maxSessions:2}),a=randomUUID(),b=randomUUID(),pa=randomUUID(),pb=randomUUID();
 assert.equal(relay.sync(body(a,pa),'ip1')[0],200);assert.equal(relay.sync(body(a,pa),'ip2')[0],409);
 for(let i=0;i<80;i++)relay.sync(body(a,pa,{events:Array.from({length:8},(_,j)=>event(i*8+j+1))}),'ip1');
 const reply=relay.sync(body(b,pb),'ip2')[1];assert.equal(reply.events.length,64);assert.equal(reply.cursor,640);
 assert.equal(relay.sync(body(randomUUID(),randomUUID()),'ip3')[0],503);
 let code;for(let i=0;i<301;i++)code=relay.sync(body(b,pb),'ip2')[0];assert.equal(code,429);
 clock+=60001;assert.equal(relay.sync(body(b,pb),'ip2')[0],200);relay.clear();
});
test('r7 wings share bounded state; legacy r6 clients and death encoding remain compatible',()=>{
 const relay=createVisualRelay(),a=randomUUID(),b=randomUUID(),pa=randomUUID(),pb=randomUUID();
 const wings={size:1,speed:1,spread:1,glow:.7,alpha:.9,membrane:0x221122,edge:0xddaaee};
 const state={...body(a,pa).state,wings:{...wings,unexpected:'x'.repeat(10000)}};
 const events=[1,2,3].map((amount,i)=>({...event(i+1,'death'),amount,duration:2300}));
 assert.equal(relay.sync(body(a,pa,{state,events}),'ip1')[0],200);
 const result=relay.sync(body(b,pb),'ip2');assert.equal(result[0],200);assert.deepEqual(result[1].players[0].state.wings,wings);assert.deepEqual(result[1].events.map(e=>e.amount),[1,2,3]);
 for(const key of Object.keys(wings))assert.equal(relay.sync(body(a,pa,{state:{wings:{...wings,[key]:Infinity}}}),'ip1')[0],400);
 assert.equal(relay.sync(body(a,pa,{state:{target:null,mace:null}}),'ip1')[0],200);
 relay.clear();
});

// r10 events stay bounded; legacy consumers see only their supported protocol subset.
test('r10 arrows/daggers/meteors and legacy reply downgrade',()=>{
 const r=createVisualRelay();const session='10000000-0000-0000-0000-000000000010',owner='20000000-0000-0000-0000-000000000010',room='a'.repeat(64);
 const event={id:1,target:'30000000-0000-0000-0000-000000000010',kind:'target',style:8,duration:3000,radius:1,amount:9,color:0xabcdef,glow:1,seed:0,x:0,y:64,z:0,height:1.8};
 const body={session,player:owner,room,cursor:0,state:{target:null,mace:null,wings:null},events:[event],visualVersion:10};assert.equal(r.sync(body,'r10')[0],200);
 const other={...body,session:'10000000-0000-0000-0000-000000000011',player:'20000000-0000-0000-0000-000000000011',events:[]};
 let reply=r.sync(other,'peer')[1];assert.equal(reply.events[0].style,8);assert.equal(reply.events[0].amount,9);
 reply=r.sync({...other,visualVersion:7},'peer')[1];assert.equal(reply.events[0].style,4);assert.equal(reply.events[0].duration,1500);assert.equal(reply.events[0].amount,5);
});
