import assert from "node:assert/strict";
import { resolveDomainAlias } from "./domain";

assert.equal(resolveDomainAlias("tribology"), "tribology");
assert.equal(resolveDomainAlias("摩擦"), "tribology");
assert.equal(resolveDomainAlias("%E6%91%A9%E6%93%A6"), "tribology");
assert.equal(resolveDomainAlias("conductivity"), "conductivity");
assert.equal(resolveDomainAlias("导电"), "conductivity");
assert.equal(resolveDomainAlias("diffusion"), "diffusion");
assert.equal(resolveDomainAlias("扩散"), "diffusion");
assert.equal(resolveDomainAlias("unknown"), null);

console.log("Domain alias tests passed");
