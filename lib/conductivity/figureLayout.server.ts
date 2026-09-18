import type { BBox } from "../schema";
import type { ConductivityPerformanceFigure } from "./schema";
import { buildRelevantFigurePanels, parseCaptionPanels } from "./performanceFigurePanels";
import { renderSourceFigure } from "../sources";

/** Locate whitespace gutters in actual artwork. No fixed-height crop or guessed grid cells. */
export function locatePanelGutters(data: Uint8ClampedArray, width: number, height: number, count: number): BBox[] {
  if (count < 2 || count > 12) return [];
  const columns = new Float64Array(width), rows = new Float64Array(height);
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const i=(y*width+x)*4;
    if (data[i+3]>32 && Math.min(data[i],data[i+1],data[i+2])<190) { columns[x]++; rows[y]++; }
  }
  function cuts(profile: Float64Array, parts: number, cross: number): { values: number[]; cost: number } | null {
    const values=[0]; let cost=0;
    for (let part=1; part<parts; part++) {
      const expected=profile.length*part/parts;
      const radius=profile.length/parts*0.23;
      let best=-1, bestCost=Infinity;
      for(let p=Math.ceil(expected-radius);p<expected+radius;p++) {
        // Packed journal plots sometimes have only a one-pixel clear separator.
        // Require very low ink across the whole image, not just an empty patch.
        const band=0;
        let ink=0;
        for(let d=-band;d<=band;d++) ink+=profile[Math.max(0,Math.min(profile.length-1,p+d))];
        const density=ink/((band*2+1)*cross);
        const score=density+Math.abs(p-expected)/profile.length*0.01;
        if(density<0.005 && score<bestCost){best=p;bestCost=score;}
      }
      if(best<0) return null;
      values.push(best/profile.length);cost+=bestCost;
    }
    return {values:[...values,1],cost};
  }
  let best: {boxes:BBox[];score:number}|null=null;
  for(let ncol=1;ncol<=count;ncol++) {
    if(count%ncol) continue;
    const nrow=count/ncol;
    const cx=cuts(columns,ncol,height),cy=cuts(rows,nrow,width);
    if(!cx||!cy)continue;
    const aspect=width*nrow/(height*ncol);
    if(aspect<0.45||aspect>4)continue;
    const score=cx.cost+cy.cost+Math.abs(Math.log(aspect/1.3))*0.015;
    const boxes:BBox[]=[];
    for(let r=0;r<nrow;r++)for(let c=0;c<ncol;c++) boxes.push({x:cx.values[c],y:cy.values[r],w:cx.values[c+1]-cx.values[c],h:cy.values[r+1]-cy.values[r]});
    if(!best||score<best.score)best={boxes,score};
  }
  return best?.boxes??[];
}

export async function locatePerformanceFigurePanels(sourceId: string, figure: ConductivityPerformanceFigure) {
  const count=parseCaptionPanels(figure.caption??"").length;
  if(!figure.page||!figure.figureBox||count<2)return [];
  const rendered=await renderSourceFigure("conductivity",sourceId,figure.page,figure.figure,figure.figureBox);
  if(!rendered)return [];
  const {createCanvas,loadImage}=await import("@napi-rs/canvas");
  const image=await loadImage(rendered.png);
  const canvas=createCanvas(image.width,image.height),ctx=canvas.getContext("2d");
  ctx.drawImage(image,0,0);
  const boxes=locatePanelGutters(ctx.getImageData(0,0,image.width,image.height).data,image.width,image.height,count);
  const base=rendered.box;
  return buildRelevantFigurePanels(figure,boxes.map(b=>({x:base.x+b.x*base.w,y:base.y+b.y*base.h,w:b.w*base.w,h:b.h*base.h})));
}
