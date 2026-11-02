
import { spawn } from "node:child_process";
import fs from "node:fs";
const CHROME="C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe";
const PORT=9225;
const OUT="D:\\\\DeepSeek Harness\\\\数学分析证明题智能体\\\\证明陪练场_产品设计工作区\\\\00-过程记录\\\\QA截图";
const BASE="http://127.0.0.1:8787";
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const proc=spawn(CHROME,["--headless=new","--disable-gpu","--remote-debugging-port="+PORT,"--user-data-dir=C:\\\\admin\\\\chrome-fs-mobile","--no-first-run","about:blank"],{stdio:"ignore"});
await sleep(2000);
let target=null;
for(let i=0;i<25;i++){ try{ const res=await fetch("http://127.0.0.1:"+PORT+"/json/new?"+encodeURIComponent(BASE+"/?demo=1"),{method:"PUT"}); target=await res.json(); break;}catch(e){await sleep(400);} }
if(!target){console.log("NO TARGET");proc.kill();process.exit(1);}
const ws=new WebSocket(target.webSocketDebuggerUrl); let seq=0; const pending=new Map(); const errors=[];
const send=(m,p={})=>new Promise((res,rej)=>{const id=++seq;pending.set(id,{res,rej});ws.send(JSON.stringify({id,method:m,params:p}));});
ws.onmessage=(ev)=>{const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.rej(m.error):p.res(m.result);} else if(m.method==="Runtime.exceptionThrown"){errors.push(JSON.stringify(m.params.exceptionDetails).slice(0,300));}};
await new Promise(r=>ws.onopen=r);
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
const evalJs=async(e)=>{const r=await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true});return r.result?r.result.value:undefined;};
const shot=async(n)=>{const r=await send("Page.captureScreenshot",{format:"png"});fs.writeFileSync(OUT+"\\"+n+".png",Buffer.from(r.data,"base64"));console.log("SHOT",n);};
const click=async(sel)=>await evalJs("(function(){var el=document.querySelector("+JSON.stringify(sel)+");if(el){el.click();return true;}return false;})()");
const waitFor=async(expr,to=9000)=>{const t=Date.now();while(Date.now()-t<to){if(await evalJs("!!("+expr+")"))return true;await sleep(250);}return false;};
await sleep(2500);
await evalJs("(function(){var s=document.createElement('style');s.textContent='*{animation:none!important;transition:none!important}';document.head.appendChild(s);})()");
await waitFor("document.querySelector('#student-root') && document.querySelector('#student-root').innerText.includes('本周')");
await sleep(600); await shot("fs-mobile-s1");
await click('[data-action="goto-s2"]'); await sleep(1200); await shot("fs-mobile-s2");
await click('[data-action="start-problem"]'); await sleep(1500);
for(let i=0;i<8;i++){
  const can=await evalJs("!!document.querySelector('[data-action=\"fill-sample\"]')&&!!document.querySelector('[data-action=\"submit-step\"]')");
  if(!can) break;
  await click('[data-action="fill-sample"]'); await sleep(300); await click('[data-action="submit-step"]'); await sleep(1100);
}
await shot("fs-mobile-s3");
await click('button[data-tab="teacher"]'); await sleep(2200); await shot("fs-mobile-teacher");
await click('button[data-tab="backend"]'); await sleep(2200); await shot("fs-mobile-backend");
const metrics=await evalJs("JSON.stringify({iw:innerWidth,sw:document.documentElement.scrollWidth,over:[...document.querySelectorAll('*')].filter(function(el){var r=el.getBoundingClientRect();return r.right>innerWidth+1||r.left<-1;}).slice(0,10).map(function(el){return el.tagName+'.'+el.className;})})");
console.log("METRICS:",metrics);
console.log("ERRORS:",errors.slice(0,5).join(" || ")||"none");
ws.close();proc.kill();
