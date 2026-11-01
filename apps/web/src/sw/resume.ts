// Next's Cache Components serve a page as a static shell plus the runtime
// data the browser fetches with an inline script of the form
//   __NEXT_CLIENT_RESUME=fetch(location.pathname+'?_rsc=…',{credentials:'same-origin',headers:{'rsc': '1',…}})
// A saved page only renders offline with that payload saved too, so the
// worker reads the request out of the page. A page without the script, or a
// Next release that changes it, yields nothing; the end-to-end offline test
// covers the current shape.
const resumePattern = /__NEXT_CLIENT_RESUME=fetch\(location\.pathname\+'(\?[^']*)',\{[^{}]*headers:\{([^{}]*)\}/;
const headerPattern = /'([^']+)':\s*'([^']*)'/g;

export function resumeRequest(html: string, page: URL): Request | undefined {
  const match = resumePattern.exec(html);
  if (!match) return undefined;
  const [, query, headerList] = match;
  const headers = new Headers();
  for (const [, name, value] of headerList!.matchAll(headerPattern)) headers.set(name!, value!);
  return new Request(new URL(page.pathname + query, page.origin), { headers });
}
