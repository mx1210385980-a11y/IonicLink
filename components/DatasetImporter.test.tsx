import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DatasetImporter } from "./DatasetImporter";

const file = { name: "fixture.xlsx" } as File;
const noop = () => {};
const diffusion = renderToStaticMarkup(<DatasetImporter domain="diffusion" file={file} onClose={noop} />);
assert.match(diffusion, /Import structured data/);
assert.match(diffusion, /fixture\.xlsx/);
assert.match(diffusion, /Preview mapping/);
assert.doesNotMatch(diffusion, /type="file"/);

const tribology = renderToStaticMarkup(<DatasetImporter domain="tribology" file={file} onClose={noop} />);
assert.match(tribology, /No tabular adapter is configured for tribology yet/);

console.log("DatasetImporter render tests passed");
