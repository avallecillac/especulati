// Generates the 20 synthetic article pages and expected.json (research R4, SC-003).
//   node apps/lector-extension/test/fixtures/generate.mjs
// Bodies are built from a seeded vocabulary with no hyphens or apostrophes, so the word count the
// generator reports (whitespace-separated words) equals what Intl.Segmenter counts. The expected
// `words` is the number of words in the article body only: navigation, footer, related links and
// comments are not counted. Everything is deterministic: rerunning changes nothing.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const HOST = 'articles.example.test';

const VOCAB = {
  en: 'the of and a to in is that it was for on are with as they be at one have this from by hot word but what some we can out other were all there when up use your how said an each she which do their time if will way about many then them write would like so these her long make thing see him two has look more day could go come did number sound no most people my over know water than call first who may down side been now find'.split(' '),
  es: 'el de la que y a en un ser se no haber por con su para como estar tener le lo todo pero más hacer o poder decir este ir otro ese la si me ya ver porque dar cuando él muy sin vez mucho saber qué sobre mi alguno mismo yo también hasta año dos querer entre así primero desde grande eso ni nos llegar pasar tiempo ella sí día uno bien poco deber entonces poner cosa tanto hombre parecer nuestro tan donde ahora parte después vida quedar siempre creer hablar llevar dejar nada cada seguir menos nuevo encontrar algo solo decir casa canción montaña corazón país'.split(' '),
};

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `total` words as paragraphs of 3-6 sentences; returns paragraph strings (each word counted once). */
function paragraphs(lang, total, seed) {
  const rnd = prng(seed);
  const v = VOCAB[lang];
  const out = [];
  let left = total;
  while (left > 0) {
    const sentences = [];
    const nSent = 3 + Math.floor(rnd() * 4);
    for (let s = 0; s < nSent && left > 0; s++) {
      const len = Math.min(left, 9 + Math.floor(rnd() * 10));
      const words = Array.from({ length: len }, () => v[Math.floor(rnd() * v.length)]);
      words[0] = words[0][0].toUpperCase() + words[0].slice(1);
      left -= len;
      const mid = len > 8 && rnd() < 0.5 ? Math.floor(len / 2) : -1;
      if (mid > 0) words[mid - 1] += ',';
      sentences.push(words.join(' ') + '.');
    }
    out.push(sentences.join(' '));
  }
  return out;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const CHROME = {
  en: {
    nav: ['Home', 'World', 'Politics', 'Opinion', 'Sport', 'Subscribe'],
    related: ['Ten things to do this weekend', 'Weather outlook for the week', 'Local team wins again'],
    footer: 'Copyright 2026 Example Media. All rights reserved. Terms of use. Privacy policy. Contact us.',
  },
  es: {
    nav: ['Inicio', 'Mundo', 'Política', 'Opinión', 'Deportes', 'Suscríbete'],
    related: ['Diez planes para el fin de semana', 'El tiempo de la semana', 'El equipo local vuelve a ganar'],
    footer: 'Copyright 2026 Medios de Ejemplo. Todos los derechos reservados. Aviso legal. Política de privacidad. Contacto.',
  },
};

/**
 * spec: { lang, head: extra head html, title: <title> text or null, h1: text or null, byline: html or '',
 *         body: paragraph strings, chrome: bool, after: html after the article (comments), pre: html inside article }
 */
function page(spec) {
  const c = CHROME[spec.lang];
  const nav = spec.chrome ? `<nav><ul>${c.nav.map((n) => `<li><a href="/${n.toLowerCase()}">${n}</a></li>`).join('')}</ul></nav>` : '';
  const aside = spec.chrome
    ? `<aside><h3>${spec.lang === 'es' ? 'Relacionado' : 'Related'}</h3><ul>${c.related.map((r) => `<li><a href="/r">${r}</a></li>`).join('')}</ul></aside>`
    : '';
  const footer = spec.chrome ? `<footer><p>${c.footer}</p></footer>` : '';
  const title = spec.title === null ? '' : `<title>${esc(spec.title)}</title>`;
  return `<!doctype html>
<html lang="${spec.lang}">
<head>
<meta charset="utf-8">
${title}
${spec.head ?? ''}
</head>
<body>
${nav}
<main>
<article>
${spec.h1 ? `<h1>${esc(spec.h1)}</h1>` : ''}
${spec.byline ?? ''}
${(spec.body ?? []).map((p) => `<p>${p}</p>`).join('\n')}
${spec.pre ?? ''}
</article>
${spec.after ?? ''}
${aside}
</main>
${footer}
</body>
</html>
`;
}

const wc = (paras) => paras.reduce((n, p) => n + p.split(/\s+/).filter(Boolean).length, 0);

function comments(lang, seed) {
  const head = lang === 'es' ? 'Comentarios' : 'Comments';
  const items = Array.from({ length: 8 }, (_, i) => `<li class="comment"><strong>user${i + 1}</strong><p>${paragraphs(lang, 40, seed + i).join(' ')}</p></li>`);
  return `<section id="comments" class="comments"><h2>${head}</h2><ul>${items.join('')}</ul></section>`;
}

const meta = (name, content) => `<meta name="${name}" content="${content}">`;
const og = (content) => `<meta property="og:title" content="${content}">`;
const jsonld = (name) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'NewsArticle', author: { '@type': 'Person', name } })}</script>`;

const fixtures = [];
function add(file, expected, spec, bodyWords) {
  fixtures.push({ file, expected, spec, bodyWords });
}
function art(file, lang, seed, words, o) {
  const body = paragraphs(lang, words, seed);
  add(
    file,
    { title: o.expectTitle, author: o.author ?? null, words: o.expectWords ?? wc(body) },
    { lang, chrome: o.chrome ?? false, title: o.title ?? null, h1: o.h1 ?? null, byline: o.byline ?? '', head: o.head ?? '', body, after: o.after ?? '', pre: o.pre ?? '' },
  );
}

const nonArticle = (file, lang, title, items) => {
  const cards = items.map((n, i) => `<li class="product"><a href="/p/${i}"><img src="/i/${i}.jpg" alt=""><span>${n}</span></a><b>$${9 + i}.99</b><button>${lang === 'es' ? 'Añadir' : 'Add'}</button></li>`);
  const html = `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body><header><a href="/">Shop</a></header>
<ul class="grid">${cards.join('')}</ul></body></html>
`;
  fixtures.push({ file, expected: { title, author: null, words: null }, html });
};

// 1-2 news with navigation, related links and a footer
art('01-news-en.html', 'en', 101, 650, {
  chrome: true, title: 'City Council Approves New Bike Lanes | The Daily Ledger', h1: 'City Council Approves New Bike Lanes',
  byline: '<p class="byline">By Morgan Hale</p>', expectTitle: 'City Council Approves New Bike Lanes', author: 'Morgan Hale',
});
art('02-news-es.html', 'es', 102, 700, {
  chrome: true, title: 'El ayuntamiento aprueba nuevos carriles bici - Diario del Sur', h1: 'El ayuntamiento aprueba nuevos carriles bici',
  byline: '<p class="byline">Por Lucía Ferrer</p>', expectTitle: 'El ayuntamiento aprueba nuevos carriles bici', author: 'Lucía Ferrer',
});
// 3-4 blogs with comments
art('03-blog-comments-en.html', 'en', 103, 900, {
  chrome: true, title: 'Notes From A Slow Year', h1: 'Notes From A Slow Year', byline: '<p>Posted by <a rel="author" href="/about">Priya Nair</a></p>',
  after: comments('en', 1030), expectTitle: 'Notes From A Slow Year', author: 'Priya Nair',
});
art('04-blog-comments-es.html', 'es', 104, 850, {
  chrome: true, title: 'Apuntes de un año lento', h1: 'Apuntes de un año lento', byline: '<p>Publicado por <a rel="author" href="/acerca">Andrés Molina</a></p>',
  after: comments('es', 1040), expectTitle: 'Apuntes de un año lento', author: 'Andrés Molina',
});
// 5-6 author only in JSON-LD
art('05-jsonld-en.html', 'en', 105, 500, {
  title: 'Why Small Tools Last', h1: 'Why Small Tools Last', head: jsonld('Grace Whitfield'), expectTitle: 'Why Small Tools Last', author: 'Grace Whitfield',
});
art('06-jsonld-es.html', 'es', 106, 520, {
  title: 'Por qué duran las herramientas pequeñas', h1: 'Por qué duran las herramientas pequeñas', head: jsonld('Inés Carrasco'),
  expectTitle: 'Por qué duran las herramientas pequeñas', author: 'Inés Carrasco',
});
// 7-8 meta author
art('07-meta-author-en.html', 'en', 107, 800, {
  chrome: true, title: 'A Field Guide To Quiet Cafes', h1: 'A Field Guide To Quiet Cafes', head: meta('author', 'Dana Okafor'),
  expectTitle: 'A Field Guide To Quiet Cafes', author: 'Dana Okafor',
});
art('08-meta-author-es.html', 'es', 108, 780, {
  chrome: true, title: 'Guía de campo de cafeterías tranquilas', h1: 'Guía de campo de cafeterías tranquilas', head: meta('author', 'Rafael Ortega'),
  expectTitle: 'Guía de campo de cafeterías tranquilas', author: 'Rafael Ortega',
});
// 9-10 og:title only (no <title>, no h1)
art('09-og-title-en.html', 'en', 109, 600, {
  head: og('Three Ways To Learn A Language Faster'), expectTitle: 'Three Ways To Learn A Language Faster',
});
art('10-og-title-es.html', 'es', 110, 620, {
  head: og('Tres formas de aprender un idioma más rápido'), expectTitle: 'Tres formas de aprender un idioma más rápido',
});
// 11-12 no title at all: the site is the title
art('11-no-title-en.html', 'en', 111, 450, { expectTitle: HOST });
art('12-no-title-es.html', 'es', 112, 480, { expectTitle: HOST });
// 13 the cap
art('13-long-en.html', 'en', 113, 120000, {
  title: 'The Complete Almanac', h1: 'The Complete Almanac', head: meta('author', 'Sam Reyes'), expectTitle: 'The Complete Almanac', author: 'Sam Reyes', expectWords: 100000,
});
// 14-15 not articles
nonArticle('14-product-grid-en.html', 'en', 'Shop All Kitchen Gadgets', ['Garlic press', 'Milk frother', 'Salad spinner', 'Mandoline', 'Egg timer', 'Peeler', 'Whisk', 'Tongs']);
nonArticle('15-product-grid-es.html', 'es', 'Comprar todos los utensilios de cocina', ['Prensa de ajos', 'Espumador', 'Centrifugadora', 'Mandolina', 'Temporizador', 'Pelador', 'Batidor', 'Pinzas']);
// 16 technical: code, figure, list
art('16-tech-en.html', 'en', 116, 1100, {
  chrome: true, title: 'Understanding Event Loops Without Tears | Dev Notes', h1: 'Understanding Event Loops Without Tears',
  byline: '<p class="byline">By Chen Wei</p>',
  pre: '<pre><code>const total = one + two;\nawait total;\nreturn total;</code></pre><figure><img src="/f.png" alt=""><figcaption>The loop, drawn.</figcaption></figure>',
  expectTitle: 'Understanding Event Loops Without Tears', author: 'Chen Wei',
});
// 17 essay with quotes and a list
art('17-essay-es.html', 'es', 117, 1000, {
  title: 'Elogio de la lentitud', h1: 'Elogio de la lentitud', byline: '<p class="byline">Por Marta Quintero</p>',
  pre: `<blockquote><p>${paragraphs('es', 30, 1170).join(' ')}</p></blockquote><ul>${paragraphs('es', 20, 1171).map((p) => `<li>${p}</li>`).join('')}</ul>`,
  expectTitle: 'Elogio de la lentitud', author: 'Marta Quintero',
});
// 18-19 site name in the <title>
art('18-title-suffix-en.html', 'en', 118, 550, {
  chrome: true, title: 'The Quiet Return Of Paper Maps – Wayfinder Magazine', h1: 'The Quiet Return Of Paper Maps', head: meta('author', 'Lee Marlow'),
  expectTitle: 'The Quiet Return Of Paper Maps', author: 'Lee Marlow',
});
art('19-title-suffix-es.html', 'es', 119, 560, {
  chrome: true, title: 'El regreso silencioso de los mapas de papel | Revista Meridiano', h1: 'El regreso silencioso de los mapas de papel', head: meta('author', 'Noelia Vidal'),
  expectTitle: 'El regreso silencioso de los mapas de papel', author: 'Noelia Vidal',
});
// 20 a short post
art('20-short-en.html', 'en', 120, 130, {
  title: 'A Short Note On Bread', h1: 'A Short Note On Bread', byline: '<p class="byline">By Jo Lindqvist</p>', expectTitle: 'A Short Note On Bread', author: 'Jo Lindqvist',
});

const expected = {};
for (const f of fixtures) {
  writeFileSync(join(dir, f.file), f.html ?? page(f.spec));
  expected[f.file] = f.expected;
}
writeFileSync(join(dir, 'expected.json'), JSON.stringify({ host: HOST, pages: expected }, null, 2) + '\n');
console.log(`${fixtures.length} fixtures written`);
