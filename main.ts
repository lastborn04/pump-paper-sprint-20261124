import { createRun3 } from './run3/strategy.ts';
import { runBot } from './vendor/makefun-bot.ts';

await runBot(createRun3('edge-floor'));
