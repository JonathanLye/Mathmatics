
import { spawn } from "node:child_process";
import fs from "node:fs";
const CHROME="C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe";
const PORT=9228;
const OUT="D:\\\\DeepSeek Harness\\\\数学分析证明题智能体\\\\证明陪练场_产品设计工作区\\\\00-过程记录\\\\QA截图";
const BASE="http://127.0.0.1:8787";
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const proc=spawn(CHROME,["--headless=new","--disable-gpu","--remote-debugging-port="+PORT,"--user-data-dir=C:\\\\admin\\\\chrome-v2-proactive","--no-first-run","--window-size=1440,1004","about:blank"],{stdio:"ignore"});
await sleep(2000);
let target=null;
for(let i=0;i<25;i++){ try{ const res=await fetch("http://127.0.0.1:"+PORT+"/json/new?"+encodeURIComponent(BASE+"/?demo=1"),{method:"PUT"}); target=await res.json(); break;}catch(e){await sleep(400);} }
if(!target){console.log("NO TARGET");proc.kill();process.exit(1);}
const ws=new WebSocket(target.webSocketDebuggerUrl); let seq=0; const pending=new Map(); const errors=[];
const send=(m,p={})=>new Promise((res,rej)=>{const id=++seq;pending.set(id,{res,rej});ws.send(JSON.stringify({id,method:m,params:p}));});
ws.onmessage=(ev)=>{const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.rej(m.error):p.res(m.result);} else if(m.method==="Runtime.exceptionThrown"){errors.push(JSON.stringify(m.params.exceptionDetails).slice(0,300));}};
await new Promise(r=>ws.onopen=r);
await send("Runtime.enable");await send("Page.enable");
const evalJs=async(e)=>{const r=await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true});return r.result?r.result.value:undefined;};
const shot=async(n)=>{const r=await send("Page.captureScreenshot",{format:"png"});fs.writeFileSync(OUT+"\\"+n+".png",Buffer.from(r.data,"base64"));console.log("SHOT",n);};
const click=async(sel)=>await evalJs("(function(){var el=document.querySelector("+JSON.stringify(sel)+");if(el){el.click();return true;}return false;})()");
const fill=async(sel,val)=>await evalJs("(function(){var el=document.querySelector("+JSON.stringify(sel)+");if(!el)return false;el.value="+JSON.stringify(val)+";el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");
const waitFor=async(expr,to=9000)=>{const t=Date.now();while(Date.now()-t<to){if(await evalJs("!!("+expr+")"))return true;await sleep(250);}return false;};
await evalJs("try{localStorage.clear();sessionStorage.clear();}catch(e){} 'ok'");
await send("Page.navigate",{url:BASE+"/?demo=1"}); await sleep(3000);
await waitFor("document.querySelector('#student-root') && document.querySelector('#student-root').innerText.includes('本周')");
await click('[data-action="goto-s2"]'); await sleep(1000);
await click('[data-action="start-problem"]'); await sleep(1500);
await fill('#k-answer','条件收敛就是原级数收敛，但取绝对值后发散。'); await click('[data-action="submit-knowledge"]'); await sleep(1400);
await fill('#p-goal','判断级数收敛性并区分条件/绝对收敛'); await fill('#p-parts','两件事：先证收敛，再证绝对值发散'); await fill('#p-keywords','交错级数'); await fill('#p-tools','莱布尼茨'); await click('[data-action="submit-parse"]'); await sleep(1400);
// 连续两次坏步骤
for(let i=0;i<2;i++){
  await fill('#s-conclusion','我不会写'); await fill('#s-evidence','不知道'); await click('[data-action="submit-step"]'); await sleep(1600);
}
const coach = await evalJs("document.querySelector('#student-root')?document.querySelector('#student-root').innerText.slice(-900):''");
console.log("COACH TAIL:", JSON.stringify(coach));
const hasOffer = await evalJs("document.body.innerText.includes('方向') && (document.body.innerText.includes('要不要')||document.body.innerText.includes('主动'))");
console.log("HAS OFFER:", hasOffer);
await shot("v2-proactive");
ws.close();proc.kill();
