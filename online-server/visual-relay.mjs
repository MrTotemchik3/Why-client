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
export function validMenu(m){
  if(!m||typeof m!=="object"||Array.isArray(m)||typeof m.open!=="boolean")return false;
  if(!m.open)return true;
  const label=s=>typeof s==="string"&&s.length<=64&&!/[\u0000-\u001f\u007f§]/u.test(s);
  return integer(m.category,0,7)&&label(m.selected)&&number(m.cursorX,0,1)&&number(m.cursorY,0,1)
    &&Array.isArray(m.entries)&&m.entries.length<=12&&m.entries.every(e=>e&&label(e.name)&&typeof e.on==="boolean")
    &&Array.isArray(m.settings)&&m.settings.length<=6&&m.settings.every(e=>e&&label(e.name)&&label(e.value));
}
const cleanMenu=m=>m.open?{open:true,category:m.category,selected:m.selected,cursorX:m.cursorX,cursorY:m.cursorY,entries:m.entries.map(e=>({name:e.name,on:e.on})),settings:m.settings.map(e=>({name:e.name,value:e.value}))}:{open:false};
export function validState(s){
  if(!s||typeof s!=='object'||Array.isArray(s))return false;const t=s.target,m=s.mace,w=s.wings;if(s.menu!=null&&!validMenu(s.menu))return false;if(s.world!=null&&!validWorld(s.world))return false;
  if(t!=null&&(!UUID.test(t.target??'')||!integer(t.style,0,8)||!number(t.size,.5,2)||!number(t.speed,.2,2.5)||!number(t.glow,.2,1)||!integer(t.quality,0,2)||!integer(t.color,0,0xffffff)))return false;
  if(w!=null&&(!number(w.size,.55,1.5)||!number(w.speed,.2,2)||!number(w.spread,.45,1.15)||!number(w.glow,.2,1)||!number(w.alpha,.35,1)||!integer(w.membrane,0,0xffffff)||!integer(w.edge,0,0xffffff)))return false;
  return m==null||(integer(m.strike,0,7)&&integer(m.idle,0,4)&&number(m.strength,.2,1.6)&&number(m.idleStrength,0,1.5)&&number(m.tempo,.5,2)&&number(m.idleTempo,.25,2));
}
export function validEvent(e){
  if(!e||!integer(e.id,1,Number.MAX_SAFE_INTEGER)||!UUID.test(e.target??'')||!['target','mace','death','world'].includes(e.kind)||!integer(e.delayMs??0,0,3000))return false;
  const style=e.kind==='target'?8:e.kind==='mace'?5:e.kind==='world'?6:0,min=e.kind==='target'?850:e.kind==='mace'?250:e.kind==='world'?200:650,max=e.kind==='target'?3000:e.kind==='mace'?2000:e.kind==='world'?5000:2500;
  if(e.kind==='world'&&!integer(e.amount,1,[0,1,2,6].includes(e.style)?3:1))return false;
  return integer(e.style,0,style)&&number(e.duration,min,max)&&number(e.radius,.5,6)&&integer(e.amount,1,e.kind==='target'?9:32)&&integer(e.color,0,0xffffff)&&number(e.glow,.2,1)&&integer(e.seed,0,1000000)&&number(e.x,-30000000,30000000)&&number(e.y,-2048,2048)&&number(e.z,-30000000,30000000)&&number(e.height,.1,8);
}
// Strip unknown fields so one peer cannot multiply response/memory size through extra JSON.
const pick=(o,keys)=>Object.fromEntries(keys.map(k=>[k,o[k]]));
const cleanWorld=w=>({values:Object.fromEntries(Object.entries(w.values).map(([key,data])=>[key,data.map((n,i)=>Math.max(WORLD_SCHEMA[key][i][0],Math.min(WORLD_SCHEMA[key][i][1],n)))])),markers:w.markers.map(m=>pick(m,['kind','target','name','x','y','z','color','remaining']))});
const cleanState=s=>({...(s.menu==null?{}:{menu:cleanMenu(s.menu)}),target:s.target==null?null:pick(s.target,['target','style','size','speed','glow','quality','color']),mace:s.mace==null?null:pick(s.mace,['strike','idle','strength','idleStrength','tempo','idleTempo']),wings:s.wings==null?null:pick(s.wings,['size','speed','spread','glow','alpha','membrane','edge']),...(s.world==null?{}:{world:cleanWorld(s.world)})});
const cleanEvent=e=>pick(e,['id','target','kind','style','duration','radius','amount','color','glow','seed','x','y','z','height']);
/** Cosmetic snapshots and a bounded, three-second event ring, isolated by world-room hash. */
export function createVisualRelay({now=Date.now,maxSessions=20000}={}){
  const peers=new Map(),rooms=new Map();
  const sweep=()=>{const t=now();for(const [id,p]of peers)if(t-p.at>6000)peers.delete(id);for(const [room,r]of rooms){r.events=r.events.filter(e=>t-e.at<3000);if(t-r.at>6000)rooms.delete(room);}};
  const sync=(body,ip)=>{
    sweep();if(!UUID.test(body.session??'')||!UUID.test(body.player??'')||!ROOM.test(body.room??'')||!integer(body.cursor,0,Number.MAX_SAFE_INTEGER)||!validState(body.state)||!Array.isArray(body.events)||body.events.length>8||!body.events.every(validEvent))return [400,{error:'invalid_visuals'}];
    let peer=peers.get(body.session);
    if(peer&&(peer.ip!==ip||peer.player!==body.player))return [409,{error:'session_conflict'}];
    if(!peer){if(peers.size>=maxSessions)return [503,{error:'capacity'}];let n=0;for(const p of peers.values())if(p.ip===ip)n++;if(n>=64)return [429,{error:'session_limit'}];peer={ip,player:body.player,lastId:0,requests:0,rateAt:now()};}
    if(now()-peer.rateAt>=60000){peer.rateAt=now();peer.requests=0;}if(++peer.requests>300)return [429,{error:'rate_limit'}];
    let room=rooms.get(body.room);if(!room){if(rooms.size>=2000)return [503,{error:'room_capacity'}];room={seq:0,at:now(),events:[]};rooms.set(body.room,room);}
    Object.assign(peer,{at:now(),room:body.room,state:cleanState(body.state)});peers.set(body.session,peer);room.at=now();
    for(const event of body.events){if(event.id<=peer.lastId)continue;peer.lastId=event.id;room.events.push({...cleanEvent(event),owner:body.player,session:body.session,sequence:++room.seq,at:now()-(event.delayMs??0)});}
    if(room.events.length>256)room.events.splice(0,room.events.length-256);
    const players=[];for(const [session,p]of peers)if(session!==body.session&&p.player!==body.player&&p.room===body.room&&players.length<((body.visualVersion??0)>=11?12:32))players.push({player:p.player,state:p.state});
    if((body.visualVersion??0)<12)for(const p of players)if(p.state.menu)p.state={...p.state,menu:undefined};
    let events=room.events.filter(e=>e.sequence>body.cursor&&e.session!==body.session&&e.owner!==body.player).slice(-64).map(({at,session,...e})=>({...e,ageMs:now()-at}));
    if((body.visualVersion??0)<11){for(const p of players)if(p.state.world)p.state={...p.state,world:undefined};events=events.filter(e=>e.kind!=='world');}
    // New capabilities are opt-in. Old r6/r7 clients retain their original validated bounds.
    if((body.visualVersion??0)<10){
      for(const p of players)if(p.state.target)p.state={...p.state,target:{...p.state.target,style:Math.min(4,p.state.target.style)}};
      for(const e of events)if(e.kind==='target'){e.style=Math.min(4,e.style);e.duration=Math.min(1500,e.duration);e.amount=Math.min(5,e.amount);}
    }
    const reply={cursor:room.seq,players,events};
    // Keep the UTF-8 response below the client's 64 KiB hard limit, including Cyrillic labels.
    while(Buffer.byteLength(JSON.stringify(reply),'utf8')>64000){if(players.length)players.pop();else if(events.length)events.shift();else break;}
    return [200,reply];
  };
  return {sync,sweep,clear:()=>{peers.clear();rooms.clear();}};
}
