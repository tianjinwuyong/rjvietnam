// ============================================================
// OA merged-mode configuration (parity port from OA app/server/src/config/index.js)
//
// The standalone OA server loaded its own D:\OA\app\server\.env. In merged
// mode the OA module lives inside the SMT API process:
//   · DB connection comes from the shared PG* env vars (see oa/db/index.js);
//     the db block below is kept for display/logging parity only.
//   · Filesystem roots point into the SMT API directory:
//       uploads → services/api/oa-uploads/   (attachments, drive files)
//       data    → services/api/oa-data/      (integration.key etc.)
//       certs   → services/api/oa-certs/     (unused: HTTPS is terminated
//                                              by the SMT deployment layer)
//   · Every standalone env var keeps its original name and default; when a
//     value must differ in merged mode, prefix the var with OA_ (checked first).
// NOTE: do not read env vars at module top level for anything that must see
// services/api/.env — imports evaluate before server.js runs dotenv.config().
// Values here are read lazily by consumers; dotenv has run by then.
// ============================================================
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// services/api/src/oa/config → services/api
export const root = path.resolve(__dirname, '../../..');

function env(name, def = '') {
  const v = process.env['OA_' + name] ?? process.env[name];
  return v === undefined || v === '' ? def : v;
}

function bool(v, def = false) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function int(v, def) {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? def : n;
}

function envBool(name, def) { return bool(env(name), def); }
function envInt(name, def) { return int(env(name), def); }

export const config = {
  env: env('NODE_ENV', process.env.NODE_ENV || 'development'),

  server: {
    // Merged mode: the OA API is mounted inside the SMT Express server on
    // its port; host/port below describe the legacy standalone deployment
    // and are kept for URL-building parity (PUBLIC_URL still drives
    // notification links and QR codes).
    host: env('HOST', '127.0.0.1'),
    port: envInt('PORT', 3100),
    publicUrl: env('PUBLIC_URL', `http://localhost:${envInt('PORT', 3100)}`),
    trustProxy: envBool('TRUST_PROXY', false),
  },

  db: {
    host: process.env.PGHOST || env('DB_HOST', 'localhost'),
    port: Number(process.env.PGPORT ?? envInt('DB_PORT', 5432)),
    database: process.env.PGDATABASE || env('DB_NAME', 'smt_factory'),
    user: process.env.PGUSER || env('DB_USER', 'postgres'),
    password: process.env.PGPASSWORD || env('DB_PASSWORD', ''),
    max: envInt('DB_POOL_MAX', 10),
    ssl: false,
  },

  upload: {
    dir: env('UPLOAD_DIR', path.join(root, 'oa-uploads')),
    maxSize: envInt('UPLOAD_MAX_SIZE', 100 * 1024 * 1024),
    allowExt: (env('UPLOAD_ALLOW_EXT',
      '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.zip,.rar,.7z'
    )).split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    maxSegmentLength: envInt('DRIVE_MAX_SEGMENT', 120),
    maxAbsPath: envInt('DRIVE_MAX_ABS_PATH', 240),
    legacyBackupDir: env('DRIVE_LEGACY_BACKUP_DIR', '_legacy_backup'),
  },

  security: {
    sessionHours: envInt('SESSION_HOURS', 24),
    bcryptRounds: envInt('BCRYPT_ROUNDS', 10),
    maxLoginFail: envInt('MAX_LOGIN_FAIL', 0),
    lockMinutes: envInt('LOCK_MINUTES', 15),
    minPasswordLength: envInt('MIN_PASSWORD_LENGTH', 8),
    initialPassword: env('INITIAL_PASSWORD', 'oa@123456'),
  },

  flow: {
    timeoutHours: envInt('FLOW_TIMEOUT_HOURS', 2),
    remindIntervalMin: envInt('FLOW_REMIND_INTERVAL_MIN', 60),
  },

  doc: {
    lockTimeoutMin: envInt('DOC_LOCK_TIMEOUT_MIN', 30),
  },

  notify: {
    internal: true,
    email: envBool('NOTIFY_EMAIL', false),
    feishu: envBool('NOTIFY_FEISHU', false),
    smtp: {
      host: env('SMTP_HOST', ''),
      port: envInt('SMTP_PORT', 465),
      secure: envBool('SMTP_SECURE', true),
      user: env('SMTP_USER', ''),
      pass: env('SMTP_PASS', ''),
      from: env('SMTP_FROM', ''),
    },
  },

  feishu: {
    appId: env('FEISHU_APP_ID', ''),
    appSecret: env('FEISHU_APP_SECRET', ''),
    redirectUri: env('FEISHU_REDIRECT_URI', ''),
    enabled: envBool('FEISHU_ENABLED', false),
    monthlyApiQuota: envInt('FEISHU_MONTHLY_QUOTA', 8000),
  },

  cron: {
    enabled: envBool('CRON_ENABLED', true),
    scanTimeout: envInt('CRON_SCAN_TIMEOUT', 10),
    scanCertificate: envInt('CRON_SCAN_CERT', 1440),
    scanEquipment: envInt('CRON_SCAN_EQUIP', 1440),
    scanIpqc: envInt('CRON_SCAN_IPQC', 1440),
    scanMeeting: envInt('CRON_SCAN_MEETING', 60),
  },

  // Merged mode: no dedicated HTTPS listener (the SMT deployment layer
  // terminates TLS). Kept for code paths that check config.https.enabled.
  https: {
    enabled: false,
    port: envInt('HTTPS_PORT', 8443),
    keyPath: env('HTTPS_KEY', path.join(root, 'oa-certs/server.key')),
    certPath: env('HTTPS_CERT', path.join(root, 'oa-certs/server.crt')),
  },

  root,
};
