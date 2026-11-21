// ============================================================
// Fastify → Express compatibility shim for the merged OA module.
//
// The OA backend was written against Fastify. Route files use:
//   · app.addHook('preHandler', fn)          — per-file auth hooks
//   · app.get(path, { preHandler }, wrap(h)) — per-route guards
//   · reply.code(n) / reply.header(k, v) / reply.sent / reply.send(body)
//   · req.file()                              — @fastify/multipart single file
//
// createOaRouter() returns a Fastify-like `app` object backed by an
// Express Router so the 24 OA route files register unchanged. Semantics
// mirrored from Fastify:
//   · hooks run in registration order before every route in that file
//   · a hook that sends a reply (reply.code(...).send(...)) STOPS the
//     chain — later hooks and the handler never run
//   · wrap()ed handlers send their own reply; a bare handler that RETURNS
//     a value gets it sent automatically (Fastify behavior)
//   · thrown errors map through OA's resolveErrorResponse (same statuses
//     and sanitized messages as the standalone server)
// ============================================================
import Busboy from 'busboy';
import { Router } from 'express';
import { resolveErrorResponse } from './middleware/index.js';

/** Build the Fastify-like reply object over an Express response. */
function makeReply(res) {
  const reply = {
    sent: false,
    code(statusCode) { res.status(statusCode); return reply; },
    header(name, value) { res.set(name, value); return reply; },
    headers(obj) { res.set(obj); return reply; },
    type(value) { res.type(value); return reply; },
    getHeader(name) { return res.getHeaders()[name]; },
    redirect(url) { reply.sent = true; res.redirect(url); },
    send(body) {
      if (reply.sent) return reply;
      reply.sent = true;
      if (body === null || body === undefined) { res.end(); return reply; }
      if (Buffer.isBuffer(body) || typeof body === 'string') { res.send(body); return reply; }
      res.json(body);
      return reply;
    },
  };
  return reply;
}

/** Attach the log + multipart shims OA code expects on Fastify's request. */
function decorateRequest(req, config) {
  if (!req.log) {
    req.log = {
      info: (...a) => console.log('[oa]', ...a),
      warn: (...a) => console.warn('[oa]', ...a),
      error: (...a) => console.error('[oa]', ...a),
      debug: () => {},
    };
  }
  // @fastify/multipart req.file(): first file part as { filename, mimetype,
  // truncated, toBuffer() }. Only /api/upload and /api/schedule-plan/:id/
  // import.xlsx call this; both just buffer the file.
  if (!req.file) {
    req.file = () => new Promise((resolve, reject) => {
      let bb;
      try {
        bb = Busboy({
          headers: req.headers,
          limits: { fileSize: config.upload.maxSize, files: 1 },
        });
      } catch (err) {
        return reject(err);
      }
      let file = null;
      let settled = false;
      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        if (err) reject(err); else resolve(value);
      };
      bb.on('file', (fieldname, stream, info) => {
        const chunks = [];
        let truncated = false;
        stream.on('data', c => chunks.push(c));
        stream.on('limit', () => { truncated = true; });
        stream.on('end', () => {
          file = {
            fieldname,
            filename: info.filename,
            mimetype: info.mimeType,
            encoding: info.encoding,
            truncated,
            toBuffer: async () => Buffer.concat(chunks),
          };
        });
      });
      bb.on('fields', () => {}); // ignore non-file parts (routes don't read them)
      bb.on('close', () => finish(null, file));
      bb.on('error', err => finish(err));
      req.pipe(bb);
    });
  }
}

/** Normalize Fastify route args: (path, handler) or (path, opts, handler). */
function splitArgs(args) {
  let opts = {};
  let handler = args[args.length - 1];
  if (args.length > 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    opts = args[0];
  }
  const pre = opts.preHandler
    ? (Array.isArray(opts.preHandler) ? opts.preHandler : [opts.preHandler])
    : [];
  return { pre, handler };
}

/**
 * @param {import('./config/index.js').config} config
 * @returns {{ router: import('express').Router, app: object }}
 *   router  — mount this on the SMT Express server
 *   app     — the Fastify-like object the OA route files receive
 */
export function createOaRouter(config) {
  const router = Router();
  const fileHooks = []; // hooks added via addHook('preHandler', ...)
  const contentTypeParsers = new Map(); // addContentTypeParser registrations

  /** Read the full request stream as one Buffer (for raw content types). */
  const readRawBody = req => new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  /** Apply a registered content-type parser to req.body if it matches. */
  const applyContentTypeParser = async req => {
    const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const entry = contentTypeParsers.get(ct);
    if (!entry) return;
    if (entry.opts?.parseAs === 'buffer') {
      if (Buffer.isBuffer(req.body)) return; // already parsed
      req.body = await readRawBody(req);
      return;
    }
    // parseAs:'string' would go here; no route file uses it (verified).
  };

  const sendError = (res, err) => {
    if (res.headersSent) return;
    const { status, msg } = resolveErrorResponse(err);
    res.status(status).json({ code: 1, msg });
  };

  const register = (method, path, args) => {
    // 单一登录策略：POST /api/auth/login 与 /api/auth/logout 由 SMT 的 api
    // 路由接管（同一 DB、同一用户库）。这里不注册 → 请求穿过 OA 路由，
    // 落到后面挂载的 SMT /api 路由。OA 其余 607 条路由照常注册。
    if (method.toLowerCase() === 'post' && (path === '/api/auth/login' || path === '/api/auth/logout')) return;
    const { pre, handler } = splitArgs(args);
    // Fastify scopes addHook() to the plugin that called it: a hook added
    // inside route file X applies only to the routes X registers after that
    // call. Snapshot the hook list at REGISTRATION time to reproduce that
    // scoping — reading it at request time would leak every file's
    // authenticate hook onto every route (including /api/auth/login).
    const hooks = [...fileHooks, ...pre];
    // Express 5 (path-to-regexp v8) rejects a bare `*` wildcard; Fastify
    // syntax `/api/files/*` becomes `/api/files/*splat`. The pipeline then
    // aliases req.params.splat back to req.params['*'] so handlers that
    // read the Fastify-style wildcard keep working unchanged.
    const exprPath = typeof path === 'string' && path.endsWith('/*') ? path + 'splat' : path;
    // One Express handler runs the whole Fastify pipeline so we can stop
    // the chain the moment a hook sends a reply (Fastify semantics).
    router[method](exprPath, async (req, res) => {
      const reply = makeReply(res);
      decorateRequest(req, config);
      if (process.env.OA_DEBUG === '1') console.log(`[oa-shim] ${req.method} ${req.originalUrl} hooks=${hooks.length}`);
      if (req.params && req.params.splat !== undefined && req.params['*'] === undefined) {
        req.params['*'] = req.params.splat;
      }
      try {
        await applyContentTypeParser(req);
        for (const hook of hooks) {
          if (reply.sent) return;
          await hook(req, reply);
        }
        if (reply.sent) return;
        const result = await handler(req, reply);
        if (result !== undefined && !reply.sent) reply.send(result);
      } catch (err) {
        sendError(res, err);
      }
    });
  };

  const app = {
    addHook(type, fn) {
      if (type === 'preHandler') fileHooks.push(fn);
      // onRequest/onSend hooks from route files: none exist (verified).
    },
    // Fastify plugin registration: route files export `export default
    // async function xxxRoutes(app) {...}` — call them inline (prefix is
    // always '' in this codebase, verified).
    register: async (plugin, opts = {}) => { await plugin(app, opts); },
    // Fastify content-type parsers. Only 'application/octet-stream' with
    // parseAs:'buffer' is used (doc-import.js): express.json() skips
    // octet-stream, so read the raw stream into req.body before hooks run.
    addContentTypeParser(contentType, opts, parser) {
      contentTypeParsers.set(String(contentType).toLowerCase(), { opts, parser });
    },
    get: (...a) => register('get', a[0], a.slice(1)),
    post: (...a) => register('post', a[0], a.slice(1)),
    put: (...a) => register('put', a[0], a.slice(1)),
    delete: (...a) => register('delete', a[0], a.slice(1)),
    patch: (...a) => register('patch', a[0], a.slice(1)),
    head: (...a) => register('head', a[0], a.slice(1)),
    options: (...a) => register('options', a[0], a.slice(1)),
  };

  return { router, app };
}
