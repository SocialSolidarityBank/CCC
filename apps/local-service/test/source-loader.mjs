import { registerHooks } from 'node:module';

// Test-only resolution of the real repository sources; no port replacements or product import rewrites.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context); }
    catch (error) {
      if ((error.code !== 'ERR_MODULE_NOT_FOUND' && error.code !== 'ERR_UNSUPPORTED_DIR_IMPORT') || !specifier.startsWith('.')) throw error;
      for (const candidate of specifier.endsWith('.js') ? [specifier.slice(0, -3) + '.ts'] : [specifier + '.ts', specifier + '/index.ts']) {
        try { return nextResolve(candidate, context); }
        catch (next) { if (next.code !== 'ERR_MODULE_NOT_FOUND' && next.code !== 'ERR_UNSUPPORTED_DIR_IMPORT') throw next; }
      }
      throw error;
    }
  },
});
