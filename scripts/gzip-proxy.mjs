// Proxy local con gzip delante de `pnpm preview` (fase 13, Lighthouse CI). `vite preview` no
// comprime y en producción Cloudflare sí: sin esto Lighthouse mide ~3× más bytes y un LCP
// irreal. Sin dependencias. Uso: node scripts/gzip-proxy.mjs [puerto=4274] [destino=4273]
import http from 'node:http';
import zlib from 'node:zlib';

const port = Number(process.argv[2] ?? 4274);
const target = Number(process.argv[3] ?? 4273);
const COMPRESSIBLE = /text\/|javascript|json|xml|svg/;

http
  .createServer((req, res) => {
    const upstream = http.request(
      { host: 'localhost', port: target, path: req.url, method: req.method, headers: req.headers },
      (up) => {
        const headers = { ...up.headers };
        const gzip =
          /\bgzip\b/.test(req.headers['accept-encoding'] ?? '') &&
          !headers['content-encoding'] &&
          COMPRESSIBLE.test(headers['content-type'] ?? '');
        if (!gzip) {
          res.writeHead(up.statusCode ?? 502, headers);
          up.pipe(res);
          return;
        }
        delete headers['content-length'];
        headers['content-encoding'] = 'gzip';
        headers.vary = headers.vary ? `${headers.vary}, Accept-Encoding` : 'Accept-Encoding';
        res.writeHead(up.statusCode ?? 502, headers);
        up.pipe(zlib.createGzip({ level: 6 })).pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  })
  .listen(port, () => console.log(`gzip-proxy :${port} → :${target}`));
