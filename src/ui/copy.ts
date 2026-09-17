/** Double-click any value to copy it in full.
 *
 * The escape hatch that lets identifiers stay untruncated: the app only ever
 * writes the clipboard, never reads it.
 */
export function copyOnDoubleClick(value: string) {
  return () => {
    void navigator.clipboard?.writeText(value).catch(() => {
      // Clipboard blocked (insecure origin, denied permission): nothing to do.
    });
  };
}
