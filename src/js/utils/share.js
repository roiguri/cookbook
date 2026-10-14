/**
 * Share through the device's share sheet, or copy when there is none
 * (e.g. Firefox and Chrome on Linux desktop).
 *
 * Call it straight from the click handler: browsers only open the share sheet
 * (and allow clipboard writes) in direct response to a user gesture.
 *
 * @param {{title?: string, text?: string, url?: string}} data - What the share sheet sends.
 * @param {string} copyText - What lands on the clipboard instead.
 * @returns {Promise<'shared'|'copied'|'cancelled'>} 'cancelled' when the user
 *   closed the share sheet. Throws when copying fails too.
 */
export async function shareOrCopy(data, copyText) {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
      // The sheet refused (e.g. the data or the gesture): fall back to copying.
    }
  }
  await navigator.clipboard.writeText(copyText);
  return 'copied';
}
