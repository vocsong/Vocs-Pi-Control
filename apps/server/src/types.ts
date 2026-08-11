import type { FastifyInstance, RawServerDefault } from "fastify";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "pino";

/**
 * The Fastify instance type produced by buildApp, which installs a pino
 * logger instance (rather than fastify's default base logger).
 */
export type AppFastify = FastifyInstance<RawServerDefault, IncomingMessage, ServerResponse, Logger>;
