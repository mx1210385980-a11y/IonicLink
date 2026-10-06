import assert from "node:assert/strict";
import DomainHome from "./page";

for (const domain of ["tribology", "conductivity", "diffusion"]) {
  assert.throws(() => DomainHome({ params: { domain } }), (error: unknown) => {
    return (error as { digest?: string }).digest === "NEXT_REDIRECT;replace;/;307;";
  });
}
assert.throws(() => DomainHome({ params: { domain: "missing" } }), (error: unknown) => {
  return (error as { digest?: string }).digest === "NEXT_NOT_FOUND";
});

console.log("Domain home redirects passed");
