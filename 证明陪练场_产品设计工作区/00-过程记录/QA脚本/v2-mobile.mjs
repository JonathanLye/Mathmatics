
import { spawn } from "node:child_process";
import fs from "node:fs";
const CHROME="C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe";
const PORT=9227;
const OUT="D:\\\\DeepSeek Harness\\\\数学分析证明题智能体\\\\证明陪练场_产品设计工作区\\\\00-过程记录\\\\QA截图";
const BASE="http://127.0.0.1:8787";
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const proc=spawn(CHROME,["--headless=new","--disable-gpu","--remote-debugging-port="+PORT,"--user-data-dir=C:\\\\admin\\\\chrome-v2-mobile","--no-first-run","about:blank"],{stdio:"ignore"});
await sleep(2000);
let target=null;
for(let i=0;i<25;i++){ try{ const res=await fetch("http://127.0.0.1:"+PORT+"/json/new?"+encodeURIComponent(BASE+"/?demo=1"),{method:"PUT"}); target=await res.json(); break;}catch(e){await sleep(400);} }
if(!target){console.log("NO TARGET");proc.kill();process.exit(1);}
const ws=new WebSocket(target.webSocketDebuggerUrl); let seq=0; const pending=new Map(); const errors=[];
const send=(m,p={})=>new Promise((res,rej)=>{const id=++seq;pending.set(id,{res,rej});ws.send(JSON.stringify({id,method:m,params:p}));});
ws.onmessage=(ev)=>{const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.rej(m.error):p.res(m.result);} else if(m.method==="Runtime.exceptionThrown"){errors.push(JSON.stringify(m.params.exceptionDetails).slice(0,300));}};
await new Promise(r=>ws.onopen=r);
await send("Runtime.enable"); await send("Page.enable");
const evalJs=async(e)=>{const r=await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true});return r.result?r.result.value:undefined;};
await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
await evalJs("try{localStorage.clear();sessionStorage.clear();}catch(e){} 'ok'");
await send("Page.navigate",{url:BASE+"/?demo=1"});
await sleep(3000);

const shot=async(n)=>{const r=await send("Page.captureScreenshot",{format:"png"});fs.writeFileSync(OUT+"\\"+n+".png",Buffer.from(r.data,"base64"));console.log("SHOT",n);};
const click=async(sel)=>await evalJs("(function(){var el=document.querySelector("+JSON.stringify(sel)+");if(el){el.click();return true;}return false;})()");
const fill=async(sel,val)=>await evalJs("(function(){var el=document.querySelector("+JSON.stringify(sel)+");if(!el)return false;el.value="+JSON.stringify(val)+";el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");
const waitFor=async(expr,to=9000)=>{const t=Date.now();while(Date.now()-t<to){if(await evalJs("!!("+expr+")"))return true;await sleep(250);}return false;};
await evalJs("(function(){var s=document.createElement('style');s.textContent='*{animation:none!important;transition:none!important}';document.head.appendChild(s);})()");
await waitFor("document.querySelector('#student-root') && document.querySelector('#student-root').innerText.includes('本周')");
await sleep(500); await shot("v2-mobile-home");
await click('[data-action="goto-s2"]'); await sleep(1000);
await click('[data-action="start-problem"]'); await sleep(1500);
await shot("v2-mobile-l1");
// L1 pass
await fill('#k-answer','条件收敛就是原级数收敛，但取绝对值后发散。');
await click('[data-action="submit-knowledge"]'); await sleep(1500);
// L2 pass
await fill('#p-goal','判断级数收敛性并区分条件/绝对收敛');
await fill('#p-parts','两件事：先证收敛，再证绝对值发散');
await fill('#p-keywords','交错级数，(−1)^(n−1)');
await fill('#p-tools','莱布尼茨判别法，p级数');
await click('[data-action="submit-parse"]'); await sleep(1500);
await shot("v2-mobile-l3");
const metrics=await evalJs("JSON.stringify({iw:innerWidth,sw:document.documentElement.scrollWidth,over:[...document.querySelectorAll('*')].filter(function(el){var r=el.getBoundingClientRect();return r.right>innerWidth+1||r.left<-1;}).slice(0,10).map(function(el){return el.tagName+'.'+el.className;})})");
console.log("METRICS:",metrics);
console.log("ERRORS:",errors.slice(0,5).join(" || ")||"none");
ws.close();proc.kill();
