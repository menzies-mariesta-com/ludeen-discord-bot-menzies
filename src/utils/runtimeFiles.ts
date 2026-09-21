/** Runtime command/event modules only — skip declaration and source-map artifacts. */
export function isRuntimeModuleFile(file: string): boolean {
  if (file.endsWith(".d.ts") || file.endsWith(".map")) return false;
  return file.endsWith(".js") || file.endsWith(".ts");
}
