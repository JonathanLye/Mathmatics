// 用 PGlite（WASM 版 PostgreSQL）完整执行 schema.sql，并验证几条关键约束：
// 事件只追加、已发布题目包不可改、同一布置每人只有一个主作答。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite();
await db.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
const tables = await db.query(`select table_schema||'.'||table_name t from information_schema.tables where table_schema in ('app','content','vault','ev') and table_type='BASE TABLE' order by 1`);
console.log(`schema.sql 执行成功：${tables.rows.length} 张表`);
let bad = 0;
const expectFail = async (label, sql) => { try { await db.exec(sql); bad++; console.log(`✗ 应当失败：${label}`); } catch { console.log(`✓ ${label}`); } };
await db.exec(`
  insert into app.users(id, role, anon_code) values ('00000000-0000-7000-8000-000000000001','teacher','T-01'),('00000000-0000-7000-8000-000000000002','student','S-0001');
  insert into app.classes(id,name,term,owner_id,invite_code) values ('00000000-0000-7000-8000-0000000000c1','数分 1 班','2026 秋','00000000-0000-7000-8000-000000000001','K7Q2MX');
  insert into content.problems(id,title) values ('epsN','数列极限 · ε-N');
  insert into content.problem_versions(problem_id,version,public,review_status) values ('epsN',1,'{"title":"x"}','published');
  insert into app.assignments(id,class_id,problem_id,problem_version,open_at,created_by) values ('00000000-0000-7000-8000-0000000000a1','00000000-0000-7000-8000-0000000000c1','epsN',1,now(),'00000000-0000-7000-8000-000000000001');
  insert into app.attempts(id,assignment_id,user_id,problem_id,problem_version,mode,state,keys_total) values ('00000000-0000-7000-8000-0000000000b1','00000000-0000-7000-8000-0000000000a1','00000000-0000-7000-8000-000000000002','epsN',1,'practice','{}',4);
  insert into ev.events(id,seq,type,source,ts_server,user_anon,role,attempt_id,payload) values ('00000000-0000-7000-8000-0000000000e1',1,'attempt.start','server','2026-11-05T12:00:00Z','S-0001','student','00000000-0000-7000-8000-0000000000b1','{"resumed":false,"kind":"main"}');
`);
await expectFail('事件不可修改', `update ev.events set type='x'`);
await expectFail('事件不可删除', `delete from ev.events`);
await expectFail('已发布题目包不可改', `update content.problem_versions set public='{"title":"y"}' where problem_id='epsN'`);
await expectFail('同一布置每人只能有一个主作答', `insert into app.attempts(assignment_id,user_id,problem_id,problem_version,mode,state,keys_total) values ('00000000-0000-7000-8000-0000000000a1','00000000-0000-7000-8000-000000000002','epsN',1,'practice','{}',4)`);
console.log(bad ? `${bad} 处不通过` : 'SQL 约束检查全部通过');
process.exit(bad ? 1 : 0);
