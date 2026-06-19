import { trace, SpanStatusCode, type Attributes } from "@opentelemetry/api";

/**
 * Vendor-neutral distributed tracing via the OpenTelemetry **API only**.
 *
 * We deliberately do NOT bundle the OTel SDK/exporter (it drags in a large,
 * advisory-heavy transitive tree — gRPC/protobuf for OTLP). Instead the code is
 * instrumented with the tiny `@opentelemetry/api`, which is a no-op until an SDK
 * is registered. Operators turn on real tracing at deploy time with zero code
 * changes:
 *
 *   npm i -g @opentelemetry/auto-instrumentations-node   # in the runtime env
 *   NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register" \
 *   OTEL_EXPORTER_OTLP_ENDPOINT=https://collector:4318 \
 *   OTEL_SERVICE_NAME=google-ads-mcp \
 *     node dist/server/http.js
 *
 * The auto-instrumentation also wires HTTP/Express spans, and our `withToolSpan`
 * spans nest under the incoming request span automatically.
 */

const tracer = trace.getTracer("google-ads-mcp");

/**
 * Run `fn` inside an active span named `name`. Records the result status,
 * captures exceptions, and always ends the span. Returns whatever `fn` returns.
 * A no-op (near-zero cost) until an OTel SDK is registered.
 */
export function withToolSpan<T>(name: string, attributes: Attributes, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(attributes);
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
