// Dòng lệnh: npm run sync | sync:full | search -- "từ khoá"
import { getConfig } from './config';
import { createContext } from './app';
import { formatHits } from './search';

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const ctx = createContext(getConfig());
  try {
    if (cmd === 'sync') {
      const mode = rest.includes('--full') ? 'full' : rest.includes('--reconcile') ? 'reconcile' : 'auto';
      const r = await ctx.sync.run(mode);
      if (r.status !== 'SUCCESS') process.exitCode = 1;
    } else if (cmd === 'search') {
      const q = rest.join(' ');
      console.log(formatHits(q, ctx.search.search(q)));
    } else {
      console.log('Cách dùng: tsx src/cli.ts sync [--full|--reconcile] | search <từ khoá>');
      process.exitCode = 2;
    }
  } finally {
    ctx.store.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
