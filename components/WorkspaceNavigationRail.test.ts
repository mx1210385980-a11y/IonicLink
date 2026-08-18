import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const railSource = readFileSync("components/WorkspaceNavigationRail.tsx", "utf8");
const workspaceSource = readFileSync("components/ExtractionWorkspaceView.tsx", "utf8");
const topNavSource = readFileSync("components/TopNav.tsx", "utf8");
const rootLayoutSource = readFileSync("app/layout.tsx", "utf8");

assert.match(railSource, /data-testid="workspace-navigation-rail"/, "the app exposes a dedicated desktop navigation rail");
assert.match(railSource, /Property workspaces/, "the rail retains the domain switcher");
assert.match(railSource, /data-testid="workspace-switcher"/, "domain choices are visually grouped into one compact dock");
assert.match(railSource, /href="\/afm" label="AFM workspace"/, "AFM is a fourth top-level workspace in the desktop rail");
assert.match(railSource, /data-testid="section-dock"/, "workspace sections are visually grouped into one compact dock");
assert.match(railSource, /data-testid="utility-dock"/, "teaching and account actions form a separate utility dock");
assert.match(railSource, /tribology: "μ"[\s\S]*conductivity: "σ"[\s\S]*diffusion: "D"/, "scientific domain marks replace ambiguous decorative icons");
assert.match(railSource, /data-testid="rail-tooltip"/, "icon-only controls expose consistent visible hover labels");
assert.match(railSource, /usePathname/, "the global rail derives its active states from the current route");
assert.match(railSource, /section === item\.segment/, "each domain section receives the correct active state");
assert.match(railSource, /item\.segment === "design" \? "\/tribology\/design"/, "the global Design shortcut targets its only reachable preview route");
assert.match(railSource, /section === "design" && item !== "tribology"/, "switching away from Tribology Design falls back to a reachable workspace home");
assert.match(railSource, /RailAuthControls/, "account access remains available after moving the top navigation");
assert.doesNotMatch(railSource, /function BrandMark|function DomainIcon/, "the rail no longer carries the old mixed icon families");
assert.match(
  workspaceSource,
  /lg:grid-cols-\[270px_minmax\(0,1fr\)\]/,
  "desktop Extract keeps its file sidebar and content columns inside the global shell"
);
assert.doesNotMatch(workspaceSource, /<WorkspaceNavigationRail/, "Extract does not render a duplicate navigation rail");
assert.match(rootLayoutSource, /<WorkspaceNavigationRail \/>/, "the rail is mounted once at the application root");
assert.match(rootLayoutSource, /lg:pl-20/, "desktop content is offset by the fixed global rail width");
assert.match(topNavSource, /<header className="[^"]*lg:hidden"/, "the horizontal navigation is mobile-only on every page");
assert.match(topNavSource, /<AuthControls \/>/, "mobile navigation retains the existing auth controls");
assert.match(topNavSource, /href="\/afm"/, "AFM is a fourth top-level workspace in the mobile navigation");
assert.match(topNavSource, /r\.seg === "design" \? "\/tribology\/design"/, "mobile Design uses the same reachable Tribology preview route");
assert.match(topNavSource, /aria-label="教学实验"/, "the compact mobile teaching shortcut keeps an accessible name");
assert.match(topNavSource, /hidden text-base[^"]*sm:inline/, "the wordmark yields space to mobile workspace controls");

console.log("Workspace navigation rail tests passed");
