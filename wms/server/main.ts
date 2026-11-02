// 必须作为第一个 import：dotenv/config 在所有模块加载前执行，
// 确保 jwt-auth.guard 等模块在顶层读取 process.env.JWT_SECRET 时 .env 已生效
// （此前 dotenv.config() 写在 import 之后，被 import 提升机制抢先，JWT_SECRET 实际从未生效）
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { BadRequestException, Logger, ValidationPipe, ValidationError } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { __express as hbsExpressEngine } from 'hbs';
import cookieParser from 'cookie-parser';
import * as fs from 'fs';
import * as https from 'https';

import { AppModule } from './app.module';
import { ensureSslCert, getLanIPv4, readCert } from './common/utils/ssl-cert';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    abortOnError: process.env.NODE_ENV !== 'development',
    bodyParser: true,
  });

  // CORS（BUG-005 修复）：只放行可信 Origin 白名单。
  // 原配置 origin:true + credentials:true 会反射任意请求 Origin，并回 Access-Control-Allow-Credentials: true，
  // 一旦将来改用 Cookie 会话或暴露到公网，就会变成可越权读取数据的通道。
  // 前端 API 走相对路径（同源）、PDA 走 http(s)://服务器IP:3443（同为同源），本身都不需要 CORS；
  // 因此未配置 CORS_ORIGINS 时一律不下发任何跨域放行头，非白名单 Origin 由浏览器自行拦截。
  // 需要跨域时在 .env 里配置：CORS_ORIGINS=http://a.example.com,http://b.example.com
  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, false); // 同源 / 非浏览器请求：无需 CORS 头
      callback(null, corsOrigins.includes(origin));
    },
    credentials: corsOrigins.length > 0,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  // Body size limit
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { limit: '50mb', extended: true });

  app.use(cookieParser());

  // 审批统一走 OA 后，本地审批接口可一键停用（默认关闭，验收通过后设 WMS_APPROVAL_DISABLED=1）
  app.use((req: any, res: any, next: any) => {
    if (process.env.WMS_APPROVAL_DISABLED !== '1') return next();
    const p = String(req.path || '');
    if (req.method === 'POST' && /\/(approve|batch-approve|pre-approve|final-approve|over-consume\/approve)(\/|$)/.test(p)) {
      return res.status(410).json({
        error: { code: 'APPROVAL_MOVED_TO_OA', message: '审批已统一迁移至 OA，请在 OA 中处理' },
      });
    }
    next();
  });
  // 全局入参校验（BUG-001/002 修复配套）。
  // whitelist 保持 false：未在 DTO 中声明的字段一律原样透传，避免剥离存量接口的多余入参。
  // 带 DTO 的接口由 class-validator 做校验；不带 DTO 的接口 metatype 为 Object，ValidationPipe 自动跳过，
  // 因此本次改动对未接 DTO 的存量接口零影响。
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: false,
      // 每个字段只报第一条错误：否则一个缺失字段会同时抛出「不能为空 / 长度超限 / 格式不正确」三条噪声，
      // 提示不聚焦。配合 DTO 中 @IsNotEmpty 写在最贴近属性的位置（class-validator 自下而上执行），
      // 「字段缺失」优先得到「XXX不能为空」这条最贴切的提示。
      stopAtFirstError: true,
      // 默认异常体是 { message: string[] }（英文），前端只取 message 会显示不出内容；
      // 这里拍平成一条中文提示，例如「仓库编码不能为空；仓库中文名不能为空」。
      exceptionFactory: (errors: ValidationError[]) => {
        const messages: string[] = [];
        const collect = (list: ValidationError[]) => {
          for (const e of list) {
            if (e.constraints) messages.push(...Object.values(e.constraints));
            if (e.children && e.children.length > 0) collect(e.children);
          }
        };
        collect(errors);
        return new BadRequestException(messages.length > 0 ? messages.join('；') : '请求参数不合法');
      },
    }),
  );

  const logger = new Logger('Bootstrap');
  logger.log(
    corsOrigins.length > 0
      ? `CORS 白名单：${corsOrigins.join(', ')}`
      : 'CORS 未启用跨域放行（仅同源访问，符合默认部署方式）',
  );
  const host = process.env.SERVER_HOST || '0.0.0.0';
  const port = Number(process.env.SERVER_PORT || '3000');
  const httpsPort = Number(process.env.HTTPS_PORT || '3443');

  // 注册视图引擎, 渲染 client 目录下的 html 文件
  app.setBaseViewsDir(join(process.cwd(), 'dist/client'));
  app.setViewEngine('html');
  app.engine('html', hbsExpressEngine);

  // 静态资源（开发阶段不缓存，方便刷新看到最新效果）
  app.useStaticAssets(join(process.cwd(), 'dist/client'), {
    prefix: '/',
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    },
  });

  // 证书下载页面（iPhone 安装 HTTPS 证书用）
  // 页面里的地址占位符在请求时按当前网络环境替换，避免换 WiFi 后显示过期 IP
  const certPagePath = join(process.cwd(), 'dist', 'cert-download.html');
  const certFilePath = join(process.cwd(), 'ssl', 'wms-cert.crt');
  const expressApp = app.getHttpAdapter().getInstance();

  expressApp.get('/cert', (req: any, res: any) => {
    if (!fs.existsSync(certPagePath)) {
      res.status(404).send('Certificate download page not found');
      return;
    }
    const lanIp = getLanIPv4()[0]?.address || req.hostname || 'localhost';
    const httpsUrl = `https://${lanIp}:${httpsPort}`;
    // 证书信息一并动态注入，避免换证后页面还显示过期的颁发者/有效期
    const certInfo = readCert(certFilePath);
    const issuer = certInfo?.subject || 'WMS HTTPS Cert';
    const notAfter = certInfo ? `${certInfo.notAfter.getFullYear()} 年` : '-';
    const html = fs
      .readFileSync(certPagePath, 'utf8')
      .replace(/__WMS_HOST__/g, lanIp)
      .replace(/__WMS_HTTPS_URL__/g, httpsUrl)
      .replace(/__WMS_CERT_ISSUER__/g, issuer)
      .replace(/__WMS_CERT_NOT_AFTER__/g, notAfter)
      .replace('<body', `<body data-https-port="${httpsPort}"`);
    res.type('html').send(html);
  });

  expressApp.get('/cert/download', (_req: any, res: any) => {
    if (fs.existsSync(certFilePath)) {
      res.download(certFilePath, 'wms-https-cert.crt', {
        headers: { 'Content-Type': 'application/x-x509-ca-cert' },
      });
    } else {
      res.status(404).send('Certificate file not found');
    }
  });

  // 启动 HTTP 服务
  await app.listen(port, host);
  logger.log(`WMS Server running on http://${host}:${port}`);
  logger.log(`API endpoints ready at http://${host}:${port}/api`);

  // 启动 HTTPS 服务（手机端摄像头扫码需要 HTTPS）
  // 启动前先校验证书是否覆盖当前局域网 IP：自签证书的 SAN 必须包含手机
  // 实际访问用的地址，否则浏览器判定为不可信，页面留在非安全上下文，
  // getUserMedia 直接不可用（摄像头拉不起来）。换网络导致 IP 变化时会自动重签。
  const certResult = ensureSslCert({
    root: process.cwd(),
    passphrase: process.env.SSL_PFX_PASSPHRASE || 'wms2024',
  });
  logger.log(`SSL 证书：${certResult.message}`);
  if (certResult.info) {
    logger.log(`  证书主题：${certResult.info.subject}`);
    logger.log(`  SAN：${certResult.info.san || '(无)'}`);
    if (certResult.regenerated) {
      logger.log('  ⚠️ 证书已重新生成，手机端需重新安装 /cert/download 下载的新证书');
    }
  }

  const pfxPath = join(process.cwd(), 'ssl', 'wms-cert.pfx');
  if (fs.existsSync(pfxPath)) {
    try {
      const httpsOptions = {
        pfx: fs.readFileSync(pfxPath),
        passphrase: process.env.SSL_PFX_PASSPHRASE || 'wms2024',
      };
      const expressInstance = app.getHttpAdapter().getInstance();
      https.createServer(httpsOptions, expressInstance).listen(httpsPort, host, () => {
        logger.log(`WMS HTTPS Server running on https://${host}:${httpsPort}`);
        for (const { address, iface } of getLanIPv4()) {
          logger.log(`手机端访问（需先装证书）: https://${address}:${httpsPort}  [${iface}]`);
          logger.log(`证书安装页（HTTP，无需证书）: http://${address}:${port}/cert`);
        }
      });
    } catch (e: any) {
      logger.error(`HTTPS 启动失败: ${e?.message}`);
    }
  } else {
    logger.warn(`SSL 证书未找到 (${pfxPath})，HTTPS 未启动 —— 手机端将无法使用摄像头扫码`);
  }
}

bootstrap();
