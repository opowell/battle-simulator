// Battlefield.jsx — play view: split-render stage, roster/actions/log, timeline.
const { useState:useStateB, useRef:useRefB, useEffect:useEffectB, useMemo:useMemoB, useCallback:useCB } = React;

function buildLog(field){
  const T=field.turns-1, out=[];
  for(let turn=1; turn<=T; turn++){
    field.units.forEach(u=>{
      if(u.deathTurn===turn){
        const team=field.teams.find(t=>t.id===u.team);
        out.push({ turn, kind:'kill', color:team.raw, text:`${u.name} eliminated` });
      }
    });
    const movers=field.units.filter(u=>!(u.deathTurn!=null&&turn>u.deathTurn)).length;
    out.push({ turn, kind:'tick', color:'var(--faint)', text:`Turn ${turn} resolved · ${movers} units active` });
  }
  return out;
}

function Battlefield({ session, field, tweaks, rdr, onExit }){
  const storeKey = 'bsim:'+session.id;
  const init = (()=>{ try{ return JSON.parse(localStorage.getItem(storeKey))||{}; }catch(e){ return {}; } })();

  const [t, setT] = useStateB(init.t ?? 0);
  const [timeMode, setTimeMode] = useStateB(init.timeMode || session.time || 'discrete');
  const [render, setRender] = useStateB('split');
  const [playing, setPlaying] = useStateB(false);
  const [split, setSplit] = useStateB(0.5);
  const [selId, setSelId] = useStateB(null);
  const [userEvents, setUserEvents] = useStateB([]);

  const [stageRef, size] = useSize();
  const T = field.turns-1;
  const et = timeMode==='discrete' ? Math.round(t) : t;
  const curTurn = Math.round(et);

  const fit = useMemoB(()=> size.w>4 ? makeFitter(field.world, size, 30) : { s:0, x:()=>0, y:()=>0, len:()=>0 }, [size.w, size.h, field]);
  const units = useMemoB(()=> computeUnits(field, et), [field, et]);
  const sel = units.find(u=>u.id===selId);
  const log = useMemoB(()=> buildLog(field), [field]);

  // persist
  useEffectB(()=>{ try{ localStorage.setItem(storeKey, JSON.stringify({ t, timeMode })); }catch(e){} }, [t, timeMode]);

  // playback
  const raf = useRefB(0), last = useRefB(0);
  useEffectB(()=>{
    if(!playing) return;
    if(timeMode==='discrete'){
      const iv=setInterval(()=>{
        setT(p=>{ const n=Math.round(p)+1; if(n>=T){ setPlaying(false); return T; } return n; });
      }, 750);
      return ()=>clearInterval(iv);
    }
    last.current=performance.now();
    const speed=(T)/11; // whole timeline ~11s
    const loop=(now)=>{
      const dt=(now-last.current)/1000; last.current=now;
      setT(p=>{ const n=p+dt*speed; if(n>=T){ setPlaying(false); return T; } return n; });
      raf.current=requestAnimationFrame(loop);
    };
    raf.current=requestAnimationFrame(loop);
    return ()=>cancelAnimationFrame(raf.current);
  }, [playing, timeMode, T]);

  const stepBy=(d)=> setT(p=> Math.max(0, Math.min(T, Math.round(p)+d)) );
  const restart=()=> setT(0);

  // divider drag
  const dragRef=useRefB(null);
  const onDivDown=(e)=>{
    e.preventDefault();
    const move=(ev)=>{
      const r=stageRef.current.getBoundingClientRect();
      const f=(ev.clientX-r.left)/r.width;
      setSplit(Math.max(0.08, Math.min(0.92, f)));
    };
    const up=()=>{ window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); };
    window.addEventListener('pointermove',move); window.addEventListener('pointerup',up);
  };

  const splitPx = size.w * split;
  const showSchem = render!=='assets';
  const showAsset = render!=='schematic';

  // legal actions for selected unit
  const actions = useMemoB(()=>{
    if(!sel||sel.dead) return [];
    const enemies=units.filter(u=>u.teamObj.id!==sel.teamObj.id && !u.dead && (!tweaks.fog||u.visible));
    enemies.sort((a,b)=>Math.hypot(a.x-sel.x,a.y-sel.y)-Math.hypot(b.x-sel.x,b.y-sel.y));
    const near=enemies[0];
    const list=[{icon:'move',label:'Move',sub:'reposition along path'}];
    if(near){ const d=Math.hypot(near.x-sel.x,near.y-sel.y).toFixed(0);
      list.push({icon:'target',label:`Attack ${near.name}`,sub:`range ${d}u · ${Math.max(20,90-d|0)}% hit`}); }
    list.push({icon:'eye',label:'Overwatch',sub:'hold fire until enemy moves'});
    list.push({icon:'flag2',label:'End turn',sub:'pass to next player'});
    return list;
  }, [sel, units, tweaks.fog]);

  const doAction=(a)=>{
    setUserEvents(ev=>[{ turn:curTurn, color:sel?sel.teamObj.raw:'var(--accent)',
      text:`${sel?sel.name:'—'}: ${a.label}` }, ...ev].slice(0,30));
    if(a.label==='End turn') stepBy(1);
  };

  return (
    <div className="bf">
      {/* ---------- toolbar ---------- */}
      <div className="bf-bar">
        <button className="btn btn-sm btn-ghost" onClick={onExit}><Icon name="back" size={15}/> Lobby</button>
        <div style={{display:'flex',alignItems:'center',gap:9}}>
          <div className="gicon" style={{width:30,height:30}}><Icon name={GAMES.find(g=>g.key===session.game).icon} size={16} color="var(--accent)"/></div>
          <div>
            <div style={{fontWeight:600,fontSize:13,lineHeight:1.1}}>{session.name}</div>
            <div className="mono" style={{fontSize:10,color:'var(--faint)'}}>{field.label} · #{session.id}</div>
          </div>
        </div>
        <div style={{flex:1}}/>
        <div style={{display:'flex',alignItems:'center',gap:7}}>
          <span className="up" style={{fontSize:10,color:'var(--faint)'}}>render</span>
          <Segmented value={render} onChange={setRender} size="sm" options={[
            {value:'split',label:'Split',icon:'split'},
            {value:'schematic',label:'Schematic',icon:'grid'},
            {value:'assets',label:'Assets',icon:'eye'},
          ]}/>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:7}}>
          <span className="up" style={{fontSize:10,color:'var(--faint)'}}>time</span>
          <Segmented value={timeMode} onChange={setTimeMode} size="sm" options={[
            {value:'discrete',label:'Discrete',icon:'grid'},
            {value:'continuous',label:'Continuous',icon:'clock'},
          ]}/>
        </div>
      </div>

      {/* ---------- stage ---------- */}
      <div className="bf-stage" ref={stageRef} onClick={()=>setSelId(null)} style={{ background:rdr.stage }}>
        {fit.s>0 && <>
          {showSchem && <SchematicLayer field={field} fit={fit} units={units} selectedId={selId}
            onSelect={setSelId} fog={tweaks.fog} showRuler={tweaks.ruler} gridType={field.grid} rdr={rdr}/>}
          {showAsset && (
            <div style={{ position:'absolute', inset:0,
              clipPath: render==='split' ? `inset(0 0 0 ${splitPx}px)` : 'none', zIndex:2 }}>
              <AssetLayer field={field} fit={fit} units={units} selectedId={selId} onSelect={setSelId} fog={tweaks.fog} rdr={rdr}/>
            </div>
          )}
          {render==='split' && <>
            <div className="bf-tag" style={{left:10,color:'var(--dim)'}}>◱ Schematic · no assets</div>
            <div className="bf-tag" style={{right:10,color:'var(--accent)'}}>Assets · sprites + terrain ◲</div>
            <div className="bf-divider" style={{left:splitPx, zIndex:8}} onPointerDown={onDivDown}>
              <span className="grip"><Icon name="split" size={13}/></span>
            </div>
          </>}
          {render!=='split' && <div className="bf-tag" style={{left:10,color:render==='assets'?'var(--accent)':'var(--dim)'}}>
            {render==='assets'?'Assets · sprites + terrain':'Schematic · engine truth'}</div>}
        </>}
        {rdr.scan && <div className="scanline"/>}
      </div>

      {/* ---------- timeline ---------- */}
      <Timeline t={t} et={et} T={T} timeMode={timeMode} playing={playing} field={field}
        onPlay={()=>{ if(Math.round(t)>=T) setT(0); setPlaying(p=>!p); }}
        onStep={stepBy} onScrub={setT} onRestart={restart}/>

      {/* ---------- sidebar ---------- */}
      <div className="bf-side">
        <Roster field={field} units={units} selId={selId} onSelect={setSelId} session={session}/>
        {sel ? <UnitPanel sel={sel} actions={actions} onAction={doAction}/> :
          <div style={{padding:'18px 14px',color:'var(--faint)',fontSize:12,borderBottom:'1px solid var(--line)'}}>
            <Icon name="target" size={16} color="var(--faint)"/> <span style={{verticalAlign:'middle',marginLeft:6}}>Select a unit to issue orders.</span>
          </div>}
        <EventLog log={log} userEvents={userEvents} curTurn={curTurn}/>
      </div>
    </div>
  );
}

/* ---------------- timeline ---------------- */
function Timeline({ t, et, T, timeMode, playing, field, onPlay, onStep, onScrub, onRestart }){
  const trackRef=useRefB(null);
  const frac = T>0? et/T : 0;
  const scrub=(clientX)=>{
    const r=trackRef.current.getBoundingClientRect();
    const f=Math.max(0,Math.min(1,(clientX-r.left)/r.width));
    onScrub(f*T);
  };
  const down=(e)=>{ e.preventDefault(); scrub(e.clientX);
    const mv=(ev)=>scrub(ev.clientX);
    const up=()=>{ window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up); };
    window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
  };
  return (
    <div className="bf-time">
      <div style={{display:'flex',gap:6}}>
        <button className="iconbtn" onClick={onRestart} title="restart"><Icon name="stepb" size={16}/></button>
        <button className="iconbtn" onClick={()=>onStep(-1)} title="prev turn"><Icon name="back" size={16}/></button>
        <button className="iconbtn" onClick={onPlay} style={{borderColor:'var(--accent)',color:'var(--accent)'}}>
          <Icon name={playing?'pause':'play'} size={16} fill={!playing}/></button>
        <button className="iconbtn" onClick={()=>onStep(1)} title="next turn"><Icon name="step" size={16}/></button>
      </div>
      <div style={{minWidth:128,fontFamily:'IBM Plex Mono',fontSize:12}}>
        <div style={{color:'var(--txt)'}}>TURN {Math.round(et)} <span style={{color:'var(--faint)'}}>/ {T}</span></div>
        <div style={{fontSize:10,color:timeMode==='continuous'?'var(--accent)':'var(--faint)'}}>
          {timeMode==='continuous'? 't = '+t.toFixed(2)+'  (interpolated)' : 'discrete · snapped'}</div>
      </div>
      <div className="scrub">
        <div className="scrub-track" ref={trackRef} onPointerDown={down}>
          <div className="scrub-fill" style={{width:`${frac*100}%`}}/>
          {Array.from({length:T+1},(_,i)=>(
            <div key={i} className="scrub-tick" style={{left:`${(i/T)*100}%`}}/>
          ))}
          <div className="scrub-head" style={{left:`${frac*100}%`}}/>
        </div>
      </div>
    </div>
  );
}

/* ---------------- roster ---------------- */
function Roster({ field, units, selId, onSelect, session }){
  return (
    <div style={{borderBottom:'1px solid var(--line)'}}>
      {field.teams.map(team=>{
        const tu=units.filter(u=>u.team===team.id);
        const alive=tu.filter(u=>!u.dead).length;
        const pl=session.players.find(p=>p.team===team.id);
        return (
          <div key={team.id} style={{padding:'10px 14px',borderBottom:'1px solid rgba(35,44,53,.5)'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
              <TeamDot color={team.raw} size={10}/>
              <b style={{fontSize:11.5,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',flex:'0 1 auto'}}>{team.name}</b>
              {pl && <AgentBadge agent={pl.agent}/>}
              <span style={{flex:1}}/>
              <span className="mono" style={{fontSize:10,color:'var(--faint)',flex:'none'}}>{alive}/{tu.length}</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5}}>
              {tu.map(u=>(
                <button key={u.id} onClick={()=>onSelect(u.id)} style={{
                  display:'flex',alignItems:'center',gap:6,padding:'4px 7px',borderRadius:4,
                  border:'1px solid '+(u.id===selId?team.raw:'var(--line)'),
                  background:u.id===selId?'var(--bg3)':'var(--bg2)',
                  opacity:u.dead?0.4:1,fontSize:11,color:'var(--txt)',textAlign:'left',minWidth:0 }}>
                  <span className="dot" style={{width:6,height:6,background:u.dead?'var(--faint)':team.raw,flex:'none'}}/>
                  <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{u.name}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- unit panel ---------------- */
function UnitPanel({ sel, actions, onAction }){
  const col=sel.teamObj.raw; const hpFrac=sel.hpNow/sel.hpMax;
  return (
    <div className="unitcard">
      <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:10}}>
        <div style={{width:30,height:30,borderRadius:'50%',border:`2px solid ${col}`,display:'grid',placeItems:'center',background:'var(--bg2)'}}>
          <TeamDot color={col} size={9}/>
        </div>
        <div>
          <div style={{fontWeight:600,fontSize:13}}>{sel.name}</div>
          <div className="mono" style={{fontSize:10,color:'var(--faint)'}}>{sel.type} · {sel.teamObj.name}</div>
        </div>
      </div>
      <div className="statline"><span className="dim">Health</span><span className="mono">{Math.round(sel.hpNow)}/{sel.hpMax}</span></div>
      <div className="hpbar"><i style={{width:`${hpFrac*100}%`,background:hpFrac>0.5?col:hpFrac>0.25?'var(--warn)':'var(--danger)'}}/></div>
      <div style={{display:'flex',gap:14,margin:'10px 0 12px'}}>
        <span className="mono" style={{fontSize:11,color:'var(--dim)'}}>X <b style={{color:'var(--txt)'}}>{sel.x.toFixed(1)}</b></span>
        <span className="mono" style={{fontSize:11,color:'var(--dim)'}}>Y <b style={{color:'var(--txt)'}}>{sel.y.toFixed(1)}</b></span>
        <span className="mono" style={{fontSize:11,color:'var(--dim)'}}>θ <b style={{color:'var(--txt)'}}>{(sel.ang*180/Math.PI).toFixed(0)}°</b></span>
      </div>
      <div className="panel-t" style={{marginBottom:8}}>Legal actions</div>
      {sel.dead ? <div style={{fontSize:12,color:'var(--danger)'}}>Unit eliminated — no actions.</div> :
        actions.map((a,i)=>(
          <button key={i} className="action" onClick={()=>onAction(a)}>
            <Icon name={a.icon} size={15} color={col}/>
            <span style={{flex:1}}><span style={{display:'block',fontSize:12.5}}>{a.label}</span>
              <span className="mono" style={{fontSize:10,color:'var(--faint)'}}>{a.sub}</span></span>
          </button>
        ))}
    </div>
  );
}

/* ---------------- event log ---------------- */
function EventLog({ log, userEvents, curTurn }){
  const past=log.filter(e=>e.turn<=curTurn).slice().reverse();
  return (
    <div style={{flex:1,minHeight:120,display:'flex',flexDirection:'column'}}>
      <div className="panel-h" style={{borderTop:'1px solid var(--line)'}}><span className="panel-t">Event log</span></div>
      <div style={{padding:'4px 14px',overflow:'auto',flex:1}}>
        {userEvents.map((e,i)=>(
          <div key={'u'+i} className="logline"><span style={{color:e.color}}>›</span><b>{e.text}</b></div>
        ))}
        {past.map((e,i)=>(
          <div key={i} className="logline">
            <span style={{color:e.color,minWidth:30}}>T{e.turn}</span>
            <span style={{color:e.kind==='kill'?e.color:'var(--dim)'}}>{e.text}</span>
          </div>
        ))}
        {past.length===0 && userEvents.length===0 && <div style={{color:'var(--faint)',fontSize:11,padding:'8px 0'}}>No events yet — advance the timeline.</div>}
      </div>
    </div>
  );
}

Object.assign(window, { Battlefield });
