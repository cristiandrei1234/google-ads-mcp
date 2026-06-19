// k6 load test for the Google Ads MCP HTTP server.
//
//   k6 run scripts/load-test.js                       # defaults: BASE=http://localhost:3939
//   BASE=https://mcp.agency.com k6 run scripts/load-test.js
//   TOKEN=<bearer> k6 run scripts/load-test.js         # also exercises an authed tools/list
//
// Stages ramp to 50 virtual users. Thresholds FAIL the run (non-zero exit) if
// readiness p95 > 500ms or any health check errors — wire this into CI/staging.
//
// Without k6 installed, autocannon gives a quick local signal:
//   npx autocannon -c 20 -d 10 http://localhost:3939/health/ready
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE || "http://localhost:3939";
const TOKEN = __ENV.TOKEN || "";

export const options = {
  stages: [
    { duration: "30s", target: 20 },
    { duration: "1m", target: 50 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    // Liveness must stay fast; readiness includes a DB round-trip.
    "http_req_duration{endpoint:healthz}": ["p(95)<200"],
    "http_req_duration{endpoint:ready}": ["p(95)<500"],
    "checks": ["rate>0.99"],
  },
};

export default function () {
  const live = http.get(`${BASE}/healthz`, { tags: { endpoint: "healthz" } });
  check(live, { "healthz 200": (r) => r.status === 200 });

  const ready = http.get(`${BASE}/health/ready`, { tags: { endpoint: "ready" } });
  check(ready, { "ready 200": (r) => r.status === 200 });

  // Optional authenticated path: list tools through a real MCP session.
  if (TOKEN) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${TOKEN}`,
    };
    const init = http.post(
      `${BASE}/mcp`,
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "k6", version: "1" } },
      }),
      { headers, tags: { endpoint: "mcp_init" } }
    );
    check(init, { "mcp init 200": (r) => r.status === 200 });
    const sessionId = init.headers["Mcp-Session-Id"];
    if (sessionId) {
      const listed = http.post(
        `${BASE}/mcp`,
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
        { headers: { ...headers, "mcp-session-id": sessionId }, tags: { endpoint: "tools_list" } }
      );
      check(listed, { "tools/list 200": (r) => r.status === 200 });
    }
  }

  sleep(1);
}
