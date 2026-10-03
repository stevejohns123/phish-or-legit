const app=document.getElementById('app');let ws=null,state=null,secret=null,myId=null;let reconnectTimer=null;let draft='';let heartbeat=null;let myVoted=false;
const playerToken=sessionStorage.getItem('phishPlayerToken')||crypto.randomUUID();sessionStorage.setItem('phishPlayerToken',playerToken);let pendingRoom=null,pendingNick=null;
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function shell(body){const leave=state?'<button class="leave" onclick="leaveRoom()">Leave room</button>':'';app.innerHTML=`<div class="wrap"><div class="brand"><div class="shield">P</div><div><b>PHISH OR LEGIT</b><small>spot the signal · beat the phisher</small></div>${leave}</div>${body}<div class="footer">No login. No install. Play on phone or laptop.</div></div>`}
function connectionStatus(message){shell(`<section class="card hero"><div class="eyebrow">Connection</div><h1>${esc(message)}</h1><p class="sub">Your saved room is being retried automatically. You can wait here or return to the home screen.</p><button class="secondary" onclick="leaveRoom()">Back to home</button></section>`)}
function home(){shell(`<section class="card hero"><div class="eyebrow">Multiplayer phishing game</div><div class="title">Would you click it?</div><p class="sub">One player writes the message. Everyone else decides whether it's <b>LEGIT</b> or <b>PHISH</b>. Five rounds. Highest score wins.</p><div class="grid"><div><div class="field"><label>Your nickname</label><input id="nick" maxlength="18" placeholder="e.g. Alex"></div><button class="primary" onclick="createRoom()">Create room</button></div><div class="card" style="padding:18px;background:#0b1218"><b>Joining a room?</b><div class="field"><label>4-character room code</label><input id="code" maxlength="4" placeholder="ABCD" style="text-transform:uppercase"></div><button class="secondary" onclick="joinRoom()">Join room</button></div></div></section>`)}
function rules(){return `<section class="card rules"><div class="eyebrow">How to play</div><h1>Five rounds. One sender. No guessing together.</h1><ul><li>The Sender secretly gets a <b>Legit</b> or <b>Phish</b> card and a scenario.</li><li>They write a convincing 1–2 sentence message using the optional hints.</li><li>Everyone else votes <b>Real</b> or <b>Fake</b> privately.</li><li>Correct voters get 1 point. The Sender gets 1 point for every player they fool.</li><li>After the reveal, you'll see the phishing tell that mattered.</li></ul></section>`}
function lobby(){const ready=state.players.length>=2;return `<section class="card"><div class="between"><div><div class="eyebrow">Room</div><div class="code">${state.roomCode}</div></div><span class="pill">${state.players.length}/12 players</span></div><p class="sub">Share the 4-character code. ${state.hostId===myId?'You are the host.':''}</p><div class="players">${state.players.map(p=>`<div class="player"><b>${esc(p.nickname)}</b>${p.id===state.hostId?' <span class="pill">HOST</span>':''}<div class="muted">${p.connected?'online':'reconnecting'} · ${p.score} pts</div></div>`).join('')}</div><div class="lobby-actions"><button class="secondary" onclick="leaveRoom()">Leave room</button>${state.hostId===myId?`<button class="primary" ${ready?'':'disabled'} onclick="startGame()">${ready?'Start game':'Need 2 players'}</button>`:`<span class="muted">Waiting for the host to start…</span>`}</div></section>`}
function game(){if(state.phase==='lobby')return rules()+lobby();if(state.phase==='sender'||state.phase==='writing'){const isSender=state.senderId===myId;return `<section class="card"><div class="between"><div><span class="eyebrow">Round ${state.round} / 5</span><h1>${isSender?'You are the Sender':'Someone is crafting a message'}</h1></div><span class="pill">${isSender?'SECRET CARD':'WAITING'}</span></div>${isSender?senderView():`<p class="sub">The Sender is writing a message. You'll vote when it arrives.</p><div class="scenario"><b>${esc(state.scenario?.title||'Scenario')}</b><p class="muted">${esc(state.scenario?.urgency||'')}</p></div>`}</section>`}if(state.phase==='voting')return voteView();if(state.phase==='reveal')return revealView();if(state.phase==='finished')return finishView()}
function senderView(){if(!secret)return '<p>Loading your private card…</p>';return `<div class="scenario"><span class="pill">${secret.card.toUpperCase()}</span><h2>${esc(secret.scenario.title)}</h2><p><b>Type:</b> ${esc(secret.scenario.type)}</p><p><b>Urgency angle:</b> ${esc(secret.scenario.urgency)}</p><p><b>Detail:</b> ${esc(secret.scenario.detail)}</p></div>${state.phase==='sender'?`<p class="sub">Write a believable 1–2 sentence message. Don't reveal your card.</p><button class="primary" onclick="readySender()">I'm ready to write</button>`:`<div class="field"><label>Your message <span class="muted" id="writeTimer"></span></label><textarea id="msg" maxlength="500" placeholder="Write the message…" oninput="draft=this.value">${esc(draft)}</textarea><small class="muted">Optional hints are above. Aim for 1–2 sentences.</small></div><button class="primary" onclick="submitMsg()">Send for voting</button>`}`}
function voteView(){const isSender=state.senderId===myId;return `<section class="card"><div class="between"><div><span class="eyebrow">Round ${state.round} / 5</span><h1>${isSender?'Your message is live':'Real or Fake?'}</h1></div><span class="timer" id="timer"></span></div><div class="message">${esc(state.message)}</div>${isSender?'<p class="sub">You cannot vote. Watch the room vote privately.</p>':(state.hasVoted||myVoted)?`<p class="success">✓ Vote locked in. ${state.voteCount}/${state.eligibleVoters} players voted.</p>`:`<p class="sub">Votes stay hidden until everyone has answered. ${state.voteCount}/${state.eligibleVoters} voted.</p><div class="votegrid"><button class="vote legit" onclick="vote('legit')">✓ REAL</button><button class="vote phish" onclick="vote('phish')">⚠ FAKE</button></div>`}</section>`}
function revealView(){if(state.results?.skipped)return `<section class="card reveal"><div class="eyebrow">Round ${state.round}</div><h1>Round skipped</h1><div class="message">${esc(state.message)}</div><p class="sub">${esc(state.results?.reason||'The round was skipped. No points were awarded.')}</p><p class="muted">Next round starts automatically.</p></section>`;const card=state.card==='phish'?'PHISH':'LEGIT';return `<section class="card reveal"><div class="eyebrow">Round ${state.round} reveal</div><h1>${card}</h1><div class="message">${esc(state.message)}</div><p class="sub"><b>Phishing tell:</b> ${esc(state.tell)}</p><p><b>${state.results?.fooled||0}</b> player(s) were fooled by the Sender.</p><div class="players">${state.players.map(p=>{const r=state.results?.details?.[p.id];return `<div class="player"><b>${esc(p.nickname)}</b><div>${p.id===state.senderId?'Sender':r?.vote?`${r.vote.toUpperCase()} · ${r.correct?'✓ Correct':'✕ Wrong'}`:'No vote'} · ${p.score} pts</div></div>`}).join('')}</div></section>`}
function finishView(){return `<section class="card hero"><div class="eyebrow">Game complete</div><h1>Final leaderboard</h1><div class="players">${[...state.players].sort((a,b)=>b.score-a.score).map((p,i)=>`<div class="player"><span class="pill">#${i+1}</span> <b>${esc(p.nickname)}</b><div class="score">${p.score}</div></div>`).join('')}</div><p class="sub">${state.winner?`Winner: <b>${esc(state.winner.nickname)}</b> with ${state.winner.score} points.`:''}</p>${state.hostId===myId?'<button class="primary" onclick="restart()">Play again</button>':''}</section>`}
function render(){if(!state)return home();const typing=state.phase==='writing'&&state.senderId===myId&&document.activeElement?.id==='msg';if(typing){updateLiveUi();return;}shell(game());if(state.phase==='voting')startClock();if(state.phase==='writing'&&state.senderId===myId){const el=document.getElementById('msg');if(el){el.value=draft;}startWriteClock();}}
function updateLiveUi(){if(state.phase==='voting')startClock();if(state.phase==='writing'&&state.senderId===myId)startWriteClock();}
function startWriteClock(){clearInterval(window.writeClock);window.writeClock=setInterval(()=>{const el=document.getElementById('writeTimer');if(!el)return clearInterval(window.writeClock);const left=Math.max(0,(state.deadline-Date.now())/1000);el.textContent='· '+Math.ceil(left)+'s';},250);}
function startClock(){clearInterval(window.clock);window.clock=setInterval(()=>{const el=document.getElementById('timer');if(!el)return clearInterval(window.clock);const left=Math.max(0,(state.deadline-Date.now())/1000);el.textContent=Math.ceil(left)+'s';},250);}
function connect(roomCode,nick,create=false){
  if(ws&&ws.readyState===1)return;
  pendingRoom=roomCode; pendingNick=nick;
  connectionStatus('Connecting…');
  ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host);
  ws.onopen=()=>{
    ws.send(JSON.stringify({type:'join',roomCode,nickname:nick,token:playerToken,create}));
    clearInterval(heartbeat);heartbeat=setInterval(()=>send({type:'ping'}),20000);
  };
  ws.onmessage=e=>{
    const m=JSON.parse(e.data);
    if(m.type==='error'){
      if(m.message==='Room not found.'){
        localStorage.removeItem('room');localStorage.removeItem('nick');
        pendingRoom=null;pendingNick=null;state=null;clearTimeout(reconnectTimer);
        if(ws){try{ws.close();}catch{}}
        ws=null;alert('That room no longer exists.');home();return;
      }
      if(m.code==='NICKNAME_TAKEN'){
        const keepNick=pendingNick||''; const keepRoom=pendingRoom||roomCode||'';
        pendingRoom=null;pendingNick=null;state=null;clearTimeout(reconnectTimer);
        if(ws){try{ws.close();}catch{}}
        ws=null;home();
        const nickEl=document.getElementById('nick'),codeEl=document.getElementById('code');
        if(nickEl)nickEl.value=keepNick;if(codeEl)codeEl.value=keepRoom;
        alert(m.message);return;
      }
      alert(m.message);return;
    }
    if(m.type==='playerId'){
      myId=m.id;
      if(pendingRoom&&pendingNick){
        localStorage.setItem('room',pendingRoom);localStorage.setItem('nick',pendingNick);
      }
      return;
    }
    if(m.type==='senderSecret'){
      secret=m;sessionStorage.setItem('phishSecret',JSON.stringify(m));if(state)render();return;
    }
    if(m.type==='state'){
      state=m;
      if(m.phase!=='voting')myVoted=false;
      if(m.phase==='voting'&&m.hasVoted)myVoted=true;
      render();
    }
  };
  ws.onerror=()=>{
    if(!state&&pendingRoom&&pendingNick)connectionStatus('Reconnecting…');
  };
  ws.onclose=()=>{
    clearInterval(heartbeat);
    if(pendingRoom&&pendingNick&&state?.phase!=='finished'){
      clearTimeout(reconnectTimer);
      if(!state)connectionStatus('Reconnecting…');
      reconnectTimer=setTimeout(()=>connect(pendingRoom,pendingNick,false),1500);
    }
  };
}
async function createRoom(){const n=document.getElementById('nick').value.trim();if(!n)return alert('Enter a nickname.');try{const r=await fetch('/api/create');if(!r.ok)throw new Error('Server unavailable');const data=await r.json();const c=data.roomCode;connect(c,n,false);}catch(e){alert('Could not create a room. Check your connection and try again.');}}
function joinRoom(){const n=document.getElementById('nick')?.value.trim()||prompt('Nickname?');const c=document.getElementById('code').value.trim().toUpperCase();if(!n||c.length!==4)return alert('Enter a nickname and 4-character code.');connect(c,n,false);}
function leaveRoom(){clearTimeout(reconnectTimer);pendingRoom=null;pendingNick=null;state=null;secret=null;draft='';myVoted=false;localStorage.removeItem('room');if(ws){try{ws.close();}catch{}}ws=null;home();}
function send(x){if(ws?.readyState===1)ws.send(JSON.stringify(x))}function startGame(){send({type:'start'})}function readySender(){send({type:'ready'})}function submitMsg(){draft=document.getElementById('msg').value;send({type:'submit',message:draft})}function vote(v){myVoted=true;send({type:'vote',vote:v})}function restart(){send({type:'restart'})}
function startClock(){clearInterval(window.clock);window.clock=setInterval(()=>{const el=document.getElementById('timer');if(!el)return clearInterval(window.clock);const left=Math.max(0,(state.deadline-Date.now())/1000);el.textContent=Math.ceil(left)+'s';},250)}
const savedNick=localStorage.getItem('nick'),savedRoom=localStorage.getItem('room');if(savedNick&&savedRoom){connect(savedRoom,savedNick,false)}else home();
