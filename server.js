const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const rooms = new Map();

const scenarios = [
  { title:'Bank security alert', type:'Bank', urgency:'Your account may be restricted today.', detail:'A recent login was detected from a new device.', tell:'Urgent deadline and pressure to act immediately.' },
  { title:'Package delivery', type:'Delivery', urgency:'Your package needs action before it is returned.', detail:'A small address or delivery fee is supposedly due.', tell:'Unexpected fee or link for a delivery you may not recognize.' },
  { title:'Streaming account', type:'Streaming', urgency:'Your subscription could be canceled within 24 hours.', detail:'The message asks you to confirm billing information.', tell:'Threat of cancellation plus a request for sensitive billing data.' },
  { title:'Campus account', type:'University', urgency:'Your student account needs verification today.', detail:'The message claims access will be limited if you do not respond.', tell:'Account-lockout threat and a verification request.' },
  { title:'Work password reset', type:'Work', urgency:'Your password expires at the end of the day.', detail:'The message includes a sign-in or reset request.', tell:'Unexpected password reset link or mismatched sender.' },
  { title:'Tax refund notice', type:'Government', urgency:'A refund is waiting but must be claimed soon.', detail:'The message requests personal information to release funds.', tell:'Unexpected refund and request for personal information.' },
  { title:'Cloud storage warning', type:'Cloud', urgency:'Your storage is nearly full and files may stop syncing.', detail:'The message offers a link to upgrade or review storage.', tell:'Fear of losing access used to push a rushed action.' },
  { title:'Credit card reward', type:'Financial', urgency:'Your rewards are expiring tonight.', detail:'The message encourages you to claim a benefit through a link.', tell:'Too-good-to-be-true reward paired with urgency.' }
];

function code(){ return crypto.randomBytes(2).toString('hex').toUpperCase(); }
function id(){ return crypto.randomBytes(8).toString('hex'); }
function send(ws,obj){ if(ws && ws.readyState===1) ws.send(JSON.stringify(obj)); }
function broadcast(room,obj,except){ for(const p of room.players.values()) if(p.ws!==except && p.ws) send(p.ws,obj); }
function publicState(room,viewerId=null){
  return {type:'state', phase:room.phase, roomCode:room.code, round:room.round, totalRounds:5,
    hostId:room.hostId, senderId:room.senderId, scenario:room.phase==='sender'||room.phase==='writing' ? room.scenarioPublic : (room.phase==='voting'?room.scenarioPublic:room.scenarioPublic),
    message:room.message, votes:room.phase==='reveal'?Object.fromEntries([...room.votes].map(([k,v])=>[k,v])):null,
    voteCount:[...room.votes.keys()].filter(pid=>room.players.get(pid)?.connected).length,
    eligibleVoters:[...room.players.values()].filter(p=>p.connected && p.id!==room.senderId).length,
    players:[...room.players.values()].map(p=>({id:p.id,nickname:p.nickname,score:p.score,connected:p.connected})),
    deadline:room.deadline, hasVoted:room.phase==='voting' && !!viewerId && room.votes.has(viewerId), tell:room.phase==='reveal'?room.scenario.tell:null,
    card:room.phase==='reveal'?room.card:null,
    results:room.phase==='reveal'?room.results:null,
    winner:room.phase==='finished'?room.winner:null
  };
}
function sync(room){ for(const p of room.players.values()) if(p.ws) send(p.ws,publicState(room,p.id)); }
function clearTimer(room){ if(room.timer){clearTimeout(room.timer); room.timer=null;} }
function setTimer(room,ms,fn){clearTimer(room); room.deadline=Date.now()+ms; room.timer=setTimeout(fn,ms);}
function scheduleRemaining(room, fallbackMs, fn){ const ms=Math.max(1,(room.deadline||Date.now()+fallbackMs)-Date.now()); room.timer=setTimeout(fn,ms); }
function scenarioPublic(s){ return {title:s.title,type:s.type,urgency:s.urgency,detail:s.detail}; }
function uniqueRoom(){let c; do{c=code()}while(rooms.has(c)); return c;}
function connectedPlayers(room){return [...room.players.values()].filter(p=>p.connected);}
function nextConnected(room,fromId){const arr=[...room.players.values()]; const idx=arr.findIndex(p=>p.id===fromId); for(let i=1;i<=arr.length;i++){const p=arr[(idx+i+arr.length)%arr.length]; if(p&&p.connected)return p;} return null;}

function startRound(room){
  clearTimer(room); room.senderGraceTimer=null; room.senderDisconnectDeadline=0; room.resumeDeadline=0; if(connectedPlayers(room).length<2){room.phase='lobby'; sync(room); return;}
  room.round++; if(room.round>5){finish(room);return;}
  const p=nextConnected(room,room.senderId) || connectedPlayers(room)[0]; room.senderId=p.id;
  room.scenario=scenarios[Math.floor(Math.random()*scenarios.length)]; room.card=Math.random()<0.5?'legit':'phish'; room.message=''; room.votes=new Map(); room.results=null;
  room.phase='sender'; room.scenarioPublic=scenarioPublic(room.scenario);
  sync(room); send(p.ws,{type:'senderSecret',card:room.card,scenario:room.scenario});
  setTimer(room,45000,()=>senderIdleTimeout(room));
}
function skipRound(room,reason){
  clearTimer(room);
  room.deadline=0;
  room.message='';
  room.results={skipped:true,reason};
  room.phase='reveal';
  sync(room);
  setTimer(room,10000,()=>startRound(room));
}
function senderIdleTimeout(room){
  if(room.phase!=='sender') return;
  skipRound(room,'The Sender did not start writing within 45 seconds. No points were awarded.');
}
function beginWriting(room){
  if(room.phase!=='sender')return; room.phase='writing'; sync(room); setTimer(room,90000,()=>senderTimeout(room));
}
function senderTimeout(room){
  if(room.phase!=='writing')return;
  skipRound(room,'The Sender did not submit a message within 90 seconds. No points were awarded.');
}
function beginVoting(room){
  clearTimer(room); room.phase='voting'; room.votes=new Map(); room.deadline=Date.now()+60000; sync(room); setTimer(room,60000,()=>resolveVotes(room));
}
function resolveVotes(room){
  if(room.phase!=='voting')return; clearTimer(room);
  const sender=room.players.get(room.senderId); let fooled=0; const results={}; const details={};
  for(const p of room.players.values()){
    if(!p.connected || p.id===room.senderId)continue;
    const vote=room.votes.get(p.id); if(!vote){results[p.id]={vote:null,correct:false}; details[p.id]={vote:null,correct:false}; continue;}
    const correct=vote===room.card; if(correct)p.score++;
    if(!correct)fooled++;
    results[p.id]={vote,correct}; details[p.id]={vote,correct};
  }
  if(sender) sender.score += fooled;
  room.results={fooled,details}; room.phase='reveal'; room.deadline=0; sync(room);
  setTimer(room,10000,()=>startRound(room));
}
function finish(room){
  clearTimer(room); room.phase='finished'; room.deadline=0; const ps=[...room.players.values()].sort((a,b)=>b.score-a.score); room.winner=ps[0]?{nickname:ps[0].nickname,score:ps[0].score}:null; sync(room); }

function handle(room,p,msg){
  if(!msg||typeof msg.type!=='string')return;
  if(msg.type==='ping'){send(p.ws,{type:'pong'});return;}
  if(msg.type==='start' && p.id===room.hostId){if(connectedPlayers(room).length>=2 && room.phase==='lobby')startRound(room);return;}
  if(msg.type==='restart' && p.id===room.hostId){room.players.forEach(x=>x.score=0);room.round=0;room.senderId=null;room.phase='lobby';sync(room);return;}
  if(msg.type==='ready' && p.id===room.senderId && room.phase==='sender'){beginWriting(room);return;}
  if(msg.type==='submit' && p.id===room.senderId && room.phase==='writing'){
    const text=String(msg.message||'').trim(); if(text.length<5||text.length>500)return;
    room.message=text; beginVoting(room); return;
  }
  if(msg.type==='vote' && p.id!==room.senderId && room.phase==='voting' && (msg.vote==='legit'||msg.vote==='phish')){
    if(!room.votes.has(p.id))room.votes.set(p.id,msg.vote); sync(room);
    const eligibleIds=new Set(connectedPlayers(room).filter(x=>x.id!==room.senderId).map(x=>x.id));
    const connectedVotes=[...room.votes.keys()].filter(id=>eligibleIds.has(id)).length;
    if(connectedVotes>=eligibleIds.size)resolveVotes(room);
  }
}
function onDisconnect(room,p){
  if(!p || !p.connected) return;
  p.connected=false; p.ws=null;
  if(room.hostId===p.id){const n=nextConnected(room,p.id);if(n)room.hostId=n.id;}
  if(room.senderId===p.id && ['sender','writing','voting'].includes(room.phase)){
    if(room.timer){room.resumeDeadline=room.deadline; clearTimeout(room.timer);room.timer=null;}
    room.senderDisconnectDeadline=Date.now()+25000;
    room.senderGraceTimer=setTimeout(()=>{
      if(!p.connected && room.senderId===p.id && ['sender','writing','voting'].includes(room.phase)){
        room.senderGraceTimer=null; room.senderDisconnectDeadline=0; room.resumeDeadline=0;
        skipRound(room,'The Sender disconnected and did not reconnect within the 25-second grace period. No points were awarded.');
      }
    },25000);
  }
  if(room.phase==='voting') {
    const eligibleIds=new Set(connectedPlayers(room).filter(x=>x.id!==room.senderId).map(x=>x.id));
    const connectedVotes=[...room.votes.keys()].filter(id=>eligibleIds.has(id)).length;
    if(eligibleIds.size>0 && connectedVotes>=eligibleIds.size){ resolveVotes(room); }
  }
  sync(room);
  setTimeout(()=>{
    if(!p.connected){
      room.players.delete(p.id);
      if(room.players.size===0){rooms.delete(room.code);return;}
      if(room.hostId===p.id){const n=connectedPlayers(room)[0];room.hostId=n?n.id:null;}
      sync(room);
    }
  },25000);
}

function acceptFrame(buf){
  if(buf.length<2)return null; const b1=buf[0],b2=buf[1]; const opcode=b1&15; let len=b2&127,off=2;
  if(len===126){if(buf.length<4)return null;len=buf.readUInt16BE(2);off=4;} else if(len===127){if(buf.length<10)return null; len=Number(buf.readBigUInt64BE(2));off=10;}
  const masked=!!(b2&128); let mask;if(masked){if(buf.length<off+4)return null;mask=buf.subarray(off,off+4);off+=4;} if(buf.length<off+len)return null;
  let payload=Buffer.from(buf.subarray(off,off+len)); if(mask)for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4]; return {opcode,payload,consumed:off+len};
}
function frame(str){const p=Buffer.from(str); let h;if(p.length<126){h=Buffer.alloc(2);h[0]=0x81;h[1]=p.length;}else if(p.length<65536){h=Buffer.alloc(4);h[0]=0x81;h[1]=126;h.writeUInt16BE(p.length,2);}else{h=Buffer.alloc(10);h[0]=0x81;h[1]=127;h.writeBigUInt64BE(BigInt(p.length),2);}return Buffer.concat([h,p]);}

const server=http.createServer((req,res)=>{
  if(req.url==='/api/create'){ const c=uniqueRoom(); rooms.set(c,{code:c,players:new Map(),hostId:null,phase:'lobby',round:0,totalRounds:5,senderId:null,scenario:null,scenarioPublic:null,card:null,message:'',votes:new Map(),results:null,deadline:0,timer:null,winner:null,createdAt:Date.now()}); res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}); return res.end(JSON.stringify({roomCode:c})); }
  let file=req.url==='/'?'index.html':req.url.replace(/^\//,''); file=path.normalize(file); if(file.includes('..')){res.writeHead(400);return res.end('bad path');}
  const fp=path.join(PUBLIC,file); fs.readFile(fp,(e,d)=>{if(e){res.writeHead(404);return res.end('not found');}const ext=path.extname(fp);const ct=ext==='.html'?'text/html':ext==='.css'?'text/css':ext==='.js'?'text/javascript':'application/octet-stream';res.writeHead(200,{'Content-Type':ct,'Cache-Control':'no-store'});res.end(d);});
});
server.on('upgrade',(req,socket)=>{
  if(req.headers.upgrade!=='websocket'){socket.destroy();return;}
  const key=req.headers['sec-websocket-key']; if(!key){socket.destroy();return;}
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  let room=null,p=null,buf=Buffer.alloc(0);
  socket.on('data',chunk=>{buf=Buffer.concat([buf,chunk]);while(true){const f=acceptFrame(buf);if(!f)break;buf=buf.subarray(f.consumed);if(f.opcode===8){socket.end();return;}if(f.opcode===1){let msg;try{msg=JSON.parse(f.payload.toString())}catch{continue;}if(msg.type==='join'){
      let r=rooms.get(msg.roomCode?.toUpperCase()); if(!r && msg.create){ r={code:msg.roomCode.toUpperCase(),players:new Map(),hostId:null,phase:'lobby',round:0,totalRounds:5,senderId:null,scenario:null,scenarioPublic:null,card:null,message:'',votes:new Map(),results:null,deadline:0,timer:null,winner:null,createdAt:Date.now()}; rooms.set(r.code,r); } if(!r){socket.write(frame(JSON.stringify({type:'error',message:'Room not found.'})));continue;}
      const nickname=String(msg.nickname||'').trim().slice(0,18); const token=String(msg.token||'').trim();
      if(!nickname||!token){socket.write(frame(JSON.stringify({type:'error',message:'Nickname and player token required.'})));continue;}
      let existing=[...r.players.values()].find(x=>x.token===token);
      const duplicateNickname=[...r.players.values()].find(x=>x.token!==token && x.nickname.toLowerCase()===nickname.toLowerCase());
      if(duplicateNickname && duplicateNickname.connected){
        socket.write(frame(JSON.stringify({type:'error',code:'NICKNAME_TAKEN',message:'That nickname is already taken in this room.'})));
        socket.end();
        continue;
      }
      // An offline player can reclaim that seat with the same nickname. Their old
      // token is replaced so a lost token cannot create a second seat.
      if(duplicateNickname && !duplicateNickname.connected){
        existing=duplicateNickname;
        existing.token=token;
      }
      if(existing){
        if(existing.ws && existing.ws.socket) { try{existing.ws.socket.destroy();}catch{} }
        if(r.senderGraceTimer){clearTimeout(r.senderGraceTimer);r.senderGraceTimer=null;}
        if(r.senderId===existing.id && r.senderDisconnectDeadline){
          r.senderDisconnectDeadline=0;
          const resumeMs=Math.max(1,(r.resumeDeadline||Date.now()+1000)-Date.now());
          r.deadline=Date.now()+resumeMs;
          if(r.phase==='sender') r.timer=setTimeout(()=>senderIdleTimeout(r),resumeMs);
          else if(r.phase==='writing') r.timer=setTimeout(()=>senderTimeout(r),resumeMs);
          else if(r.phase==='voting') r.timer=setTimeout(()=>resolveVotes(r),resumeMs);
          r.resumeDeadline=0;
        }
        existing.nickname=nickname; existing.connected=true; existing.ws={readyState:1,socket,send:s=>socket.write(frame(s))}; p=existing;
      } else {
        if(r.players.size>=12){socket.write(frame(JSON.stringify({type:'error',message:'Room is full.'})));continue;}
        p={id:id(),token,nickname,score:0,connected:true,ws:{readyState:1,socket,send:s=>socket.write(frame(s))}};r.players.set(p.id,p);
      }
      room=r; if(!r.hostId)r.hostId=p.id; socket._player=p; socket._room=r; send(p.ws,{type:'playerId',id:p.id}); send(p.ws,publicState(r,p.id)); if((r.phase==='sender'||r.phase==='writing')&&p.id===r.senderId)send(p.ws,{type:'senderSecret',card:r.card,scenario:r.scenario}); sync(r); continue;
    }
    if(!room||!p || !p.ws || p.ws.socket!==socket)continue; handle(room,p,msg);
  }} });
  socket.on('close',()=>{console.log('CLOSE',p&&p.nickname,room&&room.code);if(room&&p&&p.ws&&p.ws.socket===socket)onDisconnect(room,p);}); socket.on('error',(e)=>{console.log('SOCKETERR',p&&p.nickname,e.message);if(room&&p&&p.ws&&p.ws.socket===socket)onDisconnect(room,p);});
});
setInterval(()=>{ const now=Date.now(); for(const [c,r] of rooms){ if(r.players.size===0 && now-r.createdAt>10*60*1000){clearTimer(r);rooms.delete(c);} } },60000);
server.listen(PORT,()=>console.log(`Phish or Legit listening on ${PORT}`));
