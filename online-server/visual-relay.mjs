const UUID=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i,ROOM=/^[a-f\d]{64}$/;
const number=(n,a,b)=>typeof n==='number'&&Number.isFinite(n)&&n>=a&&n<=b;
const integer=(n,a,b)=>Number.isInteger(n)&&number(n,a,b);
export function validState(s){
  if(!s||typeof s!=='object'||Array.isArray(s))return false;const t=s.target,m=s.mace,w=s.wings;
  if(t!=null&&(!UUID.test(t.target??'')||!integer(t.style,0,8)||!number(t.size,.5,2)||!number(t.speed,.2,2.5)||!number(t.glow,.2,1)||!integer(t.quality,0,2)||!integer(t.color,0,0xffffff)))return false;
  if(w!=null&&(!number(w.size,.55,1.5)||!number(w.speed,.2,2)||!number(w.spread,.45,1.15)||!number(w.glow,.2,1)||!number(w.alpha,.35,1)||!integer(w.membrane,0,0xffffff)||!integer(w.edge,0,0xffffff)))return false;
  return m==null||(integer(m.strike,0,7)&&integer(m.idle,0,4)&&number(m.strength,.2,1.6)&&number(m.idleStrength,0,1.5)&&number(m.tempo,.5,2)&&number(m.idleTempo,.25,2));
}
export function validEvent(e){
  if(!e||!integer(e.id,1,Number.MAX_SAFE_INTEGER)||!UUID.test(e.target??'')||!['target','mace','death'].includes(e.kind)||!integer(e.delayMs??0,0,3000))return false;
  const style=e.kind==='target'?8:e.kind==='mace'?5:0,min=e.kind==='target'?850:e.kind==='mace'?250:650,max=e.kind==='target'?3000:e.kind==='mace'?2000:2500;
  return integer(e.style,0,style)&&number(e.duration,min,max)&&number(e.radius,.5,6)&&integer(e.amount,1,e.kind==='target'?9:32)&&integer(e.color,0,0xffffff)&&number(e.glow,.2,1)&&integer(e.seed,0,1000000)&&number(e.x,-30000000,30000000)&&number(e.y,-2048,2048)&&number(e.z,-30000000,30000000)&&number(e.height,.1,8);
}
// Strip unknown fields so one peer cannot multiply response/memory size through extra JSON.
const pick=(o,keys)=>Object.fromEntries(keys.map(k=>[k,o[k]]));
const cleanState=s=>({target:s.target==null?null:pick(s.target,['target','style','size','speed','glow','quality','color']),mace:s.mace==null?null:pick(s.mace,['strike','idle','strength','idleStrength','tempo','idleTempo']),wings:s.wings==null?null:pick(s.wings,['size','speed','spread','glow','alpha','membrane','edge'])});
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
    const players=[];for(const [session,p]of peers)if(session!==body.session&&p.player!==body.player&&p.room===body.room&&players.length<32)players.push({player:p.player,state:p.state});
    const events=room.events.filter(e=>e.sequence>body.cursor&&e.session!==body.session&&e.owner!==body.player).slice(-64).map(({at,session,...e})=>({...e,ageMs:now()-at}));
    // New capabilities are opt-in. Old r6/r7 clients retain their original validated bounds.
    if((body.visualVersion??0)<10){
      for(const p of players)if(p.state.target)p.state={...p.state,target:{...p.state.target,style:Math.min(4,p.state.target.style)}};
      for(const e of events)if(e.kind==='target'){e.style=Math.min(4,e.style);e.duration=Math.min(1500,e.duration);e.amount=Math.min(5,e.amount);}
    }
    return [200,{cursor:room.seq,players,events}];
  };
  return {sync,sweep,clear:()=>{peers.clear();rooms.clear();}};
}
