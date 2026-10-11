import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { ingest } from '../lib/ingest';
import { coreCompleteness, type ExtractedFields, type IonicRecord } from '../lib/schema';
import { tribologyModule } from '../lib/modules/tribology';
import { recordStructureKey } from '../lib/structureSearch.server';
import { pdfToPages } from '../lib/pdf';

type ReviewedCandidate = { key: string; sourcePdf: string; sourceUrl: string; fields: ExtractedFields; decision: 'approve'|'hold'; reason: string };
const root = process.cwd();
const output = path.join(root, 'data/literature-expansion-20260912');
const batchFile = path.resolve(process.argv[2] || path.join(output, 'reviewed-batch-01.json'));
const apply = process.argv.includes('--apply');
const hash = (value: string|Buffer) => createHash('sha256').update(value).digest('hex');
function inWorkspace(input: string) {
  const resolved = path.resolve(root,input);
  assert.ok(resolved.toLowerCase().startsWith(root.toLowerCase()+path.sep), 'Path must be within this workspace');
  return resolved;
}
function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return typeof value==='string' ? value.toLowerCase().replace(/\s+/g,' ').trim() : value;
}
function identity(r: any) {
  // Performance is deliberately excluded: conflicting COFs for the same conditions
  // are a review issue, not two independent condition-performance records.
  const quantities = (q:any) => q ? {raw:q.raw,std:q.std,stdUnit:q.stdUnit} : null;
  return hash(JSON.stringify(canonical({
    doi:r.paper.doi || r.paper.title, ions:r.core.ionicLiquid,
    substrate:r.core.substrate, temperature:quantities(r.core.temperature),load:quantities(r.core.load),
    ...Object.fromEntries(['probe','method','velocity','potential','additives','concentration','filmThickness','filmLayers','waterContent','cofMethod'].map(k=>[k,r.extended[k]])),
    distinguishing:r.flexible.filter((f:any)=>['surface_preparation','measurement_stage','lubricant_label','sample_preparation','replicate_id'].includes(f.key)),
  })));
}

async function main() {
  inWorkspace(batchFile);
  mkdirSync(output,{recursive:true});
  const inputBytes=readFileSync(batchFile);
  const candidates=JSON.parse(inputBytes.toString('utf8')) as ReviewedCandidate[];
  assert.ok(Array.isArray(candidates));
  assert.equal(new Set(candidates.map(r=>r.key)).size,candidates.length,'Duplicate candidate key');
  const digest=hash(inputBytes);
  const receiptFile=path.join(output,`${path.basename(batchFile,'.json')}-receipt.json`);
  const planFile=path.join(output,`${path.basename(batchFile,'.json')}-plan.json`);
  const db = new Database(path.join(root,'data/tribology.db'),{readonly:!apply});
  const before=db.prepare('SELECT id,payload FROM records ORDER BY id').all() as {id:string,payload:string}[];
  const baseline=hash(JSON.stringify(before));
  if (existsSync(receiptFile)) {
    const previous=JSON.parse(readFileSync(receiptFile,'utf8'));
    assert.equal(previous.inputSha256,digest,'A committed batch may not be replaced');
    for (const record of previous.records) {
      const row=before.find(x=>x.id===record.id); assert.ok(row,'Previously imported record missing');
      assert.equal(row.payload,JSON.stringify(record),'Previously imported record changed');
    }
    console.log(JSON.stringify({alreadyCommitted:true,records:previous.records.length})); return;
  }
  const current=before.map(x=>JSON.parse(x.payload));
  const seen=new Set(current.map(identity));
  const docs=new Map<string,{path:string;sha256:string;pages:{page:number;text:string}[];url:string;doi:string}>();
  const admitted:{key:string;draft:any;docPath:string;identity:string}[]=[];
  const held=candidates.filter(x=>x.decision==='hold');
  for (const c of candidates.filter(x=>x.decision==='approve')) {
    assert.ok(c.reason && c.sourceUrl && c.fields.paper.doi,`${c.key}: audit/provenance required`);
    const pdfPath=inWorkspace(c.sourcePdf);
    if (!docs.has(pdfPath)) {
      const bytes=readFileSync(pdfPath); assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
      const pages=await pdfToPages(new Uint8Array(bytes));
      assert.ok(pages.length && pages.reduce((n,p)=>n+p.text.length,0)>500);
      docs.set(pdfPath,{path:pdfPath,sha256:hash(bytes),pages,url:c.sourceUrl,doi:c.fields.paper.doi});
    }
    const draft=ingest(c.fields);
    // Preserve source-audited kinematic conversions in this curation workflow.
    if (draft.extended.velocity && draft.provenance?.velocity?.basis === 'inferred') {
      draft.extended.velocitySource = 'derived';
    }
    assert.ok(coreCompleteness(draft).complete,`${c.key}: ${coreCompleteness(draft).missing}`);
    assert.ok(Number.isFinite(draft.core.cof) && draft.core.cof!>=0,`${c.key}: invalid COF`);
    assert.ok(!tribologyModule.acceptDraft || tribologyModule.acceptDraft(draft),`${c.key}: inadmissible`);
    for(const field of ['cation','anion','substrate','load','temperature','cof']) {
      const p=draft.provenance?.[field]; assert.ok(p?.basis,`${c.key}: missing ${field} evidence basis`);
      if(p.basis!=='assumed') assert.ok(p.page && p.page<=docs.get(pdfPath)!.pages.length,`${c.key}: invalid ${field} page`);
    }
    draft.flexible.push({key:'source_url',value:c.sourceUrl},{key:'curation_batch',value:path.basename(batchFile)},
      {key:'curation_key',value:c.key},{key:'audit_resolution',value:c.reason,note:'Source-based AI-assisted curation; not independent domain-expert validation.'});
    const fp=identity(draft); assert.ok(!seen.has(fp),`${c.key}: duplicate condition identity`);seen.add(fp);
    admitted.push({key:c.key,draft,docPath:pdfPath,identity:fp});
  }
  const plan={inputSha256:digest,baselineSha256:baseline,beforeCount:before.length,approved:admitted,held,
    sourceFiles:[...docs.values()].map(({pages,...d})=>({...d,pageCount:pages.length}))};
  if(!apply) { writeFileSync(planFile,JSON.stringify(plan,null,2));console.log(JSON.stringify({plan:planFile,approved:admitted.length,held:held.length,before:before.length}));db.close();return; }
  assert.deepEqual(JSON.parse(readFileSync(planFile,'utf8')),JSON.parse(JSON.stringify(plan)),'Preview changed; audit the updated plan before applying');
  const backups=path.join(root,'data/backups');mkdirSync(backups,{recursive:true});
  const backup=path.join(backups,`tribology-expansion-${Date.now()}.db`);
  await db.backup(backup);
  const check=new Database(backup,{readonly:true});assert.equal(check.pragma('integrity_check',{simple:true}),'ok');
  assert.deepEqual(check.prepare('SELECT id,payload FROM records ORDER BY id').all(),before);check.close();
  const now=new Date().toISOString();
  const sources:{id:string;doc:any;path:string}[]=[];
  for(const d of docs.values()) {
    const id=randomUUID();const dest=path.join(root,'data/tribology/sources',id);
    mkdirSync(dest,{recursive:true});copyFileSync(d.path,path.join(dest,'source.pdf'));
    sources.push({id,path:d.path,doc:{id,filename:path.basename(d.path),pageCount:d.pages.length,createdAt:now,doi:d.doi,pages:d.pages}});
  }
  const columns=['id','status','paper_title','cation','anion','cation_structure_key','anion_structure_key','created_at','payload',...tribologyModule.promotedColumns.map(c=>c.name)];
  const insert=db.prepare(`INSERT INTO records (${columns.join(',')}) VALUES (${columns.map(c=>'@'+c).join(',')})`);
  const added:IonicRecord[]=[];
  db.transaction(()=>{
    assert.deepEqual(db.prepare('SELECT id,payload FROM records ORDER BY id').all(),before,'Concurrent database changes');
    let maximum=(db.prepare('SELECT COALESCE(MAX(CAST(SUBSTR(id,2) AS INTEGER)),0) n FROM records').get() as any).n;
    // IDs 1–94 appeared in the preceding source audit, including rejected rows.
    maximum=Math.max(maximum,94);
    for(const s of sources) db.prepare('INSERT INTO sources (id,filename,page_count,created_at,payload) VALUES (?,?,?,?,?)').run(s.id,s.doc.filename,s.doc.pageCount,now,JSON.stringify(s.doc));
    for(const a of admitted) {
      const r:IonicRecord={...a.draft,id:'#'+String(++maximum).padStart(3,'0'),createdAt:now,status:'official',sourceId:sources.find(s=>s.path===a.docPath)!.id};
      const params:Record<string,unknown>={id:r.id,status:r.status,paper_title:r.paper.title,cation:r.core.ionicLiquid.cation,anion:r.core.ionicLiquid.anion,cation_structure_key:recordStructureKey(r,'cation'),anion_structure_key:recordStructureKey(r,'anion'),created_at:now,payload:JSON.stringify(r)};
      for(const c of tribologyModule.promotedColumns) params[c.name]=c.get(r);
      insert.run(params);added.push(r);
    }
  }).immediate();
  assert.equal(db.pragma('integrity_check',{simple:true}),'ok');
  const after=db.prepare('SELECT id,payload FROM records ORDER BY id').all() as {id:string,payload:string}[];
  assert.equal(after.length,before.length+added.length);
  for(const r of before) assert.deepEqual(after.find(x=>x.id===r.id),r,'Prior record changed');
  for(const r of added) assert.equal(after.find(x=>x.id===r.id)?.payload,JSON.stringify(r));
  const receipt={inputSha256:digest,backup,backupSha256:hash(readFileSync(backup)),createdAt:now,before:before.length,after:after.length,held:held.length,sources:sources.map(s=>({id:s.id,doi:s.doc.doi,filename:s.doc.filename})),records:added};
  writeFileSync(receiptFile,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({imported:added.length,before:before.length,after:after.length,held:held.length,receipt:receiptFile,backup}));db.close();
}
main().catch(error=>{console.error(error);process.exitCode=1;});
