// 必须作为第一个 import：dotenv/config 在所有模块加载前执行
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { BadRequestException, Logger, ValidationPipe, ValidationError } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
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

  // CORS
  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, false);
      callback(null, corsOrigins.includes(origin));
    },
    credentials: corsOrigins.length > 0,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { limit: '50mb', extended: true });
  app.use(cookieParser());

  // 全局入参校验
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: false,
      stopAtFirstError: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const messages: string[] = [];
        const collect = (list: ValidationError[]) => {
          for (const e of list) {
            if (e.constraints) messages.push(...Object.values(e.constraints));
            if (e.children && e.children.length > 0) collect(e.children);
          }
        };
        collect(errors);
        return new BadRequestException(messages.length > 0 ? messages.join('; ') : '请求参数不合法');
      },
    }),
  );

  // Swagger API 文档
  const config = new DocumentBuilder()
    .setTitle('RJVN 统一管理系统 API')
    .setDescription('瑞晶越南工厂 WMS + 销售 + 人事 + 审批 统一接口文档')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);

  const logger = new Logger('Bootstrap');
  const host = process.env.SERVER_HOST || '0.0.0.0';
  const port = Number(process.env.SERVER_PORT || '3000');
  const httpsPort = Number(process.env.HTTPS_PORT || '3443');

  app.setBaseViewsDir(join(process.cwd(), 'dist/client'));
  app.setViewEngine('html');
  app.engine('html', hbsExpressEngine);

  app.useStaticAssets(join(process.cwd(), 'dist/client'), {
    prefix: '/',
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    },
  });

  // 证书下载页面
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

  await app.listen(port, host);
  logger.log(`WMS Server running on http://${host}:${port}`);
  logger.log(`API docs at http://${host}:${port}/api-docs`);

  // HTTPS
  const certResult = ensureSslCert({
    root: process.cwd(),
    passphrase: process.env.SSL_PFX_PASSPHRASE || 'wms2024',
  });
  if (certResult.info) {
    logger.log(`SSL: ${certResult.info.subject}`);
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
        logger.log(`WMS HTTPS running on https://${host}:${httpsPort}`);
      });
    } catch (e: any) {
      logger.error(`HTTPS start failed: ${e?.message}`);
    }
  }
}

bootstrap();
