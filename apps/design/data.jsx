// data.jsx — simulation math utilities. Exports to window.

/* ==================== MATH ==================== */
const lerp = (a,b,u)=>a+(b-a)*u;

function samplePath(path, u){
  if(path.length===1) return { x:path[0][0], y:path[0][1], ang:0 };
  u=Math.max(0,Math.min(1,u));
  const segs=[]; let total=0;
  for(let i=0;i<path.length-1;i++){
    const d=Math.hypot(path[i+1][0]-path[i][0], path[i+1][1]-path[i][1]);
    segs.push(d); total+=d;
  }
  let dist=u*total;
  for(let i=0;i<segs.length;i++){
    if(dist<=segs[i]||i===segs.length-1){
      const t=segs[i]===0?0:dist/segs[i];
      const x=lerp(path[i][0],path[i+1][0],t), y=lerp(path[i][1],path[i+1][1],t);
      const ang=Math.atan2(path[i+1][1]-path[i][1], path[i+1][0]-path[i][0]);
      return { x, y, ang };
    }
    dist-=segs[i];
  }
  const n=path.length-1;
  return { x:path[n][0], y:path[n][1], ang:0 };
}

function makeFitter(world, box, pad){
  pad=pad||0;
  const bw=box.w-pad*2, bh=box.h-pad*2;
  const s=Math.min(bw/world.w, bh/world.h);
  const ox=pad+(bw-world.w*s)/2, oy=pad+(bh-world.h*s)/2;
  return {
    s,
    x:(wx)=>ox+wx*s,
    y:(wy)=>oy+wy*s,
    len:(w)=>w*s,
  };
}

Object.assign(window, { samplePath, makeFitter, lerp });
