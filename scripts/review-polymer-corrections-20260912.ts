import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir='data/literature-expansion-20260912';
const correctionFile=`${dir}/batch-03-polymers-review/corrected-candidates.json`;
const receiptFile=`${dir}/goal-root-review/polymer-correction-receipt.json`;
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
async function main(){
 const db=new Database('data/tribology.db');
 if(existsSync(receiptFile)){
  const receipt=JSON.parse(readFileSync(receiptFile,'utf8'));
  for(const x of receipt.changes) assert.equal((db.prepare('SELECT payload FROM records WHERE id=?').get(x.id) as any).payload,x.after);
  console.log(JSON.stringify({alreadyApplied:true,changes:receipt.changes.length}));db.close();return;
 }
 const before=db.prepare('SELECT id,status,payload FROM records ORDER BY id').all() as any[];
 const corrections=JSON.parse(readFileSync(correctionFile,'utf8'));
 const changes: any[]=[];
 for(const row of before){
  const r=JSON.parse(row.payload), key=r.flexible?.find((f:any)=>f.key==='curation_key')?.value;
  const c=corrections.find((x:any)=>x.key===key); if(!c)continue;
  const demote=c.decision==='hold', neat=key.includes('-neat-');
  if(!demote&&!neat)continue;
  if(demote)r.status='review';
  if(neat)r.flexible=r.flexible.filter((f:any)=>f.key!=='sample_preparation');
  r.flexible.push({key:'subsequent_source_review',value:c.reason,note:'Source cross-material repeated-row audit; AI-assisted review. See batch-03-polymers-review/review-report.md.'});
  changes.push({id:r.id,key,before:row.payload,after:JSON.stringify(r),status:r.status,demoted:demote,neatPreparationRemoved:neat});
 }
 assert.equal(changes.length,4);assert.equal(changes.filter(x=>x.demoted).length,3);
 const backup=`data/backups/tribology-polymer-correction-${Date.now()}.db`;await db.backup(backup);
 const check=new Database(backup,{readonly:true});assert.equal(check.pragma('integrity_check',{simple:true}),'ok');
 assert.deepEqual(check.prepare('SELECT id,status,payload FROM records ORDER BY id').all(),before);check.close();
 db.transaction(()=>{
  assert.deepEqual(db.prepare('SELECT id,status,payload FROM records ORDER BY id').all(),before,'Concurrent changes');
  for(const x of changes)assert.equal(db.prepare('UPDATE records SET status=?,payload=? WHERE id=? AND payload=?').run(x.status,x.after,x.id,x.before).changes,1);
 }).immediate();
 const after=db.prepare('SELECT id,status,payload FROM records ORDER BY id').all() as any[];
 assert.equal(after.length,before.length);
 for(const row of before){const changed=changes.find(x=>x.id===row.id),now=after.find(x=>x.id===row.id);assert.equal(now.payload,changed?.after??row.payload);}
 assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
 const counts=db.prepare('SELECT status,count(*) n FROM records GROUP BY status').all();
 writeFileSync(receiptFile,JSON.stringify({createdAt:new Date().toISOString(),correctionFile,correctionSha256:sha(readFileSync(correctionFile)),backup,backupSha256:sha(readFileSync(backup)),counts,changes},null,2));
 console.log(JSON.stringify({receipt:receiptFile,backup,changes:changes.length,demoted:3,counts}));db.close();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
