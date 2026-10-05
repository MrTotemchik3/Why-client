import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPresenceServer} from './server.mjs';
import {createVisualRelay} from './visual-relay.mjs';
const room='a'.repeat(64),target=randomUUID();
const event=(id=1,kind='target')=>({id,kind,target,style:kind==='target'?4:0,duration:900,radius:2,amount:3,color:0xb2a3ff,glow:.9,seed:42,x:1,y:64,z:1,height:1.8});
const body=(session,player,extra={})=>({session,player,room,cursor:0,state:{target:{target,style:4,size:1,speed:1,glow:.9,quality:1,color:0xb2a3ff},mace:{strike:0,idle:0,strength:1,idleStrength:.7,tempo:1,idleTempo:1}},events:[],...extra});
test('v12 live menu: two HTTP clients, switching, closing, old clients, bounds and TTL',async()=>{
 let clock=100000;const server=createPresenceServer({now:()=>clock});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}/v1/visuals/sync`,a=randomUUID(),b=randomUUID(),pa=randomUUID(),pb=randomUUID();
 const menu={open:true,category:6,selected:'Items Edition',cursorX:.4,cursorY:.7,entries:[{name:'Items Edition',on:true}],settings:[{name:'Duration',value:'1.8'}]};
 const send=async(session,player,state,version=12)=>{const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body(session,player,{state,visualVersion:version}))});return [res.status,await res.json()];};
 try{
  assert.equal((await send(a,pa,{menu:{...menu,secret:'ignored'}}))[0],200);
  assert.deepEqual((await send(b,pb,{}))[1].players[0].state.menu,menu);
  assert.equal((await send(b,pb,{},11))[1].players[0].state.menu,undefined);
  assert.deepEqual((await send(b,pb,{}))[1].players[0].state.menu,menu);
  assert.equal((await send(a,pa,{menu:{...menu,cursorX:2}}))[0],400);
  assert.equal((await send(a,pa,{menu:{...menu,selected:'bad\nlabel'}}))[0],400);
  assert.equal((await send(a,pa,{menu:{...menu,entries:Array(13).fill({name:'x',on:true})}}))[0],400);
  await send(a,pa,{menu:{open:false}});assert.deepEqual((await send(b,pb,{}))[1].players[0].state.menu,{open:false});
  clock+=6001;assert.equal((await send(b,pb,{}))[1].players.length,0);
 }finally{await new Promise(r=>server.close(r));}
});
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

test('r11 world snapshots and positional events traverse two real HTTP clients',async()=>{
 const server=createPresenceServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}/v1/visuals/sync`,a=randomUUID(),b=randomUUID(),pa=randomUUID(),pb=randomUUID();
 const world={values:{clock:[42],aura:[2,1.2,1,8,0xabcdef],trail:[650,4,6],model:[1,1,1,1],cape:[2,.55,0xabcabc],weather:[1,128,1,1,0xffffff],effects:[1,1,1,2,1,.7,0xabcdef,1,0xffabcd,1,1],drone:[0,1,65,2,90,10,15,0],inspect:[.9],block:[1,64,1,0,1,1,.22,.013,.75,1,0xabcdef],sky:[5,1,1,2,1,1,1,1,0,.15,.6,1.2,.7,0,.15]},markers:[{kind:0,target,name:'Метка',x:1,y:66,z:1,color:0xffffff,remaining:3000},{kind:1,target:null,name:'Дом',x:4,y:64,z:2,color:0xabcdef,remaining:120000}]};
 const events=[0,1,2,3,4,6].map((style,i)=>({...event(i+1,'world'),style,amount:style<3?3:1,duration:style===1?5000:1600}));
 const send=async payload=>{const res=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});return [res.status,await res.json()];};
 try{
  assert.equal((await send(body(a,pa,{state:{world},events,visualVersion:11})))[0],200);
  let [code,reply]=await send(body(b,pb,{visualVersion:11}));assert.equal(code,200);assert.deepEqual(reply.players[0].state.world,world);assert.deepEqual(reply.events.map(e=>e.style),[0,1,2,3,4,6]);
  const legacy=(await send(body(b,pb,{visualVersion:10})))[1];assert.equal(legacy.players[0].state.world,undefined);assert.equal(legacy.events.length,0);
  const modern=(await send(body(b,pb,{visualVersion:11})))[1];assert.deepEqual(modern.players[0].state.world,world,'legacy replies must not mutate stored state');
  assert.equal((await send(body(b,pb,{visualVersion:11,cursor:reply.cursor})))[1].events.length,0);
  await send(body(a,pa,{state:{world:{values:{clock:[43]},markers:[]}},visualVersion:11}));reply=(await send(body(b,pb,{visualVersion:11})))[1];assert.equal(reply.players[0].state.world.values.aura,undefined);assert.deepEqual(reply.players[0].state.world.markers,[]);
 }finally{await new Promise(r=>server.close(r));}
});

test('r11 schema rejects invalid world values, oversized markers and unsafe labels',()=>{
 const relay=createVisualRelay(),a=randomUUID(),pa=randomUUID();const send=world=>relay.sync(body(a,pa,{state:{world},visualVersion:11}),'ip')[0];
 const w={values:{aura:[2,1.2,1,8,0xabcdef]},markers:[]};assert.equal(send(w),200);
 for(const values of [{aura:[3,1.2,1,8,0xabcdef]},{aura:[2,NaN,1,8,0xabcdef]},{aura:[2,1.2,1,8.5,0xabcdef]},{aura:[2,1.2]},{unrecognized:[1]}])assert.equal(send({...w,values}),400);
 const marker={kind:0,target:null,name:'Home',x:0,y:64,z:0,color:0xffffff,remaining:3000};
 for(const override of [{name:'x'.repeat(41)},{name:'§k hidden'},{name:'bad\nlabel'},{y:Infinity},{color:-1},{target:'wrong-id'},{remaining:120001}])assert.equal(send({...w,markers:[{...marker,...override}]}),400);
 assert.equal(send({...w,markers:Array.from({length:15},()=>marker)}),400);assert.equal(send({...w,unexpected:true}),400);
});

test('r11 reply is byte bounded under saturated rooms and preserves old room isolation',()=>{
 const relay=createVisualRelay();const world={values:{aura:[2,2,2,8,0xffffff]},markers:Array.from({length:14},(_,i)=>({kind:1,target:null,name:'Я'.repeat(40),x:i,y:64,z:i,color:0xffffff,remaining:120000}))};
 for(let i=0;i<20;i++)assert.equal(relay.sync(body(randomUUID(),randomUUID(),{state:{world},visualVersion:11,events:Array.from({length:8},(_,j)=>({...event(i*8+j+1),duration:3000}))}),'ip'+i)[0],200);
 let [code,reply]=relay.sync(body(randomUUID(),randomUUID(),{visualVersion:11}),'viewer');assert.equal(code,200);assert.ok(reply.players.length<=12);assert.ok(Buffer.byteLength(JSON.stringify(reply))<=64000);assert.ok(reply.events.length<=64);
 reply=relay.sync(body(randomUUID(),randomUUID(),{room:'b'.repeat(64),visualVersion:11}),'viewer2')[1];assert.equal(reply.players.length,0);assert.equal(reply.events.length,0);
});
