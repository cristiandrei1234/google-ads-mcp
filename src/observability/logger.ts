import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      // Write logs to stderr (fd 2). With a pino `transport`, the worker runs
      // in a separate thread and the destination stream passed to pino() is
      // ignored — pino-pretty defaults to stdout (fd 1). For a stdio MCP server
      // stdout MUST carry only JSON-RPC, so pretty logs must go to stderr.
      destination: 2,
    },
  },
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
