import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DatasetImporter } from "./DatasetImporter";

const diffusion = renderToStaticMarkup(<DatasetImporter domain="diffusion" />);
assert.match(diffusion, /Upload a paper dataset/);
assert.match(diffusion, /Diffusion adapter v1/);
assert.match(diffusion, /accept="\.xlsx,\.csv,\.tsv"/);
assert.match(diffusion, /Preview mapping/);

const tribology = renderToStaticMarkup(<DatasetImporter domain="tribology" />);
assert.match(tribology, /Adapter pending/);
assert.match(tribology, /first tabular adapter is available in the Diffusion workspace/);

console.log("DatasetImporter render tests passed");
