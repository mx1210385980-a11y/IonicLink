import assert from "node:assert/strict";
import { extractDoiFromPages, normalizeDoi } from "./doi";

/* --- normalization: prefixes, trailing punctuation, case --- */
assert.equal(normalizeDoi("https://doi.org/10.1021/acssuschemeng.5c10210"), "10.1021/acssuschemeng.5c10210");
assert.equal(normalizeDoi("http://dx.doi.org/10.3390/lubricants6030064"), "10.3390/lubricants6030064");
assert.equal(normalizeDoi("DOI: 10.1016/j.jcis.2024.08.187"), "10.1016/j.jcis.2024.08.187");
assert.equal(normalizeDoi("10.1021/ACSAMI.3C10018"), "10.1021/acsami.3c10018", "DOIs are case-insensitive — compare lowercased");
assert.equal(normalizeDoi("10.1021/acsami.3c10018."), "10.1021/acsami.3c10018", "sentence-final period stripped");
assert.equal(normalizeDoi("10.1021/acsami.3c10018;"), "10.1021/acsami.3c10018");
assert.equal(
  normalizeDoi("10.1016/S0167-5729(02)00100-0"),
  "10.1016/s0167-5729(02)00100-0",
  "balanced parens are part of the DOI"
);
assert.equal(normalizeDoi("10.1000/abc123)"), "10.1000/abc123", "unbalanced trailing paren stripped");
assert.equal(normalizeDoi("not a doi"), "", "non-DOI input normalizes to empty");

console.log("DOI normalization tests passed");

/* --- extraction: marker preference, page order, page limit --- */
const page = (n: number, text: string) => ({ page: n, text });

assert.equal(
  extractDoiFromPages([page(1, "ACS Appl. Mater. https://doi.org/10.1021/acsami.3c10018 some title")]),
  "10.1021/acsami.3c10018"
);

// a citation's bare DOI earlier on the page loses to the paper's own marked DOI line
assert.equal(
  extractDoiFromPages([
    page(1, "as shown previously 10.9999/cited.ref ... this article: DOI 10.1021/own.paper Received 2026"),
  ]),
  "10.1021/own.paper",
  "marker-prefixed DOI beats an earlier bare one"
);

// with no marked DOI anywhere, the first bare match wins
assert.equal(extractDoiFromPages([page(1, "see 10.1000/first and 10.1000/second")]), "10.1000/first");

// page 1 wins over page 2 even when page 2 has a marked DOI
assert.equal(
  extractDoiFromPages([page(2, "doi.org/10.2222/page.two"), page(1, "footer 10.1111/page.one")]),
  "10.1111/page.one",
  "earlier pages win regardless of input order"
);

// only the first pages are scanned — reference lists deep in the paper don't match
assert.equal(extractDoiFromPages([page(1, "no doi here"), page(2, "none"), page(3, "doi:10.3333/refs.only")]), null);
assert.equal(extractDoiFromPages([page(1, "plain text, nothing to find")]), null);
assert.equal(extractDoiFromPages([]), null);

console.log("DOI extraction tests passed");
