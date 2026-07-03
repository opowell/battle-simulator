import { ChessGame } from './games/chess/ChessGame.js';
import { ChessObscuroAgent } from './games/chess/ObscuroAgent.js';
import { available, quit } from './games/chess/stockfish.js';
const V={pawn:1,knight:3,bishop:3,rook:5,queen:9,king:0};
await available();
function material(state,color){let s=0;for(const u of state.units)if(u.ownerId===color)s+=V[u.type];return s;}
async function playGame(blackDiff, whiteDiff, maxTurns){
  const players=[{id:'white',name:'W'},{id:'black',name:'B'}];
  let state=ChessGame.createInitialState(players,{fogOfWar:true,difficulty:0});
  const agents={white:new ChessObscuroAgent(),black:new ChessObscuroAgent()};
  const diffs={white:whiteDiff,black:blackDiff};
  for(let ply=0;ply<maxTurns*2;ply++){
    const res=ChessGame.getResult(state);
    if(res) return {res, state, turns:state.turnNumber};
    const me=state.activePlayers[0];
    const s2={...state,gameSpecific:{...state.gameSpecific,difficulty:diffs[me]}};
    const obs=ChessGame.getVisibleState(s2,me);
    const legal=ChessGame.getLegalActions(obs,me);
    const a=await agents[me].chooseAction({...obs,activePlayers:[me]},legal);
    state=ChessGame.applyActions(s2,[{playerId:me,action:a}]);
  }
  return {res:null, state, turns:state.turnNumber};
}
for(const [bd,wd] of [[100,0],[0,100]]){
  const {res,state,turns}=await playGame(bd,wd,20);
  const mb=material(state,'black'), mw=material(state,'white');
  const hasWK=state.units.some(u=>u.ownerId==='white'&&u.type==='king');
  const hasBK=state.units.some(u=>u.ownerId==='black'&&u.type==='king');
  console.log(`black=${bd} white=${wd}: material B ${mb} vs W ${mw} (B-W ${mb-mw})  kings W:${hasWK} B:${hasBK}  ${res?JSON.stringify(res):`ongoing@T${turns}`}`);
}
quit();
