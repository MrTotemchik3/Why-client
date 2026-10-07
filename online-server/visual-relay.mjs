import {readFileSync} from 'node:fs';
const WORLD_SCHEMA=JSON.parse(readFileSync(new URL('./world-schema.json',import.meta.url),'utf8'));
const UUID=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i,ROOM=/^[a-f\d]{64}$/;
const number=(n,a,b)=>typeof n==='number'&&Number.isFinite(n)&&n>=a&&n<=b;
const integer=(n,a,b)=>Number.isInteger(n)&&number(n,a,b);
export function validWorld(w){
  if(!w||typeof w!=='object'||Array.isArray(w)||Object.keys(w).length!==2||!w.values||typeof w.values!=='object'||Array.isArray(w.values)||!Array.isArray(w.markers)||w.markers.length>14)return false;
  for(const [key,data]of Object.entries(w.values)){
    const ranges=WORLD_SCHEMA[key];if(!ranges||!Array.isArray(data)||data.length!==ranges.length)return false;
    if(!data.every((n,i)=>number(n,ranges[i][0]-1e-6,ranges[i][1]+1e-6)&&(!ranges[i][2]||Number.isInteger(n))))return false;
  }
  return w.markers.every(m=>m&&integer(m.kind,0,1)&&(m.target==null||UUID.test(m.target))&&typeof m.name==='string'&&m.name.length<=40&&!/[\u0000-\u001f\u007f§]/u.test(m.name)&&number(m.x,-30000000,30000000)&&number(m.y,-2048,2048)&&number(m.z,-30000000,30000000)&&integer(m.color,0,0xffffff)&&number(m.remaining,0,120000));
}
export function validPreset(p){return p&&typeof p==='object'&&!Array.isArray(p)&&integer(p.shape,0,4)&&integer(p.motion,0,3)&&integer(p.count,4,32)&&number(p.scale,.3-1e-6,2+1e-6)&&number(p.radius,.5,4)&&number(p.duration,450,2500)&&number(p.glow,.2-1e-6,1+1e-6)&&integer(p.primary,0,0xffffff)&&integer(p.secondary,0,0xffffff);}
const cleanPreset=p=>pick(p,['shape','motion','count','scale','radius','duration','glow','primary','secondary']);
export function validImage(text){
  if(typeof text!=='string'||text.length<48||text.length>174764||! /^[A-Za-z0-9+/]*={0,2}$/.test(text))return false;
  const b=Buffer.from(text,'base64');if(b.length<45||b.length>131072||b.readBigUInt64BE(0)!==0x89504e470d0a1a0an||b.readUInt32BE(8)!==13||b.toString('ascii',12,16)!=='IHDR')return false;
  const w=b.readUInt32BE(16),h=b.readUInt32BE(20);return integer(w,256,1024)&&integer(h,128,768)&&w*h<=786432&&b[24]===8&&[2,6].includes(b[25])&&b[26]===0&&b[27]===0&&b[28]===0;
}
export function validCosmetics(o){
  if(!o||typeof o!=='object'||Array.isArray(o))return false;const m=o.model,d=o.drone;
  return (m==null||(integer(m.form,0,2)&&number(m.strength,.25,1)))&&(d==null||(number(d.x,-48,48)&&number(d.y,-48,48)&&number(d.z,-48,48)&&number(d.yaw,-Math.PI,Math.PI)&&number(d.bank,-.4,.4)&&integer(d.age,0,1000000)&&number(d.crash,0,4.2)&&number(d.size,.6-1e-6,1.8+1e-6)));
}
const cleanCosmetics=o=>({...(!o.model?{}:{model:pick(o.model,['form','strength'])}),...(!o.drone?{}:{drone:pick(o.drone,['x','y','z','yaw','bank','age','crash','size'])})});
export function validMenu(m){
  if(!m||typeof m!=="object"||Array.isArray(m)||typeof m.open!=="boolean")return false;
  if(m.press!=null&&typeof m.press!=="boolean")return false;if(m.image!=null&&!validImage(m.image))return false;
  if(!m.open)return m.image==null;
  const label=s=>typeof s==="string"&&s.length<=64&&!/[\u0000-\u001f\u007f§]/u.test(s);
  return integer(m.category,0,7)&&label(m.selected)&&number(m.cursorX,0,1)&&number(m.cursorY,0,1)
    &&Array.isArray(m.entries)&&m.entries.length<=12&&m.entries.every(e=>e&&label(e.name)&&typeof e.on==="boolean")
    &&Array.isArray(m.settings)&&m.settings.length<=6&&m.settings.every(e=>e&&label(e.name)&&label(e.value));
}
const cleanMenu=m=>m.open?{open:true,category:m.category,selected:m.selected,cursorX:m.cursorX,cursorY:m.cursorY,entries:m.entries.map(e=>({name:e.name,on:e.on})),settings:m.settings.map(e=>({name:e.name,value:e.value})),...(m.press==null?{}:{press:m.press}),...(m.image==null?{}:{image:m.image})}:{open:false};
export function validState(s){
  if(!s||typeof s!=='object'||Array.isArray(s))return false;const t=s.target,m=s.mace,w=s.wings;if(s.cosmetics!=null&&!validCosmetics(s.cosmetics))return false;if(s.menu!=null&&!validMenu(s.menu))return false;if(s.world!=null&&!validWorld(s.world))return false;
  if(t!=null&&(!UUID.test(t.target??'')||!integer(t.style,0,8)||!number(t.size,.5,2)||!number(t.speed,.2,2.5)||!number(t.glow,.2,1)||!integer(t.quality,0,2)||!integer(t.color,0,0xffffff)))return false;
  if(w!=null&&((w.style!=null&&!integer(w.style,0,2))||!number(w.size,.55,1.5)||!number(w.speed,.2,2)||!number(w.spread,.45,1.15)||!number(w.glow,.2,1)||!number(w.alpha,.35,1)||!integer(w.membrane,0,0xffffff)||!integer(w.edge,0,0xffffff)))return false;
  return m==null||(integer(m.strike,0,7)&&integer(m.idle,0,4)&&number(m.strength,.2,1.6)&&number(m.idleStrength,0,1.5)&&number(m.tempo,.5,2)&&number(m.idleTempo,.25,2));
}
export function validEvent(e){
  if(!e||!integer(e.id,1,Number.MAX_SAFE_INTEGER)||!UUID.test(e.target??'')||!['target','mace','death','world','impact','custom_death','death_v2'].includes(e.kind)||!integer(e.delayMs??0,0,3000))return false;
  const style=e.kind==='target'?8:e.kind==='mace'?5:e.kind==='world'?6:e.kind==='impact'?5:e.kind==='death_v2'?6:e.kind==='custom_death'?2:0,min=(e.kind==='target'||e.kind==='impact')?450:e.kind==='mace'?250:e.kind==='world'?200:650,max=e.kind==='target'?3000:e.kind==='impact'?1500:e.kind==='mace'?2000:e.kind==='world'?5000:2500;
  if(e.preset!=null&&!validPreset(e.preset))return false;if((e.kind==='impact'&&e.style===5||e.kind==='death_v2'&&e.style===6)&&!validPreset(e.preset))return false;
  if(e.kind==='world'&&!integer(e.amount,1,[0,1,2,6].includes(e.style)?3:1))return false;
  return integer(e.style,0,style)&&number(e.duration,min,max)&&number(e.radius,.5,6)&&integer(e.amount,1,e.kind==='target'?9:e.kind==='impact'?5:32)&&integer(e.color,0,0xffffff)&&number(e.glow,.2,1)&&integer(e.seed,0,1000000)&&number(e.x,-30000000,30000000)&&number(e.y,-2048,2048)&&number(e.z,-30000000,30000000)&&number(e.height,.1,8);
}
// Strip unknown fields so one peer cannot multiply response/memory size through extra JSON.
const pick=(o,keys)=>Object.fromEntries(keys.map(k=>[k,o[k]]));
const cleanWorld=w=>({values:Object.fromEntries(Object.entries(w.values).map(([key,data])=>[key,data.map((n,i)=>Math.max(WORLD_SCHEMA[key][i][0],Math.min(WORLD_SCHEMA[key][i][1],n)))])),markers:w.markers.map(m=>pick(m,['kind','target','name','x','y','z','color','remaining']))});
const cleanWings=w=>({...pick(w,['size','speed','spread','glow','alpha','membrane','edge']),...(w.style==null?{}:{style:w.style})});
const cleanState=s=>({...(!s.cosmetics?{}:{cosmetics:cleanCosmetics(s.cosmetics)}),...(s.menu==null?{}:{menu:cleanMenu(s.menu)}),target:s.target==null?null:pick(s.target,['target','style','size','speed','glow','quality','color']),mace:s.mace==null?null:pick(s.mace,['strike','idle','strength','idleStrength','tempo','idleTempo']),wings:s.wings==null?null:cleanWings(s.wings),...(s.world==null?{}:{world:cleanWorld(s.world)})});
const cleanEvent=e=>({...pick(e,['id','target','kind','style','duration','radius','amount','color','glow','seed','x','y','z','height']),...(e.preset==null?{}:{preset:cleanPreset(e.preset)})});
/** Cosmetic snapshots and a bounded, three-second event ring, isolated by world-room hash. */
export function createVisualRelay({now=Date.now,maxSessions=20000}={}){
  const peers=new Map(),rooms=new Map();let imageBytes=0;
  const sweep=()=>{const t=now();for(const [id,p]of peers)if(t-p.at>6000){imageBytes-=p.state?.menu?.image?.length??0;peers.delete(id);}for(const [room,r]of rooms){r.events=r.events.filter(e=>t-e.at<3000);if(t-r.at>6000)rooms.delete(room);}};
  const sync=(body,ip)=>{
    sweep();if(!UUID.test(body.session??'')||!UUID.test(body.player??'')||!ROOM.test(body.room??'')||!integer(body.cursor,0,Number.MAX_SAFE_INTEGER)||!validState(body.state)||!Array.isArray(body.events)||body.events.length>8||!body.events.every(validEvent))return [400,{error:'invalid_visuals'}];
    if((body.visualVersion??0)<14&&(body.state.menu?.image!=null||body.state.cosmetics!=null||body.events.some(e=>e.kind==='death_v2'||e.kind==='impact'&&e.style>2||e.preset!=null)))return [400,{error:'version_required'}];
    let peer=peers.get(body.session);
    if(peer&&(peer.ip!==ip||peer.player!==body.player))return [409,{error:'session_conflict'}];
    if(!peer){if(peers.size>=maxSessions)return [503,{error:'capacity'}];let n=0;for(const p of peers.values())if(p.ip===ip)n++;if(n>=64)return [429,{error:'session_limit'}];peer={ip,player:body.player,lastId:0,requests:0,rateAt:now()};}
    if(now()-peer.rateAt>=60000){peer.rateAt=now();peer.requests=0;}if(++peer.requests>300)return [429,{error:'rate_limit'}];
    let room=rooms.get(body.room);if(!room){if(rooms.size>=2000)return [503,{error:'room_capacity'}];room={seq:0,at:now(),events:[]};rooms.set(body.room,room);}
    const nextImage=body.state.menu?.image?.length??0,previousImage=peer.state?.menu?.image?.length??0;if(imageBytes-previousImage+nextImage>8*1024*1024)return [503,{error:'image_capacity'}];imageBytes+=nextImage-previousImage;
    Object.assign(peer,{at:now(),room:body.room,state:cleanState(body.state)});peers.set(body.session,peer);room.at=now();
    for(const event of body.events){if(event.id<=peer.lastId)continue;peer.lastId=event.id;room.events.push({...cleanEvent(event),owner:body.player,session:body.session,sequence:++room.seq,at:now()-(event.delayMs??0)});}
    if(room.events.length>256)room.events.splice(0,room.events.length-256);
    const players=[];for(const [session,p]of peers)if(session!==body.session&&p.player!==body.player&&p.room===body.room&&players.length<((body.visualVersion??0)>=11?12:32))players.push({player:p.player,state:p.state});
    if((body.visualVersion??0)<12)for(const p of players)if(p.state.menu)p.state={...p.state,menu:undefined};
    let events=room.events.filter(e=>e.sequence>body.cursor&&e.session!==body.session&&e.owner!==body.player).slice(-64).map(({at,session,...e})=>({...e,ageMs:now()-at}));
    if((body.visualVersion??0)<14){
      events=events.filter(e=>e.kind!=='death_v2'&&(e.kind!=='impact'||e.style<=2));
      for(const p of players){let state={...p.state};delete state.cosmetics;if(state.menu){const {image,press,...menu}=state.menu;state.menu=menu;}p.state=state;}
      events=events.map(e=>{const {preset,...rest}=e;return rest;});
    }
    if((body.visualVersion??0)<13){
      events=events.filter(e=>e.kind!=='impact'&&e.kind!=='custom_death');
      for(const p of players)if(p.state.wings?.style!=null){const {style,...wings}=p.state.wings;p.state={...p.state,wings:style===1?wings:null};}
    }
    if((body.visualVersion??0)<11){for(const p of players)if(p.state.world)p.state={...p.state,world:undefined};events=events.filter(e=>e.kind!=='world');}
    // New capabilities are opt-in. Old r6/r7 clients retain their original validated bounds.
    if((body.visualVersion??0)<10){
      for(const p of players)if(p.state.target)p.state={...p.state,target:{...p.state.target,style:Math.min(4,p.state.target.style)}};
      for(const e of events)if(e.kind==='target'){e.style=Math.min(4,e.style);e.duration=Math.min(1500,e.duration);e.amount=Math.min(5,e.amount);}
    }
    const reply={cursor:room.seq,players,events};
    // Keep the UTF-8 response below the client's 64 KiB hard limit, including Cyrillic labels.
    while(Buffer.byteLength(JSON.stringify(reply),'utf8')>((body.visualVersion??0)>=14?1000000:64000)){if(players.length)players.pop();else if(events.length)events.shift();else break;}
    return [200,reply];
  };
  return {sync,sweep,clear:()=>{peers.clear();rooms.clear();imageBytes=0;}};
}
