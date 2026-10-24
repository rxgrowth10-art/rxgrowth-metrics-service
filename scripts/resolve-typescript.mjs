/**
 * Admin scripts import TypeScript source using NodeNext `.js` specifiers.
 * Node resolves those specifiers only to `.js` files, which this repo does not
 * commit. This hook maps a missing relative `.js` import onto the `.ts` file.
 * Compiled API entries are loaded without this hook.
 */
export async function resolve(specifier, context, nextResolve) {
  if (!isRelativeJs(specifier)) return nextResolve(specifier, context);
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!isModuleNotFound(error)) throw error;
    return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
  }
}

function isRelativeJs(specifier) {
  return (specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js");
}

function isModuleNotFound(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND");
}
