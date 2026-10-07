import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {createPresenceServer} from './server.mjs';import {createVisualRelay,validImage,validPreset,validCosmetics} from './visual-relay.mjs';import {PNG} from './v14-fixture.mjs';
const menu={open:true,category:0,selected:'Effect Studio',cursorX:.36,cursorY:.58,press:true,image:PNG,entries:[{name:'Effect Studio',on:true}],settings:[{name:'Form',value:'Ribbons'}]};
const preset={shape:1,motion:2,count:24,scale:1.2,radius:3,duration:1200,glow:.9,primary:0x8bd9ed,secondary:0xe6c0ff};
const cosmetics={model:{form:1,strength:.8},drone:{x:2,y:2,z:1,yaw:1,bank:.1,age:200,crash:.2,size:1.2}};
const room='a'.repeat(64),target=randomUUID();
const event=(id,kind,style)=>({id,kind,style,target,duration:1200,radius:1.2,amount:3,color:0x8bd9ed,glow:.9,seed:20,x:1,y:64,z:2,height:1.8,preset});
test('v14 exact GUI image, hands, model, drone and Studio across two HTTP peers',async()=>{
 const server=createPresenceServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`,a=randomUUID(),b=randomUUID(),pa=randomUUID(),pb=randomUUID();
 const send=async(session,player,state={},events=[],version=14)=>{const r=await fetch(url+'/v1/visuals/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session,player,room,cursor:0,state,events,visualVersion:version})});return [r.status,await r.json()];};
 try{
  const caps=await(await fetch(url+'/v1/capabilities')).json();assert.equal(caps.visualVersion,14);assert.equal(caps.menuImage,true);
  assert.equal((await send(a,pa,{menu,cosmetics},[event(1,'impact',5),event(2,'death_v2',6)]))[0],200);
  let [code,reply]=await send(b,pb);assert.equal(code,200);assert.equal(reply.players[0].state.menu.image,PNG);assert.equal(reply.players[0].state.menu.press,true);assert.deepEqual(reply.players[0].state.cosmetics,cosmetics);assert.deepEqual(reply.events.map(e=>e.kind),['impact','death_v2']);assert.deepEqual(reply.events[0].preset,preset);
  reply=(await send(b,pb,{},[],13))[1];assert.equal(reply.events.length,0);assert.equal(reply.players[0].state.menu.image,undefined);assert.equal(reply.players[0].state.cosmetics,undefined);
  reply=(await send(b,pb))[1];assert.equal(reply.players[0].state.menu.image,PNG);assert.equal(reply.events.length,2);
  assert.equal((await send(a,pa,{menu:{...menu,image:'x'.repeat(180000)}}))[0],400);
  assert.equal((await send(a,pa,{},[{...event(3,'impact',5),preset:{...preset,count:33}}]))[0],400);
  assert.equal((await send(a,pa,{},[{...event(3,'death_v2',6),preset:undefined}]))[0],400);
  assert.equal((await send(a,pa,{menu},[],13))[0],400);
  await send(a,pa,{menu:{open:false}});reply=(await send(b,pb))[1];assert.deepEqual(reply.players[0].state.menu,{open:false});
 }finally{await new Promise(r=>server.close(r));}
});
test('v14 image dimensions, presets and drone inputs are bounded',()=>{
 assert.ok(validImage(PNG));const bytes=Buffer.from(PNG,'base64');bytes.writeUInt32BE(100000,16);assert.equal(validImage(bytes.toString('base64')),false);assert.equal(validImage('%%%'),false);
 for(const p of [{...preset,shape:5},{...preset,count:3},{...preset,scale:Infinity},{...preset,duration:2501},{...preset,primary:-1}])assert.equal(validPreset(p),false);
 for(const drone of [{...cosmetics.drone,x:49},{...cosmetics.drone,crash:4.3},{...cosmetics.drone,bank:NaN},{...cosmetics.drone,age:1.5}])assert.equal(validCosmetics({drone}),false);
});
test('v14 saturated room obeys byte limit, expiry and isolation',()=>{
 let clock=0;const relay=createVisualRelay({now:()=>clock});const request=state=>({session:randomUUID(),player:randomUUID(),room,cursor:0,state,events:[],visualVersion:14});for(let i=0;i<14;i++)assert.equal(relay.sync(request({menu}),'ip'+i)[0],200);
 let reply=relay.sync(request({}),'viewer')[1];assert.ok(Buffer.byteLength(JSON.stringify(reply))<=1000000);assert.ok(reply.players.length<=12);
 assert.equal(relay.sync({...request({}),room:'b'.repeat(64)},'isolation')[1].players.length,0);clock=6001;relay.sweep();reply=relay.sync(request({}),'new')[1];assert.equal(reply.players.length,0);
});
