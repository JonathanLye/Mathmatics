
import { spawn } from "node:child_process";
import fs from "node:fs";

const CHROME = "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe";
const PORT = 9224;
const OUT = "D:\\\\DeepSeek Harness\\\\数学分析证明题智能体\\\\证明陪练场_产品设计工作区\\\\00-过程记录\\\\QA截图";
const BASE = "http://127.0.0.1:8787";
fs.mkdirSync(OUT, {recursive:true});

const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--hide-scrollbars","--remote-debugging-port="+PORT,"--user-data-dir=C:\\\\admin\\\\chrome-fs-qa","--no-first-run","--window-size=1440,1000","about:blank"], {stdio:"ignore"});
await sleep(2000);
let target = null;
for (let i=0;i<25;i++){
  try {
    const res = await fetch("http://127.0.0.1:"+PORT+"/json/new?"+encodeURIComponent(BASE+"/?demo=1"), {method:"PUT"});
    target = await res.json(); break;
  } catch(e){ await sleep(400); }
}
if(!target){ console.log("NO TARGET"); proc.kill(); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq=0; const pending=new Map(); const errors=[];
const send=(method,params={})=>new Promise((resolve,reject)=>{ const id=++seq; pending.set(id,{resolve,reject}); ws.send(JSON.stringify({id,method,params})); });
ws.onmessage=(ev)=>{ const m=JSON.parse(ev.data);
  if(m.id&&pending.has(m.id)){ const p=pending.get(m.id); pending.delete(m.id); m.error?p.reject(m.error):p.resolve(m.result); }
  else if(m.method==="Runtime.exceptionThrown"){ errors.push("EXCEPTION: "+JSON.stringify(m.params.exceptionDetails).slice(0,600)); }
  else if(m.method==="Log.entryAdded" && m.params.entry.level==="error"){ errors.push("LOG: "+m.params.entry.text.slice(0,300)); }
};
await new Promise(r=>ws.onopen=r);
await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
await sleep(2500);
const evalJs = async (expr)=>{ const r = await send("Runtime.evaluate",{expression:expr,returnByValue:true,awaitPromise:true}); return r.result?r.result.value:undefined; };
const shot = async (name)=>{ const r = await send("Page.captureScreenshot",{format:"png"}); fs.writeFileSync(OUT+"\\"+name+".png", Buffer.from(r.data,"base64")); console.log("SHOT", name); };
const waitFor = async (expr, timeout=8000)=>{ const t0=Date.now(); while(Date.now()-t0<timeout){ if(await evalJs("!!("+expr+")")) return true; await sleep(250); } return false; };
const click = async (sel)=>{ return await evalJs("(function(){var el=document.querySelector("+JSON.stringify(sel)+"); if(el){el.click(); return true;} return false;})()"); };
const clickLevel = async (lv)=>{ return await evalJs("(function(){var el=document.querySelector('[data-action=\"use-hint\"][data-level=\""+lv+"\"]'); if(el){el.click(); return true;} return false;})()"); };

await evalJs("(function(){var s=document.createElement('style');s.textContent='*{animation:none!important;transition:none!important}';document.head.appendChild(s);})()");
await waitFor("document.querySelector('#student-root') && document.querySelector('#student-root').innerText.includes('本周')", 12000);
await sleep(800);
await shot("fs-s1");

// 去选题
await click('[data-action="goto-s2"]');
await waitFor("document.querySelector('#problem-grid')", 8000);
await sleep(700); await shot("fs-s2");
// 开始作答
await click('[data-action="start-problem"]');
await waitFor("document.querySelector('#student-input') || document.querySelector('[data-action=\"open-hints\"]') || document.querySelector('#final-draft')", 12000);
await sleep(900); await shot("fs-s3-node1");

let stepClicks=0, hints=0, refusals=0, hintShot=false, refusalShot=false;
for (let i=0;i<60;i++){
  await sleep(650);
  const modal = await evalJs("(function(){var m=document.querySelector('#modal-root'); if(!m||m.hidden||!m.innerText.trim()) return null; var hs=Array.from(document.querySelectorAll('[data-action=\"use-hint\"]')).filter(function(b){return !b.disabled && b.textContent.indexOf('使用')>=0;}).map(function(b){return b.getAttribute('data-level');}); return {hintLevels:hs, alt:!!document.querySelector('[data-action=\"choose-alt\"]'), close:!!document.querySelector('[data-close]')};})()");
  if(modal){
    if(modal.hintLevels && modal.hintLevels.length){
      if(!hintShot){ await shot("fs-hint-modal"); hintShot=true; }
      var pick = modal.hintLevels.indexOf('L2')>=0 ? 'L2' : modal.hintLevels[0];
      await clickLevel(pick); hints++; await sleep(1600); continue;
    }
    if(modal.alt){ if(!refusalShot){ await shot("fs-refusal-modal"); refusalShot=true; } await click('[data-action="choose-alt"]'); refusals++; await sleep(1000); continue; }
    if(modal.close){ await click('[data-close]'); await sleep(900); continue; }
  }
  const hasFinal = await evalJs("!!document.querySelector('#final-draft')");
  if(hasFinal){
    await sleep(500); await shot("fs-s4-final");
    await click('[data-action="fill-final"]'); await sleep(700);
    await click('[data-action="submit-final"]'); await sleep(1700);
    await shot("fs-s4-coverage");
    if(await evalJs("!!document.querySelector('[data-action=\"fill-review\"]')")){
      await click('[data-action="fill-review"]'); await sleep(700);
      await click('[data-action="submit-review"]'); await sleep(1700);
      await shot("fs-s5");
    }
    continue;
  }
  const node = await evalJs("(function(){var t=document.querySelector('#student-root')?document.querySelector('#student-root').innerText:''; var m=t.match(/节点\\s*(\\d+)\\s*\\/\\s*10/); return m?parseInt(m[1],10):null;})()");
  if(node === 5){
    const oh = await evalJs("!!document.querySelector('[data-action=\"open-hints\"]')");
    if(oh){ await click('[data-action="open-hints"]'); await sleep(1100); continue; }
    await sleep(800); continue;
  }
  if(node === 7){
    const aa = await evalJs("!!document.querySelector('[data-action=\"ask-answer\"]')");
    if(aa){ await click('[data-action="ask-answer"]'); await sleep(1200); continue; }
    await sleep(800); continue;
  }
  const canFill = await evalJs("!!document.querySelector('[data-action=\"fill-sample\"]') && !!document.querySelector('[data-action=\"submit-step\"]')");
  if(canFill){
    await click('[data-action="fill-sample"]'); await sleep(350);
    await click('[data-action="submit-step"]'); await sleep(1400); stepClicks++;
    if(stepClicks===4) await shot("fs-s3-chat");
    continue;
  }
  const s5 = await evalJs("document.querySelector('#student-root') ? document.querySelector('#student-root').innerText.includes('这一题你走完了') : false");
  if(s5){
    if(await evalJs("!!document.querySelector('[data-action=\"fill-variant\"]')")){
      await click('[data-action="fill-variant"]'); await sleep(600);
      await click('[data-action="submit-variant"]'); await sleep(1800);
    }
    await shot("fs-s5-final");
    break;
  }
  await sleep(800);
}

const finalText = await evalJs("document.querySelector('#student-root') ? document.querySelector('#student-root').innerText.slice(0,240) : ''");
console.log("FINAL TEXT:", JSON.stringify(finalText));

// 教师端 / 后端 / 说明
await click('button[data-tab="teacher"]'); await sleep(2500); await shot("fs-teacher");
await click('button[data-tab="backend"]'); await sleep(2500); await shot("fs-backend");
await click('button[data-tab="about"]'); await sleep(1200); await shot("fs-about");
console.log("DONE steps="+stepClicks+" hints="+hints+" refusals="+refusals);
console.log("ERRORS:", errors.slice(0,10).join(" || ") || "none");
ws.close(); proc.kill();
