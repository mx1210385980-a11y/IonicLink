import assert from "node:assert/strict";
import { buildLibraryEntries, queryLibrary, libraryPageHref, type LibraryRecord } from "./libraryQuery";

const record = (id:string,sourceId:string|undefined,status:"review"|"official",title:string,year?:number,doi?:string)=>({id,sourceId,status,paper:{title,year,doi,journal:"Test Journal"}} as LibraryRecord);
const entries=buildLibraryEntries([
  {id:"a",filename:"alpha.pdf",pageCount:3,createdAt:"2026-01-01"},
  {id:"b",filename:"empty.pdf",pageCount:4,createdAt:"2026-02-01"},
], [record("#1","a","official","Alpha",2024,"10.1/a"),record("#2","a","review","Alpha",2024,"10.1/a"),record("#3","missing","official","Unlinked",2020,"10.1/b"),record("#4",undefined,"official","Unlinked",2021,"10.1/c")],[{sourceId:"a"},{sourceId:"a"}]);
assert.equal(entries.length,2,"records sharing a paper title merge into one literature entry");
const alpha=entries.find(e=>e.title==="Alpha")!;
assert.equal(alpha.jobs,2);
assert.equal(alpha.sources.length,1);
assert.equal(alpha.sources[0]?.id,"a");
assert.equal(alpha.checked,1);
assert.equal(alpha.review,1);
assert.equal(queryLibrary(entries,{state:"mixed"}).total,1);
assert.equal(queryLibrary(entries,{state:"review"}).total,1);
assert.equal(queryLibrary(entries,{state:"checked"}).total,1,"Unlinked group is fully checked");
assert.equal(queryLibrary(entries,{state:"empty"}).total,0,"PDFs without records are not listed as entries");
assert.equal(queryLibrary(entries,{scope:"unlinked"}).total,1);
assert.equal(queryLibrary(entries,{q:"10.1/a Test",year:"2024",scope:"pdf"}).total,1);
assert.equal(queryLibrary(entries,{q:"#2"}).entries[0].title,"Alpha");
assert.equal(queryLibrary(entries,{q:"https://doi.org/10.1/a"}).total,1);
assert.equal(queryLibrary(entries,{q:"nothing"}).total,0);
assert.equal(queryLibrary(entries,{year:"1999"}).total,0);
assert.equal(queryLibrary(entries,{sort:"year"}).entries.at(-1)?.title,"Unlinked","Unlinked (2021) sorts after Alpha (2024)");
const many=Array.from({length:45},(_,i)=>({...entries[0],id:String(i),title:`Title ${i}`}));
assert.equal(queryLibrary(many,{page:"2"}).entries.length,20);
assert.equal(queryLibrary(many,{page:"9999"}).page,3);
assert.equal(queryLibrary(many,{page:"Infinity",sort:"bad",state:["review"]}).page,1);
assert.equal(queryLibrary(many,{page:"-1"}).page,1);
const query=queryLibrary(many,{q:"Title",sort:"title",scope:"pdf"});
const url=new URL(libraryPageHref("/tribology/library",query,2),"http://localhost");
assert.equal(url.searchParams.get("q"),"Title");
assert.equal(url.searchParams.get("sort"),"title");
assert.equal(url.searchParams.get("page"),"2");
console.log("Library grouping, metadata search, status filters, sorting and pagination tests passed");
