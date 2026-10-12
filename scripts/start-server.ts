import { createPlaygroundServer } from '../playground/server.js';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const datasetDir = resolve(process.env.CAPTURED_DATASET_DIR ?? fileURLToPath(new URL('../sample-dataset',import.meta.url)));
const lan = process.argv.includes('--lan');
const port = Number(process.env.PORT ?? 8790);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
let mobileToken: string | undefined;
if (lan) {
  await mkdir(datasetDir,{recursive:true});
  const path = resolve(datasetDir,'.mobile-token');
  try { await writeFile(path,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600}); }
  catch(e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  await chmod(path,0o600);
  mobileToken = (await readFile(path,'utf8')).trim();
  console.log(`Mobile access enabled on trusted Wi-Fi. Workspace token is in ${path} (keep it private).`);
}
const server = await createPlaygroundServer({datasetDir,mobileToken});
await server.listen({host:lan ? '0.0.0.0' : '127.0.0.1',port});
console.log(`Captured ready at http://127.0.0.1:${port}. Connect a model in the browser; mobile uses the same workspace.`);
const shutdown = async () => { await server.close(); process.exit(0); };
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
