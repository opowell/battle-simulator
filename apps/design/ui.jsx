// ui.jsx — shared atoms + icon set. Exports to window.
const { useState, useRef, useEffect, useLayoutEffect, useCallback } = React;

/* ---------------- icons (24x24 stroke) ---------------- */
const PATHS = {
  crosshair:'M12 2v4M12 18v4M2 12h4M18 12h4 M12 8a4 4 0 100 8 4 4 0 000-8z',
  zap:'M13 2L4 14h6l-1 8 9-12h-6z',
  shield:'M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z',
  grid:'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  tank:'M3 14h18v4H3zM6 14v-3h10v3M9 8h4v3H9zM7 18l-1 3M17 18l1 3',
  sword:'M14 3h7v7l-9 9-3-3zM5 13l-2 2 4 4 2-2M14 10l-4 4',
  crown:'M4 18h16M4 18l-1-9 5 4 4-7 4 7 5-4-1 9',
  globe:'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
  flag:'M5 21V4M5 4h11l-2 4 2 4H5',
  wand:'M15 4V2M15 10v-2M19 6h2M9 6h2M15 6l6 14M6 21l9-9',
  cards:'M8 6h10v12H8zM5 9v9h9M8 10h4M8 13h6',
  flame:'M12 3c1 4 5 5 5 9a5 5 0 01-10 0c0-2 1-3 2-4 0 1 1 2 2 2 0-3-1-5-1-7z',
  play:'M7 5l12 7-12 7z',
  pause:'M7 5h3v14H7zM14 5h3v14h-3z',
  step:'M5 5v14M9 12l9-7v14z',
  stepb:'M19 5v14M15 12L6 5v14z',
  back:'M15 5l-7 7 7 7',
  layers:'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  clock:'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  plus:'M12 5v14M5 12h14',
  users:'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3 3-5 6-5s6 2 6 5M17 14c2 0 4 2 4 5M16 5a3 3 0 010 6',
  split:'M12 3v18M5 8l-3 4 3 4M19 8l3 4-3 4',
  trash:'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  fog:'M4 15h16M6 18h12M8 11a4 4 0 018 0M5 11h14',
  target:'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8zM12 11a1 1 0 100 2 1 1 0 000-2',
  move:'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  check:'M5 12l5 5 9-11',
  flag2:'M5 21V4M5 4h11l-2 4 2 4H5',
};
function Icon({ name, size=18, color='currentColor', stroke=1.7, fill=false, style }){
  const d = PATHS[name] || PATHS.grid;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style}
      fill={fill?color:'none'} stroke={fill?'none':color} strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/* ---------------- atoms ---------------- */
function Panel({ title, right, children, style, bodyStyle, className }){
  return (
    <div className={'panel '+(className||'')} style={style}>
      {(title||right) && (
        <div className="panel-h">
          <span className="panel-t">{title}</span>
          {right}
        </div>
      )}
      <div className="panel-b" style={bodyStyle}>{children}</div>
    </div>
  );
}

function Segmented({ value, options, onChange, size }){
  return (
    <div className="seg">
      {options.map(o=>{
        const val = typeof o==='string'? o : o.value;
        const lab = typeof o==='string'? o : o.label;
        return (
          <button key={val} className={value===val?'on':''} onClick={()=>onChange(val)}
            style={size==='sm'?{padding:'4px 9px',fontSize:11}:null}>
            {o.icon && <Icon name={o.icon} size={14} />}{lab}
          </button>
        );
      })}
    </div>
  );
}

function Badge({ kind, children }){
  return <span className={'badge badge-'+(kind||'human')}>{children}</span>;
}

function TeamDot({ color, size=9 }){
  return <span className="dot" style={{ background:color, width:size, height:size, boxShadow:`0 0 8px -1px ${color}` }} />;
}

function AgentBadge({ agent }){
  if(agent==='human') return <Badge kind="human">human</Badge>;
  if(agent==='open')  return <Badge kind="open">open</Badge>;
  return <Badge kind="ai">AI</Badge>;
}

// element-size hook for the battlefield fitter
function useSize(){
  const ref = useRef(null);
  const [size, setSize] = useState({ w:0, h:0 });
  useLayoutEffect(()=>{
    if(!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(()=>{
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return ()=>ro.disconnect();
  },[]);
  return [ref, size];
}

Object.assign(window, { Icon, Panel, Segmented, Badge, TeamDot, AgentBadge, useSize });
