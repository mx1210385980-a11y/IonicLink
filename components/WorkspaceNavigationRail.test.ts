import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const railSource = readFileSync("components/WorkspaceNavigationRail.tsx", "utf8");
const workspaceSource = readFileSync("components/ExtractionWorkspaceView.tsx", "utf8");
const topNavSource = readFileSync("components/TopNav.tsx", "utf8");
const rootLayoutSource = readFileSync("app/layout.tsx", "utf8");

assert.match(railSource, /data-testid="workspace-navigation-rail"/, "the app exposes a dedicated desktop navigation rail");
assert.match(railSource, /Property workspaces/, "the rail retains the domain switcher");
assert.match(railSource, /data-testid="workspace-switcher"/, "domain choices are visually grouped into one compact dock");
assert.match(railSource, /data-testid="section-dock"/, "workspace sections are visually grouped into one compact dock");
assert.match(railSource, /data-testid="utility-dock"/, "teaching and account actions form a separate utility dock");
assert.match(railSource, /tribology: "μ"[\s\S]*conductivity: "σ"[\s\S]*diffusion: "D"/, "scientific domain marks replace ambiguous decorative icons");
assert.match(railSource, /displayLabel \?\? label/, "navigation labels remain visible beside their icons");
assert.match(railSource, /usePathname/, "the global rail derives its active states from the current route");
assert.match(railSource, /section === item\.segment/, "each domain section receives the correct active state");
assert.match(railSource, /href="\/teaching#prediction" label="Prediction of μ"/, "prediction belongs to the teaching navigation");
assert.doesNotMatch(railSource, /segment: "design"/, "prediction is no longer a domain section");
assert.match(railSource, /section === "design" && item !== "tribology"/, "switching away from Tribology Design falls back to a reachable database");
assert.match(railSource, /RailAuthControls/, "account access remains available after moving the top navigation");
assert.doesNotMatch(railSource, /function BrandMark|function DomainIcon/, "the rail no longer carries the old mixed icon families");
assert.match(workspaceSource, /max-w-\[1240px\]/, "Extract shares the centered workspace content width");
assert.match(railSource, /label="Home" active=\{onHomePage\}/, "Home is active on the canonical overview");
assert.match(railSource, /href="\/" label="Home"/, "desktop Home links to the canonical overview");
assert.match(topNavSource, /: "\/";/, "mobile Home links to the same overview");
assert.match(topNavSource, /onDomainPage \|\| onHomePage/, "mobile overview exposes navigation");
assert.doesNotMatch(workspaceSource, /<WorkspaceNavigationRail/, "Extract does not render a duplicate navigation rail");
assert.match(rootLayoutSource, /<WorkspaceNavigationRail \/>/, "the rail is mounted once at the application root");
assert.match(rootLayoutSource, /lg:pl-\[190px\]/, "desktop content is offset by the labeled sidebar width");
assert.match(topNavSource, /<header className="[^"]*lg:hidden"/, "the horizontal navigation is mobile-only on every page");
assert.match(topNavSource, /<AuthControls \/>/, "mobile navigation retains the existing auth controls");
assert.match(topNavSource, /href="\/teaching#prediction"/, "mobile prediction opens the teaching section");
assert.doesNotMatch(topNavSource, /seg: "design"/, "mobile property sections omit the relocated prediction");
assert.match(topNavSource, /aria-label="AI experiment"/, "the mobile teaching shortcut uses the experiment name");
assert.match(topNavSource, /hidden text-base[^"]*sm:inline/, "the wordmark yields space to mobile workspace controls");

console.log("Workspace navigation rail tests passed");
