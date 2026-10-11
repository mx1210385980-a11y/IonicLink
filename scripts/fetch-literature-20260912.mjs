import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Explicit public source URLs only; no authentication or website state required.
const dir = path.resolve('data/literature-expansion-20260912/root-sources');
const sources = [
  ['ye2001.pdf', 'https://pubs.rsc.org/en/content/articlepdf/2001/cc/b106935g'],
  ['ye2001.md', 'https://r.jina.ai/https://pubs.rsc.org/en/content/articlehtml/2001/cc/b106935g'],
  ['water2020.pdf', 'https://pubs.rsc.org/en/content/articlepdf/2020/cp/d0cp05110a'],
  ['water2020.md', 'https://r.jina.ai/https://pubs.rsc.org/en/content/articlehtml/2020/cp/d0cp05110a'],
];
await fs.mkdir(dir, { recursive: true });
const results = await Promise.all(sources.map(async ([filename, url]) => {
  const file = path.join(dir, filename);
  try {
    try { if ((await fs.stat(file)).size > 10000) return {filename, url, cached:true}; } catch {}
    const res = await fetch(url, { signal: AbortSignal.timeout(55000) });
    if (!res.ok) throw Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (filename.endsWith('.pdf') && bytes.subarray(0,5).toString() !== '%PDF-') throw Error('Response is not PDF');
    if (bytes.length < 1000) throw Error('Response too short');
    await fs.writeFile(file, bytes);
    return {filename, url, bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex'), fetchedAt:new Date().toISOString()};
  } catch (error) { return {filename, url, error:String(error)}; }
}));
await fs.writeFile(path.join(dir,'fetch-receipt.json'), JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
