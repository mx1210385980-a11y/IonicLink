/** Rebuild presentation/evidence metadata only. Scientific core values and statuses are untouched. */
import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { backupDomainDatabase, getDataDir, getSource } from "../lib/db";
import { inferSourceFigureBox } from "../lib/sources";
import { locatePerformanceFigurePanels } from "../lib/conductivity/figureLayout.server";
import { extractFullFigureCaption, extractCaptionCurveInsights } from "../lib/conductivity/performanceFigureMetadata";
import { pointInterpretation } from "../lib/conductivity/curveInsights";
import type { ConductivityRecord, ConductivityCurveKeyPoint } from "../lib/conductivity/schema";
import type { BBox } from "../lib/schema";

async function main() {
  const commit=process.argv.includes("--commit");
  const db=new Database(path.join(getDataDir(),"conductivity.db"));
  const rows=db.prepare("SELECT id,payload FROM records WHERE status = 'official'").all() as {id:string;payload:string}[];
  const plans:{id:string;before:string;after:string}[]=[];
  const audit:unknown[]=[];
  const boxes=new Map<string,BBox|null>();
  const layouts=new Map<string,Awaited<ReturnType<typeof locatePerformanceFigurePanels>>>();
  for(const row of rows) {
    const record=JSON.parse(row.payload) as ConductivityRecord;
    const figure=record.extended.performanceFigure;
    if(!figure?.page||!record.sourceId)continue;
    const source=getSource("conductivity",record.sourceId);
    const caption=extractFullFigureCaption(source?.pages.find(p=>p.page===figure.page)?.text??"",figure.figure)??figure.caption;
    const key=`${record.sourceId}:${figure.page}:${figure.figure.replace(/(\d)\s*[a-t]\b/i,"$1")}`;
    if(!boxes.has(key))boxes.set(key,await inferSourceFigureBox("conductivity",record.sourceId,figure.page,figure.figure));
    const box=boxes.get(key);
    const candidate={...figure,caption,figureBox:box??figure.figureBox};
    const layoutKey=`${key}:${figure.figure}:${figure.primaryField}`;
    if(!layouts.has(layoutKey))layouts.set(layoutKey,await locatePerformanceFigurePanels(record.sourceId,candidate));
    let panels=structuredClone(layouts.get(layoutKey)??[]);
    // Preserve prior readings only on the same labelled panel, not on every split crop.
    panels=panels.map(p=>({...p,keyPoints:figure.panels?.find(old=>old.label===p.label)?.keyPoints}));
    // The final '1000' tick extends past the narrow whitespace gutter in this PDF.
    if(record.paper.doi?.toLowerCase()==="10.1016/j.colsurfb.2020.111540"&&figure.page===4&&candidate.figureBox&&Math.abs(candidate.figureBox.x-0.1979)<0.002) {
      for(const panel of panels)if(panel.label==="A"&&panel.figureBox)panel.figureBox.w=0.516-panel.figureBox.x;
    }
    const points=(figure.keyPoints??[]).map(point=>({...point,
      interpretation:pointInterpretation(point),
      sourcePage:point.sourcePage??record.provenance?.[point.field??""]?.page,
      evidence:point.evidence??record.provenance?.[point.field??""]?.quote,
    }));
    for(const p of extractCaptionCurveInsights(caption??"",figure.curveType,figure.page)) {
      if(!points.some(old=>old.field===p.field&&old.value===p.value))points.push(p as typeof points[number]);
    }
    // Audited against PDF p.5, DOI 10.1002/batt.202300009. Do not generalize these numbers to other papers.
    if(record.paper.doi?.toLowerCase()==="10.1002/batt.202300009"&&figure.page===5&&figure.primaryField==="chargeTransferResistance") {
      const rs:ConductivityCurveKeyPoint={label:"高频实轴截距 · ESR",field:"seriesResistance",value:"1.33 Ω cm²",kind:"intercept",source:"paper-text",sourcePage:5,
        interpretation:"文献将高频实轴截距归为等效串联电阻，报告其不随电极电势变化；不要与 Rct 混用。",
        evidence:"The high-frequency X-axis intercept corresponds to the equivalent series resistance (ESR) ... Independent of the potential ... the ESR value was found to be 1.33 Ω cm²."};
      if(!points.some(p=>p.field===rs.field))points.push(rs as typeof points[number]);
      const alternatives=await locatePerformanceFigurePanels(record.sourceId,{...candidate,figure:"Fig. 3"});
      const panelB=alternatives.find(p=>p.label==="B");
      if(panelB) {
        // Both reported slopes are figure-level comparisons, not a uniquely measured 0 V slope.
        panelB.curveType="Warburg diffusion analysis";panelB.xAxis="ω⁻¹ᐟ² / (rad s⁻¹)⁻¹ᐟ²";panelB.yAxis="Z′ / Ω";
        panelB.keyPoints=[
          {label:"阳极电势区 · Warburg 斜率",field:"warburgCoefficient",value:"≈76 Ω s⁻¹ᐟ²",slope:"76 Ω s⁻¹ᐟ²",seriesLabel:"anodic potentials",kind:"slope",source:"figure-annotation",sourcePage:5,interpretation:"论文以 Z′ 对 ω⁻¹ᐟ² 的斜率表征扩散阻抗；这是阳极电势区的比较值，不自动等同于本条记录电势下的拟合值。",evidence:"The Warburg coefficient is higher (76 Ω s⁻¹ᐟ²) at anodic potentials compared to cathodic potentials (45 Ω s⁻¹ᐟ²) (Figure 3b)."},
          {label:"阴极电势区 · Warburg 斜率",field:"warburgCoefficient",value:"≈45 Ω s⁻¹ᐟ²",slope:"45 Ω s⁻¹ᐟ²",seriesLabel:"cathodic potentials",kind:"slope",source:"figure-annotation",sourcePage:5,interpretation:"与阳极电势区形成对照；此值不是电导率，也不能在缺少模型条件时直接换算扩散系数。",evidence:"The Warburg coefficient is higher (76 Ω s⁻¹ᐟ²) at anodic potentials compared to cathodic potentials (45 Ω s⁻¹ᐟ²) (Figure 3b)."},
        ];
        panels=[...panels.filter(p=>p.label==="A"),panelB];
        for(const point of panelB.keyPoints??[])point.scope="figure-comparison";
      }
      // Visual QA of this supplied PDF: the narrow central gutter includes the (b) label.
      // Keep that complete label with B rather than cutting between its characters.
      if(candidate.figureBox && Math.abs(candidate.figureBox.x-0.183333)<0.002) {
        for(const panel of panels)if(panel.figureBox) {
          const end=panel.figureBox.x+panel.figureBox.w;
          if(panel.label==="A")panel.figureBox.w=0.488-panel.figureBox.x;
          if(panel.label==="B"){panel.figureBox.x=0.488;panel.figureBox.w=end-0.488;}
        }
      }
    }
    // Store both the scientific meaning and traceable numbers for downstream JSON/CSV consumers.
    record.extended.performanceFigure={...candidate,keyPoints:points,panels:panels.length?panels:undefined};
    if(box&&record.provenance?.performanceFigure)record.provenance.performanceFigure={...record.provenance.performanceFigure,figureBox:box};
    const after=JSON.stringify(record);
    if(after!==row.payload)plans.push({id:row.id,before:row.payload,after});
    audit.push({id:row.id,figure:figure.figure,page:figure.page,figureBox:box,panels:panels.map(p=>({label:p.label,figureBox:p.figureBox})),keyPoints:points.length});
  }
  let backup:string|null=null;
  if(commit&&plans.length) {
    backup=backupDomainDatabase("conductivity");if(!backup)throw new Error("Required backup failed");
    db.transaction(()=>{
      const update=db.prepare("UPDATE records SET payload = ? WHERE id = ? AND payload = ?");
      for(const p of plans)if(update.run(p.after,p.id,p.before).changes!==1)throw new Error(`Concurrent edit: ${p.id}; refresh aborted`);
    })();
  }
  const report={mode:commit?"applied":"dry-run",backup,updated:commit?plans.length:0,planned:plans.length,inspected:audit};
  const out=path.join(getDataDir(),"conductivity","curve-insight-refresh-audit.json");
  writeFileSync(out,JSON.stringify(report,null,2));
  console.log(JSON.stringify({mode:report.mode,backup,updated:report.updated,planned:plans.length,panelRecords:audit.filter((a:any)=>a.panels.length).length,audit:out}));
  console.log(JSON.stringify(audit.filter((a:any)=>["#001","#002","#004","#011","#012","#052"].includes(a.id))));
  db.close();
}
main().catch(error=>{console.error(error);process.exitCode=1;});
