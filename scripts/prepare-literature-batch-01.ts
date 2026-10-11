import { writeFileSync } from 'node:fs';
import type { ExtractedFields } from '../lib/schema';

// Values transcribed from the four downloaded original PDFs; source pages were
// independently checked by the coordinating agent (root-verification/*.json/png).
const base='data/literature-expansion-20260912';
const batch:any[]=[];
const provenance=(field:string,page:number,section:string,basisNote:string,table?:string)=>({field,page,section,basis:'direct' as const,basisNote,...(table?{table}:{})});
const add=(key:string,pdf:string,url:string,fields:ExtractedFields,reason:string)=>batch.push({key,sourcePdf:`${base}/discovery-papers/${pdf}`,sourceUrl:url,fields,decision:'approve',reason});
const phosphonium='trihexyl(tetradecyl)phosphonium';
const phosphoniumSmiles='[P+](CCCCCC)(CCCCCC)(CCCCCC)CCCCCCCCCCCCCC';
const behp='bis(2-ethylhexyl) phosphate';
const behpSmiles='CCCCC(CC)COP(=O)([O-])OCC(CC)CCCC';

const pil={title:'Ecofriendly Protic Ionic Liquid Lubricants for Ti6Al4V',doi:'10.3390/lubricants11010005',journal:'Lubricants',year:2023};
const salts=[['DSa','salicylate','O=C([O-])c1ccccc1O'],['DCi','citrate','O=C([O-])CC(O)(CC(=O)[O-])C(=O)[O-]'],['DL','lactate','CC(O)C(=O)[O-]']];
const regimes=[
  {name:'neat-25C',temperature:'25 °C',table:'Table 4',page:7,cof:[.28,.28,.30],sd:[.07,.03,.01],concentration:'neat PIL',preparation:'Neat liquid as received; adsorbed water not dried'},
  {name:'aqueous-25C',temperature:'25 °C',table:'Table 5',page:7,cof:[.43,.65,.54],sd:[.03,.06,.05],concentration:'1 wt% PIL in water',preparation:'Aqueous 1 wt% PIL; 200 m test'},
  {name:'film-25C',temperature:'25 °C',table:'Table 6',page:8,cof:[.42,.24,.13],sd:[.02,.04,.01],concentration:'Film from 1 wt% aqueous PIL precursor; residual water fraction not quantified',preparation:'Thin PIL layer deposited by evaporation of water before the test'},
  {name:'neat-100C',temperature:'100 °C',table:'Table 8',page:15,cof:[.52,.36,.43],sd:[.02,.02,.03],concentration:'neat PIL',preparation:'Neat liquid; test at 100 °C'},
];
for(const regime of regimes) salts.forEach(([label,anion,smiles],i)=>{
  const fields:ExtractedFields={paper:pil,cation:'bis(2-hydroxyethyl)ammonium',cationSmiles:'OCC[NH2+]CCO',anion,anionSmiles:smiles,
    substrate:'Ti6Al4V',temperature:regime.temperature,load:'1 N',cof:regime.cof[i],scale:'macro',method:'Pin-on-disk tribometer',probe:'Sapphire (Al2O3) ball; diameter 1.5 mm',probeType:'Sapphire ball',
    velocity:'0.05 m/s',roughness:'<0.20 µm',concentration:regime.concentration,cofMethod:'Mean coefficient of friction over the reported test, averaged across replicate tests',
    flexible:[{key:'lubricant_label',value:label},{key:'sample_preparation',value:regime.preparation},{key:'sliding_distance',value:'200 m'},{key:'cof_standard_deviation',value:String(regime.sd[i])},{key:'relative_humidity',value:'50 ± 5%'},{key:'ion_stoichiometry',value:label==='DCi'?'3 cations : 1 citrate(3-)':'1 cation : 1 anion'}],
    provenance:[...['cation','anion'].map(field=>provenance(field,3,'Figure 1','Ion identities and charges from the original molecular structures.')), ...['substrate','probe','load','temperature','velocity','roughness'].map(field=>provenance(field,3,'2.1 Materials; 2.4 Tribological Tests','Common conditions apply to these tests; temperature assignment also stated in the corresponding results section.')),provenance('cof',regime.page,'3.3 / 3.5',`Mean and standard deviation from ${regime.table}, ${label} row.`,regime.table),provenance('concentration',regime.name.startsWith('film')?8:regime.page,'3.3 / 3.5',regime.preparation)]};
  add(`pil-${label}-${regime.name}`,'lubricants-11-00005.pdf','https://www.mdpi.com/2075-4442/11/1/5',fields,`${regime.table} row and page 3 methods verified; ion structures verified from Figure 1; regime-specific preparation preserved.`);
});

const nano={title:'Graphene-Ionic Liquid Thin Film Nanolubricant',doi:'10.3390/nano10030535',journal:'Nanomaterials',year:2020};
for(const [key,graphene,thin,cof,sd,thickness] of [
  ['neat',false,false,.10,.009,340],['graphene',true,false,.10,.009,470],['thin',false,true,.10,.009,34],['graphene-thin',true,true,.06,.006,128],
] as const) {
  add(`nano-${key}`,'nanomaterials-10-00535.pdf','https://www.mdpi.com/2079-4991/10/3/535',{
    paper:nano,cation:'[OMIM]',anion:'[TFSI]',substrate:'AISI 316L stainless steel',temperature:'23 ± 1 °C',load:'0.5 N',cof,scale:'macro',method:'Pin-on-disk tribometer',probe:'Sapphire ball; radius 0.75 mm',probeType:'Sapphire ball',velocity:'0.01 m/s',roughness:'<0.15 µm',
    concentration:graphene?'IL + 0.5 wt% graphene':'neat IL',additives:graphene?'Graphene, 0.5 wt%':undefined,cofMethod:'Reported coefficient of friction; replicate tests at least 3',
    flexible:[{key:'sample_preparation',value:thin?'Spin coated at 1000 rpm for 30 s':'Full-fluid lubricant covering surface; 0.2 mL'},{key:'initial_deposited_film_thickness',value:`approximately ${thickness} µm`,note:'Pretest gravimetric estimate over disk area; not the loaded contact separation.'},{key:'cof_reported_uncertainty',value:`±${sd}`},{key:'sliding_distance',value:'500 m'},{key:'relative_humidity',value:'55 ± 5%'}],
    provenance:[...['cation','anion','concentration','additives'].map(field=>provenance(field,2,'2 Materials and Methods','OMIM/TFSI and 0.5 wt% graphene formulation; spin coating method.')),...['substrate','probe','load','temperature','velocity','roughness'].map(field=>provenance(field,3,'2 Materials and Methods','Experimental conditions in Table 1.','Table 1')),provenance('cof',5,'3.2 Friction Coefficients and Wear Rates',`Table 2 row: ${key}; uncertainty retained.`,'Table 2')],
  },'Original Table 1 test conditions and Table 2 COF checked; graphene concentration and pretest coating thickness retained separately.');
}

const hybrid={title:'Synergistic Effects of Functionalized WS2 and SiO2 Nanoparticles and a Phosphonium Ionic Liquid as Hybrid Additives of Low-Viscosity Lubricants',doi:'10.3390/lubricants12020058',journal:'Lubricants',year:2024};
for(const [key,additives,cof,sd] of [['IL','none',.1227,.0012],['IL-WS2','0.1 wt% functionalized WS2',.1191,.0017],['IL-SiO2','0.1 wt% functionalized SiO2',.1218,.0013],['IL-WS2-SiO2','0.1 wt% functionalized WS2 + 0.1 wt% functionalized SiO2',.1154,.0010]] as const) {
  add(`hybrid-${key}`,'lubricants-12-00058.pdf','https://www.mdpi.com/2075-4442/12/2/58',{
    paper:hybrid,cation:phosphonium,cationSmiles:phosphoniumSmiles,anion:behp,anionSmiles:behpSmiles,substrate:'100Cr6 steel pins',temperature:'393.15 K',load:'9.43 N',cof,scale:'macro',method:'Ball-on-three-pins tribometer; pure sliding',probe:'100Cr6 steel ball; diameter 12.7 mm',probeType:'Steel ball',velocity:'0.10 m/s',roughness:'0.08 µm',concentration:'1 wt% IL in PAO6',additives:`PAO6 base oil; ${additives}`,cofMethod:'Mean coefficient of friction from three replicate pure-sliding tests',
    flexible:[{key:'cof_standard_deviation',value:String(sd)},{key:'load_definition',value:'9.43 N in each pin (per contact), as stated in section 2.3'},{key:'base_oil',value:'PAO6'},{key:'lubricant_volume',value:'about 1.3 mL'}],
    provenance:[...['cation','anion'].map(field=>provenance(field,2,'Introduction / formulation','Trihexyltetradecylphosphonium bis(2-ethylhexyl)phosphate identified for the tested IL.')),...['substrate','probe','load','temperature','velocity','roughness'].map(field=>provenance(field,6,'2.3 Tribological Tests: Pure Sliding','9.43 N per pin, 0.10 m/s, 393.15 K.')),...['cof','concentration','additives'].map(field=>provenance(field,8,'3.1 Friction and Wear Findings under Pure Sliding Tests','Select the IL-containing row, with formulation and COF/SD.','Table 2'))],
  },'Table 2 IL-containing rows checked against section 2.3 pure-sliding protocol; per-pin force retained; separate rolling-sliding protocol not used.');
}

const titania={title:'Nano- and Macroscale Study of the Lubrication of Titania Using Pure and Diluted Ionic Liquids',doi:'10.3389/fchem.2019.00287',journal:'Frontiers in Chemistry',year:2019};
const liquids=[
  {label:'P66614-TFSI',cation:phosphonium,cationSmiles:phosphoniumSmiles,anion:'[TFSI]'},
  {label:'P66614-phosphinate',cation:phosphonium,cationSmiles:phosphoniumSmiles,anion:'bis(2,4,4-trimethylpentyl)phosphinate',anionSmiles:'O=P([O-])(CC(C)CC(C)(C)C)CC(C)CC(C)(C)C'},
  {label:'P888-ethylhexyl-BEHP',cation:'trioctyl(2-ethylhexyl)phosphonium',cationSmiles:'[P+](CCCCCCCC)(CCCCCCCC)(CCCCCCCC)CC(CC)CCCC',anion:behp,anionSmiles:behpSmiles},
  {label:'P66614-BEHP',cation:phosphonium,cationSmiles:phosphoniumSmiles,anion:behp,anionSmiles:behpSmiles},
];
for(const regime of [{load:5,temp:25,cof:[.13,.13,.13,.22],figure:'Fig. 1A'},{load:10,temp:25,cof:[.13,.13,.28,.35],figure:'Fig. 1B'},{load:5,temp:60,cof:[.13,.15,.35,.35],figure:'Fig. 1C'}]) liquids.forEach(({label,...ions},i)=>{
  const endpoint=regime.temp===60 && i===1;
  add(`titania-${label}-${regime.load}N-${regime.temp}C`,'frontiers-chemistry-titania.pdf','https://www.frontiersin.org/journals/chemistry/articles/10.3389/fchem.2019.00287/full',{
    paper:titania,...ions,substrate:'Titanium with native titania surface',temperature:`${regime.temp} °C`,load:`${regime.load} N`,cof:regime.cof[i],scale:'macro',method:'Three-balls-on-plate tribometer',probe:'Stainless steel balls; diameter 12.7 mm',probeType:'Steel balls',velocity:'15 mm/s',roughness:'108 ± 16 nm',concentration:'neat IL',cofMethod:endpoint?'Reported friction coefficient at the 9 m endpoint (not steady-state mean)':'Reported post-break-in friction force / normal force ratio',
    flexible:[{key:'load_definition',value:'Reported total axial force in three-ball fixture; not per-ball force'},{key:'lubricant_label',value:label},{key:'surface_preparation',value:'Unpolished commercially available titanium; ethanol-cleaned and air-dried'},{key:'measurement_stage',value:endpoint?'9 m endpoint after progressive decrease':'post-break-in reported level'},{key:'roughness_definition',value:'RMS from 5 × 5 µm AFM scan'}],
    provenance:[...['cation','anion','substrate','roughness'].map(field=>provenance(field,2,'Materials and Methods','IL identities and titanium surface preparation.')),...['probe','load','temperature','velocity'].map(field=>provenance(field,3,'Macrotribology','Common macrotribology protocol; specific load/temperature also linked to the result on page 4.')),provenance('cof',4,'Results and Discussion: Macrotribology',`${regime.figure} described numerically in the original text; ${endpoint?'9 m endpoint explicitly identified':'post-break-in value'}.`),provenance('concentration',4,'Results and Discussion: Macrotribology','Pure IL conditions in Figure 1; separate diluted experiments excluded.')],
  },`Page 4 gives numeric COF and links the material to ${regime.figure}; page 3 protocol verified. ${endpoint?'Endpoint stored explicitly, without asserting steady state.':''}`);
});
liquids.forEach(({label,...ions},i)=>batch.push({
  key:`held-titania-AFM-${label}`,sourcePdf:`${base}/discovery-papers/frontiers-chemistry-titania.pdf`,sourceUrl:'https://www.frontiersin.org/journals/chemistry/articles/10.3389/fchem.2019.00287/full',
  fields:{paper:titania,...ions,substrate:'Titanium with native titania surface',cof:[.17,.16,.08,.33][i],method:'AFM',scale:'nano'},
  decision:'hold',reason:'Not admitted: page 4 gives scan size 500 nm and rate 5.92 Hz (derived sliding speed 5.92 micrometres/s), while Figure 3 on page 6 states 35 micrometres/s. No source correction resolves the discrepancy; fitted normal-force intervals also require independent verification. Table 2 values preserved for source follow-up only.',
}));
writeFileSync(`${base}/reviewed-batch-01.json`,JSON.stringify(batch,null,2));
console.log(JSON.stringify({candidates:batch.length,byDoi:Object.fromEntries([...new Set(batch.map(r=>r.fields.paper.doi))].map(doi=>[doi,batch.filter(r=>r.fields.paper.doi===doi).length]))}));
