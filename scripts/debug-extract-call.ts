import { readFileSync } from 'node:fs';
import { tribologyModule } from '../lib/modules/tribology';

async function main() {
  const text = readFileSync(process.argv[2], 'utf8');
  const body = text.slice(0, 120_000);
  const model = process.env.EXTRACT_MODEL || 'kimi-k3';
  const res = await fetch(`${process.env.OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.KIMI_API_KEY}` },
    body: JSON.stringify({
      model,
      max_completion_tokens: 8000,
      reasoning_effort: process.env.KIMI_REASONING_EFFORT || 'low',
      messages: [
        { role: 'system', content: tribologyModule.systemPrompt },
        { role: 'user', content: tribologyModule.userPrompt(body) },
      ],
      tools: [{ type: 'function', function: { name: tribologyModule.toolName, description: tribologyModule.toolDescription, parameters: tribologyModule.toolSchema as any } }],
      tool_choice: 'required',
    }),
  });
  console.log('HTTP', res.status);
  const data: any = await res.json();
  const choice = data.choices?.[0];
  const args = choice?.message?.tool_calls?.[0]?.function?.arguments || choice?.message?.content || '';
  console.log('finish_reason:', choice?.finish_reason, '| args chars:', args.length, '| usage:', JSON.stringify(data.usage ?? {}));
  try {
    const parsed = JSON.parse(args);
    const records = parsed.records ?? [];
    console.log('records:', records.length);
    for (const r of records.slice(0, 10)) {
      console.log('-', r.cation, '/', r.anion, '| substrate:', r.substrate, '| cof:', r.cof, '| T:', r.temperature, '| load:', r.load, '| scale:', r.scale);
    }
  } catch (e: any) {
    console.log('JSON parse failed:', e.message);
    console.log(args.slice(0, 800));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
