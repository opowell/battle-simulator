// renderers.jsx — dual battlefield renderers (schematic SVG + rich assets),
// fully theme-driven via an `rdr` palette. Exports to window.

/* ---- sample every unit's state at float-time t ---- */
function computeUnits(field, t){
  const T = field.turns - 1;
  const friendly = field.teams[0].id;
  const ft = Math.floor(Math.min(t, T));
  const arr = field.units.map(u=>{
    const here = samplePath(u.path, t/T);
    const prev = samplePath(u.path, ft/T);
    const next = samplePath(u.path, Math.min(ft+1,T)/T);
    const dead = u.deathTurn!=null && t >= u.deathTurn;
    let hpNow = u.hp;
    if(dead) hpNow = 0;
    else if(u.deathTurn!=null && t > u.deathTurn-2) hpNow = Math.max(4, u.hp*(1-(t-(u.deathTurn-2))/2));
    const team = field.teams.find(tm=>tm.id===u.team);
    return { ...u, x:here.x, y:here.y, ang:here.ang, prev, next, dead, hpNow, hpMax:u.hp, teamObj:team, friendly:u.team===friendly };
  });
  const sight = field.world.w*0.2;
  const friends = arr.filter(u=>u.friendly && !u.dead);
  arr.forEach(u=>{
    u.visible = u.friendly ? true : friends.some(f=>Math.hypot(f.x-u.x, f.y-u.y) < sight);
  });
  return arr;
}

const teamShape = (i)=> i===0?'circle': i===1?'triangle':'square';
const zoneColor = (kind)=> kind==='site'?'#f2b441': kind==='resource'?'#46d39a': kind==='objective'?'#42c6e6':'#8a96a1';

/* ====================== SCHEMATIC LAYER ====================== */
function SchematicLayer({ field, fit, units, selectedId, onSelect, fog, showRuler, gridType, rdr }){
  const W = fit.s>0 ? field.world.w : 0;
  const teamIdx = id => field.teams.findIndex(t=>t.id===id);
  const px = (wx,wy)=>({ x:fit.x(wx), y:fit.y(wy) });
  const FONT = rdr.font;

  return (
    <div className="bf-layer" style={{ background:rdr.stage }}>
      <svg width="100%" height="100%" style={{ display:'block', position:'absolute', inset:0 }}>
        {W>0 && (()=>{
          const out=[]; const stepW = gridType==='square'?1:Math.max(1,Math.round(field.world.w/20));
          for(let gx=0; gx<=field.world.w; gx+=stepW) out.push(<line key={'gx'+gx} x1={fit.x(gx)} y1={fit.y(0)} x2={fit.x(gx)} y2={fit.y(field.world.h)} stroke={rdr.grid} strokeWidth="1"/>);
          const stepH = gridType==='square'?1:Math.max(1,Math.round(field.world.h/13));
          for(let gy=0; gy<=field.world.h; gy+=stepH) out.push(<line key={'gy'+gy} x1={fit.x(0)} y1={fit.y(gy)} x2={fit.x(field.world.w)} y2={fit.y(gy)} stroke={rdr.grid} strokeWidth="1"/>);
          return out;
        })()}
        <rect x={fit.x(0)} y={fit.y(0)} width={fit.len(field.world.w)} height={fit.len(field.world.h)} fill="none" stroke={rdr.bound} strokeWidth="1.5"/>

        {field.zones.map((z,i)=>{
          const col = zoneColor(z.kind);
          return (
            <g key={'z'+i}>
              <rect x={fit.x(z.x)} y={fit.y(z.y)} width={fit.len(z.w)} height={fit.len(z.h)}
                fill={col} fillOpacity="0.06" stroke={col} strokeOpacity="0.55" strokeWidth="1.2" strokeDasharray="5 4" rx="2"/>
              <text x={fit.x(z.x)+5} y={fit.y(z.y)+13} fill={col} fillOpacity="0.9" fontSize="10" fontFamily={FONT} letterSpacing="0.5">{z.label}</text>
            </g>
          );
        })}

        {field.walls.map((w,i)=>(
          <rect key={'w'+i} x={fit.x(w[0])} y={fit.y(w[1])} width={fit.len(w[2])} height={fit.len(w[3])}
            fill={rdr.wallS} stroke={rdr.wallS2} strokeWidth="1"/>
        ))}

        {units.filter(u=>!u.dead && (!fog||u.visible)).map(u=>{
          const a=px(u.x,u.y), b=px(u.next.x,u.next.y);
          if(Math.hypot(b.x-a.x,b.y-a.y)<3) return null;
          return <line key={'mv'+u.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={u.teamObj.raw} strokeOpacity="0.5" strokeWidth="1.4" strokeDasharray="3 3"/>;
        })}

        {units.map(u=>{
          if(fog && !u.visible) return null;
          const p=px(u.x,u.y); const col=u.teamObj.raw;
          const r = Math.max(5, fit.len(field.grid==='square'?0.42:2.4));
          const sel = u.id===selectedId;
          if(u.dead){
            return <g key={u.id} opacity="0.4">
              <line x1={p.x-r*0.7} y1={p.y-r*0.7} x2={p.x+r*0.7} y2={p.y+r*0.7} stroke={col} strokeWidth="1.6"/>
              <line x1={p.x-r*0.7} y1={p.y+r*0.7} x2={p.x+r*0.7} y2={p.y-r*0.7} stroke={col} strokeWidth="1.6"/>
            </g>;
          }
          const sh=teamShape(teamIdx(u.team));
          const hpFrac=u.hpNow/u.hpMax;
          return (
            <g key={u.id} style={{cursor:'pointer'}} onClick={(e)=>{e.stopPropagation();onSelect(u.id);}}>
              {sel && <circle cx={p.x} cy={p.y} r={r+6} fill="none" stroke={col} strokeWidth="1" strokeDasharray="2 3"/>}
              <line x1={p.x} y1={p.y} x2={p.x+Math.cos(u.ang)*(r+5)} y2={p.y+Math.sin(u.ang)*(r+5)} stroke={col} strokeWidth="1.5"/>
              {sh==='circle' && <circle cx={p.x} cy={p.y} r={r} fill={rdr.unitFill} stroke={col} strokeWidth="2"/>}
              {sh==='triangle' && <polygon points={`${p.x},${p.y-r} ${p.x+r},${p.y+r} ${p.x-r},${p.y+r}`} fill={rdr.unitFill} stroke={col} strokeWidth="2"/>}
              {sh==='square' && <rect x={p.x-r} y={p.y-r} width={r*2} height={r*2} fill={rdr.unitFill} stroke={col} strokeWidth="2"/>}
              <rect x={p.x-r} y={p.y+r+3} width={r*2} height={3} fill={rdr.hpTrack}/>
              <rect x={p.x-r} y={p.y+r+3} width={r*2*hpFrac} height={3} fill={hpFrac>0.5?col:hpFrac>0.25?'#f2b441':'#ff5f56'}/>
              <text x={p.x} y={p.y-r-5} fill={rdr.label} fontSize="9" fontFamily={FONT} textAnchor="middle">{u.name}</text>
            </g>
          );
        })}
        {showRuler && W>0 && (()=>{
          const out=[]; const step=Math.max(1,Math.round(field.world.w/8));
          for(let gx=0; gx<=field.world.w; gx+=step) out.push(<text key={'rx'+gx} x={fit.x(gx)} y={fit.y(0)-4} fill={rdr.ruler} fontSize="8" fontFamily={FONT} textAnchor="middle">{gx}</text>);
          const stepY=Math.max(1,Math.round(field.world.h/6));
          for(let gy=0; gy<=field.world.h; gy+=stepY) out.push(<text key={'ry'+gy} x={fit.x(0)-6} y={fit.y(gy)+3} fill={rdr.ruler} fontSize="8" fontFamily={FONT} textAnchor="end">{gy}</text>);
          return out;
        })()}
      </svg>
      {fog && <FogMask fit={fit} field={field} units={units} mode="schematic" rdr={rdr}/>}
    </div>
  );
}

/* ====================== ASSET LAYER ====================== */
const UNIT_GLYPH = {
  awper:'sniper', sharpshooter:'sniper',
  marauder:'heavy', roach:'heavy', tank:'heavy', grenadier:'heavy',
  medivac:'flyer', ling:'bug', bane:'bug', sectoid:'bug',
};
function glyphFor(type){ return UNIT_GLYPH[type] || 'soldier'; }
const GLYPH_PATHS = {
  soldier:'M12 4a2.4 2.4 0 100 4.8A2.4 2.4 0 0012 4zM8 11h8v6l-2 1v3h-4v-3l-2-1z M16 12l3 2',
  sniper:'M12 4a2.2 2.2 0 100 4.4A2.2 2.2 0 0012 4zM9 11h6v5l-1 1v3h-4v-3l-1-1z M14 12l6 1',
  heavy:'M12 3.6a2.8 2.8 0 100 5.6 2.8 2.8 0 000-5.6zM7 11h10v7l-2 1v2H9v-2l-2-1z',
  flyer:'M12 7a2 2 0 100 4 2 2 0 000-4zM4 9l6 1M20 9l-6 1M9 12h6v4l-2 3h-2l-2-3z',
  bug:'M12 5c2 0 3 2 3 4s-1 5-3 5-3-3-3-5 1-4 3-4zM8 8L5 6M16 8l3-2M8 12l-3 1M16 12l3 1',
};

function AssetLayer({ field, fit, units, selectedId, onSelect, fog, rdr }){
  const W = fit.len(field.world.w), H = fit.len(field.world.h);
  const L = fit.x(0), Tp = fit.y(0);
  const badge = (col)=>({ position:'absolute', top:4, left:4, fontFamily:rdr.font, fontSize:9, letterSpacing:.5,
    color:col, background:rdr.chip, padding:'1px 5px', borderRadius:3, border:`1px solid ${col}55` });

  return (
    <div className="bf-layer" style={{ background:rdr.asset }}>
      {/* terrain base — droppable real map */}
      <div style={{ position:'absolute', left:L, top:Tp, width:W, height:H, borderRadius:4, overflow:'hidden', boxShadow:rdr.terrainInset }}>
        <div style={{ position:'absolute', inset:0, background:rdr.terrain, backgroundImage:rdr.terrainTex }}/>
        <image-slot id={'bfmap-'+field.game} style={{ position:'absolute', inset:0, width:'100%', height:'100%', opacity:0.92 }}
          shape="rect" fit="cover" placeholder={rdr.mapPlaceholder}></image-slot>
      </div>

      {/* zones */}
      {field.zones.map((z,i)=>{
        const x=fit.x(z.x), y=fit.y(z.y), w=fit.len(z.w), h=fit.len(z.h);
        if(z.kind==='site') return (
          <div key={i} style={{ position:'absolute', left:x, top:y, width:w, height:h, borderRadius:4,
            background:'repeating-linear-gradient(45deg,rgba(242,180,65,.14) 0 8px,rgba(242,180,65,.04) 8px 16px)',
            border:'1px solid rgba(242,180,65,.5)' }}>
            <span style={badge('#f2b441')}>{z.label}</span>
          </div>);
        if(z.kind==='resource') return (
          <div key={i} style={{ position:'absolute', left:x, top:y, width:w, height:h }}>
            {[...Array(5)].map((_,k)=>(
              <span key={k} style={{ position:'absolute', left:`${8+k*16}%`, top:`${30+(k%2)*22}%`, width:9, height:13,
                background:'linear-gradient(180deg,#7ef0c2,#1f8a5b)', clipPath:'polygon(50% 0,100% 35%,75% 100%,25% 100%,0 35%)',
                boxShadow:'0 0 8px -1px #46d39a' }}/>
            ))}
            <span style={badge('#46d39a')}>{z.label}</span>
          </div>);
        if(z.kind==='objective') return (
          <div key={i} style={{ position:'absolute', left:x, top:y, width:w, height:h, borderRadius:'50%',
            border:'1.5px dashed rgba(66,198,230,.7)', display:'grid', placeItems:'center' }}>
            <span style={badge('#42c6e6')}>{z.label}</span>
          </div>);
        return (
          <div key={i} style={{ position:'absolute', left:x, top:y, width:w, height:h, borderRadius:4,
            background:'rgba(120,130,140,.06)', border:'1px dashed rgba(120,130,140,.4)' }}>
            <span style={badge('#8a96a1')}>{z.label}</span>
          </div>);
      })}

      {/* walls */}
      {field.walls.map((w,i)=>(
        <div key={i} style={{ position:'absolute', left:fit.x(w[0]), top:fit.y(w[1]), width:fit.len(w[2]), height:fit.len(w[3]),
          background:rdr.wallA, borderRadius:rdr.wallRadius!=null?rdr.wallRadius:3,
          borderTop:`1px solid ${rdr.wallEdge}`, borderLeft:`1px solid ${rdr.wallEdge}`, borderBottom:`1px solid ${rdr.wallEdge2}`,
          boxShadow:rdr.wallShadow }}/>
      ))}

      {/* units — sprite tokens */}
      {units.map(u=>{
        if(fog && !u.visible) return null;
        const p={ x:fit.x(u.x), y:fit.y(u.y) }; const col=u.teamObj.raw;
        const r = Math.max(11, fit.len(field.grid==='square'?0.46:2.7));
        const sel=u.id===selectedId;
        if(u.dead) return (
          <div key={u.id} style={{ position:'absolute', left:p.x-r, top:p.y-r, width:r*2, height:r*2, opacity:.45,
            transform:'rotate(20deg)', borderRadius:'50%', background:rdr.deadToken, border:`1.5px solid ${col}55`, display:'grid', placeItems:'center' }}>
            <Icon name="trash" size={r} color={col+'99'}/>
          </div>);
        const hpFrac=u.hpNow/u.hpMax;
        return (
          <div key={u.id} onClick={(e)=>{e.stopPropagation();onSelect(u.id);}}
            style={{ position:'absolute', left:p.x, top:p.y, transform:'translate(-50%,-50%)', cursor:'pointer', zIndex: sel?4:2 }}>
            <div style={{ position:'absolute', left:'50%', top:'50%', width:r*1.7, height:r*1.7,
              transform:`translate(-50%,-50%) rotate(${u.ang}rad)`,
              background:`conic-gradient(from -22deg, ${col}44, transparent 44deg)`, borderRadius:'50%', pointerEvents:'none' }}/>
            <div style={{ position:'relative', width:r*2, height:r*2, borderRadius:'50%',
              background:rdr.token,
              border:`2px solid ${col}`, boxShadow:`0 0 0 1px ${rdr.tokenRing||'#00000088'}, 0 4px 10px -2px ${rdr.tokenShadow||'#000'}${sel?`, 0 0 16px -1px ${col}`:''}`,
              display:'grid', placeItems:'center' }}>
              <svg width={r*1.5} height={r*1.5} viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d={GLYPH_PATHS[glyphFor(u.type)]}/>
              </svg>
            </div>
            <div style={{ position:'absolute', left:'50%', top:-r-7, transform:'translateX(-50%)', width:r*2.1, height:4, borderRadius:2, background:rdr.hpTrackA, border:`1px solid ${rdr.tokenRing||'#00000088'}` }}>
              <div style={{ height:'100%', width:`${hpFrac*100}%`, borderRadius:2, background:hpFrac>0.5?col:hpFrac>0.25?'#f2b441':'#ff5f56' }}/>
            </div>
            {sel && <div style={{ position:'absolute', left:'50%', top:r+5, transform:'translateX(-50%)', whiteSpace:'nowrap',
              fontFamily:rdr.font, fontSize:9, color:col, background:rdr.chip, padding:'1px 5px', borderRadius:3 }}>{u.name}</div>}
          </div>
        );
      })}

      {fog && <FogMask fit={fit} field={field} units={units} mode="asset" rdr={rdr}/>}
    </div>
  );
}

/* ---- fog overlay ---- */
function FogMask({ fit, field, units, mode, rdr }){
  const holes = units.filter(u=>u.friendly && !u.dead).map(u=>{
    const r = fit.len(field.world.w*0.2);
    return `radial-gradient(circle ${r}px at ${fit.x(u.x)}px ${fit.y(u.y)}px, transparent 0, transparent 60%, black 100%)`;
  });
  const mask = holes.length? holes.join(','):'linear-gradient(black,black)';
  return <div style={{ position:'absolute', inset:0, pointerEvents:'none', zIndex:3,
    background: mode==='schematic' ? rdr.fogS : rdr.fogA,
    WebkitMaskImage:mask, maskImage:mask, WebkitMaskComposite:'destination-in', maskComposite:'intersect' }}/>;
}

Object.assign(window, { computeUnits, SchematicLayer, AssetLayer });
