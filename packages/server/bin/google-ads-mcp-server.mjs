#!/usr/bin/env node
// The HTTP transport itself lives in @automwise/google-ads-mcp's build. This
// package exists to carry the dependencies only that entry point needs — a web
// framework, an ORM, an auth stack and React — so a stdio install does not.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

let entry;
try {
  entry = require.resolve("@automwise/google-ads-mcp/dist/server/http.js");
} catch {
  process.stderr.write(
    "@automwise/google-ads-mcp is not installed. The HTTP transport lives in that " +
    "package's build; install it alongside this one:

" +
    "  npm install @automwise/google-ads-mcp
"
  );
  process.exit(1);
}

await import(pathToFileURL(entry).href);
