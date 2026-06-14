// app.jsx — root: routing, theming, tweaks. Mounts the app.
const { useState:useStateA, useEffect:useEffectA, useMemo:useMemoA } = React;

/* ---------------- theme renderer palettes ---------------- */
const RDR = {
  military:{
    stage:'#080b0e', asset:'radial-gradient(circle at 50% 40%,#11161b,#070a0d 85%)',
    grid:'#141c24', bound:'#26313b', wallS:'#1d262e', wallS2:'#384450',
    unitFill:'#0b1117', label:'#8a96a1', ruler:'#3a4754', hpTrack:'#1a222a', hpTrackA:'#0a0e12',
    terrain:'linear-gradient(135deg,#1b2228,#10161b)',
    terrainTex:'repeating-linear-gradient(45deg,rgba(255,255,255,.015) 0 2px,transparent 2px 6px),radial-gradient(circle at 30% 20%,rgba(66,198,230,.05),transparent 60%)',
    terrainInset:'inset 0 0 0 1px #2a343d, inset 0 0 60px rgba(0,0,0,.6)',
    wallA:'linear-gradient(180deg,#2c3640,#1a222a)', wallEdge:'#3d4954', wallEdge2:'#11161b', wallShadow:'0 3px 8px -2px rgba(0,0,0,.6)', wallRadius:3,
    token:'radial-gradient(circle at 38% 32%,#222c34,#0c1116)', deadToken:'#14191e',
    tokenRing:'#00000088', tokenShadow:'#000', chip:'rgba(10,14,18,.8)',
    fogS:'repeating-linear-gradient(45deg,rgba(4,7,10,.86) 0 3px,rgba(4,7,10,.78) 3px 6px)', fogA:'rgba(5,8,11,.82)',
    font:'IBM Plex Mono', scan:true, mapPlaceholder:'Drop top-down map art',
  },
  minimal:{
    stage:'#eef1f4', asset:'#f5f7f9',
    grid:'#e2e6eb', bound:'#cbd2da', wallS:'#e6eaef', wallS2:'#c4ccd5',
    unitFill:'#ffffff', label:'#7b8590', ruler:'#aeb6bf', hpTrack:'#dde3ea', hpTrackA:'#eef2f6',
    terrain:'linear-gradient(135deg,#f1f4f7,#e9edf1)',
    terrainTex:'repeating-linear-gradient(45deg,rgba(0,0,0,.012) 0 2px,transparent 2px 7px)',
    terrainInset:'inset 0 0 0 1px #dfe4ea',
    wallA:'linear-gradient(180deg,#e4e9ef,#d3dae2)', wallEdge:'#f0f3f7', wallEdge2:'#c2cad3', wallShadow:'0 2px 5px -2px rgba(40,55,75,.18)', wallRadius:5,
    token:'#ffffff', deadToken:'#e8ecf0',
    tokenRing:'rgba(40,55,75,.12)', tokenShadow:'rgba(40,55,75,.22)', chip:'rgba(255,255,255,.88)',
    fogS:'repeating-linear-gradient(45deg,rgba(214,220,227,.94) 0 3px,rgba(214,220,227,.84) 3px 6px)', fogA:'rgba(226,231,236,.86)',
    font:'IBM Plex Mono', scan:false, mapPlaceholder:'Drop top-down map art',
  },
  retro:{
    stage:'#020803', asset:'#020803',
    grid:'#0b2a16', bound:'#1c5230', wallS:'#06200f', wallS2:'#1f8a4d',
    unitFill:'#03150a', label:'#36b86a', ruler:'#1f7a45', hpTrack:'#0b2a16', hpTrackA:'#03120a',
    terrain:'#030f07',
    terrainTex:'repeating-linear-gradient(0deg,rgba(57,255,136,.07) 0 1px,transparent 1px 3px)',
    terrainInset:'inset 0 0 0 1px #145c30, inset 0 0 40px rgba(0,0,0,.7)',
    wallA:'linear-gradient(180deg,#0a2c16,#04140a)', wallEdge:'#1f8a4d', wallEdge2:'#031008', wallShadow:'0 0 6px -1px rgba(57,255,136,.3)', wallRadius:0,
    token:'#03150a', deadToken:'#08180e',
    tokenRing:'rgba(57,255,136,.3)', tokenShadow:'rgba(0,0,0,.8)', chip:'rgba(2,8,3,.82)',
    fogS:'repeating-linear-gradient(0deg,rgba(2,8,3,.9) 0 2px,rgba(2,8,3,.78) 2px 4px)', fogA:'rgba(2,8,3,.85)',
    font:'Share Tech Mono', scan:true, mapPlaceholder:'> DROP MAP FEED',
  },
};
const THEMES = [
  { id:'military', label:'Military', accent:'#42c6e6', teams:['#4f9dff','#ff5f56'] },
  { id:'minimal',  label:'Minimal',  accent:'#2f6bff', teams:['#3b7bff','#ff5a52'] },
  { id:'retro',    label:'Retro',    accent:'#39ff88', teams:['#46c6ff','#ff5f6e'] },
];

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "military",
  "accent": "#42c6e6",
  "teams": ["#4f9dff", "#ff5f56"],
  "fog": false,
  "ruler": true
}/*EDITMODE-END*/;

function randId(){
  const h='0123456789abcdef'; let a='',b='';
  for(let i=0;i<4;i++) a+=h[Math.floor(Math.random()*16)];
  for(let i=0;i<2;i++) b+=h[Math.floor(Math.random()*16)];
  return a+'-'+b;
}

function App(){
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [view, setView] = useStateA('lobby');
  const [active, setActive] = useStateA(null);
  const theme = t.theme || 'military';

  // apply theme: data attr + signature accent/team colors
  useEffectA(()=>{
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffectA(()=>{
    const r=document.documentElement.style;
    r.setProperty('--accent', t.accent);
    r.setProperty('--teamA', t.teams[0]);
    r.setProperty('--teamB', t.teams[1]);
  }, [t.accent, t.teams]);

  const pickTheme=(id)=>{
    const th=THEMES.find(x=>x.id===id);
    setTweak({ theme:id, accent:th.accent, teams:th.teams });
  };

  const openSession=(s)=>{ setActive(s); setView('battle'); };
  const createSession=(cfg)=>{
    const players=cfg.players.map((p,i)=>({ ...p, team:'p'+(i+1) }));
    setActive({ id:randId(), game:cfg.game, name:cfg.name, time:cfg.time, fog:cfg.fog, max:cfg.maxTurns, turn:0, players });
    setView('battle');
  };

  const themedField = useMemoA(()=>null, [active, t.teams]);

  return (
    <div style={{height:'100vh',display:'flex',flexDirection:'column'}}>
      <div className="topbar">
        <div className="brand">
          <span className="mark"><Icon name="crosshair" size={15}/></span>
          BATTLE&nbsp;SIMULATOR
        </div>
        <div className="statuschip"><span className="pulse"/> api · localhost:3000</div>
        <div style={{flex:1}}/>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span className="up" style={{fontSize:10,color:'var(--faint)'}}>theme</span>
          <Segmented value={theme} onChange={pickTheme} size="sm"
            options={THEMES.map(th=>({ value:th.id, label:th.label }))}/>
        </div>
        <span className="mono" style={{fontSize:11,color:'var(--faint)'}}>battle simulator</span>
      </div>

      <div style={{flex:1,minHeight:0}}>
        {view==='lobby'
          ? <Lobby onOpenSession={openSession} onCreate={createSession}/>
          : <Battlefield session={active} field={themedField} tweaks={t} rdr={RDR[theme]} onExit={()=>setView('lobby')}/>}
      </div>

      <TweaksPanel>
        <TweakSection label="Aesthetic" />
        <TweakRadio label="Theme" value={theme}
          options={['military','minimal','retro']}
          onChange={pickTheme} />
        <TweakColor label="Accent" value={t.accent}
          options={['#42c6e6','#2f6bff','#39ff88','#f2b441','#b48cff']}
          onChange={(v)=>setTweak('accent', v)} />
        <TweakColor label="Team colors" value={t.teams}
          options={[['#4f9dff','#ff5f56'],['#46d39a','#f2b441'],['#42c6e6','#ff7847'],['#b48cff','#5cd49a']]}
          onChange={(v)=>setTweak('teams', v)} />
        <TweakSection label="Battlefield" />
        <TweakToggle label="Fog of war" value={t.fog} onChange={(v)=>setTweak('fog', v)} />
        <TweakToggle label="Coordinate grid" value={t.ruler} onChange={(v)=>setTweak('ruler', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
