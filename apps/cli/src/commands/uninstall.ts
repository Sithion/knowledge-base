import { Command } from 'commander';
import { Uninstaller } from '../services/uninstaller.js';
import { resolveProjectRoot } from '../utils/resolve-root.js';

export const uninstallCommand = new Command('uninstall')
  .description('Remove AI Knowledge Base and clean up all configurations')
  .option('--keep-data', 'Keep Docker volumes (database data)')
  .option('--force', 'Skip confirmation prompts')
  .action(async (options) => {
    try {
      const projectRoot = resolveProjectRoot();

      const uninstaller = new Uninstaller({
        projectRoot,
        force: options.force ?? false,
        keepData: options.keepData ?? false,
      });
      await uninstaller.run();
    } catch (err) {
      console.error(`\nUninstall failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });
