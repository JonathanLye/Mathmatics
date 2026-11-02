
import { spawn } from "node:child_process";
import fs from "node:fs";
const CHROME="C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe";
const PORT=9226;
const OUT="D:\\\\DeepSeek Harness\\\\数学分析证明题智能体\\\\证明陪练场_产品设计工作区\\\\00-过程记录\\\\QA截图";
const BASE="http://127.0.0.1:8787";
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const proc=spawn(CHROME,["--headless=new","--disable-gpu","--hide-scrollbars","--remote-debugging-port="+PORT,"--user-data-dir=C:\\\\admin\\\\chrome-v2-qa","--no-first-run","--window-size=1440,1100","about:blank"],{stdio:"ignore"});
await sleep(2000);
let target=null;
for(let i=0;i<25;i++){ try{ const res=await fetch("http://127.0.0.1:"+PORT+"/json/new?"+encodeURIComponent(BASE+"/?demo=1"),{method:"PUT"}); target=await res.json(); break;}catch(e){await sleep(400);} }
if(!target){console.log("NO TARGET");proc.kill();process.exit(1);}
const ws=new WebSocket(target.webSocketDebuggerUrl); let seq=0; const pending=new Map(); const errors=[];
const send=(m,p={})=>new Promise((res,rej)=>{const id=++seq;pending.set(id,{res,rej});ws.send(JSON.stringify({id,method:m,params:p}));});
ws.onmessage=(ev)=>{const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.rej(m.error):p.res(m.result);} else if(m.method==="Runtime.exceptionThrown"){errors.push(JSON.stringify(m.params.exceptionDetails).slice(0,400));} else if(m.method==="Log.entryAdded"&&m.params.entry.level==="error"){errors.push("LOG:"+m.params.entry.text.slice(0,200));}};
await new Promise(r=>ws.onopen=r);
await send("Runtime.enable");await send("Log.enable");await send("Page.enable");
const evalJs=async(e)=>{const r=await send("Runtime.evaluate",{expression:e,returnByValue:true,awaitPromise:true});return r.result?r.result.value:undefined;};
const shot=async(n)=>{const r=await send("Page.captureScreenshot",{format:"png"});fs.writeFileSync(OUT+"\\"+n+".png",Buffer.from(r.data,"base64"));console.log("SHOT",n);};
const click=async(sel)=>await evalJs("(function(){var el=document.querySelector("+JSON.stringify(sel)+");if(el){el.click();return true;}return false;})()");
const fill=async(sel,val)=>await evalJs("(function(){var el=document.querySelector("+JSON.stringify(sel)+");if(!el)return false;el.value="+JSON.stringify(val)+";el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");
const waitFor=async(expr,to=10000)=>{const t=Date.now();while(Date.now()-t<to){if(await evalJs("!!("+expr+")"))return true;await sleep(250);}return false;};
const txt=async()=>await evalJs("document.querySelector('#student-root')?document.querySelector('#student-root').innerText.slice(0,150):''");

await evalJs("try{localStorage.clear();sessionStorage.clear();}catch(e){} 'cleared'");
await send("Page.navigate",{url:BASE+"/?demo=1"});
await sleep(3500);
await evalJs("(function(){var s=document.createElement('style');s.textContent='*{animation:none!important;transition:none!important}';document.head.appendChild(s);})()");
await sleep(1200);
await waitFor("document.querySelector('#student-root') && document.querySelector('#student-root').innerText.includes('本周')");
await sleep(600); await shot("v2-l0-home");
await click('[data-action="goto-s2"]'); await sleep(1200);
await click('[data-action="start-problem"]'); await sleep(1800);
await waitFor("document.querySelector('#k-answer') || document.querySelector('#student-root')",12000);
await sleep(800); await shot("v2-l1");

// L1：先点“我忘了”看知识点卡，再写复述
await click('[data-action="request-knowledge"][data-tab="professional"]'); await sleep(700);
await fill('#k-answer','条件收敛就是原级数收敛，但把每一项取绝对值后，绝对值级数发散。'); await sleep(300);
await click('[data-action="submit-knowledge"]'); await sleep(1800);
console.log("L1=>", await txt());

// L2
await fill('#p-goal','判断这个级数的收敛性，并说明是条件收敛还是绝对收敛');
await fill('#p-parts','两件事：先证原级数收敛，再证绝对值级数发散');
await fill('#p-keywords','交错级数，(−1)^(n−1)，n→∞');
await fill('#p-tools','莱布尼茨判别法，p级数');
await sleep(300); await shot("v2-l2");
await click('[data-action="submit-parse"]'); await sleep(1800);
console.log("L2=>", await txt());

// L3：5 步
const steps=[
 ["证明 u_n=1/√n 单调递减","因为 n+1>n，所以 1/√(n+1)<1/√n。"],
 ["证明 lim 1/√n=0","因为 n^{1/2}→+∞，所以 1/√n→0，极限为 0。"],
 ["由莱布尼茨判别法，原级数收敛","u_n 单调递减且 u_n→0，满足莱布尼茨判别法条件。"],
 ["∑1/√n 是 p=1/2 的 p 级数，发散","p=1/2≤1，由 p 级数判别法，级数发散。"],
 ["原级数条件收敛","原级数收敛，且绝对值级数发散，故条件收敛。"]
];
for(let i=0;i<steps.length;i++){
  await waitFor("document.querySelector('#s-conclusion')",10000);
  await fill('#s-conclusion',steps[i][0]);
  await fill('#s-evidence',steps[i][1]);
  await sleep(300);
  if(i===2){ await shot("v2-l3-mid"); }
  await click('[data-action="submit-step"]');
  await sleep(1600);
  console.log("step"+ (i+1) +"=>", await txt());
}
await shot("v2-l3-steps");
// 用一次提示（L1）验证常驻提示
const l1btn = await evalJs("(function(){var b=document.querySelector('[data-action=\"use-hint\"][data-level=\"L1\"]'); if(b&&!b.disabled){b.click();return true;} return false;})()");
if(l1btn){ await sleep(900); await shot("v2-l3-hint"); }
await click('[data-action="finish-steps"]'); await sleep(1800);
console.log("finish=>", await txt());
await shot("v2-l3-final");

// L4
await waitFor("document.querySelector('#e-text')",10000);
await fill('#e-text','要证两件事：先证原级数收敛，再证绝对值级数发散。第一段用莱布尼茨判别法：u_n=1/√n 单调递减，且 lim 1/√n=0，所以交错级数收敛。第二段看绝对值级数 ∑1/√n，这是 p=1/2 的 p 级数，p≤1 时发散，所以不绝对收敛。两段合起来，原级数条件收敛。');
await sleep(300); await shot("v2-l4");
await click('[data-action="submit-explain"]'); await sleep(1800);
console.log("L4=>", await txt());

// L5
await waitFor("document.querySelector('#v-answer')",10000);
await sleep(500);
await fill('#v-answer','绝对收敛：因为 ∑1/n² 是 p=2 的 p 级数，p>1 收敛，所以原级数绝对收敛。');
await sleep(300); await shot("v2-l5");
await click('[data-action="submit-variant"]'); await sleep(1800);
console.log("L5=>", await txt());

// L6
await waitFor("document.querySelector('#sum-knowledge')",10000);
await fill('#sum-knowledge','条件收敛要证两件事：原级数收敛 + 绝对值级数发散；莱布尼茨判别法要核单调和极限为0。');
await fill('#sum-difficulty','最容易漏的是莱布尼茨的单调性条件，以及 p 级数的适用范围。');
await fill('#sum-steps','先拆成收敛与绝对发散两件事；收敛用莱布尼茨逐条核条件；绝对发散用 p 级数结论；最后写条件收敛。');
await sleep(300); await shot("v2-l6");
await click('[data-action="submit-summary"]'); await sleep(2000);
await shot("v2-l6-done");
console.log("L6=>", await txt());

// 教师端/后端
await click('button[data-tab="teacher"]'); await sleep(2200); await shot("v2-teacher");
await click('button[data-tab="backend"]'); await sleep(2200); await shot("v2-backend");

console.log("ERRORS:", errors.slice(0,8).join(" || ")||"none");
ws.close();proc.kill();
