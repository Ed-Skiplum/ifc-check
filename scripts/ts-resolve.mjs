/** Node resolve hook: lets a script import the UI's extensionless relative
 *  imports (`./i18n`) the way Vite resolves them, by trying `.ts` / `.tsx`.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/bcf-cli.ts ...
 *
 * Only relative specifiers without an extension are touched. */
import { register } from "node:module";

if (!globalThis.__tsResolveRegistered) {
  globalThis.__tsResolveRegistered = true;
  register(new URL(import.meta.url));
}

export async function resolve(specifier, context, next) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$|\.json$|\.wasm$/.test(specifier)) {
    for (const ext of [".ts", ".tsx"]) {
      try {
        return await next(specifier + ext, context);
      } catch {
        // try the next extension
      }
    }
  }
  return next(specifier, context);
}
