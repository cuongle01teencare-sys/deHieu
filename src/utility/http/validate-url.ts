/** This function validates an input http url. Returns URL.href on valid http url and null when the input url is invalid. All returned URL might have a forward slash at the end. For instance:
 * "https://api-h-c7818b61-608.sptpub.com/"
 * "https://csgoempire.com/"
 */
export function isValidHttpUrl(string: string) {
  let url;

  try {
    url = new URL(string);

    return url.href;
  } catch (_) {
    return null;
  }
}
