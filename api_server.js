node -e "
const fs = require('fs');
const content = \`'use strict';
const http = require('http');
const PORT = 3001;
function safeRequire(p){try{const a=require.resolve(p);delete require.cache[a];return require(p)}catch(e){return null}}
function cors(res){res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type','application/json')}
function json(res,data,s=200){cors(res);res.writeHead(s);res.end(JSON.stringify(data))}
function getAllData(){
  const base='/Users/macpro/Desktop/peakseek/src';
  const spot=safeRequire(base+'/spot');
  const whale=safeRequire(base+'/whale_watcher');
  const social=safeRequire(base+'/social_agent');
  let state={trial:{trades:0,wins:0,losses:0,grossWin:0,grossLoss:0,balance:10000},positions:[]};
  try{state=JSON.parse(require('fs').readFileSync('/Users/macpro/Desktop/peakseek/data/state.json','utf8'))}catch(e){}
  const ss=spot?spot.getSpotStatus():null;
  const ws=whale?whale.getWhaleStatus():null;
  const so=social?social.getSocialStatus():null;
  const allPos=[];
  (state.positions||[]).forEach(p=>allPos.push({symbol:p.symbol||p.name,agent:'futures',agentLabel:'🤖 Futures',chain:p.chain||'HL',entryPrice:p.entryPrice||0,currentPrice:p.currentPrice||p.entryPrice||0,budget:p.budget||0,openedAt:p.openedAt||null,source:'scanner'}));
  if(ss&&ss.positions)ss.positions.forEach(p=>allPos.push({symbol:p.symbol||p.name,agent:'spot',agentLabel:'🪙 Spot',chain:p.chain||'SOL',entryPrice:p.entryPrice||0,currentPrice:p.currentPrice||p.entryPrice||0,budget:p.budget||0,openedAt:p.openedAt||null,source:p.source||'geckoterminal'}));
  if(ws&&ws.positions)ws.positions.forEach(p=>allPos.push({symbol:p.symbol||p.name,agent:'whale',agentLabel:'🐋 Whale',chain:p.chain||'?',entryPrice:p.entryPrice||0,currentPrice:p.currentPrice||p.entryPrice||0,budget:p.budget||0,openedAt:p.openedAt||null,source:'on-chain'}));
  if(so&&so.positions)so.positions.forEach(p=>allPos.push({symbol:p.symbol||p.name,agent:'social',agentLabel:'📢 Social',chain:p.chain||'SOL',entryPrice:p.entryPrice||0,currentPrice:p.currentPrice||p.entryPrice||0,budget:p.budget||0,openedAt:p.openedAt||null,source:p.source||'dexscreener'}));
  allPos.forEach(p=>{if(p.entryPrice>0){p.pnlPct=(p.currentPrice-p.entryPrice)/p.entryPrice*100;p.pnlUsd=p.budget*(p.pnlPct/100)}else{p.pnlPct=0;p.pnlUsd=0}});
  const t=state.trial||{};
  const trades=t.trades||0,wins=t.wins||0,losses=t.losses||0,gw=t.grossWin||0,gl=t.grossLoss||0;
  return{timestamp:Date.now(),agents:{futures:{label:'🤖 Futures',running:true,openPositions:(state.positions||[]).length,maxPositions:3},spot:ss?{label:'🪙 Spot',running:ss.running,openPositions:ss.openPositions,maxPositions:ss.maxPositions||2}:{label:'🪙 Spot',running:false,openPositions:0,maxPositions:2},whale:ws?{label:'🐋 Whale',running:ws.running,openPositions:ws.openPositions,maxPositions:ws.maxPositions||2}:{label:'🐋 Whale',running:false,openPositions:0,maxPositions:2},social:so?{label:'📢 Social',running:so.running,openPositions:so.openPositions,maxPositions:so.maxPositions||2}:{label:'📢 Social',running:false,openPositions:0,maxPositions:2}},positions:allPos,trial:{trades,wins,losses,winRate:trades>0?Math.round(wins/trades*100):0,grossWin:gw.toFixed(2),grossLoss:gl.toFixed(2),netPnl:(gw-gl).toFixed(2),avgWin:wins>0?(gw/wins).toFixed(2):'0.00',avgLoss:losses>0?(gl/losses).toFixed(2):'0.00',balance:(t.balance||10000).toFixed(2)}};
}
const server=http.createServer((req,res)=>{
  if(req.method==='OPTIONS'){cors(res);res.writeHead(204);res.end();return}
  const url=req.url.split('?')[0];
  try{
    if(url==='/status'||url==='/'){const d=getAllData();json(res,{ok:true,...d})}
    else if(url==='/positions'){const d=getAllData();json(res,{ok:true,positions:d.positions,timestamp:d.timestamp})}
    else if(url==='/trial'){const d=getAllData();json(res,{ok:true,trial:d.trial,timestamp:d.timestamp})}
    else if(url==='/health'){json(res,{ok:true,uptime:process.uptime()})}
    else json(res,{ok:false,error:'Not found'},404)
  }catch(e){json(res,{ok:false,error:e.message},500)}
});
server.listen(PORT,'0.0.0.0',()=>{console.log('✅ PeakSeek API on port '+PORT)});
module.exports=server;\`;
fs.writeFileSync('/Users/macpro/Desktop/peakseek/api_server.js', content);
console.log('✅ api_server.js created');
"
node -e "
const fs = require('fs');
const p = '/Users/macpro/Desktop/peakseek/bot.js';
let bot = fs.readFileSync(p, 'utf8');
if (bot.includes('api_server')) {
  console.log('already wired');
} else {
  const line = \"require('./api_server'); // Mini App API\\n\";
  bot = bot.replace(\"'use strict';\", \"'use strict';\\n\" + line);
  fs.writeFileSync(p, bot);
  console.log('✅ wired api_server into bot.js');
}
"
pm2 restart peakseek-bot && pm2 logs peakseek-bot --lines 5
v
