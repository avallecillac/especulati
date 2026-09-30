// Injected into the page by chrome.scripting.executeScript (research R4). Pure DOM: no network,
// no storage. It returns only { url, title, author, words }; the article text never leaves the page.
import { Readability } from '@mozilla/readability';

export interface Extracted {
  url: string;
  title: string;
  author: string | null;
  /** Null when no article was found or the count is unusable. */
  words: number | null;
}

const MAX_WORDS = 100_000;
/** Below this the "article" Readability found is page chrome, not a body (product grids and the like). */
const MIN_ARTICLE_WORDS = 25;
const MAX_TITLE = 500;
const MAX_AUTHOR = 200;

/** Word-like segments (Intl.Segmenter handles Spanish punctuation and accents), capped at 100,000. */
export function countWords(text: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  let n = 0;
  for (const s of segmenter.segment(text)) {
    if (s.isWordLike && ++n >= MAX_WORDS) break;
  }
  return n;
}

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

function metaContent(doc: Document, selector: string): string {
  return clean(doc.querySelector<HTMLMetaElement>(selector)?.content);
}

/** The first author name found in a JSON-LD value (string, { name }, array, or an @graph). */
function nameOf(v: unknown): string {
  if (typeof v === 'string') return clean(v);
  if (Array.isArray(v)) {
    for (const x of v) {
      const n = nameOf(x);
      if (n) return n;
    }
    return '';
  }
  if (v && typeof v === 'object') return nameOf((v as { name?: unknown }).name);
  return '';
}

function jsonLdAuthor(doc: Document): string {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent ?? '');
    } catch {
      continue;
    }
    const nodes: unknown[] = Array.isArray(data) ? data : [data];
    for (const node of nodes) {
      const list = node && typeof node === 'object' && Array.isArray((node as { '@graph'?: unknown })['@graph']) ? ((node as { '@graph': unknown[] })['@graph']) : [node];
      for (const item of list) {
        if (item && typeof item === 'object') {
          const n = nameOf((item as { author?: unknown }).author);
          if (n) return n;
        }
      }
    }
  }
  return '';
}

/** "By Ana Ruiz" / "Por Ana Ruiz" -> "Ana Ruiz". */
const stripByline = (s: string): string => clean(s).replace(/^(by|por)\s+/i, '');

const siteOfHost = (host: string): string => host.replace(/^www\./i, '');

/**
 * "Headline \u2013 Site Name": when the only <h1> is the start of the title and a separator follows,
 * the headline alone is the title. (Readability strips " | " and " - " suffixes, not every dash.)
 */
function withoutSiteSuffix(title: string, doc: Document): string {
  const h1s = Array.from(doc.querySelectorAll('h1'));
  if (h1s.length !== 1) return title;
  const h1 = clean(h1s[0]!.textContent);
  if (h1 && title.length > h1.length && title.startsWith(h1) && /^\s*[|\u2013\u2014:\u00b7\u00bb-]\s/.test(title.slice(h1.length))) return h1;
  return title;
}

export function extractPage(): Extracted {
  const doc = document;
  let article: ReturnType<Readability['parse']> = null;
  try {
    article = new Readability(doc.cloneNode(true) as Document).parse();
  } catch {
    article = null;
  }

  const title = withoutSiteSuffix(
    clean(article?.title) || metaContent(doc, 'meta[property="og:title"]') || clean(doc.title) || siteOfHost(location.hostname),
    doc,
  );
  const author =
    stripByline(article?.byline ?? '') || stripByline(metaContent(doc, 'meta[name="author"]')) || stripByline(jsonLdAuthor(doc)) || null;

  let words: number | null = null;
  if (article?.textContent) {
    const n = countWords(article.textContent);
    words = n >= MIN_ARTICLE_WORDS ? n : null;
  }
  return {
    url: location.href,
    title: title.slice(0, MAX_TITLE),
    author: author === null ? null : author.slice(0, MAX_AUTHOR),
    words,
  };
}

// executeScript with `files` can't return a value, so the service worker calls this next.
(globalThis as { __readerlogExtract?: () => Extracted }).__readerlogExtract = extractPage;
