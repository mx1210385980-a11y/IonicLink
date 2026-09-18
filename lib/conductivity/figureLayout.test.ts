import assert from "node:assert/strict";
import {locatePanelGutters} from "./figureLayout.server";
import {matchEmbeddedFigureBox} from "../sourceFigures";
const w=400,h=320,d=new Uint8ClampedArray(w*h*4).fill(255);
for(let y=10;y<h-10;y++)for(let x=10;x<w-10;x++)if(!(x>175&&x<198)&&!(y>140&&y<164)){const i=(y*w+x)*4;d[i]=d[i+1]=d[i+2]=0;}
const boxes=locatePanelGutters(d,w,h,4);
assert.equal(boxes.length,4);assert.ok(boxes[0].w>=175/w&&boxes[0].w<=198/w);assert.ok(boxes[0].h>=140/h&&boxes[0].h<=164/h);
const solid=new Uint8ClampedArray(w*h*4);for(let i=3;i<solid.length;i+=4)solid[i]=255;
assert.deepEqual(locatePanelGutters(solid,w,h,4),[],"do not cut through continuous artwork");
const target={x:.5,y:.3,w:.4,h:.3},other={x:.1,y:.75,w:.8,h:.1};
assert.deepEqual(matchEmbeddedFigureBox({x:.5,y:.2,w:.45,h:.43},[target,other]),target);
assert.equal(matchEmbeddedFigureBox({x:0,y:0,w:1,h:1},[target,other]),null,"ambiguous image matching fails closed");
console.log("Conductivity figure-layout tests passed");
